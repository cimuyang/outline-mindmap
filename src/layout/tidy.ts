/**
 * 非分层 tidy 布局。节点高度不等。三种方向共用同一套两趟遍历（M9）。
 *
 * 【为什么不需要 Reingold–Tilford 的轮廓合并】
 * RT 的轮廓（contour）是为了让「深度不同的相邻子树」在水平方向互相嵌进去。
 * 本项目的导图是自根向外生长的目录树：同一父节点下的每棵子树各占一条
 * 【互不重叠的水平带】，兄弟之间只在垂直方向排队。因此两趟遍历即可，整体 O(n)，
 * 没有 RT 原始算法里的 shift / apportion。500+ 节点的性能要求（红线 4）靠的就是这一点。
 *
 * 两趟：
 *   1. 后序 —— 算出每棵子树占据的垂直高度 extent
 *   2. 前序 —— 把每条带切给子树，节点在自己的带里垂直居中
 *
 * 「节点在自己的带里垂直居中」+「子树块也在带里垂直居中」两条合起来，
 * 等价于「父节点对齐到子节点块的中心」。
 *
 * 向左只是把水平方向的推进换成 -1：第一趟（垂直）与方向无关，一个字都不用改。
 *
 * 【禁止】import 任何 obsidian API。
 */

import type { MindNode, MindTree } from '../core/types'
import type { Box, LayoutOptions, LayoutResult, Size } from './types'

/** 水平推进方向：+1 向右，-1 向左。 */
type Dir = 1 | -1

interface Item {
  node: MindNode
  size: Size
  /** 整棵子树占据的垂直高度。 */
  extent: number
  /** 折叠时为空数组——折叠的后代根本不参与布局。 */
  children: Item[]
  /** 子树块（所有子节点 extent + 间距）的总高度。 */
  childrenBlock: number
  /** 自身 + 全部【可见】后代的节点数。两侧布局按它分配左右（M9 验收第二条）。 */
  count: number
}

function build(node: MindNode, options: LayoutOptions): Item {
  const size = options.measure(node)
  const children = node.collapsed ? [] : node.children.map((c) => build(c, options))

  let count = 1
  for (const c of children) count += c.count
  const childrenBlock = blockOf(children, options.vGap)

  // 自身比子树块还高时（长标题换行、子节点很少），带高取自身高度
  const extent = children.length > 0 ? Math.max(size.h, childrenBlock) : size.h
  return { node, size, extent, children, childrenBlock, count }
}

/** 一列子树叠起来的总高度（含间距）。空列为 0。 */
function blockOf(items: readonly Item[], vGap: number): number {
  if (items.length === 0) return 0
  let h = 0
  for (const it of items) h += it.extent
  return h + vGap * (items.length - 1)
}

/**
 * 摆放一棵子树。
 *
 * @param anchor 本节点【近侧】边缘的 x：向右时是左边缘，向左时是右边缘。
 *   用近侧而不是左边缘，两个方向才能共用同一段递归。
 */
function place(
  item: Item,
  anchor: number,
  top: number,
  dir: Dir,
  out: LayoutResult,
  options: LayoutOptions,
): void {
  const box: Box = {
    x: dir > 0 ? anchor : anchor - item.size.w,
    y: top + (item.extent - item.size.h) / 2,
    w: item.size.w,
    h: item.size.h,
  }
  out.set(item.node.id, box)

  if (item.children.length === 0) return
  const childAnchor = anchor + dir * (item.size.w + options.hGap)
  stack(item.children, childAnchor, top + (item.extent - item.childrenBlock) / 2, dir, out, options)
}

/** 把一列子树自上而下码放在同一条竖列里。 */
function stack(
  items: readonly Item[],
  anchor: number,
  top: number,
  dir: Dir,
  out: LayoutResult,
  options: LayoutOptions,
): void {
  let y = top
  for (const it of items) {
    place(it, anchor, y, dir, out, options)
    y += it.extent + options.vGap
  }
}

/**
 * 单向布局（向右 / 向左）。
 *
 * 虚拟 root 不渲染、不占位——多个 H1 直接在垂直方向依次排开（M3 交付物最后一条）。
 */
function layoutLinear(tree: MindTree, options: LayoutOptions, dir: Dir): LayoutResult {
  const out: LayoutResult = new Map()
  let top = 0
  for (const root of tree.root.children) {
    const item = build(root, options)
    place(item, 0, top, dir, out, options)
    top += item.extent + options.rootGap
  }
  return out
}

/** 分支向右。 */
export function layoutRight(tree: MindTree, options: LayoutOptions): LayoutResult {
  return layoutLinear(tree, options, 1)
}

/** 分支向左。所有节点的 x 都 ≤ 0（根节点的右边缘贴着原点）。 */
export function layoutLeft(tree: MindTree, options: LayoutOptions): LayoutResult {
  return layoutLinear(tree, options, -1)
}

/**
 * 把根节点的直接子分支分到两侧，【按子树节点数】均衡（M9 验收第二条）。
 *
 * 贪心：每次把下一个分支交给当前较轻的一侧。文档序在各自那一侧内部完整保留——
 * 用户在笔记里看到的先后顺序，在导图的每一列里仍然从上到下成立。
 * 两边一样重时给右边：只有一个子节点时它不该跑到左边去，与默认的「分支向右」保持一致。
 */
function split(children: readonly Item[]): { left: Item[]; right: Item[] } {
  const left: Item[] = []
  const right: Item[] = []
  let lw = 0
  let rw = 0
  for (const c of children) {
    if (rw <= lw) {
      right.push(c)
      rw += c.count
    } else {
      left.push(c)
      lw += c.count
    }
  }
  return { left, right }
}

/**
 * 分支两侧。
 *
 * 左右两列在水平方向天然分开（左列全在根的左边缘之左，右列全在右边缘之右），
 * 因此两侧的竖直方向【各排各的】，不必互相让位——矩形照样两两不重叠。
 */
export function layoutBoth(tree: MindTree, options: LayoutOptions): LayoutResult {
  const out: LayoutResult = new Map()
  let top = 0
  for (const root of tree.root.children) {
    const item = build(root, options)
    const { left, right } = split(item.children)
    const leftBlock = blockOf(left, options.vGap)
    const rightBlock = blockOf(right, options.vGap)
    // 根的带高要同时容得下两侧，且自身再高也不能被压扁
    const extent = Math.max(item.size.h, leftBlock, rightBlock)

    out.set(item.node.id, {
      x: 0,
      y: top + (extent - item.size.h) / 2,
      w: item.size.w,
      h: item.size.h,
    })
    // 两侧各自在带内垂直居中 → 根节点看上去正落在左右两列的中间
    stack(left, -options.hGap, top + (extent - leftBlock) / 2, -1, out, options)
    stack(right, item.size.w + options.hGap, top + (extent - rightBlock) / 2, 1, out, options)

    top += extent + options.rootGap
  }
  return out
}
