import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveConfig } from '../lib/config.js'
import { buildDashboard } from '../lib/dashboard.js'
import { MemoryStore } from '../lib/store.js'
import { DIM, unit } from './helpers.mjs'

function isoDaysAgo(days) {
  const date = new Date()
  date.setHours(10, 0, 0, 0)
  date.setDate(date.getDate() - days)
  return date.toISOString()
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'rag-memory-dashboard-'))
  const config = resolveConfig({ memoryDir: dir, dimensions: DIM })
  const store = new MemoryStore(config.memoryDir, config)
  const embedder = {
    embed: async () => ({ vectors: [unit(0)], tokens: 5, model: 'fake', batches: 1 }),
    stats: () => ({ calls: 3, tokens: 12, lastError: null }),
  }
  return { config, store, embedder }
}

test('洞察快照聚合条目、时间序列与分布', () => {
  const { config, store, embedder } = setup()
  store.add({
    text: '用户偏好中文回答',
    hash: 'h1',
    vector: unit(0),
    meta: { scope: 'global', title: '偏好', tags: ['偏好'], createdAt: isoDaysAgo(0) },
  })
  store.add({
    text: '项目用 pnpm 构建',
    hash: 'h2',
    vector: unit(1),
    meta: { scope: 'project:abc', title: '约定', pinned: true, createdAt: isoDaysAgo(1) },
  })
  store.add({
    text: '文档块内容',
    hash: 'h3',
    vector: unit(2),
    meta: { scope: 'global', source: 'file', path: '/docs/a.md', title: 'a.md', createdAt: isoDaysAgo(10) },
  })

  const dashboard = buildDashboard(config, store, embedder, { days: 30 })
  assert.equal(dashboard.ok, true)
  assert.equal(dashboard.days, 30)
  assert.equal(dashboard.overview.entries, 3)
  assert.equal(dashboard.overview.notes, 2)
  assert.equal(dashboard.overview.files, 1)
  assert.equal(dashboard.overview.project, 1)
  assert.equal(dashboard.overview.global, 2)
  assert.equal(dashboard.overview.pinned, 1)
  assert.equal(dashboard.overview.fileGroups, 1)
  assert.ok(dashboard.overview.chars > 0)

  assert.equal(dashboard.daily.length, 30)
  const today = dashboard.daily[dashboard.daily.length - 1]
  assert.equal(today.count, 1)
  assert.equal(dashboard.daily[dashboard.daily.length - 2].count, 1)

  assert.equal(dashboard.heatmap.length, 56)
  assert.deepEqual(dashboard.composition, [
    { id: 'notes', label: '笔记', count: 2 },
    { id: 'files', label: '文档块', count: 1 },
  ])
  assert.deepEqual(dashboard.scope, [
    { id: 'project', label: '项目', count: 1 },
    { id: 'global', label: '全局', count: 2 },
  ])
  assert.deepEqual(dashboard.tags, [{ tag: '偏好', count: 1 }])
  assert.equal(dashboard.recent.length, 3)
  assert.equal(dashboard.recent[0].title, '偏好')
  assert.ok(dashboard.storage.indexBytes > 0)
  assert.equal(dashboard.usage.tokens, 12)
})

test('区间参数只接受 7/30/90', () => {
  const { config, store, embedder } = setup()
  assert.equal(buildDashboard(config, store, embedder, { days: 7 }).daily.length, 7)
  assert.equal(buildDashboard(config, store, embedder, { days: 90 }).daily.length, 90)
  assert.equal(buildDashboard(config, store, embedder, { days: 123 }).daily.length, 30)
})

test('空库给出空序列而不是报错', () => {
  const { config, store, embedder } = setup()
  const dashboard = buildDashboard(config, store, embedder, { days: 7 })
  assert.equal(dashboard.overview.entries, 0)
  assert.equal(dashboard.daily.length, 7)
  assert.equal(dashboard.recent.length, 0)
  assert.equal(dashboard.loadError, null)
})
