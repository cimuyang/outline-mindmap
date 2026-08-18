import { describe, expect, it } from 'vitest'
import { joinLines, listBaseDepthOf, parse } from '../core/parser'
import { serializeNode, serializeTree } from '../core/serializer'
import { applyPlan } from '../core/editplan'
import type { EditPlan, ParseOptions } from '../core/types'
import { FIXTURES } from './fixtures'
import { allNodes, treeShape } from './helpers'

const STRICT: ParseOptions = { strictLineBreak: true }
const LOOSE: ParseOptions = { strictLineBreak: false }

describe('断言 1：parse 不抛错', () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      expect(() => parse(f.md)).not.toThrow()
    })
  }
})

describe('断言 2：parse(serialize(parse(md))) 结构完全相等', () => {
  for (const f of FIXTURES) {
    for (const [label, opts] of [
      ['严格换行开', STRICT],
      ['严格换行关', LOOSE],
    ] as const) {
      it(`${f.name} — ${label}`, () => {
        const tree = parse(f.md)
        const once = joinLines(serializeTree(tree, opts), tree.eol)
        expect(treeShape(parse(once))).toEqual(treeShape(tree))
      })
    }
  }
})

describe('断言 2b：序列化是幂等的（再跑一遍文本不再变化）', () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      const t1 = parse(f.md)
      const s1 = joinLines(serializeTree(t1, STRICT), t1.eol)
      const t2 = parse(s1)
      const s2 = joinLines(serializeTree(t2, STRICT), t2.eol)
      // 严格换行必须是「补足到恰好 3 个」，反复应用不得累积空行
      expect(s2).toBe(s1)
    })
  }
})

describe('断言 3a：零改动哨兵 — 用原文重写节点行，全文逐字节不变', () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      const tree = parse(f.md)
      for (const node of allNodes(tree)) {
        const plan: EditPlan = [
          {
            fromLine: node.titleLine,
            toLine: node.titleLine + 1,
            lines: [tree.lines[node.titleLine] as string],
          },
        ]
        const out = joinLines(applyPlan(tree.lines, plan), tree.eol)
        expect(out).toBe(f.md)
      }
    })
  }
})

describe('断言 3b：规范文本上，serializeNode 重写节点行后全文逐字节不变', () => {
  for (const f of FIXTURES.filter((x) => x.canonical)) {
    it(f.name, () => {
      const tree = parse(f.md)
      for (const node of allNodes(tree)) {
        const plan: EditPlan = [
          {
            fromLine: node.titleLine,
            toLine: node.titleLine + 1,
            lines: [serializeNode(node.text, node.depth, node.kind, listBaseDepthOf(node))],
          },
        ]
        const out = joinLines(applyPlan(tree.lines, plan), tree.eol)
        expect(out).toBe(f.md)
      }
    })
  }
})

describe('CRLF 保留', () => {
  it('CRLF 文件的 eol 被识别并在写回时保留', () => {
    const md = '# 根\r\n\r\n## 子\r\n'
    const tree = parse(md)
    expect(tree.eol).toBe('\r\n')
    expect(tree.lines).toEqual(['# 根', '', '## 子', ''])
    const out = joinLines(tree.lines, tree.eol)
    expect(out).toBe(md)
    expect(out).not.toContain('\n\n') // 没有被降级成 LF
  })

  it('LF 文件不会被升级成 CRLF', () => {
    const tree = parse('# 根\n## 子\n')
    expect(tree.eol).toBe('\n')
  })
})

describe('性能基线', () => {
  it('解析 5000 行 < 20ms', () => {
    const lines: string[] = []
    for (let i = 0; i < 500; i++) {
      lines.push(`# 章 ${i}`, '', '一段正文。', '')
      lines.push(`## 节 ${i}.1`, `### 目 ${i}.1.1`)
      lines.push('###### 六', '- 七', '\t- 八', '')
    }
    const md = lines.join('\n')
    expect(md.split('\n').length).toBeGreaterThanOrEqual(5000)

    parse(md) // 预热
    const t0 = performance.now()
    const tree = parse(md)
    const ms = performance.now() - t0
    console.info(`[bench] parse ${md.split('\n').length} 行耗时 ${ms.toFixed(2)}ms，节点数 ${tree.byId.size}`)
    expect(ms).toBeLessThan(20)
  })
})
