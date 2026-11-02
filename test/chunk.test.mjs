import test from 'node:test'
import assert from 'node:assert/strict'

import { chunkText, sha256 } from '../lib/chunk.js'

test('短文本保持单块', () => {
  assert.deepEqual(chunkText('一句话。'), ['一句话。'])
})

test('长文本切块且不超硬上限', () => {
  const paragraph = '这是一段用于测试切块行为的文本，'.repeat(60)
  const chunks = chunkText([paragraph, paragraph, paragraph].join('\n\n'), {
    maxChars: 300,
    hardMax: 600,
    overlap: 50,
  })
  assert.ok(chunks.length > 1, '应当切出多块')
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 600, `块超长：${chunk.length}`)
    assert.ok(chunk.trim() !== '')
  }
})

test('相邻块带重叠内容', () => {
  const first = 'ABCDEFGHIJ'.repeat(30)
  const second = 'KLMNOPQRST'.repeat(30)
  const chunks = chunkText(`${first}\n\n${second}`, { maxChars: 200, hardMax: 400, overlap: 40 })
  assert.ok(chunks.length >= 2)
  assert.ok(chunks[0].includes('ABCDEFGHIJ'))
})

test('标题进入块前缀', () => {
  const text = `# 项目约定\n\n${'规则说明。'.repeat(200)}`
  const chunks = chunkText(text, { maxChars: 200, hardMax: 400, overlap: 20 })
  assert.ok(chunks.some((chunk) => chunk.includes('项目约定')))
})

test('空文本返回空数组', () => {
  assert.deepEqual(chunkText('   \n\n '), [])
  assert.deepEqual(chunkText(null), [])
  assert.deepEqual(chunkText(undefined), [])
})

test('sha256 稳定且 64 位十六进制', () => {
  assert.equal(sha256('abc'), sha256('abc'))
  assert.equal(sha256('abc').length, 64)
  assert.notEqual(sha256('abc'), sha256('abd'))
})
