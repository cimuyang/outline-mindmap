import { describe, expect, it, vi } from 'vitest'
import type { App, TFile as ObsidianFile } from 'obsidian'
import { DocumentBridge } from '../src/doc/DocumentBridge'
import { FileHistory } from '../src/doc/FileHistory'
import { MarkdownView, TFile } from './obsidian-runtime'

function setup(initial = '# A\r\n正文\r\n', canWrite: () => boolean = () => true) {
  let text = initial, fail = false
  const file = new TFile() as unknown as ObsidianFile
  const history = new FileHistory<ObsidianFile>()
  const leaves: unknown[] = []
  const app = {
    workspace: { getLeavesOfType: () => leaves },
    vault: {
      cachedRead: async () => text,
      process: vi.fn(async (_f: unknown, update: (text: string) => string) => {
        if (fail) throw Error('disk full')
        text = update(text)
        return text
      }),
    },
  } as unknown as App
  const events = vi.fn()
  const bridge = new DocumentBridge(app, events, history, canWrite)
  bridge.setFile(file)
  return { app, file, history, bridge, leaves, events, get: () => text,
    set: (value: string) => { text = value }, fail: (value: boolean) => { fail = value } }
}

describe('DocumentBridge file/editor history', () => {
  it('rejects a queued edit if the map is locked before its turn', async () => {
    let unlocked = true, release!: () => void
    const s = setup('# A', () => unlocked)
    const blocker = s.history.run(s.file, () => new Promise<void>(resolve => { release = resolve }))
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const write = s.bridge.applyPlan(s.file, ['# A'], [{ fromLine: 0, toLine: 1, lines: ['# B'] }], '\n')
    const rejected = expect(write).rejects.toThrow('锁定')
    unlocked = false; release()
    await blocker; await rejected
    expect(s.get()).toBe('# A')
    expect(s.app.vault.process).not.toHaveBeenCalled()
    expect(s.history.peek(s.file, 'undo')).toBeUndefined()
  })

  it('rechecks a lock inside delayed vault processing, including undo/redo', async () => {
    let unlocked = true, release!: () => void
    const s = setup('# A', () => unlocked)
    await s.bridge.applyPlan(s.file, ['# A'], [{ fromLine: 0, toLine: 1, lines: ['# B'] }], '\n')
    const original = s.app.vault.process.bind(s.app.vault)
    s.app.vault.process = vi.fn(async (file, update) => {
      await new Promise<void>(resolve => { release = resolve })
      return original(file, update)
    })
    const undo = s.bridge.historyStep(s.file, 'undo')
    const rejected = expect(undo).rejects.toThrow('锁定')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    unlocked = false; release(); await rejected
    expect(s.get()).toBe('# B')
    expect(s.history.peek(s.file, 'undo')).toBeDefined()
    await expect(s.bridge.historyStep(s.file, 'redo')).rejects.toThrow('锁定')
    s.app.vault.process = original; unlocked = true
    expect(await s.bridge.historyStep(s.file, 'undo')).toBe('ok')
    expect(s.get()).toBe('# A')
  })

  it('does not transact into a loaded editor while its map is locked', async () => {
    const s = setup('# A', () => false)
    const view = new MarkdownView(); view.file = s.file as unknown as TFile
    const editor = { transaction: vi.fn(), undo: vi.fn(), getValue: () => '# A' }
    view.editor = editor
    s.leaves.push({ view, getViewState: () => ({ state: { file: s.file.path } }) })
    await expect(s.bridge.applyPlan(s.file, ['# A'], [{ fromLine: 0, toLine: 1, lines: ['# B'] }], '\n')).rejects.toThrow('锁定')
    await expect(s.bridge.historyStep(s.file, 'undo')).rejects.toThrow('锁定')
    expect(editor.transaction).not.toHaveBeenCalled(); expect(editor.undo).not.toHaveBeenCalled()
  })

  it('discards an old asynchronous read that finishes after an undo broadcast', async () => {
    const s = setup('# A')
    let release!: (text: string) => void
    s.app.vault.cachedRead = vi.fn(() => new Promise<string>(resolve => { release = resolve }))
    const emit = (s.bridge as any).emit()
    s.history.publish(s.file, '# New')
    release('# A')
    await emit
    expect(s.events).toHaveBeenCalledTimes(1)
    expect(s.events).toHaveBeenLastCalledWith({ file: s.file, text: '# New', selfOriginated: false })
  })

  it('queues immediate undo after a write; redo preserves every CRLF and body byte', async () => {
    const s = setup()
    const write = s.bridge.applyPlan(s.file, ['# A', '正文', ''], [{ fromLine: 0, toLine: 1, lines: ['# B'] }], '\r\n')
    const undo = s.bridge.historyStep(s.file, 'undo')
    await write
    expect(await undo).toBe('ok')
    expect(s.get()).toBe('# A\r\n正文\r\n')
    expect(await s.bridge.historyStep(s.file, 'redo')).toBe('ok')
    expect(s.get()).toBe('# B\r\n正文\r\n')
  })
  it('shares history and refreshes all maps, including one with an old pending echo', async () => {
    const s = setup('# A')
    const otherEvents = vi.fn()
    const other = new DocumentBridge(s.app, otherEvents, s.history)
    other.setFile(s.file)
    await s.bridge.applyPlan(s.file, ['# A'], [{ fromLine: 0, toLine: 1, lines: ['# B'] }], '\n')
    await s.bridge.applyPlan(s.file, ['# B'], [{ fromLine: 0, toLine: 1, lines: ['# C'] }], '\n')
    await other.historyStep(s.file, 'undo')
    expect(s.get()).toBe('# B')
    expect(s.events).toHaveBeenLastCalledWith({ file: s.file, text: '# B', selfOriginated: false })
    expect(otherEvents).toHaveBeenLastCalledWith({ file: s.file, text: '# B', selfOriginated: false })
    await s.bridge.historyStep(s.file, 'undo')
    expect(s.get()).toBe('# A')
  })
  it('never overwrites an external change, even outside the edited node', async () => {
    const s = setup('# A\nbody')
    await s.bridge.applyPlan(s.file, ['# A', 'body'], [{ fromLine: 0, toLine: 1, lines: ['# B'] }], '\n')
    s.set('# B\nexternal body')
    expect(await s.bridge.historyStep(s.file, 'undo')).toBe('conflict')
    expect(s.get()).toBe('# B\nexternal body')
    expect(await s.bridge.historyStep(s.file, 'undo')).toBe('empty')
    expect(await s.bridge.historyStep(s.file, 'redo')).toBe('empty')
  })
  it('failed writes neither create history nor consume an undo entry', async () => {
    const s = setup('# A')
    s.fail(true)
    await expect(s.bridge.applyPlan(s.file, ['# A'], [{ fromLine: 0, toLine: 1, lines: ['# B'] }], '\n')).rejects.toThrow('disk full')
    expect(s.history.peek(s.file, 'undo')).toBeUndefined()
    s.fail(false)
    await s.bridge.applyPlan(s.file, ['# A'], [{ fromLine: 0, toLine: 1, lines: ['# B'] }], '\n')
    s.fail(true)
    await expect(s.bridge.historyStep(s.file, 'undo')).rejects.toThrow('disk full')
    s.fail(false)
    expect(await s.bridge.historyStep(s.file, 'undo')).toBe('ok')
    expect(s.get()).toBe('# A')
  })
  it('rejects a stale insertion rather than inserting into the wrong line', async () => {
    const s = setup('# External\n# A')
    await expect(s.bridge.applyPlan(s.file, ['# A'], [{ fromLine: 1, toLine: 1, lines: ['# B'] }], '\n')).rejects.toThrow()
    expect(s.get()).toBe('# External\n# A')
  })
  it('uses a loaded editor even when an earlier same-file leaf is deferred', async () => {
    const s = setup('# A')
    s.history.record(s.file, '# Old', '# A')
    const view = new MarkdownView()
    view.file = s.file as unknown as TFile
    const editor = { undo: vi.fn(), redo: vi.fn(), getValue: () => '# A' }
    view.editor = editor
    const getViewState = () => ({ state: { file: s.file.path } })
    s.leaves.push({ view: {}, getViewState }, { view, getViewState })
    await s.bridge.historyStep(s.file, 'undo'); await s.bridge.historyStep(s.file, 'redo')
    expect(editor.undo).toHaveBeenCalledTimes(1)
    expect(editor.redo).toHaveBeenCalledTimes(1)
    expect(s.app.vault.process).not.toHaveBeenCalled()
    expect(s.history.peek(s.file, 'undo')).toBeUndefined()
  })
})
