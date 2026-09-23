import { describe, expect, it, vi } from 'vitest'
import { MindmapView } from '../src/view/MindmapView'
import { parse } from '../src/core/parser'
import { FakeElement, findByClass, textOf } from './fake-dom'

function setup(content = '# Parent\n## word\nbody word\n# Other') {
  const host: any = { settings: { listNodes: true, strictLineBreak: false } }
  const view: any = new MindmapView({ app: {} } as any, host)
  view.ready = true
  view.file = { path: 'note.md' }
  view.tree = parse(content)
  view.searchBar = new FakeElement()
  view.nodeRenderer = { setSearch: vi.fn() }
  view.editor = { active: false, stop: vi.fn() }
  view.drag = { active: false, cancel: vi.fn() }
  view.canvas = { centerOn: vi.fn(() => true), focus: vi.fn(), fit: vi.fn(() => true) }
  view.bridge = { setFile: vi.fn(), historyStep: vi.fn(async () => 'ok') }
  view.resolveStyle = vi.fn()
  view.draw = vi.fn(() => {
    view.boxes = new Map([...view.tree?.byId.keys() ?? []].map((id: string) => [id, { x: 1, y: 2, w: 3, h: 4 }]))
  })
  const match = (word: string, last = false) => {
    const at = last ? content.lastIndexOf(word) : content.indexOf(word)
    return { match: { content, matches: [[at, at + word.length]] } }
  }
  return { view, content, match }
}

describe('MindmapView search and undo interactions', () => {
  it('retries search positioning after the initially hidden viewport becomes measurable', () => {
    const { view, match } = setup()
    view.canvas.centerOn.mockReturnValueOnce(false)
    view.setEphemeralState(match('word'))
    expect(view.searchFocusId).toBe(view.focusId)
    view.resizeCanvas()
    expect(view.canvas.centerOn).toHaveBeenCalledTimes(2)
    expect(view.canvas.centerOn).toHaveBeenLastCalledWith(view.boxes.get(view.focusId), true, 0.85)
    expect(view.searchFocusId).toBeNull()
    view.resizeCanvas()
    expect(view.canvas.centerOn).toHaveBeenCalledTimes(2)
  })
  it('rebuilds highlights when list nodes become body text without changing the source', () => {
    const { view, match } = setup('# Parent\n- word')
    view.setEphemeralState(match('word'))
    view.host.settings.listNodes = false
    view.refresh('# Parent\n- word')
    const parent = [...view.tree.byId.values()].find((n: any) => n.text === 'Parent') as any
    expect(view.nodeRenderer.setSearch).toHaveBeenLastCalledWith(new Map([[parent.id, []]]))
    expect(textOf(view.searchBar)).toContain('含正文')
    expect(view.focusId).toBe(parent.id)
  })
  it('cancels delayed positioning when highlights are cleared', () => {
    const { view, match } = setup()
    view.canvas.centerOn.mockReturnValue(false)
    view.setEphemeralState(match('word'))
    view.clearSearch()
    view.resizeCanvas()
    expect(view.canvas.centerOn).toHaveBeenCalledTimes(1)
    expect(view.getEphemeralState()).toEqual({})
  })
  it('reveals matches in multiple folded branches', () => {
    const content = '# One\n## hit\n# Two\n## hit'
    const { view } = setup(content)
    const parents = [...view.tree.byId.values()].filter((n: any) => n.depth === 1) as any[]
    for (const parent of parents) parent.collapsed = true
    const a = content.indexOf('hit'), b = content.lastIndexOf('hit')
    view.setEphemeralState({ match: { content, matches: [[a, a + 3], [b, b + 3]] } })
    expect(parents.every(parent => !parent.collapsed)).toBe(true)
    expect(view.nodeRenderer.setSearch.mock.lastCall[0].size).toBe(2)
  })
  it('expands ancestors, selects and centers the actual match, including repeated same-file navigation', () => {
    const { view, match } = setup()
    const parent = [...view.tree.byId.values()].find((n: any) => n.text === 'Parent') as any
    parent.collapsed = true
    view.setEphemeralState(match('word'))
    expect(parent.collapsed).toBe(false)
    expect(view.tree.byId.get(view.focusId).text).toBe('word')
    expect(view.nodeRenderer.setSearch).toHaveBeenLastCalledWith(new Map([[view.focusId, ['word']]]))
    view.setEphemeralState(match('Other'))
    expect(view.tree.byId.get(view.focusId).text).toBe('Other')
    expect(view.canvas.centerOn).toHaveBeenCalledTimes(2)
  })
  it('maps a body hit to its owner without falsely marking the same word in its title', () => {
    const { view, match } = setup()
    view.setEphemeralState(match('word', true))
    expect(view.nodeRenderer.setSearch).toHaveBeenLastCalledWith(new Map([[view.focusId, []]]))
    expect(textOf(view.searchBar)).toContain('含正文')
    expect(textOf(view.searchBar)).toContain('查看原文')
    expect(findByClass(view.searchBar, 'om-search-match').map(textOf)).toEqual(['word'])
  })
  it('defers search until the tree loads, clears it on file switch or content changes', () => {
    const { view, content, match } = setup()
    view.tree = null
    view.setEphemeralState(match('word'))
    expect(view.canvas.centerOn).not.toHaveBeenCalled()
    view.refresh(content)
    expect(view.canvas.centerOn).toHaveBeenCalledTimes(1)
    view.refresh(content + '\nchanged')
    expect(view.getEphemeralState()).toEqual({})
    view.refresh(content)
    view.setEphemeralState(match('word'))
    view.adoptFile({ path: 'other.md' })
    expect(view.getEphemeralState()).toEqual({})
    expect(view.nodeRenderer.setSearch).toHaveBeenLastCalledWith(new Map())
  })
  it('does not focus a guessed node for a stale search', () => {
    const { view, match } = setup()
    view.tree = parse('# changed\n## word')
    view.setEphemeralState(match('word'))
    expect(view.canvas.centerOn).not.toHaveBeenCalled()
    expect(view.getEphemeralState()).toEqual({})
  })
  it('routes Ctrl/Cmd-Z, Shift-Z and Y; leaves inline-editor undo untouched', async () => {
    const { view } = setup()
    const send = (key: string, shiftKey = false, metaKey = false) => {
      const e = { key, shiftKey, metaKey, ctrlKey: !metaKey, altKey: false,
        preventDefault: vi.fn(), stopPropagation: vi.fn() }
      view.onKeyDown(e)
      return e
    }
    send('z'); send('Z', true, true); send('y')
    await Promise.resolve()
    expect(view.bridge.historyStep.mock.calls.map((c: any[]) => c[1])).toEqual(['undo', 'redo', 'redo'])
    view.editor.active = true
    const e = send('z')
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(view.bridge.historyStep).toHaveBeenCalledTimes(3)
  })
})
