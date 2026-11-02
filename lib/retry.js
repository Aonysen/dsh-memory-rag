/**
 * dsh-memory-rag — 异步重试小工具。
 *
 * 写锁只在另一个进程持锁的瞬间冲突；工具层用异步退避重试，避免在
 * 事件循环里同步自旋（StoreBusyError 抛得很快，退避在这里完成）。
 */

import { StoreBusyError } from './store.js'

/** 异步等待。 */
export function sleepAsync(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * 执行一次同步写入，遇到 StoreBusyError 时异步退避重试。
 * @template T
 * @param {() => T} run - 同步写入操作。
 * @param {{delays?: number[]}} [options] - 每次重试前的等待毫秒数。
 * @returns {Promise<T>}
 */
export async function writeWithRetry(run, options = {}) {
  const delays = Array.isArray(options.delays) && options.delays.length > 0
    ? options.delays
    : [50, 100, 200, 400, 800, 800]
  for (let attempt = 0; ; attempt += 1) {
    try {
      return run()
    } catch (error) {
      if (!(error instanceof StoreBusyError) || attempt >= delays.length) throw error
      await sleepAsync(delays[attempt])
    }
  }
}
