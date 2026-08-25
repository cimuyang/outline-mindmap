/**
 * 节点 DOM 的创建与复用。绝对定位 div + 复用池。
 *
 * 【不要每帧重建 DOM】——节点元素只按 id 认领与归还，属性只在真的变了的时候写。
 * 【不要挂 500 个监听器】——这里一个监听器都不挂，事件由 MindmapView 委托到容器上。
 */

import type { MindNode } from '../core/types'
import { sideOf, type NodeSide } from '../layout'
import type { Box, LayoutResult } from '../layout/types'
import { parseInline, tagsFor } from './inline'

interface Slot {
  el: HTMLElement
  textEl: HTMLElement
  toggleEl: HTMLElement
  /** 上一次写进去的值，用来跳过没必要的 DOM 写入。null = 还没写过。 */
  text: string | null
  transform: string
  w: number
  h: number
  hasToggle: boolean
  collapsed: boolean
  /** 节点朝左生长（M9）：折叠按钮要挪到左边去。 */
  left: boolean
  selected: boolean
  dragging: boolean
  dropInto: boolean
  /** 这一帧刚从池子里认领出来。见 update() 里关掉过渡的那一段。 */
  fresh: boolean
  /** 当前正压着 `transition: none`。记在这里，免得每帧去读一次 el.style。 */
  noTransition: boolean
}

export class NodeRenderer {
  private readonly active = new Map<string, Slot>()
  private readonly pool: Slot[] = []
  /**
   * 拖拽视觉状态存在这里，而不是由 DragController 直接改 DOM 的 class。
   *
   * 节点元素是【复用】的：拖拽中途来一次重绘，元素可能已经归还给另一个节点，
   * 外面挂上去的 class 就会留在错的节点上。状态在这一层，update 每次都会重新校准。
   */
  private dragging: ReadonlySet<string> = new Set()
  private dropInto: string | null = null
  /**
   * 这一帧新建的元素先攒在游离的 fragment 里，render 结束时【一次】插进图层（M10）。
   *
   * 首次渲染 1000 个节点就是 1000 次 appendChild，每一次都在一棵已经上屏的树上动土；
   * 攒起来一次插，浏览器只需要为它们做一遍样式解析。
   */
  private incoming: DocumentFragment | null = null

  constructor(private readonly layer: HTMLElement) {}

  /**
   * 把可见节点渲染到图层上。
   *
   * @param nodes 可见节点（文档序），来自 layout/visibleNodes
   * @param boxes 布局结果
   * @param selected 选中的节点 id（Ctrl+左键可多选，M6）
   * @param rootSide 根节点算哪一侧（M9）。它的父亲是虚拟 root，没有 Box 可比
   */
  render(
    nodes: MindNode[],
    boxes: LayoutResult,
    selected: ReadonlySet<string>,
    rootSide: NodeSide = 'right',
  ): void {
    const keep = new Set<string>()

    for (const node of nodes) {
      const box = boxes.get(node.id)
      if (!box) continue
      keep.add(node.id)
      const slot = this.active.get(node.id) ?? this.acquire(node.id)
      const parentBox = node.parent ? boxes.get(node.parent.id) : undefined
      this.update(slot, node, box, selected.has(node.id), sideOf(box, parentBox, rootSide))
    }

    for (const [id, slot] of this.active) {
      if (!keep.has(id)) {
        this.active.delete(id)
        this.release(slot)
      }
    }

    // 新建的元素统一在这里上屏。放在最后：位置、文字、class 都写完了才进 DOM，
    // 浏览器就不必为每个元素各算一次样式
    if (this.incoming) {
      this.layer.appendChild(this.incoming)
      this.incoming = null
    }
  }

  /**
   * 拖拽视觉：`dragging` 是被拖走的整棵子树（置灰），`into` 是「放进它里面」的那个目标。
   *
   * 只动真正变了的那几个元素——拖拽中每帧都会调到这里，不能是 O(n) 的 DOM 写入。
   */
  setDragVisual(dragging: ReadonlySet<string>, into: string | null): void {
    for (const id of this.dragging) if (!dragging.has(id)) this.applyDragging(id, false)
    for (const id of dragging) if (!this.dragging.has(id)) this.applyDragging(id, true)
    this.dragging = dragging

    if (this.dropInto !== into) {
      if (this.dropInto !== null) this.applyDropInto(this.dropInto, false)
      if (into !== null) this.applyDropInto(into, true)
      this.dropInto = into
    }
  }

  destroy(): void {
    for (const slot of this.active.values()) slot.el.remove()
    for (const slot of this.pool) slot.el.remove()
    this.active.clear()
    this.pool.length = 0
    this.incoming = null
    this.dragging = new Set()
    this.dropInto = null
  }

  // ── 内部 ────────────────────────────────────────────────────

  private acquire(id: string): Slot {
    const slot = this.pool.pop() ?? this.create()
    slot.el.dataset['nodeId'] = id
    slot.el.removeClass('is-hidden')
    slot.fresh = true
    this.active.set(id, slot)
    return slot
  }

  private release(slot: Slot): void {
    // 留在 DOM 里但隐藏。反复展开/折叠时能直接复用，不必重新创建。
    slot.el.addClass('is-hidden')
    delete slot.el.dataset['nodeId']
    this.pool.push(slot)
  }

  private create(): Slot {
    const el = createDiv({ cls: 'om-node' })
    const textEl = el.createDiv({ cls: 'om-node-text' })
    // 折叠按钮朝着子节点那一侧（分支向右 → 右侧，向左 → 左侧），点击区靠 CSS 撑大
    const toggleEl = el.createDiv({ cls: 'om-toggle' })
    this.incoming ??= createFragment()
    this.incoming.appendChild(el)
    return {
      el,
      textEl,
      toggleEl,
      text: null, // 还没写过任何文字，保证首次一定写入
      transform: '',
      w: -1,
      h: -1,
      // 下面几项必须如实反映刚创建出来的 DOM 状态，否则首次 update 会误判「没变」而跳过写入。
      // 折叠按钮此刻是可见的 → true，叶子节点第一次渲染时才会真正被隐藏。
      hasToggle: true,
      collapsed: false,
      left: false,
      selected: false,
      dragging: false,
      dropInto: false,
      fresh: false,
      noTransition: false,
    }
  }

  /**
   * 把内联 Markdown 建成真实 DOM 填进节点文字区。
   *
   * 用 createEl + textContent 而不是 innerHTML：笔记里的 `<script>`、
   * `<img onerror=…>` 到了 textContent 就只是字符（陷阱 13），
   * 不存在「哪天漏了一次转义」这种可能。
   */
  private static renderTextInto(host: HTMLElement, text: string): void {
    host.empty()
    for (const seg of parseInline(text)) {
      // 内层在前、外层在后，所以从后往前套：strong > em > mark > s > span.om-link > 文字
      let target = host
      for (const { tag, cls } of tagsFor(seg).reverse()) {
        target = target.createEl(tag, cls ? { cls } : undefined)
      }
      target.setText(seg.text)
    }
  }

  private applyDragging(id: string, on: boolean): void {
    const slot = this.active.get(id)
    if (!slot || slot.dragging === on) return
    slot.el.classList.toggle('is-dragging', on)
    slot.dragging = on
  }

  private applyDropInto(id: string, on: boolean): void {
    const slot = this.active.get(id)
    if (!slot || slot.dropInto === on) return
    slot.el.classList.toggle('is-drop-into', on)
    slot.dropInto = on
  }

  private update(slot: Slot, node: MindNode, box: Box, selected: boolean, side: NodeSide): void {
    // 「优雅动画」开着时，节点位置的变化会走 CSS 过渡（M9 的布局切换动画就是它）。
    // 但刚认领的元素不能过渡：新出现的节点会从原点飞进来，池子里回收来的还会
    // 带着上一个节点的位置横穿整个画面。这一帧先把过渡关掉，下一帧再交还给 CSS。
    if (slot.fresh) {
      slot.fresh = false
      slot.noTransition = true
      slot.el.setCssStyles({ transition: 'none' })
    } else if (slot.noTransition) {
      slot.noTransition = false
      slot.el.setCssStyles({ transition: '' })
    }

    if (slot.text !== node.text) {
      NodeRenderer.renderTextInto(slot.textEl, node.text)
      slot.text = node.text
    }

    const transform = `translate(${box.x}px, ${box.y}px)`
    // 三项一起写：都变了的时候（新节点、文字改动引起的重排）只碰一次 style
    if (slot.transform !== transform || slot.w !== box.w || slot.h !== box.h) {
      slot.el.setCssStyles({ transform, width: `${box.w}px`, height: `${box.h}px` })
      slot.transform = transform
      slot.w = box.w
      slot.h = box.h
    }

    const hasToggle = node.children.length > 0
    if (slot.hasToggle !== hasToggle) {
      slot.toggleEl.toggleClass('is-hidden', !hasToggle)
      slot.hasToggle = hasToggle
    }
    if (hasToggle && slot.collapsed !== node.collapsed) {
      slot.toggleEl.classList.toggle('is-collapsed', node.collapsed)
      slot.collapsed = node.collapsed
    }
    const left = side === 'left'
    if (slot.left !== left) {
      slot.el.classList.toggle('is-left', left)
      slot.left = left
    }
    if (slot.selected !== selected) {
      slot.el.classList.toggle('is-selected', selected)
      slot.selected = selected
    }

    // 复用池给出的元素可能带着上一个节点的拖拽 class，每次都按当前状态校准一次
    const dragging = this.dragging.has(node.id)
    if (slot.dragging !== dragging) {
      slot.el.classList.toggle('is-dragging', dragging)
      slot.dragging = dragging
    }
    const dropInto = this.dropInto === node.id
    if (slot.dropInto !== dropInto) {
      slot.el.classList.toggle('is-drop-into', dropInto)
      slot.dropInto = dropInto
    }
  }
}
