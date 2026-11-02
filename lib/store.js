/**
 * dsh-memory-rag — 追加式向量库（index.jsonl + meta.json）。
 *
 * 设计：
 * - 追加写，删除用墓碑记录（{"t":"del"}），加载时按顺序回放；
 * - 向量写入时归一化并以 base64(float32 LE) 落盘，检索只做点积；
 * - 索引整体常驻内存（个人规模：几千条 × 1024 维 ≈ 十几 MB）；
 * - 模型/维度变更时拒绝混用，要求重建索引（不静默算错）；
 * - 写入用 <dir>/.write.lock 串行化：桌面端与 headless/CLI 共用同一目录时
 *   不会交错写坏文件；锁超过 30s 视为陈旧并回收；
 * - 墓碑超过阈值时自动压缩重写（临时文件 + rename），避免索引只增不减。
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

const LOCK_STALE_MS = 30_000
const LOCK_WAIT_MS = 3_000

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
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
        if (Date.now() - started > LOCK_WAIT_MS) {
          throw new Error('记忆库正在被另一个进程写入，请稍后重试。')
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
    } catch (error) {
      // 失败不缓存「已加载」状态，下次调用重新尝试（例如用户改回模型/维度）
      this.entries.clear()
      throw error
    }
    return this
  }

  /** 内部：真正的加载逻辑。 */
  loadIndex() {
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
      this.writeMeta()
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
    if (meta === null && this.entries.size > 0) this.writeMeta()
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
   * 重写索引文件，清除墓碑（调用方需持有写锁）。
   * @returns {boolean} 是否执行了压缩。
   */
  compact() {
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
      if (this.needsCompaction()) this.compact()
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
      if (!this.entries.has(id)) return false
      appendFileSync(this.indexFile, `${JSON.stringify({ t: 'del', id, at: new Date().toISOString() })}\n`, 'utf8')
      this.entries.delete(id)
      this.tombstones += 1
      this.updatedAt = new Date().toISOString()
      this.revision = `${this.entries.size}-${Date.now().toString(36)}`
      if (this.needsCompaction()) this.compact()
      else this.writeMeta()
      return true
    } finally {
      release()
    }
  }

  /** 按 id 读取。 */
  get(id) {
    this.load()
    return this.entries.get(id)
  }

  /** 全部条目（按写入顺序）。 */
  list() {
    this.load()
    return [...this.entries.values()]
  }

  /** 内容哈希去重：同 scope 下同一 hash 视为重复。 */
  findByHash(hash, scope) {
    this.load()
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
    const current = this.entries.get(id)
    if (current === undefined) return null
    const release = this.acquireLock()
    try {
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
      this.writeMeta()
      return this.entries.get(id)
    } finally {
      release()
    }
  }

  /** 统计信息。 */
  stats() {
    this.load()
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
