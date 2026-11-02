import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildRulesText, renderIndexText, truncateAtLine } from '../lib/inject.js'
import { resolveConfig } from '../lib/config.js'
import { projectHash } from '../lib/search.js'
import { MemoryStore } from '../lib/store.js'
import { DIM, unit } from './helpers.mjs'

function makeStore(entries = []) {
  const dir = mkdtempSync(join(tmpdir(), 'qwen-rag-inject-'))
  const config = resolveConfig({ memoryDir: dir, dimensions: DIM, maxInjectChars: 1200 })
  const store = new MemoryStore(config.memoryDir, config)
  for (const item of entries) {
    store.add({ text: item.text, hash: item.hash ?? item.text, vector: item.vector ?? unit(0), meta: item.meta })
  }
  return { store, config }
}

test('规则段覆盖检索/写入/引用格式', () => {
  const rules = buildRulesText()
  for (const needle of ['rag_search', 'rag_remember', 'rag_ingest', 'rag_forget', 'rag_stats', '[m_']) {
    assert.ok(rules.includes(needle), `规则段缺少 ${needle}`)
  }
})

test('空库给出引导文案', () => {
  const { store, config } = makeStore()
  const text = renderIndexText(store, config, { cwd: null })
  assert.match(text, /记忆库为空/)
  assert.match(text, /共 0 条/)
})

test('索引包含置顶与全局条目', () => {
  const { store, config } = makeStore([
    { text: '全局偏好：中文回答', meta: { scope: 'global', title: '偏好', pinned: true } },
    { text: '项目约定：提交前跑测试', meta: { scope: 'global', title: '约定' } },
  ])
  const text = renderIndexText(store, config, { cwd: null })
  assert.match(text, /偏好/)
  assert.match(text, /约定/)
  assert.match(text, /共 2 条/)
})

test('项目条目只在该项目会话中出现', () => {
  const cwd = 'C:\\Work\\Demo'
  const { store, config } = makeStore([
    { text: '项目专属：用 pnpm', meta: { scope: 'project:' + projectHash(cwd), title: 'pnpm' } },
  ])
  assert.match(renderIndexText(store, config, { cwd }), /pnpm/)
  assert.doesNotMatch(renderIndexText(store, config, { cwd: 'C:\\Work\\Other' }), /pnpm/)
})

test('注入长度受 maxInjectChars 限制', () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({
    text: `条目 ${i} ${'很长的内容'.repeat(40)}`,
    meta: { scope: 'global', title: `标题 ${i}`, pinned: true },
  }))
  const { store } = makeStore(entries)
  const config = resolveConfig({ memoryDir: store.dir, dimensions: DIM, maxInjectChars: 300 })
  const text = renderIndexText(store, config, { cwd: null })
  assert.ok(text.length <= 300, `注入长度 ${text.length} 超过上限`)
  assert.ok(text.endsWith('…'))
})

test('文件块按文件聚合成一行', () => {
  const { store, config } = makeStore([
    { text: '块一', meta: { scope: 'global', source: 'file', path: '/docs/README.md' } },
    { text: '块二', meta: { scope: 'global', source: 'file', path: '/docs/README.md' } },
    { text: '块三', meta: { scope: 'global', source: 'file', path: '/docs/guide.md' } },
  ])
  const text = renderIndexText(store, config, { cwd: null })
  assert.match(text, /README\.md：2 段/)
  assert.match(text, /guide\.md：1 段/)
  assert.doesNotMatch(text, /块一/)
})

test('子代理只看到置顶条目', () => {
  const { store, config } = makeStore([
    { text: '置顶事实', meta: { scope: 'global', title: '置顶', pinned: true } },
    { text: '普通事实', meta: { scope: 'global', title: '普通' } },
  ])
  const text = renderIndexText(store, config, { cwd: null, isSubagent: true })
  assert.match(text, /置顶/)
  assert.doesNotMatch(text, /普通/)
})

test('超长索引按行截断，不切半行', () => {
  const text = '# 标题\n- 第一行内容\n- 第二行内容\n- 第三行内容\n'
  const truncated = truncateAtLine(text, 24)
  assert.ok(truncated.length <= 24, `长度 ${truncated.length} 超过上限`)
  assert.ok(truncated.endsWith('…'))
  // 结尾必须在完整行边界：去掉省略号后，不以半个词结尾
  const body = truncated.slice(0, -1)
  assert.ok(body.endsWith('\n') || body.endsWith('内容') || body.endsWith('# 标题'), `截断位置异常：${body}`)
  assert.doesNotMatch(body, /第$/)
})
