import { afterEach, describe, expect, it, vi } from 'vitest'
import OutlineMindmapPlugin from '../src/main'
import { MindmapView } from '../src/view/MindmapView'
import { MarkdownView, WorkspaceLeaf, TFile } from './obsidian-runtime'

const plugins: OutlineMindmapPlugin[] = []
afterEach(() => { for (const plugin of plugins.splice(0)) plugin.unload() })

async function setup() {
  const app: any = { vault: { on: vi.fn() }, workspace: {
    on: vi.fn(), revealLeaf: vi.fn(async () => {}), getLeavesOfType: () => [],
  } }
  const plugin = new OutlineMindmapPlugin(app)
  plugins.push(plugin)
  await plugin.onload()
  const leaf: any = new WorkspaceLeaf(app)
  const file: any = new TFile('note.md')
  const markdown = new MarkdownView(leaf)
  markdown.file = file
  leaf.view = markdown
  leaf.setViewState = vi.fn(async (state: any, ephemeral: unknown) => {
    if (state.type === 'outline-mindmap') {
      leaf.view = new MindmapView(leaf, plugin)
      await leaf.view.setState(state.state, {})
    } else {
      leaf.view = new MarkdownView(leaf)
      leaf.view.file = file
    }
    if (ephemeral) leaf.setEphemeralState(ephemeral)
  })
  plugin.openAs.remember(file.path, 'source')
  const state = { match: { content: '# word', matches: [[2, 6]] } }
  return { plugin: plugin as any, leaf, file, state, markdown }
}

describe('native search -> remembered mindmap routing', () => {
  it('retains search matches that MarkdownView does not return from getEphemeralState', async () => {
    const s = await setup()
    s.leaf.setEphemeralState(s.state)
    await vi.waitFor(() => expect(s.leaf.view).toBeInstanceOf(MindmapView))
    expect(s.markdown.getEphemeralState()).toEqual({})
    expect(s.leaf.view.getEphemeralState()).toEqual(s.state)
    expect(s.leaf.setViewState).toHaveBeenCalledWith(expect.objectContaining({ popstate: true }), s.state)
  })
  it('does not convert a note that has no remembered map preference', async () => {
    const s = await setup()
    s.plugin.openAs.forget(s.file.path)
    s.leaf.setEphemeralState(s.state)
    await Promise.resolve()
    expect(s.leaf.view).toBe(s.markdown)
    expect(s.leaf.setViewState).not.toHaveBeenCalled()
  })
  it('opening the original keeps the preference and prevents immediate automatic reconversion', async () => {
    const s = await setup()
    await s.plugin.openSearchResult(s.leaf, s.file, s.state)
    expect(s.plugin.openAs.isMindmap(s.file.path)).toBe(true)
    await s.plugin.replay(s.leaf)
    expect(s.leaf.view).toBeInstanceOf(MarkdownView)
    expect(s.leaf.setViewState).toHaveBeenCalledTimes(1)
    // Explicit conversion still works in that tab.
    await s.plugin.openAsMindmap(s.file, s.leaf)
    expect(s.leaf.view).toBeInstanceOf(MindmapView)
  })
  it('unloading before the microtask cannot convert a note later', async () => {
    const s = await setup()
    s.leaf.setEphemeralState(s.state)
    s.plugin.unload()
    plugins.splice(plugins.indexOf(s.plugin), 1)
    await Promise.resolve()
    expect(s.leaf.setViewState).not.toHaveBeenCalled()
  })
  it('does not apply a previous file search to the next file in a reused tab', async () => {
    const s = await setup()
    s.leaf.setEphemeralState(s.state)
    const next: any = new TFile('next.md')
    s.markdown.file = next
    s.plugin.openAs.remember(next.path, 'source')
    await vi.waitFor(() => expect(s.leaf.view).toBeInstanceOf(MindmapView))
    expect(s.leaf.view.getEphemeralState()).toEqual({})
    expect(s.leaf.view.getState()).toMatchObject({ pinned: true })
  })
})
