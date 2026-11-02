/**
 * dsh-memory-rag — 配置解析与 API Key 解析。
 *
 * 设计要点：
 * - 纯 Node，无第三方依赖；宿主以 ESM 加载本插件（type: module）。
 * - 提供商（provider）是一组预设：baseUrl + apiKeyEnv + 模型/维度目录。
 *   任何 OpenAI 兼容的 embeddings 端点都能用；`custom` 允许完全自填。
 * - Key 只在每次请求时读取（支持轮换），来源顺序：
 *     1) 环境变量（默认 DASHSCOPE_API_KEY，随 provider 预设切换）
 *     2) DSH 凭据服务（若宿主提供 ctx.credentials，按同名引用解析）
 *     3) <memoryDir>/api-key 文件（首行为 Key，忽略空行/引号/空白）
 *   Key 值绝不写入日志、工具返回值或配置文件。
 * - 从旧的 dsh-qwen-rag 数据目录自动迁移一次（复制，不删原件）。
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

/** OpenAI 兼容 embeddings 提供商预设。 */
export const PROVIDERS = {
  'qwen-cn': {
    label: '千问 · 国内站（北京）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    console: 'https://bailian.console.aliyun.com/',
    models: {
      'text-embedding-v4': [2048, 1536, 1024, 768, 512, 256, 128, 64],
      'text-embedding-v3': [1024, 768, 512],
    },
  },
  'qwen-intl': {
    label: '千问 · 国际站（新加坡）',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    console: 'https://modelstudio.console.alibabacloud.com/',
    models: {
      'text-embedding-v4': [2048, 1536, 1024, 768, 512, 256, 128, 64],
      'text-embedding-v3': [1024, 768, 512],
    },
  },
  siliconflow: {
    label: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    console: 'https://cloud.siliconflow.cn/',
    models: {
      'BAAI/bge-m3': [1024],
      'BAAI/bge-large-zh-v1.5': [1024],
      'netease-youdao/bce-embedding-base_v1': [768],
    },
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    console: 'https://platform.openai.com/api-keys',
    models: {
      'text-embedding-3-small': [1536, 512],
      'text-embedding-3-large': [3072, 1024, 256],
    },
  },
  ollama: {
    label: '本地 Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    console: 'https://ollama.com/search',
    keyOptional: true,
    models: {
      'nomic-embed-text': [768],
      'bge-m3': [1024],
      'mxbai-embed-large': [1024],
    },
  },
  custom: {
    label: '自定义（任意 OpenAI 兼容端点）',
    baseUrl: 'https://api.example.com/v1',
    apiKeyEnv: 'EMBEDDING_API_KEY',
    keyOptional: true,
    models: {},
  },
  keyword: {
    label: '本地关键词（BM25，无向量、无需 Key）',
    baseUrl: '',
    apiKeyEnv: 'RAG_KEYWORD_NO_KEY',
    keyOptional: true,
    models: {},
  },
}

/** 插件配置默认值。 */
export const DEFAULTS = {
  // 提供商预设 id（见 PROVIDERS）
  provider: 'qwen-cn',
  // 数据目录；null → <dshHome>/memories/dsh-rag-memory
  memoryDir: null,
  // 百炼 / 其他 OpenAI 兼容接口（未显式配置时由 provider 预设填充）
  baseUrl: null,
  embeddingModel: null,
  dimensions: null,
  // Key 环境变量名（未显式配置时由 provider 预设填充）
  apiKeyEnv: null,
  // 检索
  topK: 5,
  minScore: 0.25,
  // 注入
  injectIndex: true,
  maxInjectChars: 1200,
  sectionOrder: 900,
  indexContextOrder: 520,
  // 导入与请求
  maxChunksPerIngest: 500,
  requestTimeoutMs: 20000,
}

/** 旧版插件的数据目录名（迁移用）。 */
export const LEGACY_DIR_NAME = 'dsh-qwen-rag'
/** 默认数据目录名。 */
export const DIR_NAME = 'dsh-rag-memory'

/** DSH 主目录（与 memory-evolve 同口径）。 */
export function dshHome() {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return resolve(env.trim())
  return join(homedir(), '.dsh')
}

function fail(message) {
  throw new Error(`dsh-memory-rag: ${message}`)
}

function checkNumber(config, key, min, max, integer = true) {
  const value = config[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${key} 必须是数字`)
  if (integer && !Number.isInteger(value)) fail(`${key} 必须是整数`)
  if (value < min || value > max) fail(`${key} 必须在 ${min}–${max} 之间`)
}

/** 取 provider 预设（未知 id 抛错）。 */
export function providerPreset(id) {
  const preset = PROVIDERS[id]
  if (preset === undefined) fail(`未知的 provider "${id}"（可选：${Object.keys(PROVIDERS).join(', ')}）`)
  return preset
}

/** provider 预设里的默认模型（第一个）与默认维度。 */
export function presetDefaults(id) {
  const preset = providerPreset(id)
  if (id === 'keyword') return { model: 'bm25', dimensions: 0 }
  const models = Object.keys(preset.models)
  const model = models[0] ?? 'text-embedding-v4'
  const dims = preset.models[model] ?? [1024]
  const preferred = dims.includes(1024) ? 1024 : dims[0]
  return { model, dimensions: preferred }
}

/** 当前配置是否为「纯关键词」模式（不调用嵌入端点）。 */
export function isKeywordProvider(config) {
  return config?.provider === 'keyword'
}

/** provider 是否允许没有 Key（本地 Ollama / 自定义 / 关键词）。 */
export function providerKeyOptional(config) {
  try {
    return providerPreset(config.provider).keyOptional === true
  } catch {
    return false
  }
}

/**
 * 校验并把原始 cordis config 规范化成运行时配置。
 * @param {object} [raw] - cordis.patch.yml 里的 config。
 * @returns {object} 规范化后的配置（memoryDir 已展开为绝对路径）。
 */
export function resolveConfig(raw = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('配置必须是对象')
  for (const key of Object.keys(raw)) {
    if (raw[key] !== undefined && !(key in DEFAULTS)) fail(`未知配置项 "${key}"`)
  }

  const provider = typeof raw.provider === 'string' && raw.provider !== '' ? raw.provider : DEFAULTS.provider
  const preset = providerPreset(provider)
  const fallback = presetDefaults(provider)

  const config = { ...DEFAULTS, ...raw }
  config.provider = provider
  // 未显式给出的值由 provider 预设填充
  if (config.baseUrl === null || config.baseUrl === undefined) config.baseUrl = preset.baseUrl
  if (config.apiKeyEnv === null || config.apiKeyEnv === undefined) config.apiKeyEnv = preset.apiKeyEnv
  if (config.embeddingModel === null || config.embeddingModel === undefined) config.embeddingModel = fallback.model
  if (config.dimensions === null || config.dimensions === undefined) config.dimensions = fallback.dimensions

  validateConfig(config)
  return config
}

/**
 * 校验并就地规范化运行时配置（供 cordis 配置与设置页补丁共用）。
 * @param {object} config - 完整配置对象（含 memoryDir）。
 * @returns {object} 同一个对象（已 trim 字符串并展开 memoryDir）。
 */
export function validateConfig(config) {
  if (typeof config.provider !== 'string' || config.provider === '') fail('provider 必须是非空字符串')
  providerPreset(config.provider)

  if (config.provider === 'keyword') {
    // 纯关键词模式不调用任何端点：固定模型标识，维度为 0（无向量）。
    config.embeddingModel = 'bm25'
    config.dimensions = 0
    config.baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl.trim().replace(/\/+$/, '') : ''
  } else {
    if (typeof config.baseUrl !== 'string' || config.baseUrl.trim() === '') fail('baseUrl 必须是非空字符串')
    let url
    try {
      url = new URL(config.baseUrl.trim())
    } catch {
      fail('baseUrl 不是合法 URL')
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') fail('baseUrl 必须是 http(s) 地址')
    config.baseUrl = config.baseUrl.trim().replace(/\/+$/, '')

    if (typeof config.embeddingModel !== 'string' || config.embeddingModel.trim() === '') {
      fail('embeddingModel 必须是非空字符串')
    }
    config.embeddingModel = config.embeddingModel.trim()
    checkNumber(config, 'dimensions', 8, 8192)
  }

  if (typeof config.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.apiKeyEnv)) {
    fail('apiKeyEnv 必须是合法的环境变量名')
  }

  checkNumber(config, 'topK', 1, 50)
  checkNumber(config, 'maxInjectChars', 200, 20000)
  checkNumber(config, 'maxChunksPerIngest', 1, 5000)
  checkNumber(config, 'requestTimeoutMs', 1000, 120000)
  if (typeof config.minScore !== 'number' || !Number.isFinite(config.minScore)
    || config.minScore < 0 || config.minScore > 1) {
    fail('minScore 必须在 0–1 之间')
  }
  if (typeof config.injectIndex !== 'boolean') fail('injectIndex 必须是布尔值')
  if (typeof config.sectionOrder !== 'number' || !Number.isFinite(config.sectionOrder)) {
    fail('sectionOrder 必须是有限数字')
  }
  if (typeof config.indexContextOrder !== 'number' || !Number.isFinite(config.indexContextOrder)) {
    fail('indexContextOrder 必须是有限数字')
  }

  config.memoryDir = resolveMemoryDir(config.memoryDir)
  return config
}

/** 展开 `~` / 相对路径；缺省落在 <dshHome>/memories/dsh-rag-memory。 */
export function resolveMemoryDir(value) {
  if (value === null || value === undefined || value === '') {
    return join(dshHome(), 'memories', DIR_NAME)
  }
  if (typeof value !== 'string') fail('memoryDir 必须是字符串或 null')
  let dir = value.trim()
  if (dir === '~') dir = homedir()
  else if (dir.startsWith('~/') || dir.startsWith('~\\')) dir = join(homedir(), dir.slice(2))
  return isAbsolute(dir) ? resolve(dir) : resolve(dir)
}

/**
 * 从旧插件目录（dsh-qwen-rag）复制数据到新目录，只做一次。
 * 只在「使用默认目录且新目录还没有索引」时执行；原文件保留作为备份。
 * @param {object} config - 已规范化的配置。
 * @returns {string[]} 实际复制的文件名。
 */
export function migrateLegacyData(config) {
  const defaultDir = join(dshHome(), 'memories', DIR_NAME)
  if (config.memoryDir !== defaultDir) return []
  if (existsSync(join(defaultDir, 'index.jsonl'))) return []
  const legacy = join(dshHome(), 'memories', LEGACY_DIR_NAME)
  if (!existsSync(legacy)) return []
  const files = ['index.jsonl', 'meta.json', 'settings.json', 'api-key']
  const copied = []
  try {
    mkdirSync(config.memoryDir, { recursive: true })
    for (const file of files) {
      const source = join(legacy, file)
      if (!existsSync(source)) continue
      copyFileSync(source, join(config.memoryDir, file))
      copied.push(file)
    }
  } catch {
    return []
  }
  return copied
}

/**
 * 读取 <memoryDir>/api-key（不存在/为空返回 null）。
 * 文件里允许有引号、空白与结尾换行。
 * @param {string} memoryDir - 数据目录。
 * @returns {string|null} 去掉包裹字符后的 Key。
 */
export function readKeyFile(memoryDir) {
  let raw
  try {
    raw = readFileSync(join(memoryDir, 'api-key'), 'utf8')
  } catch {
    return null
  }
  let value = raw.trim()
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1).trim()
    }
  }
  return value === '' ? null : value
}

/**
 * 解析当前可用的 Key（每次调用实时读取）。
 * @param {object} ctx - 插件上下文（用于可选读取 credentials 服务）。
 * @param {object} config - 已规范化的配置。
 * @returns {Promise<{key: string, source: string}|null>} null = 未配置。
 */
export async function resolveApiKey(ctx, config) {
  const envName = config.apiKeyEnv
  const fromEnv = process.env[envName]
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return { key: fromEnv.trim(), source: `env:${envName}` }
  }

  const credentials = typeof ctx?.get === 'function' ? ctx.get('credentials') : undefined
  if (credentials && typeof credentials.resolve === 'function') {
    try {
      const hit = await credentials.resolve(envName)
      const value = hit && typeof hit.value === 'string' ? hit.value.trim() : ''
      if (value !== '') return { key: value, source: `credentials:${envName}` }
    } catch {
      // 凭据服务不可用或引用语法不匹配 → 静默降级到文件
    }
  }

  const fileKey = readKeyFile(config.memoryDir)
  if (fileKey !== null) return { key: fileKey, source: 'file:api-key' }
  return null
}
