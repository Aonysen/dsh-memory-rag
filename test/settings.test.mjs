import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveConfig } from '../lib/config.js'
import {
  applySettingsPatch,
  applyStoredSettings,
  editableSnapshot,
  loadStoredSettings,
  providerChoices,
  saveStoredSettings,
  settingsFile,
} from '../lib/settings.js'
import { DIM } from './helpers.mjs'

function makeConfig(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rag-memory-settings-'))
  return resolveConfig({ memoryDir: dir, dimensions: DIM, apiKeyEnv: 'RAG_MEMORY_TEST_MISSING_ENV', ...extra })
}

test('提供商目录完整', () => {
  const choices = providerChoices()
  assert.equal(choices.length, 7)
  for (const choice of choices) {
    assert.equal(typeof choice.id, 'string')
    assert.equal(typeof choice.label, 'string')
    assert.equal(typeof choice.baseUrl, 'string')
    assert.equal(typeof choice.models, 'object')
  }
})

test('设置持久化往返', () => {
  const config = makeConfig()
  const result = applySettingsPatch(config, { baseUrl: 'https://proxy.example/v1', topK: 8 }, { storeCount: 0 })
  assert.equal(result.ok, true)
  assert.deepEqual(result.changed.sort(), ['baseUrl', 'topK'])
  assert.equal(config.topK, 8)

  const stored = loadStoredSettings(config.memoryDir)
  assert.equal(stored.topK, 8)

  const other = makeConfig()
  applyStoredSettings(other, stored)
  assert.equal(other.topK, 8)
  assert.equal(other.baseUrl, 'https://proxy.example/v1')
})

test('切换 provider 带出预设并持久化 apiKeyEnv', () => {
  const config = makeConfig()
  const result = applySettingsPatch(config, { provider: 'openai' }, { storeCount: 0 })
  assert.equal(result.ok, true)
  assert.equal(config.provider, 'openai')
  assert.equal(config.baseUrl, 'https://api.openai.com/v1')
  assert.equal(config.embeddingModel, 'text-embedding-3-small')
  assert.equal(config.dimensions, 1536)
  assert.equal(config.apiKeyEnv, 'OPENAI_API_KEY')

  const stored = loadStoredSettings(config.memoryDir)
  assert.equal(stored.provider, 'openai')
  assert.equal(stored.apiKeyEnv, 'OPENAI_API_KEY')
})

test('未知键与非法值被拒绝', () => {
  const config = makeConfig()
  assert.equal(applySettingsPatch(config, { memoryDir: '/tmp/x' }).ok, false)
  assert.equal(applySettingsPatch(config, { dimensions: 4 }).ok, false)
  assert.equal(applySettingsPatch(config, { baseUrl: 'ftp://x' }).ok, false)
  assert.equal(applySettingsPatch(config, { provider: 'nope' }).ok, false)
  assert.equal(applySettingsPatch(config, {}).ok, false)
})

test('记忆库非空时拒绝换模型或维度', () => {
  const config = makeConfig()
  const blocked = applySettingsPatch(config, { embeddingModel: 'text-embedding-v3' }, { storeCount: 3 })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.status, 409)
  assert.equal(config.embeddingModel, 'text-embedding-v4')

  const providerBlocked = applySettingsPatch(config, { provider: 'openai' }, { storeCount: 3 })
  assert.equal(providerBlocked.status, 409)

  const allowed = applySettingsPatch(config, { topK: 3 }, { storeCount: 3 })
  assert.equal(allowed.ok, true)
})

test('切到关键词模式不需要清库，切回向量仍被拦截', () => {
  const config = makeConfig()
  const toKeyword = applySettingsPatch(config, { provider: 'keyword' }, { storeCount: 5 })
  assert.equal(toKeyword.ok, true)
  assert.equal(config.provider, 'keyword')
  assert.equal(config.embeddingModel, 'bm25')
  assert.equal(config.dimensions, 0)

  const back = applySettingsPatch(config, { provider: 'qwen-cn' }, { storeCount: 5 })
  assert.equal(back.ok, false)
  assert.equal(back.status, 409)
})

test('坏值不会让存储的其它字段失效', () => {
  const config = makeConfig()
  writeFileSync(settingsFile(config.memoryDir), JSON.stringify({ topK: 7, dimensions: 3, injectIndex: false }), 'utf8')
  const stored = loadStoredSettings(config.memoryDir)
  applyStoredSettings(config, stored)
  assert.equal(config.topK, 7)
  assert.equal(config.injectIndex, false)
  assert.notEqual(config.dimensions, 3)
})

test('损坏的 settings.json 返回空对象', () => {
  const config = makeConfig()
  writeFileSync(settingsFile(config.memoryDir), '{ not json', 'utf8')
  assert.deepEqual(loadStoredSettings(config.memoryDir), {})
})

test('保存时只写可持久化键', () => {
  const config = makeConfig()
  saveStoredSettings(config.memoryDir, { ...config, memoryDir: '/should/not/persist', topK: 9 })
  const raw = JSON.parse(readFileSync(settingsFile(config.memoryDir), 'utf8'))
  assert.equal(raw.topK, 9)
  assert.equal(raw.memoryDir, undefined)
  assert.equal(raw.apiKeyEnv, config.apiKeyEnv)
})

test('快照包含 provider 与注入开关', () => {
  const config = makeConfig()
  const snapshot = editableSnapshot(config)
  assert.equal(snapshot.provider, 'qwen-cn')
  assert.equal(snapshot.injectIndex, true)
  assert.equal(snapshot.dimensions, DIM)
})
