import { describe, expect, it } from 'vitest'
import { parse } from '../core/parser'
import type { MindNode, MindTree } from '../core/types'
import { boundsOf, layout, rootSide, sideOf, subtreeBounds, visibleNodes } from '../layout'
import type { Box, LayoutOptions, LayoutResult } from '../layout/types'

/** 固定尺寸的假测量：宽 = 字数 × 10 + 20，高恒为 20。布局算法与字体无关。 */
const measure = (node: MindNode): { w: number; h: number } => ({
  w: node.text.length * 10 + 20,
  h: 20,
})

const OPTS: LayoutOptions = {
  direction: 'right',
  hGap: 40,
  vGap: 10,
  rootGap: 30,
  measure,
}

function boxOf(tree: MindTree, res: LayoutResult, text: string): Box {
  const node = allNodes(tree).find((n) => n.text === text)
  if (!node) throw new Error(`找不到节点：${text}`)
  const box = res.get(node.id)
  if (!box) throw new Error(`节点没有布局结果：${text}`)
  return box
}

function allNodes(tree: MindTree): MindNode[] {
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

function centerY(b: Box): number {
  return b.y + b.h / 2
}

/** 同一父节点下的兄弟子树垂直方向不重叠——这是「不需要轮廓合并」的前提。 */
function assertNoOverlap(tree: MindTree, res: LayoutResult): void {
  const boxes = [...res.values()]
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i] as Box
      const b = boxes[j] as Box
      const overlapX = a.x < b.x + b.w && b.x < a.x + a.w
      const overlapY = a.y < b.y + b.h && b.y < a.y + a.h
      expect(overlapX && overlapY).toBe(false)
    }
  }
  expect(res.size).toBe(visibleNodes(tree).length)
}

describe('layout（分支向右）', () => {
  it('单根：根在 x=0，子节点在父的右边缘 + hGap', () => {
    const tree = parse('# 一\n## 甲\n')
    const res = layout(tree, OPTS)
    const root = boxOf(tree, res, '一')
    const child = boxOf(tree, res, '甲')
    expect(root.x).toBe(0)
    expect(child.x).toBe(root.x + root.w + OPTS.hGap)
  })

  it('父节点垂直居中于子节点块', () => {
    const tree = parse('# 一\n## 甲\n## 乙\n## 丙\n')
    const res = layout(tree, OPTS)
    const first = boxOf(tree, res, '甲')
    const last = boxOf(tree, res, '丙')
    expect(centerY(boxOf(tree, res, '一'))).toBeCloseTo((centerY(first) + centerY(last)) / 2)
  })

  it('兄弟之间正好隔 vGap', () => {
    const tree = parse('# 一\n## 甲\n## 乙\n')
    const res = layout(tree, OPTS)
    const a = boxOf(tree, res, '甲')
    const b = boxOf(tree, res, '乙')
    expect(b.y - (a.y + a.h)).toBe(OPTS.vGap)
  })

  it('节点宽度不等时，每一层的 x 各自计算，不做列对齐', () => {
    const tree = parse('# 短\n## 很长很长很长的标题\n### 子\n# 长一些的根\n## 甲\n')
    const res = layout(tree, OPTS)
    const long = boxOf(tree, res, '很长很长很长的标题')
    expect(boxOf(tree, res, '子').x).toBe(long.x + long.w + OPTS.hGap)
    // 另一棵树里同深度的节点 x 不同 —— 证明不是按层对齐的
    expect(boxOf(tree, res, '甲').x).not.toBe(long.x)
  })

  it('多个 H1 在垂直方向排开，都从 x=0 开始', () => {
    const tree = parse('# 一\n## 甲\n# 二\n# 三\n')
    const res = layout(tree, OPTS)
    const a = boxOf(tree, res, '一')
    const b = boxOf(tree, res, '二')
    const c = boxOf(tree, res, '三')
    expect([a.x, b.x, c.x]).toEqual([0, 0, 0])
    expect(a.y).toBeLessThan(b.y)
    expect(b.y).toBeLessThan(c.y)
    // 第一棵树有两行高，间距按 rootGap
    expect(b.y - (boxOf(tree, res, '甲').y + 20)).toBe(OPTS.rootGap)
  })

  it('折叠节点自身有位置，后代完全不参与布局', () => {
    const tree = parse('# 一\n## 甲\n### 甲子\n## 乙\n')
    const jia = allNodes(tree).find((n) => n.text === '甲') as MindNode
    jia.collapsed = true
    const res = layout(tree, OPTS)
    expect(res.has(jia.id)).toBe(true)
    expect(res.size).toBe(3)
    expect(visibleNodes(tree).map((n) => n.text)).toEqual(['一', '甲', '乙'])
  })

  it('折叠后整体高度收缩', () => {
    const tree = parse('# 一\n## 甲\n### 甲子\n### 甲丑\n## 乙\n')
    const before = boundsOf(layout(tree, OPTS)).h
    ;(allNodes(tree).find((n) => n.text === '甲') as MindNode).collapsed = true
    expect(boundsOf(layout(tree, OPTS)).h).toBeLessThan(before)
  })

  it('自身比子树块高时，子树块居中于自身', () => {
    // 一个子节点（高 20）挂在父节点下，父自身也高 20 → 两者中心重合
    const tree = parse('# 一\n## 甲\n')
    const res = layout(tree, OPTS)
    expect(centerY(boxOf(tree, res, '一'))).toBe(centerY(boxOf(tree, res, '甲')))
  })

  it('任意两个节点的矩形都不重叠', () => {
    for (const md of [
      '# 一\n## 甲\n### 甲子\n### 甲丑\n## 乙\n# 二\n',
      '###### 六\n- 甲\n\t- 乙\n\t\t- 丙\n- 丁\n',
      '# 一\n## 甲\n## 乙\n## 丙\n## 丁\n## 戊\n',
    ]) {
      const tree = parse(md)
      assertNoOverlap(tree, layout(tree, OPTS))
    }
  })

  it('列表节点与标题节点一视同仁（布局不关心 kind）', () => {
    const tree = parse('###### 六\n- 甲\n\t- 乙\n')
    const res = layout(tree, OPTS)
    const six = boxOf(tree, res, '六')
    const jia = boxOf(tree, res, '甲')
    expect(jia.x).toBe(six.x + six.w + OPTS.hGap)
    expect(boxOf(tree, res, '乙').x).toBe(jia.x + jia.w + OPTS.hGap)
  })

  it('空文件 → 空布局、零外接矩形', () => {
    const res = layout(parse(''), OPTS)
    expect(res.size).toBe(0)
    expect(boundsOf(res)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })

  it('纯正文无标题 → 空布局', () => {
    expect(layout(parse('只有正文\n没有标题\n'), OPTS).size).toBe(0)
  })

  it('boundsOf 覆盖所有节点', () => {
    const tree = parse('# 一\n## 甲\n### 甲子\n# 二\n')
    const res = layout(tree, OPTS)
    const b = boundsOf(res)
    for (const box of res.values()) {
      expect(box.x).toBeGreaterThanOrEqual(b.x)
      expect(box.y).toBeGreaterThanOrEqual(b.y)
      expect(box.x + box.w).toBeLessThanOrEqual(b.x + b.w)
      expect(box.y + box.h).toBeLessThanOrEqual(b.y + b.h)
    }
  })

  it('布局是纯函数：不修改树，同样输入两次结果相同', () => {
    const tree = parse('# 一\n## 甲\n### 甲子\n# 二\n')
    const a = layout(tree, OPTS)
    const b = layout(tree, OPTS)
    expect([...b.entries()]).toEqual([...a.entries()])
    expect(tree.lines).toEqual(parse('# 一\n## 甲\n### 甲子\n# 二\n').lines)
  })

  it('深链（100 层列表嵌套）不爆栈', () => {
    let md = '###### 六\n'
    for (let i = 0; i < 100; i++) md += `${'\t'.repeat(i)}- 第${i}层\n`
    const tree = parse(md)
    const res = layout(tree, OPTS)
    expect(res.size).toBe(101)
  })

  it('性能：500 节点布局 < 20ms', () => {
    let md = ''
    for (let i = 0; i < 50; i++) {
      md += `# 根${i}\n`
      for (let j = 0; j < 3; j++) {
        md += `## 甲${i}-${j}\n`
        for (let k = 0; k < 2; k++) md += `### 乙${i}-${j}-${k}\n`
      }
    }
    const tree = parse(md)
    expect(visibleNodes(tree).length).toBe(500)
    const t0 = performance.now()
    const res = layout(tree, OPTS)
    const cost = performance.now() - t0
    expect(res.size).toBe(500)
    // eslint-disable-next-line no-console
    console.info(`[bench] layout 500 节点耗时 ${cost.toFixed(2)}ms`)
    expect(cost).toBeLessThan(20)
  })
})

// ── M9：布局扩展 ─────────────────────────────────────────────────

const LEFT: LayoutOptions = { ...OPTS, direction: 'left' }
const BOTH: LayoutOptions = { ...OPTS, direction: 'both' }

describe('layout（分支向左）', () => {
  it('单根：根的右边缘在 x=0，子节点的右边缘 = 父的左边缘 − hGap', () => {
    const tree = parse('# 一\n## 甲\n')
    const res = layout(tree, LEFT)
    const root = boxOf(tree, res, '一')
    const child = boxOf(tree, res, '甲')
    expect(root.x + root.w).toBe(0)
    expect(child.x + child.w).toBe(root.x - LEFT.hGap)
  })

  it('与分支向右【逐节点镜像】：y 完全相同，x 沿原点翻面', () => {
    const md = '# 一\n## 甲\n### 甲子\n### 甲丑\n## 乙\n# 二\n'
    const tree = parse(md)
    const right = layout(tree, OPTS)
    const left = layout(tree, LEFT)
    expect(left.size).toBe(right.size)
    for (const [id, r] of right) {
      const l = left.get(id) as Box
      // 垂直方向与水平朝向无关——第一趟遍历一个字都没改
      expect(l.y).toBe(r.y)
      expect(l.h).toBe(r.h)
      expect(l.w).toBe(r.w)
      expect(l.x).toBe(-(r.x + r.w))
    }
  })

  it('所有节点都在原点左侧，任意两个矩形不重叠', () => {
    const tree = parse('# 一\n## 甲\n### 甲子\n### 甲丑\n## 乙\n# 二\n')
    const res = layout(tree, LEFT)
    for (const box of res.values()) expect(box.x + box.w).toBeLessThanOrEqual(0)
    assertNoOverlap(tree, res)
  })

  it('折叠节点的后代同样不参与布局', () => {
    const tree = parse('# 一\n## 甲\n### 甲子\n## 乙\n')
    ;(allNodes(tree).find((n) => n.text === '甲') as MindNode).collapsed = true
    expect(layout(tree, LEFT).size).toBe(3)
  })
})

describe('layout（分支两侧）', () => {
  /** 某个根节点下，分到左 / 右两列的直接子节点文本。 */
  function columns(tree: MindTree, res: LayoutResult, rootText: string): { left: string[]; right: string[] } {
    const root = allNodes(tree).find((n) => n.text === rootText) as MindNode
    const rootBox = res.get(root.id) as Box
    const left: string[] = []
    const right: string[] = []
    for (const c of root.children) {
      const box = res.get(c.id) as Box
      ;(box.x + box.w <= rootBox.x ? left : right).push(c.text)
    }
    return { left, right }
  }

  it('只有一个子分支时仍在右边——不该因为换了布局就跑到左边去', () => {
    const tree = parse('# 一\n## 甲\n')
    expect(columns(tree, layout(tree, BOTH), '一')).toEqual({ left: [], right: ['甲'] })
  })

  it('四个等重分支 → 左右各两个，各自那一列里文档序不变', () => {
    const tree = parse('# 一\n## 甲\n## 乙\n## 丙\n## 丁\n')
    const res = layout(tree, BOTH)
    const { left, right } = columns(tree, res, '一')
    expect(right).toEqual(['甲', '丙'])
    expect(left).toEqual(['乙', '丁'])
    // 同一列内自上而下 = 文档序
    expect(boxOf(tree, res, '甲').y).toBeLessThan(boxOf(tree, res, '丙').y)
    expect(boxOf(tree, res, '乙').y).toBeLessThan(boxOf(tree, res, '丁').y)
  })

  it('按【子树节点数】分配，而不是按分支个数（M9 验收第二条）', () => {
    // 甲 自带 3 个子节点（子树 4 个），乙丙丁各 1 个 → 甲独占一侧，另外三个凑另一侧
    const tree = parse('# 一\n## 甲\n### A\n### B\n### C\n## 乙\n## 丙\n## 丁\n')
    const res = layout(tree, BOTH)
    const { left, right } = columns(tree, res, '一')
    expect(right).toEqual(['甲'])
    expect(left).toEqual(['乙', '丙', '丁'])
  })

  it('左右两列的节点数大致均衡：差距不超过最大的那棵子树', () => {
    const tree = parse('# 一\n## 甲\n### A\n### B\n## 乙\n### C\n## 丙\n## 丁\n## 戊\n')
    const res = layout(tree, BOTH)
    const root = allNodes(tree).find((n) => n.text === '一') as MindNode
    const rootBox = res.get(root.id) as Box
    const size = (n: MindNode): number => 1 + n.children.reduce((s, c) => s + size(c), 0)
    let l = 0
    let r = 0
    let biggest = 0
    for (const c of root.children) {
      const box = res.get(c.id) as Box
      const n = size(c)
      biggest = Math.max(biggest, n)
      if (box.x + box.w <= rootBox.x) l += n
      else r += n
    }
    expect(l + r).toBe(8)
    expect(Math.abs(l - r)).toBeLessThanOrEqual(biggest)
  })

  it('折叠的分支按 1 个节点算——看不见的后代不该影响左右平衡', () => {
    const tree = parse('# 一\n## 甲\n### A\n### B\n### C\n## 乙\n')
    ;(allNodes(tree).find((n) => n.text === '甲') as MindNode).collapsed = true
    // 甲 折叠后与 乙 一样重 → 一右一左
    expect(columns(tree, layout(tree, BOTH), '一')).toEqual({ left: ['乙'], right: ['甲'] })
  })

  it('根节点落在左右两列中间，两列各自垂直居中', () => {
    const tree = parse('# 一\n## 甲\n### A\n### B\n## 乙\n')
    const res = layout(tree, BOTH)
    const root = boxOf(tree, res, '一')
    const jia = boxOf(tree, res, '甲') // 右侧，带着两个子节点
    const yi = boxOf(tree, res, '乙') // 左侧，孤零零一个
    expect(centerY(root)).toBeCloseTo(centerY(jia))
    expect(centerY(root)).toBeCloseTo(centerY(yi))
    expect(centerY(root)).toBeCloseTo((centerY(boxOf(tree, res, 'A')) + centerY(boxOf(tree, res, 'B'))) / 2)
  })

  it('左列全在根的左边缘之左、右列全在右边缘之右，矩形两两不重叠', () => {
    for (const md of [
      '# 一\n## 甲\n### A\n### B\n## 乙\n## 丙\n## 丁\n',
      '# 一\n## 甲\n## 乙\n# 二\n## 丙\n### C\n#### D\n',
      '###### 六\n- 甲\n\t- 乙\n- 丙\n- 丁\n',
    ]) {
      const tree = parse(md)
      const res = layout(tree, BOTH)
      assertNoOverlap(tree, res)
      for (const root of tree.root.children) {
        const rb = res.get(root.id) as Box
        for (const c of root.children) {
          const cb = res.get(c.id) as Box
          const outside = cb.x + cb.w <= rb.x || cb.x >= rb.x + rb.w
          expect(outside).toBe(true)
        }
      }
    }
  })

  it('多个根各自分列两侧，垂直方向依次排开', () => {
    const tree = parse('# 一\n## 甲\n## 乙\n# 二\n## 丙\n## 丁\n')
    const res = layout(tree, BOTH)
    expect(columns(tree, res, '一')).toEqual({ left: ['乙'], right: ['甲'] })
    expect(columns(tree, res, '二')).toEqual({ left: ['丁'], right: ['丙'] })
    expect(boxOf(tree, res, '一').y).toBeLessThan(boxOf(tree, res, '二').y)
  })

  it('布局是纯函数：不修改树，同样输入两次结果相同', () => {
    const md = '# 一\n## 甲\n### A\n## 乙\n# 二\n'
    const tree = parse(md)
    const a = layout(tree, BOTH)
    const b = layout(tree, BOTH)
    expect([...b.entries()]).toEqual([...a.entries()])
    expect(tree.lines).toEqual(parse(md).lines)
  })

  it('空文件 / 无子节点的根都不出事', () => {
    expect(layout(parse(''), BOTH).size).toBe(0)
    const tree = parse('# 一\n# 二\n')
    const res = layout(tree, BOTH)
    expect(res.size).toBe(2)
    expect(boxOf(tree, res, '一').x).toBe(0)
  })
})

describe('subtreeBounds（展开/折叠后的视野跟随，M10）', () => {
  const nodeOf = (tree: MindTree, text: string): MindNode =>
    allNodes(tree).find((n) => n.text === text) as MindNode

  it('叶子节点 = 它自己的盒子', () => {
    const tree = parse('# 一\n## 甲\n')
    const res = layout(tree, OPTS)
    expect(subtreeBounds(nodeOf(tree, '甲'), res)).toEqual(boxOf(tree, res, '甲'))
  })

  it('罩住自己和全部可见后代', () => {
    const tree = parse('# 一\n## 甲\n### 甲子\n### 甲丑\n## 乙\n')
    const res = layout(tree, OPTS)
    const b = subtreeBounds(nodeOf(tree, '甲'), res) as Box
    for (const text of ['甲', '甲子', '甲丑']) {
      const box = boxOf(tree, res, text)
      expect(box.x).toBeGreaterThanOrEqual(b.x)
      expect(box.y).toBeGreaterThanOrEqual(b.y)
      expect(box.x + box.w).toBeLessThanOrEqual(b.x + b.w)
      expect(box.y + box.h).toBeLessThanOrEqual(b.y + b.h)
    }
    // 兄弟不算在内，否则「居中到目标」会把无关的一支也拽进画面
    const yi = boxOf(tree, res, '乙')
    expect(yi.y).toBeGreaterThanOrEqual(b.y + b.h)
  })

  it('折叠之后自动收缩成节点自己——「同步收起视野」不需要特判', () => {
    const tree = parse('# 一\n## 甲\n### 甲子\n### 甲丑\n')
    const jia = nodeOf(tree, '甲')
    const expanded = subtreeBounds(jia, layout(tree, OPTS)) as Box
    jia.collapsed = true
    const res = layout(tree, OPTS)
    expect(subtreeBounds(jia, res)).toEqual(res.get(jia.id))
    expect(expanded.w).toBeGreaterThan((subtreeBounds(jia, res) as Box).w)
  })

  it('两侧布局里罩住左右两边的后代（坐标有负数也不出错）', () => {
    const tree = parse('# 一\n## 甲\n## 乙\n')
    const res = layout(tree, BOTH)
    const b = subtreeBounds(nodeOf(tree, '一'), res) as Box
    expect(b).toEqual(boundsOf(res))
    expect(b.x).toBeLessThan(0)
  })

  it('节点被折叠的祖先藏起来时返回 null', () => {
    const tree = parse('# 一\n## 甲\n### 甲子\n')
    nodeOf(tree, '甲').collapsed = true
    expect(subtreeBounds(nodeOf(tree, '甲子'), layout(tree, OPTS))).toBeNull()
  })
})

describe('sideOf / rootSide（折叠按钮、连线接点、水平方向键都按它来）', () => {
  it('根节点没有父 Box → 按整体方向定，两侧布局算右边', () => {
    expect(rootSide('right')).toBe('right')
    expect(rootSide('left')).toBe('left')
    expect(rootSide('both')).toBe('right')
    const box: Box = { x: 0, y: 0, w: 10, h: 10 }
    expect(sideOf(box, undefined, 'left')).toBe('left')
    expect(sideOf(box, undefined, 'right')).toBe('right')
  })

  it('分支向右 / 向左的每个非根节点都判到对应的一侧', () => {
    const tree = parse('# 一\n## 甲\n### 甲子\n## 乙\n')
    for (const [opts, want] of [
      [OPTS, 'right'],
      [LEFT, 'left'],
    ] as const) {
      const res = layout(tree, opts)
      for (const node of allNodes(tree)) {
        if (!node.parent?.parent) continue // 根节点单独由 rootSide 定
        const box = res.get(node.id) as Box
        expect(sideOf(box, res.get(node.parent.id), 'right')).toBe(want)
      }
    }
  })

  it('两侧布局里，后代跟着自己那一支的方向继续长', () => {
    const tree = parse('# 一\n## 甲\n### A\n## 乙\n### B\n')
    const res = layout(tree, BOTH)
    const side = (text: string): string => {
      const node = allNodes(tree).find((n) => n.text === text) as MindNode
      const parent = node.parent as MindNode
      return sideOf(res.get(node.id) as Box, res.get(parent.id), 'right')
    }
    expect(side('甲')).toBe('right')
    expect(side('A')).toBe('right') // 跟着 甲 继续向右
    expect(side('乙')).toBe('left')
    expect(side('B')).toBe('left') // 跟着 乙 继续向左
  })
})
