import { describe, expect, it } from 'vitest'
import { LayoutMotion, LAYOUT_MOTION_MS, MOTION_NODE_LIMIT } from '../view/LayoutMotion'
import type { LayoutResult } from '../layout/types'

function setup() {
  let now = 0, id = 0
  const callbacks = new Map<number, (time: number) => void>()
  const motion = new LayoutMotion({ now: () => now,
    request: fn => { callbacks.set(++id, fn); return id }, cancel: key => { callbacks.delete(key) } })
  let shown: LayoutResult = new Map()
  const render = (boxes: LayoutResult): void => { shown = boxes }
  const tick = (time: number): void => {
    now = time
    const pending = [...callbacks.values()]; callbacks.clear()
    for (const fn of pending) fn(time)
  }
  return { motion, render, tick, callbacks, shown: () => shown }
}
const box = (x: number, id = 'a'): LayoutResult => new Map([[id, { x, y: 0, w: 100, h: 40 }]])

describe('shared layout animation', () => {
  it('renders first load immediately, then interpolates and ends at exact target geometry', () => {
    const s = setup()
    s.motion.update(box(0), true, s.render)
    expect(s.callbacks.size).toBe(0)
    const target = box(100)
    s.motion.update(target, true, s.render)
    s.tick(LAYOUT_MOTION_MS / 2)
    expect(s.shown().get('a')!.x).toBe(87.5)
    s.tick(LAYOUT_MOTION_MS)
    expect(s.shown()).toBe(target)
    expect(s.callbacks.size).toBe(0)
  })
  it('interruption continues from the displayed position, with only one pending frame', () => {
    const s = setup()
    s.motion.update(box(0), false, s.render)
    s.motion.update(box(100), true, s.render)
    s.tick(70)
    s.motion.update(box(200), true, s.render)
    expect(s.shown().get('a')!.x).toBe(87.5)
    expect(s.callbacks.size).toBe(1)
    s.tick(210)
    expect(s.shown().get('a')!.x).toBe(200)
  })
  it('reset cancels old frames and new files never animate from another file', () => {
    const s = setup()
    s.motion.update(box(0), false, s.render)
    s.motion.update(box(100), true, s.render)
    const stale = [...s.callbacks.values()][0]!
    s.motion.reset()
    const target = box(300)
    s.motion.update(target, true, s.render)
    stale(140)
    expect(s.shown()).toBe(target)
    expect(s.callbacks.size).toBe(0)
  })
  it('finish snaps nodes and connectors together before user interaction', () => {
    const s = setup()
    s.motion.update(box(0), false, s.render)
    const target = box(100)
    s.motion.update(target, true, s.render)
    s.motion.finish()
    expect(s.shown()).toBe(target)
    expect(s.callbacks.size).toBe(0)
    s.motion.finish()
    expect(s.shown()).toBe(target)
  })
  it('disabled motion and large layouts cancel a running animation', () => {
    const s = setup()
    s.motion.update(box(0), false, s.render)
    s.motion.update(box(100), true, s.render)
    const target = box(200)
    s.motion.update(target, false, s.render)
    expect(s.shown()).toBe(target)
    expect(s.callbacks.size).toBe(0)
    const large = new Map(target)
    for (let i = 0; i < MOTION_NODE_LIMIT; i++) large.set(String(i), { x: i, y: 0, w: 10, h: 10 })
    large.set('a', { x: 400, y: 0, w: 100, h: 40 })
    s.motion.update(large, true, s.render)
    expect(s.shown()).toBe(large)
    expect(s.callbacks.size).toBe(0)
  })
  it('new nodes appear at their destination; removed nodes cannot linger', () => {
    const s = setup()
    s.motion.update(new Map([...box(0), ...box(50, 'removed')]), false, s.render)
    s.motion.update(new Map([...box(100), ...box(300, 'new')]), true, s.render)
    expect(s.shown().get('new')!.x).toBe(300)
    expect(s.shown().has('removed')).toBe(false)
  })
})
