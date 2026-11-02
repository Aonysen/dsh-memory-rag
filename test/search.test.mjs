import test from 'node:test'
import assert from 'node:assert/strict'

import { keywordOverlap, projectHash, rankEntries, tokenize } from '../lib/search.js'
import { normalizeVector } from '../lib/store.js'
import { DIM, unit } from './helpers.mjs'

function entry(id, text, scope, vector) {
  return { id, text, meta: { scope, title: text.slice(0, 20) }, vector: normalizeVector(vector) }
}

const ENTRIES = [
  entry('a', '用户偏好中文回答', 'global', unit(0)),
  entry('b', '项目使用 pnpm 构建', 'project:abc', unit(1)),
  entry('c', '部署脚本放在 scripts 目录', 'project:abc', unit(2)),
]

test('余弦相似度排序', () => {
  const hits = rankEntries(ENTRIES, unit(0), '中文', { topK: 3, minScore: 0.1, scopeMode: 'all' })
  assert.equal(hits[0].entry.id, 'a')
  assert.equal(hits[0].score, 1)
})

test('scope 过滤', () => {
  const globalOnly = rankEntries(ENTRIES, unit(0), '查询', { topK: 5, minScore: 0, scopeMode: 'global' })
  assert.deepEqual(globalOnly.map((hit) => hit.entry.id), ['a'])

  const autoProject = rankEntries(ENTRIES, unit(1), '查询', { topK: 5, minScore: 0.3, scopeMode: 'auto', project: 'abc' })
  assert.deepEqual(autoProject.map((hit) => hit.entry.id), ['b'])
})

test('无项目上下文时只看全局', () => {
  const hits = rankEntries(ENTRIES, unit(1), '查询', { topK: 5, minScore: 0.3, scopeMode: 'auto', project: null })
  assert.deepEqual(hits.map((hit) => hit.entry.id), [])
})

test('minScore 过滤', () => {
  const hits = rankEntries(ENTRIES, unit(5), '无关查询', { topK: 5, minScore: 0.5, scopeMode: 'all' })
  assert.equal(hits.length, 0)
})

test('同来源最多两条', () => {
  const many = [
    { ...entry('x1', '同一文件的第一段', 'global', unit(0)), meta: { scope: 'global', path: '/a.md' } },
    { ...entry('x2', '同一文件的第二段', 'global', unit(0)), meta: { scope: 'global', path: '/a.md' } },
    { ...entry('x3', '同一文件的第三段', 'global', unit(0)), meta: { scope: 'global', path: '/a.md' } },
    { ...entry('y1', '另一个文件', 'global', unit(0)), meta: { scope: 'global', path: '/b.md' } },
  ]
  const hits = rankEntries(many, unit(0), '文件', { topK: 5, minScore: 0, scopeMode: 'all', maxPerSource: 2 })
  assert.equal(hits.filter((hit) => hit.entry.meta.path === '/a.md').length, 2)
  assert.equal(hits.length, 3)
})

test('分词与关键词重合', () => {
  const tokens = tokenize('用户偏好中文回答 answer')
  assert.ok(tokens.has('中文'))
  assert.ok(tokens.has('answer'))
  assert.ok(keywordOverlap(tokens, '用户偏好中文回答') > 0.5)
  assert.equal(keywordOverlap(tokens, '完全无关'), 0)
})

test('项目哈希稳定且区分大小写以外差异', () => {
  assert.equal(projectHash('C:\\Work\\Demo'), projectHash('c:\\work\\demo'))
  assert.notEqual(projectHash('C:\\Work\\Demo'), projectHash('C:\\Work\\Other'))
  assert.equal(projectHash(null), null)
  assert.equal(projectHash(''), null)
})

test('维度不一致的条目被跳过', () => {
  const bad = { id: 'bad', text: '坏向量', meta: { scope: 'global' }, vector: new Float32Array(DIM - 1) }
  const hits = rankEntries([bad, ...ENTRIES], unit(0), '查询', { topK: 5, minScore: 0, scopeMode: 'all' })
  assert.ok(!hits.some((hit) => hit.entry.id === 'bad'))
})
