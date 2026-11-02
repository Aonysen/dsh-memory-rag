/**
 * dsh-memory-rag — 系统提示词贡献。
 *
 * 两段：
 * 1) 静态规则段（ctx.systemPrompt.section）：记忆的唯一入口、检索/写入时机、
 *    引用格式。文本固定 → 前缀稳定、零网络开销。
 * 2) 会话索引段（ctx.systemPrompt.context）：从本地索引元数据渲染「置顶 +
 *    当前项目近期 + 文件聚合」，按 session 缓存、revision 变化才重建。不调用
 *    嵌入，不阻塞请求组装。
 */

import { projectHash } from './search.js'

/** 固定规则段文案。 */
export function buildRulesText() {
  return [
    '## 记忆（RAG）',
    '长期记忆由本地向量库承载，工具是唯一入口：',
    '- 检索：调用 `rag_search`（自然语言查询，返回带 id 的片段）。需要历史偏好、既往决策、项目约定时先检索，不要凭印象回答。',
    '- 写入：把可复用且有长期价值的事实用 `rag_remember` 写入（一句话一条；scope=auto 会在项目目录下写为项目记忆，否则写为全局记忆）。',
    '- 导入：需要把已有文档纳入记忆时用 `rag_ingest`（只读 .md/.mdx/.txt）。',
    '- 过时条目用 `rag_forget` 删除；不确定库内容时用 `rag_stats` 查看。',
    '引用检索结果时标注条目 id，例如 `[m_xxx]`。',
  ].join('\n')
}

function formatDate(iso) {
  if (typeof iso !== 'string' || iso === '') return ''
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ''
  const date = new Date(time)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function scopeLabel(scope) {
  return typeof scope === 'string' && scope.startsWith('project:') ? '项目' : '全局'
}

function oneLine(text, max) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/**
 * 渲染会话索引（纯函数，便于单测）。
 * @param {object} store - MemoryStore。
 * @param {object} config - 规范化配置。
 * @param {{cwd?: string|null, isSubagent?: boolean}} [session]
 * @returns {string}
 */
export function renderIndexText(store, config, session = {}) {
  const stats = store.stats()
  const lines = []
  lines.push(`## RAG 记忆索引（本地，共 ${stats.count} 条）`)

  if (stats.count === 0) {
    lines.push('（记忆库为空：用 `rag_remember` 写入第一条，或用 `rag_ingest` 导入文档。）')
    return lines.join('\n')
  }

  const entries = store.list()
  const project = projectHash(session.cwd ?? null)
  const isSubagent = session.isSubagent === true

  const sorted = [...entries].sort((a, b) => {
    const at = Date.parse(a.meta?.createdAt ?? '') || 0
    const bt = Date.parse(b.meta?.createdAt ?? '') || 0
    return bt - at || a.id.localeCompare(b.id)
  })

  // 笔记（rag_remember）逐条展示；文件块（rag_ingest）按文件聚合，避免一个
  // 文档的多个分块霸占索引。
  const notes = sorted.filter((entry) => entry.meta?.source !== 'file')
  const fileGroups = new Map()
  for (const entry of sorted) {
    if (entry.meta?.source !== 'file') continue
    const key = entry.meta?.path || '（未知文件）'
    const group = fileGroups.get(key)
    const createdAt = entry.meta?.createdAt ?? ''
    if (group === undefined) {
      fileGroups.set(key, { path: key, count: 1, createdAt, scope: entry.meta?.scope })
    } else {
      group.count += 1
      if (Date.parse(createdAt) > (Date.parse(group.createdAt) || 0)) group.createdAt = createdAt
    }
  }

  const isPinned = (entry) => entry.meta?.pinned === true
    || (Array.isArray(entry.meta?.tags) && entry.meta.tags.includes('pin'))
  const pinnedNotes = notes.filter(isPinned)
  const projectNotes = project === null
    ? []
    : notes.filter((entry) => entry.meta?.scope === `project:${project}`)
  const globalNotes = notes.filter((entry) => (entry.meta?.scope ?? 'global') === 'global')

  const picked = []
  const seen = new Set()
  const take = (list, limit) => {
    for (const entry of list) {
      if (picked.length >= 10) return
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      picked.push(entry)
      if (--limit <= 0) break
    }
  }
  take(pinnedNotes, 6)
  if (!isSubagent) {
    take(projectNotes, 6)
    take(globalNotes, 4)
  }

  const groups = [...fileGroups.values()]
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
    .slice(0, isSubagent ? 0 : 3)

  const shown = picked.length + groups.reduce((sum, group) => sum + group.count, 0)

  if (picked.length === 0 && groups.length === 0) {
    lines.push('（本项目暂无近期条目；用 `rag_search` 检索全库。）')
  } else {
    for (const entry of picked) {
      const title = oneLine(entry.meta?.title ?? entry.text, 60)
      const date = formatDate(entry.meta?.createdAt)
      const tags = Array.isArray(entry.meta?.tags) && entry.meta.tags.length > 0
        ? ` #${entry.meta.tags.slice(0, 3).join(' #')}`
        : ''
      lines.push(`- [${entry.id}] ${title}（${scopeLabel(entry.meta?.scope)}${date ? `, ${date}` : ''}）${tags}`)
    }
    for (const group of groups) {
      const name = oneLine(group.path.split(/[\\/]/).pop() ?? group.path, 40)
      const date = formatDate(group.createdAt)
      lines.push(`- 文件 ${name}：${group.count} 段（${scopeLabel(group.scope)}${date ? `, ${date}` : ''}，用 \`rag_search\` 检索）`)
    }
  }

  if (stats.count > shown) {
    lines.push(`其余 ${stats.count - shown} 条用 \`rag_search\` 检索。`)
  }

  let text = lines.join('\n')
  if (text.length > config.maxInjectChars) {
    text = truncateAtLine(text, config.maxInjectChars)
  }
  return text
}

/**
 * 在字符预算内按行截断，避免把半行塞进提示词。
 * @param {string} text
 * @param {number} limit
 * @returns {string} 长度不超过 limit 的文本，末尾带省略号。
 */
export function truncateAtLine(text, limit) {
  const budget = Math.max(1, limit - 1)
  const head = text.slice(0, budget)
  const cut = head.lastIndexOf('\n')
  const body = cut > budget * 0.5 ? head.slice(0, cut) : head
  return `${body.trimEnd()}…`
}

/**
 * 注册提示词贡献。
 * @param {object} ctx - 插件上下文。
 * @param {object} config - 规范化配置。
 * @param {object} store - MemoryStore。
 * @returns {void}
 */
export function installInjection(ctx, config, store) {
  const rules = buildRulesText()
  ctx.effect(
    () => ctx.systemPrompt.section({ name: 'rag-memory:rules', order: config.sectionOrder, text: rules }),
    'dsh-memory-rag: rules section',
  )

  if (config.injectIndex === false) return

  /** sessionId → {revision, text} */
  const cache = new Map()

  ctx.effect(
    () => ctx.systemPrompt.context({
      name: 'rag-memory:index',
      order: config.indexContextOrder,
      text: (context) => {
        const agent = context?.agent
        const sessionId = agent?.session?.id ?? 'unknown'
        let revision = 'unloaded'
        try {
          store.load()
          revision = store.revision
        } catch (error) {
          return `## RAG 记忆索引\n（索引不可用：${error?.message ?? error}）`
        }
        const cached = cache.get(sessionId)
        if (cached && cached.revision === revision) return cached.text
        const text = renderIndexText(store, config, {
          cwd: agent?.session?.header?.cwd ?? null,
          isSubagent: agent?.session?.header?.origin === 'subagent',
        })
        cache.set(sessionId, { revision, text })
        return text
      },
    }),
    'dsh-memory-rag: index context',
  )
}
