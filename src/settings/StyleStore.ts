/**
 * 样式配置：全局一份 + 单篇笔记各一份（M8）。
 *
 * 【全部存在插件自己的 data.json 里，一个字节都不写进笔记】（红线 1）。
 *
 * 本文件是纯逻辑，【不 import obsidian】——单篇样式最容易出事的两处
 * （改文件名后 key 失配、删笔记后配置越攒越多，陷阱 7）因此可以直接单测。
 */

import { DEFAULT_LAYOUT, type BranchStyle } from '../layout/types'

export type NodeShape = 'rounded' | 'pill' | 'underline'
export type ColorScheme = 'theme' | 'blue' | 'green' | 'warm'

export interface MindmapStyle {
  /** 主题间距 · 横向：父节点右边缘到子节点左边缘。 */
  hGap: number
  /** 主题间距 · 纵向：相邻兄弟子树之间。 */
  vGap: number
  shape: NodeShape
  branch: BranchStyle
  scheme: ColorScheme
  /** 字号缩放。1 = 跟随主题字号。 */
  fontScale: number
}

/** 各项的取值范围。滑块与「从 data.json 读进来的脏数据」共用同一份，免得两边对不上。 */
export const STYLE_LIMITS = {
  hGap: { min: 16, max: 200, step: 4 },
  vGap: { min: 2, max: 80, step: 2 },
  fontScale: { min: 0.6, max: 2, step: 0.05 },
} as const

const SHAPES: readonly NodeShape[] = ['rounded', 'pill', 'underline']
const SCHEMES: readonly ColorScheme[] = ['theme', 'blue', 'green', 'warm']
const BRANCHES: readonly BranchStyle[] = ['straight', 'curve', 'elbow']

export const DEFAULT_STYLE: MindmapStyle = {
  // 间距的默认值直接取布局层的，两处不会各写一个数字然后慢慢漂移
  hGap: DEFAULT_LAYOUT.hGap,
  vGap: DEFAULT_LAYOUT.vGap,
  shape: 'rounded',
  branch: 'curve',
  scheme: 'theme',
  fontScale: 1,
}

export interface StyleData {
  global: MindmapStyle
  /** key 是文件路径。改名要迁移、删除要清理（陷阱 7）。 */
  perFile: Record<string, MindmapStyle>
}

export function defaultStyleData(): StyleData {
  return { global: { ...DEFAULT_STYLE }, perFile: {} }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function num(raw: unknown, fallback: number, range: { min: number; max: number }): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? clamp(raw, range.min, range.max) : fallback
}

function pick<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

/**
 * 把 data.json 里读到的东西整理成一个合法的样式。
 *
 * 用户手改过配置文件、或者插件降级回旧版本，都可能读到缺字段 / 超范围的值；
 * 这些值会直接喂给布局算法，不收拢就会画出一团乱麻。
 */
export function normalizeStyle(raw: unknown, base: MindmapStyle = DEFAULT_STYLE): MindmapStyle {
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    hGap: num(o['hGap'], base.hGap, STYLE_LIMITS.hGap),
    vGap: num(o['vGap'], base.vGap, STYLE_LIMITS.vGap),
    shape: pick(o['shape'], SHAPES, base.shape),
    branch: pick(o['branch'], BRANCHES, base.branch),
    scheme: pick(o['scheme'], SCHEMES, base.scheme),
    fontScale: num(o['fontScale'], base.fontScale, STYLE_LIMITS.fontScale),
  }
}

export function normalizeStyleData(raw: unknown): StyleData {
  const o = (raw ?? {}) as Record<string, unknown>
  const global = normalizeStyle(o['global'])
  const perFile: Record<string, MindmapStyle> = {}
  const src = o['perFile']
  if (src && typeof src === 'object') {
    for (const [path, value] of Object.entries(src as Record<string, unknown>)) {
      // 单篇样式以【全局】为基准补齐缺项：用户没在单篇里动过的项，就该跟着全局走
      if (path) perFile[path] = normalizeStyle(value, global)
    }
  }
  return { global, perFile }
}

export function sameStyle(a: MindmapStyle, b: MindmapStyle): boolean {
  return (
    a.hGap === b.hGap &&
    a.vGap === b.vGap &&
    a.shape === b.shape &&
    a.branch === b.branch &&
    a.scheme === b.scheme &&
    a.fontScale === b.fontScale
  )
}

/**
 * 两级样式的读写与订阅。
 *
 * 「预览」是第三级，只活在内存里：样式窗口一边拖滑块一边看效果，
 * 但在按下「应用」之前，data.json 里什么都不该变。
 */
export class StyleStore {
  private previewing: { path: string | null; style: MindmapStyle } | null = null
  private readonly listeners = new Set<() => void>()

  /**
   * @param data 直接持有插件设置里的那个对象并就地修改，`persist` 负责把它写回 data.json
   * @param persist 落盘。预览不会调用它
   */
  constructor(
    private readonly data: StyleData,
    private readonly persist: () => void,
  ) {}

  /** 某篇笔记当前生效的样式：预览 > 单篇 > 全局。 */
  styleFor(path: string | null): MindmapStyle {
    if (this.previewing && this.previewing.path === path) return this.previewing.style
    if (path !== null) {
      const own = this.data.perFile[path]
      if (own) return own
    }
    return this.data.global
  }

  global(): MindmapStyle {
    return this.data.global
  }

  /** 这篇笔记是否有自己的单篇样式（预览不算）。 */
  hasOverride(path: string | null): boolean {
    return path !== null && this.data.perFile[path] !== undefined
  }

  /** 实时预览：只改内存、通知视图重绘，不落盘。 */
  setPreview(path: string | null, style: MindmapStyle): void {
    this.previewing = { path, style }
    this.emit()
  }

  /**
   * 预览当前挂在哪个路径上；没有预览时返回 undefined。
   *
   * 样式窗口用它来定「应用到哪一篇」：窗口开着的时候笔记被改了名，
   * 这里已经是新路径，照着窗口打开时记下的旧路径写会写进一个不存在的文件名。
   */
  previewPath(): string | null | undefined {
    return this.previewing?.path
  }

  /** 取消预览，回到已保存的状态。 */
  clearPreview(): void {
    if (!this.previewing) return
    this.previewing = null
    this.emit()
  }

  /**
   * 应用为全局样式。
   *
   * 同时【清掉本篇的单篇样式】：否则用户在某篇笔记里点了「应用全局设置」，
   * 眼前这篇却因为自带覆盖而纹丝不动，看上去就像按钮坏了。
   */
  applyGlobal(path: string | null, style: MindmapStyle): void {
    this.data.global = { ...style }
    if (path !== null) delete this.data.perFile[path]
    this.previewing = null
    this.persist()
    this.emit()
  }

  /**
   * 应用为单篇样式。与全局完全一致时【不写这一项】——
   * 每开一次窗口就留一条冗余记录，data.json 会白白胀起来（M8 验收第三条）。
   */
  applyFile(path: string, style: MindmapStyle): void {
    if (sameStyle(style, this.data.global)) delete this.data.perFile[path]
    else this.data.perFile[path] = { ...style }
    this.previewing = null
    this.persist()
    this.emit()
  }

  /** 删掉单篇样式，回到跟随全局。 */
  clearFile(path: string): boolean {
    if (this.data.perFile[path] === undefined) return false
    delete this.data.perFile[path]
    this.persist()
    this.emit()
    return true
  }

  /**
   * 笔记改名 / 移动 → 迁移 key（陷阱 7）。
   *
   * 文件夹改名也走这里：Obsidian 只对被改名的那一项发事件，
   * 因此凡是以 `oldPath/` 开头的 key 都要跟着换前缀。
   */
  rename(oldPath: string, newPath: string): boolean {
    if (oldPath === newPath) return false
    let changed = false
    for (const key of Object.keys(this.data.perFile)) {
      const next = migrated(key, oldPath, newPath)
      if (next === null) continue
      const style = this.data.perFile[key]
      if (style) this.data.perFile[next] = style
      delete this.data.perFile[key]
      changed = true
    }
    // 样式窗口开着的时候被改名，预览也得跟过去，否则松手前后看到的是两份样式
    const preview = this.previewing
    if (preview && preview.path !== null) {
      const next = migrated(preview.path, oldPath, newPath)
      if (next !== null) this.previewing = { path: next, style: preview.style }
    }
    if (changed) {
      this.persist()
      this.emit()
    }
    return changed
  }

  /** 笔记 / 文件夹被删 → 清掉对应配置，别让 data.json 无限膨胀。 */
  remove(path: string): boolean {
    let changed = false
    for (const key of Object.keys(this.data.perFile)) {
      if (key !== path && !key.startsWith(`${path}/`)) continue
      delete this.data.perFile[key]
      changed = true
    }
    if (changed) {
      this.persist()
      this.emit()
    }
    return changed
  }

  /** 落盘用的原始对象（就是构造时传进来的那个）。 */
  toData(): StyleData {
    return this.data
  }

  /** @returns 退订函数。视图关闭时必须调用，否则关掉的视图还会被叫醒。 */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn()
  }
}

/** key 在这次改名中的新名字；不受影响时返回 null。 */
function migrated(key: string, oldPath: string, newPath: string): string | null {
  if (key === oldPath) return newPath
  if (key.startsWith(`${oldPath}/`)) return newPath + key.slice(oldPath.length)
  return null
}
