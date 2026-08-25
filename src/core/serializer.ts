/**
 * 节点 / 子树 → Markdown 行数组。严格实现 操作手册.md 附录 A 第 A.6、A.7.1、A.8 节。
 *
 * 【禁止】import 任何 obsidian API。
 */

import type { MindNode, MindTree, NodeKind, ParseOptions } from './types'
import { listBaseDepthOf } from './parser'

/** 附录 A.6 序列化公式。 */
export function serializeNode(
  text: string,
  depth: number,
  kind: NodeKind,
  listBaseDepth: number,
): string {
  if (kind === 'heading') {
    return '#'.repeat(Math.min(6, Math.max(1, depth))) + ' ' + text
  }
  return '\t'.repeat(Math.max(0, depth - listBaseDepth)) + '- ' + text
}

/** 装配阶段的中间表示：一个节点行 + 紧随其后的自身正文行。 */
interface Unit {
  line: string
  kind: NodeKind
  body: string[]
}

/**
 * 附录 A.7.1 sticky kind 规则 + 附录 A.8 补充规则。
 *
 * 补充规则：当子树【根】的 kind 因移动而改变时，整个子树按「能用标题就用标题」归一化；
 * 只有根 kind 未变时，后代才适用 sticky 规则 4（保持原 kind）。
 */
function resolveChildKind(
  childDepth: number,
  parentKind: NodeKind,
  originalKind: NodeKind,
  rootKindChanged: boolean,
): NodeKind {
  if (childDepth >= 7) return 'list' // 规则 2
  if (parentKind === 'list') return 'list' // 规则 3：列表下不能有标题
  if (rootKindChanged) return 'heading' // A.8 补充规则
  return originalKind // 规则 4
}

function bodyOf(lines: string[], node: MindNode): string[] {
  return lines.slice(node.titleLine + 1, node.bodyEnd)
}

/**
 * 装配：把 Unit 序列铺成行数组，并应用「严格换行」。
 *
 * 严格换行（A.6）：生成标题行后，若它与下一个标题行之间没有正文，
 * 则补足到【恰好】3 个空行。是「补足到 3」而非「追加 3」，因此反复应用不累积。
 */
function assemble(units: Unit[], options: ParseOptions): string[] {
  const out: string[] = []
  for (let i = 0; i < units.length; i++) {
    const u = units[i] as Unit
    out.push(u.line)
    const next = units[i + 1]
    const bodyIsBlank = u.body.every((l) => l.trim() === '')
    if (options.strictLineBreak && u.kind === 'heading' && next?.kind === 'heading' && bodyIsBlank) {
      out.push('', '', '')
    } else {
      out.push(...u.body)
    }
  }
  return out
}

function collectUnits(
  units: Unit[],
  lines: string[],
  node: MindNode,
  depth: number,
  kind: NodeKind,
  listBaseDepth: number,
  rootKindChanged: boolean,
): void {
  units.push({
    line: serializeNode(node.text, depth, kind, listBaseDepth),
    kind,
    body: bodyOf(lines, node),
  })

  for (const child of node.children) {
    // 保留原树的 depth 差值：`# A` 下直接跟 `### B` 时，B 相对 A 的 +2 必须保留（A.3）。
    const childDepth = depth + (child.depth - node.depth)
    const childKind = resolveChildKind(childDepth, kind, child.kind, rootKindChanged)
    // 列表块的基准 = 最近标题祖先 depth + 1；父是列表则沿用父的基准。
    const childBase = kind === 'heading' ? depth + 1 : listBaseDepth
    collectUnits(units, lines, child, childDepth, childKind, childBase, rootKindChanged)
  }
}

/**
 * 把一棵子树重新序列化为行数组。跨 6/7 层边界的语法转换走的就是这里。
 *
 * 关键约束（附录 A.7.4 第 5 步）：每个节点自身的正文行原样保留在其节点行之后，
 * 且【不做任何缩进调整】——调整正文缩进会破坏代码块等结构。
 */
export function serializeSubtree(
  lines: string[],
  node: MindNode,
  targetDepth: number,
  targetKind: NodeKind,
  listBaseDepth: number,
  options: ParseOptions,
): string[] {
  const units: Unit[] = []
  collectUnits(units, lines, node, targetDepth, targetKind, listBaseDepth, targetKind !== node.kind)
  return assemble(units, options)
}

/**
 * 整棵树 → 行数组。用于幂等性测试，【不用于】写回文件。
 *
 * 写回文件永远走 EditPlan 的最小范围替换（红线 2）。
 */
export function serializeTree(tree: MindTree, options: ParseOptions): string[] {
  const units: Unit[] = []
  for (const child of tree.root.children) {
    collectUnits(units, tree.lines, child, child.depth, child.kind, listBaseDepthOf(child), false)
  }
  const preamble = tree.lines.slice(0, tree.root.bodyEnd)
  return [...preamble, ...assemble(units, options)]
}
