import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveConfig } from '../lib/config.js'
import { MemoryStore } from '../lib/store.js'
import { buildStatus, listMemories, updateMemory } from '../lib/status.js'
import { DIM, unit } from './helpers.mjs'

function setup(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rag-memory-status-'))
  const config = resolveConfig({ memoryDir: dir, dimensions: DIM, ...extra })
  const store = new MemoryStore(config.memoryDir, config)
  const embedder = {
    embed: async (texts) => ({ vectors: texts.map(() => unit(0)), tokens: 3, model: 'fake', batches: 1 }),
    stats: () => ({ calls: 2, tokens: 9, lastError: null }),
  }
  return { config, store, embedder }
}

test('状态快照包含模式、分布、存储与健康', async () => {
  const { config, store, embedder } = setup()
  store.add({
    text: '用户偏好中文',
    hash: 'h1',
    vector: unit(0),
    meta: { scope: 'global', title: '偏好', tags: ['偏好'] },
  })
  store.add({
    text: '项目用 pnpm',
    hash: 'h2',
    vector: unit(1),
    meta: { scope: 'project:abc', title: '约定', pinned: true },
  })
  store.add({
    text: '文档块',
    hash: 'h3',
    vector: unit(2),
    meta: { scope: 'global', source: 'file', path: '/docs/a.md', title: 'a.md · 约定' },
  })

  const status = await buildStatus({ get: () => undefined }, config, store, embedder)
  assert.equal(status.mode, 'cloud')
  assert.equal(status.provider, 'qwen-cn')
  assert.equal(status.stats.count, 3)
  assert.equal(status.breakdown.notes, 2)
  assert.equal(status.breakdown.files, 1)
  assert.equal(status.breakdown.pinned, 1)
  assert.equal(status.breakdown.project, 1)
  assert.equal(status.breakdown.global, 2)
  assert.equal(status.breakdown.fileGroups, 1)
  assert.equal(status.health.storeLoaded, true)
  assert.equal(status.usage.tokens, 9)
  assert.ok(status.storage.indexBytes > 0)
  assert.equal(status.recent.length, 3)
  assert.deepEqual(status.tags, [{ tag: '偏好', count: 1 }])
})

test('关键词模式标记为无需 Key', async () => {
  const { config, store, embedder } = setup({ provider: 'keyword' })
  const status = await buildStatus({ get: () => undefined }, config, store, embedder)
  assert.equal(status.mode, 'keyword')
  assert.equal(status.key.optional, true)
  assert.equal(status.baseUrl, null)
})

test('记忆库列表按时间倒序并分页', () => {
  const { store } = setup()
  store.add({ text: '第一条', hash: 'h1', vector: unit(0), meta: { scope: 'global', createdAt: '2026-01-01T00:00:00.000Z' } })
  store.add({ text: '第二条', hash: 'h2', vector: unit(1), meta: { scope: 'global', createdAt: '2026-02-01T00:00:00.000Z' } })

  const page = listMemories(store, { limit: 1 })
  assert.equal(page.total, 2)
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].preview, '第二条')
  assert.equal(page.nextOffset, 1)

  const next = listMemories(store, { limit: 1, offset: 1 })
  assert.equal(next.items[0].preview, '第一条')
  assert.equal(next.nextOffset, null)
})

test('记忆库搜索与 scope 过滤', () => {
  const { store } = setup()
  store.add({ text: '杭州出差安排', hash: 'h1', vector: unit(0), meta: { scope: 'project:p1' } })
  store.add({ text: '周末爬山', hash: 'h2', vector: unit(1), meta: { scope: 'global' } })

  const hits = listMemories(store, { query: '出差' })
  assert.equal(hits.total, 1)
  assert.match(hits.items[0].preview, /出差/)

  const globalOnly = listMemories(store, { scope: 'global' })
  assert.equal(globalOnly.total, 1)
})

test('置顶与删除', () => {
  const { store } = setup()
  const added = store.add({ text: '可操作条目', hash: 'h1', vector: unit(0), meta: { scope: 'global' } })

  assert.equal(updateMemory(store, { id: added.id, action: 'pin' }).ok, true)
  assert.equal(store.get(added.id).meta.pinned, true)

  assert.equal(updateMemory(store, { id: added.id, action: 'unpin' }).ok, true)
  assert.equal(store.get(added.id).meta.pinned, false)

  assert.equal(updateMemory(store, { id: 'missing', action: 'pin' }).ok, false)
  assert.equal(updateMemory(store, { id: added.id, action: 'boom' }).ok, false)

  assert.equal(updateMemory(store, { id: added.id, action: 'delete' }).ok, true)
  assert.equal(store.get(added.id), undefined)
})
