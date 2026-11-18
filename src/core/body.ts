import { listBlockEnd, listContentColumn, reindentBody } from './blocks'
import type { MindNode, MindTree, EditPlan } from './types'

export interface BodyRange { start: number; end: number; indent: number }
export function bodyRange(tree: MindTree, node: MindNode): BodyRange {
  const start = node.titleLine + 1
  if (node.kind === 'list') return { start, end: listBlockEnd(tree.lines, node.titleLine), indent: listContentColumn(tree.lines[node.titleLine] ?? '') }
  let end = tree.lines.length
  for (const h of tree.byId.values()) if (h.kind === 'heading' && h.titleLine > node.titleLine) { end = h.titleLine; break }
  return { start, end, indent: 0 }
}
export function readBody(lines: string[], range: BodyRange): string {
  return reindentBody(lines.slice(range.start, range.end), range.indent, 0).join('\n')
}
export function bodyPlan(range: BodyRange, value: string): EditPlan {
  const lines = value === '' ? [] : reindentBody(value.replace(/\r\n?/g, '\n').split('\n'), 0, range.indent)
  return [{ fromLine: range.start, toLine: range.end, lines }]
}
/** Rebase a selected source range through a single contiguous external edit.
 * Changes touching the range require a new snapshot instead of guessing identity. */
export function rebaseBody(before: string[], after: string[], range: BodyRange): BodyRange | null {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  if (prefix === before.length && prefix === after.length) return { ...range }
  let oldEnd = before.length, newEnd = after.length
  while (oldEnd > prefix && newEnd > prefix && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd-- }
  // Include the title in the protected range. An identical duplicate cannot steal the session.
  if (oldEnd <= range.start - 1 && prefix < range.start - 1) {
    const delta = newEnd - oldEnd
    return { ...range, start: range.start + delta, end: range.end + delta }
  }
  if (prefix >= range.end && prefix > range.start - 1) return { ...range }
  return null
}

export function bodyIndicators(tree: MindTree): Set<string> {
  const ids = new Set<string>()
  const nonblank = new Array<number>(tree.lines.length + 1).fill(0)
  for (let i = 0; i < tree.lines.length; i++) nonblank[i + 1] = nonblank[i]! + (tree.lines[i]!.trim() ? 1 : 0)
  let nextHeading = tree.lines.length
  for (const node of [...tree.byId.values()].reverse()) {
    const end = node.kind === 'heading' ? nextHeading : node.blockEnd
    if (nonblank[end]! > nonblank[node.titleLine + 1]!) ids.add(node.id)
    if (node.kind === 'heading') nextHeading = node.titleLine
  }
  return ids
}
