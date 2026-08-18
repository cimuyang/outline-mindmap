/**
 * 连线。单层 SVG，【所有连线合并成一条 path】。
 *
 * 500 个节点就是 500 条边；如果每条边一个 <path> 元素，光是元素数量就够卡了。
 * 它们的描边样式完全相同，因此可以合并进同一个 `d`——DOM 里永远只有一个元素。
 */

import type { MindNode } from '../core/types'
import type { Box, BranchStyle, LayoutResult } from '../layout/types'

/** 折线的拐角半径上限（M11）。实际半径还要被水平间距与高度差夹住。 */
const CORNER = 8

export class Connectors {
  private readonly path: SVGPathElement
  private lastD = ''
  private lastSize = ''

  constructor(private readonly svg: SVGSVGElement) {
    this.path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    this.path.setAttribute('class', 'om-edges')
    this.path.setAttribute('fill', 'none')
    this.svg.appendChild(this.path)
  }

  /**
   * @param nodes 可见节点（文档序）
   * @param boxes 布局结果
   * @param style 直线 / 斜线（贝塞尔）/ 折线
   * @param width/height 内容右下角。向左的分支坐标为负、画在 svg 盒子外面，
   *   靠 `.om-svg { overflow: visible }` 照常显示；这两个值只用来撑出元素本身的大小
   */
  render(nodes: MindNode[], boxes: LayoutResult, style: BranchStyle, width: number, height: number): void {
    let d = ''
    for (const node of nodes) {
      const parent = node.parent
      if (!parent) continue
      const from = boxes.get(parent.id) // 虚拟 root 没有 Box，根节点因此没有入边
      const to = boxes.get(node.id)
      if (!from || !to) continue
      d += edgePath(from, to, style)
    }

    // 内容整个落在负半轴时（分支向左）右下角会是负数，属性里不能出现负的宽高
    const w = Math.max(0, width)
    const h = Math.max(0, height)
    const size = `${w}x${h}`
    if (this.lastSize !== size) {
      this.svg.setAttribute('width', `${w}`)
      this.svg.setAttribute('height', `${h}`)
      this.lastSize = size
    }
    if (this.lastD !== d) {
      this.path.setAttribute('d', d)
      this.lastD = d
    }
  }

  destroy(): void {
    this.path.remove()
  }
}

/**
 * 一条父子连线的 `d` 片段。【纯函数、零 DOM】，三种样式的几何都在这里，可以直接单测。
 *
 * 接点跟着分支的朝向走（M9）：子节点在左边，就从父节点的左边缘出发接到它的右边缘。
 * 按坐标判断而不是按布局方向——两侧布局里左右两列在同一次绘制里都要认对。
 */
export function edgePath(from: Box, to: Box, style: BranchStyle): string {
  const leftward = to.x + to.w <= from.x
  const x1 = leftward ? from.x : from.x + from.w
  const y1 = from.y + from.h / 2
  const x2 = leftward ? to.x + to.w : to.x
  const y2 = to.y + to.h / 2

  if (style === 'curve') {
    const mid = (x1 + x2) / 2
    return `M${r(x1)} ${r(y1)}C${r(mid)} ${r(y1)} ${r(mid)} ${r(y2)} ${r(x2)} ${r(y2)}`
  }
  if (style === 'elbow') return elbow(x1, y1, x2, y2)
  return line(x1, y1, x2, y2)
}

/**
 * 圆角直角折线（M11）。
 *
 * 主干线取父子的水平中点。【不需要按父节点分组】：`tidy.ts` 里同一父节点的所有子节点
 * 共用 `childAnchor`，兄弟的近侧边缘 x 天然相同，各自算出来的 `mid` 因此是同一条竖线。
 */
function elbow(x1: number, y1: number, x2: number, y2: number): string {
  const sx = Math.sign(x2 - x1) // 主干线在父节点的哪一侧：向右 +1，向左 -1
  const sy = Math.sign(y2 - y1)
  // 半径必须被水平间距和高度差同时夹住：独生子与父节点等高时高度差趋近 0，
  // 不夹就会在一条直线上画出两个小勾
  const rad = Math.min(CORNER, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2)
  if (rad <= 0.5) return line(x1, y1, x2, y2)

  const mid = (x1 + x2) / 2
  return (
    `M${r(x1)} ${r(y1)}` +
    `L${r(mid - sx * rad)} ${r(y1)}` +
    `Q${r(mid)} ${r(y1)} ${r(mid)} ${r(y1 + sy * rad)}` +
    `L${r(mid)} ${r(y2 - sy * rad)}` +
    `Q${r(mid)} ${r(y2)} ${r(mid + sx * rad)} ${r(y2)}` +
    `L${r(x2)} ${r(y2)}`
  )
}

function line(x1: number, y1: number, x2: number, y2: number): string {
  return `M${r(x1)} ${r(y1)}L${r(x2)} ${r(y2)}`
}

/** 保留两位小数。d 属性短一点，字符串比较也快一点。 */
function r(v: number): number {
  return Math.round(v * 100) / 100
}
