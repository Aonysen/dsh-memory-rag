/**
 * dsh-memory-rag — 追加式向量库（index.jsonl + meta.json）。
 *
 * 设计：
 * - 追加写，删除用墓碑记录（{"t":"del"}），加载时按顺序回放；
 * - 向量写入时归一化并以 base64(float32 LE) 落盘，检索只做点积；
 * - 索引整体常驻内存、检索是全量精确扫描（无 ANN）：个人规模几千条 × 1024 维
 *   约几十 MB；上万条请评估（见 README「规模与限制」）；
 * - 模型/维度变更时拒绝混用，要求重建索引（不静默算错）；
 * - 写入用 <dir>/.write.lock 串行化；**每次写入前会 stat 索引文件并重读**
 *   （refreshIfChanged），因此 A 进程不会用陈旧内存覆盖 B 进程刚写入的记录；
 *   锁只保证写入不交错，不保证语义正确——仍建议同一记忆库只由一个进程写；
 * - 抢锁同步等待上限默认 100ms，超时抛 StoreBusyError（工具层异步重试）；
 * - 墓碑超过阈值时自动压缩；压缩前同样会先重读，避免抹掉其他进程的写入。
 */

import {
  appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync,
  statSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

/** 索引与配置不一致时抛出的专用错误。 */
export class StoreMismatchError extends Error {
  constructor(message) {
    super(message)
    this.name = 'StoreMismatchError'
    this.code = 'STORE_MISMATCH'
  }
}

/** 写锁被其他进程持有（调用方可在异步层退避重试）。 */
export class StoreBusyError extends Error {
  constructor(message = '记忆库正在被另一个进程写入，请稍后重试。') {
    super(message)
    this.name = 'StoreBusyError'
    this.code = 'STORE_BUSY'
  }
}

const LOCK_STALE_MS = 30_000
const DEFAULT_LOCK_WAIT_MS = 100

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** 索引文件的轻量指纹（size + mtime），用于检测其他进程的写入。 */
function fileStamp(path) {
  try {
    const stat = statSync(path)
    return `${stat.size}:${Math.round(stat.mtimeMs)}`
  } catch {
    return null
  }
}

/** 归一化向量（零向量保持全零）。 */
export function normalizeVector(vector) {
  const out = new Float32Array(vector.length)
  let sum = 0
  for (let i = 0; i < vector.length; i += 1) {
    const value = Number(vector[i]) || 0
    out[i] = value
    sum += value * value
  }
  const norm = Math.sqrt(sum)
  if (norm > 0) {
    for (let i = 0; i < out.length; i += 1) out[i] /= norm
  }
  return out
}

/** Float32Array → base64（小端，与平台一致）。 */
export function encodeVector(vector) {
  const copy = Float32Array.from(vector)
  return Buffer.from(copy.buffer, copy.byteOffset, copy.byteLength).toString('base64')
}

/** base64 → Float32Array 副本。 */
export function decodeVector(text) {
  const buffer = Buffer.from(String(text ?? ''), 'base64')
  const copy = new Uint8Array(buffer.byteLength)
  copy.set(buffer)
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4))
}

function newId() {
  const time = Date.now().toString(36)
  const suffix = randomBytes(4).toString('hex')
  return `m_${time}_${suffix}`
}

export class MemoryStore {
  /**
   * @param {string} dir - 数据目录。
   * @param {object} config - 规范化配置（model/dimensions 用于一致性校验）。
   */
  constructor(dir, config) {
    this.dir = dir
    this.config = config
    this.entries = new Map()
    this.loaded = false
    this.revision = '0'
    this.updatedAt = null
    this.corruptLines = 0
    this.tombstones = 0
    // 磁盘指纹：每次读写前比对，检测其他进程的写入
    this.diskStamp = null
    this.lockWaitMs = Number.isFinite(config?.lockWaitMs) ? config.lockWaitMs : DEFAULT_LOCK_WAIT_MS
  }

  get indexFile() {
    return join(this.dir, 'index.jsonl')
  }

  get metaFile() {
    return join(this.dir, 'meta.json')
  }

  get lockFile() {
    return join(this.dir, '.write.lock')
  }

  ensureDir() {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
  }

  /**
   * 获取写锁（跨进程串行化）。返回释放函数。
   * @returns {() => void}
   */
  acquireLock() {
    this.ensureDir()
    const started = Date.now()
    for (;;) {
      try {
        const fd = openSync(this.lockFile, 'wx')
        try {
          writeSync(fd, String(process.pid))
        } finally {
          closeSync(fd)
        }
        let released = false
        return () => {
          if (released) return
          released = true
          try {
            unlinkSync(this.lockFile)
          } catch {
            // 锁已被清理（例如陈旧回收）——忽略
          }
        }
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        let stat
        try {
          stat = statSync(this.lockFile)
        } catch {
          continue
        }
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          try {
            unlinkSync(this.lockFile)
          } catch {
            // 别人先回收了，继续抢
          }
          continue
        }
        if (Date.now() - started >= this.lockWaitMs) {
          throw new StoreBusyError()
        }
        sleepSync(25)
      }
    }
  }

  /**
   * 加载索引（幂等；坏行跳过并计数）。
   * @returns {this}
   * @throws {StoreMismatchError} meta.json 的模型/维度与当前配置不一致。
   */
  load() {
    if (this.loaded) return this
    try {
      this.loadIndex()
      this.loaded = true
      this.diskStamp = fileStamp(this.indexFile)
    } catch (error) {
      // 失败不缓存「已加载」状态，下次调用重新尝试（例如用户改回模型/维度）
      this.entries.clear()
      throw error
    }
    return this
  }

  /**
   * 强制重新加载索引（用于测试或显式刷新）。
   * @returns {this}
   */
  reload() {
    this.loaded = false
    this.load()
    return this
  }

  /**
   * 如果索引文件被其他进程改过，就重读内存视图。
   * @returns {boolean} 是否发生了重读。
   */
  refreshIfChanged() {
    if (!this.loaded) return false
    const stamp = fileStamp(this.indexFile)
    if (stamp === this.diskStamp) return false
    this.loadIndex()
    this.diskStamp = stamp ?? fileStamp(this.indexFile)
    return true
  }

  /** 读路径的宽容刷新：刷新失败不影响本次读取。 */
  maybeRefresh() {
    try {
      this.refreshIfChanged()
    } catch {
      // 读时刷新失败（例如文件正在被 rename）→ 使用当前内存视图
    }
  }

  /** 内部：真正的加载逻辑（会重置内存视图）。 */
  loadIndex() {
    this.entries.clear()
    this.tombstones = 0
    this.corruptLines = 0

    let meta = null
    try {
      meta = JSON.parse(readFileSync(this.metaFile, 'utf8'))
    } catch {
      meta = null
    }
    if (meta && typeof meta === 'object' && this.config.dimensions !== 0) {
      if (meta.model !== undefined && meta.model !== this.config.embeddingModel) {
        throw new StoreMismatchError(
          `现有索引由模型 ${meta.model} 生成，当前配置为 ${this.config.embeddingModel}。`
          + '请把 embeddingModel 改回原值，或删除/重建索引（rag_ingest）。',
        )
      }
      if (meta.dim !== undefined && Number(meta.dim) !== this.config.dimensions) {
        throw new StoreMismatchError(
          `现有索引维度为 ${meta.dim}，当前配置为 ${this.config.dimensions}。`
          + '请把 dimensions 改回原值，或删除/重建索引（rag_ingest）。',
        )
      }
    }

    let raw = ''
    try {
      raw = readFileSync(this.indexFile, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      // 加载阶段不写盘：meta 只在持锁写入后更新，避免并发下写回陈旧状态
      return this
    }

    let lastTimestamp = 0
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        this.corruptLines += 1
        continue
      }
      if (record?.t === 'add' && typeof record.id === 'string' && typeof record.text === 'string') {
        try {
          let vector = null
          if (this.config.dimensions !== 0) {
            if (typeof record.vec !== 'string') {
              this.corruptLines += 1
              continue
            }
            vector = decodeVector(record.vec)
            if (vector.length !== this.config.dimensions) {
              this.corruptLines += 1
              continue
            }
          }
          this.entries.set(record.id, {
            id: record.id,
            text: record.text,
            hash: typeof record.hash === 'string' ? record.hash : '',
            meta: record.meta && typeof record.meta === 'object' ? record.meta : {},
            vector,
          })
          const written = Date.parse(record.meta?.createdAt ?? '')
          if (Number.isFinite(written) && written > lastTimestamp) lastTimestamp = written
        } catch {
          this.corruptLines += 1
        }
      } else if (record?.t === 'del' && typeof record.id === 'string') {
        this.entries.delete(record.id)
        this.tombstones += 1
      }
    }

    this.updatedAt = lastTimestamp > 0 ? new Date(lastTimestamp).toISOString() : null
    this.revision = `${this.entries.size}-${lastTimestamp.toString(36)}`
    return this
  }

  /** 原子写 meta.json。 */
  writeMeta() {
    this.ensureDir()
    const payload = {
      schema: 1,
      model: this.config.embeddingModel,
      dim: this.config.dimensions,
      revision: this.revision,
      count: this.entries.size,
      updatedAt: this.updatedAt ?? new Date().toISOString(),
    }
    const tmp = `${this.metaFile}.tmp.${process.pid}`
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`)
    renameSync(tmp, this.metaFile)
  }

  /** 墓碑是否已超过压缩阈值。 */
  needsCompaction() {
    return this.tombstones >= Math.max(50, Math.floor(this.entries.size * 0.3))
  }

  /**
   * 重写索引文件，清除墓碑（自行加锁；会先重读磁盘）。
   * @returns {boolean} 是否执行了压缩。
   */
  compact() {
    this.load()
    const release = this.acquireLock()
    try {
      return this.compactLocked()
    } finally {
      release()
    }
  }

  /**
   * 内部：持有写锁时压缩。先 refreshIfChanged()，确保用的是磁盘上的完整
   * 条目集合，而不是本进程可能过期的内存视图。
   * @returns {boolean}
   */
  compactLocked() {
    this.refreshIfChanged()
    if (this.tombstones === 0) return false
    this.ensureDir()
    const tmp = `${this.indexFile}.tmp.${process.pid}`
    const lines = []
    for (const entry of this.entries.values()) {
      lines.push(JSON.stringify({
        t: 'add',
        id: entry.id,
        hash: entry.hash,
        text: entry.text,
        meta: entry.meta,
        model: this.config.embeddingModel,
        dim: this.config.dimensions,
        ...(entry.vector === null ? {} : { vec: encodeVector(entry.vector) }),
      }))
    }
    writeFileSync(tmp, lines.length === 0 ? '' : `${lines.join('\n')}\n`)
    renameSync(tmp, this.indexFile)
    this.tombstones = 0
    this.diskStamp = fileStamp(this.indexFile)
    this.writeMeta()
    return true
  }

  /**
   * 写入一条记忆。
   * @param {{text: string, meta: object, vector?: number[]|null, hash: string}} input
   * @returns {{id: string, createdAt: string}}
   */
  add(input) {
    this.load()
    const release = this.acquireLock()
    try {
      // 关键：持锁后先合并其他进程已落盘的写入，避免后续 compact 用陈旧内存覆盖
      this.refreshIfChanged()
      const createdAt = input.meta?.createdAt ?? new Date().toISOString()
      const id = input.meta?.id ?? newId()
      const meta = { ...input.meta, createdAt }
      delete meta.id
      const vector = this.config.dimensions === 0 || input.vector == null
        ? null
        : normalizeVector(input.vector)
      const record = {
        t: 'add',
        id,
        hash: input.hash,
        text: input.text,
        meta,
        model: this.config.embeddingModel,
        dim: this.config.dimensions,
        ...(vector === null ? {} : { vec: encodeVector(vector) }),
      }
      appendFileSync(this.indexFile, `${JSON.stringify(record)}\n`, 'utf8')
      this.entries.set(id, { id, text: input.text, hash: input.hash, meta, vector })
      this.updatedAt = createdAt
      this.revision = `${this.entries.size}-${Date.now().toString(36)}`
      this.diskStamp = fileStamp(this.indexFile)
      if (this.needsCompaction()) this.compactLocked()
      else this.writeMeta()
      return { id, createdAt }
    } finally {
      release()
    }
  }

  /** 墓碑删除；不存在时返回 false。 */
  remove(id) {
    this.load()
    const release = this.acquireLock()
    try {
      this.refreshIfChanged()
      if (!this.entries.has(id)) return false
      appendFileSync(this.indexFile, `${JSON.stringify({ t: 'del', id, at: new Date().toISOString() })}\n`, 'utf8')
      this.entries.delete(id)
      this.tombstones += 1
      this.updatedAt = new Date().toISOString()
      this.revision = `${this.entries.size}-${Date.now().toString(36)}`
      this.diskStamp = fileStamp(this.indexFile)
      if (this.needsCompaction()) this.compactLocked()
      else this.writeMeta()
      return true
    } finally {
      release()
    }
  }

  /** 按 id 读取（会先检查磁盘是否被其他进程改过）。 */
  get(id) {
    this.load()
    this.maybeRefresh()
    return this.entries.get(id)
  }

  /** 全部条目（按写入顺序；读前检查磁盘变化）。 */
  list() {
    this.load()
    this.maybeRefresh()
    return [...this.entries.values()]
  }

  /** 内容哈希去重：同 scope 下同一 hash 视为重复。 */
  findByHash(hash, scope) {
    this.load()
    this.maybeRefresh()
    for (const entry of this.entries.values()) {
      if (entry.hash === hash && entry.meta?.scope === scope) return entry
    }
    return null
  }

  /**
   * 更新条目元数据（置顶/标签等）：追加同 id 的 add 记录覆盖旧值。
   * @param {string} id
   * @param {object} patch - 合并进 meta 的字段。
   * @returns {object|null} 更新后的条目，不存在时 null。
   */
  updateMeta(id, patch) {
    this.load()
    const release = this.acquireLock()
    try {
      // 锁内重读：避免把其他进程刚更新的 meta 覆盖掉
      this.refreshIfChanged()
      const current = this.entries.get(id)
      if (current === undefined) return null
      const meta = { ...current.meta, ...patch }
      const record = {
        t: 'add',
        id,
        hash: current.hash,
        text: current.text,
        meta,
        model: this.config.embeddingModel,
        dim: this.config.dimensions,
        ...(current.vector === null ? {} : { vec: encodeVector(current.vector) }),
      }
      appendFileSync(this.indexFile, `${JSON.stringify(record)}\n`, 'utf8')
      this.entries.set(id, { ...current, meta })
      this.updatedAt = new Date().toISOString()
      this.revision = `${this.entries.size}-${Date.now().toString(36)}`
      this.diskStamp = fileStamp(this.indexFile)
      this.writeMeta()
      return this.entries.get(id)
    } finally {
      release()
    }
  }

  /** 统计信息（读前检查磁盘变化）。 */
  stats() {
    this.load()
    this.maybeRefresh()
    return {
      count: this.entries.size,
      tombstones: this.tombstones,
      dimensions: this.config.dimensions,
      model: this.config.embeddingModel,
      provider: this.config.provider,
      dir: this.dir,
      revision: this.revision,
      updatedAt: this.updatedAt,
      corruptLines: this.corruptLines,
    }
  }
}
