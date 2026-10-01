import { afterEach, describe, expect, it, vi } from 'vitest'
import { MindmapView } from '../src/view/MindmapView'
import { StyleStore } from '../src/settings/StyleStore'
import { normalizeSettings } from '../src/settings/SettingsTab'
import { ViewPreferences } from '../src/settings/ViewPreferences'
import { FileHistory } from '../src/doc/FileHistory'
import { FakeElement, findByClass } from './fake-dom'
import { MarkdownView, TFile } from './obsidian-runtime'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('assembled map view lifecycle', () => {
  it('opens, loads locked/live content, restores preferences and tears down every subscription', async () => {
    vi.useFakeTimers()
    let resize!: (entries: any[]) => void
    vi.stubGlobal('ResizeObserver', class {
      constructor(fn: any) { resize = fn }
      observe() {} disconnect() {}
    })
    const win = { performance, requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn(),
      matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) }
    vi.stubGlobal('window', win)
    const settings = normalizeSettings(null), save = vi.fn()
    const preferences = new ViewPreferences(settings.views, save)
    preferences.setLocked('a.md', true)
    preferences.rememberViewport('a.md', { scale: 1.5, x: 200, y: 100 })
    const file = new TFile('a.md')
    let source = '# A\n## Child', mode = 'source'
    const events = new Map<string, (...args: any[]) => void>()
    const markdown = new MarkdownView()
    markdown.file = file; markdown.editor = { getValue: () => source }; markdown.getMode = () => mode
    const leaf = { view: markdown, getViewState: () => ({ state: { file: file.path } }) }
    const app: any = { workspace: { getActiveFile: () => file,
      getLeavesOfType: () => [leaf], on: (name: string, callback: any) => events.set(name, callback) },
      vault: { on: vi.fn(), cachedRead: async () => source } }
    const view: any = new MindmapView({ app } as any, { settings, preferences,
      styles: new StyleStore(settings.styles, save), fileHistory: new FileHistory() } as any)
    view.contentEl.ownerDocument = { defaultView: win }
    // Rendering geometry has separate coverage; keep this test on assembly and lifecycle.
    view.draw = vi.fn(() => {
      if (view.tree) view.boxes = new Map([[view.tree.root.children[0].id, { x: 150, y: 50, w: 100, h: 100 }]])
    })
    await view.onOpen()
    expect(view.tree.root.children[0].text).toBe('A')
    expect(view.canEdit()).toBe(false)
    expect(findByClass(view.contentEl, 'om-tool').map(button => button.dataset['action'])).toContain('lock')
    resize([{ contentRect: { width: 800, height: 600 } }])
    expect(view.canvas.snapshot()).toEqual({ scale: 1.5, x: 200, y: 100 })
    source = '# Changed\n## Child'; await view.bridge.emit()
    expect(view.tree.root.children[0].text).toBe('Changed')
    preferences.setLocked(file.path, false)
    expect(view.canEdit()).toBe(true)
    mode = 'preview'; events.get('layout-change')!()
    expect(view.canEdit()).toBe(false)
    mode = 'source'; events.get('layout-change')!()
    expect(view.canEdit()).toBe(true)
    view.canvas.panBy(30, 15)
    const last = preferences.viewportFor(file.path)
    expect(last).toEqual({ scale: 1.5, x: 180, y: 90 })
    await view.onClose(); view.unload()
    expect(view.contentEl.children).toEqual([])
    expect(view.ready).toBe(false)
    expect((preferences as any).listeners.size).toBe(0)
    expect(preferences.viewportFor(file.path)).toEqual(last)
    vi.runAllTimers()
  })
})
