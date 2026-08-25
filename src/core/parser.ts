/**
 * Markdown 文本 → MindTree。严格实现 操作手册.md 附录 A 第 A.2–A.5 节。
 *
 * 【禁止】import 任何 obsidian API。
 */

import type { MindNode, MindTree, NodeKind } from './types'

// ── A.2 行分类正则 ──────────────────────────────────────────────

/** ATX 标题。注意：行首不允许有空白，`#标题`（无空格）不是标题。 */
const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/
/** 无序列表项。捕获：前导空白 / 标记 / 标记后空白 / 内容。 */
const LIST_RE = /^([ \t]*)([-*+])([ \t]+)(.*)$/
/** 代码围栏。3 个及以上的 ` 或 ~。 */
const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})(.*)$/

/** 一个 Tab 展开为 4 个空格（附录 A.3）。 */
const TAB_WIDTH = 4
/** 每 4 个空格 = 1 个缩进级（附录 A.3），不足 4 的余数向下取整。 */
const INDENT_UNIT = 4

// ── 文本 / 行数组互转 ───────────────────────────────────────────

/**
 * 检测换行符。取文件中第一个换行的形态。
 *
 * 已知取舍：单个文件内混用 CRLF 与 LF 时，只保留第一种；写回会把整篇统一。
 * 这种文件在 Obsidian 中极罕见（保存时会归一化），v1 不处理。
 */
export function detectEol(text: string): '\n' | '\r\n' {
  const i = text.indexOf('\n')
  if (i > 0 && text[i - 1] === '\r') return '\r\n'
  return '\n'
}

/**
 * 按行切分，不保留行尾符。
 *
 * 空串 → 空数组；`'a\n'` → `['a', '']`。这样 join 回去必定与原文一致。
 */
export function splitLines(text: string): string[] {
  if (text === '') return []
  return text.split(/\r\n|\n/)
}

export function joinLines(lines: string[], eol: '\n' | '\r\n'): string {
  return lines.join(eol)
}

// ── 内部工具 ───────────────────────────────────────────────────

/** 把前导空白展开为等价空格宽度。 */
function indentWidth(ws: string): number {
  let w = 0
  for (const ch of ws) w += ch === '\t' ? TAB_WIDTH : 1
  return w
}

export function isBlank(line: string): boolean {
  return line.trim() === ''
}

/** 该行是否是一个 ATX 标题行。严格换行规则只作用于相邻的两个标题行之间。 */
export function isHeadingLine(line: string): boolean {
  return HEADING_RE.test(line)
}

/**
 * 去除 ATX 标题尾部的闭合 `#` 序列。
 * CommonMark 规定闭合序列前必须有空白，或整个内容就是一串 `#`。
 */
function stripClosingHashes(raw: string): string {
  const text = raw.trim()
  if (/^#+$/.test(text)) return ''
  return text.replace(/[ \t]+#+$/, '').trimEnd()
}

interface RawNode {
  line: number
  depth: number
  kind: NodeKind
  text: string
}

/** 定位 frontmatter 的结束行（exclusive）。不是 frontmatter 则返回 0。 */
function frontmatterEnd(lines: string[]): number {
  if (lines.length === 0) return 0
  if ((lines[0] ?? '').trim() !== '---') return 0
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() === '---') return i + 1
  }
  // 没有闭合标记 → 不视为 frontmatter，按普通内容解析
  return 0
}

// ── A.2–A.4 扫描：产出文档序的节点列表 ──────────────────────────

function scan(lines: string[]): RawNode[] {
  const nodes: RawNode[] = []

  /** 最近的标题祖先深度；null 表示尚未出现任何标题。 */
  let headingDepth: number | null = null
  /** A.4 列表节点模式。 */
  let listMode: 'none' | 'active' | 'ended' = 'none'
  /** 当前列表块第一个列表项的缩进宽度，作为缩进级数的基准 0。 */
  let listBaseWidth = 0
  /** 上一个列表节点的内容起始列，用于判定「缩进续行」。 */
  let listContentCol = 0
  /** 代码围栏状态。 */
  let fence: { marker: string; len: number } | null = null

  for (let i = frontmatterEnd(lines); i < lines.length; i++) {
    const line = lines[i] ?? ''
    const fenceMatch = FENCE_RE.exec(line)

    // ── 优先级 1：代码围栏内一律是正文，不做任何解析 ──
    if (fence) {
      if (
        fenceMatch &&
        (fenceMatch[2] ?? '')[0] === fence.marker &&
        (fenceMatch[2] ?? '').length >= fence.len &&
        (fenceMatch[3] ?? '').trim() === ''
      ) {
        fence = null
      }
      continue
    }
    if (fenceMatch) {
      fence = {
        marker: (fenceMatch[2] ?? '')[0] as string,
        len: (fenceMatch[2] ?? '').length,
      }
      // 围栏开启行本身若不是列表续行，就终止列表节点模式
      if (listMode === 'active' && indentWidth(fenceMatch[1] ?? '') < listContentCol) {
        listMode = 'ended'
      }
      continue
    }

    // ── 优先级 2：ATX 标题 ──
    const h = HEADING_RE.exec(line)
    if (h) {
      const depth = (h[1] ?? '').length
      nodes.push({ line: i, depth, kind: 'heading', text: stripClosingHashes(h[2] ?? '') })
      headingDepth = depth
      listMode = 'none' // 新的标题作用域
      continue
    }

    // ── 空行不终止列表节点模式（A.4）──
    if (isBlank(line)) continue

    // ── 优先级 3：列表项 ──
    const l = LIST_RE.exec(line)
    if (l) {
      if (listMode === 'ended') continue // 模式已终止，此后列表一律是正文
      const w = indentWidth(l[1] ?? '')
      if (listMode === 'none') {
        listMode = 'active'
        listBaseWidth = w
      }
      const level = Math.max(0, Math.floor((w - listBaseWidth) / INDENT_UNIT))
      nodes.push({
        line: i,
        depth: (headingDepth ?? 0) + 1 + level,
        kind: 'list',
        text: (l[4] ?? '').trim(),
      })
      listContentCol = w + (l[2] ?? '').length + indentWidth(l[3] ?? '')
      continue
    }

    // ── 列表项的缩进续行 → 正文，不终止模式 ──
    if (listMode === 'active' && indentWidth(/^[ \t]*/.exec(line)?.[0] ?? '') >= listContentCol) {
      continue
    }

    // ── 其余：正文，并终止列表节点模式 ──
    if (listMode === 'active') listMode = 'ended'
  }

  return nodes
}

// ── A.5 树的组装与行范围赋值 ────────────────────────────────────

function makeNode(
  id: string,
  text: string,
  depth: number,
  kind: NodeKind,
  titleLine: number,
): MindNode {
  return {
    id,
    text,
    depth,
    kind,
    children: [],
    parent: null,
    titleLine,
    bodyEnd: titleLine + 1,
    blockStart: titleLine,
    blockEnd: titleLine + 1,
    collapsed: false,
  }
}

export function parse(text: string): MindTree {
  const eol = detectEol(text)
  const lines = splitLines(text)
  const raw = scan(lines)

  let counter = 0
  const nextId = (): string => `n${++counter}`

  const root = makeNode('n0', '', 0, 'heading', -1)
  root.blockStart = -1
  root.blockEnd = lines.length
  root.bodyEnd = lines.length

  const byId = new Map<string, MindNode>()
  const stack: MindNode[] = [root]

  /** 子树结束行向前收缩，跳过紧邻的连续空行（A.5 尾部空行修剪）。 */
  const trimBack = (start: number, end: number): number => {
    let e = end
    while (e > start + 1 && isBlank(lines[e - 1] ?? '')) e--
    return e
  }

  const closeTo = (depth: number, boundary: number): void => {
    while (stack.length > 1) {
      const top = stack[stack.length - 1] as MindNode
      if (top.depth < depth) break
      top.blockEnd = trimBack(top.titleLine, boundary)
      stack.pop()
    }
  }

  for (const r of raw) {
    closeTo(r.depth, r.line)
    const parent = stack[stack.length - 1] as MindNode
    const node = makeNode(nextId(), r.text, r.depth, r.kind, r.line)
    node.parent = parent
    parent.children.push(node)
    byId.set(node.id, node)
    stack.push(node)
  }
  closeTo(1, lines.length)

  // bodyEnd 必须在所有 blockEnd 定稿后再算
  const fill = (n: MindNode): void => {
    const first = n.children[0]
    n.bodyEnd = first ? first.titleLine : n.blockEnd
    for (const c of n.children) fill(c)
  }
  const firstRootChild = root.children[0]
  root.bodyEnd = firstRootChild ? firstRootChild.titleLine : lines.length
  for (const c of root.children) fill(c)

  return { root, byId, lines, eol }
}

/**
 * 某节点所在列表块的 listBaseDepth（附录 A.6）：最近标题祖先的 depth + 1，无标题祖先则为 1。
 * 对 kind === 'heading' 的节点无意义，返回值仅供列表缩进计算。
 */
export function listBaseDepthOf(node: MindNode): number {
  let p = node.parent
  while (p && p.depth > 0) {
    if (p.kind === 'heading') return p.depth + 1
    p = p.parent
  }
  return 1
}
