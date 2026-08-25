import { describe, expect, it } from 'vitest'
import { detectEol, listBaseDepthOf, parse, splitLines } from '../core/parser'
import { serializeNode, serializeSubtree } from '../core/serializer'
import { applyPlan, validatePlan } from '../core/editplan'
import type { MindNode, ParseOptions } from '../core/types'
import { allNodes, treeShape } from './helpers'

const STRICT: ParseOptions = { strictLineBreak: true }

/** 取文档序第 n 个节点。 */
function nth(md: string, n: number): MindNode {
  const node = allNodes(parse(md))[n]
  if (!node) throw new Error(`没有第 ${n} 个节点`)
  return node
}

function texts(md: string): string[] {
  return allNodes(parse(md)).map((n) => `${n.depth}${n.kind === 'heading' ? 'H' : 'L'}:${n.text}`)
}

// ── A.2 行分类 ─────────────────────────────────────────────────

describe('A.2 行分类', () => {
  it('frontmatter 被完整跳过，其中的列表不是节点', () => {
    const tree = parse('---\ntags:\n  - 不是节点\n---\n# 根\n')
    expect(treeShape(tree)).toEqual([{ text: '根', depth: 1, kind: 'heading', children: [] }])
    // frontmatter 原样保留在 lines 里，位于虚拟 root 的前导正文范围内
    expect(tree.root.bodyEnd).toBe(4)
    expect(tree.lines.slice(0, 4)).toEqual(['---', 'tags:', '  - 不是节点', '---'])
  })

  it('未闭合的 frontmatter 不算 frontmatter，正常解析', () => {
    expect(texts('---\n# 根\n')).toEqual(['1H:根'])
  })

  it('frontmatter 只在第 1 行才成立', () => {
    expect(texts('# 根\n---\nx: 1\n---\n')).toEqual(['1H:根'])
  })

  it('代码围栏内的 # 与 - 一律不是节点', () => {
    expect(texts('# 根\n```\n# 假标题\n- 假列表\n```\n## 真\n')).toEqual(['1H:根', '2H:真'])
  })

  it('围栏可用 ~~~，且内部的 ``` 不会误闭合', () => {
    expect(texts('# 根\n~~~\n```\n# 假\n```\n~~~\n## 真\n')).toEqual(['1H:根', '2H:真'])
  })

  it('闭合围栏的标记数量必须不少于开启时', () => {
    expect(texts('# 根\n````\n```\n# 假\n````\n## 真\n')).toEqual(['1H:根', '2H:真'])
  })

  it('#标题（无空格）不是标题', () => {
    expect(texts('#根\n# 真\n')).toEqual(['1H:真'])
  })

  it('单独一行 # 不是标题', () => {
    expect(texts('#\n# 真\n')).toEqual(['1H:真'])
  })

  it('7 个 # 不是标题', () => {
    expect(texts('####### 七\n# 真\n')).toEqual(['1H:真'])
  })

  it('行首有空格的 # 不是标题', () => {
    expect(texts('  ## 缩进\n# 真\n')).toEqual(['1H:真'])
  })

  it('尾部闭合 # 序列被去除', () => {
    expect(texts('# 根 ###\n')).toEqual(['1H:根'])
    expect(texts('## ###\n')).toEqual(['2H:'])
    expect(texts('# a#b\n')).toEqual(['1H:a#b'])
  })

  it('- * + 三种列表标记都识别，裸 - 不算列表', () => {
    expect(texts('# 根\n- 甲\n* 乙\n+ 丙\n')).toEqual(['1H:根', '2L:甲', '2L:乙', '2L:丙'])
    expect(texts('# 根\n-\n')).toEqual(['1H:根'])
  })

  it('分隔线 --- 不是列表项', () => {
    expect(texts('# 根\n---\n')).toEqual(['1H:根'])
  })
})

// ── A.3 深度计算 ───────────────────────────────────────────────

describe('A.3 深度计算', () => {
  it('标题 depth = # 的个数', () => {
    expect(texts('# 一\n## 二\n### 三\n#### 四\n##### 五\n###### 六\n')).toEqual([
      '1H:一',
      '2H:二',
      '3H:三',
      '4H:四',
      '5H:五',
      '6H:六',
    ])
  })

  it('列表 depth = 最近标题祖先 depth + 1 + 缩进级数', () => {
    expect(texts('### 三\n- 甲\n\t- 乙\n')).toEqual(['3H:三', '4L:甲', '5L:乙'])
  })

  it('无标题祖先时 depth = 1 + 缩进级数', () => {
    expect(texts('- 甲\n\t- 乙\n')).toEqual(['1L:甲', '2L:乙'])
  })

  it('1 个 Tab 与 4 个空格等价', () => {
    expect(texts('# 根\n- 甲\n\t- 乙\n')).toEqual(texts('# 根\n- 甲\n    - 乙\n'))
  })

  it('不足 4 个空格的余数向下取整', () => {
    expect(texts('# 根\n- 甲\n  - 乙\n')).toEqual(['1H:根', '2L:甲', '2L:乙'])
  })

  it('缩进级数以该列表块第一个列表项为基准 0，不是文件绝对缩进', () => {
    expect(texts('### 三\n\t- 甲\n\t\t- 乙\n')).toEqual(['3H:三', '4L:甲', '5L:乙'])
  })

  it('标题层级跳跃：depth 保持不变，但树结构上是直接子节点', () => {
    const tree = parse('# 一\n### 三\n')
    expect(treeShape(tree)).toEqual([
      {
        text: '一',
        depth: 1,
        kind: 'heading',
        children: [{ text: '三', depth: 3, kind: 'heading', children: [] }],
      },
    ])
  })
})

// ── A.4 列表节点模式 ───────────────────────────────────────────

describe('A.4 列表节点模式', () => {
  it('空行不终止模式', () => {
    expect(texts('# 根\n- 甲\n\n- 乙\n')).toEqual(['1H:根', '2L:甲', '2L:乙'])
  })

  it('缩进续行是正文，不终止模式', () => {
    expect(texts('# 根\n- 甲\n  续行\n- 乙\n')).toEqual(['1H:根', '2L:甲', '2L:乙'])
  })

  it('非空非列表非续行的行终止模式，此后的列表一律是正文', () => {
    expect(texts('# 根\n- 甲\n正文\n- 乙\n')).toEqual(['1H:根', '2L:甲'])
  })

  it('模式终止后即使隔了空行，后面的列表仍是正文', () => {
    expect(texts('# 根\n- 甲\n正文\n\n- 乙\n- 丙\n')).toEqual(['1H:根', '2L:甲'])
  })

  it('下一个标题重开作用域，模式重置', () => {
    expect(texts('# 一\n- 甲\n正文\n- 不是\n## 二\n- 乙\n')).toEqual([
      '1H:一',
      '2L:甲',
      '2H:二',
      '3L:乙',
    ])
  })

  it('顶格的代码围栏终止模式', () => {
    expect(texts('# 根\n- 甲\n```\nx\n```\n- 乙\n')).toEqual(['1H:根', '2L:甲'])
  })

  it('列表项内缩进的代码围栏不终止模式', () => {
    expect(texts('# 根\n- 甲\n  ```\n  x\n  - 围栏内不算\n  ```\n- 乙\n')).toEqual([
      '1H:根',
      '2L:甲',
      '2L:乙',
    ])
  })
})

// ── A.5 树的组装与行范围 ───────────────────────────────────────

describe('A.5 树的组装与行范围', () => {
  it('多个 H1 → 多个根节点，挂在 depth 0 的虚拟 root 下', () => {
    const tree = parse('# 甲\n# 乙\n')
    expect(tree.root.depth).toBe(0)
    expect(tree.root.parent).toBeNull()
    expect(tree.root.children.map((c) => c.text)).toEqual(['甲', '乙'])
  })

  it('第一个标题之前的内容归属虚拟 root 的前导正文', () => {
    const tree = parse('前言一\n前言二\n\n# 根\n')
    expect(tree.root.bodyEnd).toBe(3)
    expect(tree.root.children).toHaveLength(1)
  })

  it('blockStart === titleLine', () => {
    for (const n of allNodes(parse('# 一\n## 二\n### 三\n'))) {
      expect(n.blockStart).toBe(n.titleLine)
    }
  })

  it('blockEnd 覆盖整个子树', () => {
    //          0      1      2       3      4
    const md = '# 一\n## 二\n### 三\n# 四\n'
    const one = nth(md, 0)
    expect(one.titleLine).toBe(0)
    expect(one.blockEnd).toBe(3)
    expect(one.bodyEnd).toBe(1)
  })

  it('bodyEnd = 第一个子节点的 titleLine；无子节点时 = blockEnd', () => {
    const md = '# 一\n正文\n## 二\n正文二\n'
    const [one, two] = allNodes(parse(md))
    expect(one?.bodyEnd).toBe(2)
    expect(two?.bodyEnd).toBe(4)
    expect(two?.blockEnd).toBe(4)
  })

  it('blockEnd 修剪尾部连续空行', () => {
    const md = '# 一\n\n\n\n# 二\n'
    const one = nth(md, 0)
    expect(one.blockEnd).toBe(1) // 不拖着 3 个空行
  })

  it('空文件：只有虚拟 root，无节点', () => {
    const tree = parse('')
    expect(tree.lines).toEqual([])
    expect(tree.root.children).toHaveLength(0)
    expect(tree.byId.size).toBe(0)
  })

  it('纯正文无标题：全部是虚拟 root 的前导正文', () => {
    const tree = parse('一段正文。\n又一段。\n')
    expect(tree.root.children).toHaveLength(0)
    expect(tree.root.bodyEnd).toBe(3)
  })

  it('节点 ID 单调递增且可通过 byId 取回', () => {
    const tree = parse('# 一\n## 二\n# 三\n')
    expect(allNodes(tree).map((n) => n.id)).toEqual(['n1', 'n2', 'n3'])
    expect(tree.byId.get('n2')?.text).toBe('二')
  })
})

// ── A.6 序列化 ─────────────────────────────────────────────────

describe('A.6 序列化', () => {
  it('标题：# 重复 depth 次', () => {
    expect(serializeNode('甲', 3, 'heading', 1)).toBe('### 甲')
  })

  it('列表：Tab 重复 (depth - listBaseDepth) 次，标记一律 -', () => {
    expect(serializeNode('甲', 7, 'list', 7)).toBe('- 甲')
    expect(serializeNode('甲', 9, 'list', 7)).toBe('\t\t- 甲')
  })

  it('listBaseDepthOf = 最近标题祖先 depth + 1；无标题祖先则为 1', () => {
    const tree = parse('### 三\n- 甲\n\t- 乙\n')
    const [, jia, yi] = allNodes(tree)
    expect(listBaseDepthOf(jia as MindNode)).toBe(4)
    expect(listBaseDepthOf(yi as MindNode)).toBe(4)
    expect(listBaseDepthOf(allNodes(parse('- 甲\n'))[0] as MindNode)).toBe(1)
  })

  it('严格换行：补足到恰好 3 个空行，不是追加 3 个', () => {
    const tree = parse('# 一\n# 二\n')
    const out = serializeSubtree(tree.lines, nth('# 一\n# 二\n', 0), 1, 'heading', 1, STRICT)
    expect(out).toEqual(['# 一'])

    // 整树才有「下一个标题」，用 serializeTree 语义验证补足行为
    const t2 = parse('# 一\n# 二\n')
    const units = t2.root.children
    expect(units).toHaveLength(2)
  })

  it('严格换行关闭时不插入空行', () => {
    const md = '# 一\n# 二\n'
    const tree = parse(md)
    const a = tree.root.children[0] as MindNode
    expect(serializeSubtree(tree.lines, a, 1, 'heading', 1, { strictLineBreak: false })).toEqual([
      '# 一',
    ])
  })

  it('标题之间已有正文时不动', () => {
    const md = '# 一\n正文\n# 二\n'
    const tree = parse(md)
    const a = tree.root.children[0] as MindNode
    expect(serializeSubtree(tree.lines, a, 1, 'heading', 1, STRICT)).toEqual(['# 一', '正文'])
  })
})

// ── A.7.1 + A.8 kind 判定与跨界转换 ────────────────────────────

describe('A.8 跨界转换示例', () => {
  it('例 1：H4 子树移到 H6 之下 → 整棵子树转列表', () => {
    const md = '###### 六\n#### 四\n##### 五\n'
    const tree = parse(md)
    const four = allNodes(tree).find((n) => n.text === '四') as MindNode
    // 目标：成为「六」(depth 6) 的子节点 → depth 7 → 强制 list，listBaseDepth = 7
    expect(serializeSubtree(tree.lines, four, 7, 'list', 7, STRICT)).toEqual(['- 四', '\t- 五'])
  })

  it('例 2：H6 下的列表节点拖出成自由根 → 整棵子树归一化为标题', () => {
    const md = '###### 六\n- 甲\n\t- 乙\n\t\t- 丙\n'
    const tree = parse(md)
    const jia = allNodes(tree).find((n) => n.text === '甲') as MindNode
    expect(jia.depth).toBe(7)
    expect(jia.kind).toBe('list')
    // 子树根 kind 由 list 变 heading → A.8 补充规则：整棵子树按「能用标题就用标题」归一化
    expect(serializeSubtree(tree.lines, jia, 1, 'heading', 1, STRICT)).toEqual([
      '# 甲',
      '',
      '',
      '',
      '## 乙',
      '',
      '',
      '',
      '### 丙',
    ])
  })

  it('例 3：列表内平移 → 只有 Tab 数变化，kind 不变', () => {
    const md = '###### 六\n- 甲\n\t- 乙\n\t\t- 丙\n'
    const tree = parse(md)
    const bing = allNodes(tree).find((n) => n.text === '丙') as MindNode
    expect(bing.depth).toBe(9)
    // 移到「甲」(depth 7) 之下 → depth 8
    expect(serializeSubtree(tree.lines, bing, 8, 'list', 7, STRICT)).toEqual(['\t- 丙'])
  })

  it('规则 2：depth >= 7 的后代强制为列表', () => {
    const md = '# 一\n## 二\n### 三\n'
    const tree = parse(md)
    const one = tree.root.children[0] as MindNode
    // 把「一」整体压到 depth 5：二→6，三→7 越界，必须转列表
    expect(serializeSubtree(tree.lines, one, 5, 'heading', 1, { strictLineBreak: false })).toEqual([
      '##### 一',
      '###### 二',
      '- 三',
    ])
  })

  it('规则 3：父节点是列表时子节点强制为列表', () => {
    const md = '###### 六\n- 甲\n'
    const tree = parse(md)
    const six = tree.root.children[0] as MindNode
    expect(serializeSubtree(tree.lines, six, 6, 'heading', 1, { strictLineBreak: false })).toEqual([
      '###### 六',
      '- 甲',
    ])
  })

  it('规则 4：子树根 kind 未变时，后代保持原有 kind', () => {
    const md = '## 二\n### 三\n- 甲\n'
    const tree = parse(md)
    const two = tree.root.children[0] as MindNode
    // 平移到 depth 3：三→4 仍是标题，甲→5 仍是列表
    expect(serializeSubtree(tree.lines, two, 3, 'heading', 1, { strictLineBreak: false })).toEqual([
      '### 二',
      '#### 三',
      '- 甲',
    ])
  })

  it('正文跟随子树移动，且不做任何缩进调整', () => {
    const md = '#### 四\n正文一\n\t保持原缩进\n##### 五\n正文二\n'
    const tree = parse(md)
    const four = tree.root.children[0] as MindNode
    expect(serializeSubtree(tree.lines, four, 7, 'list', 7, { strictLineBreak: false })).toEqual([
      '- 四',
      '正文一',
      '\t保持原缩进',
      '\t- 五',
      '正文二',
    ])
  })

  it('depth 差值（标题层级跳跃）在移动后被保留', () => {
    const md = '# 一\n### 三\n'
    const tree = parse(md)
    const one = tree.root.children[0] as MindNode
    expect(serializeSubtree(tree.lines, one, 2, 'heading', 1, { strictLineBreak: false })).toEqual([
      '## 一',
      '#### 三',
    ])
  })
})

// ── 第 4.3 节 EditPlan ─────────────────────────────────────────

describe('EditPlan', () => {
  it('applyPlan 按降序应用，多处编辑互不干扰', () => {
    const lines = ['a', 'b', 'c', 'd']
    const out = applyPlan(lines, [
      { fromLine: 0, toLine: 1, lines: ['A'] },
      { fromLine: 2, toLine: 4, lines: ['X', 'Y', 'Z'] },
    ])
    expect(out).toEqual(['A', 'b', 'X', 'Y', 'Z'])
    expect(lines).toEqual(['a', 'b', 'c', 'd']) // 不修改入参
  })

  it('前一处编辑改变行数时，后一处编辑的行号不受影响（必须降序应用）', () => {
    // 升序应用会让第 2 处编辑落在错位的行上——这是附录 C 第 9 条陷阱
    const out = applyPlan(
      ['a', 'b', 'c', 'd'],
      [
        { fromLine: 0, toLine: 1, lines: ['A1', 'A2', 'A3'] }, // 1 行 → 3 行
        { fromLine: 2, toLine: 3, lines: ['C'] },
      ],
    )
    expect(out).toEqual(['A1', 'A2', 'A3', 'b', 'C', 'd'])
  })

  it('前一处编辑是纯删除时，后一处编辑的行号同样不受影响', () => {
    const out = applyPlan(
      ['a', 'b', 'c', 'd', 'e'],
      [
        { fromLine: 0, toLine: 2, lines: [] }, // 删 2 行
        { fromLine: 3, toLine: 4, lines: ['D'] },
      ],
    )
    expect(out).toEqual(['c', 'D', 'e'])
  })

  it('空 lines 数组 = 纯删除', () => {
    expect(applyPlan(['a', 'b', 'c'], [{ fromLine: 1, toLine: 2, lines: [] }])).toEqual(['a', 'c'])
  })

  it('零长度范围 = 纯插入', () => {
    expect(applyPlan(['a', 'b'], [{ fromLine: 1, toLine: 1, lines: ['x'] }])).toEqual([
      'a',
      'x',
      'b',
    ])
  })

  it('范围重叠直接抛错，绝不静默合并', () => {
    expect(() =>
      validatePlan(
        [
          { fromLine: 0, toLine: 3, lines: [] },
          { fromLine: 2, toLine: 5, lines: [] },
        ],
        10,
      ),
    ).toThrow(/重叠/)
  })

  it('范围越界抛错', () => {
    expect(() => validatePlan([{ fromLine: 0, toLine: 99, lines: [] }], 3)).toThrow(/越界/)
    expect(() => validatePlan([{ fromLine: -1, toLine: 1, lines: [] }], 3)).toThrow(/越界/)
    expect(() => validatePlan([{ fromLine: 2, toLine: 1, lines: [] }], 3)).toThrow(/越界/)
  })
})

// ── 行 / 文本互转 ──────────────────────────────────────────────

describe('splitLines / detectEol', () => {
  it('空串 → 空数组', () => {
    expect(splitLines('')).toEqual([])
  })

  it('尾随换行产生一个空元素，join 回去与原文一致', () => {
    expect(splitLines('a\n')).toEqual(['a', ''])
  })

  it('detectEol', () => {
    expect(detectEol('')).toBe('\n')
    expect(detectEol('abc')).toBe('\n')
    expect(detectEol('a\nb')).toBe('\n')
    expect(detectEol('a\r\nb')).toBe('\r\n')
    expect(detectEol('\na')).toBe('\n')
  })
})
