/**
 * 顶部工具栏（M7）。主页面与侧边栏两种形态共用同一个 MindmapView，工具栏自然也共用。
 *
 * 两条约束：
 * - 【不抢键盘焦点】。焦点一旦落到按钮上，M5 那条「全键盘」链路就断了，
 *   所以 pointerdown 一律 preventDefault，动作跑完还要 afterAction() 把焦点还给画布。
 * - 【事件委托】。整条工具栏只挂 2 个监听器，按钮做什么写在 data-action 上。
 */

import { Menu, setIcon } from 'obsidian'
import { LAYOUT_DIRECTIONS } from '../layout'
import type { LayoutDirection } from '../layout/types'

/** 工具栏需要的视图能力。视图不把自己整个交出去，只交出这几件事。 */
export interface ToolbarHooks {
  fit(): void
  zoom(factor: number): void
  expandAll(): void
  collapseAll(): void
  direction(): LayoutDirection
  setDirection(dir: LayoutDirection): void
  /** 打开样式窗口（M8）。 */
  openStyle(): void
  /** 每个动作之后把键盘焦点还给画布。 */
  afterAction(): void
}

/** 一次点击的缩放倍率。与滚轮缩放的手感无关，按钮要「一下就看得出变化」。 */
const ZOOM_STEP = 1.25

/**
 * 布局方向的中文名。写成 Record 而不是数组：往 LayoutDirection 里加一项时，
 * 忘了补名字会直接编译不过，不会悄悄漏一项。
 */
const DIRECTION_LABELS: Record<LayoutDirection, string> = {
  right: '分支向右',
  left: '分支向左',
  both: '分支两侧',
}

interface ButtonSpec {
  action: string
  icon: string
  label: string
}

const BUTTONS: readonly ButtonSpec[] = [
  { action: 'fit', icon: 'maximize', label: '适应画布' },
  { action: 'zoom-out', icon: 'zoom-out', label: '缩小' },
  { action: 'zoom-in', icon: 'zoom-in', label: '放大' },
  { action: 'layout', icon: 'git-branch', label: '布局' },
  { action: 'expand', icon: 'chevrons-up-down', label: '展开全部' },
  { action: 'collapse', icon: 'chevrons-down-up', label: '折叠全部' },
  { action: 'style', icon: 'palette', label: '样式设置' },
]

export class Toolbar {
  readonly el: HTMLElement

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
    const btn = this.el.createDiv({ cls: 'om-tool' })
    btn.dataset['action'] = spec.action
    // Obsidian 用 aria-label 显示气泡提示，顺便也是无障碍名字
    btn.setAttribute('aria-label', spec.label)
    setIcon(btn, spec.icon)
    return btn
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
      case 'layout':
        this.openLayoutMenu(e)
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

  private openLayoutMenu(e: MouseEvent): void {
    const menu = new Menu()
    const current = this.hooks.direction()
    for (const dir of LAYOUT_DIRECTIONS) {
      menu.addItem((item) =>
        item
          .setTitle(DIRECTION_LABELS[dir])
          .setChecked(dir === current)
          .onClick(() => {
            this.hooks.setDirection(dir)
            this.hooks.afterAction()
          }),
      )
    }
    menu.showAtMouseEvent(e)
  }
}
