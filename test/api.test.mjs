import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installApi } from '../lib/api.js'
import { resolveConfig } from '../lib/config.js'
import { MemoryStore } from '../lib/store.js'
import { DIM, unit } from './helpers.mjs'

function makeConfig(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'qwen-rag-api-'))
  return resolveConfig({ memoryDir: dir, dimensions: DIM, apiKeyEnv: 'QWEN_RAG_TEST_MISSING_ENV', ...extra })
}

function makeResponse() {
  const headers = {}
  return {
    status: 0,
    headers,
    body: '',
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value
    },
    writeHead(status, extra) {
      this.status = status
      if (extra) {
        for (const [name, value] of Object.entries(extra)) headers[String(name).toLowerCase()] = value
      }
    },
    end(chunk) {
      this.body = chunk ?? ''
    },
  }
}

function makeRequest(method, options = {}) {
  const payload = options.body === undefined ? '' : JSON.stringify(options.body)
  return {
    method,
    url: options.url ?? '/',
    headers: {
      host: options.host ?? '127.0.0.1:3000',
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload !== '') yield Buffer.from(payload)
    },
  }
}

function install(options = {}) {
  const config = options.config ?? makeConfig()
  const store = options.store ?? new MemoryStore(config.memoryDir, config)
  const embedder = options.embedder ?? {
    embed: async (texts) => ({ vectors: texts.map(() => unit(0)), tokens: 7, model: config.embeddingModel, batches: 1 }),
    stats: () => ({ calls: 1, tokens: 7, lastError: null }),
  }
  const routes = new Map()
  const webCtx = {
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    effect(fn) {
      return fn()
    },
    get: () => undefined,
  }
  const ctx = {
    get: () => undefined,
    inject(_deps, callback) {
      return callback(webCtx)
    },
  }
  installApi(ctx, config, store, embedder)
  return {
    config,
    store,
    routes,
    async call(path, method, requestOptions = {}) {
      const route = routes.get(`/dsh-memory-rag/api${path}`)
      assert.ok(route, `缺少路由 ${path}`)
      const response = makeResponse()
      await route.handler(makeRequest(method, requestOptions), response)
      return {
        status: response.status,
        headers: response.headers,
        body: response.body === '' ? {} : JSON.parse(response.body),
      }
    },
  }
}

test('GET /settings 返回设置、预设与状态', async () => {
  const { call } = install()
  const { status, body } = await call('/settings', 'GET')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.providers.length, 7)
  assert.equal(body.settings.dimensions, DIM)
  assert.equal(body.key.configured, false)
  assert.equal(body.stats.count, 0)
})

test('POST /settings 保存并即时生效', async () => {
  const { call, config } = install()
  const { status, body } = await call('/settings', 'POST', {
    body: { baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', topK: 7 },
  })
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.deepEqual(body.changed, ['baseUrl', 'topK'])
  assert.equal(config.baseUrl, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1')
  assert.equal(config.topK, 7)
  assert.equal(existsSync(join(config.memoryDir, 'settings.json')), true)
})

test('记忆库非空时 POST 换模型返回 409', async () => {
  const config = makeConfig()
  const store = new MemoryStore(config.memoryDir, config)
  store.add({ text: 'x', hash: 'h', vector: unit(0), meta: { scope: 'global' } })
  const { call } = install({ config, store })
  const { status, body } = await call('/settings', 'POST', { body: { embeddingModel: 'text-embedding-v3' } })
  assert.equal(status, 409)
  assert.match(body.error, /清空记忆库/)
})

test('Key 写入、读取状态与清除', async () => {
  const { call, config } = install()
  const posted = await call('/key', 'POST', { body: { key: 'sk-test-abc' } })
  assert.equal(posted.status, 200)
  assert.equal(posted.body.key.configured, true)
  assert.equal(posted.body.key.source, 'file:api-key')
  assert.equal(readFileSync(join(config.memoryDir, 'api-key'), 'utf8'), 'sk-test-abc')

  const snapshot = await call('/settings', 'GET')
  assert.equal(snapshot.body.key.configured, true)

  const removed = await call('/key', 'DELETE')
  assert.equal(removed.body.key.configured, false)
  assert.equal(existsSync(join(config.memoryDir, 'api-key')), false)
})

test('Key 内容不回显', async () => {
  const { call } = install()
  const posted = await call('/key', 'POST', { body: { key: 'sk-secret-123' } })
  assert.equal(JSON.stringify(posted.body).includes('sk-secret-123'), false)
})

test('跨源写请求被拒绝', async () => {
  const { call } = install()
  const { status } = await call('/settings', 'POST', {
    body: { topK: 9 },
    origin: 'https://evil.example',
  })
  assert.equal(status, 403)
})

test('非回环来源的写请求被拒绝', async () => {
  const { call } = install()
  const { status } = await call('/settings', 'POST', {
    body: { topK: 9 },
    remoteAddress: '192.168.1.20',
    origin: 'http://127.0.0.1:3000',
  })
  assert.equal(status, 403)
})

test('测试连接成功与失败', async () => {
  const ok = install()
  const okResult = await ok.call('/test', 'POST', { body: {} })
  assert.equal(okResult.status, 200)
  assert.equal(okResult.body.ok, true)
  assert.equal(okResult.body.result.dimensions, DIM)

  const failing = install({
    embedder: {
      embed: async () => {
        throw new Error('API Key 无效')
      },
      stats: () => ({ calls: 1, tokens: 0, lastError: 'API Key 无效' }),
    },
  })
  const failed = await failing.call('/test', 'POST', { body: {} })
  assert.equal(failed.status, 400)
  assert.equal(failed.body.ok, false)
  assert.match(failed.body.error, /API Key 无效/)
})

test('桌面壳 dsh-app 页面可用 CORS（预检 + 写请求）', async () => {
  const { call } = install()
  const origin = 'dsh-app://dsh-memory-rag'

  const preflight = await call('/settings', 'OPTIONS', { origin })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers['access-control-allow-origin'], origin)
  assert.match(preflight.headers['access-control-allow-headers'], /content-type/)

  const write = await call('/settings', 'POST', { body: { topK: 6 }, origin })
  assert.equal(write.status, 200)
  assert.equal(write.headers['access-control-allow-origin'], origin)
  assert.equal(write.body.settings.topK, 6)
})

test('不可信 Origin 不返回 CORS 头', async () => {
  const { call } = install()
  const response = await call('/settings', 'OPTIONS', { origin: 'https://evil.example' })
  assert.equal(response.headers['access-control-allow-origin'], undefined)
})

test('切换 provider 时带出端点与默认模型', async () => {
  const { call } = install()
  const { status, body } = await call('/settings', 'POST', { body: { provider: 'openai' } })
  assert.equal(status, 200)
  assert.equal(body.settings.provider, 'openai')
  assert.equal(body.settings.baseUrl, 'https://api.openai.com/v1')
  assert.equal(body.settings.embeddingModel, 'text-embedding-3-small')
  assert.equal(body.settings.dimensions, 1536)
})

test('GET /models 透传端点模型列表', async () => {
  const { call } = install()
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: [{ id: 'text-embedding-v4' }, { id: 'other-model' }] }),
  })
  try {
    const { status, body } = await call('/models', 'GET')
    assert.equal(status, 200)
    assert.deepEqual(body.models, ['text-embedding-v4', 'other-model'])
  } finally {
    globalThis.fetch = original
  }
})

test('GET /models 在端点失败时报错', async () => {
  const { call } = install()
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' })
  try {
    const { status, body } = await call('/models', 'GET')
    assert.equal(status, 400)
    assert.equal(body.ok, false)
    assert.match(body.error, /500/)
  } finally {
    globalThis.fetch = original
  }
})

test('关键词模式：测试连接不访问端点，且标记无需 Key', async () => {
  const config = makeConfig({ provider: 'keyword' })
  const { call } = install({ config })

  const snapshot = await call('/settings', 'GET')
  assert.equal(snapshot.body.settings.provider, 'keyword')
  assert.equal(snapshot.body.settings.embeddingModel, 'bm25')
  assert.equal(snapshot.body.key.optional, true)

  const tested = await call('/test', 'POST', { body: {} })
  assert.equal(tested.status, 200)
  assert.equal(tested.body.result.mode, 'keyword')

  const models = await call('/models', 'GET')
  assert.deepEqual(models.body.models, [])
})

test('GET /status 返回运行状况', async () => {
  const { call, store } = install()
  store.add({ text: '状态测试', hash: 'h', vector: unit(0), meta: { scope: 'global' } })

  const { status, body } = await call('/status', 'GET')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.stats.count, 1)
  assert.equal(body.breakdown.notes, 1)
  assert.equal(body.health.storeLoaded, true)
  assert.equal(body.mode, 'cloud')
})

test('GET /memories 列表与搜索', async () => {
  const { call, store } = install()
  store.add({ text: '杭州出差安排', hash: 'h1', vector: unit(0), meta: { scope: 'global' } })
  store.add({ text: '周末爬山', hash: 'h2', vector: unit(1), meta: { scope: 'global' } })

  const all = await call('/memories', 'GET', { url: '/dsh-memory-rag/api/memories?limit=10' })
  assert.equal(all.status, 200)
  assert.equal(all.body.total, 2)

  const searched = await call('/memories', 'GET', { url: `/dsh-memory-rag/api/memories?query=${encodeURIComponent('出差')}` })
  assert.equal(searched.body.total, 1)
  assert.match(searched.body.items[0].preview, /出差/)
})

test('POST /memories/update 置顶与删除', async () => {
  const { call, store } = install()
  const added = store.add({ text: '可操作', hash: 'h', vector: unit(0), meta: { scope: 'global' } })

  const pinned = await call('/memories/update', 'POST', { body: { id: added.id, action: 'pin' } })
  assert.equal(pinned.status, 200)
  assert.equal(store.get(added.id).meta.pinned, true)

  const deleted = await call('/memories/update', 'POST', { body: { id: added.id, action: 'delete' } })
  assert.equal(deleted.status, 200)
  assert.equal(store.get(added.id), undefined)

  const bad = await call('/memories/update', 'POST', { body: { id: 'missing', action: 'pin' } })
  assert.equal(bad.status, 400)
})

test('GET /dashboard 返回洞察快照', async () => {
  const { call, store } = install()
  store.add({ text: '洞察测试', hash: 'h', vector: unit(0), meta: { scope: 'global', tags: ['测试'] } })

  const { status, body } = await call('/dashboard', 'GET', { url: '/dsh-memory-rag/api/dashboard?days=7' })
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.days, 7)
  assert.equal(body.overview.entries, 1)
  assert.equal(body.daily.length, 7)
  assert.equal(body.heatmap.length, 56)
})
