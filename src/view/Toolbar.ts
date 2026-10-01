/**
 * 顶部工具栏（M7）。主页面与侧边栏两种形态共用同一个 MindmapView，工具栏自然也共用。
 *
 * 两条约束：
 * - 【不抢键盘焦点】。焦点一旦落到按钮上，M5 那条「全键盘」链路就断了，
 *   所以 pointerdown 一律 preventDefault，动作跑完还要 afterAction() 把焦点还给画布。
 * - 【事件委托】。整条工具栏只挂 2 个监听器，按钮做什么写在 data-action 上。
 */

import { setIcon } from 'obsidian'
import { t, type MsgKey } from '../i18n'

/** 工具栏需要的视图能力。视图不把自己整个交出去，只交出这几件事。 */
export interface ToolbarHooks {
  fit(): void
  zoom(factor: number): void
  expandAll(): void
  collapseAll(): void
  toggleLock(): void
  /** 打开样式窗口（M8）。 */
  openStyle(): void
  /** 每个动作之后把键盘焦点还给画布。 */
  afterAction(): void
}

/** 一次点击的缩放倍率。与滚轮缩放的手感无关，按钮要「一下就看得出变化」。 */
const ZOOM_STEP = 1.25

interface ButtonSpec {
  action: string
  icon: string
  label: MsgKey
}

const BUTTONS: readonly ButtonSpec[] = [
  { action: 'fit', icon: 'maximize', label: 'tool.fit' },
  { action: 'zoom-out', icon: 'zoom-out', label: 'tool.zoomOut' },
  { action: 'zoom-in', icon: 'zoom-in', label: 'tool.zoomIn' },
  { action: 'expand', icon: 'chevrons-up-down', label: 'tool.expand' },
  { action: 'collapse', icon: 'chevrons-down-up', label: 'tool.collapse' },
  { action: 'lock', icon: 'lock-open', label: 'tool.lock' },
  { action: 'style', icon: 'palette', label: 'tool.style' },
]

export class Toolbar {
  readonly el: HTMLElement
  private lock!: HTMLButtonElement

  constructor(
    host: HTMLElement,
    private readonly hooks: ToolbarHooks,
  ) {
    this.el = host.createDiv({ cls: 'om-toolbar' })
    for (const spec of BUTTONS) this.addButton(spec)

    this.el.addEventListener('pointerdown', this.onPointerDown)
    this.el.addEventListener('click', this.onClick)
  }

  destroy(): void {
    this.el.removeEventListener('pointerdown', this.onPointerDown)
    this.el.removeEventListener('click', this.onClick)
    this.el.remove()
  }

  private addButton(spec: ButtonSpec): HTMLElement {
    const btn = this.el.createEl('button', { cls: 'om-tool' })
    btn.type = 'button'
    if (spec.action === 'lock') this.lock = btn
    btn.dataset['action'] = spec.action
    // Obsidian 用 aria-label 显示气泡提示，顺便也是无障碍名字
    btn.setAttribute('aria-label', t(spec.label))
    setIcon(btn, spec.icon)
    return btn
  }

  setLocked(locked: boolean, forced: boolean, available: boolean): void {
    setIcon(this.lock, locked ? 'lock' : 'lock-open')
    this.lock.disabled = forced || !available
    this.lock.toggleClass('is-active', locked)
    this.lock.setAttribute('aria-pressed', String(locked))
    this.lock.setAttribute('aria-label', t(forced ? 'tool.readingLock' : locked ? 'tool.unlock' : 'tool.lock'))
  }

  /** 按下就阻止默认行为：否则浏览器会把焦点挪到按钮上，快捷键随即失效。 */
  private readonly onPointerDown = (e: PointerEvent): void => {
    e.preventDefault()
  }

  private readonly onClick = (e: MouseEvent): void => {
    const action = (e.target as HTMLElement).closest('.om-tool')?.getAttribute('data-action')
    if (!action) return

    switch (action) {
      case 'fit':
        this.hooks.fit()
        break
      case 'zoom-in':
        this.hooks.zoom(ZOOM_STEP)
        break
      case 'zoom-out':
        this.hooks.zoom(1 / ZOOM_STEP)
        break
      case 'expand':
        this.hooks.expandAll()
        break
      case 'collapse':
        this.hooks.collapseAll()
        break
      case 'lock':
        if (!this.lock.disabled) this.hooks.toggleLock()
        break
      case 'style':
        // 这里【不】走 afterAction：焦点得留给刚弹出来的窗口，
        // 抢回画布的话窗口里的 Esc / Tab 就不听使唤了。关窗时 Obsidian 会把焦点还回来。
        this.hooks.openStyle()
        return
      default:
        break
    }
    this.hooks.afterAction()
  }

}
