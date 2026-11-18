/** Source ranges do not depend on which nodes are displayed. */
export function indentColumns(value: string): number { return value.replace(/\t/g, '    ').length }
export function listContentColumn(line: string): number {
  return indentColumns(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/.exec(line)?.[0] ?? '')
}
export function listBlockEnd(lines: string[], start: number, limit = lines.length): number {
  const column = listContentColumn(lines[start] ?? '')
  if (!column) return limit
  let end = start + 1
  for (; end < limit; end++) {
    const line = lines[end] ?? ''
    if (line.trim() && indentColumns(/^[ \t]*/.exec(line)?.[0] ?? '') < column) break
  }
  while (end > start + 1 && !lines[end - 1]?.trim()) end--
  return end
}
/** Change the list container indentation, retaining the relative indentation of code. */
export function reindentBody(lines: string[], oldColumn: number, newColumn: number): string[] {
  if (oldColumn === newColumn) return lines
  return lines.map(line => {
    if (!line.trim()) return line
    const prefix = /^[ \t]*/.exec(line)?.[0] ?? ''
    const width = indentColumns(prefix)
    if (oldColumn && width < oldColumn) return line
    return ' '.repeat(Math.max(0, width - oldColumn + newColumn)) + line.slice(prefix.length)
  })
}
