import { parse, joinLines, listBaseDepthOf } from './parser'
import { serializeSubtree } from './serializer'
import { maxDepthDrop } from './tree'
import type { MindTree, MindNode, ParseOptions, EditPlan } from './types'
export function selectedBranches(tree: MindTree, selection: ReadonlySet<string>): MindNode[] {
  return [...selection].map(id => tree.byId.get(id)).filter((node): node is MindNode => !!node)
    .filter(node => { for (let p = node.parent; p; p = p.parent) if (selection.has(p.id)) return false; return true })
    .sort((a, b) => a.titleLine - b.titleLine)
}
export function copyBranches(tree: MindTree, selection: ReadonlySet<string>): string {
  return selectedBranches(tree, selection).map(n => tree.lines.slice(n.blockStart, n.blockEnd).join(tree.eol)).join(tree.eol + tree.eol)
}
export function pastePlan(tree: MindTree, target: MindNode | null, text: string, options: ParseOptions, sibling = false): EditPlan {
  if (!text.trim()) return []
  const parent = sibling ? target?.parent ?? tree.root : target ?? tree.root
  const depth = sibling && target ? target.depth : parent.depth + 1
  const at = sibling && target ? target.blockEnd : parent.depth ? parent.blockEnd : tree.lines.length
  let parsed = parse(text, { listNodes: true, orderedListNodes: true, strictLineBreak: false })
  // Preserve prose before the first structural node as its own topic.
  if (!parsed.root.children.length || parsed.root.bodyEnd > 0 && parsed.lines.slice(0, parsed.root.bodyEnd).some(line => line.trim())) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    const first = lines.findIndex(line => line.trim())
    const heading = lines[first] ?? ''
    parsed = parse('# ' + heading + '\n' + lines.slice(first + 1).join('\n'), { ...options, listNodes: false, orderedListNodes: false })
  }
  // A list marker that is disabled in the destination must not produce an invisible topic.
  for (const node of parsed.byId.values()) {
    if (node.kind !== 'list') continue
    const line = parsed.lines[node.titleLine]!
    const ordered = /^[ \t]*\d/.test(line)
    if (ordered && !options.orderedListNodes && options.listNodes) parsed.lines[node.titleLine] = line.replace(/\d{1,9}[.)]/, '-')
    if (!ordered && !options.listNodes && options.orderedListNodes) parsed.lines[node.titleLine] = line.replace(/[-*+]/, '1.')
  }
  const lines: string[] = []
  for (const [index, node] of parsed.root.children.entries()) {
    if (!options.listNodes && !options.orderedListNodes && depth + maxDepthDrop(node) > 6)
      throw new Error('目标位置超过六级标题 / Target exceeds H6')
    const list = parent.kind === 'list' || depth > 6
    const kind = list ? 'list' : 'heading'
    const block = serializeSubtree(parsed.lines, node, depth, kind,
      parent.kind === 'list' ? listBaseDepthOf(parent) : parent.depth + 1, options,
      parent.kind === 'list' ? tree.lines[parent.titleLine] : undefined)
    const next = parsed.root.children[index + 1]
    lines.push(...block, ...parsed.lines.slice(node.blockEnd, next?.titleLine ?? parsed.lines.length), '')
  }
  const plan = [{ fromLine: at, toLine: at, lines: ['', ...lines] }]
  const preview = [...tree.lines.slice(0, at), ...plan[0]!.lines, ...tree.lines.slice(at)]
  const output = parse(joinLines(preview, tree.eol), options)
  const inserted = [...output.byId.values()].filter(n => n.titleLine >= at && n.titleLine < at + plan[0]!.lines.length)
  const roots = inserted.filter(n => !n.parent || n.parent.titleLine < at)
  if (roots.length !== parsed.root.children.length || roots.some(n => n.parent?.titleLine !== parent.titleLine))
    throw new Error('目标位置无法保留分支结构 / Cannot preserve branch structure at this location')
  return plan
}
