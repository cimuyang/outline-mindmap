/**
 * 结构操作 → EditPlan。严格实现 操作手册.md 附录 A 第 A.7 节。
 *
 * 本文件所有函数都是【纯函数】：不修改传入的树，只返回 EditPlan 或树里现成的节点引用。
 * 写回由 doc/DocumentBridge 负责，且永远是最小范围替换（红线 2）。
 *
 * M5 在末尾追加了「选中移动」与「编辑意图 → EditPlan」两节：它们同样是纯逻辑，
 * 放在这里就能被单测覆盖——键盘链路最容易错的部分因此不必靠手工点。
 *
 * 【禁止】import 任何 obsidian API。
 */

import type { EditPlan, MindNode, MindTree, NodeKind, ParseOptions, TextEdit } from './types'
import { isBlank, isHeadingLine, listBaseDepthOf } from './parser'
import { serializeNode, serializeSubtree } from './serializer'

// ── 通用工具 ───────────────────────────────────────────────────

function mustGet(tree: MindTree, id: string): MindNode {
  const node = tree.byId.get(id)
  if (!node) throw new Error(`节点不存在：${id}`)
  return node
}

/** 节点文本不允许含换行——否则一行会被撑成多行，破坏所有行号映射。 */
function assertSingleLine(text: string): void {
  if (/[\r\n]/.test(text)) {
    throw new Error(`节点文本不能包含换行符：${JSON.stringify(text)}`)
  }
}

function isAncestorOf(maybeAncestor: MindNode, node: MindNode): boolean {
  let p: MindNode | null = node.parent
  while (p) {
    if (p === maybeAncestor) return true
    p = p.parent
  }
  return false
}

/**
 * 最后一个非空行之后的位置。
 *
 * `splitLines` 会把「文件末尾的换行符」表示成数组最后一个空串元素，
 * 在它之前插入才能保住原文件的末尾换行。
 */
function contentEnd(lines: string[]): number {
  let e = lines.length
  while (e > 0 && isBlank(lines[e - 1] ?? '')) e--
  return e
}

/**
 * 删除范围向后吞掉「分隔用」的空行。
 *
 * 只吞掉后面还有实际内容的那些空行；文件末尾的空行一律保留，
 * 否则删掉最后一个节点会顺手删掉文件的末尾换行符。
 */
function swallowSeparators(lines: string[], end: number): number {
  let k = end
  while (k < lines.length && isBlank(lines[k] ?? '')) k++
  return k < lines.length ? k : end
}

/**
 * 源范围向【前】吞掉分隔空行——仅当本块是文件里最后一块内容时。
 *
 * 平时分隔空行跟着前一块走（swallowSeparators 向后吞）就够了。但搬走文件的最后一块内容时
 * 后面没有内容可吞（否则会删掉文件末尾换行），它【前面】那几个分隔空行就成了孤儿留在文件尾巴上；
 * 而落点处又会补一份新的分隔空行。于是反复把同一个节点拖到画布空白，空行会一轮堆三个
 * ——正是陷阱 8「严格换行不幂等」的同一类问题。向前收正好把这份分隔一起带走。
 */
function swallowLeadingSeparators(lines: string[], start: number, end: number): number {
  // 后面还有内容 → 那些空行仍在两块之间充当分隔，不能动
  for (let i = end; i < lines.length; i++) {
    if (!isBlank(lines[i] ?? '')) return start
  }
  let k = start
  while (k > 0 && isBlank(lines[k - 1] ?? '')) k--
  return k
}

/** 新增 / 移动节点时，插入点处「删除源范围之后」实际相邻的行。 */
function neighborLines(
  lines: string[],
  insertAt: number,
  srcStart: number,
  srcEnd: number,
): { prev: string | null; next: string | null } {
  let i = insertAt - 1
  if (i >= srcStart && i < srcEnd) i = srcStart - 1
  let j = insertAt
  if (j >= srcStart && j < srcEnd) j = srcEnd
  return {
    prev: i >= 0 ? (lines[i] ?? null) : null,
    next: j < lines.length ? (lines[j] ?? null) : null,
  }
}

/**
 * 严格换行（A.6）：只在【相邻的两个标题行之间】补足 3 个空行。
 *
 * 与 serializer 的 assemble 保持一致——标题与正文之间不插空行，
 * 因此插入点前一行若是正文，就不加前导空行。
 */
function withSeparators(
  block: string[],
  lines: string[],
  insertAt: number,
  options: ParseOptions,
  srcStart = -1,
  srcEnd = -1,
): string[] {
  if (!options.strictLineBreak || block.length === 0) return block
  const first = block[0] ?? ''
  const last = block[block.length - 1] ?? ''
  const { prev, next } = neighborLines(lines, insertAt, srcStart, srcEnd)

  const head = isHeadingLine(first) && prev !== null && isHeadingLine(prev) ? ['', '', ''] : []
  const tail = isHeadingLine(last) && next !== null && isHeadingLine(next) ? ['', '', ''] : []
  return [...head, ...block, ...tail]
}

/** A.7.1 规则 2 / 3：越界深度与列表父节点强制为列表。其余情况由调用方给出倾向值。 */
function forcedKind(depth: number, parent: MindNode | null, prefer: NodeKind): NodeKind {
  if (depth >= 7) return 'list'
  if (parent && parent.depth > 0 && parent.kind === 'list') return 'list'
  return prefer
}

/** 新节点所在列表块的 listBaseDepth：最近标题祖先 depth + 1。 */
function baseDepthUnder(parent: MindNode | null): number {
  if (!parent) return 1
  if (parent.kind === 'heading') return parent.depth + 1 // 虚拟 root depth 0 → 1
  return listBaseDepthOf(parent)
}

// ── A.7.2 重命名 ───────────────────────────────────────────────

/** 只替换 titleLine 一行，depth / kind 不变。 */
export function renameNode(tree: MindTree, id: string, newText: string): EditPlan {
  assertSingleLine(newText)
  const node = mustGet(tree, id)
  return [
    {
      fromLine: node.titleLine,
      toLine: node.titleLine + 1,
      lines: [serializeNode(newText, node.depth, node.kind, listBaseDepthOf(node))],
    },
  ]
}

// ── A.7.3 插入 ─────────────────────────────────────────────────

/**
 * 在参考节点之后插入同级节点。depth 与参考节点相同。
 *
 * kind：规则 2/3 优先，否则【沿用参考节点的 kind】。
 * 手册 A.7.1 规则 5 说「新建节点默认 heading」，但那条是给「没有可参照的兄弟」
 * 的场景准备的——在一个列表项旁边按回车却得到一个 `#### 标题`，既突兀也不是用户意图。
 */
export function insertSibling(
  tree: MindTree,
  refId: string,
  text: string,
  position: 'after',
  options: ParseOptions,
): EditPlan {
  assertSingleLine(text)
  if (position !== 'after') throw new Error(`不支持的插入位置：${position as string}`)
  const ref = mustGet(tree, refId)
  const kind = forcedKind(ref.depth, ref.parent, ref.kind)
  const line = serializeNode(text, ref.depth, kind, listBaseDepthOf(ref))
  const insertAt = ref.blockEnd
  return [
    {
      fromLine: insertAt,
      toLine: insertAt,
      lines: withSeparators([line], tree.lines, insertAt, options),
    },
  ]
}

/**
 * 在父节点的最后一个子节点之后插入子节点；父节点无子节点时插在 bodyEnd 处。
 *
 * kind：规则 2/3 优先；有已存在的子节点时沿用最后一个子节点的 kind（理由同 insertSibling），
 * 否则按规则 5 取 heading。
 */
export function insertChild(
  tree: MindTree,
  parentId: string | null,
  text: string,
  position: 'last',
  options: ParseOptions,
): EditPlan {
  assertSingleLine(text)
  if (position !== 'last') throw new Error(`不支持的插入位置：${position as string}`)
  const parent = parentId === null ? tree.root : mustGet(tree, parentId)
  const depth = parent.depth + 1
  const lastChild = parent.children[parent.children.length - 1]
  const kind = forcedKind(depth, parent, lastChild ? lastChild.kind : 'heading')
  const line = serializeNode(text, depth, kind, baseDepthUnder(parent))

  const insertAt = lastChild
    ? lastChild.blockEnd
    : parent.depth === 0
      ? contentEnd(tree.lines)
      : parent.bodyEnd

  return [
    {
      fromLine: insertAt,
      toLine: insertAt,
      lines: withSeparators([line], tree.lines, insertAt, options),
    },
  ]
}

/** 新建自由根：追加到文件末尾，depth = 1，kind = heading。 */
export function createRoot(tree: MindTree, text: string, options: ParseOptions): EditPlan {
  assertSingleLine(text)
  const insertAt = contentEnd(tree.lines)
  const line = serializeNode(text, 1, 'heading', 1)
  return [
    {
      fromLine: insertAt,
      toLine: insertAt,
      lines: withSeparators([line], tree.lines, insertAt, options),
    },
  ]
}

// ── A.7.5 删除 ─────────────────────────────────────────────────

/**
 * 删除若干子树。先过滤掉「祖先已在删除列表中」的 id，再按 blockStart 升序合并相邻范围。
 */
export function removeSubtree(tree: MindTree, ids: string[]): EditPlan {
  const nodes = ids.map((id) => mustGet(tree, id))
  const tops = nodes.filter((n) => !nodes.some((other) => other !== n && isAncestorOf(other, n)))

  // 去重（同一个 id 传两次）后按文档序排列
  const uniq = [...new Set(tops)].sort((a, b) => a.blockStart - b.blockStart)

  const plan: EditPlan = []
  for (const n of uniq) {
    const from = n.blockStart
    const to = swallowSeparators(tree.lines, n.blockEnd)
    const prev = plan[plan.length - 1]
    if (prev && prev.toLine >= from) {
      prev.toLine = Math.max(prev.toLine, to) // 相邻/接壤范围合并，避免产生重叠的 TextEdit
    } else {
      plan.push({ fromLine: from, toLine: to, lines: [] })
    }
  }
  return plan
}

// ── A.7.4 移动子树 ─────────────────────────────────────────────

/**
 * 把 `id` 的整棵子树移到 `newParentId` 之下的第 `indexInParent` 个位置。
 *
 * - `newParentId === null` 表示移到虚拟 root 下（成为自由根，depth = 1、kind = heading）。
 * - `indexInParent` 是在【剔除被移动节点之后】的兄弟数组中的下标。
 * - 正文行随子树一起移动，且不做任何缩进调整（A.7.4 第 5 步）。
 */
export function moveSubtree(
  tree: MindTree,
  id: string,
  newParentId: string | null,
  indexInParent: number,
  options: ParseOptions,
): EditPlan {
  const node = mustGet(tree, id)
  const newParent = newParentId === null ? null : mustGet(tree, newParentId)

  // 第 1 步：不能移到自身或自己的后代之下
  if (newParent === node) throw new Error('不能把节点移到它自己之下')
  if (newParent && isAncestorOf(node, newParent)) {
    throw new Error('不能把节点移到它自己的后代之下')
  }

  const parentNode = newParent ?? tree.root
  const siblings = parentNode.children.filter((c) => c !== node)
  if (!Number.isInteger(indexInParent) || indexInParent < 0 || indexInParent > siblings.length) {
    throw new Error(`indexInParent 越界：${indexInParent}，兄弟数 ${siblings.length}`)
  }

  // 第 6 步：插入点（原始行号坐标系）。它只取决于目标位置，与源范围无关，故先算。
  const prevSibling = indexInParent > 0 ? siblings[indexInParent - 1] : undefined
  const insertAt = prevSibling
    ? prevSibling.blockEnd
    : parentNode.depth === 0 && parentNode.children.length === 0
      ? contentEnd(tree.lines)
      : parentNode.bodyEnd

  // 第 2 步：源范围。默认把其后的分隔空行一起搬走，否则空行会在原地堆积。
  //
  // 但「外提」（把子节点变成父节点的下一个兄弟）时，插入点正是父节点的 blockEnd，
  // 而那些空行同时也是父节点块的尾巴——贪心吞掉会把插入点吞进源范围里。
  // 这种情形退回到不吞空行：那些空行马上就要充当新位置的分隔符，本来也不该动。
  const blockStart = node.blockStart
  const greedyEnd = swallowSeparators(tree.lines, node.blockEnd)
  const srcEnd = insertAt > blockStart && insertAt < greedyEnd ? node.blockEnd : greedyEnd

  // 搬走文件最后一块内容时连它【前面】的分隔空行一起收走，否则空行会累积（见上面的注释）。
  // 同样地，插入点落在这些空行中间就退回去——那几行马上要当新位置的分隔符。
  const greedyStart = swallowLeadingSeparators(tree.lines, blockStart, srcEnd)
  const srcStart =
    insertAt > greedyStart && insertAt <= blockStart ? blockStart : greedyStart

  // 第 3、4 步：新的 depth 与 kind
  const newDepth = newParent ? newParent.depth + 1 : 1
  const newKind: NodeKind = newParent ? forcedKind(newDepth, newParent, node.kind) : 'heading'

  // 第 5 步：重新序列化整棵子树（正文随行）
  const block = serializeSubtree(
    tree.lines,
    node,
    newDepth,
    newKind,
    baseDepthUnder(newParent),
    options,
  )

  // 第 7 步：插入点落在源范围【内部】即为非法
  if (insertAt > srcStart && insertAt < srcEnd) {
    throw new Error(`插入点 ${insertAt} 落在被移动的范围 [${srcStart}, ${srcEnd}) 内部`)
  }

  const del: TextEdit = { fromLine: srcStart, toLine: srcEnd, lines: [] }
  const ins: TextEdit = {
    fromLine: insertAt,
    toLine: insertAt,
    lines: withSeparators(block, tree.lines, insertAt, options, srcStart, srcEnd),
  }
  return [del, ins]
}

// ── 选中移动（M5）──────────────────────────────────────────────

export type NavDirection = 'up' | 'down' | 'left' | 'right'

/**
 * 方向键的结果。折叠/展开会改 `collapsed`（那是视图状态），所以这里只返回【意图】，
 * 由视图去执行——本文件保持纯函数。
 */
export type NavAction =
  | { type: 'select'; id: string }
  | { type: 'collapse'; id: string }
  | { type: 'expand'; id: string }

function indexIn(parent: MindNode, node: MindNode): number {
  return parent.children.indexOf(node)
}

/**
 * 方向键在树中移动选中。找不到去处返回 null。
 *
 * - ↑：上一个兄弟；没有则回到父节点
 * - ↓：下一个兄弟；没有则找【最近的、还有下一个兄弟的祖先】的那个兄弟（跨出本支）
 * - →：折叠着就展开；展开着就进第一个子节点
 * - ←：展开着就折叠；已经是叶子或已折叠就回到父节点
 *
 * ↑ 与 ↓ 不完全互逆（↓ 会跨支、↑ 只回父）。这是有意的：
 * ↑↓ 的主职责是「在同级里走」，跨支只是走到头之后的兜底，
 * 而向上走到头时父节点就在正上方，回父比钻进上一支的最深处更符合直觉。
 */
export function navigate(tree: MindTree, id: string, dir: NavDirection): NavAction | null {
  const node = tree.byId.get(id)
  if (!node) return null
  const parent = node.parent

  switch (dir) {
    case 'up': {
      if (!parent) return null
      const prev = parent.children[indexIn(parent, node) - 1]
      if (prev) return { type: 'select', id: prev.id }
      return parent.depth > 0 ? { type: 'select', id: parent.id } : null
    }
    case 'down': {
      let cur: MindNode = node
      while (cur.parent) {
        const p: MindNode = cur.parent
        const next = p.children[indexIn(p, cur) + 1]
        if (next) return { type: 'select', id: next.id }
        if (p.depth === 0) break // 已经到虚拟 root，没有更外层了
        cur = p
      }
      return null
    }
    case 'right': {
      if (node.children.length === 0) return null
      if (node.collapsed) return { type: 'expand', id: node.id }
      const first = node.children[0]
      return first ? { type: 'select', id: first.id } : null
    }
    case 'left': {
      if (node.children.length > 0 && !node.collapsed) return { type: 'collapse', id: node.id }
      return parent && parent.depth > 0 ? { type: 'select', id: parent.id } : null
    }
  }
}

/**
 * 删除某节点后，选中态该落到哪儿：前一个兄弟 → 父节点 → 后一个兄弟。
 *
 * 最后那档是给「删掉第一个根节点」准备的：它没有前兄弟，父节点又是不可选的虚拟 root。
 */
export function selectionAfterRemoval(tree: MindTree, id: string): string | null {
  const node = tree.byId.get(id)
  const parent = node?.parent
  if (!node || !parent) return null
  const i = indexIn(parent, node)
  const prev = parent.children[i - 1]
  if (prev) return prev.id
  if (parent.depth > 0) return parent.id
  const next = parent.children[i + 1]
  return next ? next.id : null
}

/**
 * 把选中提到最近的【可见】祖先上：节点本身没被折叠藏起来时返回它自己。
 *
 * 「折叠全部」（M7 工具栏）之后用得着——选中不能停在一个看不见的节点上，
 * 否则接下来的方向键会从屏幕上根本不存在的地方开始走。
 */
export function visibleAncestor(tree: MindTree, id: string): string | null {
  const node = tree.byId.get(id)
  if (!node) return null
  let visible = node
  // 从自己往上找到【最外层】那个折叠着的祖先——中间还有折叠祖先时，内层那个也是看不见的
  for (let p = node.parent; p && p.depth > 0; p = p.parent) {
    if (p.collapsed) visible = p
  }
  return visible.id
}

// ── 编辑意图 → EditPlan（M5）───────────────────────────────────

/**
 * 一次节点编辑要做的事。视图只负责收集文字，翻译成 EditPlan 的活儿在这里，
 * 于是「Enter 新增同级 → 输入 → 再 Enter」这条链路可以完全脱离 DOM 做单测。
 */
export type EditIntent =
  | { type: 'rename'; id: string }
  | { type: 'sibling'; refId: string }
  | { type: 'child'; parentId: string | null }
  | { type: 'root' }

export interface EditOutcome {
  plan: EditPlan
  /**
   * 提交后，目标节点所在父节点的 id（null = 虚拟 root）与它在 children 里的下标。
   *
   * re-parse 会产出全新对象，新节点更是没有旧 id 可复用，
   * 靠 (parentId, index) 这个【结构位置】才能在新树里重新找到它。
   */
  parentId: string | null
  index: number
}

/** 节点所属父节点的 id；父是虚拟 root 时为 null。 */
function parentIdOf(node: MindNode): string | null {
  const p = node.parent
  return p && p.depth > 0 ? p.id : null
}

/**
 * 把一次编辑意图翻译成 EditPlan + 提交后的定位信息。
 *
 * 调用前必须先把【草稿节点】从树上摘掉：`insertChild` 要数父节点现有的子节点个数，
 * 草稿混在里面会把插入点算到自己后面。
 */
export function planEdit(
  tree: MindTree,
  intent: EditIntent,
  text: string,
  options: ParseOptions,
): EditOutcome {
  switch (intent.type) {
    case 'rename': {
      const node = mustGet(tree, intent.id)
      const parent = node.parent
      return {
        plan: node.text === text ? [] : renameNode(tree, intent.id, text),
        parentId: parentIdOf(node),
        index: parent ? indexIn(parent, node) : 0,
      }
    }
    case 'sibling': {
      const ref = mustGet(tree, intent.refId)
      const parent = ref.parent
      return {
        plan: insertSibling(tree, intent.refId, text, 'after', options),
        parentId: parentIdOf(ref),
        index: parent ? indexIn(parent, ref) + 1 : 0,
      }
    }
    case 'child': {
      const parent = intent.parentId === null ? tree.root : mustGet(tree, intent.parentId)
      return {
        plan: insertChild(tree, intent.parentId, text, 'last', options),
        parentId: intent.parentId,
        index: parent.children.length,
      }
    }
    case 'root':
      return {
        plan: createRoot(tree, text, options),
        parentId: null,
        index: tree.root.children.length,
      }
  }
}

/** 按 (parentId, index) 在树里取节点。配合 planEdit 的返回值使用。 */
export function resolveAt(tree: MindTree, parentId: string | null, index: number): MindNode | null {
  const parent = parentId === null ? tree.root : (tree.byId.get(parentId) ?? null)
  return parent?.children[index] ?? null
}
