/**
 * 视图层里少数几个「纯计算」的部分。
 *
 * 其余部分（DOM、事件、焦点）没法在 node 环境里测，靠 附录 D 的人工验收；
 * 但视野跟随的位移量和文本清洗是可以脱离 DOM 算清楚的，就别留给手工点。
 */

import { describe, expect, it } from 'vitest'
import type { Box } from '../layout/types'
import { centerTranslate, shiftInto } from '../view/Canvas'
import { edgePath } from '../view/Connectors'
import { sanitize } from '../view/Editor'
import { toggleSize } from '../view/measure'

describe('shiftInto（视野跟随的最小平移）', () => {
  const SIZE = 800
  const MARGIN = 40

  it('已经在安全区内 → 不动', () => {
    expect(shiftInto(100, 300, SIZE, MARGIN)).toBe(0)
    // 正好贴着边距也算在里面
    expect(shiftInto(40, 760, SIZE, MARGIN)).toBe(0)
  })

  it('左/上越界 → 平移到刚好留出边距', () => {
    expect(shiftInto(-100, 0, SIZE, MARGIN)).toBe(140)
    expect(shiftInto(10, 100, SIZE, MARGIN)).toBe(30)
  })

  it('右/下越界 → 平移到刚好留出边距', () => {
    expect(shiftInto(700, 900, SIZE, MARGIN)).toBe(-140)
  })

  it('两侧都生效，且是【最小】平移：移完刚好贴住边距', () => {
    const dx = shiftInto(900, 1000, SIZE, MARGIN)
    expect(900 + dx).toBe(SIZE - MARGIN - 100)
    const dy = shiftInto(-500, -400, SIZE, MARGIN)
    expect(-500 + dy).toBe(MARGIN)
  })

  it('目标比可视区还大 → 对齐起始边，看得见开头', () => {
    expect(shiftInto(200, 1400, SIZE, MARGIN)).toBe(-160)
    // 已经占满整个安全区就别再动了，否则每次都会抖一下
    expect(shiftInto(-100, 1400, SIZE, MARGIN)).toBe(0)
  })
})

describe('centerTranslate（展开/折叠后把目标摆到正中，M10）', () => {
  const VIEW = 800

  /** 平移之后目标的中心是否落在视口中心。 */
  const centerAfter = (lo: number, size: number): number => lo + centerTranslate(lo, size, VIEW) + size / 2

  it('小于视口的目标：移完正好居中', () => {
    expect(centerAfter(0, 100)).toBe(VIEW / 2)
    expect(centerAfter(5000, 100)).toBe(VIEW / 2)
    expect(centerAfter(-3000, 240)).toBe(VIEW / 2)
  })

  it('比视口还大的目标也照样居中：看得见的是中间那一段', () => {
    expect(centerAfter(0, 2000)).toBe(VIEW / 2)
    expect(centerTranslate(0, 2000, VIEW)).toBe(-600)
  })

  it('已经在正中就不动——反复折叠同一个节点不该来回抖', () => {
    const lo = 350
    const t = centerTranslate(lo, 100, VIEW)
    expect(t).toBe(0)
  })

  it('与「适应画布」是同一个公式：整块内容居中后两边留白相等', () => {
    const t = centerTranslate(120, 300, VIEW)
    expect(120 + t).toBe(VIEW - (120 + t + 300))
  })
})

describe('edgePath（连线几何，M11 加了折线）', () => {
  const parent: Box = { x: 0, y: 0, w: 100, h: 20 } // 右缘 x=100，中线 y=10
  const below: Box = { x: 200, y: 100, w: 80, h: 20 } // 左缘 x=200，中线 y=110
  const above: Box = { x: 200, y: -100, w: 80, h: 20 }

  /** 路径里的所有坐标对。 */
  const points = (d: string): number[][] => {
    const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
    const out: number[][] = []
    for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i] as number, nums[i + 1] as number])
    return out
  }
  const first = (d: string): number[] => points(d)[0] as number[]
  const last = (d: string): number[] => points(d)[points(d).length - 1] as number[]

  it('三种样式的起点终点完全一致：接点由布局定，样式只管中间怎么走', () => {
    for (const style of ['straight', 'curve', 'elbow'] as const) {
      const d = edgePath(parent, below, style)
      expect(first(d)).toEqual([100, 10]) // 父节点右缘中点
      expect(last(d)).toEqual([200, 110]) // 子节点左缘中点
    }
  })

  it('折线的拐点都落在父子的水平中点上', () => {
    const d = edgePath(parent, below, 'elbow')
    // 中间那几个点（去掉首尾）应当全在主干线 x=150 附近：竖直段与两个圆角的控制点
    const mid = points(d).slice(1, -1)
    expect(mid.length).toBeGreaterThan(0)
    for (const [x] of mid) expect(Math.abs((x as number) - 150)).toBeLessThanOrEqual(8)
    expect(d).toContain('Q150 10 150 18') // 上拐角：半径 8
    expect(d).toContain('Q150 110 158 110') // 下拐角
  })

  it('兄弟共用同一条主干线——布局给了它们相同的近侧边缘，不需要按父节点分组', () => {
    const a = edgePath(parent, below, 'elbow')
    const b = edgePath(parent, above, 'elbow')
    // 第 3 个点是第一个圆角的控制点，它就落在主干线上
    const trunk = (d: string): number => (points(d)[2] as number[])[0] as number
    expect(trunk(a)).toBe(150)
    expect(trunk(b)).toBe(150)
  })

  it('子节点在上方 → 竖直段朝上，圆角跟着翻', () => {
    const d = edgePath(parent, above, 'elbow')
    expect(last(d)).toEqual([200, -90])
    expect(d).toContain('Q150 10 150 2') // 半径 8，向上
  })

  it('分支向左时整条路径镜像：从父节点左缘出发，主干线在左边', () => {
    const left: Box = { x: -280, y: 100, w: 80, h: 20 }
    const d = edgePath(parent, left, 'elbow')
    expect(first(d)).toEqual([0, 10]) // 父节点【左】缘
    expect(last(d)).toEqual([-200, 110]) // 子节点【右】缘
    expect((points(d)[2] as number[])[0]).toBe(-100) // 主干线在父子的水平中点
    // 一个点都不该跑到父节点右边去
    for (const [x] of points(d)) expect(x as number).toBeLessThanOrEqual(0)
  })

  it('圆角半径被高度差夹住：挨得很近的父子不会画出小勾', () => {
    const near: Box = { x: 200, y: 4, w: 80, h: 20 } // 中线 y=14，只差 4
    const d = edgePath(parent, near, 'elbow')
    expect(d).toContain('Q150 10 150 12') // 半径 2，不是 8
  })

  it('父子等高（独生子）→ 退化成一条水平直线，与「直线」完全相同', () => {
    const aligned: Box = { x: 200, y: 0, w: 80, h: 20 }
    expect(edgePath(parent, aligned, 'elbow')).toBe(edgePath(parent, aligned, 'straight'))
  })

  it('水平间距为 0 也不产生 NaN', () => {
    const touching: Box = { x: 100, y: 100, w: 80, h: 20 }
    for (const style of ['straight', 'curve', 'elbow'] as const) {
      expect(edgePath(parent, touching, style)).not.toContain('NaN')
    }
  })

  it('直线与斜线保持原样（M3/M8 的行为不许被折线带偏）', () => {
    expect(edgePath(parent, below, 'straight')).toBe('M100 10L200 110')
    expect(edgePath(parent, below, 'curve')).toBe('M100 10C150 10 150 110 200 110')
  })
})

describe('toggleSize（折叠按钮直径，M11）', () => {
  it('字号 1.0 时是 16px——比原来的 14px 大一圈，但仍不喧宾夺主', () => {
    expect(toggleSize(1)).toBe(16)
  })

  it('跟着字号缩放走，两头夹住', () => {
    expect(toggleSize(0.6)).toBe(14) // 下限：再小就点不中
    expect(toggleSize(2)).toBe(24) // 上限：再大会盖掉节点边缘
    expect(toggleSize(1.4)).toBe(22)
  })

  it('单调不减，且永远是整数像素', () => {
    let prev = 0
    for (let s = 0.6; s <= 2.0001; s += 0.05) {
      const v = toggleSize(s)
      expect(v).toBeGreaterThanOrEqual(prev)
      expect(Number.isInteger(v)).toBe(true)
      prev = v
    }
  })
})

describe('sanitize（节点文本必须单行）', () => {
  it('换行、Tab、连续空白一律折成一个空格', () => {
    expect(sanitize('甲\n乙')).toBe('甲 乙')
    expect(sanitize('甲\r\n乙')).toBe('甲 乙')
    expect(sanitize('甲\t\t乙')).toBe('甲 乙')
    expect(sanitize('甲   乙')).toBe('甲 乙')
  })

  it('不 trim：正在打字的人刚敲下的那个空格不能被吞掉', () => {
    expect(sanitize('甲 ')).toBe('甲 ')
    expect(sanitize(' 甲')).toBe(' 甲')
  })

  it('清洗后的文本一定能过 tree.ts 的单行校验', () => {
    expect(/[\r\n]/.test(sanitize('a\nb\r\nc'))).toBe(false)
  })
})
