/**
 * dsh-memory-rag — 模型可见工具：检索 / 写入 / 导入 / 删除 / 统计。
 *
 * 工具对象走宿主 `ctx.tools.register({...})` 的纯对象约定（与
 * dsh-memory-evolve 相同），不依赖 @deepseek-ai/dsh-tools：
 *   { name, description, parameters, output: { schema, render }, execute }
 * 输出统一为 { ok, message, count }（additionalProperties:false），
 * 模型看到的正文在 message 里（render 原样输出）。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, basename, isAbsolute, join, resolve } from 'node:path'

import { chunkText, sha256 } from './chunk.js'
import { EmbeddingError } from './embedder.js'
import { buildBm25Index, searchBm25 } from './bm25.js'
import { projectHash, rankEntries, scopeAllowed } from './search.js'
import { StoreMismatchError } from './store.js'
import {
  expandConfiguredPath, isKeywordProvider, isPathInside, pathKey, providerKeyOptional, resolveApiKey,
} from './config.js'
import { writeWithRetry } from './retry.js'

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean' },
      message: { type: 'string' },
      count: { type: 'integer' },
    },
    required: ['ok', 'message', 'count'],
  },
  render: (_args, value) => [{ type: 'text', text: String(value?.message ?? '') }],
}

function fail(message) {
  return { ok: false, message, count: 0 }
}

function done(message, count) {
  return { ok: true, message, count }
}

function elapsed(started) {
  return `${Math.max(1, Math.round(performance.now() - started))}ms`
}

function oneLine(text, max) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/** 文件块的标题：文件名 + 块内首个 Markdown 标题（没有则用首个有效行）。 */
function chunkTitle(text, filePath) {
  const name = basename(String(filePath ?? ''))
  const lines = String(text ?? '').split('\n').map((line) => line.trim())
  const heading = lines.find((line) => /^#{1,6}\s+/.test(line))
  if (heading) return `${name} · ${heading.replace(/^#{1,6}\s+/, '').slice(0, 50)}`
  const first = lines.find((line) => line !== '' && !line.startsWith('```'))
  return first ? `${name} · ${oneLine(first, 50)}` : name
}

function formatDate(iso) {
  const time = Date.parse(iso ?? '')
  if (!Number.isFinite(time)) return ''
  const date = new Date(time)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function scopeLabel(scope) {
  return typeof scope === 'string' && scope.startsWith('project:') ? '项目' : '全局'
}

/** 统一把已知错误转成可读的工具结果。 */
async function guarded(run) {
  try {
    return await run()
  } catch (error) {
    if (error instanceof EmbeddingError || error instanceof StoreMismatchError) return fail(error.message)
    if (typeof error?.message === 'string' && error.message.startsWith('dsh-memory-rag:')) return fail(error.message)
    return fail(`内部错误：${error?.message ?? String(error)}`)
  }
}

/**
 * 解析写入作用域。
 * @param {string|undefined} requested - 'auto' | 'project' | 'global'。
 * @param {object|undefined} agent - 调用方 agent（取 session.header.cwd）。
 */
function resolveScope(requested, agent) {
  const cwd = agent?.session?.header?.cwd ?? null
  const project = projectHash(cwd)
  const mode = typeof requested === 'string' && requested !== '' ? requested : 'auto'
  if (mode === 'global') return { scope: 'global', project, cwd }
  if (mode === 'project') {
    if (project === null) {
      throw new Error('dsh-memory-rag: 当前会话没有工作目录，无法写入项目记忆；请改用 scope=global。')
    }
    return { scope: `project:${project}`, project, cwd }
  }
  return project === null
    ? { scope: 'global', project: null, cwd }
    : { scope: `project:${project}`, project, cwd }
}

function walkFiles(root, extensions, limit) {
  const files = []
  const stack = [root]
  while (stack.length > 0 && files.length < limit) {
    const current = stack.pop()
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      if (!extensions.includes(extname(entry.name).toLowerCase())) continue
      files.push(full)
      if (files.length >= limit) break
    }
  }
  return files
}

/**
 * 校验 rag_ingest 的目标路径。
 * 默认拒绝 ingestDeny 中的敏感目录；ingestRoots 非空时只允许其内部；
 * 工作目录之外的路径按 ingestOutsideCwd 决定 警告/拒绝/放行。
 * @param {string} target - 已解析的绝对路径。
 * @param {object} config - 规范化配置。
 * @param {string|null} cwd - 调用方会话工作目录。
 * @returns {{error?: string, warning?: string|null}}
 */
function checkIngestPath(target, config, cwd) {
  const deny = (config.ingestDeny ?? []).map(expandConfiguredPath).filter((item) => item !== '')
  for (const dir of deny) {
    if (isPathInside(dir, target) || pathKey(dir) === pathKey(target)) {
      return { error: `路径位于禁止导入的目录内：${dir}。如确需导入，请调整 cordis 配置里的 ingestDeny。` }
    }
  }

  const roots = (config.ingestRoots ?? []).map(expandConfiguredPath).filter((item) => item !== '')
  if (roots.length > 0 && !roots.some((root) => isPathInside(root, target))) {
    return { error: '路径不在允许导入的根目录（ingestRoots）内。' }
  }

  const outside = typeof cwd === 'string' && cwd !== '' && !isPathInside(cwd, target)
  if (outside && config.ingestOutsideCwd === 'deny') {
    return { error: '路径在工作目录之外，当前配置（ingestOutsideCwd=deny）已拒绝。' }
  }
  return {
    warning: outside && config.ingestOutsideCwd === 'warn'
      ? '⚠️ 读取了工作目录之外的路径；向量模式下这些文本会发往嵌入端点。'
      : null,
  }
}

/**
 * 注册全部工具；返回一个释放函数（注销全部注册）。
 * @param {object} ctx - 插件上下文。
 * @param {object} config - 规范化配置。
 * @param {import('./store.js').MemoryStore} store - 存储。
 * @param {object} embedder - createEmbedder 的返回值。
 * @returns {() => void}
 */
export function installTools(ctx, config, store, embedder) {
  const disposers = []

  /** BM25 倒排索引按 store.revision 缓存，写入后自动重建。 */
  let bm25Cache = { revision: null, index: null }
  function getBm25Index() {
    if (bm25Cache.index === null || bm25Cache.revision !== store.revision) {
      bm25Cache = { revision: store.revision, index: buildBm25Index(store.list()) }
    }
    return bm25Cache.index
  }

  async function search(args, exec) {
    return guarded(async () => {
      const started = performance.now()
      const query = String(args?.query ?? '').trim()
      if (query === '') return fail('query 不能为空。')
      const k = Number(args?.k ?? config.topK)
      if (!Number.isFinite(k) || k < 1) return fail('k 必须是 ≥1 的整数。')
      const mode = typeof args?.scope === 'string' ? args.scope : 'auto'
      if (!['auto', 'project', 'global', 'all'].includes(mode)) {
        return fail('scope 只能是 auto / project / global / all。')
      }

      store.load()
      if (store.stats().count === 0) {
        return done('记忆库为空：用 rag_remember 写入，或用 rag_ingest 导入文档。', 0)
      }

      const project = projectHash(exec?.agent?.session?.header?.cwd ?? null)
      const keywordMode = isKeywordProvider(config)
      let hits
      let tokens = 0
      let engine = config.embeddingModel

      if (keywordMode) {
        engine = 'BM25'
        hits = searchBm25(getBm25Index(), query, {
          topK: Math.min(50, Math.floor(k)),
          scopeFilter: (entry) => scopeAllowed(entry.meta?.scope, mode, project),
        })
      } else {
        const embedded = await embedder.embed([query])
        tokens = embedded.tokens
        hits = rankEntries(store.list(), embedded.vectors[0], query, {
          topK: Math.min(50, Math.floor(k)),
          minScore: config.minScore,
          scopeMode: mode,
          project,
        })
      }

      if (hits.length === 0) {
        return done(
          `未命中（topK=${k}，库内 ${store.stats().count} 条）。`
          + '可以换更具体的关键词重试，或用 rag_stats 查看库内容概况。',
          0,
        )
      }

      const lines = [
        `命中 ${hits.length} 条（${engine}，${elapsed(started)}${tokens > 0 ? `，tokens ${tokens}` : ''}）：`,
      ]
      hits.forEach((hit, index) => {
        const entry = hit.entry
        const title = oneLine(entry.meta?.title ?? '', 60)
        const date = formatDate(entry.meta?.createdAt)
        const head = `${index + 1}. [${entry.id}] ${hit.score.toFixed(2)}`
          + `${title ? ` · ${title}` : ''} · ${scopeLabel(entry.meta?.scope)}${date ? ` · ${date}` : ''}`
        lines.push(head)
        lines.push(`   ${oneLine(entry.text, 400)}`)
      })
      return done(lines.join('\n'), hits.length)
    })
  }

  async function remember(args, exec) {
    return guarded(async () => {
      const text = String(args?.text ?? '').trim()
      if (text.length < 4) return fail('text 过短：至少写入一句可复用的事实。')
      if (text.length > 20000) return fail('text 过长（上限 20000 字符）：请拆成多条，或先用 rag_ingest 导入文档。')

      const { scope } = resolveScope(args?.scope, exec?.agent)
      const hash = sha256(`${scope}\n${text}`)
      const duplicate = store.findByHash(hash, scope)
      if (duplicate) {
        return done(`内容已存在，未重复写入：${duplicate.id}（${scopeLabel(scope)}）。`, 0)
      }

      const tags = Array.isArray(args?.tags)
        ? args.tags.map((tag) => String(tag).trim()).filter((tag) => tag !== '').slice(0, 8)
        : []
      const title = typeof args?.title === 'string' && args.title.trim() !== ''
        ? args.title.trim().slice(0, 120)
        : oneLine(text, 60)

      const keywordMode = isKeywordProvider(config)
      let vector = null
      let tokens = 0
      if (!keywordMode) {
        const embedded = await embedder.embed([text])
        vector = embedded.vectors[0]
        tokens = embedded.tokens
      }
      const saved = await writeWithRetry(() => store.add({
        text,
        hash,
        vector,
        meta: {
          scope,
          title,
          tags,
          pinned: args?.pinned === true,
          source: 'note',
        },
      }))
      return done(
        `已写入记忆 ${saved.id}（${scopeLabel(scope)}，${tags.length > 0 ? `#${tags.join(' #')}，` : ''}`
        + `${keywordMode ? 'BM25 索引' : `tokens ${tokens}`}）。`,
        1,
      )
    })
  }

  async function ingest(args, exec) {
    return guarded(async () => {
      const rawPath = String(args?.path ?? '').trim()
      if (rawPath === '') return fail('path 不能为空。')
      const target = isAbsolute(rawPath) ? rawPath : resolve(rawPath)

      const cwd = exec?.agent?.session?.header?.cwd ?? null
      const guard = checkIngestPath(target, config, cwd)
      if (guard.error !== undefined) return fail(guard.error)

      let info
      try {
        info = statSync(target)
      } catch {
        return fail(`路径不存在：${target}`)
      }

      const extensions = ['.md', '.mdx', '.txt']
      let files
      if (info.isFile()) {
        if (!extensions.includes(extname(target).toLowerCase())) {
          return fail('只支持导入 .md / .mdx / .txt 文件。')
        }
        files = [target]
      } else if (info.isDirectory()) {
        files = walkFiles(target, extensions, 200)
      } else {
        return fail('path 必须是文件或目录。')
      }
      if (files.length === 0) return fail(`目录下没有可导入的 .md/.mdx/.txt 文件：${target}`)

      const { scope } = resolveScope(args?.scope, exec?.agent)
      const maxChunks = Math.min(config.maxChunksPerIngest, Math.max(1, Number(args?.maxChunks) || config.maxChunksPerIngest))

      let skipped = 0
      let truncated = false
      let filesRead = 0
      const pending = []
      outer:
      for (const file of files) {
        let text
        try {
          const size = statSync(file).size
          if (size > 2 * 1024 * 1024) {
            skipped += 1
            continue
          }
          text = readFileSync(file, 'utf8')
        } catch {
          skipped += 1
          continue
        }
        filesRead += 1
        for (const piece of chunkText(text, { maxChars: 800, hardMax: 2000, overlap: 100 })) {
          const hash = sha256(piece)
          if (store.findByHash(hash, scope) !== null) {
            skipped += 1
            continue
          }
          pending.push({ text: piece, hash, path: file })
          if (pending.length >= maxChunks) {
            truncated = true
            break outer
          }
        }
      }

      if (pending.length === 0) {
        return done(`没有新内容需要导入（读取 ${filesRead} 个文件，跳过 ${skipped} 段重复/超限内容）。`, 0)
      }

      let stored = 0
      let tokens = 0
      const failedAt = []
      const keywordMode = isKeywordProvider(config)
      const meta = (item) => ({
        scope,
        title: chunkTitle(item.text, item.path),
        tags: [],
        pinned: false,
        source: 'file',
        path: item.path,
      })

      if (keywordMode) {
        for (const item of pending) {
          await writeWithRetry(() => store.add({
            text: item.text,
            hash: item.hash,
            vector: null,
            meta: meta(item),
          }))
          stored += 1
        }
      } else {
        for (let i = 0; i < pending.length; i += 10) {
          const batch = pending.slice(i, i + 10)
          try {
            const result = await embedder.embed(batch.map((item) => item.text))
            tokens += result.tokens
            for (let index = 0; index < batch.length; index += 1) {
              const item = batch[index]
              await writeWithRetry(() => store.add({
                text: item.text,
                hash: item.hash,
                vector: result.vectors[index],
                meta: meta(item),
              }))
              stored += 1
            }
          } catch (error) {
            failedAt.push(error?.message ?? String(error))
            break
          }
        }
      }

      const summary = [
        guard.warning ?? '',
        `导入完成：文件 ${filesRead} 个，写入 ${stored} 段，跳过 ${skipped} 段，`
        + `${keywordMode ? 'BM25 索引（无向量）' : `tokens ${tokens}`}。`,
        truncated ? `已达到本次上限 ${maxChunks} 段，剩余内容请再次执行 rag_ingest。` : '',
        failedAt.length > 0 ? `中途失败（已写入 ${stored} 段）：${failedAt[0]}` : '',
      ].filter((line) => line !== '').join('\n')
      return failedAt.length > 0 ? { ok: false, message: summary, count: stored } : done(summary, stored)
    })
  }

  async function forget(args) {
    return guarded(async () => {
      const id = String(args?.id ?? '').trim()
      if (id === '') return fail('id 不能为空。')
      const removed = await writeWithRetry(() => store.remove(id))
      if (!removed) return fail(`条目不存在：${id}`)
      return done(`已删除 ${id}（墓碑写入，检索立即失效）。`, 1)
    })
  }

  async function stats() {
    return guarded(async () => {
      store.load()
      const info = store.stats()
      const usage = embedder.stats()
      const key = await resolveApiKey(ctx, config)
      const keywordMode = isKeywordProvider(config)
      const keyOptional = keywordMode || providerKeyOptional(config)
      const lines = [
        keywordMode
          ? `记忆库：${info.count} 条（BM25 关键词，无向量）`
          : `记忆库：${info.count} 条，${info.dimensions} 维，模型 ${info.model}`,
        keywordMode ? '模式：本地关键词（BM25，无需 Key、无需联网）' : `端点：${info.provider} · ${config.baseUrl}`,
        `目录：${info.dir}`,
        `revision：${info.revision}${info.updatedAt ? `，最后写入 ${info.updatedAt}` : ''}`,
        `Key：${key ? `已配置（来源 ${key.source}）` : keyOptional ? '无需 Key' : '未配置'}`,
        `本次进程用量：${usage.calls} 次调用，${usage.tokens} tokens`,
        `墓碑：${info.tombstones}，损坏行：${info.corruptLines}`,
      ]
      if (usage.lastError) lines.push(`最近错误：${usage.lastError}`)
      if (info.count > config.largeStoreWarning) {
        lines.push(
          `⚠️ 条目 ${info.count} 已超过 largeStoreWarning=${config.largeStoreWarning}：`
          + '当前是 O(N) 全量精确扫描，建议切到关键词模式或拆分记忆库（见 README「规模与限制」）。',
        )
      }
      return done(lines.join('\n'), info.count)
    })
  }

  disposers.push(ctx.tools.register({
    name: 'rag_search',
    description: '检索本地 RAG 记忆库：向量模式用余弦相似度，关键词模式用 BM25（无需联网/Key）。需要历史偏好、既往决策、项目约定或以前写过的结论时先检索；返回带条目 id 的片段与分数。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '自然语言检索词或问题（中文/英文均可）。' },
        k: { type: 'integer', description: '返回条数，1–50，默认取插件配置 topK。' },
        scope: {
          type: 'string',
          enum: ['auto', 'project', 'global', 'all'],
          description: '检索范围：auto=当前项目+全局（默认）；project=当前项目+全局；global=仅全局；all=全部。',
        },
      },
      required: ['query'],
    },
    output: OUTPUT,
    execute: search,
  }))

  disposers.push(ctx.tools.register({
    name: 'rag_remember',
    description: '把一条可复用的长期事实写入 RAG 记忆库（一句话一条；写入时即完成向量化，随即可被 rag_search 检索到）。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要记住的事实（一次一条，避免流水账与临时信息）。' },
        title: { type: 'string', description: '可选标题（≤120 字），用于索引展示。' },
        scope: {
          type: 'string',
          enum: ['auto', 'project', 'global'],
          description: 'auto=有工作目录时写项目记忆、否则写全局（默认）；project=强制项目；global=强制全局。',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '可选标签（≤8 个），如 ["偏好","构建"]。',
        },
        pinned: { type: 'boolean', description: 'true 时进入会话索引的置顶区。' },
      },
      required: ['text'],
    },
    output: OUTPUT,
    execute: remember,
  }))

  disposers.push(ctx.tools.register({
    name: 'rag_ingest',
    description: '把一个文件或目录（仅 .md/.mdx/.txt）切块、向量化并导入 RAG 记忆库；已有内容自动跳过，可重复执行。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件或目录的绝对路径（相对路径按宿主进程工作目录解析）。' },
        scope: {
          type: 'string',
          enum: ['auto', 'project', 'global'],
          description: 'auto=有工作目录时写项目记忆、否则写全局（默认）。',
        },
        maxChunks: { type: 'integer', description: '本次最多导入的段数（默认取插件配置 maxChunksPerIngest）。' },
      },
      required: ['path'],
    },
    output: OUTPUT,
    execute: ingest,
  }))

  disposers.push(ctx.tools.register({
    name: 'rag_forget',
    description: '从 RAG 记忆库删除一条记忆（按条目 id，墓碑写入，检索立即失效）。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'rag_search/rag_stats 返回的条目 id，如 m_xxx。' },
      },
      required: ['id'],
    },
    output: OUTPUT,
    execute: forget,
  }))

  disposers.push(ctx.tools.register({
    name: 'rag_stats',
    description: '查看 RAG 记忆库状态：条数、维度、模型、目录、revision、API Key 是否配置、本进程 token 用量。',
    parameters: { type: 'object', properties: {} },
    output: OUTPUT,
    execute: stats,
  }))

  return () => {
    for (const dispose of disposers) {
      try {
        dispose?.()
      } catch {
        // 注销失败不影响其他工具
      }
    }
  }
}
