import { afterEach, describe, expect, it, vi } from 'vitest'
import { Canvas } from '../src/view/Canvas'
import { DragController } from '../src/view/DragController'
import { parse } from '../src/core/parser'
import { FakeElement } from './fake-dom'

afterEach(() => vi.unstubAllGlobals())

function setup(hooks: any = {}) {
  let resize!: (entries: any[]) => void
  const frames: Array<() => void> = []
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: any) { resize = callback }
    observe() {} disconnect = disconnect
  })
  vi.stubGlobal('window', { requestAnimationFrame: (callback: () => void) => {
    frames.push(callback); return frames.length
  }, cancelAnimationFrame: vi.fn() })
  const host = new FakeElement()
  const canvas = new Canvas(host as any, undefined, hooks)
  const viewport = canvas.viewport as unknown as FakeElement
  const size = (width: number, height: number) => resize([{ contentRect: { width, height } }])
  size(800, 600)
  canvas.restore({ scale: 1, x: 400, y: 300 }, [{ x: 0, y: 0, w: 1000, h: 1000 }])
  const node = (canvas.content as any as FakeElement).createDiv({ cls: 'om-node' })
  const send = (type: string, id: number, x: number, y: number, target = viewport, pointerType = 'touch') =>
    target.dispatch(type, { pointerId: id, pointerType, button: 0, clientX: x, clientY: y })
  return { canvas, viewport, node, size, send, frames, disconnect }
}

describe('viewport restoration', () => {
  it('waits for a measurable viewport, restores once and preserves center across resize/hide', () => {
    const s = setup()
    s.size(0, 0)
    const state = { scale: 2, x: 250, y: 300 }
    const boxes = [{ x: 200, y: 250, w: 100, h: 100 }]
    expect(s.canvas.restore(state, boxes)).toBe(false)
    s.size(600, 400)
    expect(s.canvas.restore(state, boxes)).toBe(true)
    expect(s.canvas.snapshot()).toEqual(state)
    expect((s.canvas.content as any).styles.transform).toBe('translate(-200px, -400px) scale(2)')
    s.size(300, 800)
    expect(s.canvas.snapshot()).toEqual(state)
    s.size(0, 0); s.size(400, 700)
    expect(s.canvas.snapshot()).toEqual(state)
  })

  it('retains scale and chooses a nearby node when the saved region is now empty', () => {
    const s = setup()
    s.canvas.restore({ scale: 1.7, x: -10000, y: 10000 }, [
      { x: 0, y: 0, w: 100, h: 40 }, { x: 0, y: 800, w: 100, h: 40 },
    ])
    expect(s.canvas.snapshot()).toEqual({ scale: 1.7, x: 50, y: 820 })
  })

  it('programmatic fit and search positioning do not persist a user preference', () => {
    const changed = vi.fn(), s = setup({ onUserChange: changed })
    s.canvas.fit({ x: 0, y: 0, w: 5000, h: 5000 })
    s.canvas.centerOn({ x: 400, y: 400, w: 100, h: 50 }, false, 0.85)
    s.canvas.ensureVisible({ x: 2000, y: 2000, w: 100, h: 50 })
    expect(changed).not.toHaveBeenCalled()
    s.canvas.zoomBy(1.25)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(s.canvas.snapshot()?.scale).toBeCloseTo(1.0625)
  })
})

describe('touch and mouse interaction', () => {
  it('pinches around the two-finger midpoint, then continues smoothly with one finger', () => {
    const changed = vi.fn(), started = vi.fn(), s = setup({ onUserChange: changed, onGestureStart: started })
    s.send('pointerdown', 1, 100, 100)
    s.send('pointerdown', 2, 200, 100)
    s.send('pointermove', 2, 300, 100)
    expect(s.canvas.snapshot()?.scale).toBeCloseTo(2)
    expect(s.canvas.toContent(s.canvas.viewportRect(), 200, 100)).toEqual({ x: 150, y: 100 })
    expect(started).toHaveBeenCalledTimes(1)
    s.send('pointerup', 2, 300, 100)
    const before = s.canvas.snapshot()!
    s.send('pointermove', 1, 120, 130)
    const after = s.canvas.snapshot()!
    expect(after.scale).toBe(2)
    expect(after.x).toBeCloseTo(before.x - 10)
    expect(after.y).toBeCloseTo(before.y - 15)
    s.send('pointerup', 1, 120, 130)
    expect(s.viewport.captures.size).toBe(0)
    const click = s.viewport.dispatch('click')
    expect(click.defaultPrevented).toBe(true)
    expect(changed).toHaveBeenCalled()
  })

  it('allows a locked node tap, ignores touch jitter and pans when movement is deliberate', () => {
    const s = setup({ panNodes: () => true })
    const clicked = vi.fn()
    s.node.addEventListener('click', clicked)
    s.send('pointerdown', 1, 100, 100, s.node)
    s.send('pointermove', 1, 101, 100, s.node)
    expect(s.viewport.captureCalls).toEqual([])
    expect(s.canvas.snapshot()).toEqual({ scale: 1, x: 400, y: 300 })
    s.send('pointerup', 1, 101, 100, s.node)
    s.node.dispatch('click')
    expect(clicked).toHaveBeenCalledTimes(1)
    s.send('pointerdown', 2, 100, 100, s.node)
    s.send('pointermove', 2, 120, 130, s.node)
    expect(s.canvas.snapshot()).toEqual({ scale: 1, x: 380, y: 270 })
    s.send('pointerup', 2, 120, 130, s.node)
    s.node.dispatch('click')
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('can begin a pinch on nodes without single-finger canvas pan in edit mode', () => {
    const started = vi.fn(), s = setup({ onGestureStart: started })
    s.send('pointerdown', 1, 100, 100, s.node)
    s.send('pointermove', 1, 120, 100, s.node)
    expect(s.canvas.snapshot()?.scale).toBe(1)
    expect(s.canvas.snapshot()?.x).toBe(400)
    s.send('pointerdown', 2, 220, 100, s.node)
    s.send('pointermove', 2, 320, 100, s.node)
    expect(s.canvas.snapshot()?.scale).toBe(2)
    expect(started).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('a second finger cancels a node drag, including a pending candidate (%s)', active => {
    let drag!: DragController
    const s = setup({ onGestureStart: () => drag.cancel() })
    const tree = parse('# A\n# B')
    const nodes = tree.root.children
    s.node.dataset['nodeId'] = nodes[0]!.id
    const layer = s.node.parent!
    const drop = vi.fn()
    drag = new DragController(layer as any, {
      canvas: s.canvas, tree: () => tree, order: () => nodes.map(n => n.id),
      boxes: () => new Map(nodes.map((node, i) => [node.id, { x: 100, y: 100 + i * 100, w: 100, h: 50 }])),
      enabled: () => true, onDrop: drop, onVisual: vi.fn(),
    })
    s.send('pointerdown', 1, 100, 100, s.node)
    if (active) { s.send('pointermove', 1, 120, 100, s.node); expect(drag.active).toBe(true) }
    s.send('pointerdown', 2, 220, 100, s.node)
    expect(drag.active).toBe(false)
    expect((drag as any).pointerId).toBeNull()
    s.send('pointermove', 2, 320, 100, s.node)
    s.send('pointerup', 2, 320, 100, s.node)
    s.send('pointerup', 1, 120, 100, s.node)
    expect(drop).not.toHaveBeenCalled()
    drag.destroy(); s.canvas.destroy()
  })

  it('cleans up a canceled gesture and does not swallow the next deliberate tap', () => {
    const s = setup({ panNodes: () => true })
    s.send('pointerdown', 1, 100, 100); s.send('pointerdown', 2, 200, 100)
    s.send('pointercancel', 2, 200, 100)
    expect(s.viewport.captures.size).toBe(0)
    const state = s.canvas.snapshot()
    s.send('pointermove', 1, 500, 500)
    expect(s.canvas.snapshot()).toEqual(state)
    s.send('pointerdown', 3, 100, 100, s.node); s.send('pointerup', 3, 100, 100, s.node)
    expect(s.node.dispatch('click').defaultPrevented).toBe(false)
  })

  it('ignores unrelated mouse pointer IDs and leaves inline text selection alone', () => {
    const s = setup()
    s.send('pointerdown', 1, 100, 100, s.viewport, 'mouse')
    s.send('pointermove', 2, 300, 300, s.viewport, 'mouse')
    s.send('pointerup', 2, 300, 300, s.viewport, 'mouse')
    expect(s.canvas.snapshot()?.x).toBe(400)
    s.send('pointermove', 1, 120, 130, s.viewport, 'mouse')
    expect(s.canvas.snapshot()).toEqual({ scale: 1, x: 380, y: 270 })
    s.send('pointerup', 1, 120, 130, s.viewport, 'mouse')
    const editor = (s.canvas.content as any as FakeElement).createDiv({ cls: 'om-editor' })
    s.send('pointerdown', 3, 100, 100, editor)
    expect(s.viewport.hasPointerCapture(3)).toBe(false)
    expect((s.canvas as any).touches.size).toBe(0)
  })

  it('clamps pinch scale and clears listeners, capture and frames on teardown', () => {
    const s = setup()
    s.send('pointerdown', 1, 100, 100); s.send('pointerdown', 2, 101, 100)
    s.send('pointermove', 2, 10000, 100)
    expect(s.canvas.snapshot()?.scale).toBe(4)
    s.canvas.zoomAt(NaN, 0, 0); s.canvas.panBy(Infinity, 0)
    expect(Number.isFinite(s.canvas.snapshot()!.x)).toBe(true)
    s.canvas.destroy()
    expect(s.disconnect).toHaveBeenCalled()
    expect(s.viewport.captures.size).toBe(0)
    expect([...s.viewport.listeners.values()].flat()).toEqual([])
  })
})
