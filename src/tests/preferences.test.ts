import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeViewPreferences, normalizeViewport, ViewPreferences } from '../settings/ViewPreferences'
import { DEFAULT_STYLE, normalizeStyle, StyleStore, defaultStyleData } from '../settings/StyleStore'

afterEach(() => vi.useRealTimers())

describe('per-note view preferences', () => {
  it('accepts old settings and discards malformed viewport data', () => {
    for (const raw of [undefined, null, [], 'wrong']) expect(normalizeViewPreferences(raw)).toEqual({})
    expect(normalizeViewPreferences({
      'locked.md': { locked: true, viewport: { scale: NaN, x: 0, y: 0 } },
      'empty.md': { locked: false }, 'invalid.md': { viewport: { scale: 1, x: Infinity, y: 0 } },
      'view.md': { viewport: { scale: 100, x: -200, y: 50 } },
    })).toEqual({ 'locked.md': { locked: true },
      'view.md': { locked: false, viewport: { scale: 4, x: -200, y: 50 } } })
    expect(normalizeViewport({ scale: -1, x: 0, y: 0 })).toBeUndefined()
    expect(normalizeViewport({ scale: 1, x: 1e20, y: 0 })).toBeUndefined()
  })

  it('keeps manual locks independent for each note and broadcasts only changes', () => {
    const save = vi.fn(), changed = vi.fn()
    const data = normalizeViewPreferences(null), store = new ViewPreferences(data, save)
    const unsubscribe = store.subscribe(changed)
    store.setLocked('a.md', true); store.setLocked('a.md', true)
    expect(store.isLocked('a.md')).toBe(true)
    expect(store.isLocked('b.md')).toBe(false)
    expect(changed).toHaveBeenCalledTimes(1)
    store.setLocked('a.md', false)
    expect(data).toEqual({})
    unsubscribe(); store.setLocked('b.md', true)
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('coalesces gesture saves, preserves the lock, and restores defensive copies', () => {
    vi.useFakeTimers()
    const save = vi.fn(), changed = vi.fn()
    const store = new ViewPreferences({}, save)
    store.subscribe(changed)
    store.setLocked('a.md', true); save.mockClear(); changed.mockClear()
    for (let x = 0; x < 100; x++) store.rememberViewport('a.md', { scale: 2, x, y: 40 })
    expect(save).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
    expect(store.isLocked('a.md')).toBe(true)
    const copy = store.viewportFor('a.md')!
    copy.x = 5000
    expect(store.viewportFor('a.md')?.x).toBe(99)
    vi.advanceTimersByTime(250)
    expect(save).toHaveBeenCalledTimes(1)
    store.flush()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flushes the latest interaction without re-saving an older background view', () => {
    vi.useFakeTimers()
    const data = {}, save = vi.fn(), store = new ViewPreferences(data, save)
    store.rememberViewport('a.md', { scale: 1, x: 10, y: 20 })
    store.rememberViewport('a.md', { scale: 2, x: 30, y: 40 })
    store.flush()
    expect(normalizeViewPreferences(JSON.parse(JSON.stringify(data)))['a.md']?.viewport)
      .toEqual({ scale: 2, x: 30, y: 40 })
    vi.runAllTimers()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('migrates folder paths and removes deleted-note state, including pending saves', () => {
    vi.useFakeTimers()
    const data = normalizeViewPreferences({ 'folder/a.md': { locked: true }, 'folder2/b.md': { locked: true } })
    const save = vi.fn(), store = new ViewPreferences(data, save)
    store.rememberViewport('folder/a.md', { scale: 1.5, x: 200, y: 100 })
    store.rename('folder', 'moved')
    expect(store.isLocked('moved/a.md')).toBe(true)
    expect(store.viewportFor('moved/a.md')).toEqual({ scale: 1.5, x: 200, y: 100 })
    expect(store.viewportFor('folder/a.md')).toBeUndefined()
    store.remove('moved')
    expect(data).toEqual({ 'folder2/b.md': { locked: true } })
    vi.runAllTimers()
    expect(save).toHaveBeenCalledTimes(2)
  })
})

describe('layout direction participates in style storage', () => {
  it('fills legacy styles and rejects invalid directions', () => {
    expect(normalizeStyle({ shape: 'pill' }).direction).toBe(DEFAULT_STYLE.direction)
    expect(normalizeStyle({ direction: 'down' }).direction).toBe(DEFAULT_STYLE.direction)
    expect(normalizeStyle({}, { ...DEFAULT_STYLE, direction: 'left' }).direction).toBe('left')
  })
  it('previews, cancels, persists and migrates per-note direction', () => {
    const data = defaultStyleData(), save = vi.fn(), store = new StyleStore(data, save)
    store.setPreview('a.md', { ...DEFAULT_STYLE, direction: 'both' })
    expect(store.styleFor('a.md').direction).toBe('both')
    expect(save).not.toHaveBeenCalled()
    store.clearPreview()
    expect(store.styleFor('a.md').direction).toBe(DEFAULT_STYLE.direction)
    store.applyFile('a.md', { ...DEFAULT_STYLE, direction: 'left' })
    store.rename('a.md', 'b.md')
    expect(store.styleFor('b.md').direction).toBe('left')
    store.applyGlobal('b.md', { ...DEFAULT_STYLE, direction: 'both' })
    expect(store.hasOverride('b.md')).toBe(false)
    expect(store.styleFor('c.md').direction).toBe('both')
  })
})
