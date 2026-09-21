/**
 * 「以导图打开」的记忆（v1.3.2）。
 *
 * 重点是改名迁移与删除清理（陷阱 7）：这两处出错不会当场报错，
 * 只会在几天后表现为「记忆莫名其妙丢了」或「data.json 越来越大」。
 */

import { describe, expect, it } from 'vitest'
import { OpenAsStore, normalizeOpenAsData } from '../settings/OpenAsStore'

function makeStore(): { store: OpenAsStore; saves: () => number } {
  let saves = 0
  const store = new OpenAsStore({}, () => {
    saves++
  })
  return { store, saves: () => saves }
}

describe('normalizeOpenAsData（脏配置收拢）', () => {
  it('不是对象 → 空', () => {
    expect(normalizeOpenAsData(null)).toEqual({})
    expect(normalizeOpenAsData('x')).toEqual({})
    expect(normalizeOpenAsData([])).toEqual({})
  })

  it('值不成形时保住 key，模式退回编辑模式', () => {
    expect(normalizeOpenAsData({ 'a.md': true, 'b.md': { noteMode: 'preview' }, 'c.md': { noteMode: 7 } }))
      .toEqual({
        'a.md': { noteMode: 'source' },
        'b.md': { noteMode: 'preview' },
        'c.md': { noteMode: 'source' },
      })
  })
})

describe('记住与忘掉', () => {
  it('记下之后 isMindmap 为真，且还原模式正确', () => {
    const { store, saves } = makeStore()
    store.remember('a.md', 'preview')
    expect(store.isMindmap('a.md')).toBe(true)
    expect(store.noteModeOf('a.md')).toBe('preview')
    expect(store.noteModeOf('b.md')).toBe('source') // 没记过的默认编辑模式
    expect(saves()).toBe(1)
  })

  it('同样的记录重复写不落盘', () => {
    const { store, saves } = makeStore()
    store.remember('a.md', 'source')
    store.remember('a.md', 'source')
    expect(saves()).toBe(1)
    store.remember('a.md', 'preview') // 模式变了才算改动
    expect(saves()).toBe(2)
  })

  it('forget 只在真有记录时落盘', () => {
    const { store, saves } = makeStore()
    expect(store.forget('a.md')).toBe(false)
    expect(saves()).toBe(0)
    store.remember('a.md', 'source')
    expect(store.forget('a.md')).toBe(true)
    expect(store.isMindmap('a.md')).toBe(false)
    expect(saves()).toBe(2)
  })
})

describe('改名与删除（陷阱 7）', () => {
  it('笔记改名 → 记录跟着走', () => {
    const { store } = makeStore()
    store.remember('a.md', 'preview')
    expect(store.rename('a.md', 'b.md')).toBe(true)
    expect(store.isMindmap('a.md')).toBe(false)
    expect(store.isMindmap('b.md')).toBe(true)
    expect(store.noteModeOf('b.md')).toBe('preview')
  })

  it('文件夹改名 → 底下每一篇的 key 都换前缀，同名前缀的别的文件夹不受影响', () => {
    const { store } = makeStore()
    store.remember('proj/a.md', 'source')
    store.remember('proj/sub/b.md', 'source')
    store.remember('proj2/c.md', 'source')
    expect(store.rename('proj', 'work')).toBe(true)
    expect(Object.keys(store.toData()).sort()).toEqual(['proj2/c.md', 'work/a.md', 'work/sub/b.md'])
  })

  it('改名不涉及任何记录时不写盘', () => {
    const { store, saves } = makeStore()
    store.remember('a.md', 'source')
    expect(store.rename('x.md', 'y.md')).toBe(false)
    expect(store.rename('a.md', 'a.md')).toBe(false)
    expect(saves()).toBe(1)
  })

  it('删笔记 / 删文件夹 → 记录清掉', () => {
    const { store } = makeStore()
    store.remember('a.md', 'source')
    store.remember('dir/b.md', 'source')
    store.remember('dir2/c.md', 'source')
    expect(store.remove('a.md')).toBe(true)
    expect(store.remove('dir')).toBe(true)
    expect(store.remove('nothing')).toBe(false)
    expect(Object.keys(store.toData())).toEqual(['dir2/c.md'])
  })
})
