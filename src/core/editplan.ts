/**
 * TextEdit 的校验与应用。见 操作手册.md 第 4.3 节。
 *
 * 【禁止】import 任何 obsidian API。
 *
 * 注：本文件在手册中列在 M2，但 M1 的「零改动哨兵测试」必须先能应用 EditPlan，
 * 因此提前实现纯函数部分（validatePlan / applyPlan）。M2 只在此基础上加 tree.ts。
 */

import type { EditPlan } from './types'

/**
 * 校验行范围合法且互不重叠。重叠 = bug，直接抛错，绝不静默合并。
 *
 * 允许同一位置的多个零长度插入（fromLine === toLine）。
 */
export function validatePlan(plan: EditPlan, lineCount: number): void {
  for (const e of plan) {
    if (!Number.isInteger(e.fromLine) || !Number.isInteger(e.toLine)) {
      throw new Error(`TextEdit 行号必须是整数：${JSON.stringify(e)}`)
    }
    if (e.fromLine < 0 || e.toLine < e.fromLine || e.toLine > lineCount) {
      throw new Error(
        `TextEdit 行范围越界：[${e.fromLine}, ${e.toLine})，文件共 ${lineCount} 行`,
      )
    }
  }

  const sorted = [...plan].sort((a, b) => a.fromLine - b.fromLine || a.toLine - b.toLine)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!
    const cur = sorted[i]!
    if (prev.toLine > cur.fromLine) {
      throw new Error(
        `TextEdit 范围重叠：[${prev.fromLine}, ${prev.toLine}) 与 [${cur.fromLine}, ${cur.toLine})`,
      )
    }
  }
}

/**
 * 纯函数版应用。按 fromLine 降序应用，避免行号偏移。
 *
 * 不修改传入的 lines。
 */
export function applyPlan(lines: string[], plan: EditPlan): string[] {
  validatePlan(plan, lines.length)
  const out = lines.slice()
  const sorted = [...plan].sort((a, b) => b.fromLine - a.fromLine || b.toLine - a.toLine)
  for (const e of sorted) {
    out.splice(e.fromLine, e.toLine - e.fromLine, ...e.lines)
  }
  return out
}
