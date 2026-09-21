/**
 * 「这篇笔记该以导图打开」的记忆（v1.3.2）。
 *
 * 【全部存在插件自己的 data.json 里，一个字节都不写进笔记】（红线 1）。
 *
 * 只记「要以导图打开的那些」：默认形态本来就是笔记，「打开为笔记」= 删掉这条记录。
 * 两态比三态少一半分支，也不会出现「记成笔记」和「没记」语义重叠。
 * 值里顺手存下转换那一刻笔记的阅读 / 编辑模式，变回笔记时还原，
 * 否则阅读模式的用户每次「打开为笔记」都会被切到编辑模式。
 *
 * 本文件是纯逻辑，【不 import obsidian】——改名迁移与删除清理（陷阱 7）可以直接单测。
 */

import { migrated } from './StyleStore'

export type NoteMode = 'source' | 'preview'

/** 键是文件路径。存在 = 以导图打开；值是变回笔记时要还原的模式。 */
export type OpenAsData = Record<string, { noteMode: NoteMode }>

/** data.json 里读到的东西 → 一份合法记录。键不是字符串、值不成形的一律丢掉。 */
export function normalizeOpenAsData(raw: unknown): OpenAsData {
  const out: OpenAsData = {}
  if (typeof raw !== 'object' || raw === null) return out
  for (const [path, entry] of Object.entries(raw as Record<string, unknown>)) {
    const mode = (entry as { noteMode?: unknown } | null)?.noteMode
    out[path] = { noteMode: mode === 'preview' ? 'preview' : 'source' }
  }
  return out
}

export class OpenAsStore {
  /**
   * @param data 就地读写的那份对象（settings.openAs）
   * @param persist 有改动时调用，落盘交给外面（复用 saveSettings）
   */
  constructor(
    private readonly data: OpenAsData,
    private readonly persist: () => void,
  ) {}

  /** 这篇要以导图打开吗？ */
  isMindmap(path: string): boolean {
    return path in this.data
  }

  /** 变回笔记时该用哪种模式。没记录过就是编辑模式。 */
  noteModeOf(path: string): NoteMode {
    return this.data[path]?.noteMode ?? 'source'
  }

  /** 「打开为导图」：记下来。 */
  remember(path: string, noteMode: NoteMode): void {
    const prev = this.data[path]
    if (prev && prev.noteMode === noteMode) return
    this.data[path] = { noteMode }
    this.persist()
  }

  /** 「打开为笔记」：忘掉。 */
  forget(path: string): boolean {
    if (!(path in this.data)) return false
    delete this.data[path]
    this.persist()
    return true
  }

  /** 笔记 / 文件夹改名 → 迁移 key。规则与 StyleStore 完全相同（陷阱 7）。 */
  rename(oldPath: string, newPath: string): boolean {
    if (oldPath === newPath) return false
    let changed = false
    for (const key of Object.keys(this.data)) {
      const next = migrated(key, oldPath, newPath)
      if (next === null) continue
      const entry = this.data[key]
      if (entry) this.data[next] = entry
      delete this.data[key]
      changed = true
    }
    if (changed) this.persist()
    return changed
  }

  /** 笔记 / 文件夹被删 → 清掉记录，别让 data.json 无限膨胀。 */
  remove(path: string): boolean {
    let changed = false
    for (const key of Object.keys(this.data)) {
      if (key !== path && !key.startsWith(`${path}/`)) continue
      delete this.data[key]
      changed = true
    }
    if (changed) this.persist()
    return changed
  }

  /** 落盘用的原始对象（就是构造时传进来的那个）。 */
  toData(): OpenAsData {
    return this.data
  }
}
