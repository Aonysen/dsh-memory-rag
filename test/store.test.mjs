import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MemoryStore, StoreBusyError, StoreMismatchError, decodeVector, encodeVector } from '../lib/store.js'
import { DIM, unit } from './helpers.mjs'

const CONFIG = { embeddingModel: 'text-embedding-v4', dimensions: DIM }

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'qwen-rag-'))
}

test('写入、读取、删除与哈希去重', () => {
  const dir = tempDir()
  const store = new MemoryStore(dir, CONFIG)
  const first = store.add({ text: '偏好中文回答', hash: 'h1', vector: unit(0), meta: { scope: 'global' } })
  const second = store.add({ text: '项目用 pnpm', hash: 'h2', vector: unit(1), meta: { scope: 'project:x' } })

  assert.equal(store.stats().count, 2)
  assert.equal(store.findByHash('h1', 'global').id, first.id)
  assert.equal(store.findByHash('h1', 'project:x'), null)

  const reloaded = new MemoryStore(dir, CONFIG)
  assert.equal(reloaded.list().length, 2)
  assert.equal(reloaded.get(second.id).text, '项目用 pnpm')

  reloaded.remove(first.id)
  const third = new MemoryStore(dir, CONFIG)
  assert.equal(third.stats().count, 1)
  assert.equal(third.get(first.id), undefined)
})

test('坏行被跳过并计数', () => {
  const dir = tempDir()
  const store = new MemoryStore(dir, CONFIG)
  store.add({ text: 'x', hash: 'h', vector: unit(0), meta: { scope: 'global' } })
  appendFileSync(join(dir, 'index.jsonl'), 'not-json\n', 'utf8')

  const reloaded = new MemoryStore(dir, CONFIG)
  assert.equal(reloaded.list().length, 1)
  assert.equal(reloaded.corruptLines, 1)
})

test('模型变更时拒绝加载', () => {
  const dir = tempDir()
  new MemoryStore(dir, CONFIG).add({ text: 'x', hash: 'h', vector: unit(0), meta: { scope: 'global' } })

  const other = new MemoryStore(dir, { ...CONFIG, embeddingModel: 'text-embedding-v3' })
  assert.throws(() => other.load(), StoreMismatchError)
  // 失败后不缓存「已加载」状态：改回配置可以再次加载成功
  const back = new MemoryStore(dir, CONFIG)
  assert.equal(back.load().stats().count, 1)
})

test('维度变更时拒绝加载', () => {
  const dir = tempDir()
  new MemoryStore(dir, CONFIG).add({ text: 'x', hash: 'h', vector: unit(0), meta: { scope: 'global' } })
  const other = new MemoryStore(dir, { ...CONFIG, dimensions: 128 })
  assert.throws(() => other.load(), StoreMismatchError)
})

test('向量编解码往返', () => {
  const vector = new Array(DIM).fill(0).map((_, i) => Math.sin(i) / 10)
  const back = decodeVector(encodeVector(vector))
  assert.equal(back.length, DIM)
  for (let i = 0; i < DIM; i += 1) assert.ok(Math.abs(back[i] - vector[i]) < 1e-6)
})

test('写锁串行化：陈旧锁会被回收', () => {
  const dir = tempDir()
  const store = new MemoryStore(dir, CONFIG)
  store.ensureDir()
  const lock = join(dir, '.write.lock')
  writeFileSync(lock, '99999', 'utf8')
  const old = new Date(Date.now() - 60_000)
  utimesSync(lock, old, old)

  store.add({ text: 'after stale lock', hash: 'h', vector: unit(0), meta: { scope: 'global' } })
  assert.equal(store.stats().count, 1)
  assert.equal(existsSync(lock), false)
})

test('关键词模式（维度 0）可存取且不写向量', () => {
  const dir = tempDir()
  const keywordConfig = { provider: 'keyword', embeddingModel: 'bm25', dimensions: 0 }
  const store = new MemoryStore(dir, keywordConfig)
  store.add({ text: '只存文本', hash: 'h', vector: null, meta: { scope: 'global' } })

  const reloaded = new MemoryStore(dir, keywordConfig)
  assert.equal(reloaded.stats().count, 1)
  assert.equal(reloaded.stats().dimensions, 0)
  assert.equal(reloaded.list()[0].vector, null)
})

test('墓碑超过阈值时自动压缩索引', () => {
  const dir = tempDir()
  const store = new MemoryStore(dir, CONFIG)
  const ids = []
  for (let i = 0; i < 60; i += 1) {
    ids.push(store.add({ text: `entry ${i}`, hash: `h${i}`, vector: unit(i), meta: { scope: 'global' } }).id)
  }
  for (const id of ids) store.remove(id)

  assert.equal(store.stats().count, 0)
  // 50 个墓碑时触发过一次自动压缩，剩余墓碑低于阈值
  assert.ok(store.stats().tombstones < 50)

  // 手动压缩把残余墓碑清空
  assert.equal(store.compact(), true)
  assert.equal(store.stats().tombstones, 0)

  const reloaded = new MemoryStore(dir, CONFIG)
  assert.equal(reloaded.stats().count, 0)
  assert.equal(reloaded.stats().tombstones, 0)
})

test('跨实例写入不会被压缩抹掉（多进程丢写回归）', () => {
  const dir = tempDir()
  const a = new MemoryStore(dir, CONFIG)
  a.list() // 让 A 先加载（模拟桌面端已启动）

  const b = new MemoryStore(dir, CONFIG)
  const x = b.add({ text: 'B 写入 X', hash: 'hx', vector: unit(0), meta: { scope: 'global' } }).id
  const y = b.add({ text: 'B 写入 Y', hash: 'hy', vector: unit(1), meta: { scope: 'global' } }).id
  const z = b.add({ text: 'B 写入 Z', hash: 'hz', vector: unit(2), meta: { scope: 'global' } }).id

  // A 读取时应感知到 B 的写入
  assert.notEqual(a.get(z), undefined)
  assert.equal(a.list().length, 3)

  const w = a.add({ text: 'A 写入 W', hash: 'hw', vector: unit(3), meta: { scope: 'global' } }).id
  a.remove(y)

  // 压缩前 A 的内存已合并 B 的记录；压缩后文件里仍应保留 X/Z/W
  assert.equal(a.compact(), true)
  const reloaded = new MemoryStore(dir, CONFIG)
  const ids = reloaded.list().map((entry) => entry.id).sort()
  assert.deepEqual(ids, [x, z, w].sort())
})

test('写锁被占用时快速失败并抛 StoreBusyError', () => {
  const dir = tempDir()
  const store = new MemoryStore(dir, { ...CONFIG, lockWaitMs: 0 })
  store.ensureDir()
  writeFileSync(join(dir, '.write.lock'), String(process.pid), 'utf8')

  assert.throws(
    () => store.add({ text: 'blocked', hash: 'h', vector: unit(0), meta: { scope: 'global' } }),
    (error) => error instanceof StoreBusyError,
  )
})
