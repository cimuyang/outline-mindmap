/**
 * 布局层类型。见 操作手册.md 第 3 章目录结构、M3 交付物。
 *
 * 【禁止】import 任何 obsidian API，也不许碰 DOM。
 * 节点尺寸由调用方通过 options.measure 注入——布局算法不知道字体是什么。
 */

import type { MindNode } from '../core/types'

export interface Size {
  w: number
  h: number
}

/**
 * 节点在布局坐标系中的位置。x / y 是【左上角】。
 *
 * 原点在第一个根节点的【近侧】上角：分支向右时就是内容左上角；向左 / 两侧时
 * 左边的分支会落在负半轴上。视口（Canvas）与外接矩形（boundsOf）都不假设坐标非负。
 */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 布局方向（M9 补齐）。
 *
 * 'both' = 两侧：单个根节点的直接子分支【按子树节点数】均衡分列左右，
 * 更深的后代跟着自己所在的那一侧继续长。
 */
export type LayoutDirection = 'right' | 'left' | 'both'

/**
 * 连线形状。几何在 `view/Connectors.ts` 的 `edgePath()` 里，布局层只是把这个选项传下去。
 *
 * 'elbow' = 圆角直角折线（M11）：水平出线 → 在父子中间的主干线上拐弯 → 竖直 → 水平接入。
 */
export type BranchStyle = 'straight' | 'curve' | 'elbow'

export interface LayoutOptions {
  direction: LayoutDirection
  /** 父节点右边缘 → 子节点左边缘的水平间距。 */
  hGap: number
  /** 同一父节点下，相邻两棵子树之间的垂直间距。 */
  vGap: number
  /** 多个根节点（多个 H1）之间的垂直间距。 */
  rootGap: number
  /** 节点尺寸测量。布局层不接触 DOM，尺寸从外面喂进来（view/measure.ts）。 */
  measure: (node: MindNode) => Size
}

export const DEFAULT_LAYOUT: Omit<LayoutOptions, 'measure'> = {
  direction: 'right',
  hGap: 48,
  vGap: 12,
  rootGap: 40,
}

/** nodeId → Box。折叠节点的后代不出现在结果里。 */
export type LayoutResult = Map<string, Box>
