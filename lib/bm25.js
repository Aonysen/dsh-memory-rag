/**
 * dsh-memory-rag — 纯本地 BM25 检索（关键词模式）。
 *
 * 目标：不装模型、不联网、不需要任何 API Key 也能记住并找回内容。
 * 分词：优先 Intl.Segmenter('zh-CN') 切词，再给 CJK 词补相邻双字 bigram，
 * 这样「杭州出差」既能按词命中，也能被「出差」这类短词召回。
 * 分数：标准 BM25（k1=1.2, b=0.75），只依赖内存倒排索引。
 */

const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('zh-CN', { granularity: 'word' })
  : null
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/
const CJK_RUN = /[\u3400-\u9fff\uf900-\ufaff]+/g
const LATIN = /[a-z0-9_]{2,}/g

/**
 * BM25 分词：拉丁词 + CJK 词 + CJK 双字。
 * @param {string} text
 * @returns {string[]} 去重后的 token
 */
export function bm25Tokens(text) {
  const lower = String(text ?? '').toLowerCase()
  if (lower.trim() === '') return []
  const out = new Set()
  const addWord = (word) => {
    const value = String(word ?? '').trim()
    if (value === '') return
    out.add(value)
    if (CJK.test(value[0])) {
      for (let i = 0; i + 1 < value.length; i += 1) out.add(value.slice(i, i + 2))
    }
  }

  if (segmenter !== null) {
    for (const segment of segmenter.segment(lower)) {
      if (segment.isWordLike) addWord(segment.segment)
    }
  }
  // 兜底：Segmenter 不可用或漏切时，拉丁词与 CJK 连续串仍然可检索
  for (const match of lower.matchAll(LATIN)) out.add(match[0])
  for (const run of lower.match(CJK_RUN) ?? []) {
    if (run.length === 1) out.add(run)
    for (let i = 0; i + 1 < run.length; i += 1) out.add(run.slice(i, i + 2))
  }
  return [...out].filter((token) => token !== '')
}

/**
 * 构建倒排索引（调用方按 store.revision 缓存）。
 * @param {Array<{id: string, text: string, meta?: object, entry?: object}>} entries
 * @returns {{docs: Array<{entry: object, tokens: string[]}>, postings: Map<string, Array<[number, number]>>, avgdl: number}}
 */
export function buildBm25Index(entries) {
  const docs = []
  const postings = new Map()
  let totalLength = 0

  for (const entry of entries) {
    const tokens = bm25Tokens(`${entry.meta?.title ?? ''}\n${entry.text ?? ''}`)
    const docIndex = docs.length
    docs.push({ entry, tokens })
    totalLength += tokens.length
    const tf = new Map()
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1)
    for (const [token, count] of tf) {
      let list = postings.get(token)
      if (list === undefined) {
        list = []
        postings.set(token, list)
      }
      list.push([docIndex, count])
    }
  }

  return {
    docs,
    postings,
    avgdl: docs.length === 0 ? 0 : totalLength / docs.length,
  }
}

/**
 * BM25 检索。
 * @param {ReturnType<typeof buildBm25Index>} index
 * @param {string} query
 * @param {{topK?: number, scopeFilter?: (entry: object) => boolean}} [options]
 * @returns {Array<{entry: object, score: number}>}
 */
export function searchBm25(index, query, options = {}) {
  const topK = Math.max(1, Math.min(50, options.topK ?? 5))
  const scopeFilter = options.scopeFilter
  const queryTokens = new Set(bm25Tokens(query))
  const total = index.docs.length
  if (queryTokens.size === 0 || total === 0) return []

  const k1 = 1.2
  const b = 0.75
  const avgdl = index.avgdl > 0 ? index.avgdl : 1
  const scores = new Map()

  for (const token of queryTokens) {
    const list = index.postings.get(token)
    if (list === undefined) continue
    const df = list.length
    const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5))
    for (const [docIndex, count] of list) {
      const doc = index.docs[docIndex]
      if (scopeFilter !== undefined && !scopeFilter(doc.entry)) continue
      const length = doc.tokens.length > 0 ? doc.tokens.length : 1
      const score = idf * ((count * (k1 + 1)) / (count + k1 * (1 - b + (b * length) / avgdl)))
      scores.set(docIndex, (scores.get(docIndex) ?? 0) + score)
    }
  }

  return [...scores.entries()]
    .sort((a, b2) => b2[1] - a[1])
    .slice(0, topK)
    .map(([docIndex, score]) => ({ entry: index.docs[docIndex].entry, score }))
}
