import type { CachedMetadata, MarkdownPreviewView, MarkdownSectionInformation } from 'obsidian'

export const PREVIEW_HIGHLIGHT_CLASS = 'om-jump-preview'

const SECTION_SELECTOR = '[data-om-line-start][data-om-line-end][data-om-source-path]'

type TargetKind = 'heading' | 'list'

export interface PreviewTarget {
  kind: TargetKind
  index: number
}

/**
 * 把源码行号换成同类节点在【全文】中的文档序下标。
 * 行号来自 Obsidian metadata cache，同名标题、行内 Markdown 和公式都不影响。
 */
export function previewTargetAtLine(cache: CachedMetadata | null, line: number): PreviewTarget | null {
  if (!cache || line < 0) return null

  const heading = cache.headings?.findIndex((item) => item.position.start.line === line) ?? -1
  if (heading >= 0) return { kind: 'heading', index: heading }

  const list = cache.listItems?.findIndex((item) => item.position.start.line === line) ?? -1
  return list >= 0 ? { kind: 'list', index: list } : null
}

/**
 * Markdown post processor 每次收到的都是一个渲染区块。把它的公开源码位置
 * 原样标在 DOM 上，跳转时就不必依赖 Obsidian 的私有 renderer 内部实现。
 */
export function annotatePreviewSection(
  element: HTMLElement,
  sourcePath: string,
  info: MarkdownSectionInformation,
): void {
  element.dataset.omSourcePath = sourcePath
  element.dataset.omLineStart = String(info.lineStart)
  element.dataset.omLineEnd = String(info.lineEnd)
}

/** 排除区块里嵌入的其他笔记，免得它们扰乱本区块的下标。 */
function ownElements(container: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (element) => element.closest('.markdown-embed, .internal-embed') === null,
  )
}

function selectorFor(kind: TargetKind): string {
  return kind === 'heading' ? 'h1, h2, h3, h4, h5, h6' : 'li'
}

function sourceLines(cache: CachedMetadata, kind: TargetKind): number[] {
  const items = kind === 'heading' ? cache.headings : cache.listItems
  return items?.map((item) => item.position.start.line) ?? []
}

interface SectionRange {
  element: HTMLElement
  start: number
  end: number
}

function renderedSections(container: HTMLElement, sourcePath: string, line: number): SectionRange[] {
  const sections: SectionRange[] = []
  for (const element of Array.from(container.querySelectorAll<HTMLElement>(SECTION_SELECTOR))) {
    if (element.dataset.omSourcePath !== sourcePath) continue
    const start = Number(element.dataset.omLineStart)
    const end = Number(element.dataset.omLineEnd)
    if (!Number.isInteger(start) || !Number.isInteger(end) || line < start || line > end) continue
    sections.push({ element, start, end })
  }
  // 边界行偶尔会同时落入相邻区块的范围：先试更窄、更靠后的那个。
  return sections.sort((a, b) => a.end - a.start - (b.end - b.start) || b.start - a.start)
}

function targetInsideSection(
  section: SectionRange,
  cache: CachedMetadata,
  target: PreviewTarget,
  line: number,
): HTMLElement | null {
  const lines = sourceLines(cache, target.kind).filter(
    (candidate) => candidate >= section.start && candidate <= section.end,
  )
  const localIndex = lines.indexOf(line)
  if (localIndex < 0) return null
  return ownElements(section.element, selectorFor(target.kind))[localIndex] ?? null
}

/**
 * 只在已渲染的区块中查找。长文档的其他区块可以完全不在 DOM 里；
 * 区块内下标而不是全文下标，才能在虚拟渲染下保持稳定。
 */
export function findPreviewTarget(
  preview: MarkdownPreviewView,
  cache: CachedMetadata | null,
  sourcePath: string,
  line: number,
): HTMLElement | null {
  const target = previewTargetAtLine(cache, line)
  if (!target || !cache) return null

  for (const section of renderedSections(preview.containerEl, sourcePath, line)) {
    const element = targetInsideSection(section, cache, target, line)
    if (element) return element
  }

  // 旧预览 DOM 可能是在插件注册 post processor 之前渲染的，还没有区块标记。
  // 只有当 DOM 数量与缓存的全文数量完全一致时，全文下标才是安全的回退。
  const elements = ownElements(preview.containerEl, selectorFor(target.kind))
  const expected = sourceLines(cache, target.kind).length
  return elements.length === expected ? (elements[target.index] ?? null) : null
}

/** 只滚动当前可见的阅读视图，不改选区、不抢焦点。 */
export function revealPreviewLine(
  preview: MarkdownPreviewView,
  cache: CachedMetadata | null,
  sourcePath: string,
  line: number,
): HTMLElement | null {
  const target = findPreviewTarget(preview, cache, sourcePath, line)
  if (!target) return null
  target.classList.add(PREVIEW_HIGHLIGHT_CLASS)
  target.scrollIntoView({ block: 'center', inline: 'nearest' })
  return target
}

export function clearPreviewHighlight(element: HTMLElement | null): void {
  element?.classList.remove(PREVIEW_HIGHLIGHT_CLASS)
}
