import { migrated } from './StyleStore'

/** The point at the viewport's center, in unscaled layout coordinates. */
export interface ViewportState {
  scale: number
  x: number
  y: number
}

export interface ViewPreference {
  locked: boolean
  viewport?: ViewportState
}

export type ViewPreferenceData = Record<string, ViewPreference>

export function normalizeViewport(raw: unknown): ViewportState | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { scale, x, y } = raw as Partial<ViewportState>
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0 ||
      typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 1e7 ||
      typeof y !== 'number' || !Number.isFinite(y) || Math.abs(y) > 1e7) return undefined
  return { scale: Math.min(4, Math.max(0.15, scale)), x, y }
}

export function normalizeViewPreferences(raw: unknown): ViewPreferenceData {
  const data: ViewPreferenceData = Object.create(null) as ViewPreferenceData
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return data
  for (const [path, value] of Object.entries(raw)) {
    if (!path || !value || typeof value !== 'object') continue
    const entry = value as Partial<ViewPreference>
    const viewport = normalizeViewport(entry.viewport)
    if (entry.locked !== true && !viewport) continue
    data[path] = viewport ? { locked: entry.locked === true, viewport } : { locked: true }
  }
  return data
}

/** Per-note view preferences; only manual locks are broadcast to other views. */
export class ViewPreferences {
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly data: ViewPreferenceData, private readonly persist: () => void) {}

  isLocked(path: string): boolean { return this.data[path]?.locked === true }

  viewportFor(path: string): ViewportState | undefined {
    const viewport = this.data[path]?.viewport
    return viewport ? { ...viewport } : undefined
  }

  setLocked(path: string, locked: boolean): void {
    if (this.isLocked(path) === locked) return
    const viewport = this.data[path]?.viewport
    if (viewport) this.data[path] = { locked, viewport }
    else if (locked) this.data[path] = { locked }
    else delete this.data[path]
    this.saveNow()
    this.emit()
  }

  /** Mutate immediately, coalesce disk writes. A closing background view never overwrites this. */
  rememberViewport(path: string, raw: ViewportState): void {
    const viewport = normalizeViewport(raw)
    if (!viewport) return
    const previous = this.data[path]?.viewport
    if (previous && previous.scale === viewport.scale && previous.x === viewport.x && previous.y === viewport.y) return
    this.data[path] = { locked: this.isLocked(path), viewport }
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 250)
  }

  rename(oldPath: string, newPath: string): void {
    if (oldPath === newPath) return
    let changed = false
    for (const path of Object.keys(this.data)) {
      const next = migrated(path, oldPath, newPath)
      const entry = this.data[path]
      if (next === null || !entry) continue
      this.data[next] = entry
      delete this.data[path]
      changed = true
    }
    if (changed) { this.saveNow(); this.emit() }
  }

  remove(path: string): void {
    let changed = false
    for (const key of Object.keys(this.data)) {
      if (key !== path && !key.startsWith(`${path}/`)) continue
      delete this.data[key]
      changed = true
    }
    if (changed) { this.saveNow(); this.emit() }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  flush(): void {
    if (this.timer === null) return
    this.saveNow()
  }

  private saveNow(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.persist()
  }

  private emit(): void { for (const listener of [...this.listeners]) listener() }
}
