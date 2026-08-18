/**
 * 文本测量。离屏 canvas `measureText` + 缓存。
 *
 * 【陷阱 5】绝不用 offsetWidth / getBoundingClientRect 逐节点量 —— 那会触发强制重排，
 * 500 节点必卡。整个渲染链路里只有这里知道文字有多宽。
 *
 * 换行策略必须与 CSS 的表现一致（见 wrap 注释），否则 DOM 会比布局算出来的高一行。
 */

import { parseInline, type InlineSegment } from './inline'
import type { Size } from '../layout/types'

export interface FontSpec {
  family: string
  size: number
  lineHeight: number
  /** 缓存键。字体变了（换主题、调字号）就换一个 key，旧条目自然失效。 */
  key: string
}

/** 节点内边距。与 styles.css 里的 .om-node 必须一致。 */
export const PADDING_X = 12
export const PADDING_Y = 6
/** 边框宽度。box-sizing 是 border-box，边框会从文字区里吃掉宽度，必须补回来。 */
const BORDER = 1
/** 单个节点文字区的最大宽度。超过就换行——否则一条长标题能把布局撑到几千像素。 */
export const MAX_TEXT_WIDTH = 320
/** 空节点也要能点得到。 */
const MIN_TEXT_WIDTH = 16

/**
 * 折叠按钮的直径（M11）。跟着字号缩放走，但两头都夹住：
 * 再小就点不中，再大会把节点边缘盖掉一片，那片地方就拖不动了
 * （`DragController` 在 `.om-toggle` 上跳过拖拽）。
 *
 * 命中区是 styles.css 里另外用透明伪元素撑出来的，与这个直径无关。
 */
export function toggleSize(fontScale: number): number {
  return Math.round(Math.min(24, Math.max(14, 16 * fontScale)))
}

/** CJK 与全角标点：逐字都可以换行。 */
const CJK_RANGE = '\\u2e80-\\u9fff\\u3000-\\u303f\\uac00-\\ud7af\\uff00-\\uffef'
const CJK = new RegExp(`[${CJK_RANGE}]`)
/** 空白 | 单个 CJK 字 | 一串非空白非 CJK。每一段之间都是一个换行机会。 */
const TOKEN_RE = new RegExp(`[^\\S\\r\\n]+|[${CJK_RANGE}]|[^\\s${CJK_RANGE}]+`, 'g')

let ctx: CanvasRenderingContext2D | null = null

function context(): CanvasRenderingContext2D | null {
  if (!ctx) {
    ctx = document.createElement('canvas').getContext('2d')
  }
  return ctx
}

/**
 * 从 Obsidian 的 CSS 变量读字体。主题换了、字号调了都会跟着变。
 * `--font-text` / `--font-text-size` 取不到时退回元素自身的计算值。
 *
 * @param scale 字号缩放（M8 样式项）。缩放后的字号会进 `key`，
 *              因此不同缩放各有各的缓存条目，不会互相污染。
 */
export function readFont(el: HTMLElement, scale = 1): FontSpec {
  const cs = getComputedStyle(el)
  const family = (cs.getPropertyValue('--font-text').trim() || cs.fontFamily || 'sans-serif').trim()
  const raw = parseFloat(cs.getPropertyValue('--font-text-size'))
  const base = Number.isFinite(raw) && raw > 0 ? raw : parseFloat(cs.fontSize) || 16
  // 取整到 0.5px：亚像素字号在 canvas 与 DOM 之间的舍入更容易对不上，
  // 而肉眼看 0.5px 的差别本来就没有意义
  const size = Math.max(6, Math.round(base * scale * 2) / 2)
  return {
    family,
    size,
    lineHeight: Math.round(size * 1.45),
    key: `${size}|${family}`,
  }
}

function fontOf(seg: Pick<InlineSegment, 'bold' | 'italic'>, font: FontSpec): string {
  return `${seg.italic ? 'italic ' : ''}${seg.bold ? '600 ' : 'normal '}${font.size}px ${font.family}`
}

interface Token {
  text: string
  font: string
  width: number
  space: boolean
}

function tokenize(text: string, font: FontSpec): Token[] {
  const c = context()
  const tokens: Token[] = []
  for (const seg of parseInline(text)) {
    const f = fontOf(seg, font)
    if (c) c.font = f
    for (const m of seg.text.match(TOKEN_RE) ?? []) {
      tokens.push({
        text: m,
        font: f,
        // 没有 canvas（测试环境）时退回一个粗略估算：CJK 按一个字宽，其余按 0.55 字宽
        width: c ? c.measureText(m).width : estimate(m, font.size),
        space: /^[^\S\r\n]+$/.test(m),
      })
    }
  }
  return tokens
}

function estimate(text: string, size: number): number {
  let w = 0
  for (const ch of text) w += CJK.test(ch) ? size : size * 0.55
  return w
}

function measureChar(ch: string, fontStr: string, size: number): number {
  const c = context()
  if (!c) return estimate(ch, size)
  c.font = fontStr
  return c.measureText(ch).width
}

/**
 * 贪心折行，与 CSS `white-space: pre-wrap` + `overflow-wrap: anywhere` 的断行机会一致：
 * 空格处、每个 CJK 字之间可断；单个超长词内部按字符硬断。
 *
 * 行尾空白不计入行宽（CSS 也不计）。
 */
function wrap(tokens: Token[], maxWidth: number, size: number): { width: number; lines: number } {
  let lines = 1
  let cur = 0
  let curNoTrail = 0
  let maxLine = 0

  const breakLine = (): void => {
    if (curNoTrail > maxLine) maxLine = curNoTrail
    lines++
    cur = 0
    curNoTrail = 0
  }

  for (const t of tokens) {
    if (t.space) {
      // 行首的空白直接丢掉，跟 CSS 折行后的表现一致
      if (cur === 0) continue
      cur += t.width
      continue
    }
    if (cur > 0 && cur + t.width > maxWidth) breakLine()
    if (t.width > maxWidth) {
      // 单个词就超宽 → 按字符硬断
      for (const ch of t.text) {
        const cw = measureChar(ch, t.font, size)
        if (cur > 0 && cur + cw > maxWidth) breakLine()
        cur += cw
        curNoTrail = cur
      }
      continue
    }
    cur += t.width
    curNoTrail = cur
  }
  if (curNoTrail > maxLine) maxLine = curNoTrail
  return { width: maxLine, lines }
}

const cache = new Map<string, Size>()
/** 缓存上限。超了整个清空——比 LRU 简单，且换主题/换笔记时本来就该失效。 */
const CACHE_LIMIT = 8000

/**
 * 节点的外框尺寸（含内边距）。
 *
 * 宽度向上取整并留 1px 余量：canvas 的测量是亚像素的，DOM 排版也是，
 * 但两者的舍入不一定一致，差半像素就可能多折出一行。
 */
export function measureNode(text: string, font: FontSpec): Size {
  // 换行符做分隔符：字体名和节点文本都不可能含换行，不会出现两个不同键撞成同一串
  const key = `${font.key}\n${text}`
  const hit = cache.get(key)
  if (hit) return hit

  const tokens = tokenize(text, font)
  const { width, lines } = wrap(tokens, MAX_TEXT_WIDTH, font.size)
  const size: Size = {
    w: Math.max(MIN_TEXT_WIDTH, Math.ceil(width) + 1) + PADDING_X * 2 + BORDER * 2,
    h: lines * font.lineHeight + PADDING_Y * 2 + BORDER * 2,
  }

  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, size)
  return size
}

/** 主题切换 / 字号变化时调用。 */
export function clearMeasureCache(): void {
  cache.clear()
}
