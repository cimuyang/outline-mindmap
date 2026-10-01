import { afterEach, describe, expect, it, vi } from 'vitest'
import OutlineMindmapPlugin from '../src/main'
import { MindmapView, VIEW_TYPE_MINDMAP } from '../src/view/MindmapView'
import { MarkdownView, TFile, WorkspaceLeaf } from './obsidian-runtime'

const plugins: OutlineMindmapPlugin[] = []
afterEach(() => { for (const plugin of plugins.splice(0)) plugin.unload() })

async function setup() {
  const files = new Map<string, TFile>()
  const leaves: any[] = []
  const mainRoot = {}, rightRoot = {}, leftRoot = {}
  let activeFile: TFile | null = null
  let deferLoading = false
  let nextSetView: Promise<void> | undefined
  const app: any = { vault: {
    on: vi.fn(), getFileByPath: (path: string) => files.get(path) ?? null,
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
  }, workspace: {
    on: vi.fn(), activeLeaf: null, rootSplit: mainRoot, rightSplit: rightRoot, leftSplit: leftRoot,
    getActiveFile: () => activeFile,
    getActiveViewOfType: (type: any) => app.workspace.activeLeaf?.view instanceof type
      ? app.workspace.activeLeaf.view : null,
    getMostRecentLeaf: () => app.workspace.activeLeaf,
    getLeavesOfType: (type: string) => leaves.filter(leaf =>
      type === VIEW_TYPE_MINDMAP ? leaf.view instanceof MindmapView : leaf.view instanceof MarkdownView),
    revealLeaf: vi.fn(async (leaf: any) => { app.workspace.activeLeaf = leaf }),
  } }
  const plugin: any = new OutlineMindmapPlugin(app)
  plugins.push(plugin)
  await plugin.onload()

  function file(path: string): TFile {
    const result: any = new TFile(path)
    files.set(path, result)
    return result
  }
  function newLeaf(root = mainRoot): any {
    const leaf: any = new WorkspaceLeaf(app)
    let nativePinned = false
    leaf.getRoot = () => root
    leaf.setPinned = vi.fn((pinned: boolean) => { nativePinned = pinned })
    // Read the real view state. In particular, never echo a requested file path
    // back while MindmapView still has only pendingPath and file is null.
    leaf.getViewState = () => ({ type: leaf.view instanceof MindmapView ? VIEW_TYPE_MINDMAP : 'markdown',
      pinned: nativePinned,
      state: leaf.view instanceof MindmapView ? leaf.view.getState() : { file: leaf.view?.file?.path } })
    leaf.setViewState = vi.fn(async (state: any) => {
      const wait = nextSetView
      nextSetView = undefined
      if (wait) await wait
      if (typeof state.pinned === 'boolean') nativePinned = state.pinned
      if (!(leaf.view instanceof MindmapView)) leaf.view = new MindmapView(leaf, plugin)
      await leaf.view.setState(state.state, {})
      // This harness omits canvas rendering. Only after simulated file loading
      // completes do we give the real view its loaded file, as onOpen would.
      if (!deferLoading) leaf.view.file = files.get(state.state?.file) ?? activeFile
    })
    leaves.push(leaf)
    return leaf
  }
  app.workspace.getLeaf = vi.fn((newTab?: string | boolean) => {
    if (newTab === 'tab' || newTab === true) return newLeaf()
    // Model Obsidian's navigation choice separately from MindmapView.pinned:
    // native tab pinning protects a leaf from subsequent file navigation.
    const active = app.workspace.activeLeaf
    if (active && !active.getViewState().pinned && active.view?.navigation !== false) return active
    return leaves.find(leaf => leaf.getRoot() === mainRoot &&
      !leaf.getViewState().pinned && leaf.view?.navigation !== false) ?? newLeaf()
  })
  app.workspace.getRightLeaf = vi.fn(() => newLeaf(rightRoot))
  function activateNote(note: TFile) {
    const leaf = newLeaf()
    leaf.view = new MarkdownView(leaf)
    leaf.view.file = note
    app.workspace.activeLeaf = leaf
    activeFile = note
    return leaf
  }
  function openFromFileExplorer(note: TFile) {
    const leaf = app.workspace.getLeaf(false)
    leaf.view = new MarkdownView(leaf)
    leaf.view.file = note
    app.workspace.activeLeaf = leaf
    activeFile = note
    return leaf
  }
  async function existingMap(note: TFile, pinned = true, side: 'main' | 'right' | 'left' = 'main') {
    const leaf = newLeaf(side === 'right' ? rightRoot : side === 'left' ? leftRoot : mainRoot)
    await leaf.setViewState({ type: VIEW_TYPE_MINDMAP, state: { file: note.path, pinned } })
    leaf.setViewState.mockClear()
    return leaf
  }
  const maps = () => leaves.filter(leaf => leaf.view instanceof MindmapView)
  return { plugin, app, file, activateNote, openFromFileExplorer, existingMap, maps,
    activateMap: (leaf: any, staleFile: TFile | null = null) => {
      app.workspace.activeLeaf = leaf
      activeFile = staleFile
    },
    activateNothing: () => { app.workspace.activeLeaf = null; activeFile = null },
    deferLoading: () => { deferLoading = true },
    holdNextSetView: () => {
      let release!: () => void
      nextSetView = new Promise<void>(resolve => { release = resolve })
      return release
    },
  }
}

describe('opening multiple mindmap tabs', () => {
  it('opens different Markdown files in separate pinned tabs without replacing either note', async () => {
    const s = await setup()
    const a = s.file('a.md'), b = s.file('b.md')
    const noteA = s.activateNote(a)
    await s.plugin.activateView('tab')
    const noteB = s.activateNote(b)
    await s.plugin.activateView('tab')
    expect(s.maps()).toHaveLength(2)
    expect(s.maps().map(leaf => leaf.view.getState())).toEqual([
      expect.objectContaining({ file: 'a.md', pinned: true }),
      expect.objectContaining({ file: 'b.md', pinned: true }),
    ])
    expect(noteA.view).toBeInstanceOf(MarkdownView)
    expect(noteB.view).toBeInstanceOf(MarkdownView)
    expect(s.app.workspace.getLeaf).toHaveBeenCalledTimes(2)
    expect(s.maps().every(leaf => leaf.getViewState().pinned)).toBe(true)
  })

  it('reuses the map for the same file, even when a different map was opened first', async () => {
    const s = await setup()
    const a = s.file('a.md'), b = s.file('b.md')
    const other = await s.existingMap(b)
    const wanted = await s.existingMap(a)
    s.activateNote(a)
    await s.plugin.activateView('tab')
    expect(s.maps()).toHaveLength(2)
    expect(s.app.workspace.revealLeaf).toHaveBeenLastCalledWith(wanted)
    expect(other.setViewState).not.toHaveBeenCalled()
    expect(wanted.setViewState).not.toHaveBeenCalled()
    expect(wanted.getViewState().pinned).toBe(true)
    expect(s.app.workspace.getLeaf).not.toHaveBeenCalled()
  })

  it('uses the active map file instead of Obsidian鈥檚 stale active Markdown file', async () => {
    const s = await setup()
    const a = s.file('a.md'), b = s.file('b.md')
    await s.existingMap(b)
    const wanted = await s.existingMap(a)
    s.activateMap(wanted, b)
    await s.plugin.activateView('tab')
    expect(s.app.workspace.revealLeaf).toHaveBeenLastCalledWith(wanted)
    expect(s.maps()).toHaveLength(2)
    expect(wanted.view.getState()).toMatchObject({ file: 'a.md', pinned: true })
  })

  it('keeps a sidebar map separate from the pinned main-area map of the same file', async () => {
    const s = await setup()
    const a = s.file('a.md')
    const sidebar = await s.existingMap(a, false, 'right')
    s.activateNote(a)
    await s.plugin.activateView('tab')
    expect(s.maps()).toHaveLength(2)
    expect(s.app.workspace.revealLeaf).not.toHaveBeenLastCalledWith(sidebar)
    expect(sidebar.view.getState()).toMatchObject({ file: 'a.md', pinned: false })
    expect(sidebar.setViewState).not.toHaveBeenCalled()
    expect(sidebar.setPinned).not.toHaveBeenCalled()
  })

  it('does not take a map dragged into the left sidebar as a main-area tab', async () => {
    const s = await setup()
    const a = s.file('a.md')
    const sidebar = await s.existingMap(a, false, 'left')
    s.activateNote(a)
    await s.plugin.activateView('tab')
    expect(s.maps()).toHaveLength(2)
    expect(s.app.workspace.revealLeaf).not.toHaveBeenLastCalledWith(sidebar)
    expect(sidebar.setViewState).not.toHaveBeenCalled()
  })

  it('continues to reuse the following sidebar view and leaves pinned main tabs alone', async () => {
    const s = await setup()
    const a = s.file('a.md'), b = s.file('b.md')
    const main = await s.existingMap(a)
    const sidebar = await s.existingMap(a, false, 'right')
    s.activateNote(b)
    await s.plugin.activateView('right')
    await s.plugin.activateView('right')
    expect(s.maps()).toHaveLength(2)
    expect(s.app.workspace.revealLeaf).toHaveBeenLastCalledWith(sidebar)
    expect(sidebar.view.getState()).toMatchObject({ pinned: false })
    expect(sidebar.setViewState).not.toHaveBeenCalled()
    expect(main.setViewState).not.toHaveBeenCalled()
    expect(s.app.workspace.getRightLeaf).not.toHaveBeenCalled()
  })

  it('creates a following sidebar map when none exists', async () => {
    const s = await setup()
    s.activateNote(s.file('a.md'))
    await s.plugin.activateView('right')
    expect(s.maps()).toHaveLength(1)
    expect(s.maps()[0].getRoot()).toBe(s.app.workspace.rightSplit)
    expect(s.maps()[0].view.getState()).toMatchObject({ pinned: false })
    expect(s.maps()[0].getViewState().pinned).toBe(false)
    expect(s.maps()[0].setPinned).not.toHaveBeenCalled()
  })

  it('keeps map A when a normal file-explorer click opens B, then keeps both maps when C opens', async () => {
    const s = await setup()
    const a = s.file('a.md'), b = s.file('b.md'), c = s.file('c.md')
    s.activateNote(a)
    await s.plugin.activateView('tab')
    const mapA = s.maps()[0]
    s.openFromFileExplorer(b)
    expect(mapA.view).toBeInstanceOf(MindmapView)
    expect(mapA.view.getState()).toMatchObject({ file: 'a.md', pinned: true })
    await s.plugin.activateView('tab')
    const mapB = s.maps().find(leaf => leaf.view.getState().file === 'b.md')
    expect(mapB).toBeDefined()
    s.openFromFileExplorer(c)
    expect(mapB.view).toBeInstanceOf(MindmapView)
    expect(s.maps().map(leaf => leaf.view.getState().file).sort()).toEqual(['a.md', 'b.md'])
    expect(s.maps().every(leaf => leaf.getViewState().pinned)).toBe(true)
  })

  it('does not create an empty tab when there is no active Markdown file', async () => {
    const s = await setup()
    s.activateNothing()
    await s.plugin.activateView('tab')
    expect(s.maps()).toHaveLength(0)
    expect(s.app.workspace.getLeaf).not.toHaveBeenCalled()
  })

  it('does not treat a non-Markdown file as a map source', async () => {
    const s = await setup()
    s.activateNote(s.file('image.png'))
    await s.plugin.activateView('tab')
    expect(s.maps()).toHaveLength(0)
    expect(s.app.workspace.getLeaf).not.toHaveBeenCalled()
  })

  it('serializes simultaneous commands for the same file before view creation finishes', async () => {
    const s = await setup()
    s.activateNote(s.file('a.md'))
    const release = s.holdNextSetView()
    const first = s.plugin.activateView('tab')
    const second = s.plugin.activateView('tab')
    release()
    await Promise.all([first, second])
    expect(s.maps()).toHaveLength(1)
    expect(s.app.workspace.getLeaf).toHaveBeenCalledTimes(1)
    expect(s.maps()[0].view.getState()).toMatchObject({ file: 'a.md', pinned: true })
  })

  it('reuses the same target while the real view still awaits its initial file load', async () => {
    const s = await setup()
    const a = s.file('a.md')
    s.deferLoading()
    s.activateNote(a)
    await s.plugin.activateView('tab')
    expect(s.maps()[0].view.file).toBeNull()
    expect(s.maps()[0].view.getState()).toMatchObject({ file: 'a.md', pinned: true })
    s.activateNote(a)
    await s.plugin.activateView('tab')
    expect(s.maps()).toHaveLength(1)
    expect(s.app.workspace.getLeaf).toHaveBeenCalledTimes(1)
  })

  it('keeps concurrently opened different files bound to their own captured source', async () => {
    const s = await setup()
    const a = s.file('a.md'), b = s.file('b.md')
    s.activateNote(a)
    const release = s.holdNextSetView()
    const first = s.plugin.activateView('tab')
    s.activateNote(b)
    const second = s.plugin.activateView('tab')
    release()
    await Promise.all([first, second])
    expect(s.maps()).toHaveLength(2)
    expect(s.maps().map(leaf => leaf.view.getState().file).sort()).toEqual(['a.md', 'b.md'])
    expect(s.maps().every(leaf => leaf.view.getState().pinned)).toBe(true)
  })

  it('allows retry after creating a map fails', async () => {
    const s = await setup()
    s.activateNote(s.file('a.md'))
    s.app.workspace.getLeaf.mockImplementationOnce(() => ({
      setPinned: vi.fn(),
      setViewState: vi.fn(async () => { throw new Error('view creation failed') }),
    }))
    await expect(s.plugin.activateView('tab')).rejects.toThrow('view creation failed')
    await s.plugin.activateView('tab')
    expect(s.maps()).toHaveLength(1)
    expect(s.maps()[0].view.getState()).toMatchObject({ file: 'a.md', pinned: true })
  })

  it('keeps the pending active map as the target instead of opening the stale note', async () => {
    const s = await setup()
    const a = s.file('a.md'), b = s.file('b.md')
    s.deferLoading()
    s.activateNote(a)
    await s.plugin.activateView('tab')
    const wanted = s.maps()[0]
    expect(wanted.view.file).toBeNull()
    s.activateMap(wanted, b)
    await s.plugin.activateView('tab')
    expect(s.maps()).toHaveLength(1)
    expect(s.app.workspace.revealLeaf).toHaveBeenLastCalledWith(wanted)
    expect(s.app.workspace.getLeaf).toHaveBeenCalledTimes(1)
  })

  it('converts an existing following main-area map for that file into a pinned map', async () => {
    const s = await setup()
    const a = s.file('a.md')
    const following = await s.existingMap(a, false)
    s.activateNote(a)
    await s.plugin.activateView('tab')
    expect(s.maps()).toHaveLength(1)
    expect(s.app.workspace.revealLeaf).toHaveBeenLastCalledWith(following)
    expect(following.view.getState()).toMatchObject({ file: 'a.md', pinned: true })
    expect(s.app.workspace.getLeaf).not.toHaveBeenCalled()
  })

  it('prefers an existing pinned tab when an older following map shows the same file', async () => {
    const s = await setup()
    const a = s.file('a.md')
    const following = await s.existingMap(a, false)
    const pinned = await s.existingMap(a)
    s.activateNote(a)
    await s.plugin.activateView('tab')
    expect(s.app.workspace.revealLeaf).toHaveBeenLastCalledWith(pinned)
    expect(following.view.getState()).toMatchObject({ pinned: false })
    expect(following.setViewState).not.toHaveBeenCalled()
    expect(pinned.setViewState).not.toHaveBeenCalled()
    expect(s.app.workspace.getLeaf).not.toHaveBeenCalled()
  })
})
