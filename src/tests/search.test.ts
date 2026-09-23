import { describe, expect, it, vi } from 'vitest'
import { parse } from '../core/parser'
import { observeEphemeralState, searchState, searchTargets } from '../view/search'

describe('search navigation', () => {
  it('rejects malformed payloads and copies valid ranges including zero-width regex hits', () => {
    expect(searchState({ match: { content: 'x', matches: [[-1, 1], [0, 2], [NaN, 1], [1, 0]] } })).toBeNull()
    const value = { match: { content: 'word', matches: [[0, 4], [2, 2]] } }
    const state = searchState(value)!
    value.match.matches[0]![0] = 3
    expect(state.match.matches).toEqual([[0, 4], [2, 2]])
  })
  it('maps title, body, hidden lists, and preamble without inventing a node', () => {
    const content = 'preamble\n# one\nbody word\n## two\n- hidden word\n'
    const tree = parse(content, { strictLineBreak: false, listNodes: false })
    const spans = ['preamble', 'one', 'body', 'hidden'].map(word => {
      const at = content.indexOf(word); return [at, at + word.length]
    })
    const result = searchTargets(tree, searchState({ match: { content, matches: spans } })!)!
    expect(result.map(t => [t.node?.text ?? null, t.body])).toEqual([
      [null, true], ['one', false], ['one', true], ['two', true],
    ])
  })
  it('handles CRLF, Unicode, duplicate titles, and rejects outdated offsets', () => {
    const content = '# 中文😀\r\nbody\r\n# 中文😀\r\n'
    const at = content.lastIndexOf('中文')
    const state = searchState({ match: { content, matches: [[at, at + 4]] } })!
    expect(searchTargets(parse(content), state)![0]!.node!.titleLine).toBe(2)
    expect(searchTargets(parse(content.replace(/\r/g, '')), state)![0]!.text).toBe('中文😀')
    expect(searchTargets(parse(content + 'changed'), state)).toBeNull()
  })
  it('restores the intercepted method, preserves this, and composes with later wrappers', () => {
    const seen = vi.fn()
    const native = vi.fn(function (this: { value: unknown }, value: unknown) { this.value = value })
    const target = { value: null as unknown, setEphemeralState: native }
    const restore = observeEphemeralState(target, seen)
    target.setEphemeralState({ match: 1 })
    expect(target.value).toEqual({ match: 1 })
    expect(seen).toHaveBeenCalledWith(target, { match: 1 })
    const ours = target.setEphemeralState
    const later = (state: unknown): void => { ours.call(target, state) }
    target.setEphemeralState = later as typeof native
    restore(); target.setEphemeralState('after unload')
    expect(target.setEphemeralState).toBe(later)
    expect(seen).toHaveBeenCalledTimes(1)
    expect(target.value).toBe('after unload')
  })
})
