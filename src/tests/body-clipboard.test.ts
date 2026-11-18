import { describe, it, expect } from 'vitest'
import { parse, joinLines } from '../core/parser'
import { bodyRange, readBody, bodyPlan, rebaseBody, bodyIndicators } from '../core/body'
import { applyPlan } from '../core/editplan'
import { moveSubtree, removeSubtree } from '../core/tree'
import { copyBranches, pastePlan } from '../core/clipboard'
import { showHeadingLevel } from '../core/folding'
import { visibleNodes, layout, DEFAULT_LAYOUT } from '../layout'
const options = { listNodes: true, orderedListNodes: true, strictLineBreak: false }
const node = (tree: ReturnType<typeof parse>, text: string) => [...tree.byId.values()].find(n => n.text === text)!
const write = (tree: ReturnType<typeof parse>, plan: ReturnType<typeof bodyPlan>) => joinLines(applyPlan(tree.lines, plan), tree.eol)

describe('body source ownership', () => {
  it('keeps heading body independent of list visibility', () => {
    const text = '# A\nintro\n- one\n  detail\n\ntail\n## B\nchild'
    for (const listNodes of [false, true]) {
      const tree = parse(text, { ...options, listNodes })
      expect(readBody(tree.lines, bodyRange(tree, node(tree, 'A')))).toBe('intro\n- one\n  detail\n\ntail')
    }
  })
  it('does not let a list carry the following paragraph', () => {
    const tree = parse('# A\n- one\n  detail\n\ntail\n## B', options)
    expect(readBody(tree.lines, bodyRange(tree, node(tree, 'one')))).toBe('detail')
    expect(write(tree, removeSubtree(tree, [node(tree, 'one').id]))).toContain('tail')
  })
  it('ignores headings inside fenced code', () => {
    const tree = parse('# A\n```md\n# code\n```\n## B', options)
    expect(readBody(tree.lines, bodyRange(tree, node(tree, 'A')))).toBe('```md\n# code\n```')
  })
  it('writes only the body with CRLF intact', () => {
    const tree = parse('# A\r\nold\r\n## B\r\nkeep', options)
    expect(write(tree, bodyPlan(bodyRange(tree, node(tree, 'A')), 'new\nline'))).toBe('# A\r\nnew\r\nline\r\n## B\r\nkeep')
  })
  it('indents list body while retaining nested code', () => {
    const tree = parse('# A\n- one\n  old\n- two', options)
    expect(write(tree, bodyPlan(bodyRange(tree, node(tree, 'one')), 'body\n    code'))).toBe('# A\n- one\n  body\n      code\n- two')
  })
  it('moves list continuations without hiding grandchildren', () => {
    const tree = parse('# H\n- A\n  body\n    - A1\n- B', options)
    const next = parse(write(tree, moveSubtree(tree, node(tree, 'A').id, node(tree, 'B').id, 0, options)), options)
    expect(node(next, 'A1')).toBeDefined()
    expect(node(next, 'A').parent?.text).toBe('B')
    expect(readBody(next.lines, bodyRange(next, node(next, 'A')))).toContain('body')
  })
  it('preserves trailing section prose when moving the heading', () => {
    const tree = parse('# A\n- one\n  body\n\ntail\n# B', options)
    const result = write(tree, moveSubtree(tree, node(tree, 'A').id, node(tree, 'B').id, 0, options))
    expect(result.match(/tail/g)).toHaveLength(1)
  })
  it('marks hidden list content as heading body', () => {
    const tree = parse('# A\n- one\n## B', options)
    expect(bodyIndicators(tree).has(node(tree, 'A').id)).toBe(true)
    expect(bodyIndicators(tree).has(node(tree, 'B').id)).toBe(false)
  })
  it('rebases edits before the title and rejects edits inside the body', () => {
    const before = ['# Before', '# A', 'old', '# B']
    const range = { start: 2, end: 3, indent: 0 }
    expect(rebaseBody(before, ['extra', ...before], range)).toEqual({ start: 3, end: 4, indent: 0 })
    expect(rebaseBody(before, ['# Before', '# A', 'new', '# B'], range)).toBeNull()
    expect(rebaseBody(before, ['# Before', '# Renamed', 'old', '# B'], range)).toBeNull()
  })
})
describe('branch clipboard', () => {
  it('deduplicates selected ancestors and includes folded body', () => {
    const tree = parse('# A\nbody\n## B\nchild', options)
    node(tree, 'A').collapsed = true
    expect(copyBranches(tree, new Set([node(tree, 'B').id, node(tree, 'A').id]))).toBe('# A\nbody\n## B\nchild')
  })
  it('pastes headings as children with a single edit', () => {
    const tree = parse('# A', options)
    const plan = pastePlan(tree, node(tree, 'A'), '# X\nbody\n## Y', options)
    const result = parse(write(tree, plan), options)
    expect(plan).toHaveLength(1)
    expect(node(result, 'X').parent?.text).toBe('A')
    expect(node(result, 'Y').parent?.text).toBe('X')
    expect(write(tree, plan)).toContain('body')
  })
  it('pastes as sibling', () => {
    const tree = parse('# A\n## B', options)
    const result = parse(write(tree, pastePlan(tree, node(tree, 'B'), '# C', options, true)), options)
    expect(node(result, 'C').parent?.text).toBe('A')
  })
  it('keeps prose preceding headings', () => {
    const tree = parse('# A', options)
    expect(write(tree, pastePlan(tree, node(tree, 'A'), 'intro\n# X\nbody', options))).toContain('intro')
  })
  it('rejects pasting beyond H6 with lists disabled', () => {
    const tree = parse('###### A', options)
    expect(() => pastePlan(tree, node(tree, 'A'), '# X', { ...options, listNodes: false, orderedListNodes: false })).toThrow()
  })
  it('preserves blank clipboard as no operation', () => {
    const tree = parse('# A', options)
    expect(pastePlan(tree, null, '  ', options)).toEqual([])
  })
})
describe('heading range', () => {
  it('hides a skipped H4 without hiding its H3 sibling', () => {
    const tree = parse('# A\n## B\n#### Deep\n### Visible', options)
    showHeadingLevel(tree, 3)
    expect(visibleNodes(tree).map(n => n.text)).toEqual(['A', 'B', 'Visible'])
    expect(layout(tree, { ...DEFAULT_LAYOUT, measure: () => ({ w: 80, h: 30 }) }).has(node(tree, 'Deep').id)).toBe(false)
  })
  it('keeps top-level headings even when they start at H4', () => {
    const tree = parse('#### A\n##### B', options)
    showHeadingLevel(tree, 3)
    expect(visibleNodes(tree).map(n => n.text)).toEqual(['A'])
  })
})

describe('clipboard destination ownership', () => {
  it('keeps pasted list branches under the requested heading', () => {
    const tree = parse('# A\n## B\nbody', options)
    const result = parse(write(tree, pastePlan(tree, node(tree, 'A'), '- X', options)), options)
    expect(node(result, 'X').parent?.text).toBe('A')
  })
  it('keeps a pasted sibling beside the target', () => {
    const tree = parse('# A\n## B', options)
    const result = parse(write(tree, pastePlan(tree, node(tree, 'B'), '- X', options, true)), options)
    expect(node(result, 'X').parent?.text).toBe('A')
  })
  it('does not hide pasted nodes after trailing prose', () => {
    const tree = parse('# A\n- B\n\ntail', options)
    const result = parse(write(tree, pastePlan(tree, node(tree, 'A'), '- X', options)), options)
    expect(node(result, 'X').parent?.text).toBe('A')
  })
})
