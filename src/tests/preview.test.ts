import { describe, expect, it } from 'vitest'
import type { CachedMetadata, MarkdownPreviewView } from 'obsidian'
import {
  annotatePreviewSection,
  clearPreviewHighlight,
  findPreviewTarget,
  PREVIEW_HIGHLIGHT_CLASS,
  previewTargetAtLine,
  revealPreviewLine,
} from '../doc/preview'

function position(line: number) {
  const point = { line, col: 0, offset: line * 10 }
  return { start: point, end: point }
}

function heading(line: number, text = `h${line}`) {
  return { heading: text, level: 1, position: position(line) }
}

const cache = {
  headings: [heading(2, '重复标题'), heading(8, '重复标题')],
  listItems: [
    { parent: -11, position: position(11) },
    { parent: 11, position: position(12) },
  ],
} satisfies CachedMetadata

function node(embedded = false): HTMLElement {
  return { closest: () => (embedded ? {} : null) } as unknown as HTMLElement
}

function section(
  sourcePath: string,
  start: number,
  end: number,
  headings: HTMLElement[] = [],
  lists: HTMLElement[] = [],
): HTMLElement {
  return {
    dataset: {
      omSourcePath: sourcePath,
      omLineStart: String(start),
      omLineEnd: String(end),
    },
    querySelectorAll: (selector: string) => (selector === 'li' ? lists : headings),
  } as unknown as HTMLElement
}

function preview(sections: HTMLElement[], headings: HTMLElement[] = [], lists: HTMLElement[] = []) {
  return {
    containerEl: {
      querySelectorAll: (selector: string) => {
        if (selector.startsWith('[data-om-line-start]')) return sections
        return selector === 'li' ? lists : headings
      },
    },
  } as unknown as MarkdownPreviewView
}

describe('previewTargetAtLine', () => {
  it('按行号区分同名标题，不依赖渲染后的文字', () => {
    expect(previewTargetAtLine(cache, 2)).toEqual({ kind: 'heading', index: 0 })
    expect(previewTargetAtLine(cache, 8)).toEqual({ kind: 'heading', index: 1 })
  })

  it('列表项与阅读模式的 li 按文档序对齐', () => {
    expect(previewTargetAtLine(cache, 11)).toEqual({ kind: 'list', index: 0 })
    expect(previewTargetAtLine(cache, 12)).toEqual({ kind: 'list', index: 1 })
  })

  it('无缓存、负行号和普通正文都不误跳', () => {
    expect(previewTargetAtLine(null, 2)).toBe(null)
    expect(previewTargetAtLine(cache, -1)).toBe(null)
    expect(previewTargetAtLine(cache, 5)).toBe(null)
  })
})

describe('preview sections', () => {
  it('用 post processor 的公开位置信息标记区块', () => {
    const element = { dataset: {} } as unknown as HTMLElement
    annotatePreviewSection(element, 'notes/a.md', { text: '# A', lineStart: 20, lineEnd: 29 })
    expect(element.dataset).toEqual({
      omSourcePath: 'notes/a.md',
      omLineStart: '20',
      omLineEnd: '29',
    })
  })

  it('长文档只渲染目标区块时，也不使用全文下标', () => {
    const target = node()
    const longCache = {
      headings: [heading(2), heading(100), heading(200), heading(300)],
    } satisfies CachedMetadata
    const targetSection = section('long.md', 90, 110, [target])

    // DOM 只有全文第 2 个标题；旧实现会取 headings[1] 而得到 undefined。
    expect(findPreviewTarget(preview([targetSection]), longCache, 'long.md', 100)).toBe(target)
  })

  it('同一区块内用局部文档序区分同名标题', () => {
    const first = node()
    const second = node()
    const targetSection = section('same.md', 0, 10, [first, second])
    expect(findPreviewTarget(preview([targetSection]), cache, 'same.md', 8)).toBe(second)
  })

  it('嵌入笔记的区块与主笔记按 sourcePath 严格隔离', () => {
    const embedded = node()
    const own = node()
    const embeddedSection = section('embedded.md', 0, 10, [embedded])
    const ownSection = section('main.md', 0, 10, [own, node()])
    expect(findPreviewTarget(preview([embeddedSection, ownSection]), cache, 'main.md', 2)).toBe(own)
  })

  it('旧 DOM 没有区块标记时，只在全文数量完整时回退', () => {
    const first = node()
    const embedded = node(true)
    const second = node()
    expect(findPreviewTarget(preview([], [first, embedded, second]), cache, 'a.md', 8)).toBe(second)
    expect(findPreviewTarget(preview([], [first]), cache, 'a.md', 8)).toBe(null)
  })

  it('缓存中有节点但目标区块尚未渲染时返回 null，交给上层等待', () => {
    expect(findPreviewTarget(preview([]), cache, 'a.md', 2)).toBe(null)
  })

  it('居中滚动并高亮，清理时只移除本插件的类', () => {
    const classes = new Set<string>()
    let scroll: ScrollIntoViewOptions | null = null
    const target = {
      closest: () => null,
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
      },
      scrollIntoView: (options: ScrollIntoViewOptions) => {
        scroll = options
      },
    } as unknown as HTMLElement
    const oneHeading = { headings: [heading(2)] } satisfies CachedMetadata
    const view = preview([section('a.md', 0, 4, [target])])

    const revealed = revealPreviewLine(view, oneHeading, 'a.md', 2)
    expect(revealed).toBe(target)
    expect(classes.has(PREVIEW_HIGHLIGHT_CLASS)).toBe(true)
    expect(scroll).toEqual({ block: 'center', inline: 'nearest' })

    clearPreviewHighlight(revealed)
    expect(classes.has(PREVIEW_HIGHLIGHT_CLASS)).toBe(false)
  })
})
