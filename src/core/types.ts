/**
 * 核心类型定义。见 操作手册.md 附录 B。
 *
 * 本文件与整个 src/core/ 一样，【禁止】import 任何 obsidian API。
 */

export type NodeKind = 'heading' | 'list'

export interface MindNode {
  /** 稳定 ID，形如 'n1'。parse 内单调递增；跨次解析的稳定性由 reconcile 维护（M2）。 */
  id: string
  /** 原始内联 Markdown，未渲染。标题已去除 `#` 前缀与尾部闭合 `#` 序列，列表已去除标记。 */
  text: string
  /** 1-based。虚拟 root 为 0。 */
  depth: number
  kind: NodeKind
  children: MindNode[]
  /** 虚拟 root 的 parent 为 null。 */
  parent: MindNode | null

  // ── 源映射（0-based 行号，范围一律为 [start, end) 半开区间）──

  /** 节点自身所在行。虚拟 root 为 -1。 */
  titleLine: number
  /** 自身正文结束 = 第一个子节点的 titleLine；无子节点时 = blockEnd。 */
  bodyEnd: number
  /** === titleLine。虚拟 root 为 -1，其前导正文范围是 [0, bodyEnd)。 */
  blockStart: number
  /** 整个子树结束，已修剪尾部连续空行。 */
  blockEnd: number

  /** 视图状态，不属于文档，不落盘。 */
  collapsed: boolean
}

export interface MindTree {
  /** 虚拟 root，depth = 0，不渲染、不参与序列化。 */
  root: MindNode
  byId: Map<string, MindNode>
  /** 解析时的原始行快照，applyPlan 的基准。不含行尾符。 */
  lines: string[]
  /** 保留原文件换行符，写回时必须一致。 */
  eol: '\n' | '\r\n'
}

export interface TextEdit {
  /** inclusive */
  fromLine: number
  /** exclusive */
  toLine: number
  /** 替换内容；空数组 = 纯删除 */
  lines: string[]
}

export type EditPlan = TextEdit[]

export interface ParseOptions {
  /** 严格换行。只影响序列化，不影响解析。 */
  strictLineBreak: boolean
}

export const DEFAULT_OPTIONS: ParseOptions = {
  strictLineBreak: true,
}
