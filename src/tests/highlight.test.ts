/**
 * 行高亮的状态逻辑。
 *
 * EditorState 是纯数据结构，不需要 DOM，所以这一层能真跑起来单测——
 * 「什么时候清除高亮」正是 M4 最容易写错的地方。
 */

import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { HIGHLIGHT_CLASS, highlightExtension, jumpLineField, setJumpLine } from '../doc/highlight'

const DOC = ['# 一', '正文', '## 二', '正文', '### 三'].join('\n')

function state(doc = DOC): EditorState {
  return EditorState.create({ doc, extensions: [highlightExtension()] })
}

function highlight(s: EditorState, line: number | null): EditorState {
  return s.update({ effects: setJumpLine.of(line) }).state
}

/** 取出装饰覆盖的行号（0-based）。 */
function decoratedLines(s: EditorState): number[] {
  const set = s.facet(EditorView.decorations).flatMap((d) => (typeof d === 'function' ? [] : [d]))
  const lines: number[] = []
  for (const deco of set) {
    const iter = deco.iter()
    while (iter.value) {
      expect(iter.value.spec.class).toBe(HIGHLIGHT_CLASS)
      lines.push(s.doc.lineAt(iter.from).number - 1)
      iter.next()
    }
  }
  return lines
}

describe('jumpLineField', () => {
  it('初始没有高亮', () => {
    const s = state()
    expect(s.field(jumpLineField)).toBe(null)
    expect(decoratedLines(s)).toEqual([])
  })

  it('设置行号后，装饰恰好落在那一行', () => {
    const s = highlight(state(), 2)
    expect(s.field(jumpLineField)).toBe(2)
    expect(decoratedLines(s)).toEqual([2])
  })

  it('换一行 → 旧高亮消失，只剩新的', () => {
    const s = highlight(highlight(state(), 2), 4)
    expect(decoratedLines(s)).toEqual([4])
  })

  it('传 null 清除', () => {
    const s = highlight(highlight(state(), 2), null)
    expect(s.field(jumpLineField)).toBe(null)
    expect(decoratedLines(s)).toEqual([])
  })

  it('用户点击编辑器（选区变化）→ 高亮立即消失', () => {
    const s = highlight(state(), 2)
    const after = s.update({ selection: { anchor: 0 } }).state
    expect(after.field(jumpLineField)).toBe(null)
    expect(decoratedLines(after)).toEqual([])
  })

  it('用户敲字 → 高亮立即消失', () => {
    const s = highlight(state(), 2)
    const after = s.update({ changes: { from: 0, insert: 'x' } }).state
    expect(after.field(jumpLineField)).toBe(null)
  })

  it('同一个事务里既跳转又动选区 → 以跳转为准', () => {
    const s = state().update({ effects: setJumpLine.of(2), selection: { anchor: 0 } }).state
    expect(s.field(jumpLineField)).toBe(2)
  })

  it('行号越界 → 当作没有高亮，不抛错', () => {
    expect(highlight(state(), 99).field(jumpLineField)).toBe(null)
    expect(highlight(state(), -1).field(jumpLineField)).toBe(null)
  })

  it('文档变短导致行号失效时不残留', () => {
    // 文档一变就清空，所以不存在「行号指向已被删掉的行」这种状态
    const s = highlight(state(), 4)
    const after = s.update({ changes: { from: 0, to: s.doc.length, insert: '# 一' } }).state
    expect(after.field(jumpLineField)).toBe(null)
    expect(decoratedLines(after)).toEqual([])
  })

  it('高亮的事务不改文档、不改选区（不抢焦点的前提）', () => {
    const tr = state().update({ effects: setJumpLine.of(2) })
    expect(tr.docChanged).toBe(false)
    expect(tr.selection).toBe(undefined)
  })

  it('没装扩展的编辑器里读 field 得到 undefined，不炸', () => {
    const bare = EditorState.create({ doc: DOC })
    expect(bare.field(jumpLineField, false)).toBe(undefined)
  })
})
