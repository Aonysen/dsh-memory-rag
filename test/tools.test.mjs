import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveConfig } from '../lib/config.js'
import { MemoryStore } from '../lib/store.js'
import { installTools } from '../lib/tools.js'
import { DIM, unit } from './helpers.mjs'

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'qwen-rag-tools-'))
  const config = resolveConfig({
    memoryDir: dir,
    dimensions: DIM,
    minScore: 0.1,
    apiKeyEnv: 'QWEN_RAG_TEST_MISSING_ENV',
  })
  const store = new MemoryStore(config.memoryDir, config)
  const defs = []
  const ctx = {
    tools: {
      register(definition) {
        defs.push(definition)
        return () => {}
      },
    },
  }
  const embedder = {
    embed: async (texts) => ({
      vectors: texts.map(() => unit(0)),
      tokens: texts.length,
      model: 'fake',
      batches: 1,
    }),
    stats: () => ({ calls: 1, tokens: 1, lastError: null }),
  }
  installTools(ctx, config, store, embedder)
  const tool = (name) => {
    const found = defs.find((definition) => definition.name === name)
    assert.ok(found, `缺少工具 ${name}`)
    return found
  }
  return { defs, store, tool, config }
}

test('注册五个工具且输出 schema 固定', () => {
  const { defs } = setup()
  assert.deepEqual(
    defs.map((definition) => definition.name).sort(),
    ['rag_forget', 'rag_ingest', 'rag_remember', 'rag_search', 'rag_stats'],
  )
  for (const definition of defs) {
    assert.deepEqual(definition.output.schema.required, ['ok', 'message', 'count'])
    assert.equal(definition.output.schema.additionalProperties, false)
  }
})

test('写入后检索可命中，重复写入被去重', async () => {
  const { tool } = setup()
  const saved = await tool('rag_remember').execute({ text: '用户偏好中文回答' }, {})
  assert.equal(saved.ok, true)
  assert.equal(saved.count, 1)
  assert.match(saved.message, /已写入记忆 m_/)

  const duplicate = await tool('rag_remember').execute({ text: '用户偏好中文回答' }, {})
  assert.equal(duplicate.count, 0)
  assert.match(duplicate.message, /已存在/)

  const hit = await tool('rag_search').execute({ query: '中文' }, {})
  assert.equal(hit.ok, true)
  assert.equal(hit.count, 1)
  assert.match(hit.message, /命中 1 条/)
})

test('空库检索给出引导', async () => {
  const { tool } = setup()
  const result = await tool('rag_search').execute({ query: '任意' }, {})
  assert.equal(result.count, 0)
  assert.match(result.message, /记忆库为空/)
})

test('参数校验', async () => {
  const { tool } = setup()
  assert.equal((await tool('rag_search').execute({ query: '  ' }, {})).ok, false)
  assert.equal((await tool('rag_remember').execute({ text: 'a' }, {})).ok, false)
  assert.equal((await tool('rag_forget').execute({ id: 'nope' }, {})).ok, false)
})

test('rag_stats 报告条数与 Key 状态', async () => {
  const { tool } = setup()
  await tool('rag_remember').execute({ text: '统计测试' }, {})
  const result = await tool('rag_stats').execute({}, {})
  assert.match(result.message, /1 条/)
  assert.match(result.message, /Key：未配置/)
})

test('rag_forget 删除后检索不到', async () => {
  const { tool } = setup()
  const saved = await tool('rag_remember').execute({ text: '待删除条目' }, {})
  const id = saved.message.match(/m_[a-z0-9_]+/)[0]
  const removed = await tool('rag_forget').execute({ id }, {})
  assert.equal(removed.ok, true)
  const hit = await tool('rag_search').execute({ query: '删除' }, {})
  assert.equal(hit.count, 0)
})

test('导入目录把文件切块入库并跳过非文档', async () => {
  const { tool } = setup()
  const root = mkdtempSync(join(tmpdir(), 'qwen-rag-doc-'))
  writeFileSync(join(root, 'a.md'), `# 约定\n\n${'规则内容。'.repeat(100)}`, 'utf8')
  writeFileSync(join(root, 'image.png'), 'not a doc', 'utf8')

  const result = await tool('rag_ingest').execute({ path: root }, {})
  assert.equal(result.ok, true)
  assert.match(result.message, /写入 [1-9]\d* 段/)

  const again = await tool('rag_ingest').execute({ path: root }, {})
  assert.equal(again.count, 0)
  assert.match(again.message, /没有新内容/)
})

test('关键词模式：无 Key、不调用嵌入也能写入与检索', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rag-memory-keyword-'))
  const config = resolveConfig({ memoryDir: dir, provider: 'keyword' })
  const store = new MemoryStore(config.memoryDir, config)
  const defs = []
  const ctx = {
    tools: {
      register(definition) {
        defs.push(definition)
        return () => {}
      },
    },
  }
  const embedder = {
    embed: async () => {
      throw new Error('关键词模式不应调用嵌入端点')
    },
    stats: () => ({ calls: 0, tokens: 0, lastError: null }),
  }
  installTools(ctx, config, store, embedder)
  const tool = (name) => defs.find((definition) => definition.name === name)

  const saved = await tool('rag_remember').execute({ text: '小明下周三去杭州出差' }, {})
  assert.equal(saved.ok, true)
  assert.match(saved.message, /BM25/)

  const hit = await tool('rag_search').execute({ query: '杭州出差' }, {})
  assert.equal(hit.ok, true)
  assert.equal(hit.count, 1)
  assert.match(hit.message, /BM25/)

  const root = mkdtempSync(join(tmpdir(), 'rag-memory-keyword-doc-'))
  writeFileSync(join(root, 'doc.md'), '# 约定\n\n发布前必须跑单元测试。', 'utf8')
  const ingested = await tool('rag_ingest').execute({ path: root }, {})
  assert.equal(ingested.ok, true)
  assert.match(ingested.message, /无向量/)

  const stats = await tool('rag_stats').execute({}, {})
  assert.match(stats.message, /无需 Key/)
  assert.match(stats.message, /BM25/)
})

test('rag_ingest 默认拒绝敏感目录', async () => {
  const { tool } = setup()
  const denied = join(homedir(), '.ssh', 'id_ed25519.txt')
  const result = await tool('rag_ingest').execute({ path: denied }, {})
  assert.equal(result.ok, false)
  assert.match(result.message, /禁止导入/)
})

test('rag_ingest 对工作目录之外的路径给出警告', async () => {
  const { tool } = setup()
  const root = mkdtempSync(join(tmpdir(), 'rag-memory-outside-'))
  writeFileSync(join(root, 'a.md'), '# 标题\n\n内容。', 'utf8')
  const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
  const result = await tool('rag_ingest').execute({ path: root }, exec)
  assert.equal(result.ok, true)
  assert.match(result.message, /工作目录之外/)
})

test('ingestOutsideCwd=deny 时拒绝工作目录之外的路径', async () => {
  const { tool, config } = setup()
  config.ingestOutsideCwd = 'deny'
  const root = mkdtempSync(join(tmpdir(), 'rag-memory-outside-deny-'))
  writeFileSync(join(root, 'a.md'), '# 标题\n\n内容。', 'utf8')
  const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
  const result = await tool('rag_ingest').execute({ path: root }, exec)
  assert.equal(result.ok, false)
  assert.match(result.message, /工作目录之外/)
})
