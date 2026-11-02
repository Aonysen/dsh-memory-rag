/**
 * dsh-qwen-rag — 检索排序（纯函数）。
 *
 * 打分 = 0.85 × 余弦相似度 + 0.15 × 关键词重合率（CJK 双字 + 拉丁词）。
 * 归一化在写入时完成，这里只做点积；同一来源（path/title）最多取 2 条，
 * 避免一个文件霸占全部结果。
 */

import { sha256 } from './chunk.js'
import { normalizeVector } from './store.js'

/** 项目标识：cwd 的短哈希（与注入、写入共用同一算法）。 */
export function projectHash(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') return null
  return sha256(cwd.trim().toLowerCase()).slice(0, 12)
}

/** 分词：拉丁词 + CJK 单字/双字。 */
export function tokenize(text) {
  const tokens = new Set()
  const lower = String(text ?? '').toLowerCase()
  for (const match of lower.matchAll(/[a-z0-9_]{2,}/g)) tokens.add(match[0])
  const runs = lower.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) ?? []
  for (const run of runs) {
    if (run.length === 1) tokens.add(run)
    for (let i = 0; i + 1 < run.length; i += 1) tokens.add(run.slice(i, i + 2))
  }
  return tokens
}

/** 查询词在文档中的命中比例（0–1）。 */
export function keywordOverlap(queryTokens, text) {
  if (queryTokens.size === 0) return 0
  const docTokens = tokenize(text)
  if (docTokens.size === 0) return 0
  let hit = 0
  for (const token of queryTokens) {
    if (docTokens.has(token)) hit += 1
  }
  return hit / queryTokens.size
}

/**
 * 作用域过滤（向量检索与 BM25 共用）。
 * @param {string|undefined} entryScope - 条目 scope。
 * @param {string} scopeMode - auto | project | global | all。
 * @param {string|null} project - 当前项目哈希。
 * @returns {boolean}
 */
export function scopeAllowed(entryScope, scopeMode, project) {
  const scope = typeof entryScope === 'string' && entryScope !== '' ? entryScope : 'global'
  if (scopeMode === 'all') return true
  if (scopeMode === 'global') return scope === 'global'
  if (scopeMode === 'project') {
    if (scope === 'global') return true
    return project !== null && scope === `project:${project}`
  }
  // auto：有项目上下文时按项目（含全局），否则只看全局
  if (project === null) return scope === 'global'
  return scope === 'global' || scope === `project:${project}`
}

const scopeMatches = scopeAllowed

/**
 * 排序检索。
 * @param {Array<{id: string, text: string, meta: object, vector: Float32Array}>} entries - 全量条目。
 * @param {number[]} queryVector - 查询向量（未归一化也可）。
 * @param {string} queryText - 原始查询文本（关键词加权）。
 * @param {{topK?: number, minScore?: number, scopeMode?: string, project?: string|null, maxPerSource?: number}} [options]
 * @returns {Array<{entry: object, score: number, cosine: number, keyword: number}>}
 */
export function rankEntries(entries, queryVector, queryText, options = {}) {
  const topK = Math.max(1, Math.min(50, options.topK ?? 5))
  const minScore = typeof options.minScore === 'number' ? options.minScore : 0.25
  const scopeMode = options.scopeMode ?? 'auto'
  const project = options.project ?? null
  const maxPerSource = Math.max(1, options.maxPerSource ?? 2)
  if (!Array.isArray(entries) || entries.length === 0) return []

  const query = normalizeVector(queryVector)
  const queryTokens = tokenize(queryText)
  const scored = []

  for (const entry of entries) {
    if (!entry || typeof entry.text !== 'string') continue
    if (!scopeMatches(entry.meta?.scope, scopeMode, project)) continue
    const vector = entry.vector
    if (!vector || vector.length !== query.length) continue
    let cosine = 0
    for (let i = 0; i < vector.length; i += 1) cosine += vector[i] * query[i]
    if (cosine < 0) cosine = 0
    const keyword = keywordOverlap(queryTokens, `${entry.meta?.title ?? ''}\n${entry.text}`)
    const score = 0.85 * cosine + 0.15 * keyword
    if (score < minScore) continue
    scored.push({ entry, score, cosine, keyword })
  }

  scored.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))

  const picked = []
  const perSource = new Map()
  for (const hit of scored) {
    const source = hit.entry.meta?.path || hit.entry.meta?.title || hit.entry.id
    const used = perSource.get(source) ?? 0
    if (used >= maxPerSource) continue
    perSource.set(source, used + 1)
    picked.push(hit)
    if (picked.length >= topK) break
  }
  return picked
}
