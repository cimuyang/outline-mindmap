/**
 * 跳转后的标题行高亮。CodeMirror `StateField` + `Decoration`。
 *
 * 【为什么不用 DOM 直接加类】——编辑器是虚拟滚动的，行元素随时被回收重建，
 * 手写的类会在滚出视野再滚回来时消失。装饰是状态的一部分，CM 自己负责重建。
 *
 * 【为什么高亮的清除写在状态更新里，而不是挂一次性 DOM 监听】——
 * 「用户点了编辑器」在 CM 里就是一次带 selection 的事务，敲字则是 docChanged。
 * 在 update 里判掉这两种，比挂 mousedown 监听可靠（键盘移动光标同样该清），
 * 而且没有需要解绑的东西，天然不会泄漏。
 */

import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

/** 行高亮的 CSS 类，样式在 styles.css。 */
export const HIGHLIGHT_CLASS = 'om-jump-line'

/** 载荷是 0-based 行号；null = 清除。 */
export const setJumpLine = StateEffect.define<number | null>()

const lineDeco = Decoration.line({ class: HIGHLIGHT_CLASS })

/**
 * 当前高亮的行（0-based），没有则为 null。
 *
 * 文档一变就清空，所以不需要把行号跟着 changes 映射——省掉了整类「映射后行号错位」的 bug。
 */
export const jumpLineField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    let next = value
    // 用户点了编辑器任意处 / 移动了光标 / 敲了字 → 高亮立即消失
    if (tr.selection || tr.docChanged) next = null
    // 效果最后处理：同一个事务里既跳转又改选区时，以跳转为准
    for (const e of tr.effects) {
      if (e.is(setJumpLine)) next = e.value
    }
    if (next !== null && (next < 0 || next >= tr.state.doc.lines)) next = null
    return next
  },
})

const jumpDecorations = EditorView.decorations.compute([jumpLineField], (state): DecorationSet => {
  const line = state.field(jumpLineField)
  if (line === null) return Decoration.none
  return Decoration.set([lineDeco.range(state.doc.line(line + 1).from)])
})

export function highlightExtension(): Extension {
  return [jumpLineField, jumpDecorations]
}

/** 扩展是否已装进这个编辑器。别的插件建的编辑器可能没有。 */
function hasField(view: EditorView): boolean {
  return view.state.field(jumpLineField, false) !== undefined
}

/**
 * 滚动到指定行并高亮，一个事务干完。
 *
 * 事务里【不带 selection】——带了就等于把光标挪进编辑器，那才是真正的抢焦点。
 * 只发滚动效果的话，键盘焦点留在原处（导图上）。
 */
export function revealAndHighlight(view: EditorView, line: number): void {
  const target = Math.min(Math.max(line, 0), view.state.doc.lines - 1)
  const pos = view.state.doc.line(target + 1).from
  const effects: StateEffect<unknown>[] = [EditorView.scrollIntoView(pos, { y: 'center' })]
  if (hasField(view)) effects.push(setJumpLine.of(target))
  view.dispatch({ effects })
}

export function clearHighlight(view: EditorView): void {
  if (!hasField(view) || view.state.field(jumpLineField) === null) return
  view.dispatch({ effects: setJumpLine.of(null) })
}
