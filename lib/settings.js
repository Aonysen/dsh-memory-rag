/**
 * dsh-memory-rag — 设置页可编辑配置的持久化层。
 *
 * 设计：
 * - 只持久化「可编辑」键（provider/baseUrl/模型/维度/检索/注入 + 派生出的
 *   apiKeyEnv），其余键唯一来源仍是 cordis 配置（memoryDir、超时等）；
 * - 文件 <memoryDir>/settings.json，原子写；
 * - 读取时容忍损坏/未知值：坏值逐项丢弃并回落到 cordis 配置，不让插件装不上；
 * - 切换 provider 时自动带出该预设的 baseUrl / apiKeyEnv / 默认模型与维度，
 *   但同一请求里显式给出的字段优先；
 * - 修改模型或维度时，若向量库非空则拒绝（防止新旧向量混用算错分）。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PROVIDERS, presetDefaults, providerPreset, validateConfig } from './config.js'

/** 设置页可写的键。 */
export const EDITABLE_KEYS = [
  'provider',
  'baseUrl',
  'embeddingModel',
  'dimensions',
  'topK',
  'minScore',
  'injectIndex',
  'maxInjectChars',
]

/** 持久化到 settings.json 的键（含 provider 派生的 apiKeyEnv）。 */
const PERSIST_KEYS = [...EDITABLE_KEYS, 'apiKeyEnv']

/** 给设置页的 provider 目录（不含任何机密）。 */
export function providerChoices() {
  return Object.entries(PROVIDERS).map(([id, preset]) => ({
    id,
    label: preset.label,
    baseUrl: preset.baseUrl,
    apiKeyEnv: preset.apiKeyEnv,
    keyOptional: preset.keyOptional === true,
    console: preset.console ?? null,
    models: preset.models,
  }))
}

/** 配置文件路径。 */
export function settingsFile(memoryDir) {
  return join(memoryDir, 'settings.json')
}

/**
 * 读取持久化的可编辑设置；损坏或非对象时返回 {}。
 * @param {string} memoryDir - 数据目录。
 * @returns {object}
 */
export function loadStoredSettings(memoryDir) {
  try {
    const raw = readFileSync(settingsFile(memoryDir), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const values = {}
    for (const key of PERSIST_KEYS) {
      if (parsed[key] !== undefined) values[key] = parsed[key]
    }
    return values
  } catch {
    return {}
  }
}

/**
 * 把持久化设置应用到运行时配置上（就地修改）。
 * 非法值逐项丢弃，保证一个坏字段不会让插件整体不可用。
 * @param {object} config - validateConfig 之后的运行时配置。
 * @param {object} stored - loadStoredSettings 的返回值。
 * @returns {string[]} 实际被应用的键。
 */
export function applyStoredSettings(config, stored) {
  const applied = []
  if (stored === null || typeof stored !== 'object') return applied
  for (const key of PERSIST_KEYS) {
    if (stored[key] === undefined) continue
    const candidate = { ...config, [key]: stored[key] }
    try {
      validateConfig(candidate)
    } catch {
      continue
    }
    config[key] = candidate[key]
    applied.push(key)
  }
  return applied
}

/** 原子写 settings.json（只写可持久化键）。 */
export function saveStoredSettings(memoryDir, values) {
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true })
  const payload = {}
  for (const key of PERSIST_KEYS) {
    if (values[key] !== undefined) payload[key] = values[key]
  }
  const file = settingsFile(memoryDir)
  const tmp = `${file}.tmp.${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`)
  renameSync(tmp, file)
}

/** 设置页展示用的快照（不含密钥）。 */
export function editableSnapshot(config) {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    apiKeyEnv: config.apiKeyEnv,
    embeddingModel: config.embeddingModel,
    dimensions: config.dimensions,
    topK: config.topK,
    minScore: config.minScore,
    injectIndex: config.injectIndex !== false,
    maxInjectChars: config.maxInjectChars,
  }
}

/**
 * 应用设置页的补丁。
 * @param {object} config - 运行时配置（就地更新）。
 * @param {object} patch - 请求体，只接受 EDITABLE_KEYS 中的键。
 * @param {{storeCount?: number}} [options] - 当前向量库条数。
 * @returns {{ok: true, changed: string[]} | {ok: false, error: string, status: number}}
 */
export function applySettingsPatch(config, patch, options = {}) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, status: 400, error: '请求体必须是对象' }
  }
  const picked = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (!EDITABLE_KEYS.includes(key)) {
      return { ok: false, status: 400, error: `不可修改的设置项：${key}` }
    }
    picked[key] = value
  }
  if (Object.keys(picked).length === 0) {
    return { ok: false, status: 400, error: '没有要更新的设置项' }
  }

  const candidate = { ...config, ...picked }

  // 切换 provider：未被同一请求显式覆盖的字段用预设补齐。
  if (picked.provider !== undefined && picked.provider !== config.provider) {
    let preset
    try {
      preset = providerPreset(picked.provider)
    } catch (error) {
      return { ok: false, status: 400, error: String(error?.message ?? error) }
    }
    if (picked.baseUrl === undefined) candidate.baseUrl = preset.baseUrl
    candidate.apiKeyEnv = preset.apiKeyEnv
    if (picked.embeddingModel === undefined) {
      const defaults = presetDefaults(picked.provider)
      candidate.embeddingModel = defaults.model
      if (picked.dimensions === undefined) candidate.dimensions = defaults.dimensions
    }
  }

  try {
    validateConfig(candidate)
  } catch (error) {
    return { ok: false, status: 400, error: String(error?.message ?? error) }
  }

  const storeCount = Number(options.storeCount ?? 0)
  const toKeyword = candidate.provider === 'keyword' || candidate.dimensions === 0
  const modelChanged = candidate.embeddingModel !== config.embeddingModel
  const dimChanged = candidate.dimensions !== config.dimensions
  // 切到关键词模式只读文本，不需要清库；从关键词模式切回向量（或换模型/维度）
  // 仍要求清库，避免新旧向量混算。
  if (!toKeyword && (modelChanged || dimChanged) && storeCount > 0) {
    return {
      ok: false,
      status: 409,
      error: `记忆库已有 ${storeCount} 条 ${config.dimensions} 维向量（模型 ${config.embeddingModel}）。`
        + '更换模型或维度需要先清空记忆库并重新导入。',
    }
  }

  const changed = []
  for (const key of PERSIST_KEYS) {
    if (candidate[key] === undefined) continue
    if (config[key] !== candidate[key]) {
      config[key] = candidate[key]
      changed.push(key)
    }
  }
  if (changed.length === 0) return { ok: true, changed }
  saveStoredSettings(config.memoryDir, config)
  return { ok: true, changed }
}
