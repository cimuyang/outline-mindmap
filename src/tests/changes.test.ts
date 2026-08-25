import { describe, expect, it } from 'vitest'
import { applyPlan } from '../core/editplan'
import { joinLines, parse, splitLines } from '../core/parser'
import { createRoot, insertChild, insertSibling, moveSubtree, removeSubtree, renameNode } from '../core/tree'
import { planToChanges, type DocChange, type DocPosition } from '../doc/changes'
import type { EditPlan, MindTree, ParseOptions } from '../core/types'
import { allNodes } from './helpers'
import { FIXTURES } from './fixtures'

const STRICT: ParseOptions = { strictLineBreak: true }

/** 把 {line, ch} 换算成字符偏移，行为与 CodeMirror 一致。 */
function offsetOf(lines: string[], pos: DocPosition, eol: string): number {
  let off = 0
  for (let i = 0; i < pos.line; i++) off += (lines[i] ?? '').length + eol.length
  return off + pos.ch
}

/** 模拟编辑器应用 changes——用来验证坐标换算与 applyPlan 结果一致。 */
function applyChanges(text: string, changes: DocChange[], eol: '\n' | '\r\n'): string {
  const lines = splitLines(text)
  const resolved = changes
    .map((c) => ({
      from: offsetOf(lines, c.from, eol),
      to: offsetOf(lines, c.to, eol),
      text: c.text,
    }))
    .sort((a, b) => b.from - a.from)

  // 重叠的 change 在真实编辑器里会直接抛错，这里也要暴露出来
  for (let i = 1; i < resolved.length; i++) {
    const later = resolved[i - 1]!
    const earlier = resolved[i]!
    if (earlier.to > later.from) {
      throw new Error(`change 重叠：[${earlier.from},${earlier.to}) 与 [${later.from},${later.to})`)
    }
  }

  let out = text
  for (const c of resolved) out = out.slice(0, c.from) + c.text + out.slice(c.to)
  return out
}

/** 核心断言：编辑器路径与纯函数路径必须产出完全相同的文本。 */
function expectSameAsApplyPlan(tree: MindTree, plan: EditPlan): void {
  const viaPlan = joinLines(applyPlan(tree.lines, plan), tree.eol)
  const viaEditor = applyChanges(
    joinLines(tree.lines, tree.eol),
    planToChanges(tree.lines, plan, tree.eol),
    tree.eol,
  )
  expect(viaEditor).toBe(viaPlan)
}

describe('planToChanges 与 applyPlan 等价', () => {
  it('中间行替换', () => {
    const tree = parse('a\nb\nc\n')
    expectSameAsApplyPlan(tree, [{ fromLine: 1, toLine: 2, lines: ['B'] }])
  })

  it('删除最后一行时连同前一个换行符一起删掉', () => {
    const tree = parse('a\nb')
    expectSameAsApplyPlan(tree, [{ fromLine: 1, toLine: 2, lines: [] }])
    expect(applyChanges('a\nb', planToChanges(['a', 'b'], [{ fromLine: 1, toLine: 2, lines: [] }], '\n'), '\n')).toBe('a')
  })

  it('替换到文档末尾', () => {
    const tree = parse('a\nb')
    expectSameAsApplyPlan(tree, [{ fromLine: 1, toLine: 2, lines: ['X', 'Y'] }])
  })

  it('整篇替换', () => {
    const tree = parse('a\nb')
    expectSameAsApplyPlan(tree, [{ fromLine: 0, toLine: 2, lines: ['Z'] }])
  })

  it('整篇删空', () => {
    const tree = parse('a\nb')
    expectSameAsApplyPlan(tree, [{ fromLine: 0, toLine: 2, lines: [] }])
  })

  it('在文档最末尾追加', () => {
    const tree = parse('a')
    expectSameAsApplyPlan(tree, [{ fromLine: 1, toLine: 1, lines: ['b'] }])
  })

  it('空文件插入', () => {
    const tree = parse('')
    expect(tree.lines).toEqual([])
    expectSameAsApplyPlan(tree, [{ fromLine: 0, toLine: 0, lines: ['# 一'] }])
  })

  it('零长度插入', () => {
    const tree = parse('a\nb\n')
    expectSameAsApplyPlan(tree, [{ fromLine: 1, toLine: 1, lines: ['x'] }])
  })

  it('多处编辑互不干扰', () => {
    const tree = parse('a\nb\nc\nd\n')
    expectSameAsApplyPlan(tree, [
      { fromLine: 0, toLine: 1, lines: ['A', 'A2'] },
      { fromLine: 2, toLine: 3, lines: [] },
    ])
  })

  it('首尾相接的编辑被合并，不会在字符坐标上重叠', () => {
    const tree = parse('a\nb\nc')
    // 第二处一路删到文档末尾，需要向前借用换行符——若不合并就会与第一处打架
    expectSameAsApplyPlan(tree, [
      { fromLine: 0, toLine: 1, lines: ['A'] },
      { fromLine: 1, toLine: 3, lines: [] },
    ])
  })

  it('CRLF 文件的坐标换算与换行符保持', () => {
    const tree = parse('a\r\nb\r\nc\r\n')
    expect(tree.eol).toBe('\r\n')
    expectSameAsApplyPlan(tree, [{ fromLine: 1, toLine: 2, lines: ['B'] }])
  })
})

describe('planToChanges 覆盖全部结构操作 × 全部 fixture', () => {
  for (const fx of FIXTURES) {
    it(`${fx.name}：每个操作的编辑器路径都与纯函数路径一致`, () => {
      const tree = parse(fx.md)
      const nodes = allNodes(tree)
      const plans: EditPlan[] = [createRoot(tree, '新根', STRICT)]
      for (const n of nodes) {
        plans.push(renameNode(tree, n.id, n.text + '改'))
        plans.push(insertSibling(tree, n.id, '兄弟', 'after', STRICT))
        plans.push(insertChild(tree, n.id, '子', 'last', STRICT))
        plans.push(removeSubtree(tree, [n.id]))
      }
      // 移动：每个节点尝试挂到第一个非祖先节点之下，以及拖出成自由根
      for (const n of nodes) {
        plans.push(moveSubtree(tree, n.id, null, 0, STRICT))
      }
      for (const plan of plans) expectSameAsApplyPlan(tree, plan)
    })
  }
})
