import type { MindTree } from './types'
export function showHeadingLevel(tree: MindTree, level: number): void {
  for (const n of tree.byId.values()) {
    n.viewHidden = n.parent !== tree.root && (n.kind === 'list' || n.depth > level)
    n.collapsed = n.children.length > 0 && n.children.every(c => c.kind === 'list' || c.depth > level)
  }
}
export function clearHeadingFilter(tree: MindTree): void { for (const n of tree.byId.values()) delete n.viewHidden }
