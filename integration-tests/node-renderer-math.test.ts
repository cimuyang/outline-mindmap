import { beforeEach, describe, expect, it } from 'vitest'
import type { MindNode } from '../src/core/types'
import type { LayoutResult } from '../src/layout/types'
import { NodeRenderer } from '../src/view/NodeRenderer'
import { FakeElement, findByClass, textOf } from './fake-dom'
import { finishRenderMath, renderMath } from './obsidian-runtime'

const globals = globalThis as unknown as {
  createDiv: (options?: { cls?: string }) => HTMLElement
  createFragment: () => DocumentFragment
}

globals.createDiv = (options) => {
  const el = new FakeElement('div')
  if (options?.cls) el.classList.add(options.cls)
  return el as unknown as HTMLElement
}
globals.createFragment = () => new FakeElement('#fragment', true) as unknown as DocumentFragment

function node(text: string): MindNode {
  return {
    id: 'n1',
    text,
    depth: 1,
    kind: 'heading',
    children: [],
    parent: null,
    titleLine: 0,
    bodyEnd: 1,
    blockStart: 0,
    blockEnd: 1,
    collapsed: false,
  }
}

const boxes: LayoutResult = new Map([
  ['n1', { x: 10, y: 20, w: 320, h: 54 }],
])

describe('NodeRenderer math integration', () => {
  it('highlights text across formatting without altering the rendered text or math', () => {
    const layer = new FakeElement('div')
    const renderer = new NodeRenderer(layer as unknown as HTMLElement)
    renderer.setSearch(new Map([['n1', ['**word** here']]]))
    renderer.render([node('**word** here $x$')], boxes, new Set())
    expect(textOf(findByClass(layer, 'om-node-text')[0]!)).toBe('word here ⟦x⟧')
    expect(findByClass(layer, 'om-search-match').map(textOf).join('')).toBe('word here')
    expect(findByClass(layer, 'is-search-match')).toHaveLength(1)
    renderer.setSearch(new Map())
    renderer.render([node('**word** here $x$')], boxes, new Set())
    expect(findByClass(layer, 'om-search-match')).toHaveLength(0)
    expect(findByClass(layer, 'is-search-match')).toHaveLength(0)
  })

  it('clears search decoration when a pooled element is reused for a different node', () => {
    const layer = new FakeElement('div')
    const renderer = new NodeRenderer(layer as unknown as HTMLElement)
    renderer.setSearch(new Map([['n1', ['word']]]))
    renderer.render([node('word')], boxes, new Set())
    renderer.render([], new Map(), new Set())
    renderer.render([{ ...node('word'), id: 'n2' }], new Map([['n2', boxes.get('n1')!]]), new Set())
    expect(findByClass(layer, 'om-search-match')).toHaveLength(0)
    expect(findByClass(layer, 'is-search-match')).toHaveLength(0)
  })

  beforeEach(() => {
    renderMath.mockClear()
    finishRenderMath.mockClear()
  })

  it('renders every math segment and flushes MathJax once per frame', () => {
    const layer = new FakeElement('div')
    const renderer = new NodeRenderer(layer as unknown as HTMLElement)

    renderer.render([node('前 $x^2$ + $y$ 后')], boxes, new Set())

    expect(renderMath).toHaveBeenNthCalledWith(1, 'x^2', false)
    expect(renderMath).toHaveBeenNthCalledWith(2, 'y', false)
    expect(finishRenderMath).toHaveBeenCalledTimes(1)
    expect(findByClass(layer, 'om-math')).toHaveLength(2)
    expect(textOf(findByClass(layer, 'om-node-text')[0] as FakeElement)).toBe('前 ⟦x^2⟧ + ⟦y⟧ 后')

    renderer.render([node('前 $x^2$ + $y$ 后')], boxes, new Set())
    expect(renderMath).toHaveBeenCalledTimes(2)
    expect(finishRenderMath).toHaveBeenCalledTimes(1)
  })

  it('keeps editable source when Obsidian rejects a formula', () => {
    const layer = new FakeElement('div')
    const renderer = new NodeRenderer(layer as unknown as HTMLElement)

    renderer.render([node(String.raw`坏公式：$\bad$`)], boxes, new Set())

    expect(renderMath).toHaveBeenCalledWith(String.raw`\bad`, false)
    expect(finishRenderMath).not.toHaveBeenCalled()
    expect(textOf(findByClass(layer, 'om-node-text')[0] as FakeElement)).toBe(String.raw`坏公式：$\bad$`)
  })
})
