import { describe, expect, it } from 'vitest'
import { parse } from '../core/parser'
import { reconcile } from '../core/reconcile'
import type { MindNode, MindTree } from '../core/types'
import { allNodes } from './helpers'

function byText(tree: MindTree, text: string): MindNode {
  const n = allNodes(tree).find((x) => x.text === text)
  if (!n) throw new Error(`找不到节点：${text}`)
  return n
}

function ids(tree: MindTree): string[] {
  return allNodes(tree).map((n) => `${n.text}=${n.id}`)
}

describe('reconcile', () => {
  it('oldTree 为 null 时原样返回', () => {
    const t = parse('# 一\n')
    expect(reconcile(null, t)).toBe(t)
  })

  it('文本与 kind 都不变 → 全部复用旧 id', () => {
    const md = '# 一\n## 甲\n## 乙\n'
    const before = parse(md)
    const after = reconcile(before, parse(md))
    expect(ids(after)).toEqual(ids(before))
  })

  it('折叠态随 id 一起迁移', () => {
    const md = '# 一\n## 甲\n'
    const before = parse(md)
    byText(before, '甲').collapsed = true
    const after = reconcile(before, parse(md))
    expect(byText(after, '甲').collapsed).toBe(true)
  })

  it('优先级 2：text 相同但 kind 变了（跨界转换）仍复用 id', () => {
    // 必须保持父节点不变——配对是逐父节点进行的。这里父节点是虚拟 root。
    const before = parse('- 甲\n')
    expect(byText(before, '甲').kind).toBe('list')
    const oldId = byText(before, '甲').id
    const after = reconcile(before, parse('# 甲\n'))
    expect(byText(after, '甲').kind).toBe('heading')
    expect(byText(after, '甲').id).toBe(oldId)
  })

  it('优先级 1 严格优先于优先级 2：同名兄弟中优先配对 kind 也相同的那个', () => {
    // 虚拟 root 下同时有一个列表「甲」和一个标题「甲」
    const before = parse('- 甲\n# 甲\n')
    const [listJia, headingJia] = allNodes(before)
    expect(listJia?.kind).toBe('list')
    expect(headingJia?.kind).toBe('heading')

    // 新树只剩标题「甲」，必须配到旧的【标题】甲，而不是文档序更靠前的列表甲
    const after = reconcile(before, parse('# 甲\n'))
    expect(byText(after, '甲').id).toBe(headingJia?.id)
    expect(byText(after, '甲').id).not.toBe(listJia?.id)
  })

  it('优先级 3：同下标且编辑距离 < 50% → 认定是用户在改字，复用 id', () => {
    const before = parse('# 一\n## 项目计划\n')
    const oldId = byText(before, '项目计划').id
    const after = reconcile(before, parse('# 一\n## 项目计划书\n'))
    expect(byText(after, '项目计划书').id).toBe(oldId)
  })

  it('编辑距离 >= 50% 时不复用，发新 id', () => {
    const before = parse('# 一\n## 甲\n')
    const oldId = byText(before, '甲').id
    const after = reconcile(before, parse('# 一\n## 完全不同的标题\n'))
    expect(byText(after, '完全不同的标题').id).not.toBe(oldId)
  })

  it('新 id 从旧树最大编号之后接着发，不与复用的 id 撞车', () => {
    const before = parse('# 一\n## 甲\n## 乙\n') // n1 n2 n3
    const after = reconcile(before, parse('# 一\n## 甲\n## 乙\n## 丙\n'))
    const all = allNodes(after)
    expect(new Set(all.map((n) => n.id)).size).toBe(all.length)
    expect(byText(after, '丙').id).toBe('n4')
  })

  it('删除中间节点后，其余节点 id 不漂移（陷阱 11）', () => {
    const before = parse('# 一\n## 甲\n## 乙\n## 丙\n')
    const yiId = byText(before, '乙').id
    const bingId = byText(before, '丙').id
    const after = reconcile(before, parse('# 一\n## 乙\n## 丙\n'))
    expect(byText(after, '乙').id).toBe(yiId)
    expect(byText(after, '丙').id).toBe(bingId)
  })

  it('同名兄弟节点按出现顺序贪心配对，不会互相抢占', () => {
    const before = parse('# 一\n## 同\n## 同\n')
    const [, a, b] = allNodes(before)
    const after = reconcile(before, parse('# 一\n## 同\n## 同\n'))
    const [, a2, b2] = allNodes(after)
    expect(a2?.id).toBe(a?.id)
    expect(b2?.id).toBe(b?.id)
    expect(a2?.id).not.toBe(b2?.id)
  })

  it('配对只在同一父节点下进行，跨父的同名节点不复用', () => {
    const before = parse('# 一\n## 甲\n# 二\n')
    const oldId = byText(before, '甲').id
    // 「甲」挪到了「二」下面 → 不同父节点，视为新节点
    const after = reconcile(before, parse('# 一\n# 二\n## 甲\n'))
    expect(byText(after, '甲').id).not.toBe(oldId)
  })

  it('整棵子树新增时，子树内每个节点都拿到唯一新 id', () => {
    const before = parse('# 一\n')
    const after = reconcile(before, parse('# 一\n# 二\n## 甲\n### 乙\n'))
    const fresh = [byText(after, '二'), byText(after, '甲'), byText(after, '乙')]
    expect(new Set(fresh.map((n) => n.id)).size).toBe(3)
  })

  it('byId 在 reconcile 之后与实际节点严格一致', () => {
    const before = parse('# 一\n## 甲\n')
    const after = reconcile(before, parse('# 一\n## 甲改\n### 新\n'))
    const nodes = allNodes(after)
    expect(after.byId.size).toBe(nodes.length)
    for (const n of nodes) expect(after.byId.get(n.id)).toBe(n)
  })

  it('连续多轮 reconcile 不会让 id 无限膨胀', () => {
    let tree = parse('# 一\n## 甲\n')
    for (let i = 0; i < 20; i++) {
      tree = reconcile(tree, parse('# 一\n## 甲\n'))
    }
    expect(ids(tree)).toEqual(['一=n1', '甲=n2'])
  })

  it('不修改 oldTree', () => {
    const before = parse('# 一\n## 甲\n')
    const snapshot = ids(before)
    reconcile(before, parse('# 一\n## 乙\n'))
    expect(ids(before)).toEqual(snapshot)
  })
})
