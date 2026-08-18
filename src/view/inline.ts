/**
 * 内联 Markdown → 分段 / HTML。只支持 M3 交付物列出的五种：
 * `**粗**`、`*斜*`、`***粗斜***`、`==高亮==`、`~~删除~~`，及任意嵌套组合。
 *
 * 【陷阱 13】笔记内容未转义就 innerHTML —— 笔记里的 `<script>` 会被执行。
 * 本文件是唯一生成 HTML 字符串的地方，转义必须在这里做死。
 *
 * 本文件零依赖、零 DOM，可以直接单测。
 */

export interface InlineSegment {
  text: string
  bold: boolean
  italic: boolean
  highlight: boolean
  strike: boolean
}

/** 顺序即优先级：必须先匹配最长的 `***`，否则会被拆成 `**` + `*`。 */
const MARKERS = ['***', '**', '*', '==', '~~'] as const
type Marker = (typeof MARKERS)[number]

const ESCAPABLE = new Set(['*', '=', '~', '\\'])

function markerAt(text: string, i: number): Marker | null {
  for (const m of MARKERS) {
    if (text.startsWith(m, i)) return m
  }
  return null
}

/** 后面还有没有同样的标记可以配对。没有就当普通文字，不吃掉这个字符。 */
function hasCloser(text: string, from: number, marker: Marker): boolean {
  for (let j = from; j < text.length; j++) {
    if (text[j] === '\\') {
      j++
      continue
    }
    if (markerAt(text, j) === marker) return true
  }
  return false
}

function styleOf(stack: Marker[]): Omit<InlineSegment, 'text'> {
  return {
    bold: stack.includes('**') || stack.includes('***'),
    italic: stack.includes('*') || stack.includes('***'),
    highlight: stack.includes('=='),
    strike: stack.includes('~~'),
  }
}

/**
 * 切成带样式的片段。相邻的同样式片段会被合并，避免产出一堆一字一段。
 *
 * 未配对的标记原样保留为文字——用户笔记里出现单个 `*` 是很常见的。
 */
export function parseInline(text: string): InlineSegment[] {
  const segs: InlineSegment[] = []
  const stack: Marker[] = []
  let buf = ''

  const flush = (): void => {
    if (buf === '') return
    const style = styleOf(stack)
    const last = segs[segs.length - 1]
    if (
      last &&
      last.bold === style.bold &&
      last.italic === style.italic &&
      last.highlight === style.highlight &&
      last.strike === style.strike
    ) {
      last.text += buf
    } else {
      segs.push({ text: buf, ...style })
    }
    buf = ''
  }

  let i = 0
  while (i < text.length) {
    const ch = text[i] as string
    if (ch === '\\' && i + 1 < text.length && ESCAPABLE.has(text[i + 1] as string)) {
      buf += text[i + 1] as string
      i += 2
      continue
    }
    const m = markerAt(text, i)
    if (m) {
      if (stack[stack.length - 1] === m) {
        flush()
        stack.pop()
        i += m.length
        continue
      }
      // 不是栈顶但已经开着 → 交叉嵌套（`**a *b** c*`），按普通文字处理，不去猜用户意图
      if (!stack.includes(m) && hasCloser(text, i + m.length, m)) {
        flush()
        stack.push(m)
        i += m.length
        continue
      }
    }
    buf += ch
    i++
  }
  flush()
  return segs
}

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESCAPE_MAP[c] ?? c)
}

/** 内层 → 外层依次包裹，保证 `***==粗斜高亮==***` 这类组合的嵌套顺序稳定。 */
export function renderInline(text: string): string {
  let html = ''
  for (const seg of parseInline(text)) {
    let piece = escapeHtml(seg.text)
    if (seg.strike) piece = `<s>${piece}</s>`
    if (seg.highlight) piece = `<mark>${piece}</mark>`
    if (seg.italic) piece = `<em>${piece}</em>`
    if (seg.bold) piece = `<strong>${piece}</strong>`
    html += piece
  }
  return html
}

/** 去掉所有标记后的纯文字。测量宽度用（`**` 本身不占宽度）。 */
export function plainText(text: string): string {
  let out = ''
  for (const seg of parseInline(text)) out += seg.text
  return out
}
