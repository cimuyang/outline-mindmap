import type { LayoutResult } from '../layout/types'

export const LAYOUT_MOTION_MS = 140
export const MOTION_NODE_LIMIT = 250
export interface FrameClock {
  now(): number
  request(callback: (time: number) => void): number
  cancel(id: number): void
}

/** Nodes and edges consume the same geometry on each frame. No DOM reads or timers. */
export class LayoutMotion {
  private shown: LayoutResult = new Map()
  private frame: number | null = null
  private generation = 0
  private finishFrame: (() => void) | null = null
  constructor(private readonly clock: FrameClock) {}

  reset(): void {
    this.generation++
    if (this.frame !== null) this.clock.cancel(this.frame)
    this.frame = null
    this.shown = new Map()
    this.finishFrame = null
  }

  finish(): void { this.finishFrame?.() }

  update(target: LayoutResult, animate: boolean, render: (boxes: LayoutResult) => void): void {
    const from = this.shown
    this.reset()
    const changed = [...target].some(([id, b]) => {
      const a = from.get(id)
      return a && (a.x !== b.x || a.y !== b.y)
    })
    if (!animate || target.size > MOTION_NODE_LIMIT || !changed) {
      this.shown = target
      render(target)
      return
    }
    const generation = this.generation
    this.finishFrame = () => {
      this.reset()
      this.shown = target
      render(target)
    }
    const start = this.clock.now()
    const step = (time: number): void => {
      if (generation !== this.generation) return
      this.frame = null
      const progress = Math.min(1, Math.max(0, (time - start) / LAYOUT_MOTION_MS))
      const eased = 1 - Math.pow(1 - progress, 3)
      const boxes: LayoutResult = progress === 1 ? target : new Map()
      if (progress < 1) for (const [id, b] of target) {
        const a = from.get(id) ?? b
        boxes.set(id, {
          x: a.x + (b.x - a.x) * eased, y: a.y + (b.y - a.y) * eased,
          w: b.w, h: b.h,
        })
      }
      this.shown = boxes
      if (progress === 1) this.finishFrame = null
      render(boxes)
      if (progress < 1 && generation === this.generation) this.frame = this.clock.request(step)
    }
    step(start)
  }
}
