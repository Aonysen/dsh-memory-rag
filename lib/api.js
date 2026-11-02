/**
 * dsh-memory-rag — 设置页的宿主 HTTP API。
 *
 * 路由（exact，挂在与 dsh-market 同款的 webServer 上）：
 *   GET    /dsh-memory-rag/api/settings  读取可编辑设置 + Key 状态 + 库统计
 *   POST   /dsh-memory-rag/api/settings  应用设置补丁（校验并持久化）
 *   POST   /dsh-memory-rag/api/key       写入 API Key（落到 api-key 文件）
 *   DELETE /dsh-memory-rag/api/key       清除 API Key
 *   POST   /dsh-memory-rag/api/test      用真实请求验证 Key / 地址 / 模型
 *   GET    /dsh-memory-rag/api/models    向当前端点查询可用模型（GET {baseUrl}/models）
 *
 * 安全：写操作要求回环来源，且 Origin 必须是同一 Host 或桌面壳的 dsh-app://；
 * Key 只写不读——接口永远只回「是否已配置 + 来源」。
 */

import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { isKeywordProvider, providerKeyOptional, resolveApiKey } from './config.js'
import { buildDashboard } from './dashboard.js'
import { buildStatus, listMemories, updateMemory } from './status.js'
import {
  applySettingsPatch,
  editableSnapshot,
  providerChoices,
} from './settings.js'

const PREFIX = '/dsh-memory-rag/api'
const MAX_BODY_BYTES = 64 * 1024

/** 尽力收紧 Windows 上 api-key 文件的 ACL（只保留当前用户）。 */
function restrictKeyFileAcl(file) {
  if (process.platform !== 'win32') return
  try {
    const user = process.env.USERNAME
    if (typeof user !== 'string' || user === '') return
    spawnSync('icacls', [file, '/inheritance:r', '/grant:r', `${user}:F`], {
      timeout: 3000,
      stdio: 'ignore',
    })
  } catch {
    // 尽力而为：icacls 不存在或被策略拦截时忽略
  }
}

/**
 * 保存 Key：优先 DSH 凭据服务，回退到 <dataDir>/api-key 文件。
 * @param {object} ctx - 插件上下文。
 * @param {object} config - 运行时配置。
 * @param {string} key - 已校验的 Key。
 * @param {string} file - api-key 文件路径。
 * @returns {Promise<{storage: 'credentials'|'file'}>}
 */
async function saveKey(ctx, config, key, file) {
  const credentials = typeof ctx?.get === 'function' ? ctx.get('credentials') : undefined
  if (config.keyStorage !== 'file' && credentials && typeof credentials.set === 'function') {
    try {
      await credentials.set(config.apiKeyEnv, key)
      // 凭据服务成功则删除旧明文文件，避免两份来源不一致
      try {
        unlinkSync(file)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      return { storage: 'credentials' }
    } catch {
      // 凭据服务不可用/不接受该引用 → 回退文件
    }
  }
  mkdirSync(config.memoryDir, { recursive: true })
  writeFileSync(file, key, { encoding: 'utf8', mode: 0o600 })
  restrictKeyFileAcl(file)
  return { storage: 'file' }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * 判断请求 Origin 是否可信：同 Host，或桌面壳的 dsh-app:// 页面。
 * 桌面窗口以 dsh-app:// 加载页面，设置页从该 origin 请求本机 HTTP API，
 * 因此这里必须把 dsh-app: 视为可信（仅回环来源才放行，见下）。
 */
function originTrusted(origin, host) {
  try {
    const url = new URL(origin)
    if (url.host === host) return true
    return url.protocol === 'dsh-app:'
  } catch {
    return false
  }
}

/** 写操作的同源检查：必须是回环来源，且（若带 Origin）Origin 可信。 */
export function isSameOrigin(request) {
  if (!isLoopback(request.socket?.remoteAddress)) return false
  const origin = request.headers?.origin
  if (typeof origin !== 'string' || origin === '') return true
  return originTrusted(origin, request.headers?.host)
}

/** 给可信跨源请求（桌面 dsh-app 页面）回 CORS 头，否则不返回任何头（浏览器自会拦截）。 */
function applyCors(request, response) {
  if (!isLoopback(request.socket?.remoteAddress)) return
  const origin = request.headers?.origin
  if (typeof origin !== 'string' || origin === '') return
  if (!originTrusted(origin, request.headers?.host)) return
  response.setHeader('access-control-allow-origin', origin)
  response.setHeader('vary', 'origin')
  response.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS')
  response.setHeader('access-control-allow-headers', 'content-type')
  response.setHeader('access-control-max-age', '600')
}

/** 读取 JSON 请求体（带上限与 Content-Type 检查）。 */
async function readJson(request) {
  const type = String(request.headers?.['content-type'] ?? '')
  if (!type.includes('application/json')) throw new Error('Content-Type 必须是 application/json')
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

/** Key 状态（永不返回值本身）。 */
async function keyInfo(ctx, config) {
  const optional = isKeywordProvider(config) || providerKeyOptional(config)
  try {
    const hit = await resolveApiKey(ctx, config)
    return hit === null
      ? { configured: false, source: null, optional }
      : { configured: true, source: hit.source, optional }
  } catch {
    return { configured: false, source: null, optional }
  }
}

/**
 * 注册设置 API。
 * @param {object} ctx - 插件上下文。
 * @param {object} config - 运行时配置（设置页会就地修改它）。
 * @param {object} store - MemoryStore。
 * @param {object} embedder - createEmbedder 的返回值。
 * @param {object} [logger] - 宿主 logger。
 * @returns {void}
 */
export function installApi(ctx, config, store, embedder, logger = console) {
  if (typeof ctx?.inject !== 'function') return
  ctx.inject(['webServer'], (webCtx) => {
    const server = webCtx.webServer ?? (typeof webCtx.get === 'function' ? webCtx.get('webServer') : undefined)
    if (!server || typeof server.register !== 'function') return undefined

    const register = (kind, path, handler) => webCtx.effect(
      () => server.register({
        kind,
        path,
        handler: async (request, response) => {
          applyCors(request, response)
          if (request.method === 'OPTIONS') {
            response.writeHead(204)
            response.end()
            return
          }
          await handler(request, response)
        },
      }),
      `dsh-memory-rag: route ${path}`,
    )

    register('exact', `${PREFIX}/settings`, async (request, response) => {
      if (request.method === 'GET') {
        store.load()
        sendJson(response, 200, {
          ok: true,
          settings: editableSnapshot(config),
          providers: providerChoices(),
          key: await keyInfo(ctx, config),
          stats: { ...store.stats(), usage: embedder.stats() },
        })
        return
      }
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'GET, POST' })
        response.end()
        return
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { ok: false, error: '请求来源不受信任' })
        return
      }
      let patch
      try {
        patch = await readJson(request)
      } catch (error) {
        sendJson(response, 400, { ok: false, error: String(error?.message ?? error) })
        return
      }
      let count = 0
      try {
        count = store.stats().count
      } catch {
        count = 0
      }
      const result = applySettingsPatch(config, patch, { storeCount: count })
      if (result.ok === false) {
        sendJson(response, result.status ?? 400, { ok: false, error: result.error })
        return
      }
      sendJson(response, 200, {
        ok: true,
        changed: result.changed,
        settings: editableSnapshot(config),
        key: await keyInfo(ctx, config),
      })
    })

    register('exact', `${PREFIX}/key`, async (request, response) => {
      if (request.method !== 'POST' && request.method !== 'DELETE') {
        response.writeHead(405, { allow: 'POST, DELETE' })
        response.end()
        return
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { ok: false, error: '请求来源不受信任' })
        return
      }
      const file = join(config.memoryDir, 'api-key')
      try {
        if (request.method === 'DELETE') {
          const credentials = typeof ctx?.get === 'function' ? ctx.get('credentials') : undefined
          if (credentials && typeof credentials.unset === 'function') {
            try {
              await credentials.unset(config.apiKeyEnv)
            } catch {
              // 凭据服务缺失该引用属于正常情况
            }
          }
          try {
            unlinkSync(file)
          } catch (error) {
            if (error?.code !== 'ENOENT') throw error
          }
          sendJson(response, 200, { ok: true, key: await keyInfo(ctx, config) })
          return
        }

        let body
        try {
          body = await readJson(request)
        } catch (error) {
          sendJson(response, 400, { ok: false, error: String(error?.message ?? error) })
          return
        }
        const key = String(body?.key ?? '').trim()
        if (key === '') {
          sendJson(response, 400, { ok: false, error: 'Key 不能为空' })
          return
        }
        if (key.length > 512 || /[\s"'`]/.test(key)) {
          sendJson(response, 400, { ok: false, error: 'Key 格式不合法（含空白/引号或过长）' })
          return
        }
        const saved = await saveKey(ctx, config, key, file)
        sendJson(response, 200, { ok: true, storage: saved.storage, key: await keyInfo(ctx, config) })
      } catch (error) {
        sendJson(response, 500, { ok: false, error: `保存 Key 失败：${error?.message ?? error}` })
      }
    })

    register('exact', `${PREFIX}/test`, async (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST' })
        response.end()
        return
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { ok: false, error: '请求来源不受信任' })
        return
      }
      let body = {}
      try {
        body = await readJson(request)
      } catch {
        body = {}
      }
      if (isKeywordProvider(config)) {
        sendJson(response, 200, {
          ok: true,
          result: { model: 'bm25', dimensions: 0, tokens: 0, latencyMs: 0, mode: 'keyword' },
          key: await keyInfo(ctx, config),
        })
        return
      }
      const text = typeof body?.text === 'string' && body.text.trim() !== ''
        ? body.text.trim().slice(0, 200)
        : '连接测试：验证 API Key、服务地址与向量维度是否可用。'
      const started = performance.now()
      try {
        const result = await embedder.embed([text])
        sendJson(response, 200, {
          ok: true,
          result: {
            model: result.model,
            dimensions: result.vectors[0]?.length ?? 0,
            tokens: result.tokens,
            latencyMs: Math.max(1, Math.round(performance.now() - started)),
          },
          key: await keyInfo(ctx, config),
        })
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error?.message ?? String(error),
          key: await keyInfo(ctx, config),
        })
      }
    })

    // 向当前端点查询可用模型，帮助「自定义 provider」填写模型名。
    register('exact', `${PREFIX}/models`, async (request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' })
        response.end()
        return
      }
      if (isKeywordProvider(config)) {
        sendJson(response, 200, { ok: true, models: [], latencyMs: 0 })
        return
      }
      const hit = await resolveApiKey(ctx, config)
      const started = performance.now()
      try {
        const headers = hit === null ? {} : { authorization: `Bearer ${hit.key}` }
        const upstream = await fetch(`${config.baseUrl}/models`, {
          headers,
          signal: AbortSignal.timeout(config.requestTimeoutMs),
        })
        const text = await upstream.text()
        if (!upstream.ok) {
          sendJson(response, 400, {
            ok: false,
            error: `端点返回 ${upstream.status}：${text.slice(0, 300)}`,
            latencyMs: Math.max(1, Math.round(performance.now() - started)),
          })
          return
        }
        let body = null
        try {
          body = JSON.parse(text)
        } catch {
          body = null
        }
        const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : []
        const models = rows
          .map((row) => (typeof row === 'string' ? row : row?.id))
          .filter((id) => typeof id === 'string' && id !== '')
        sendJson(response, 200, {
          ok: true,
          models,
          latencyMs: Math.max(1, Math.round(performance.now() - started)),
        })
      } catch (error) {
        logger?.warn?.(`[rag-memory] 拉取模型列表失败：${error?.message ?? error}`)
        sendJson(response, 400, { ok: false, error: `拉取模型列表失败：${error?.message ?? error}` })
      }
    })

    // 运行状况快照（设置页轮询，不产生网络请求）
    register('exact', `${PREFIX}/status`, async (request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' })
        response.end()
        return
      }
      try {
        sendJson(response, 200, await buildStatus(ctx, config, store, embedder))
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String(error?.message ?? error) })
      }
    })

    // 「记忆洞察」一级侧栏页面的数据
    register('exact', `${PREFIX}/dashboard`, async (request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' })
        response.end()
        return
      }
      try {
        const url = new URL(request.url ?? '/', 'http://localhost')
        const days = Number(url.searchParams.get('days') ?? 30)
        sendJson(response, 200, buildDashboard(config, store, embedder, { days }))
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String(error?.message ?? error) })
      }
    })

    // 记忆库浏览（分页 + 关键词过滤）
    register('exact', `${PREFIX}/memories`, async (request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' })
        response.end()
        return
      }
      try {
        const url = new URL(request.url ?? '/', 'http://localhost')
        const page = listMemories(store, {
          query: url.searchParams.get('query') ?? '',
          limit: Number(url.searchParams.get('limit') ?? 20),
          offset: Number(url.searchParams.get('offset') ?? 0),
          scope: url.searchParams.get('scope') ?? '',
        })
        sendJson(response, 200, { ok: true, ...page })
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String(error?.message ?? error) })
      }
    })

    // 置顶 / 取消置顶 / 删除
    register('exact', `${PREFIX}/memories/update`, async (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST' })
        response.end()
        return
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { ok: false, error: '请求来源不受信任' })
        return
      }
      let body
      try {
        body = await readJson(request)
      } catch (error) {
        sendJson(response, 400, { ok: false, error: String(error?.message ?? error) })
        return
      }
      const result = await updateMemory(store, body)
      sendJson(response, result.ok ? 200 : 400, result)
    })
  })
}
