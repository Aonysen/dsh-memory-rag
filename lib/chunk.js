/**
 * dsh-memory-rag — 文本切块与去重哈希（纯函数，可离线单测）。
 *
 * 切块策略：
 * - 先按空行分段，再按目标长度聚合，段落之间保留 1 个空行。
 * - 单段超过硬上限时按句末标点切分，仍超长则按字符硬切。
 * - 相邻块重叠 overlap 个字符，避免关键句被切断后两边都检索不到。
 * - 每块前缀不超过 200 字符的「上下文标题」（最近的 Markdown 标题），
 *   让短块也带有主题信息；没有标题时不加。
 */

import { createHash } from 'node:crypto'

/** 文本 sha256（十六进制）。 */
export function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex')
}

/** 把超长段落切成不超过 limit 的片段（优先在标点/换行处断开）。 */
function splitLong(paragraph, limit) {
  const out = []
  let rest = paragraph
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    let cut = -1
    for (const mark of ['\n', '。', '！', '？', '；', '. ', '! ', '? ', '; ', '，', ', ']) {
      const at = window.lastIndexOf(mark)
      if (at > limit * 0.5) {
        cut = at + mark.length
        break
      }
    }
    if (cut <= 0) cut = limit
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest !== '') out.push(rest)
  return out.filter((s) => s !== '')
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/

/**
 * 把一个文本切成块。
 * @param {string} text - 原始文本。
 * @param {{maxChars?: number, hardMax?: number, overlap?: number}} [options]
 * @returns {string[]} 块列表（去空、已 trim）。
 */
export function chunkText(text, options = {}) {
  const maxChars = options.maxChars ?? 800
  const hardMax = Math.max(maxChars, options.hardMax ?? 2000)
  const overlap = Math.max(0, Math.min(options.overlap ?? 100, Math.floor(maxChars / 4)))

  const normalized = String(text ?? '').replace(/\r\n?/g, '\n').trim()
  if (normalized === '') return []
  if (normalized.length <= maxChars) return [normalized]

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p !== '')

  const chunks = []
  let current = ''
  let heading = ''

  const push = () => {
    const body = current.trim()
    if (body !== '') {
      const prefix = heading === '' || body.startsWith(heading) ? '' : `${heading}\n`
      chunks.push((prefix + body).trim())
    }
    current = ''
  }

  const appendPiece = (piece) => {
    if (current === '') {
      current = piece
      return
    }
    if (current.length + 2 + piece.length <= maxChars) {
      current += `\n\n${piece}`
      return
    }
    const tail = overlap > 0 ? current.slice(Math.max(0, current.length - overlap)).trimStart() : ''
    push()
    current = tail === '' ? piece : `${tail}\n\n${piece}`
  }

  for (const paragraph of paragraphs) {
    const headingMatch = paragraph.match(HEADING_RE)
    if (headingMatch) {
      heading = paragraph.split('\n')[0].trim()
      // 标题本身很短：并入当前块开头，不做单独切分
      appendPiece(paragraph)
      continue
    }
    if (paragraph.length <= maxChars) {
      appendPiece(paragraph)
      continue
    }
    for (const piece of splitLong(paragraph, hardMax)) {
      appendPiece(piece)
    }
  }
  push()

  // 二次防御：任何超硬上限的块再切一次
  const safe = []
  for (const chunk of chunks) {
    if (chunk.length <= hardMax) {
      safe.push(chunk)
      continue
    }
    for (const piece of splitLong(chunk, hardMax)) safe.push(piece)
  }
  return safe.filter((chunk) => chunk.trim() !== '')
}
