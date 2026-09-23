import { describe, expect, it, vi } from 'vitest'
import { MindmapView } from '../src/view/MindmapView'
import { LayoutMotion } from '../src/view/LayoutMotion'
import { parse } from '../src/core/parser'
import { DEFAULT_LAYOUT } from '../src/layout/types'
import { FakeElement } from './fake-dom'

function setup() {
  const view: any = new MindmapView({ app: {} } as any, { settings: { gracefulAnimation: true } } as any)
  let callback: ((time: number) => void) | undefined
  const clock = { now: () => 0, request: vi.fn(fn => { callback = fn; return 1 }), cancel: vi.fn() }
  view.motion = new LayoutMotion(clock)
  view.tree = parse('# Parent\n## Child')
  view.empty = new FakeElement()
  view.canvas = { setAnimated: vi.fn(), fit: vi.fn() }
  view.nodeRenderer = { render: vi.fn() }
  view.connectors = { render: vi.fn() }
  view.drag = { active: false }
  view.needsFit = false
  view.reducedMotion = { matches: false }
  let gap = 40
  view.layoutOptions = () => ({ ...DEFAULT_LAYOUT, hGap: gap, measure: () => ({ w: 100, h: 40 }) })
  return { view, clock, move: () => { gap = 100; view.draw() }, tick: () => callback?.(70) }
}

describe('view motion integration', () => {
  it('passes identical interpolated geometry to nodes and edges on each frame', () => {
    const s = setup()
    s.view.draw(); s.move(); s.tick()
    const nodeFrames = s.view.nodeRenderer.render.mock.calls
    const edgeFrames = s.view.connectors.render.mock.calls
    expect(nodeFrames).toHaveLength(3)
    for (let i = 0; i < nodeFrames.length; i++) expect(nodeFrames[i][1]).toBe(edgeFrames[i][1])
    expect(s.clock.request).toHaveBeenCalled()
  })
  it('honors reduced motion and turns off both layout and camera animation immediately', () => {
    const s = setup()
    s.view.draw(); s.move()
    s.view.reducedMotion.matches = true
    s.view.draw()
    expect(s.clock.cancel).toHaveBeenCalled()
    expect(s.view.canvas.setAnimated).toHaveBeenLastCalledWith(false)
    expect(s.view.nodeRenderer.render.mock.lastCall[1]).toBe(s.view.boxes)
  })
  it('avoids layout animation while the inline editor is active', () => {
    const s = setup()
    s.view.draw()
    s.view.session = {}
    s.move()
    expect(s.clock.request).not.toHaveBeenCalled()
  })
})
