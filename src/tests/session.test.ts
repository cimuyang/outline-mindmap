/**
 * M5 键盘链路的单测。
 *
 * 视图里的每一次提交都是 `planEdit → applyPlan → re-parse → resolveAt`，
 * 这四步全是纯函数，所以「选中 → Enter → 输入 → Enter → Tab」这条必须跑通的链路
 * 在这里可以真跑，不必等到 Obsidian 里手工点。
 */

import { describe, expect, it } from 'vitest'
import { applyPlan } from '../core/editplan'
import { joinLines, parse } from '../core/parser'
import { reconcile } from '../core/reconcile'
import {
  navigate,
  planEdit,
  removeSubtree,
  resolveAt,
  selectionAfterRemoval,
  visibleAncestor,
  type EditIntent,
} from '../core/tree'
import type { EditPlan, MindNode, MindTree, ParseOptions } from '../core/types'
import { allNodes, treeShape } from './helpers'

const STRICT: ParseOptions = { strictLineBreak: true }

function idOf(tree: MindTree, text: string): string {
  const node = allNodes(tree).find((n) => n.text === text)
  if (!node) throw new Error(`找不到节点：${text}`)
  return node.id
}

/**
 * 模拟视图的一次提交：生成 plan、落到文本、重新解析、按结构位置找回目标节点。
 *
 * 与 MindmapView.commit 走的是同一批函数——这里测的不是复制品。
 */
class Session {
  tree: MindTree

  constructor(md: string) {
    this.tree = parse(md)
  }

  get text(): string {
    return joinLines(this.tree.lines, this.tree.eol)
  }

  commit(intent: EditIntent, text: string): MindNode {
    const { plan, parentId, index } = planEdit(this.tree, intent, text, STRICT)
    this.apply(plan)
    const node = resolveAt(this.tree, parentId, index)
    if (!node) throw new Error('提交后找不到目标节点')
    return node
  }

  apply(plan: EditPlan): void {
    const next = joinLines(applyPlan(this.tree.lines, plan), this.tree.eol)
    this.tree = parse(next)
  }
}

describe('必须跑通的链路（M5）', () => {
  it('选中 → Enter 甲 → Enter 乙 → Tab 丙', () => {
    const s = new Session('# 起点\n')
    // 选中「起点」，Enter：新增同级草稿，输入「甲」后再按 Enter 提交
    const jia = s.commit({ type: 'sibling', refId: idOf(s.tree, '起点') }, '甲')
    expect(jia.text).toBe('甲')
    // 提交时按下的是 Enter → 紧接着开一个「甲」的同级草稿，输入「乙」
    const yi = s.commit({ type: 'sibling', refId: jia.id }, '乙')
    // 提交时按下的是 Tab → 开一个「乙」的子节点草稿，输入「丙」
    const bing = s.commit({ type: 'child', parentId: yi.id }, '丙')

    expect(treeShape(s.tree)).toEqual([
      { text: '起点', depth: 1, kind: 'heading', children: [] },
      { text: '甲', depth: 1, kind: 'heading', children: [] },
      {
        text: '乙',
        depth: 1,
        kind: 'heading',
        children: [{ text: '丙', depth: 2, kind: 'heading', children: [] }],
      },
    ])
    expect(bing.parent?.text).toBe('乙')
  })

  it('标题下的正文在增删同级节点后位置正确、内容未被破坏', () => {
    const md = ['# A', '', 'A 的正文', '', '## A1', '', 'A1 的正文', '', '# B', ''].join('\n')
    const s = new Session(md)
    s.commit({ type: 'sibling', refId: idOf(s.tree, 'A1') }, 'A2')

    const lines = s.tree.lines
    const a1 = allNodes(s.tree).find((n) => n.text === 'A1')!
    const a2 = allNodes(s.tree).find((n) => n.text === 'A2')!
    // A1 的正文仍紧跟在 A1 之后，且新节点排在正文之后
    expect(lines.slice(a1.titleLine + 1, a1.bodyEnd)).toContain('A1 的正文')
    expect(a2.titleLine).toBeGreaterThan(a1.titleLine)
    expect(s.text).toContain('A 的正文')
    expect(s.text).toContain('A1 的正文')

    // 删掉 A2 之后，正文一个字都没少
    const plan = removeSubtree(s.tree, [a2.id])
    s.apply(plan)
    expect(s.text).toContain('A 的正文')
    expect(s.text).toContain('A1 的正文')
    expect(s.text).not.toContain('A2')
  })

  it('连续 10 次 Enter：得到 10 个新节点，顺序不错位', () => {
    const s = new Session('# 根\n')
    let ref = idOf(s.tree, '根')
    for (let i = 1; i <= 10; i++) {
      ref = s.commit({ type: 'sibling', refId: ref }, `第${i}`).id
    }
    expect(treeShape(s.tree).map((n) => n.text)).toEqual([
      '根',
      '第1',
      '第2',
      '第3',
      '第4',
      '第5',
      '第6',
      '第7',
      '第8',
      '第9',
      '第10',
    ])
  })

  it('连续 10 次 Enter 不输入文字：得到 10 个空节点，能被重新解析', () => {
    const s = new Session('# 根\n')
    let ref = idOf(s.tree, '根')
    for (let i = 0; i < 10; i++) ref = s.commit({ type: 'sibling', refId: ref }, '').id
    expect(s.tree.root.children).toHaveLength(11)
    expect(s.tree.root.children.slice(1).every((n) => n.text === '')).toBe(true)
  })

  it('列表节点旁按 Enter 得到的还是列表项，不会突然冒出一个标题', () => {
    const s = new Session('### 三\n\n- 甲\n')
    const node = s.commit({ type: 'sibling', refId: idOf(s.tree, '甲') }, '乙')
    expect(node.kind).toBe('list')
    expect(s.text).toContain('- 乙')
  })

  it('第 6 层下按 Tab 自动落到列表语法', () => {
    const s = new Session('###### 六\n')
    const node = s.commit({ type: 'child', parentId: idOf(s.tree, '六') }, '七')
    expect(node.kind).toBe('list')
    expect(node.depth).toBe(7)
  })

  it('双击空白新建自由根：追加到文件末尾，空笔记也可用', () => {
    const s = new Session('')
    const a = s.commit({ type: 'root' }, '甲')
    expect(a.depth).toBe(1)
    expect(a.kind).toBe('heading')
    s.commit({ type: 'root' }, '乙')
    expect(treeShape(s.tree).map((n) => n.text)).toEqual(['甲', '乙'])
  })

  it('重命名：文字没变时不产生任何写入', () => {
    const s = new Session('# 甲\n')
    const { plan } = planEdit(s.tree, { type: 'rename', id: idOf(s.tree, '甲') }, '甲', STRICT)
    expect(plan).toEqual([])
  })

  it('重命名后仍能按结构位置找回该节点', () => {
    const s = new Session('# 甲\n\n## 子\n')
    const renamed = s.commit({ type: 'rename', id: idOf(s.tree, '子') }, '子（改）')
    expect(renamed.text).toBe('子（改）')
    expect(renamed.parent?.text).toBe('甲')
  })

  it('CRLF 笔记编辑后仍是 CRLF', () => {
    const s = new Session('# 甲\r\n')
    s.commit({ type: 'sibling', refId: idOf(s.tree, '甲') }, '乙')
    expect(s.tree.eol).toBe('\r\n')
    expect(s.text).toContain('\r\n')
    expect(s.text).not.toMatch(/[^\r]\n/)
  })
})

describe('navigate', () => {
  const md = ['# A', '', '## A1', '', '## A2', '', '### A2a', '', '# B', ''].join('\n')

  function nav(tree: MindTree, from: string, dir: 'up' | 'down' | 'left' | 'right') {
    return navigate(tree, idOf(tree, from), dir)
  }

  it('↑↓ 在同级之间走', () => {
    const tree = parse(md)
    expect(nav(tree, 'A1', 'down')).toEqual({ type: 'select', id: idOf(tree, 'A2') })
    expect(nav(tree, 'A2', 'up')).toEqual({ type: 'select', id: idOf(tree, 'A1') })
  })

  it('↑ 走到头回父节点，↓ 走到头跨到父节点的下一个兄弟', () => {
    const tree = parse(md)
    expect(nav(tree, 'A1', 'up')).toEqual({ type: 'select', id: idOf(tree, 'A') })
    expect(nav(tree, 'A2a', 'down')).toEqual({ type: 'select', id: idOf(tree, 'B') })
  })

  it('顶头与末尾无处可去时返回 null', () => {
    const tree = parse(md)
    expect(nav(tree, 'A', 'up')).toBe(null)
    expect(nav(tree, 'B', 'down')).toBe(null)
  })

  it('→ 先展开、再进第一个子节点；叶子节点没有反应', () => {
    const tree = parse(md)
    const a = tree.byId.get(idOf(tree, 'A'))!
    a.collapsed = true
    expect(nav(tree, 'A', 'right')).toEqual({ type: 'expand', id: a.id })
    a.collapsed = false
    expect(nav(tree, 'A', 'right')).toEqual({ type: 'select', id: idOf(tree, 'A1') })
    expect(nav(tree, 'A1', 'right')).toBe(null)
  })

  it('← 先折叠、再回父节点；根节点折叠后再按无处可去', () => {
    const tree = parse(md)
    const a = tree.byId.get(idOf(tree, 'A'))!
    expect(nav(tree, 'A', 'left')).toEqual({ type: 'collapse', id: a.id })
    a.collapsed = true
    expect(nav(tree, 'A', 'left')).toBe(null)
    expect(nav(tree, 'A1', 'left')).toEqual({ type: 'select', id: a.id })
  })

  it('未知 id 返回 null，不抛错', () => {
    expect(navigate(parse(md), 'n999', 'down')).toBe(null)
  })
})

/**
 * M11：写入之后交给编辑器的那个滚动行号。
 *
 * 视图把它算在 `refresh` 之后（新树上）而不是之前，这里守的就是这个顺序——
 * 拿旧行号去滚，笔记会停在一个毫不相干的地方，而这种错在肉眼下很难和「跳回文首」区分。
 */
describe('笔记跟随当前节点的行号（M11）', () => {
  const md = ['# A', '', '## A1', '', '## A2', '', '# B', ''].join('\n')

  it('新建节点后，目标节点的 titleLine 指着它自己那一行', () => {
    const s = new Session(md)
    const node = s.commit({ type: 'sibling', refId: idOf(s.tree, 'A1') }, '新节点')
    expect(s.tree.lines[node.titleLine]).toBe('## 新节点')
  })

  it('在中部插入会把后面的行整体推下去——所以行号必须按写入【之后】的文本算', () => {
    const s = new Session(md)
    const before = allNodes(s.tree).find((n) => n.text === 'B')!.titleLine
    s.commit({ type: 'sibling', refId: idOf(s.tree, 'A1') }, '新节点')
    const after = allNodes(s.tree).find((n) => n.text === 'B')!.titleLine

    expect(after).toBeGreaterThan(before)
    expect(s.tree.lines[after]).toBe('# B')
    // 同一个节点，用写入前的行号去滚就滚到别处了
    expect(s.tree.lines[before]).not.toBe('# B')
  })

  it('子节点：跟随的是新建的那一个，不是它的父节点', () => {
    const s = new Session(md)
    const node = s.commit({ type: 'child', parentId: idOf(s.tree, 'A2') }, '孩子')
    expect(s.tree.lines[node.titleLine]).toBe('### 孩子')
  })

  it('删除后跟随「删完仍在的那个选中节点」，行号同样按新文本算', () => {
    const tree = parse(md)
    const a2 = idOf(tree, 'A2')
    const followId = selectionAfterRemoval(tree, a2) // 前一个兄弟 A1
    // 与 MindmapView.removeSelected 同序：先算选中，再写入，最后在新树上按 id 找回来
    const text = joinLines(applyPlan(tree.lines, removeSubtree(tree, [a2])), tree.eol)
    const next = reconcile(tree, parse(text))
    const node = followId === null ? null : next.byId.get(followId)

    expect(node?.text).toBe('A1')
    expect(next.lines[node!.titleLine]).toBe('## A1')
  })

  it('删光了就没有跟随目标，不该滚到任何地方', () => {
    const tree = parse('# 独苗\n')
    expect(selectionAfterRemoval(tree, idOf(tree, '独苗'))).toBe(null)
  })
})

describe('selectionAfterRemoval', () => {
  const md = ['# A', '', '## A1', '', '## A2', '', '# B', ''].join('\n')

  it('优先落到前一个兄弟', () => {
    const tree = parse(md)
    expect(selectionAfterRemoval(tree, idOf(tree, 'A2'))).toBe(idOf(tree, 'A1'))
  })

  it('没有前兄弟就落到父节点', () => {
    const tree = parse(md)
    expect(selectionAfterRemoval(tree, idOf(tree, 'A1'))).toBe(idOf(tree, 'A'))
  })

  it('第一个根节点：父是虚拟 root，落到后一个兄弟', () => {
    const tree = parse(md)
    expect(selectionAfterRemoval(tree, idOf(tree, 'A'))).toBe(idOf(tree, 'B'))
  })

  it('唯一的根节点被删掉后没有选中', () => {
    const tree = parse('# 独苗\n')
    expect(selectionAfterRemoval(tree, idOf(tree, '独苗'))).toBe(null)
  })
})

describe('visibleAncestor（折叠全部之后选中该落在哪儿，M7）', () => {
  const md = '# A\n## A1\n### A11\n# B\n'

  it('没有祖先被折叠 → 还是它自己', () => {
    const tree = parse(md)
    expect(visibleAncestor(tree, idOf(tree, 'A11'))).toBe(idOf(tree, 'A11'))
  })

  it('祖先折叠着 → 提到那个祖先上', () => {
    const tree = parse(md)
    const a1 = tree.byId.get(idOf(tree, 'A1')) as MindNode
    a1.collapsed = true
    expect(visibleAncestor(tree, idOf(tree, 'A11'))).toBe(a1.id)
  })

  it('多层都折叠着 → 提到【最外层】那个（内层的同样看不见）', () => {
    const tree = parse(md)
    const a = tree.byId.get(idOf(tree, 'A')) as MindNode
    const a1 = tree.byId.get(idOf(tree, 'A1')) as MindNode
    a.collapsed = true
    a1.collapsed = true
    expect(visibleAncestor(tree, idOf(tree, 'A11'))).toBe(a.id)
  })

  it('节点自己折叠着不影响它自己可见', () => {
    const tree = parse(md)
    const a = tree.byId.get(idOf(tree, 'A')) as MindNode
    a.collapsed = true
    expect(visibleAncestor(tree, a.id)).toBe(a.id)
  })

  it('未知 id → null', () => {
    expect(visibleAncestor(parse(md), 'n999')).toBe(null)
  })
})
