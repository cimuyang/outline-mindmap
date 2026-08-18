/**
 * 拖拽重排（M6）。
 *
 * 职责边界：本文件只负责【把指针的位置翻译成一个落点】，以及落点的视觉反馈。
 * 真正的结构变更走的还是 core/tree.ts 的 `moveSubtree` —— 跨 6/7 层的
 * 标题 ↔ 列表转换、正文跟随、分隔空行处理，全在那边（附录 A.7.4、A.8），
 * 这里一行都不重复。
 *
 * 落点判定与合法性判定是【纯函数】（hitTest / resolveDrop / isSamePosition），
 * 拆出来是为了能脱离 DOM 单测——「不能拖到自己的子树里」这类规则不该靠手工点来验。
 *
 * 监听器共 4 个，全挂在节点图层上（事件委托，与节点数量无关）。
 */

import type { MindNode, MindTree } from '../core/types'
import type { Box, LayoutResult } from '../layout/types'
import type { Canvas } from './Canvas'

/** 落在目标节点的哪个区域。'into' = 成为它的最后一个子节点。 */
export type DropZone = 'before' | 'after' | 'into'

/** `id === null` 表示落在画布空白处 → 新的自由根节点。 */
export interface DropTarget {
  id: string | null
  zone: DropZone
}

/** 落点解析结果，可直接喂给 `moveSubtree`。 */
export interface DropResult {
  parentId: string | null
  index: number
}

/** 节点上下边缘各 30% 判为「插到前 / 后」，中间 40% 判为「成为子节点」。 */
const EDGE_RATIO = 0.3
/** 指针离最近节点超过这个距离（布局坐标）就算落在空白处。留一点容差，免得落在兄弟间隙里就变成建根。 */
const HIT_TOLERANCE = 12
/** 指针移动超过这个距离才算拖拽，否则仍是一次单击。 */
const DRAG_THRESHOLD = 4

// ── 纯函数：落点判定 ─────────────────────────────────────────────

/** 点到矩形的距离；点在矩形内为 0。 */
function rectDistance(box: Box, x: number, y: number): number {
  const dx = Math.max(box.x - x, 0, x - (box.x + box.w))
  const dy = Math.max(box.y - y, 0, y - (box.y + box.h))
  return Math.hypot(dx, dy)
}

function zoneOf(box: Box, y: number): DropZone {
  const r = box.h > 0 ? (y - box.y) / box.h : 0.5
  if (r < EDGE_RATIO) return 'before'
  if (r > 1 - EDGE_RATIO) return 'after'
  return 'into'
}

/**
 * 布局坐标 → 落点。
 *
 * @param order 可见节点 id（文档序）。任意两个节点的矩形不重叠（M3 的验收保证过），
 *   所以一旦命中就可以直接返回，不必比完所有节点。
 */
export function hitTest(
  order: readonly string[],
  boxes: LayoutResult,
  x: number,
  y: number,
): DropTarget {
  let bestId: string | null = null
  let bestBox: Box | null = null
  let bestDist = Infinity

  for (const id of order) {
    const box = boxes.get(id)
    if (!box) continue
    const d = rectDistance(box, x, y)
    if (d < bestDist) {
      bestDist = d
      bestId = id
      bestBox = box
    }
    if (d === 0) break
  }

  if (bestId === null || bestBox === null || bestDist > HIT_TOLERANCE) {
    return { id: null, zone: 'into' }
  }
  return { id: bestId, zone: zoneOf(bestBox, y) }
}

function isDescendantOf(node: MindNode, maybeAncestor: MindNode): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (p === maybeAncestor) return true
  }
  return false
}

/**
 * 落点 → `moveSubtree` 的参数。非法落点返回 null。
 *
 * 非法的只有一类：目标是被拖节点自身或它的后代（附录 A.7.4 第 1 步）。
 * 这里返回 null 而不是抛错，是因为【拖拽过程中就要把这种落点标成不可选】——
 * 等松手了才报错，用户已经白拖了一趟。
 *
 * `index` 一律是【剔除被拖节点之后】的兄弟数组下标，与 `moveSubtree` 的约定一致。
 */
export function resolveDrop(tree: MindTree, dragId: string, target: DropTarget): DropResult | null {
  const node = tree.byId.get(dragId)
  if (!node) return null

  // 画布空白 → 成为最后一个自由根
  if (target.id === null) {
    return { parentId: null, index: tree.root.children.filter((c) => c !== node).length }
  }

  const t = tree.byId.get(target.id)
  if (!t || t === node || isDescendantOf(t, node)) return null

  if (target.zone === 'into') {
    return { parentId: t.id, index: t.children.filter((c) => c !== node).length }
  }

  const parent = t.parent
  if (!parent) return null
  const siblings = parent.children.filter((c) => c !== node)
  const i = siblings.indexOf(t)
  if (i < 0) return null
  return {
    parentId: parent.depth > 0 ? parent.id : null,
    index: target.zone === 'before' ? i : i + 1,
  }
}

/**
 * 落点与节点当前位置完全相同 → 这次拖拽什么都不该做。
 *
 * `moveSubtree` 对原地移动是幂等的（有测试），但仍会产生一次写入和一次可撤销的变更。
 * 手一抖把节点拖起来又放回原处，不该在笔记的撤销栈里留下一格。
 */
export function isSamePosition(tree: MindTree, dragId: string, result: DropResult): boolean {
  const node = tree.byId.get(dragId)
  const parent = node?.parent
  if (!node || !parent) return false
  if ((parent.depth > 0 ? parent.id : null) !== result.parentId) return false
  // result.index 是【剔除本节点之后】的下标：把它从 children 里抽掉再插回原下标，就是原地。
  return result.index === parent.children.indexOf(node)
}

// ── 控制器 ──────────────────────────────────────────────────────

export interface DragHooks {
  canvas: Canvas
  tree: () => MindTree | null
  boxes: () => LayoutResult
  /** 可见节点 id，文档序。 */
  order: () => readonly string[]
  /** 编辑态下不允许拖拽。 */
  enabled: () => boolean
  /** 松手且落点合法时调用。 */
  onDrop: (dragId: string, result: DropResult) => void
  /** 拖拽视觉：被拖走的整棵子树（置灰）、当前「成为其子节点」的目标（高亮）。 */
  onVisual: (dragging: ReadonlySet<string>, into: string | null) => void
}

export class DragController {
  private readonly indicator: HTMLElement
  private readonly empty: ReadonlySet<string> = new Set()

  private pointerId: number | null = null
  private candidate: string | null = null
  private dragId: string | null = null
  /** 被拖走的整棵子树。开始时算一次，拖拽过程中不会变。 */
  private draggingIds: ReadonlySet<string> = new Set()
  private startX = 0
  private startY = 0
  /** 视口矩形在一次拖拽内不会变，开始时读一次就够——绝不逐节点、逐帧读。 */
  private rect: DOMRect | null = null
  private target: DropTarget = { id: null, zone: 'into' }
  private result: DropResult | null = null
  /** 刚刚拖完，紧随其后的那次 click 不该再触发选中与跳转。 */
  private dragged = false
  private frame: number | null = null
  private pending: { x: number; y: number } | null = null

  constructor(
    private readonly layer: HTMLElement,
    private readonly hooks: DragHooks,
  ) {
    this.indicator = hooks.canvas.content.createDiv({ cls: 'om-drop' })
    this.indicator.style.display = 'none'
    layer.addEventListener('pointerdown', this.onPointerDown)
    layer.addEventListener('pointermove', this.onPointerMove)
    layer.addEventListener('pointerup', this.onPointerUp)
    layer.addEventListener('pointercancel', this.onPointerCancel)
  }

  destroy(): void {
    this.reset()
    this.layer.removeEventListener('pointerdown', this.onPointerDown)
    this.layer.removeEventListener('pointermove', this.onPointerMove)
    this.layer.removeEventListener('pointerup', this.onPointerUp)
    this.layer.removeEventListener('pointercancel', this.onPointerCancel)
    this.indicator.remove()
  }

  get active(): boolean {
    return this.dragId !== null
  }

  /** Esc / 视图关闭：放弃这次拖拽，什么都不写。 */
  cancel(): void {
    if (!this.active) return
    this.reset()
  }

  /**
   * 「刚才那下是拖拽吗」——供 click 处理器询问一次。
   * 拖完松手浏览器还会补一个 click，不吃掉它就会顺手跳转到笔记里去。
   */
  consumeClick(): boolean {
    const was = this.dragged
    this.dragged = false
    return was
  }

  // ── 事件 ────────────────────────────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.pointerId !== null || !this.hooks.enabled()) return
    const el = (e.target as HTMLElement).closest('.om-node') as HTMLElement | null
    // 折叠按钮是它自己的点击区，不能一按就被当成要拖动
    if (!el || (e.target as HTMLElement).closest('.om-toggle')) return
    const id = el.dataset['nodeId']
    if (!id) return

    this.pointerId = e.pointerId
    this.candidate = id
    this.startX = e.clientX
    this.startY = e.clientY
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.pointerId !== e.pointerId) return
    if (!this.dragId) {
      const moved = Math.abs(e.clientX - this.startX) + Math.abs(e.clientY - this.startY)
      if (moved < DRAG_THRESHOLD) return
      if (!this.begin()) return
    }
    // 每帧只算一次落点：pointermove 可能一秒来上百个
    this.pending = { x: e.clientX, y: e.clientY }
    if (this.frame === null) {
      this.frame = requestAnimationFrame(() => {
        this.frame = null
        this.update()
      })
    }
  }

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.pointerId !== e.pointerId) return
    const dragId = this.dragId
    const result = this.result
    const dragging = dragId !== null
    this.reset()
    if (!dragging || !dragId) return
    this.dragged = true
    if (result) this.hooks.onDrop(dragId, result)
  }

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (this.pointerId !== e.pointerId) return
    this.reset()
  }

  // ── 内部 ────────────────────────────────────────────────────

  private begin(): boolean {
    const id = this.candidate
    const tree = this.hooks.tree()
    const node = id === null ? null : tree?.byId.get(id)
    if (!id || !node) return false

    this.dragId = id
    this.rect = this.hooks.canvas.viewportRect()
    if (this.pointerId !== null && !this.layer.hasPointerCapture(this.pointerId)) {
      this.layer.setPointerCapture(this.pointerId)
    }
    this.hooks.canvas.viewport.classList.add('is-dragging')
    // 焦点收回导图：拖拽中按 Esc 要能取消（键盘在 MindmapView 上）
    this.hooks.canvas.focus()
    this.draggingIds = subtreeIds(node)
    this.hooks.onVisual(this.draggingIds, null)
    return true
  }

  /** 指针位置 → 落点 → 指示线。这是拖拽过程里唯一会跑的计算。 */
  private update(): void {
    const p = this.pending
    const tree = this.hooks.tree()
    const dragId = this.dragId
    if (!p || !tree || !dragId || !this.rect) return

    const { x, y } = this.hooks.canvas.toContent(this.rect, p.x, p.y)
    this.target = hitTest(this.hooks.order(), this.hooks.boxes(), x, y)
    const result = resolveDrop(tree, dragId, this.target)
    // 原地放下不算一次移动，指示线照常给——用户看得见「放回原处」是有效操作
    this.result = result && isSamePosition(tree, dragId, result) ? null : result
    this.paint(result !== null)
  }

  private paint(valid: boolean): void {
    const vp = this.hooks.canvas.viewport
    const t = this.target
    // 非法落点：不画指示线 + 光标变禁止符，落点在视觉上就是不可选的
    vp.classList.toggle('is-drop-invalid', !valid)
    vp.classList.toggle('is-drop-root', valid && t.id === null)

    const box = valid && t.id !== null ? this.hooks.boxes().get(t.id) : undefined
    this.hooks.onVisual(this.draggingIds, box && t.zone === 'into' ? t.id : null)
    if (!box) {
      this.indicator.style.display = 'none'
      return
    }

    const into = t.zone === 'into'
    this.indicator.style.display = ''
    this.indicator.classList.toggle('is-into', into)
    const y = t.zone === 'after' ? box.y + box.h : box.y
    this.indicator.style.transform = `translate(${box.x}px, ${into ? box.y : y}px)`
    this.indicator.style.width = `${box.w}px`
    this.indicator.style.height = into ? `${box.h}px` : '0px'
  }

  private reset(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame)
      this.frame = null
    }
    if (this.pointerId !== null && this.layer.hasPointerCapture(this.pointerId)) {
      this.layer.releasePointerCapture(this.pointerId)
    }
    if (this.dragId) this.hooks.onVisual(this.empty, null)
    const vp = this.hooks.canvas.viewport
    vp.classList.remove('is-dragging', 'is-drop-invalid', 'is-drop-root')
    this.indicator.style.display = 'none'
    this.pointerId = null
    this.candidate = null
    this.dragId = null
    this.draggingIds = this.empty
    this.rect = null
    this.result = null
    this.pending = null
    this.target = { id: null, zone: 'into' }
  }
}

/** 节点自身 + 全部后代的 id。拖拽时整棵子树一起置灰——它们是跟着走的。 */
export function subtreeIds(node: MindNode): Set<string> {
  const out = new Set<string>()
  const walk = (n: MindNode): void => {
    out.add(n.id)
    for (const c of n.children) walk(c)
  }
  walk(node)
  return out
}
