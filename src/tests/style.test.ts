/**
 * 样式两级存储（M8）。
 *
 * 重点覆盖「改文件名 / 删笔记之后配置怎么办」（陷阱 7）与「预览不落盘」，
 * 这两处出错都不会当场报错，只会在几天后表现为「样式莫名其妙丢了」或「data.json 越来越大」。
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STYLE,
  StyleStore,
  defaultStyleData,
  normalizeStyle,
  normalizeStyleData,
  sameStyle,
  type MindmapStyle,
} from '../settings/StyleStore'

/** 建一个 store，同时记下落盘次数——预览绝不能让这个数字动。 */
function makeStore(): { store: StyleStore; saves: () => number } {
  let saves = 0
  const store = new StyleStore(defaultStyleData(), () => {
    saves++
  })
  return { store, saves: () => saves }
}

function styleWith(patch: Partial<MindmapStyle>): MindmapStyle {
  return { ...DEFAULT_STYLE, ...patch }
}

describe('normalizeStyle（脏配置收拢）', () => {
  it('空输入 → 默认样式', () => {
    expect(normalizeStyle(undefined)).toEqual(DEFAULT_STYLE)
    expect(normalizeStyle(null)).toEqual(DEFAULT_STYLE)
    expect(normalizeStyle({})).toEqual(DEFAULT_STYLE)
  })

  it('超出范围的数值收进上下限', () => {
    expect(normalizeStyle({ hGap: 9999 }).hGap).toBe(200)
    expect(normalizeStyle({ hGap: -5 }).hGap).toBe(16)
    expect(normalizeStyle({ fontScale: 100 }).fontScale).toBe(2)
    expect(normalizeStyle({ fontScale: 0 }).fontScale).toBe(0.6)
  })

  it('类型不对 / 枚举里没有的值退回默认', () => {
    expect(normalizeStyle({ hGap: 'wide' }).hGap).toBe(DEFAULT_STYLE.hGap)
    expect(normalizeStyle({ vGap: NaN }).vGap).toBe(DEFAULT_STYLE.vGap)
    expect(normalizeStyle({ shape: 'triangle' }).shape).toBe('rounded')
    expect(normalizeStyle({ scheme: 42 }).scheme).toBe('theme')
    expect(normalizeStyle({ branch: 'zigzag' }).branch).toBe('curve')
  })

  it('折线是合法的分支样式（M11 新增），旧版本存下的值也照收', () => {
    expect(normalizeStyle({ branch: 'elbow' }).branch).toBe('elbow')
    expect(normalizeStyle({ branch: 'straight' }).branch).toBe('straight')
    // 反过来：插件降级回不认识 elbow 的旧版本时，这个值会被收拢成默认值而不是画不出线
    expect(normalizeStyle({ branch: 'elbow-rounded' }).branch).toBe('curve')
  })

  it('单篇样式缺项以【全局】补齐，而不是以出厂默认补齐', () => {
    const data = normalizeStyleData({
      global: { hGap: 100, scheme: 'blue' },
      perFile: { 'a.md': { hGap: 60 } },
    })
    const a = data.perFile['a.md']
    expect(a?.hGap).toBe(60) // 自己写了的，听自己的
    expect(a?.scheme).toBe('blue') // 没写的，跟着全局走
  })

  it('perFile 不是对象时当空处理', () => {
    expect(normalizeStyleData({ perFile: 'nope' }).perFile).toEqual({})
    expect(normalizeStyleData(null)).toEqual(defaultStyleData())
  })
})

describe('两级取值', () => {
  it('没有单篇覆盖时用全局', () => {
    const { store } = makeStore()
    store.applyGlobal(null, styleWith({ hGap: 80 }))
    expect(store.styleFor('a.md').hGap).toBe(80)
    expect(store.styleFor(null).hGap).toBe(80)
    expect(store.hasOverride('a.md')).toBe(false)
  })

  it('单篇覆盖只作用于这一篇', () => {
    const { store } = makeStore()
    store.applyFile('a.md', styleWith({ hGap: 120 }))
    expect(store.styleFor('a.md').hGap).toBe(120)
    expect(store.styleFor('b.md').hGap).toBe(DEFAULT_STYLE.hGap)
    expect(store.hasOverride('a.md')).toBe(true)
  })

  it('与全局完全相同时不写单篇项——否则 data.json 会一次次白白变大', () => {
    const { store } = makeStore()
    store.applyFile('a.md', { ...DEFAULT_STYLE })
    expect(store.toData().perFile).toEqual({})
    expect(store.hasOverride('a.md')).toBe(false)
  })

  it('应用全局时清掉本篇的覆盖，否则眼前这篇看不出任何变化', () => {
    const { store } = makeStore()
    store.applyFile('a.md', styleWith({ hGap: 120 }))
    store.applyGlobal('a.md', styleWith({ hGap: 90 }))
    expect(store.hasOverride('a.md')).toBe(false)
    expect(store.styleFor('a.md').hGap).toBe(90)
  })

  it('clearFile 回到跟随全局', () => {
    const { store } = makeStore()
    store.applyFile('a.md', styleWith({ vGap: 40 }))
    expect(store.clearFile('a.md')).toBe(true)
    expect(store.clearFile('a.md')).toBe(false)
    expect(store.styleFor('a.md').vGap).toBe(DEFAULT_STYLE.vGap)
  })
})

describe('预览', () => {
  it('预览改的是眼前这篇，且【不落盘】', () => {
    const { store, saves } = makeStore()
    store.setPreview('a.md', styleWith({ hGap: 160 }))
    expect(store.styleFor('a.md').hGap).toBe(160)
    expect(store.styleFor('b.md').hGap).toBe(DEFAULT_STYLE.hGap) // 别篇不受影响
    expect(saves()).toBe(0)
    expect(store.toData().perFile).toEqual({})
  })

  it('取消预览 → 回到保存过的样子（M8 验收：取消能还原）', () => {
    const { store } = makeStore()
    store.applyFile('a.md', styleWith({ hGap: 120 }))
    store.setPreview('a.md', styleWith({ hGap: 30 }))
    expect(store.styleFor('a.md').hGap).toBe(30)
    store.clearPreview()
    expect(store.styleFor('a.md').hGap).toBe(120)
  })

  it('应用之后预览自动结束，不会盖住后续的读取', () => {
    const { store } = makeStore()
    store.setPreview('a.md', styleWith({ hGap: 30 }))
    store.applyFile('a.md', styleWith({ hGap: 64 }))
    store.clearFile('a.md')
    expect(store.styleFor('a.md').hGap).toBe(DEFAULT_STYLE.hGap)
  })

  it('每次变化都通知订阅者；退订之后不再通知', () => {
    const { store } = makeStore()
    let n = 0
    const off = store.subscribe(() => {
      n++
    })
    store.setPreview('a.md', styleWith({ hGap: 30 }))
    store.clearPreview()
    expect(n).toBe(2)
    off()
    store.applyGlobal(null, styleWith({ hGap: 90 }))
    expect(n).toBe(2)
  })
})

describe('改名与删除（陷阱 7）', () => {
  it('笔记改名 → 单篇样式跟着走', () => {
    const { store } = makeStore()
    store.applyFile('a.md', styleWith({ hGap: 120 }))
    expect(store.rename('a.md', 'b.md')).toBe(true)
    expect(store.styleFor('b.md').hGap).toBe(120)
    expect(store.hasOverride('a.md')).toBe(false)
  })

  it('移动到别的文件夹也是改名，同样迁移', () => {
    const { store } = makeStore()
    store.applyFile('笔记/a.md', styleWith({ vGap: 30 }))
    store.rename('笔记/a.md', '归档/2026/a.md')
    expect(store.styleFor('归档/2026/a.md').vGap).toBe(30)
  })

  it('文件夹改名 → 底下每一篇的 key 都换前缀', () => {
    const { store } = makeStore()
    store.applyFile('proj/a.md', styleWith({ hGap: 100 }))
    store.applyFile('proj/sub/b.md', styleWith({ hGap: 140 }))
    store.applyFile('other/c.md', styleWith({ hGap: 40 }))

    expect(store.rename('proj', 'work')).toBe(true)
    expect(store.styleFor('work/a.md').hGap).toBe(100)
    expect(store.styleFor('work/sub/b.md').hGap).toBe(140)
    expect(store.styleFor('other/c.md').hGap).toBe(40) // 不同文件夹别误伤
    expect(Object.keys(store.toData().perFile).sort()).toEqual([
      'other/c.md',
      'work/a.md',
      'work/sub/b.md',
    ])
  })

  it('前缀只按目录分隔符算：proj2 不该被 proj 的改名波及', () => {
    const { store } = makeStore()
    store.applyFile('proj2/a.md', styleWith({ hGap: 100 }))
    expect(store.rename('proj', 'work')).toBe(false)
    expect(store.hasOverride('proj2/a.md')).toBe(true)
  })

  it('改名不涉及任何配置时不写盘', () => {
    const { store, saves } = makeStore()
    store.applyFile('a.md', styleWith({ hGap: 120 }))
    const before = saves()
    expect(store.rename('x.md', 'y.md')).toBe(false)
    expect(saves()).toBe(before)
  })

  it('删除笔记 → 配置被清理（M8 验收第三条）', () => {
    const { store } = makeStore()
    store.applyFile('a.md', styleWith({ hGap: 120 }))
    expect(store.remove('a.md')).toBe(true)
    expect(store.toData().perFile).toEqual({})
    expect(store.remove('a.md')).toBe(false)
  })

  it('删除文件夹 → 底下的配置一并清理，别的文件夹不动', () => {
    const { store } = makeStore()
    store.applyFile('proj/a.md', styleWith({ hGap: 100 }))
    store.applyFile('proj/sub/b.md', styleWith({ hGap: 140 }))
    store.applyFile('proj2/c.md', styleWith({ hGap: 40 }))
    expect(store.remove('proj')).toBe(true)
    expect(Object.keys(store.toData().perFile)).toEqual(['proj2/c.md'])
  })

  it('样式窗口开着时被改名，预览跟着新路径走', () => {
    const { store } = makeStore()
    store.setPreview('a.md', styleWith({ hGap: 33 }))
    store.applyFile('a.md', styleWith({ hGap: 33 })) // 先落一份，好让 rename 有东西可迁
    store.setPreview('a.md', styleWith({ hGap: 77 }))
    store.rename('a.md', 'b.md')
    expect(store.styleFor('b.md').hGap).toBe(77)
    // 窗口据此决定「应用到哪一篇」，否则会写进已经不存在的 a.md
    expect(store.previewPath()).toBe('b.md')
  })

  it('没有预览时 previewPath 是 undefined（窗口据此退回自己记下的路径）', () => {
    const { store } = makeStore()
    expect(store.previewPath()).toBeUndefined()
    store.setPreview(null, styleWith({ hGap: 50 }))
    expect(store.previewPath()).toBeNull()
  })
})

describe('sameStyle', () => {
  it('逐项相同才算相同', () => {
    expect(sameStyle(DEFAULT_STYLE, { ...DEFAULT_STYLE })).toBe(true)
    expect(sameStyle(DEFAULT_STYLE, styleWith({ fontScale: 1.2 }))).toBe(false)
    expect(sameStyle(DEFAULT_STYLE, styleWith({ shape: 'pill' }))).toBe(false)
  })
})
