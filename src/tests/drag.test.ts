/**
 * M6 拖拽的纯逻辑单测。
 *
 * 拖拽本身要靠手工验收（附录 D），但「指针落在哪 → 变成哪个 (父, 下标)」
 * 是纯计算，其中「不能拖到自己的子树里」更是必须在【拖拽过程中】就判出来的规则——
 * 不该留给手工点。
 *
 * 落点解析之后的结构变更走的是 core/tree.ts 的 moveSubtree（M2 已测），
 * 这里只把两者接起来跑一遍，确认 A.8 的三个跨界例子从「拖」这一端也走得通。
 */

import { describe, expect, it } from 'vitest'
import { applyPlan } from '../core/editplan'
import { joinLines, parse } from '../core/parser'
import { moveSubtree } from '../core/tree'
import type { MindTree, ParseOptions } from '../core/types'
import type { LayoutResult } from '../layout/types'
import {
  hitTest,
  isSamePosition,
  resolveDrop,
  subtreeIds,
  type DropTarget,
} from '../view/DragController'
import { allNodes } from './helpers'

const STRICT: ParseOptions = { strictLineBreak: true }
const LOOSE: ParseOptions = { strictLineBreak: false }

function idOf(tree: MindTree, text: string): string {
  const node = allNodes(tree).find((n) => n.text === text)
  if (!node) throw new Error(`找不到节点：${text}`)
  return node.id
}

/** 造一份假布局：每个节点一个 100×40 的盒子，纵向依次排开，中间空 20px。 */
function fakeLayout(tree: MindTree): { order: string[]; boxes: LayoutResult } {
  const order: string[] = []
  const boxes: LayoutResult = new Map()
  allNodes(tree).forEach((n, i) => {
    order.push(n.id)
    boxes.set(n.id, { x: 0, y: i * 60, w: 100, h: 40 })
  })
  return { order, boxes }
}

/** 一次完整的拖拽：解析落点 → moveSubtree → 应用 → 文本。 */
function drop(tree: MindTree, dragText: string, target: DropTarget, options = LOOSE): string {
  const result = resolveDrop(tree, idOf(tree, dragText), target)
  if (!result) throw new Error('落点非法')
  const plan = moveSubtree(tree, idOf(tree, dragText), result.parentId, result.index, options)
  return joinLines(applyPlan(tree.lines, plan), tree.eol)
}

// ── hitTest ────────────────────────────────────────────────────

describe('hitTest（指针位置 → 落点）', () => {
  const tree = parse('# 一\n## 甲\n# 二\n')
  const { order, boxes } = fakeLayout(tree)
  const first = order[0] as string
  const second = order[1] as string

  it('落在节点上半 30% → 插到它前面', () => {
    expect(hitTest(order, boxes, 50, 5)).toEqual({ id: first, zone: 'before' })
  })

  it('落在节点下半 30% → 插到它后面', () => {
    expect(hitTest(order, boxes, 50, 35)).toEqual({ id: first, zone: 'after' })
  })

  it('落在节点中间 40% → 成为它的子节点', () => {
    expect(hitTest(order, boxes, 50, 20)).toEqual({ id: first, zone: 'into' })
  })

  it('落在两个节点之间的小间隙 → 就近吸附，不会莫名变成建根', () => {
    // 第一个盒子底边 y=40，第二个顶边 y=60，间隙里偏上的点吸到上面那个
    expect(hitTest(order, boxes, 50, 45)).toEqual({ id: first, zone: 'after' })
    expect(hitTest(order, boxes, 50, 56)).toEqual({ id: second, zone: 'before' })
  })

  it('离所有节点都很远 → 画布空白（id 为 null）', () => {
    expect(hitTest(order, boxes, 900, 900)).toEqual({ id: null, zone: 'into' })
  })

  it('空布局不抛错，一律判为画布空白', () => {
    expect(hitTest([], new Map(), 0, 0)).toEqual({ id: null, zone: 'into' })
  })

  it('折叠起来的后代不在 order 里，就不会被吸附到', () => {
    const collapsedOrder = [first]
    const target = hitTest(collapsedOrder, boxes, 50, 65)
    expect(target.id).not.toBe(second)
  })
})

// ── resolveDrop ────────────────────────────────────────────────

describe('resolveDrop（落点 → moveSubtree 参数）', () => {
  const md = '# 一\n## 甲\n### 甲子\n## 乙\n# 二\n'

  it('before / after：同一个父节点下，下标是「剔除自己之后」的下标', () => {
    const tree = parse(md)
    const one = idOf(tree, '一')
    // 「乙」拖到「甲」前面：剔除「乙」后兄弟只剩 [甲]，插到下标 0
    expect(resolveDrop(tree, idOf(tree, '乙'), { id: idOf(tree, '甲'), zone: 'before' })).toEqual({
      parentId: one,
      index: 0,
    })
    expect(resolveDrop(tree, idOf(tree, '乙'), { id: idOf(tree, '甲'), zone: 'after' })).toEqual({
      parentId: one,
      index: 1,
    })
  })

  it('into：成为目标的最后一个子节点', () => {
    const tree = parse(md)
    expect(resolveDrop(tree, idOf(tree, '乙'), { id: idOf(tree, '甲'), zone: 'into' })).toEqual({
      parentId: idOf(tree, '甲'),
      index: 1, // 甲 已有一个子节点「甲子」
    })
  })

  it('目标是根节点时，parentId 为 null（虚拟 root 不能当父 id）', () => {
    const tree = parse(md)
    expect(resolveDrop(tree, idOf(tree, '甲'), { id: idOf(tree, '二'), zone: 'after' })).toEqual({
      parentId: null,
      index: 2, // 「甲」不是根，剔除它不影响根一层：[一, 二]，插到「二」后面 = 下标 2
    })
  })

  it('画布空白 → 追加为最后一个自由根', () => {
    const tree = parse(md)
    expect(resolveDrop(tree, idOf(tree, '甲'), { id: null, zone: 'into' })).toEqual({
      parentId: null,
      index: 2,
    })
  })

  it('拖到自己身上 → null（落点在视觉上就该是不可选的）', () => {
    const tree = parse(md)
    const jia = idOf(tree, '甲')
    expect(resolveDrop(tree, jia, { id: jia, zone: 'into' })).toBe(null)
    expect(resolveDrop(tree, jia, { id: jia, zone: 'before' })).toBe(null)
  })

  it('拖到自己的后代身上 → null，三种区域都不行', () => {
    const tree = parse(md)
    const one = idOf(tree, '一')
    for (const zone of ['before', 'after', 'into'] as const) {
      expect(resolveDrop(tree, one, { id: idOf(tree, '甲子'), zone })).toBe(null)
    }
  })

  it('未知 id 返回 null，不抛错', () => {
    const tree = parse(md)
    expect(resolveDrop(tree, 'n999', { id: idOf(tree, '甲'), zone: 'into' })).toBe(null)
    expect(resolveDrop(tree, idOf(tree, '甲'), { id: 'n999', zone: 'into' })).toBe(null)
  })

  it('解析出来的落点一定能被 moveSubtree 接受（对所有节点对穷举）', () => {
    const tree = parse(md)
    const nodes = allNodes(tree)
    for (const drag of nodes) {
      for (const target of [...nodes.map((n) => n.id), null]) {
        for (const zone of ['before', 'after', 'into'] as const) {
          const result = resolveDrop(tree, drag.id, { id: target, zone })
          if (!result) continue
          expect(() => moveSubtree(tree, drag.id, result.parentId, result.index, STRICT)).not.toThrow()
        }
      }
    }
  })
})

// ── isSamePosition ─────────────────────────────────────────────

describe('isSamePosition（拖起来又放回原处 → 不产生任何写入）', () => {
  const md = '# 一\n## 甲\n## 乙\n## 丙\n'

  it('放回自己原来的位置 → true', () => {
    const tree = parse(md)
    // 「乙」放到「乙」原来的下标（剔除自己后，下标 1 = 甲 与 丙 之间）
    const result = resolveDrop(tree, idOf(tree, '乙'), { id: idOf(tree, '甲'), zone: 'after' })
    expect(result).not.toBe(null)
    expect(isSamePosition(tree, idOf(tree, '乙'), result!)).toBe(true)
    // 拖到「丙」前面也是同一个位置
    const same = resolveDrop(tree, idOf(tree, '乙'), { id: idOf(tree, '丙'), zone: 'before' })
    expect(isSamePosition(tree, idOf(tree, '乙'), same!)).toBe(true)
  })

  it('换了下标或换了父节点 → false', () => {
    const tree = parse(md)
    const moved = resolveDrop(tree, idOf(tree, '乙'), { id: idOf(tree, '甲'), zone: 'before' })
    expect(isSamePosition(tree, idOf(tree, '乙'), moved!)).toBe(false)
    const reparented = resolveDrop(tree, idOf(tree, '乙'), { id: idOf(tree, '甲'), zone: 'into' })
    expect(isSamePosition(tree, idOf(tree, '乙'), reparented!)).toBe(false)
  })
})

// ── subtreeIds ─────────────────────────────────────────────────

describe('subtreeIds（拖拽时整棵子树一起置灰）', () => {
  it('包含自身与全部后代', () => {
    const tree = parse('# 一\n## 甲\n### 甲子\n## 乙\n')
    const node = tree.byId.get(idOf(tree, '甲'))!
    expect(subtreeIds(node)).toEqual(new Set([node.id, idOf(tree, '甲子')]))
  })
})

// ── 端到端：拖拽 → 文本 ────────────────────────────────────────

describe('拖拽端到端（附录 A.8 的三个跨界例子）', () => {
  it('例 1：H4 子树拖到 H6 下 → 整棵子树转 Tab 缩进列表', () => {
    const tree = parse('###### 六\n#### 四\n##### 五\n')
    expect(drop(tree, '四', { id: idOf(tree, '六'), zone: 'into' })).toBe(
      '###### 六\n- 四\n\t- 五\n',
    )
  })

  it('例 2：H6 下的列表节点拖到画布空白 → 变 H1，子树跟着变 H2/H3', () => {
    const tree = parse('###### 六\n- 甲\n\t- 乙\n\t\t- 丙\n')
    expect(drop(tree, '甲', { id: null, zone: 'into' }, STRICT)).toBe(
      '###### 六\n\n\n\n# 甲\n\n\n\n## 乙\n\n\n\n### 丙\n',
    )
  })

  it('例 3：列表节点在第 7 层内平移 → 只有 Tab 数变化', () => {
    const tree = parse('###### 六\n- 甲\n\t- 乙\n\t\t- 丙\n')
    expect(drop(tree, '丙', { id: idOf(tree, '乙'), zone: 'after' })).toBe(
      '###### 六\n- 甲\n\t- 乙\n\t- 丙\n',
    )
  })

  it('跨界拖拽时，节点携带的正文跟着一起走', () => {
    const tree = parse('###### 六\n#### 四\n四的正文\n> 引用\n##### 五\n五的正文\n')
    expect(drop(tree, '四', { id: idOf(tree, '六'), zone: 'into' })).toBe(
      '###### 六\n- 四\n四的正文\n> 引用\n\t- 五\n五的正文\n',
    )
  })

  it('拖拽后，文件中未涉及的行逐字节不变（含 frontmatter）', () => {
    const md = '---\ntags: [a]\n---\n# 一\n## 甲\n## 乙\n# 二\n尾巴正文\n'
    const tree = parse(md)
    const out = drop(tree, '甲', { id: idOf(tree, '二'), zone: 'into' })
    // frontmatter 一个字节都不许动（红线 1）
    expect(out.startsWith('---\ntags: [a]\n---\n')).toBe(true)
    // 「二」自带正文，作为最后一个子节点的落点在正文【之后】
    expect(out).toBe('---\ntags: [a]\n---\n# 一\n## 乙\n# 二\n尾巴正文\n## 甲\n')
    // 除了「## 甲」换了位置，其余行逐字节不变
    const kept = out.split('\n').filter((l) => l !== '## 甲')
    expect(kept).toEqual(md.split('\n').filter((l) => l !== '## 甲'))
  })

  it('把节点拖到画布空白：多次拖不会累积空行（严格换行仍幂等）', () => {
    let md = '# 一\n\n\n\n## 甲\n\n\n\n# 二\n'
    for (let i = 0; i < 4; i++) {
      const tree = parse(md)
      md = drop(tree, '甲', { id: null, zone: 'into' }, STRICT)
    }
    expect(md).toBe('# 一\n\n\n\n# 二\n\n\n\n# 甲\n')
  })
})
