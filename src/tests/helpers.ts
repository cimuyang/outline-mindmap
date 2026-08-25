import type { MindNode, MindTree } from '../core/types'

/** 树的结构快照，用于比较「结构完全相等」——不含 id、不含行号。 */
export interface Shape {
  text: string
  depth: number
  kind: string
  children: Shape[]
}

export function shapeOf(node: MindNode): Shape {
  return {
    text: node.text,
    depth: node.depth,
    kind: node.kind,
    children: node.children.map(shapeOf),
  }
}

export function treeShape(tree: MindTree): Shape[] {
  return tree.root.children.map(shapeOf)
}

/** 文档序遍历所有真实节点（不含虚拟 root）。 */
export function allNodes(tree: MindTree): MindNode[] {
  const out: MindNode[] = []
  const walk = (n: MindNode): void => {
    for (const c of n.children) {
      out.push(c)
      walk(c)
    }
  }
  walk(tree.root)
  return out
}
