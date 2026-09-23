import { vi } from 'vitest'
import { FakeElement } from './fake-dom'

export const renderMath = vi.fn((source: string, display: boolean): HTMLElement => {
  if (source === String.raw`\bad`) throw new Error('invalid formula')
  const el = new FakeElement(display ? 'div' : 'span')
  el.appendText(`⟦${source}⟧`)
  return el as unknown as HTMLElement
})

export const finishRenderMath = vi.fn(async (): Promise<void> => {})

export class TFile {
  constructor(public path = 'test.md') {}
}
export class Component {
  cleanups: (() => void)[] = []
  register(fn: () => void): void { this.cleanups.push(fn) }
  registerEvent(_event: unknown): void {}
  unload(): void { for (const fn of this.cleanups.reverse()) fn() }
}
export class ItemView extends Component {
  app: any
  contentEl = new FakeElement()
  constructor(public leaf: any) { super(); this.app = leaf.app }
  getState(): Record<string, unknown> { return {} }
  async setState(_state: unknown, _result: unknown): Promise<void> {}
  onPaneMenu(): void {}
}
export class FileView extends ItemView {
  file: TFile | null = null
}
export class MarkdownView extends FileView {
  editor: unknown = null
  constructor(leaf: any = { app: {} }) { super(leaf) }
  getMode(): string { return 'source' }
  setEphemeralState(_state: unknown): void {}
  getEphemeralState(): Record<string, unknown> { return {} }
}
export class WorkspaceLeaf {
  view: any
  constructor(public app: any) {}
  setEphemeralState(state: unknown): void { this.view.setEphemeralState(state) }
}
export class Plugin extends Component {
  constructor(public app: any) { super() }
  async loadData(): Promise<null> { return null }
  async saveData(_data: unknown): Promise<void> {}
  registerView(_type: string, _create: unknown): void {}
  registerEditorExtension(_extension: unknown): void {}
  registerMarkdownPostProcessor(_fn: unknown): void {}
  addSettingTab(_tab: unknown): void {}
  addRibbonIcon(..._args: unknown[]): void {}
  addCommand(_command: unknown): void {}
}
export class PluginSettingTab { constructor(..._args: unknown[]) {} }
export class Modal {}
export class Setting {}
export class Menu {}
export class Notice { constructor(public message: string) {} }
export const moment = { locale: () => 'zh' }
export const loadMathJax = async (): Promise<void> => {}
export const setIcon = (): void => {}
