/**
 * dsh-memory-rag — 插件入口。
 *
 * 宿主以 `apply(ctx, config)` 挂载；`inject` 声明依赖的服务，缺任何一个
 * 宿主不会激活本插件（而不是运行期抛错）。
 *
 * 配置优先级：内置默认值 ← provider 预设 ← cordis 配置（cordis.patch.yml）
 * ← 设置页保存的 <memoryDir>/settings.json。设置页改动只写后者。
 *
 * 生命周期：所有注册都包在 ctx.effect 里，插件卸载时自动注销工具、提示词
 * 贡献与 HTTP 路由；索引是派生数据（可随时从 index.jsonl 重建）。
 */

import { installApi } from './lib/api.js'
import {
  migrateLegacyData, resolveApiKey, resolveConfig,
} from './lib/config.js'
import { createEmbedder } from './lib/embedder.js'
import { installInjection } from './lib/inject.js'
import { applyStoredSettings, loadStoredSettings } from './lib/settings.js'
import { MemoryStore } from './lib/store.js'
import { installTools } from './lib/tools.js'

export const name = 'dsh-memory-rag'

/** 必需服务：工具注册表与系统提示词注册表。 */
export const inject = ['tools', 'systemPrompt']

/**
 * @param {object} ctx - 插件上下文。
 * @param {object} [rawConfig] - cordis.patch.yml 的 config。
 */
export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)
  const logger = typeof ctx.logger === 'function' ? (ctx.logger('rag-memory') ?? console) : (ctx.logger ?? console)

  // 从旧插件目录复制一次数据（仅默认目录；原件保留作备份）
  try {
    const copied = migrateLegacyData(config)
    if (copied.length > 0) logger?.info?.(`[rag-memory] 已从 dsh-qwen-rag 迁移：${copied.join(', ')}`)
  } catch (error) {
    logger?.warn?.(`[rag-memory] 旧数据迁移失败：${error?.message ?? error}`)
  }

  // 设置页保存的值覆盖 cordis 配置（坏值逐项丢弃，不让插件装不上）。
  try {
    const applied = applyStoredSettings(config, loadStoredSettings(config.memoryDir))
    if (applied.length > 0) logger?.info?.(`[rag-memory] 已应用设置页配置：${applied.join(', ')}`)
  } catch (error) {
    logger?.warn?.(`[rag-memory] 读取 settings.json 失败，使用 cordis 配置：${error?.message ?? error}`)
  }

  const store = new MemoryStore(config.memoryDir, config)
  const embedder = createEmbedder(config, () => resolveApiKey(ctx, config))

  // 启动时预热索引：坏行/模型变更不应阻止插件装配（工具调用时会再报具体原因）
  try {
    store.load()
  } catch (error) {
    logger?.warn?.(`[rag-memory] 索引加载失败：${error?.message ?? error}`)
  }

  ctx.effect(
    () => installTools(ctx, config, store, embedder),
    'dsh-memory-rag: tools',
  )
  installInjection(ctx, config, store)

  // 设置页数据面（无 webServer 的部署自动跳过）
  try {
    installApi(ctx, config, store, embedder, logger)
  } catch (error) {
    logger?.warn?.(`[rag-memory] 设置 API 未注册：${error?.message ?? error}`)
  }

  logger?.info?.(
    `[rag-memory] 已启用：${config.provider} / ${config.embeddingModel} / ${config.dimensions} 维 → ${config.memoryDir}`,
  )
}
