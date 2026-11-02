/**
 * dsh-memory-rag — OpenAI 兼容 Embeddings 客户端（千问 / 硅基流动 / OpenAI / Ollama / 自定义）。
 *
 * 约定：
 * - 接口：POST {baseUrl}/embeddings，model/input/dimensions/encoding_format。
 * - 单请求最多 10 条输入（千问 text-embedding-v4 的限制），本模块自动分批；
 *   其他端点通常允许更多，但这个上限最安全。
 * - 429 / 5xx / 网络错误自动重试 2 次（指数退避 + 抖动），其余错误立即失败。
 * - 错误一律转成 EmbeddingError，带中文可读信息与稳定 code。
 * - 不缓存 Key、不记录 Key；只累计 token 用量用于 rag_stats。
 */

import { providerKeyOptional } from './config.js'

/** 稳定的嵌入错误类型。 */
export class EmbeddingError extends Error {
  /**
   * @param {string} message - 面向用户的中文信息。
   * @param {{code?: string, status?: number, retryable?: boolean}} [options]
   */
  constructor(message, options = {}) {
    super(message)
    this.name = 'EmbeddingError'
    this.code = options.code ?? 'EMBEDDING_FAILED'
    this.status = options.status
    this.retryable = options.retryable === true
  }
}

/** 单请求最大输入条数。 */
export const MAX_BATCH = 10

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describeHttpError(status, body) {
  const apiCode = body?.error?.code ?? body?.code
  const apiMessage = body?.error?.message ?? body?.message
  const detail = [apiCode, apiMessage].filter((x) => typeof x === 'string' && x !== '').join(': ')
  switch (status) {
    case 400:
      return new EmbeddingError(`嵌入端点拒绝了请求（400）。${detail || '常见原因：单条文本超过模型上限或参数非法。'}`, { code: 'BAD_REQUEST', status })
    case 401:
      return new EmbeddingError(`鉴权失败（401）：API Key 无效、未开通服务，或 Key 与站点不匹配。${detail}`, { code: 'INVALID_KEY', status })
    case 403:
      return new EmbeddingError(`拒绝访问（403）：该 Key 没有此模型的权限，或服务未开通。${detail}`, { code: 'FORBIDDEN', status })
    case 404:
      return new EmbeddingError(`接口不存在（404）：请检查 Base URL 是否是可用的 OpenAI 兼容地址（通常以 /v1 结尾）。${detail}`, { code: 'NOT_FOUND', status })
    case 429:
      return new EmbeddingError('端点限流（429）：请求过于频繁，已重试仍失败，请稍后再试或减小 maxChunksPerIngest。', { code: 'RATE_LIMIT', status, retryable: true })
    default:
      if (status >= 500) {
        return new EmbeddingError(`端点服务端错误（${status}）：${detail || '稍后重试'}`, { code: 'SERVER_ERROR', status, retryable: true })
      }
      return new EmbeddingError(`调用失败（${status}）：${detail || '未知错误'}`, { code: 'HTTP_ERROR', status })
  }
}

/**
 * 创建嵌入器。
 * @param {object} config - 规范化后的插件配置。
 * @param {() => Promise<{key: string, source: string}|null>} getKey - 实时解析 Key。
 * @returns {{embed: (texts: string[]) => Promise<{vectors: number[][], tokens: number, model: string, batches: number}>, stats: () => {calls: number, tokens: number, lastError: string|null}}}
 */
export function createEmbedder(config, getKey) {
  const endpoint = `${config.baseUrl}/embeddings`
  const stats = { calls: 0, tokens: 0, lastError: null }

  async function postBatch(batch) {
    const hit = await getKey()
    // 本地 Ollama / 自定义端点 / 关键词模式允许没有 Key：此时不发鉴权头。
    const keyOptional = providerKeyOptional(config)
    if (!hit && !keyOptional) {
      throw new EmbeddingError(
        `未配置 API Key。请在设置页粘贴 Key，或设置环境变量 ${config.apiKeyEnv}，`
        + `或把 Key 写入 ${config.memoryDir}\\api-key。`,
        { code: 'MISSING_KEY' },
      )
    }
    let lastError = null
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      if (attempt > 0) await sleep(400 * 3 ** (attempt - 1) + Math.floor(Math.random() * 200))
      let response
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            ...(hit ? { Authorization: `Bearer ${hit.key}` } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: config.embeddingModel,
            input: batch,
            dimensions: config.dimensions,
            encoding_format: 'float',
          }),
          signal: AbortSignal.timeout(config.requestTimeoutMs),
        })
      } catch (error) {
        const reason = error?.name === 'TimeoutError' || error?.name === 'AbortError'
          ? `请求超时（${config.requestTimeoutMs}ms）`
          : (error?.message ?? String(error))
        lastError = new EmbeddingError(`无法连接嵌入端点（${endpoint}）：${reason}`, { code: 'NETWORK', retryable: true })
        continue
      }

      const text = await response.text().catch(() => '')
      let body = null
      try {
        body = text === '' ? null : JSON.parse(text)
      } catch {
        body = null
      }

      if (!response.ok) {
        const mapped = describeHttpError(response.status, body)
        lastError = mapped
        if (!mapped.retryable) throw mapped
        continue
      }

      const data = Array.isArray(body?.data) ? body.data : null
      if (data === null) {
        throw new EmbeddingError('端点返回格式异常：缺少 data 数组（可能不是 OpenAI 兼容接口）。', { code: 'BAD_RESPONSE', status: response.status })
      }
      const vectors = new Array(batch.length)
      for (const item of data) {
        const index = Number(item?.index ?? 0)
        const raw = item?.embedding
        if (!Array.isArray(raw) || index < 0 || index >= batch.length) continue
        if (raw.length !== config.dimensions) {
          throw new EmbeddingError(
            `向量维度不匹配：接口返回 ${raw.length} 维，配置为 ${config.dimensions} 维。`
            + '若更换过模型或维度，请用 rag_ingest 重建索引（或换回原配置）。',
            { code: 'DIM_MISMATCH' },
          )
        }
        vectors[index] = raw.map(Number)
      }
      if (vectors.some((v) => !Array.isArray(v) || v.length !== config.dimensions)) {
        throw new EmbeddingError('端点返回的向量条数与输入不一致。', { code: 'BAD_RESPONSE' })
      }
      stats.tokens += Number(body?.usage?.total_tokens ?? 0) || 0
      return { vectors, tokens: Number(body?.usage?.total_tokens ?? 0) || 0 }
    }
    stats.lastError = lastError?.message ?? null
    throw lastError ?? new EmbeddingError('调用失败（未知原因）。', { code: 'UNKNOWN' })
  }

  /**
   * 批量嵌入（自动分批，≤10 条/请求）。
   * @param {string[]} texts - 待嵌入文本（非空）。
   * @returns {Promise<{vectors: number[][], tokens: number, model: string, batches: number}>}
   */
  async function embed(texts) {
    if (!Array.isArray(texts) || texts.length === 0) {
      throw new EmbeddingError('嵌入输入为空。', { code: 'EMPTY_INPUT' })
    }
    const clean = texts.map((text) => String(text ?? '').trim())
    if (clean.some((text) => text === '')) {
      throw new EmbeddingError('嵌入输入包含空文本。', { code: 'EMPTY_INPUT' })
    }
    const vectors = []
    let tokens = 0
    let batches = 0
    for (let i = 0; i < clean.length; i += MAX_BATCH) {
      const batch = clean.slice(i, i + MAX_BATCH)
      stats.calls += 1
      const result = await postBatch(batch)
      batches += 1
      tokens += result.tokens
      vectors.push(...result.vectors)
    }
    return { vectors, tokens, model: config.embeddingModel, batches }
  }

  return {
    embed,
    stats: () => ({ calls: stats.calls, tokens: stats.tokens, lastError: stats.lastError }),
  }
}
