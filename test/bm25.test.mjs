import test from 'node:test'
import assert from 'node:assert/strict'

import { bm25Tokens, buildBm25Index, searchBm25 } from '../lib/bm25.js'
import { scopeAllowed } from '../lib/search.js'

function entry(id, text, scope = 'global') {
  return { id, text, meta: { scope, title: text.slice(0, 10) } }
}

test('中文分词产出词与双字', () => {
  const tokens = bm25Tokens('小明下周三去杭州出差')
  assert.ok(tokens.includes('杭州出差') || tokens.includes('杭州') || tokens.includes('出差'))
  assert.ok(tokens.includes('出差'))
  assert.ok(bm25Tokens('Hello World').includes('hello'))
})

test('BM25 命中相关条目并排序', () => {
  const entries = [
    entry('a', '小明下周三去杭州出差'),
    entry('b', '周末群里讨论去爬山'),
    entry('c', '发布前必须跑单元测试'),
  ]
  const index = buildBm25Index(entries)
  const hits = searchBm25(index, '杭州 出差', { topK: 3 })
  assert.equal(hits[0].entry.id, 'a')
  assert.ok(hits[0].score > 0)
})

test('无命中返回空数组', () => {
  const index = buildBm25Index([entry('a', '完全无关的内容')])
  assert.deepEqual(searchBm25(index, '量子计算'), [])
})

test('BM25 支持 scope 过滤', () => {
  const entries = [
    entry('a', '项目约定用 pnpm', 'project:x'),
    entry('b', 'pnpm 构建说明', 'global'),
  ]
  const index = buildBm25Index(entries)
  const hits = searchBm25(index, 'pnpm', {
    topK: 5,
    scopeFilter: (item) => scopeAllowed(item.meta.scope, 'global', null),
  })
  assert.deepEqual(hits.map((hit) => hit.entry.id), ['b'])
})

test('空查询返回空', () => {
  const index = buildBm25Index([entry('a', '内容')])
  assert.deepEqual(searchBm25(index, '   '), [])
})
