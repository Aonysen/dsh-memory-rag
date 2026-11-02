import test from 'node:test'
import assert from 'node:assert/strict'

import { StoreBusyError } from '../lib/store.js'
import { writeWithRetry } from '../lib/retry.js'

test('非 StoreBusyError 直接抛出', async () => {
  await assert.rejects(
    () => writeWithRetry(() => { throw new Error('boom') }, { delays: [1] }),
    /boom/,
  )
})

test('StoreBusyError 在预算内重试后成功', async () => {
  let attempts = 0
  const result = await writeWithRetry(() => {
    attempts += 1
    if (attempts < 3) throw new StoreBusyError()
    return 'ok'
  }, { delays: [1, 1, 1] })
  assert.equal(result, 'ok')
  assert.equal(attempts, 3)
})

test('重试耗尽后抛出 StoreBusyError', async () => {
  await assert.rejects(
    () => writeWithRetry(() => { throw new StoreBusyError() }, { delays: [1, 1] }),
    (error) => error instanceof StoreBusyError,
  )
})
