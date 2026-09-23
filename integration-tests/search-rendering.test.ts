import { afterEach, describe, expect, it, vi } from 'vitest'
import { MindmapView } from '../src/view/MindmapView'
import { NodeRenderer } from '../src/view/NodeRenderer'
import { Canvas } from '../src/view/Canvas'
import { LayoutMotion } from '../src/view/LayoutMotion'
import { parse } from '../src/core/parser'
import { DEFAULT_LAYOUT } from '../src/layout/types'
import { FakeElement, findByClass, textOf } from './fake-dom'

afterEach(() => vi.unstubAllGlobals())

describe('search viewport and rendered marks', () => {
  it('keeps real node marks through layout animation and same-source refresh', () => {
    vi.stubGlobal('createDiv', (options: { cls?: string }) => {
      const el = new FakeElement()
      if (options?.cls) el.addClass(options.cls)
      return el
    })
    vi.stubGlobal('createFragment', () => new FakeElement('#fragment', true))
    const content = '# Parent\n## **word** here\n# Other'
    const view: any = new MindmapView({ app: {} } as any, { settings: { gracefulAnimation: true, listNodes: false } } as any)
    const layer = new FakeElement()
    let frame: ((time: number) => void) | undefined
    view.motion = new LayoutMotion({ now: () => 0, request: fn => { frame = fn; return 1 }, cancel: () => {} })
    view.ready = true
    view.file = { path: 'note.md' }
    view.tree = parse(content)
    view.empty = new FakeElement()
    view.searchBar = new FakeElement()
    view.canvas = { setAnimated: vi.fn(), fit: vi.fn(() => true), centerOn: vi.fn(() => true) }
    view.nodeRenderer = new NodeRenderer(layer as any)
    view.connectors = { render: vi.fn() }
    view.drag = { active: false }
    let gap = 40
    view.layoutOptions = () => ({ ...DEFAULT_LAYOUT, hGap: gap, measure: () => ({ w: 100, h: 40 }) })
    view.draw()
    const at = content.indexOf('word')
    view.setEphemeralState({ match: { content, matches: [[at, at + 4]] } })
    const assertMarks = () => {
      expect(findByClass(layer, 'om-search-match').map(textOf)).toEqual(['word'])
      expect(findByClass(layer, 'is-search-match')).toHaveLength(1)
    }
    assertMarks()
    gap = 100
    view.draw()
    frame?.(70)
    assertMarks()
    view.refresh(content)
    frame?.(140)
    assertMarks()
    expect(view.canvas.centerOn).toHaveBeenCalledTimes(1)
    view.clearSearch()
    view.draw()
    expect(findByClass(layer, 'om-search-match')).toHaveLength(0)
  })

  it('defers centering at zero size and zooms a tiny map to readable search scale only when requested', () => {
    let resize: (entries: unknown[]) => void = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: typeof resize) { resize = callback }
      observe() {}
      disconnect() {}
    })
    const canvas = new Canvas(new FakeElement() as any)
    const box = { x: 900, y: 500, w: 100, h: 40 }
    expect(canvas.centerOn(box, true, 0.85)).toBe(false)
    resize([{ contentRect: { width: 800, height: 600 } }])
    canvas.fit({ x: 0, y: 0, w: 5000, h: 5000 })
    expect(canvas.centerOn(box)).toBe(true)
    expect((canvas.content as any).styles.transform).toContain('scale(0.15)')
    expect(canvas.centerOn(box, true, 0.85)).toBe(true)
    expect((canvas.content as any).styles.transform).toBe('translate(-407.5px, -142px) scale(0.85)')
  })
})
