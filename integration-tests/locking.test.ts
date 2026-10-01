import { afterEach, describe, expect, it, vi } from 'vitest'
import { MindmapView } from '../src/view/MindmapView'
import { Toolbar } from '../src/view/Toolbar'
import { DocumentBridge } from '../src/doc/DocumentBridge'
import { FileHistory } from '../src/doc/FileHistory'
import { parse } from '../src/core/parser'
import { normalizeSettings } from '../src/settings/SettingsTab'
import { StyleStore } from '../src/settings/StyleStore'
import { ViewPreferences } from '../src/settings/ViewPreferences'
import { FakeElement, findByClass } from './fake-dom'
import { MarkdownView, TFile } from './obsidian-runtime'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function setup(preferences = new ViewPreferences({}, () => {})) {
  const settings = normalizeSettings(null)
  const file = new TFile('a.md')
  const leaves: any[] = []
  const app: any = { workspace: { getLeavesOfType: () => leaves },
    vault: { cachedRead: vi.fn(async () => '# A\n## B'), process: vi.fn() } }
  const host: any = { preferences, settings, fileHistory: new FileHistory(),
    styles: new StyleStore(settings.styles, () => {}) }
  const view: any = new MindmapView({ app } as any, host)
  view.ready = true
  view.file = file
  view.tree = parse('# A\n## B')
  view.searchBar = new FakeElement()
  view.nodeRenderer = { setSearch: vi.fn() }
  view.canvas = { cancelGesture: vi.fn(), fit: vi.fn(() => true), snapshot: vi.fn(() => ({ scale: 2, x: 40, y: 50 })),
    restore: vi.fn(() => true), centerOn: vi.fn(() => true), ensureVisible: vi.fn(), focus: vi.fn() }
  view.toolbar = { setLocked: vi.fn() }
  view.editor = { active: false, stop: vi.fn(), start: vi.fn() }
  view.drag = { active: false, cancel: vi.fn() }
  view.motion = { reset: vi.fn(), finish: vi.fn() }
  view.draw = vi.fn()
  view.boxes = new Map([...view.tree.byId.keys()].map((id: string) => [id, { x: 0, y: 0, w: 100, h: 40 }]))
  view.bridge = new DocumentBridge(app, view.onDocumentChange, host.fileHistory, (target: any) => view.canWriteFile(target))
  view.bridge.setFile(file)
  preferences.subscribe(() => view.syncLock(true))
  return { view, file, host, leaves, app }
}

function note(s: ReturnType<typeof setup>, mode: 'source' | 'preview') {
  const markdown = new MarkdownView()
  markdown.file = s.file
  let currentMode = mode
  markdown.getMode = () => currentMode
  const leaf = { view: markdown, getViewState: () => ({ state: { file: s.file.path } }) }
  s.leaves.push(leaf)
  return { markdown, setMode: (next: typeof mode) => { currentMode = next } }
}

describe('manual and Reading-view locks', () => {
  it('keeps a locked map live while its source editor can continue editing', async () => {
    const s = setup(), n = note(s, 'source')
    n.markdown.editor = { getValue: () => '# Changed\n## B' }
    s.host.preferences.setLocked(s.file.path, true)
    expect(s.view.canEdit()).toBe(false)
    await (s.view.bridge as any).emit()
    expect(s.view.tree.root.children[0].text).toBe('Changed')
    expect(s.view.draw).toHaveBeenCalled()
    expect(s.app.vault.process).not.toHaveBeenCalled()
  })

  it.each([false, true])('Reading view is forced and returning to source restores manual lock (%s)', manual => {
    const s = setup(), n = note(s, 'source')
    s.host.preferences.setLocked(s.file.path, manual)
    expect(s.view.canEdit()).toBe(!manual)
    n.setMode('preview'); s.view.syncLock()
    expect(s.view.canEdit()).toBe(false)
    expect(s.view.toolbar.setLocked).toHaveBeenLastCalledWith(true, true, true)
    s.view.toggleLock()
    expect(s.host.preferences.isLocked(s.file.path)).toBe(manual)
    n.setMode('source'); s.view.syncLock()
    expect(s.view.canEdit()).toBe(!manual)
  })

  it('ignores unrelated/hidden Reading tabs and prioritizes a visible reader of the same note', () => {
    const s = setup(), n = note(s, 'preview')
    n.markdown.file = new TFile('other.md')
    expect(s.view.canEdit()).toBe(true)
    n.markdown.file = s.file; n.markdown.containerEl.shown = false
    expect(s.view.canEdit()).toBe(true)
    n.markdown.containerEl.shown = true
    expect(s.view.canEdit()).toBe(false)
    note(s, 'source')
    expect(s.view.canEdit()).toBe(false)
  })

  it('inherits Reading mode when the source tab becomes a pure map, including workspace restore', async () => {
    const s = setup()
    s.view.ready = false
    await s.view.setState({ file: s.file.path, pinned: true, noteMode: 'preview' }, {})
    s.view.syncLock()
    expect(s.view.canEdit()).toBe(false)
    expect(s.view.getState()).toMatchObject({ noteMode: 'preview', pinned: true })
    await s.view.setState({ file: s.file.path, pinned: true, noteMode: 'source' }, {})
    expect(s.view.canEdit()).toBe(true)
    s.host.settings.openAs[s.file.path] = { noteMode: 'preview' }
    await s.view.setState({ file: s.file.path, pinned: true }, {})
    expect(s.view.canEdit()).toBe(false)
  })

  it('a stale following-view restore cannot impose another note\'s Reading mode', async () => {
    const s = setup()
    s.view.showRestored = vi.fn(async () => true)
    await s.view.setState({ file: 'old.md', pinned: false, noteMode: 'preview' }, {})
    expect(s.view.noteMode).toBe('source')
    expect(s.view.canEdit()).toBe(true)
  })

  it('broadcasts the manual lock to another map without changing its viewport', () => {
    const preferences = new ViewPreferences({}, () => {})
    const a = setup(preferences), b = setup(preferences)
    a.view.toggleLock()
    expect(a.view.canEdit()).toBe(false)
    expect(b.view.canEdit()).toBe(false)
    expect(b.view.canvas.restore).not.toHaveBeenCalled()
    b.view.toggleLock()
    expect(a.view.canEdit()).toBe(true)
  })

  it('blocks rename, insertion, deletion, drop, commit and history at their entry points', async () => {
    const s = setup()
    const write = vi.spyOn(s.view.bridge, 'applyPlan')
    const history = vi.spyOn(s.view.bridge, 'historyStep')
    const id = s.view.tree.root.children[0].id
    const source = s.view.tree.lines.join('\n')
    s.view.focusId = id; s.view.selection.add(id)
    s.host.preferences.setLocked(s.file.path, true)
    s.view.beginRename(id); s.view.beginDraft({ type: 'root' }); s.view.removeSelected()
    s.view.onDrop(id, { parentId: null, index: 1 })
    s.view.onEditorCommit('new', 'sibling')
    s.view.applyEdit([{ fromLine: 0, toLine: 1, lines: ['# Changed'] }])
    await s.view.stepHistory('undo'); await s.view.stepHistory('redo')
    expect(write).not.toHaveBeenCalled(); expect(history).not.toHaveBeenCalled()
    expect(s.view.editor.start).not.toHaveBeenCalled()
    expect(s.view.tree.lines.join('\n')).toBe(source)
  })

  it('cancels an uncommitted rename and drag when locking, then applies pending source changes', () => {
    const s = setup(), node = s.view.tree.root.children[0]
    s.view.session = { node, originalText: 'A', draft: false, returnTo: node.id, intent: { type: 'rename', id: node.id } }
    node.text = 'unfinished'
    s.view.pendingText = '# External\n## B'
    s.host.preferences.setLocked(s.file.path, true)
    expect(s.view.session).toBeNull()
    expect(s.view.editor.stop).toHaveBeenCalled()
    expect(s.view.drag.cancel).toHaveBeenCalled()
    expect(s.view.tree.root.children[0].text).toBe('External')
    expect(s.app.vault.process).not.toHaveBeenCalled()
  })

  it('observes same-file mode changes, without touching the note DOM', () => {
    const s = setup(), n = note(s, 'source')
    let callback!: () => void
    const observe = vi.fn(), disconnect = vi.fn()
    vi.stubGlobal('MutationObserver', class {
      constructor(fn: () => void) { callback = fn }
      observe = observe; disconnect = disconnect
    })
    s.view.observeNoteMode()
    expect(observe).toHaveBeenCalledWith(n.markdown.contentEl, expect.any(Object))
    n.setMode('preview'); callback()
    expect(s.view.locked).toBe(true)
    n.setMode('source'); callback()
    expect(s.view.locked).toBe(false)
    s.view.observeNoteMode()
    expect(observe).toHaveBeenCalledTimes(1)
  })
})

describe('view preferences and toolbar integration', () => {
  it('restores each note after its first layout and waits while the viewport is hidden', () => {
    vi.useFakeTimers()
    const s = setup()
    const saved = { scale: 1.5, x: 200, y: 300 }
    s.host.preferences.rememberViewport('b.md', saved)
    s.view.adoptFile(new TFile('b.md'))
    s.view.canvas.restore.mockReturnValueOnce(false)
    s.view.resizeCanvas()
    expect(s.view.needsFit).toBe(true)
    s.view.resizeCanvas()
    expect(s.view.canvas.restore).toHaveBeenLastCalledWith(saved, expect.anything())
    expect(s.view.needsFit).toBe(false)
    expect(s.view.canvas.fit).not.toHaveBeenCalled()
    s.view.resizeCanvas()
    expect(s.view.canvas.restore).toHaveBeenCalledTimes(2)
    s.host.preferences.flush()
  })

  it('uses fit only for new notes and persists an explicit user fit', () => {
    vi.useFakeTimers()
    const s = setup()
    s.view.adoptFile(new TFile('new.md'))
    s.view.resizeCanvas()
    expect(s.view.canvas.fit).toHaveBeenCalledTimes(1)
    expect(s.host.preferences.viewportFor('new.md')).toBeUndefined()
    s.view.fitToScreen()
    expect(s.host.preferences.viewportFor('new.md')).toEqual({ scale: 2, x: 40, y: 50 })
    s.host.preferences.flush()
  })

  it('resolves layout from the same preview/file/global style as appearance', () => {
    const s = setup()
    const original = s.host.styles.styleFor(s.file.path)
    s.host.styles.setPreview(s.file.path, { ...original, direction: 'both' })
    s.view.resolveStyle()
    expect(s.view.direction).toBe('both')
    s.host.styles.clearPreview(); s.view.resolveStyle()
    expect(s.view.direction).toBe(original.direction)
    s.host.styles.applyFile(s.file.path, { ...original, direction: 'left' }); s.view.resolveStyle()
    expect(s.view.direction).toBe('left')
  })

  it('retains the pre-preview viewport through direction changes and Cancel without persisting a temporary view', () => {
    const s = setup()
    s.view.needsFit = false
    const original = { scale: 2, x: 1000, y: 100 }
    s.view.canvas.snapshot.mockReturnValue(original)
    const style = s.host.styles.styleFor(s.file.path)
    s.host.styles.setPreview(s.file.path, { ...style, direction: 'left' })
    s.view.styleChanged()
    expect(s.view.canvas.restore).toHaveBeenLastCalledWith(original, expect.anything())
    s.view.canvas.snapshot.mockReturnValue({ scale: 2, x: 0, y: 20 })
    s.host.styles.setPreview(s.file.path, { ...style, direction: 'both' })
    s.view.styleChanged()
    expect(s.view.canvas.restore).toHaveBeenLastCalledWith(original, expect.anything())
    s.host.styles.clearPreview(); s.view.styleChanged()
    expect(s.view.canvas.restore).toHaveBeenLastCalledWith(original, expect.anything())
    expect(s.view.previewingStyle).toBe(false)
    expect(s.host.preferences.viewportFor(s.file.path)).toBeUndefined()
  })

  it('replaces layout with an accessible lock button and disables unlocking in Reading mode', () => {
    const host = new FakeElement(), toggle = vi.fn()
    const toolbar = new Toolbar(host as any, { fit: vi.fn(), zoom: vi.fn(), expandAll: vi.fn(),
      collapseAll: vi.fn(), openStyle: vi.fn(), afterAction: vi.fn(), toggleLock: toggle })
    const buttons = findByClass(host, 'om-tool')
    expect(buttons.map(button => button.dataset['action'])).toEqual(['fit', 'zoom-out', 'zoom-in', 'expand', 'collapse', 'lock', 'style'])
    const lock: any = buttons.find(button => button.dataset['action'] === 'lock')!
    expect(lock.tagName).toBe('button')
    toolbar.setLocked(false, false, true); lock.dispatch('click')
    expect(toggle).toHaveBeenCalledTimes(1)
    toolbar.setLocked(true, true, true); lock.dispatch('click')
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(lock.disabled).toBe(true)
    expect(lock.attributes['aria-pressed']).toBe('true')
    toolbar.destroy()
    expect(host.children).toEqual([])
  })
})
