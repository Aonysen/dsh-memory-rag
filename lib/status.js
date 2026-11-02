/**
 * dsh-memory-rag — 运行状况快照与记忆库浏览（设置页的数据面）。
 *
 * buildStatus：一次性汇总模式、端点、Key、库统计、存储占用、健康检查、
 * 最近写入与标签分布；不做网络请求（健康检查只读本地状态），可以放心
 * 让设置页定时轮询。
 * listMemories：按时间倒序列出条目；带 query 时用同一套 BM25 分词做
 * 轻量匹配，返回分页结果。
 */

import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { PROVIDERS, isKeywordProvider, providerKeyOptional, resolveApiKey } from './config.js'
import { bm25Tokens } from './bm25.js'

function fileSize(path) {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function scopeKind(scope) {
  return typeof scope === 'string' && scope.startsWith('project:') ? 'project' : 'global'
}

function preview(text, max = 200) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

function entrySummary(entry) {
  return {
    id: entry.id,
    title: entry.meta?.title ?? preview(entry.text, 60),
    scope: entry.meta?.scope ?? 'global',
    scopeKind: scopeKind(entry.meta?.scope),
    source: entry.meta?.source ?? 'note',
    pinned: entry.meta?.pinned === true,
    tags: Array.isArray(entry.meta?.tags) ? entry.meta.tags : [],
    createdAt: entry.meta?.createdAt ?? null,
    chars: typeof entry.text === 'string' ? entry.text.length : 0,
    preview: preview(entry.text, 200),
  }
}

/**
 * 构建运行状况快照。
 * @param {object} ctx - 插件上下文（取 Key 状态）。
 * @param {object} config - 规范化配置。
 * @param {object} store - MemoryStore。
 * @param {object} embedder - createEmbedder 返回值。
 * @returns {Promise<object>}
 */
export async function buildStatus(ctx, config, store, embedder) {
  const keywordMode = isKeywordProvider(config)
  const preset = PROVIDERS[config.provider] ?? {}
  const health = {
    storeLoaded: false,
    mismatch: null,
    lockHeld: false,
    keyConfigured: false,
    keyOptional: keywordMode || preset.keyOptional === true,
  }

  let entries = []
  try {
    entries = store.list()
    health.storeLoaded = true
  } catch (error) {
    health.mismatch = String(error?.message ?? error)
  }

  const key = await resolveApiKey(ctx, config).catch(() => null)
  health.keyConfigured = key !== null
  health.lockHeld = existsSync(store.lockFile)

  let notes = 0
  let files = 0
  let pinned = 0
  let project = 0
  let global = 0
  const fileGroups = new Set()
  const tagCounts = new Map()

  for (const entry of entries) {
    if (entry.meta?.source === 'file') {
      files += 1
      if (typeof entry.meta?.path === 'string') fileGroups.add(entry.meta.path)
    } else {
      notes += 1
    }
    if (entry.meta?.pinned === true) pinned += 1
    if (scopeKind(entry.meta?.scope) === 'project') project += 1
    else global += 1
    const tags = Array.isArray(entry.meta?.tags) ? entry.meta.tags : []
    for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  }

  const recent = [...entries]
    .sort((a, b) => (Date.parse(b.meta?.createdAt ?? '') || 0) - (Date.parse(a.meta?.createdAt ?? '') || 0))
    .slice(0, 5)
    .map(entrySummary)

  const tags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag, count]) => ({ tag, count }))

  const indexBytes = fileSize(store.indexFile)
  const metaBytes = fileSize(store.metaFile)
  const settingsBytes = fileSize(join(store.dir, 'settings.json'))
  const keyBytes = fileSize(join(store.dir, 'api-key'))

  return {
    ok: true,
    mode: keywordMode ? 'keyword' : (preset.keyOptional === true ? 'local' : 'cloud'),
    provider: config.provider,
    providerLabel: preset.label ?? config.provider,
    baseUrl: keywordMode ? null : config.baseUrl,
    model: config.embeddingModel,
    dimensions: config.dimensions,
    key: {
      configured: health.keyConfigured,
      optional: health.keyOptional,
      source: key?.source ?? null,
    },
    stats: {
      count: entries.length,
      tombstones: store.tombstones,
      corruptLines: store.corruptLines,
      revision: store.revision,
      updatedAt: store.updatedAt,
      dir: store.dir,
    },
    breakdown: { notes, files, pinned, project, global, fileGroups: fileGroups.size },
    storage: { indexBytes, metaBytes, settingsBytes, keyBytes, totalBytes: indexBytes + metaBytes + settingsBytes + keyBytes },
    usage: embedder.stats(),
    health,
    recent,
    tags,
  }
}

/**
 * 记忆库浏览：时间倒序，带 query 时按分词命中数排序。
 * @param {object} store - MemoryStore。
 * @param {{query?: string, limit?: number, offset?: number, scope?: string}} [options]
 * @returns {{total: number, items: object[], nextOffset: number|null}}
 */
export function listMemories(store, options = {}) {
  const query = String(options.query ?? '').trim()
  const limit = Math.max(1, Math.min(50, Number(options.limit) || 20))
  const offset = Math.max(0, Number(options.offset) || 0)
  const scopeFilter = typeof options.scope === 'string' && options.scope !== '' ? options.scope : null

  let entries = store.list()
  if (scopeFilter !== null) {
    entries = entries.filter((entry) => scopeKind(entry.meta?.scope) === scopeFilter)
  }

  let scored = entries
  if (query !== '') {
    const tokens = new Set(bm25Tokens(query))
    scored = entries
      .map((entry) => {
        const haystack = bm25Tokens(`${entry.meta?.title ?? ''}\n${entry.text ?? ''}`)
        let hits = 0
        for (const token of tokens) if (haystack.includes(token)) hits += 1
        return { entry, hits }
      })
      .filter((row) => row.hits > 0)
      .sort((a, b) => b.hits - a.hits
        || (Date.parse(b.entry.meta?.createdAt ?? '') || 0) - (Date.parse(a.entry.meta?.createdAt ?? '') || 0))
      .map((row) => row.entry)
  } else {
    scored = [...entries].sort((a, b) => (Date.parse(b.meta?.createdAt ?? '') || 0) - (Date.parse(a.meta?.createdAt ?? '') || 0))
  }

  const total = scored.length
  const items = scored.slice(offset, offset + limit).map(entrySummary)
  return { total, items, nextOffset: offset + items.length < total ? offset + items.length : null }
}

/**
 * 记忆条目操作（置顶 / 取消置顶 / 删除）。
 * @param {object} store - MemoryStore。
 * @param {{id: string, action: string}} input
 * @returns {{ok: boolean, error?: string, id?: string}}
 */
export function updateMemory(store, input) {
  const id = String(input?.id ?? '').trim()
  const action = String(input?.action ?? '').trim()
  if (id === '') return { ok: false, error: 'id 不能为空' }
  if (!['pin', 'unpin', 'delete'].includes(action)) {
    return { ok: false, error: 'action 只能是 pin / unpin / delete' }
  }
  if (action === 'delete') {
    return store.remove(id) ? { ok: true, id } : { ok: false, error: `条目不存在：${id}` }
  }
  const updated = store.updateMeta(id, { pinned: action === 'pin' })
  return updated === null ? { ok: false, error: `条目不存在：${id}` } : { ok: true, id }
}
