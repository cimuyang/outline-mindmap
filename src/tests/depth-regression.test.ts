import { describe, expect, it } from 'vitest'
import { parse } from '../core/parser'
import { maxDepthDrop, moveSubtree } from '../core/tree'

describe('subtree depth protection', () => {
  it('counts cumulative depth across descendants', () => {
    const tree = parse('# A\n## B\n### C', { listNodes: false, strictLineBreak: false })
    expect(maxDepthDrop(tree.root.children[0]!)).toBe(2)
  })
  it('rejects moving a branch whose grandchild would exceed H6', () => {
    const options = { listNodes: false, strictLineBreak: false }
    const tree = parse('# A\n## B\n### C\n# Target\n#### Deep', options)
    const source = tree.root.children[0]!
    const target = [...tree.byId.values()].find(node => node.text === 'Deep')!
    expect(() => moveSubtree(tree, source.id, target.id, 0, options)).toThrow()
  })
})
