import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, inject, name } from '../index.js'
import { DIM } from './helpers.mjs'

test('插件入口导出与装配', () => {
  assert.equal(name, 'dsh-memory-rag')
  assert.deepEqual(inject, ['tools', 'systemPrompt'])
})

test('apply 注册工具、规则段与会话索引', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rag-memory-apply-'))
  const tools = []
  const sections = []
  const contexts = []
  const effects = []

  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    get: () => undefined,
    effect(fn, label) {
      effects.push(label)
      return fn()
    },
    tools: {
      register(definition) {
        tools.push(definition)
        return () => {}
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => {}
      },
      context(contribution) {
        contexts.push(contribution)
        return () => {}
      },
    },
  }

  apply(ctx, { memoryDir: dir, dimensions: DIM })

  assert.deepEqual(tools.map((definition) => definition.name).sort(), [
    'rag_forget', 'rag_ingest', 'rag_remember', 'rag_search', 'rag_stats',
  ])
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'rag-memory:rules')
  assert.equal(typeof sections[0].text, 'string')

  assert.equal(contexts.length, 1)
  assert.equal(contexts[0].name, 'rag-memory:index')
  const text = contexts[0].text({ agent: { session: { id: 's1', header: { cwd: null } } } })
  assert.match(text, /记忆库为空/)

  assert.ok(effects.length >= 2)
})
