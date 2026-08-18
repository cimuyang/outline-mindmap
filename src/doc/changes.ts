/**
 * EditPlan（行范围）→ 编辑器坐标（行/列）的转换。
 *
 * 单独成文件是为了让它保持【纯函数】且不 import obsidian，
 * 这样可以直接被单测覆盖——它是整条写回链路上最容易出错的一环。
 *
 * 返回的对象与 obsidian 的 `EditorChange` 结构兼容。
 */

import type { EditPlan } from '../core/types'

export interface DocPosition {
  line: number
  ch: number
}

export interface DocChange {
  from: DocPosition
  to: DocPosition
  text: string
}

/**
 * 合并「行号首尾相接」的编辑。
 *
 * 不改变 applyPlan 的结果，但能保证转换后的任意两个 change 不会在字符坐标上打架：
 * 「删到文档末尾」的情形需要向前借用上一行的换行符，若上一行正好是另一处编辑的终点就会重叠。
 */
function coalesce(plan: EditPlan): EditPlan {
  const sorted = [...plan].sort((a, b) => a.fromLine - b.fromLine || a.toLine - b.toLine)
  const out: EditPlan = []
  for (const e of sorted) {
    const prev = out[out.length - 1]
    if (prev && prev.toLine === e.fromLine) {
      prev.toLine = e.toLine
      prev.lines = [...prev.lines, ...e.lines]
    } else {
      out.push({ fromLine: e.fromLine, toLine: e.toLine, lines: [...e.lines] })
    }
  }
  return out
}

/**
 * 把行范围替换转成编辑器的字符范围替换。
 *
 * 三种情形：
 * - `toLine < N`：可以锚在下一行行首，替换文本自带结尾换行。
 * - `toLine === N` 且 `fromLine === 0`：整篇替换，无结尾换行。
 * - `toLine === N` 且 `fromLine > 0`：锚在【上一行行尾】，把上一行的换行符一并纳入，
 *   否则删除最后一行会留下一个孤立的换行符。
 */
export function planToChanges(lines: string[], plan: EditPlan, eol: '\n' | '\r\n'): DocChange[] {
  const n = lines.length
  return coalesce(plan).map((e) => {
    const text = e.lines.join(eol)

    // 空文件在编辑器里仍然是「1 个空行」，而 splitLines('') 是空数组
    if (n === 0) {
      return { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 }, text }
    }

    if (e.toLine < n) {
      return {
        from: { line: e.fromLine, ch: 0 },
        to: { line: e.toLine, ch: 0 },
        text: e.lines.length > 0 ? text + eol : '',
      }
    }

    const lastCh = (lines[n - 1] ?? '').length
    if (e.fromLine === 0) {
      return { from: { line: 0, ch: 0 }, to: { line: n - 1, ch: lastCh }, text }
    }

    return {
      from: { line: e.fromLine - 1, ch: (lines[e.fromLine - 1] ?? '').length },
      to: { line: n - 1, ch: lastCh },
      text: e.lines.length > 0 ? eol + text : '',
    }
  })
}
