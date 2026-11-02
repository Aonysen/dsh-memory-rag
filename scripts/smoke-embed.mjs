/**
 * 冒烟测试：用真实 Key 调一次 DashScope embeddings，确认鉴权、网络与维度。
 * 不打包进插件（package.json files 未包含 scripts/）。
 *
 * 用法（Key 已写入 ~/.dsh/memories/dsh-qwen-rag/api-key 或环境变量）：
 *   node scripts/smoke-embed.mjs [--base-url https://.../compatible-mode/v1] [--model text-embedding-v4]
 */

import { resolveApiKey, resolveConfig } from '../lib/config.js'
import { createEmbedder } from '../lib/embedder.js'

const args = process.argv.slice(2)
function argOf(flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

const overrides = {}
if (argOf('--base-url')) overrides.baseUrl = argOf('--base-url')
if (argOf('--model')) overrides.embeddingModel = argOf('--model')
if (argOf('--dimensions')) overrides.dimensions = Number(argOf('--dimensions'))

const config = resolveConfig(overrides)
const hit = await resolveApiKey({ get: () => undefined }, config)
if (!hit) {
  console.error(`未找到 DashScope API Key：请设置 ${config.apiKeyEnv}，或写入 ${config.memoryDir}\\api-key`)
  process.exit(2)
}

console.log(`Key 来源：${hit.source}`)
console.log(`接口：${config.baseUrl}/embeddings，模型：${config.embeddingModel}，维度：${config.dimensions}`)

const embedder = createEmbedder(config, async () => hit)
const started = performance.now()
try {
  const result = await embedder.embed([
    '冒烟测试：Qwen RAG 嵌入链路是否可用。',
    '第二条：验证批量输入与维度校验。',
  ])
  const elapsed = Math.round(performance.now() - started)
  console.log(`成功：${result.vectors.length} 条，维度 ${result.vectors[0]?.length}，tokens ${result.tokens}，耗时 ${elapsed}ms`)
  console.log(`首向量前 5 维：${result.vectors[0].slice(0, 5).map((x) => x.toFixed(4)).join(', ')}`)
} catch (error) {
  console.error(`失败：${error?.message ?? error}`)
  process.exit(1)
}
