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
    // 这个 canvas 只用来 measureText，永远不进 DOM，所以用 createEl 而不是 createDiv 那套
    ctx = createEl('canvas').getContext('2d')
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
  /** MathJax 行内公式是一个不可断开的盒子；普通文字才允许超宽时逐字硬断。 */
  breakable: boolean
  /** 这一 token 至少需要多高的行盒。普通文字就是 font.lineHeight。 */
  height: number
}

interface TexGroup {
  content: string
  /** 第一个未被本组消费的字符位置。 */
  end: number
}

/** 读取一个允许嵌套的 `{...}` 参数。这里只识别结构，不解释 TeX。 */
function texGroup(source: string, from: number): TexGroup | null {
  let start = from
  while (/\s/.test(source[start] ?? '')) start++
  if (source[start] !== '{') return null

  let depth = 1
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '\\') {
      // `\{` / `\}` 是可见字符，不参与参数配对；普通命令跳过首字母也不影响后续花括号。
      i++
      continue
    }
    if (source[i] === '{') depth++
    if (source[i] === '}' && --depth === 0) {
      return { content: source.slice(start + 1, i), end: i + 1 }
    }
  }
  return null
}

/** `\frac` / `\overset` 这类双参数命令的最大嵌套深度。 */
function groupedCommandDepth(source: string, command: RegExp): number {
  let max = 0
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '\\') continue
    const matched = source.slice(i).match(command)?.[0]
    if (!matched) continue
    const first = texGroup(source, i + matched.length)
    const second = first ? texGroup(source, first.end) : null
    const nested = Math.max(
      first ? groupedCommandDepth(first.content, command) : 0,
      second ? groupedCommandDepth(second.content, command) : 0,
    )
    max = Math.max(max, 1 + nested)
    if (second) i = second.end - 1
  }
  return max
}

function dimensionPx(value: string, unit: string, font: FontSpec): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  switch (unit) {
    case 'em':
      return number * font.size
    case 'ex':
      return number * font.size * 0.5
    case 'pt':
      return number * (96 / 72)
    case 'px':
      return number
    case 'pc':
      return number * 16
    case 'in':
      return number * 96
    case 'cm':
      return number * (96 / 2.54)
    case 'mm':
      return number * (96 / 25.4)
    case 'mu':
      return number * (font.size / 18)
    case 'bp':
      return number * (96 / 72)
    case 'dd':
      return number * (96 / 72) * (1238 / 1157)
    case 'cc':
      return number * (96 / 72) * (1238 / 1157) * 12
    case 'sp':
      return number * (96 / 72) / 65536
    default:
      return 0
  }
}

const DIMENSION =
  '([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))\\s*(em|ex|pt|px|pc|in|cm|mm|mu|bp|dd|cc|sp)'

/** `\\rule[raise]{width}{height}`；raise 是可选的。每次返回新实例供 matchAll/replace 使用。 */
function rulePattern(): RegExp {
  return new RegExp(
    `\\\\rule(?:\\s*\\[${DIMENSION}\\])?\\s*\\{${DIMENSION}\\}\\s*\\{${DIMENSION}\\}`,
    'g',
  )
}

/** MathJax 支持的显式水平空间。结构命令从可见文本移除后，这部分必须单独加回来。 */
function explicitMathWidth(source: string, font: FontSpec): number {
  let width = 0
  const hspace = new RegExp(`\\\\hspace\\*?\\s*\\{${DIMENSION}\\}`, 'g')
  for (const match of source.matchAll(hspace)) {
    width += dimensionPx(match[1] as string, match[2] as string, font)
  }
  for (const match of source.matchAll(rulePattern())) {
    width += dimensionPx(match[3] as string, match[4] as string, font)
  }
  width += (source.match(/\\qquad\b/g)?.length ?? 0) * font.size * 2
  width += (source.match(/(?<!q)\\quad\b/g)?.length ?? 0) * font.size
  return Math.max(0, width)
}

function explicitRuleHeight(source: string, font: FontSpec): number {
  let height = 0
  for (const match of source.matchAll(rulePattern())) {
    const raise = match[1] && match[2] ? dimensionPx(match[1], match[2], font) : 0
    const ruleHeight = dimensionPx(match[5] as string, match[6] as string, font)
    // 正负 raise 分别把 rule 推到基线的上方/下方；取绝对值是保守但不会裁切的包围盒。
    height = Math.max(height, ruleHeight + Math.abs(raise))
  }
  return height
}

function substackRows(source: string): number {
  let rows = 1
  const marker = /\\substack\b/g
  for (const match of source.matchAll(marker)) {
    const group = texGroup(source, (match.index ?? 0) + match[0].length)
    if (group) rows = Math.max(rows, group.content.split('\\\\').length)
  }
  return rows
}

/**
 * `\\overset{annotation}{body}` 等结构不是“标注或主体谁更高”，而是两个盒子竖向叠放。
 * 标注由 MathJax 缩成 script style，这里按 75% 加到主体高度，并保留一小段间距。
 */
function stackedAnnotationFactor(source: string): number {
  let factor = 0
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '\\') continue
    const matched = source.slice(i).match(/^\\(?:overset|underset|stackrel)\b/)?.[0]
    if (!matched) continue
    const annotation = texGroup(source, i + matched.length)
    const body = annotation ? texGroup(source, annotation.end) : null
    if (!annotation || !body) continue

    const annotationFactor = mathHeightFactor(annotation.content)
    const bodyFactor = mathHeightFactor(body.content)
    factor = Math.max(factor, bodyFactor + annotationFactor * 0.75 + 0.25)
    i = body.end - 1
  }
  return factor
}

/**
 * 把 LaTeX 源码压成一份只用于估宽的「视觉近似文本」。控制词和结构花括号不会显示，
 * 矩阵里的 `\\` 还是纵向换行；若直接拿源码喂 measureText，节点会被这些不可见字符
 * 撑出几百像素空白。
 *
 * 不追求排版器级别的精确：上下标仍按正常字号计算，并额外留出 2em 安全边，保证
 * 估算宁可稍宽也不要让 MathJax 穿出节点。全程仍是纯字符串 + canvas，不读取 DOM。
 */
function mathWidth(
  source: string,
  fontString: string,
  font: FontSpec,
  c: CanvasRenderingContext2D | null,
): number {
  const explicitWidth = explicitMathWidth(source, font)
  const visualSource = source
    .replace(new RegExp(`\\\\hspace\\*?\\s*\\{${DIMENSION}\\}`, 'g'), '')
    .replace(rulePattern(), '')
    .replace(/\\q{1,2}uad\b/g, '')
  const rows = visualSource.split('\\\\').map((row) =>
    row
      .replace(/\\(?:begin|end)\{[^{}]+\}/g, '')
      .replace(
        /\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle|left|right|operatorname|mathrm|mathbf|mathit|mathsf|mathtt|text|textrm|boldsymbol|overline|underline)\b/g,
        '',
      )
      .replace(/\\(?:,|;|:|>| )/g, ' ')
      .replace(/\\!/g, '')
      .replace(/\\sqrt\b/g, '√')
      // 剩下的命令（希腊字母、运算符、关系符等）视觉上通常只占一个字形。
      .replace(/\\[A-Za-z]+/g, 'M')
      .replace(/\\([^A-Za-z])/g, '$1')
      .replace(/[{}_^]/g, '')
      .replace(/&/g, '  ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  const measured = Math.max(
    font.size,
    ...rows.map((row) => {
      if (!c) return estimate(row, font.size)
      c.font = fontString
      return c.measureText(row).width
    }),
  )
  return measured * 1.2 + font.size * 2 + explicitWidth
}

function tokenize(text: string, font: FontSpec): Token[] {
  const c = context()
  const tokens: Token[] = []
  for (const seg of parseInline(text)) {
    const f = fontOf(seg, font)
    if (c) c.font = f
    if (seg.math) {
      // MathJax 最终渲染成 nowrap 的行内盒，公式内部的空格不是 CSS 折行机会，
      // 所以整段必须作为一个 token。用 LaTeX 源码量宽会偏保守（命令名/花括号本身
      // 不会显示），但宁可节点稍宽，也不能低估后让公式穿出边框。
      tokens.push({
        text: seg.text,
        font: f,
        width: mathWidth(seg.text, f, font, c),
        space: false,
        breakable: false,
        height: mathLineHeight(seg.text, font),
      })
      continue
    }
    for (const m of seg.text.match(TOKEN_RE) ?? []) {
      tokens.push({
        text: m,
        font: f,
        // 没有 canvas（测试环境）时退回一个粗略估算：CJK 按一个字宽，其余按 0.55 字宽
        width: c ? c.measureText(m).width : estimate(m, font.size),
        space: /^[^\S\r\n]+$/.test(m),
        breakable: true,
        height: font.lineHeight,
      })
    }
  }
  return tokens
}

/**
 * MathJax 的 CHTML `mjx-container` 自己是 `line-height: 0`，真实字形仍会向基线上下伸出。
 * canvas 只能量普通文字，量不到分数线、根号、矩阵的高度；这里做【保守预留】而不是
 * 在 500 个节点上逐个读 DOM 尺寸（那会破坏本插件一直坚持的无强制重排渲染链路）。
 *
 * 普通行内公式多留 25%；多行环境按行数继续增高。防止把公式裁进边框。
 */
function mathHeightFactor(source: string): number {
  let factor = 1.25
  if (/\\(?:d?frac|sqrt|sum|prod|int|lim)\b/.test(source) || /[_^]/.test(source)) factor = 1.35

  const fractionDepth = groupedCommandDepth(source, /^\\(?:dfrac|tfrac|frac)\b/)
  if (fractionDepth > 0) factor = Math.max(factor, 1.35 + (fractionDepth - 1) * 0.35)

  // `\dfrac` 在分子/分母里仍强制 display style，比会自动缩小的普通 `\frac` 更高。
  const displayFractionDepth = groupedCommandDepth(source, /^\\dfrac\b/)
  if (displayFractionDepth > 0) {
    factor = Math.max(factor, 1.5 + (displayFractionDepth - 1) * 0.75)
  }

  factor = Math.max(factor, stackedAnnotationFactor(source))

  const stackRows = substackRows(source)
  if (stackRows > 1) factor = Math.max(factor, 1.35 + (stackRows - 1) * 0.9)

  if (/\\begin\{(?:[pbBvV]?matrix|cases|aligned|array|gathered)\}/.test(source)) {
    // LaTeX 里的 `\\` 是换行；MathJax 的括号/大括号还会随整张表拉伸，实测每多
    // 一行约增加 1.05 个普通行高。这里把伸缩符号和行间距都算进去，不能只按文字行距预留。
    const rows = Math.max(1, source.split('\\\\').length)
    factor = Math.max(factor, 1 + (rows - 1) * 1.05)
  }
  return factor
}

function mathLineHeight(source: string, font: FontSpec): number {
  const factor = mathHeightFactor(source)
  // `\rule{w}{h}` 常被间接用于 phantom / 自定义排版；高度是用户显式指定的，不能压成字形。
  const explicitHeight = explicitRuleHeight(source, font)
  return Math.ceil(Math.max(font.lineHeight * factor, explicitHeight + font.size * 0.15))
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
function wrap(
  tokens: Token[],
  maxWidth: number,
  size: number,
  baseLineHeight: number,
): { width: number; height: number } {
  let cur = 0
  let curNoTrail = 0
  let maxLine = 0
  let lineHeight = baseLineHeight
  let totalHeight = 0

  const breakLine = (): void => {
    if (curNoTrail > maxLine) maxLine = curNoTrail
    totalHeight += lineHeight
    cur = 0
    curNoTrail = 0
    lineHeight = baseLineHeight
  }

  for (const t of tokens) {
    if (t.space) {
      // 行首的空白直接丢掉，跟 CSS 折行后的表现一致
      if (cur === 0) continue
      cur += t.width
      continue
    }
    if (cur > 0 && cur + t.width > maxWidth) breakLine()
    if (t.breakable && t.width > maxWidth) {
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
    lineHeight = Math.max(lineHeight, t.height)
  }
  if (curNoTrail > maxLine) maxLine = curNoTrail
  totalHeight += lineHeight
  return { width: maxLine, height: totalHeight }
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
  const { width, height } = wrap(tokens, MAX_TEXT_WIDTH, font.size, font.lineHeight)
  const size: Size = {
    w: Math.max(MIN_TEXT_WIDTH, Math.ceil(width) + 1) + PADDING_X * 2 + BORDER * 2,
    h: height + PADDING_Y * 2 + BORDER * 2,
  }

  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, size)
  return size
}

/** 主题切换 / 字号变化时调用。 */
export function clearMeasureCache(): void {
  cache.clear()
}
