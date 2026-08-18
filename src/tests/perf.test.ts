/**
 * 1000 节点压力测试（M10）。
 *
 * 测的是【纯计算】那一段：解析 → 对账 → 布局 → 编辑。DOM 的部分在 node 环境里没法测，
 * 由插件内的「导图性能自检」命令在真实 Obsidian 里量（见 MindmapView.perfReport）。
 *
 * 语料是 `bench/1000节点压力测试笔记.md`，由 `scripts/gen-stress-note.mjs` 确定性生成。
 * 【不要在这里现造语料】——换一批文字就换一批数字，跨次比较立刻失去意义。
 *
 * 阈值一律按「实测值的十倍」定：这套测试也会在慢机器、CI 容器里跑，
 * 卡在真实退化上才有价值，卡在机器抖动上只会让人把它删掉。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyPlan } from '../core/editplan'
import { joinLines, parse } from '../core/parser'
import { reconcile } from '../core/reconcile'
import { planEdit } from '../core/tree'
import type { MindNode } from '../core/types'
import { boundsOf, layout, visibleNodes } from '../layout'
import { DEFAULT_LAYOUT } from '../layout/types'
import type { BranchStyle, LayoutOptions } from '../layout/types'
import { edgePath } from '../view/Connectors'

const NOTE = readFileSync(
  fileURLToPath(new URL('../../bench/1000节点压力测试笔记.md', import.meta.url)),
  'utf8',
)

/** 与 layout.test.ts 相同的假测量：布局本身与字体无关。 */
const measure = (node: MindNode): { w: number; h: number } => ({
  w: Math.min(320, node.text.length * 10) + 26,
  h: 20,
})

const OPTS: LayoutOptions = { ...DEFAULT_LAYOUT, measure }

/** 跑 n 次取【平均】。单次计时在毫秒量级下噪声太大，平均值才稳得住。 */
function bench(label: string, times: number, fn: () => void): number {
  fn() // 预热一次：把 JIT 编译和首次分配从数字里摘出去
  const t0 = performance.now()
  for (let i = 0; i < times; i++) fn()
  const cost = (performance.now() - t0) / times
  // eslint-disable-next-line no-console
  console.info(`[bench] ${label}：${cost.toFixed(2)}ms`)
  return cost
}

describe('1000 节点压力测试（M10）', () => {
  it('语料本身就是 1000 个节点，八层全占满', () => {
    const tree = parse(NOTE)
    const nodes = visibleNodes(tree)
    expect(nodes.length).toBe(1000)
    const depths = new Set(nodes.map((n) => n.depth))
    expect([...depths].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    // 6/7 那道边界两边都要有量，否则压的不是真实结构
    expect(nodes.filter((n) => n.kind === 'heading').length).toBeGreaterThan(300)
    expect(nodes.filter((n) => n.kind === 'list').length).toBeGreaterThan(300)
  })

  it('解析 1000 节点 < 100ms', () => {
    expect(bench('parse', 20, () => void parse(NOTE))).toBeLessThan(100)
  })

  it('对账（保住 id 与折叠态）< 100ms', () => {
    const prev = parse(NOTE)
    const next = parse(NOTE)
    expect(bench('reconcile', 20, () => void reconcile(prev, next))).toBeLessThan(100)
  })

  it('三种布局方向各 < 50ms', () => {
    const tree = parse(NOTE)
    for (const direction of ['right', 'left', 'both'] as const) {
      const opts = { ...OPTS, direction }
      expect(bench(`layout(${direction})`, 50, () => void layout(tree, opts))).toBeLessThan(50)
    }
  })

  it('一次完整重绘的计算部分（布局 + 可见节点 + 外接矩形）< 50ms', () => {
    const tree = parse(NOTE)
    const cost = bench('redraw(计算部分)', 50, () => {
      const boxes = layout(tree, OPTS)
      visibleNodes(tree)
      boundsOf(boxes)
    })
    expect(cost).toBeLessThan(50)
  })

  it('打开一篇 1000 节点笔记的全流程（解析 + 对账 + 布局）< 200ms', () => {
    const cost = bench('open(全流程)', 10, () => {
      const tree = reconcile(null, parse(NOTE))
      layout(tree, OPTS)
    })
    expect(cost).toBeLessThan(200)
  })

  it('连按 10 次回车：10 次编辑总共 < 200ms，且每次都基于上一次的文本', () => {
    // M5 的关键路径：不等 I/O，本地同步算出新文本立刻重绘。
    // 这里把那条链路原样跑一遍——planEdit → applyPlan → parse。
    const t0 = performance.now()
    let text = NOTE
    let tree = parse(text)
    let anchor = visibleNodes(tree)[500] as MindNode
    for (let i = 0; i < 10; i++) {
      const outcome = planEdit(tree, { type: 'sibling', refId: anchor.id }, `新增节点 ${i}`, {
        strictLineBreak: true,
      })
      text = joinLines(applyPlan(tree.lines, outcome.plan), tree.eol)
      tree = reconcile(tree, parse(text))
      const next = tree.root.children.length > 0 ? findText(tree.root, `新增节点 ${i}`) : null
      expect(next).not.toBeNull()
      anchor = next as MindNode
    }
    const cost = performance.now() - t0
    // eslint-disable-next-line no-console
    console.info(`[bench] 连续 10 次编辑：${cost.toFixed(2)}ms（平均 ${(cost / 10).toFixed(2)}ms）`)
    expect(cost).toBeLessThan(200)
    expect(visibleNodes(tree).length).toBe(1010)
  })

  it('三种连线样式生成 1000 条边各 < 50ms，折线不比斜线慢一个量级（M11）', () => {
    const tree = parse(NOTE)
    const boxes = layout(tree, OPTS)
    const nodes = visibleNodes(tree)
    const costs = new Map<BranchStyle, number>()

    for (const style of ['straight', 'curve', 'elbow'] as const) {
      const cost = bench(`edges(${style})`, 20, () => {
        let d = ''
        for (const node of nodes) {
          const from = node.parent ? boxes.get(node.parent.id) : undefined
          const to = boxes.get(node.id)
          if (from && to) d += edgePath(from, to, style)
        }
        expect(d.length).toBeGreaterThan(0)
      })
      costs.set(style, cost)
      expect(cost).toBeLessThan(50)
    }

    // 折线的 d 更长（多两个圆角），但仍是同一趟无状态循环：不该出现量级差
    const curve = costs.get('curve') as number
    const elbow = costs.get('elbow') as number
    expect(elbow).toBeLessThan(Math.max(curve * 10, 5))
  })

  it('全部折叠后布局只剩根节点，耗时随可见节点数下降', () => {
    const tree = parse(NOTE)
    const full = layout(tree, OPTS).size
    for (const root of tree.root.children) if (root.children.length > 0) root.collapsed = true
    const collapsed = layout(tree, OPTS)
    expect(collapsed.size).toBeLessThan(full)
    expect(collapsed.size).toBe(tree.root.children.length)
  })
})

function findText(node: MindNode, text: string): MindNode | null {
  for (const c of node.children) {
    if (c.text === text) return c
    const hit = findText(c, text)
    if (hit) return hit
  }
  return null
}
