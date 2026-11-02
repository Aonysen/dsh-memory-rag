/**
 * 检索性能基准（开发用，不随 npm 包发布）。
 *
 * 用法：node scripts/bench-search.mjs [维度] [查询次数]
 * 输出每个规模下的平均查询耗时与堆内存占用，供 README「规模与限制」引用。
 */

import { buildBm25Index, searchBm25 } from '../lib/bm25.js'
import { rankEntries } from '../lib/search.js'
import { normalizeVector } from '../lib/store.js'

const dims = Number(process.argv[2]) || 1024
const queries = Number(process.argv[3]) || 20
const sizes = [1000, 5000, 20000]

function makeEntries(count) {
  const entries = []
  for (let i = 0; i < count; i += 1) {
    const raw = new Array(dims)
    for (let d = 0; d < dims; d += 1) raw[d] = Math.sin((i + 1) * (d + 1) * 0.001)
    entries.push({
      id: `m_${i}`,
      text: `记忆条目 ${i} 关于项目约定与部署流程的说明`,
      meta: { scope: i % 3 === 0 ? 'project:p' : 'global', title: `条目 ${i}`, createdAt: new Date().toISOString() },
      vector: normalizeVector(raw),
    })
  }
  return entries
}

function makeQuery(seed) {
  const raw = new Array(dims)
  for (let d = 0; d < dims; d += 1) raw[d] = Math.cos((seed + 1) * (d + 1) * 0.001)
  return raw
}

console.log(`dims=${dims} queries=${queries}`)
for (const size of sizes) {
  global.gc?.()
  const entries = makeEntries(size)
  const heapBefore = process.memoryUsage().heapUsed

  let start = performance.now()
  for (let q = 0; q < queries; q += 1) rankEntries(entries, makeQuery(q), '部署流程 项目约定', { topK: 5, minScore: 0 })
  const vectorMs = performance.now() - start

  const index = buildBm25Index(entries)
  start = performance.now()
  for (let q = 0; q < queries; q += 1) searchBm25(index, '部署流程 项目约定', { topK: 5 })
  const bm25Ms = performance.now() - start

  const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024
  console.log(
    `N=${String(size).padStart(6)}  vector=${(vectorMs / queries).toFixed(1)}ms/query`
    + `  bm25=${(bm25Ms / queries).toFixed(1)}ms/query  heap≈+${heapMb.toFixed(0)}MB`,
  )
}
