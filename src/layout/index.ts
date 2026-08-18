/**
 * 布局分发。三种方向：向右 / 向左 / 两侧（M9）。
 *
 * 【禁止】import 任何 obsidian API。
 */

import type { MindNode, MindTree } from '../core/types'
import { layoutBoth, layoutLeft, layoutRight } from './tidy'
import type { Box, LayoutDirection, LayoutOptions, LayoutResult } from './types'

export * from './types'
export { layoutBoth, layoutLeft, layoutRight } from './tidy'

/** 可选的布局方向，按菜单里的先后顺序。工具栏据此建菜单，不必自己维护一份清单。 */
export const LAYOUT_DIRECTIONS: readonly LayoutDirection[] = ['right', 'left', 'both']

export function layout(tree: MindTree, options: LayoutOptions): LayoutResult {
  switch (options.direction) {
    case 'right':
      return layoutRight(tree, options)
    case 'left':
      return layoutLeft(tree, options)
    case 'both':
      return layoutBoth(tree, options)
  }
}

/** 节点朝哪一侧生长。折叠按钮的位置、连线的接点、水平方向键的含义都按它来。 */
export type NodeSide = 'left' | 'right'

/**
 * 节点相对父节点在哪一侧。
 *
 * 纯几何判断，不看 direction：两侧布局里同一次布局的左右两列都要认对，
 * 而每个节点自己的 Box 已经把答案写在坐标里了。
 *
 * @param parentBox 父节点的 Box。根节点的父亲是不渲染的虚拟 root，没有 Box → 用 fallback
 */
export function sideOf(box: Box, parentBox: Box | undefined, fallback: NodeSide): NodeSide {
  if (!parentBox) return fallback
  return box.x + box.w <= parentBox.x ? 'left' : 'right'
}

/**
 * 根节点算哪一侧。
 *
 * 两侧布局的根两边都有子节点，本来无所谓左右；取「右」是为了跟默认布局一致——
 * 折叠按钮和 →/← 的含义不会因为换了个布局就跳到相反的一边。
 */
export function rootSide(direction: LayoutDirection): NodeSide {
  return direction === 'left' ? 'left' : 'right'
}

/**
 * 文档序遍历「当前可见」的节点：折叠节点自身可见，其后代不可见。
 *
 * 与 layout() 的可见性判定必须完全一致——渲染层拿这个列表去取 Box。
 */
export function visibleNodes(tree: MindTree): MindNode[] {
  const out: MindNode[] = []
  const walk = (n: MindNode): void => {
    for (const c of n.children) {
      out.push(c)
      if (!c.collapsed) walk(c)
    }
  }
  walk(tree.root)
  return out
}

/**
 * 一个节点连同它【当前可见】的后代的外接矩形（M10：展开 / 折叠后的视野跟随）。
 *
 * 折叠着的节点后代没有 Box，结果自然收缩成它自己那一个盒子——
 * 「折叠时同步收起视野」不需要任何特判，折叠前后各算一次就够了。
 *
 * @returns 节点本身不在布局结果里（被折叠的祖先藏起来了）时返回 null
 */
export function subtreeBounds(node: MindNode, boxes: LayoutResult): Box | null {
  const own = boxes.get(node.id)
  if (!own) return null
  let minX = own.x
  let minY = own.y
  let maxX = own.x + own.w
  let maxY = own.y + own.h
  const walk = (n: MindNode): void => {
    if (n.collapsed) return // 后代都没有 Box，不必再往下走
    for (const c of n.children) {
      const b = boxes.get(c.id)
      if (b) {
        if (b.x < minX) minX = b.x
        if (b.y < minY) minY = b.y
        if (b.x + b.w > maxX) maxX = b.x + b.w
        if (b.y + b.h > maxY) maxY = b.y + b.h
      }
      walk(c)
    }
  }
  walk(node)
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** 内容外接矩形。空布局返回零矩形。 */
export function boundsOf(result: LayoutResult): Box {
  if (result.size === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of result.values()) {
    if (b.x < minX) minX = b.x
    if (b.y < minY) minY = b.y
    if (b.x + b.w > maxX) maxX = b.x + b.w
    if (b.y + b.h > maxY) maxY = b.y + b.h
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
