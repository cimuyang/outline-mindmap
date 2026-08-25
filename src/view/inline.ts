/**
 * 内联 Markdown → 带样式的片段。支持五种强调语法：
 * `**粗**`、`*斜*`、`***粗斜***`、`==高亮==`、`~~删除~~`，及任意嵌套组合；
 * 另外把 `[[wiki 链接]]` 与 `[文字](url)` 解析成【只显示可读文字】的链接片段。
 *
 * 【陷阱 13】笔记内容未转义就 innerHTML —— 笔记里的 `<script>` 会被执行。
 * 本文件【不再生成任何 HTML 字符串】：片段交给 NodeRenderer 用 createEl + textContent
 * 组装成真实 DOM，转义因此是结构性的，不存在忘记转义的可能。
 *
 * 本文件零依赖、零 DOM，可以直接单测。
 */

export interface InlineSegment {
  text: string
  bold: boolean
  italic: boolean
  highlight: boolean
  strike: boolean
  /** 这一段是链接的可读文字。只做视觉区分，不可点击（导图的单击已经用于跳转笔记）。 */
  link: boolean
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

function styleOf(stack: Marker[], link: boolean): Omit<InlineSegment, 'text'> {
  return {
    bold: stack.includes('**') || stack.includes('***'),
    italic: stack.includes('*') || stack.includes('***'),
    highlight: stack.includes('=='),
    strike: stack.includes('~~'),
    link,
  }
}

/** `[[目标|别名]]` / `[文字](url)` 的匹配结果。 */
interface LinkMatch {
  /** 显示出来的可读文字。 */
  text: string
  /** 整个链接语法在原文里占的长度。 */
  length: number
}

/**
 * 从 `i` 处开始的一个链接语法。不是链接就返回 null（此时那个 `[` 当普通文字）。
 *
 * 只取【可读文字】：`[[笔记/路径|别名]]` 显示别名，`[[笔记#小节]]` 显示小节名，
 * `[[笔记]]` 显示笔记名。路径、锚点、URL 一律不显示——导图节点的宽度很宝贵，
 * 而且 measure.ts 是按 parseInline 的结果量宽的，显示什么就必须量什么。
 */
function linkAt(text: string, i: number): LinkMatch | null {
  if (text[i] !== '[') return null

  // ── [[wiki 链接]] ──
  if (text[i + 1] === '[') {
    const end = text.indexOf(']]', i + 2)
    if (end < 0) return null
    const inner = text.slice(i + 2, end)
    // 内部再出现 `[` 说明括号没配上（`[[a[[b]]`），当普通文字处理
    if (inner.includes('[')) return null
    return { text: wikiLabel(inner), length: end + 2 - i }
  }

  // ── [文字](url) ──
  const close = text.indexOf(']', i + 1)
  if (close < 0 || text[close + 1] !== '(') return null
  const paren = text.indexOf(')', close + 2)
  if (paren < 0) return null
  const label = text.slice(i + 1, close)
  if (label.includes('[')) return null
  // `[](url)` 没有可读文字：整段跳过，不留空片段
  return { text: label.trim(), length: paren + 1 - i }
}

/** wiki 链接的显示文字：有别名用别名，否则有锚点用锚点，都没有就用目标本身。 */
function wikiLabel(inner: string): string {
  const bar = inner.indexOf('|')
  if (bar >= 0) return inner.slice(bar + 1).trim()
  const hash = inner.indexOf('#')
  // `[[#小节]]`（同篇内跳转）与 `[[笔记#小节]]` 都取小节名
  if (hash >= 0) {
    const anchor = inner.slice(hash + 1).trim()
    if (anchor !== '') return anchor
  }
  return inner.trim()
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

  /** @param link 这一批文字是不是链接的可读文字。链接片段单独 flush，不与普通文字合并。 */
  const flush = (link = false): void => {
    if (buf === '') return
    const style = styleOf(stack, link)
    const last = segs[segs.length - 1]
    if (
      last &&
      last.bold === style.bold &&
      last.italic === style.italic &&
      last.highlight === style.highlight &&
      last.strike === style.strike &&
      last.link === style.link
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
    // 链接优先于强调标记：`[[a**b**]]` 里的 `**` 是目标名的一部分，不该被当成加粗。
    // 链接的可读文字仍然继承外层的强调（`**[[笔记]]**` 是粗体链接）。
    if (ch === '[') {
      const link = linkAt(text, i)
      if (link) {
        flush() // 先把链接前面攒着的普通文字断开
        buf = link.text
        flush(true)
        i += link.length
        continue
      }
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

/**
 * 一层包裹元素。`cls` 为空表示这一层不需要 class。
 *
 * `tag` 收窄到真实的标签名而不是 string：渲染层可以直接把它交给 createEl，
 * 不必再断言一次，也就不可能从这里冒出一个凭空捏造的标签名。
 */
export interface InlineTag {
  tag: keyof HTMLElementTagNameMap
  cls?: string
}

/**
 * 一个片段该包上哪几层元素，【内层在前、外层在后】。
 *
 * 与旧的字符串拼接版顺序完全一致（`***==粗斜高亮==***` → strong > em > mark > 文字），
 * 只是把「拼 HTML」换成了「报出标签名」——真正建元素的活交给渲染层，
 * 于是转义这件事从「记得调 escapeHtml」变成了「textContent 天然不解析标签」。
 *
 * 链接在最内层：`**[[笔记]]**` 是一个粗体的链接文字，而不是反过来。
 * 用 `span` 而不是 `a`：它【不可点击】（导图的单击已经用于跳转笔记对应行），
 * 挂个 `a` 会让人以为点得动，键盘 Tab 还会停在上面。
 */
export function tagsFor(seg: InlineSegment): InlineTag[] {
  const tags: InlineTag[] = []
  if (seg.link) tags.push({ tag: 'span', cls: 'om-link' })
  if (seg.strike) tags.push({ tag: 's' })
  if (seg.highlight) tags.push({ tag: 'mark' })
  if (seg.italic) tags.push({ tag: 'em' })
  if (seg.bold) tags.push({ tag: 'strong' })
  return tags
}

/** 去掉所有标记后的纯文字。测量宽度用（`**` 本身不占宽度）。 */
export function plainText(text: string): string {
  let out = ''
  for (const seg of parseInline(text)) out += seg.text
  return out
}
