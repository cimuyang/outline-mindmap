/**
 * 节点身份稳定性。见 操作手册.md 第 4.5 节。
 *
 * 每次 re-parse 都会产出全新对象，直接用新对象会让折叠态和选中态在每次按键后丢失。
 * reconcile 把旧树的 id / collapsed 迁移到新树上。
 *
 * 【禁止】import 任何 obsidian API。
 */

import type { MindNode, MindTree } from './types'

/** 归一化编辑距离阈值：小于此值认为「用户正在改这个节点的字」。 */
const SIMILAR_THRESHOLD = 0.5

/**
 * Levenshtein 距离，滚动两行。
 *
 * 节点文本是标题，通常很短；长度差已超过阈值时直接短路，不进 DP。
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = new Array<number>(b.length + 1)
  let cur = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min((cur[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost)
    }
    const t = prev
    prev = cur
    cur = t
  }
  return prev[b.length] ?? 0
}

/** 归一化编辑距离 < 50%。 */
function isSimilar(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length)
  if (max === 0) return true
  if (Math.abs(a.length - b.length) / max >= SIMILAR_THRESHOLD) return false
  return editDistance(a, b) / max < SIMILAR_THRESHOLD
}

/**
 * 同一父节点下的子节点配对。按第 4.5 节的优先级分三轮贪心：
 * 1. text 与 kind 都相同
 * 2. text 相同（kind 不同 = 发生了跨界转换）
 * 3. 同下标 且 编辑距离 < 50%（用户正在改这个节点的字）
 */
function matchChildren(oldChildren: MindNode[], newChildren: MindNode[]): Map<MindNode, MindNode> {
  const pairs = new Map<MindNode, MindNode>()
  const usedOld = new Set<MindNode>()

  const tryMatch = (predicate: (o: MindNode, n: MindNode, i: number) => boolean): void => {
    for (let i = 0; i < newChildren.length; i++) {
      const n = newChildren[i]
      if (!n || pairs.has(n)) continue
      for (const o of oldChildren) {
        if (usedOld.has(o)) continue
        if (predicate(o, n, i)) {
          pairs.set(n, o)
          usedOld.add(o)
          break
        }
      }
    }
  }

  tryMatch((o, n) => o.text === n.text && o.kind === n.kind)
  tryMatch((o, n) => o.text === n.text)
  tryMatch((o, n, i) => oldChildren[i] === o && isSimilar(o.text, n.text))

  return pairs
}

/** 旧树里用过的最大编号，新 id 从它之后接着发，保证不与复用的 id 撞车。 */
function maxIdNumber(tree: MindTree): number {
  let max = 0
  for (const id of tree.byId.keys()) {
    const m = /^n(\d+)$/.exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

/**
 * 把 oldTree 的 id / collapsed 迁移到 newTree。
 *
 * 【原地修改 newTree】并返回它——newTree 是刚 parse 出来的临时对象，
 * 复制一份只是浪费。oldTree 不会被修改。
 */
export function reconcile(oldTree: MindTree | null, newTree: MindTree): MindTree {
  if (!oldTree) return newTree

  let counter = maxIdNumber(oldTree)
  const nextId = (): string => `n${++counter}`

  newTree.byId.clear()
  newTree.root.id = oldTree.root.id
  newTree.root.collapsed = oldTree.root.collapsed

  /** oldNode 为 null 表示这一整支都是新增的，直接发新 id。 */
  const walk = (oldNode: MindNode | null, newNode: MindNode): void => {
    const pairs = oldNode ? matchChildren(oldNode.children, newNode.children) : null
    for (const child of newNode.children) {
      const matched = pairs?.get(child) ?? null
      if (matched) {
        child.id = matched.id
        child.collapsed = matched.collapsed
      } else {
        child.id = nextId()
      }
      newTree.byId.set(child.id, child)
      walk(matched, child)
    }
  }
  walk(oldTree.root, newTree.root)

  return newTree
}
