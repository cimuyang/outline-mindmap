import { describe, expect, it } from 'vitest'
import { FileHistory } from '../doc/FileHistory'

describe('shared file history', () => {
  it('only commits successful undo; a new edit replaces the redo branch', () => {
    const h = new FileHistory(), f = {}
    h.record(f, 'a', 'b'); h.record(f, 'b', 'c')
    const entry = h.peek(f, 'undo')!
    expect(h.peek(f, 'redo')).toBeUndefined()
    h.commit(f, 'undo', entry)
    expect(h.peek(f, 'redo')).toEqual({ before: 'b', after: 'c' })
    h.record(f, 'b', 'd')
    expect(h.peek(f, 'redo')).toBeUndefined()
    h.commit(f, 'undo', h.peek(f, 'undo')!)
    expect(h.peek(f, 'undo')).toEqual({ before: 'a', after: 'b' })
  })
  it('external content starts a fresh history; no-op edits do not discard redo', () => {
    const h = new FileHistory(), f = {}
    h.record(f, 'a', 'b'); h.commit(f, 'undo', h.peek(f, 'undo')!)
    h.record(f, 'a', 'a')
    expect(h.peek(f, 'redo')).toBeDefined()
    h.record(f, 'external', 'new')
    h.commit(f, 'undo', h.peek(f, 'undo')!)
    expect(h.peek(f, 'undo')).toBeUndefined()
  })
  it('bounds memory across files, operation count, and oversized notes', () => {
    const h = new FileHistory(2, 12, 2), a = {}, b = {}, c = {}
    h.record(a, 'a', 'b'); h.record(a, 'b', 'c'); h.record(a, 'c', 'd')
    h.commit(a, 'undo', h.peek(a, 'undo')!); h.commit(a, 'undo', h.peek(a, 'undo')!)
    expect(h.peek(a, 'undo')).toBeUndefined()
    h.record(b, 'a', 'b'); h.record(c, 'a', 'b')
    expect(h.peek(a, 'redo')).toBeUndefined()
    h.record(c, '1234567', '7654321')
    expect(h.peek(c, 'undo')).toBeUndefined()
  })
  it('serializes shared-file work, survives failure, and leaves other files independent', async () => {
    const h = new FileHistory(), a = {}, b = {}, order: string[] = []
    let release!: () => void
    const blocked = h.run(a, () => new Promise<void>(resolve => { release = resolve }))
    const failed = h.run(a, () => { order.push('fail'); throw Error('disk full') })
    const caught = failed.catch(() => undefined)
    const next = h.run(a, () => { order.push('next') })
    await h.run(b, () => { order.push('other') })
    expect(order).toEqual(['other'])
    release(); await Promise.all([blocked, caught, next])
    expect(order).toEqual(['other', 'fail', 'next'])
  })
})
