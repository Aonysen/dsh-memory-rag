import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  PROVIDERS,
  dshHome,
  migrateLegacyData,
  presetDefaults,
  readKeyFile,
  resolveApiKey,
  resolveConfig,
  resolveMemoryDir,
} from '../lib/config.js'

test('默认配置带提供商预设', () => {
  const config = resolveConfig({})
  assert.equal(config.provider, 'qwen-cn')
  assert.equal(config.baseUrl, PROVIDERS['qwen-cn'].baseUrl)
  assert.equal(config.apiKeyEnv, 'DASHSCOPE_API_KEY')
  assert.equal(config.embeddingModel, 'text-embedding-v4')
  assert.equal(config.dimensions, 1024)
  assert.ok(config.memoryDir.endsWith(join('memories', 'dsh-rag-memory')))
  assert.equal(config.lockWaitMs, 100)
  assert.equal(config.ingestOutsideCwd, 'warn')
  assert.equal(config.keyStorage, 'auto')
  assert.equal(config.largeStoreWarning, 20000)
  assert.ok(config.ingestDeny.includes('~/.ssh'))
  assert.deepEqual(config.ingestRoots, [])
})

test('并发与安全配置的校验', () => {
  assert.equal(resolveConfig({ lockWaitMs: 0 }).lockWaitMs, 0)
  assert.throws(() => resolveConfig({ lockWaitMs: 5000 }), /lockWaitMs/)
  assert.throws(() => resolveConfig({ ingestOutsideCwd: 'sometimes' }), /ingestOutsideCwd/)
  assert.throws(() => resolveConfig({ keyStorage: 'vault' }), /keyStorage/)
  assert.throws(() => resolveConfig({ ingestDeny: 'x' }), /ingestDeny/)
  assert.throws(() => resolveConfig({ ingestRoots: [1] }), /ingestRoots/)
})

test('切换 provider 自动带出端点/模型/维度', () => {
  const openai = resolveConfig({ provider: 'openai' })
  assert.equal(openai.baseUrl, 'https://api.openai.com/v1')
  assert.equal(openai.embeddingModel, 'text-embedding-3-small')
  assert.equal(openai.dimensions, 1536)
  assert.equal(openai.apiKeyEnv, 'OPENAI_API_KEY')

  const ollama = resolveConfig({ provider: 'ollama' })
  assert.equal(ollama.baseUrl, 'http://127.0.0.1:11434/v1')
  assert.equal(ollama.embeddingModel, 'nomic-embed-text')
})

test('显式配置优先于 provider 预设', () => {
  const config = resolveConfig({ provider: 'openai', baseUrl: 'https://proxy.example/v1', dimensions: 512 })
  assert.equal(config.baseUrl, 'https://proxy.example/v1')
  assert.equal(config.dimensions, 512)
})

test('未知配置项与未知 provider 报错', () => {
  assert.throws(() => resolveConfig({ unknownKey: 1 }), /未知配置项/)
  assert.throws(() => resolveConfig({ provider: 'nope' }), /未知的 provider/)
})

test('非法数值报错', () => {
  assert.throws(() => resolveConfig({ dimensions: 4 }), /dimensions/)
  assert.throws(() => resolveConfig({ topK: 0 }), /topK/)
  assert.throws(() => resolveConfig({ minScore: 2 }), /minScore/)
  assert.throws(() => resolveConfig({ baseUrl: 'ftp://x' }), /http/)
  assert.throws(() => resolveConfig({ apiKeyEnv: '1BAD' }), /apiKeyEnv/)
})

test('baseUrl 去掉尾部斜杠', () => {
  const config = resolveConfig({ baseUrl: 'https://example.com/v1///' })
  assert.equal(config.baseUrl, 'https://example.com/v1')
})

test('memoryDir 展开 ~ 与相对路径', () => {
  assert.ok(resolveMemoryDir('~/rag-memory').startsWith(homedir()))
  assert.ok(resolveMemoryDir('./relative').length > 0)
})

test('presetDefaults 给出默认模型与 1024 优先维度', () => {
  assert.deepEqual(presetDefaults('qwen-cn'), { model: 'text-embedding-v4', dimensions: 1024 })
  assert.deepEqual(presetDefaults('openai'), { model: 'text-embedding-3-small', dimensions: 1536 })
})

test('api-key 文件读取并去掉引号', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rag-memory-key-'))
  writeFileSync(join(dir, 'api-key'), '  "sk-test-123"\n', 'utf8')
  assert.equal(readKeyFile(dir), 'sk-test-123')

  const config = resolveConfig({ memoryDir: dir, provider: 'custom' })
  const hit = await resolveApiKey({ get: () => undefined }, config)
  assert.deepEqual(hit, { key: 'sk-test-123', source: 'file:api-key' })
})

test('没有 Key 时返回 null', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rag-memory-nokey-'))
  const config = resolveConfig({ memoryDir: dir, provider: 'custom', apiKeyEnv: 'RAG_MEMORY_TEST_MISSING_ENV' })
  assert.equal(await resolveApiKey({ get: () => undefined }, config), null)
})

test('从旧目录迁移数据（只复制默认目录）', () => {
  const home = mkdtempSync(join(tmpdir(), 'rag-memory-home-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    assert.equal(dshHome(), home)
    const legacy = join(home, 'memories', 'dsh-qwen-rag')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, 'index.jsonl'), '{"t":"add"}\n', 'utf8')
    writeFileSync(join(legacy, 'api-key'), 'sk-legacy', 'utf8')

    const config = resolveConfig({})
    assert.equal(config.memoryDir, join(home, 'memories', 'dsh-rag-memory'))
    const copied = migrateLegacyData(config)
    assert.deepEqual(copied.sort(), ['api-key', 'index.jsonl'])
    assert.equal(existsSync(join(config.memoryDir, 'api-key')), true)

    // 幂等：已有索引后不再复制
    assert.deepEqual(migrateLegacyData(config), [])

    // 自定义目录不迁移
    const custom = resolveConfig({ memoryDir: mkdtempSync(join(tmpdir(), 'rag-memory-custom-')) })
    assert.deepEqual(migrateLegacyData(custom), [])
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
