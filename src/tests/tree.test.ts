import { describe, expect, it } from 'vitest'
import { joinLines, parse, splitLines } from '../core/parser'
import { applyPlan } from '../core/editplan'
import {
  createRoot,
  insertChild,
  insertSibling,
  moveSubtree,
  removeSubtree,
  renameNode,
} from '../core/tree'
import type { EditPlan, MindNode, MindTree, ParseOptions } from '../core/types'
import { allNodes } from './helpers'

const STRICT: ParseOptions = { strictLineBreak: true }
const LOOSE: ParseOptions = { strictLineBreak: false }

function idOf(tree: MindTree, text: string): string {
  const node = allNodes(tree).find((n) => n.text === text)
  if (!node) throw new Error(`找不到节点：${text}`)
  return node.id
}

function nodeOf(tree: MindTree, text: string): MindNode {
  return tree.byId.get(idOf(tree, text)) as MindNode
}

/** 应用 plan 并还原成文本，方便直接断言最终 Markdown。 */
function applied(tree: MindTree, plan: EditPlan): string {
  return joinLines(applyPlan(tree.lines, plan), tree.eol)
}

/**
 * 幂等性断言：plan 触及的行范围之外，每一行必须逐字节不变。
 *
 * 这是每个结构操作都要过的哨兵——防止「外科手术式写回」退化成整篇重写。
 */
function assertUntouchedLinesIdentical(tree: MindTree, plan: EditPlan): void {
  const touched = new Set<number>()
  for (const e of plan) {
    for (let i = e.fromLine; i < e.toLine; i++) touched.add(i)
  }
  const before = tree.lines
  const after = applyPlan(before, plan)

  // 前缀：第一处编辑之前的行完全不动
  const firstFrom = Math.min(...plan.map((e) => e.fromLine))
  for (let i = 0; i < firstFrom; i++) {
    expect(after[i]).toBe(before[i])
  }
  // 后缀：最后一处编辑之后的行完全不动（按尾部对齐比较）
  const lastTo = Math.max(...plan.map((e) => e.toLine))
  const tailLen = before.length - lastTo
  for (let k = 1; k <= tailLen; k++) {
    expect(after[after.length - k]).toBe(before[before.length - k])
  }
  // 未被任何编辑覆盖的中间行也必须原样出现在结果里
  for (let i = firstFrom; i < lastTo; i++) {
    if (!touched.has(i)) expect(after).toContain(before[i])
  }
}

// ── renameNode ─────────────────────────────────────────────────

describe('renameNode', () => {
  it('正常：只替换 titleLine 一行', () => {
    const tree = parse('# 一\n正文\n## 二\n')
    const plan = renameNode(tree, idOf(tree, '一'), '甲')
    expect(plan).toEqual([{ fromLine: 0, toLine: 1, lines: ['# 甲'] }])
    expect(applied(tree, plan)).toBe('# 甲\n正文\n## 二\n')
    assertUntouchedLinesIdentical(tree, plan)
  })

  it('边界：列表节点重命名保持缩进与 depth', () => {
    const tree = parse('###### 六\n- 甲\n\t- 乙\n')
    const plan = renameNode(tree, idOf(tree, '乙'), '乙改')
    expect(plan).toEqual([{ fromLine: 2, toLine: 3, lines: ['\t- 乙改'] }])
    expect(applied(tree, plan)).toBe('###### 六\n- 甲\n\t- 乙改\n')
  })

  it('边界：非规范写法的行被重命名后归一化，但其余行不动', () => {
    const tree = parse('# 根 ###\n* 甲\n')
    const plan = renameNode(tree, idOf(tree, '根'), '根')
    expect(applied(tree, plan)).toBe('# 根\n* 甲\n') // 只有第 0 行变了
    assertUntouchedLinesIdentical(tree, plan)
  })

  it('跨界：文本含换行直接抛错，绝不把一行撑成多行', () => {
    const tree = parse('# 一\n')
    expect(() => renameNode(tree, idOf(tree, '一'), 'a\nb')).toThrow(/换行/)
  })

  it('未知 id 抛错', () => {
    expect(() => renameNode(parse('# 一\n'), 'n99', 'x')).toThrow(/不存在/)
  })
})

// ── insertSibling ──────────────────────────────────────────────

describe('insertSibling', () => {
  it('正常：插在参考节点 blockEnd 处，严格换行补足 3 个空行', () => {
    const tree = parse('# 一\n\n\n\n# 二\n')
    const plan = insertSibling(tree, idOf(tree, '一'), '新', 'after', STRICT)
    expect(applied(tree, plan)).toBe('# 一\n\n\n\n# 新\n\n\n\n# 二\n')
    assertUntouchedLinesIdentical(tree, plan)
  })

  it('正常：新节点是参考节点的兄弟，且带着整棵子树一起被跳过', () => {
    const tree = parse('# 一\n## 子\n# 二\n')
    const plan = insertSibling(tree, idOf(tree, '一'), '新', 'after', LOOSE)
    expect(applied(tree, plan)).toBe('# 一\n## 子\n# 新\n# 二\n')
  })

  it('边界：参考节点是列表项时，新节点也是列表项（不是 #### 标题）', () => {
    const tree = parse('### 三\n- 甲\n')
    const plan = insertSibling(tree, idOf(tree, '甲'), '乙', 'after', STRICT)
    expect(applied(tree, plan)).toBe('### 三\n- 甲\n- 乙\n')
  })

  it('边界：插在文件最后一个节点之后，保住末尾换行', () => {
    const tree = parse('# 一\n')
    const plan = insertSibling(tree, idOf(tree, '一'), '二', 'after', STRICT)
    expect(applied(tree, plan)).toBe('# 一\n\n\n\n# 二\n')
  })

  it('跨界：depth 7 的参考节点 → 新节点强制为列表', () => {
    const tree = parse('###### 六\n- 甲\n')
    const jia = nodeOf(tree, '甲')
    expect(jia.depth).toBe(7)
    const plan = insertSibling(tree, jia.id, '乙', 'after', STRICT)
    expect(applied(tree, plan)).toBe('###### 六\n- 甲\n- 乙\n')
  })
})

// ── insertChild ────────────────────────────────────────────────

describe('insertChild', () => {
  it('正常：无子节点时插在 bodyEnd 处，depth = 父 + 1', () => {
    const tree = parse('# 一\n正文\n# 二\n')
    const plan = insertChild(tree, idOf(tree, '一'), '子', 'last', LOOSE)
    expect(applied(tree, plan)).toBe('# 一\n正文\n## 子\n# 二\n')
    assertUntouchedLinesIdentical(tree, plan)
  })

  it('正常：有子节点时插在最后一个子节点的 blockEnd 之后', () => {
    const tree = parse('# 一\n## 甲\n### 甲子\n## 乙\n')
    const plan = insertChild(tree, idOf(tree, '一'), '丙', 'last', LOOSE)
    expect(applied(tree, plan)).toBe('# 一\n## 甲\n### 甲子\n## 乙\n## 丙\n')
  })

  it('边界：已有子节点是列表项时，新子节点沿用列表形态', () => {
    const tree = parse('### 三\n- 甲\n')
    const plan = insertChild(tree, idOf(tree, '三'), '乙', 'last', STRICT)
    expect(applied(tree, plan)).toBe('### 三\n- 甲\n- 乙\n')
  })

  it('边界：parentId 为 null 时挂到虚拟 root 下', () => {
    const tree = parse('# 一\n')
    const plan = insertChild(tree, null, '二', 'last', STRICT)
    expect(applied(tree, plan)).toBe('# 一\n\n\n\n# 二\n')
  })

  it('跨界：父节点在 depth 6 → 子节点强制为列表', () => {
    const tree = parse('###### 六\n')
    const plan = insertChild(tree, idOf(tree, '六'), '甲', 'last', STRICT)
    expect(applied(tree, plan)).toBe('###### 六\n- 甲\n')
  })

  it('跨界：父节点是列表项 → 子节点强制为列表并缩进一级', () => {
    const tree = parse('### 三\n- 甲\n')
    const plan = insertChild(tree, idOf(tree, '甲'), '甲子', 'last', STRICT)
    expect(applied(tree, plan)).toBe('### 三\n- 甲\n\t- 甲子\n')
  })
})

// ── createRoot ─────────────────────────────────────────────────

describe('createRoot', () => {
  it('正常：追加到文件末尾，严格换行生效', () => {
    const tree = parse('# 一\n')
    const plan = createRoot(tree, '二', STRICT)
    expect(applied(tree, plan)).toBe('# 一\n\n\n\n# 二\n')
    assertUntouchedLinesIdentical(tree, plan)
  })

  it('边界：空文件', () => {
    const tree = parse('')
    expect(applied(tree, createRoot(tree, '一', STRICT))).toBe('# 一')
  })

  it('边界：文件末尾已有空行时不重复堆积', () => {
    const tree = parse('# 一\n\n\n\n')
    expect(applied(tree, createRoot(tree, '二', STRICT))).toBe('# 一\n\n\n\n# 二\n\n\n\n')
  })

  it('边界：文件只有正文没有标题时，正文原样保留在前面', () => {
    const tree = parse('前言\n')
    expect(applied(tree, createRoot(tree, '一', STRICT))).toBe('前言\n# 一\n')
  })

  it('跨界：新根永远是 depth 1 的标题', () => {
    const tree = parse('###### 六\n- 甲\n')
    expect(applied(tree, createRoot(tree, '新', LOOSE))).toBe('###### 六\n- 甲\n# 新\n')
  })
})

// ── removeSubtree ──────────────────────────────────────────────

describe('removeSubtree', () => {
  it('正常：删除整棵子树，连同其后的分隔空行', () => {
    const tree = parse('# 一\n\n\n\n# 二\n## 二子\n\n\n\n# 三\n')
    const plan = removeSubtree(tree, [idOf(tree, '二')])
    expect(applied(tree, plan)).toBe('# 一\n\n\n\n# 三\n')
    assertUntouchedLinesIdentical(tree, plan)
  })

  it('正常：正文随子树一起删除', () => {
    const tree = parse('# 一\n## 甲\n甲的正文\n> 引用\n## 乙\n')
    expect(applied(tree, removeSubtree(tree, [idOf(tree, '甲')]))).toBe('# 一\n## 乙\n')
  })

  it('边界：祖先与后代同时传入时，后代被过滤掉，不产生重叠的 TextEdit', () => {
    const tree = parse('# 一\n## 甲\n### 甲子\n# 二\n')
    const plan = removeSubtree(tree, [idOf(tree, '甲子'), idOf(tree, '一'), idOf(tree, '甲')])
    expect(plan).toHaveLength(1)
    expect(applied(tree, plan)).toBe('# 二\n')
  })

  it('边界：相邻的多个兄弟被合并成一处编辑', () => {
    const tree = parse('# 一\n# 二\n# 三\n')
    const plan = removeSubtree(tree, [idOf(tree, '一'), idOf(tree, '二')])
    expect(plan).toEqual([{ fromLine: 0, toLine: 2, lines: [] }])
    expect(applied(tree, plan)).toBe('# 三\n')
  })

  it('边界：删除文件最后一个节点时保住末尾换行，不吞掉文件尾部空行', () => {
    const tree = parse('前言\n# 一\n')
    expect(applied(tree, removeSubtree(tree, [idOf(tree, '一')]))).toBe('前言\n')
  })

  it('边界：同一个 id 传两次只删一次', () => {
    const tree = parse('# 一\n# 二\n')
    const id = idOf(tree, '一')
    expect(removeSubtree(tree, [id, id])).toHaveLength(1)
  })

  it('跨界：删除列表节点只影响其自身的缩进块', () => {
    const tree = parse('###### 六\n- 甲\n\t- 甲子\n- 乙\n')
    expect(applied(tree, removeSubtree(tree, [idOf(tree, '甲')]))).toBe('###### 六\n- 乙\n')
  })
})

// ── moveSubtree ────────────────────────────────────────────────

describe('moveSubtree', () => {
  it('专项 1：H4 子树移到 H6 之下 → 整棵子树转列表（附录 A.8 例 1）', () => {
    const tree = parse('###### 六\n#### 四\n##### 五\n')
    const plan = moveSubtree(tree, idOf(tree, '四'), idOf(tree, '六'), 0, LOOSE)
    expect(applied(tree, plan)).toBe('###### 六\n- 四\n\t- 五\n')
    assertUntouchedLinesIdentical(tree, plan)
  })

  it('专项 2：H6 下的列表节点移到与 H2 同级 → sticky 规则保持列表形态', () => {
    const tree = parse('# 一\n## 二\n###### 六\n- 甲\n')
    // 移到「一」之下、排在「二」后面 → depth 2，父是标题且 depth ≤ 6 → 规则 4 保持 list
    const plan = moveSubtree(tree, idOf(tree, '甲'), idOf(tree, '一'), 1, LOOSE)
    expect(applied(tree, plan)).toBe('# 一\n## 二\n###### 六\n- 甲\n')
  })

  it('专项 3：列表内平移，只有 Tab 数变化（附录 A.8 例 3）', () => {
    const tree = parse('###### 六\n- 甲\n\t- 乙\n\t\t- 丙\n')
    const plan = moveSubtree(tree, idOf(tree, '丙'), idOf(tree, '甲'), 1, LOOSE)
    expect(applied(tree, plan)).toBe('###### 六\n- 甲\n\t- 乙\n\t- 丙\n')
  })

  it('专项 4：拖出成自由根 → 整棵子树归一化为标题（附录 A.8 例 2）', () => {
    const tree = parse('###### 六\n- 甲\n\t- 乙\n\t\t- 丙\n')
    const plan = moveSubtree(tree, idOf(tree, '甲'), null, 1, STRICT)
    expect(applied(tree, plan)).toBe(
      '###### 六\n\n\n\n# 甲\n\n\n\n## 乙\n\n\n\n### 丙\n',
    )
  })

  it('专项 5：移到自己的子树之下必须抛错', () => {
    const tree = parse('# 一\n## 二\n### 三\n')
    expect(() => moveSubtree(tree, idOf(tree, '一'), idOf(tree, '三'), 0, LOOSE)).toThrow(/后代/)
    expect(() => moveSubtree(tree, idOf(tree, '一'), idOf(tree, '一'), 0, LOOSE)).toThrow(/自己/)
  })

  it('正文随子树一起移动，且不做任何缩进调整', () => {
    const tree = parse('###### 六\n#### 四\n正文一\n\t保持原缩进\n##### 五\n正文二\n')
    const plan = moveSubtree(tree, idOf(tree, '四'), idOf(tree, '六'), 0, LOOSE)
    expect(applied(tree, plan)).toBe(
      '###### 六\n- 四\n正文一\n\t保持原缩进\n\t- 五\n正文二\n',
    )
  })

  it('移动后原位置不留下孤立的分隔空行，落点按严格换行补足', () => {
    const tree = parse('# 一\n\n\n\n# 二\n\n\n\n# 三\n')
    const plan = moveSubtree(tree, idOf(tree, '二'), idOf(tree, '三'), 0, STRICT)
    // 源位置的 3 个分隔空行随子树一起搬走（否则会在原地堆积）；
    // 落点处「# 三」与「## 二」是相邻标题，补足 3 个空行。
    expect(applied(tree, plan)).toBe('# 一\n\n\n\n# 三\n\n\n\n## 二\n')
  })

  it('反复移动不会让空行累积（严格换行必须幂等）', () => {
    let md = '# 一\n\n\n\n# 二\n\n\n\n# 三\n'
    for (let i = 0; i < 5; i++) {
      const t = parse(md)
      md = applied(t, moveSubtree(t, idOf(t, '二'), idOf(t, '三'), 0, STRICT))
    }
    expect(md).toBe('# 一\n\n\n\n# 三\n\n\n\n## 二\n')
  })

  it('搬走文件最后一块内容时，它【前面】的分隔空行也一起走', () => {
    // 末尾那块后面没有空行可吞（吞了就会连文件末尾换行一起删掉），
    // 于是它前面的分隔空行会变成孤儿留在文件尾巴上。
    const tree = parse('# 一\n\n\n\n# 二\n')
    const plan = moveSubtree(tree, idOf(tree, '二'), idOf(tree, '一'), 0, STRICT)
    expect(applied(tree, plan)).toBe('# 一\n\n\n\n## 二\n')
  })

  it('反复把最后一个节点搬到文件末尾也不累积空行', () => {
    let md = '# 一\n\n\n\n## 甲\n\n\n\n# 二\n'
    for (let i = 0; i < 5; i++) {
      const t = parse(md)
      // 每一轮都把「甲」提成最后一个自由根——落点始终是文件末尾。
      // 下标是「剔除自己之后」的兄弟数，第二轮起「甲」自己已经在根一层里了。
      const index = t.root.children.filter((c) => c.text !== '甲').length
      md = applied(t, moveSubtree(t, idOf(t, '甲'), null, index, STRICT))
    }
    expect(md).toBe('# 一\n\n\n\n# 二\n\n\n\n# 甲\n')
  })

  it('外提：把子节点变成父节点的下一个兄弟（插入点正好压在源范围的尾部空行上）', () => {
    const tree = parse('# 一\n\n\n\n## 甲\n正文\n### 甲子\n\n\n\n## 乙\n')
    // 「甲子」是「甲」的最后一个后代，其后的空行同时也是「甲」整块的尾巴
    const plan = moveSubtree(tree, idOf(tree, '甲子'), idOf(tree, '一'), 1, STRICT)
    expect(applied(tree, plan)).toBe('# 一\n\n\n\n## 甲\n正文\n## 甲子\n\n\n\n## 乙\n')
    assertUntouchedLinesIdentical(tree, plan)
  })

  it('外提后再解析，节点确实成了父节点的兄弟', () => {
    const tree = parse('# 一\n\n\n\n## 甲\n正文\n### 甲子\n\n\n\n## 乙\n')
    const out = applied(tree, moveSubtree(tree, idOf(tree, '甲子'), idOf(tree, '一'), 1, STRICT))
    const one = parse(out).root.children[0] as MindNode
    expect(one.children.map((c) => c.text)).toEqual(['甲', '甲子', '乙'])
  })

  it('indexInParent 是「剔除被移动节点之后」的下标，越界抛错', () => {
    const tree = parse('# 一\n## 甲\n## 乙\n')
    expect(() => moveSubtree(tree, idOf(tree, '甲'), idOf(tree, '一'), 2, LOOSE)).toThrow(/越界/)
    // 剔除「甲」后只剩「乙」，下标 1 = 排在「乙」后面，合法
    expect(applied(tree, moveSubtree(tree, idOf(tree, '甲'), idOf(tree, '一'), 1, LOOSE))).toBe(
      '# 一\n## 乙\n## 甲\n',
    )
  })

  it('原地移动（下标不变）是幂等的', () => {
    const md = '# 一\n## 甲\n## 乙\n'
    const tree = parse(md)
    const plan = moveSubtree(tree, idOf(tree, '甲'), idOf(tree, '一'), 0, LOOSE)
    expect(applied(tree, plan)).toBe(md)
  })

  it('移动结果可以被重新解析，且结构符合预期', () => {
    const tree = parse('###### 六\n#### 四\n##### 五\n')
    const out = applied(tree, moveSubtree(tree, idOf(tree, '四'), idOf(tree, '六'), 0, LOOSE))
    const after = parse(out)
    const six = after.root.children[0] as MindNode
    expect(six.children.map((c) => `${c.depth}${c.kind === 'list' ? 'L' : 'H'}:${c.text}`)).toEqual([
      '7L:四',
    ])
  })

  it('CRLF 文件：所有操作写回后换行符不变', () => {
    const tree = parse('# 一\r\n## 甲\r\n# 二\r\n')
    expect(tree.eol).toBe('\r\n')
    const out = applied(tree, moveSubtree(tree, idOf(tree, '甲'), idOf(tree, '二'), 0, LOOSE))
    expect(out).toBe('# 一\r\n# 二\r\n## 甲\r\n')
    expect(out).not.toMatch(/[^\r]\n/)
  })
})

// ── 全操作通用：EditPlan 合法性 ────────────────────────────────

describe('所有操作产出的 EditPlan 都是合法的', () => {
  const md = '# 一\n\n\n\n## 甲\n正文\n### 甲子\n\n\n\n## 乙\n# 二\n###### 六\n- 列\n\t- 列子\n'

  it('每个操作的 EditPlan 范围都不重叠且能被 applyPlan 接受', () => {
    const tree = parse(md)
    const plans: EditPlan[] = [
      renameNode(tree, idOf(tree, '甲'), '甲改'),
      insertSibling(tree, idOf(tree, '甲'), '丙', 'after', STRICT),
      insertChild(tree, idOf(tree, '一'), '丁', 'last', STRICT),
      createRoot(tree, '三', STRICT),
      removeSubtree(tree, [idOf(tree, '甲'), idOf(tree, '乙')]),
      moveSubtree(tree, idOf(tree, '甲'), idOf(tree, '六'), 0, STRICT),
      moveSubtree(tree, idOf(tree, '列'), null, 0, STRICT),
    ]
    for (const plan of plans) {
      expect(() => applyPlan(tree.lines, plan)).not.toThrow()
      assertUntouchedLinesIdentical(tree, plan)
    }
  })

  it('穷举所有合法的 (节点 × 新父 × 下标) 移动，EditPlan 恒合法且能被重新解析', () => {
    for (const src of [md, '# 一\n## 甲\n### 甲子\n## 乙\n', '###### 六\n- 甲\n\t- 乙\n- 丙\n']) {
      const tree = parse(src)
      const nodes = allNodes(tree)
      const parents: (string | null)[] = [null, ...nodes.map((n) => n.id)]
      for (const node of nodes) {
        for (const parentId of parents) {
          const parent = parentId === null ? tree.root : (tree.byId.get(parentId) as MindNode)
          // 跳过手册规定必须抛错的组合：移到自身或自己的后代之下
          if (parent === node) continue
          let isDescendant = false
          for (let p = parent.parent; p; p = p.parent) if (p === node) isDescendant = true
          if (isDescendant) continue

          const count = parent.children.filter((c) => c !== node).length
          for (let idx = 0; idx <= count; idx++) {
            const plan = moveSubtree(tree, node.id, parentId, idx, STRICT)
            const out = joinLines(applyPlan(tree.lines, plan), tree.eol)
            expect(() => parse(out)).not.toThrow()
          }
        }
      }
    }
  })

  it('操作不修改传入的树，也不修改 tree.lines', () => {
    const tree = parse(md)
    const snapshot = [...tree.lines]
    moveSubtree(tree, idOf(tree, '甲'), idOf(tree, '六'), 0, STRICT)
    removeSubtree(tree, [idOf(tree, '乙')])
    renameNode(tree, idOf(tree, '一'), 'x')
    expect(tree.lines).toEqual(snapshot)
    expect(splitLines(md)).toEqual(snapshot)
  })

  it('frontmatter 与标签在任何操作后都零改动', () => {
    const withFm = '---\ntags: [a, b]\n---\n# 一\n## 甲\n'
    const tree = parse(withFm)
    for (const plan of [
      renameNode(tree, idOf(tree, '一'), '改'),
      insertChild(tree, idOf(tree, '一'), '新', 'last', STRICT),
      removeSubtree(tree, [idOf(tree, '甲')]),
      createRoot(tree, '二', STRICT),
    ]) {
      expect(applied(tree, plan).startsWith('---\ntags: [a, b]\n---\n')).toBe(true)
    }
  })
})
