/**
 * dsh-memory-rag — 「记忆洞察」页面数据（一级侧栏面板）。
 *
 * 全部指标都由本地数据推导（条目时间戳 / scope / 标签 / 文件大小），
 * 不联网、不依赖额外埋点文件，因此历史数据安装后立刻可见。
 */

import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

function fileSize(path) {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function dayKey(ts) {
  const date = new Date(ts)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function startOfDay(offsetDays) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - offsetDays)
  return date
}

function preview(text, max = 120) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/**
 * 构建洞察页快照。
 * @param {object} config - 规范化配置。
 * @param {object} store - MemoryStore。
 * @param {object} embedder - createEmbedder 返回值（只取进程用量）。
 * @param {{days?: number}} [options]
 * @returns {object}
 */
export function buildDashboard(config, store, embedder, options = {}) {
  const days = [7, 30, 90].includes(Number(options.days)) ? Number(options.days) : 30
  let entries = []
  let loadError = null
  try {
    entries = store.list()
  } catch (error) {
    loadError = String(error?.message ?? error)
  }

  const now = Date.now()
  let notes = 0
  let files = 0
  let project = 0
  let global = 0
  let pinned = 0
  let charsTotal = 0
  const tagCounts = new Map()
  const fileGroups = new Map()
  const dayCounts = new Map()
  const recent = []

  for (const entry of entries) {
    const isFile = entry.meta?.source === 'file'
    if (isFile) {
      files += 1
      const path = entry.meta?.path
      if (typeof path === 'string') {
        const group = fileGroups.get(path) ?? { path, count: 0 }
        group.count += 1
        fileGroups.set(path, group)
      }
    } else {
      notes += 1
    }
    if (typeof entry.meta?.scope === 'string' && entry.meta.scope.startsWith('project:')) project += 1
    else global += 1
    if (entry.meta?.pinned === true) pinned += 1
    const length = typeof entry.text === 'string' ? entry.text.length : 0
    charsTotal += length
    for (const tag of Array.isArray(entry.meta?.tags) ? entry.meta.tags : []) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
    const created = Date.parse(entry.meta?.createdAt ?? '')
    if (Number.isFinite(created)) {
      const key = dayKey(created)
      const bucket = dayCounts.get(key) ?? { count: 0, chars: 0 }
      bucket.count += 1
      bucket.chars += length
      dayCounts.set(key, bucket)
    }
    recent.push({
      id: entry.id,
      title: entry.meta?.title ?? preview(entry.text, 60),
      scope: entry.meta?.scope ?? 'global',
      source: entry.meta?.source ?? 'note',
      pinned: entry.meta?.pinned === true,
      createdAt: entry.meta?.createdAt ?? null,
      preview: preview(entry.text, 160),
    })
  }

  const daily = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = startOfDay(offset)
    const key = dayKey(date.getTime())
    const bucket = dayCounts.get(key) ?? { count: 0, chars: 0 }
    daily.push({ date: key, count: bucket.count, chars: bucket.chars })
  }

  const heatmap = []
  for (let offset = 55; offset >= 0; offset -= 1) {
    const date = startOfDay(offset)
    const key = dayKey(date.getTime())
    heatmap.push({ date: key, count: (dayCounts.get(key) ?? { count: 0 }).count })
  }

  recent.sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0))

  const tags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag, count]) => ({ tag, count }))

  const topFiles = [...fileGroups.values()].sort((a, b) => b.count - a.count).slice(0, 5)

  const indexBytes = fileSize(store.indexFile)
  const metaBytes = fileSize(store.metaFile)
  const settingsBytes = fileSize(join(store.dir, 'settings.json'))
  const keyBytes = fileSize(join(store.dir, 'api-key'))

  return {
    ok: true,
    days,
    generatedAt: new Date(now).toISOString(),
    mode: config.provider === 'keyword' ? 'keyword' : (config.provider === 'ollama' || config.provider === 'custom' ? 'local' : 'cloud'),
    provider: config.provider,
    model: config.embeddingModel,
    dimensions: config.dimensions,
    loadError,
    overview: {
      entries: entries.length,
      notes,
      files,
      project,
      global,
      pinned,
      chars: charsTotal,
      fileGroups: fileGroups.size,
    },
    composition: [
      { id: 'notes', label: '笔记', count: notes },
      { id: 'files', label: '文档块', count: files },
    ],
    scope: [
      { id: 'project', label: '项目', count: project },
      { id: 'global', label: '全局', count: global },
    ],
    daily,
    heatmap,
    tags,
    topFiles,
    recent: recent.slice(0, 10),
    storage: {
      indexBytes,
      metaBytes,
      settingsBytes,
      keyBytes,
      totalBytes: indexBytes + metaBytes + settingsBytes + keyBytes,
      dir: store.dir,
    },
    usage: embedder.stats(),
    launcher: {
      lockHeld: existsSync(store.lockFile),
      revision: store.revision,
      updatedAt: store.updatedAt,
    },
  }
}
