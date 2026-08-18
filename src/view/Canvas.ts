/**
 * 平移 / 缩放 / 适应画布。
 *
 * 【只在容器上做一次 transform】——绝不逐节点改位置（第 2 章技术选型）。
 * 节点自身的 translate 是布局坐标，平移缩放只动它们的父层，两者互不干扰。
 *
 * 监听器一共 5 个，全挂在 viewport 上（pointerdown / pointermove / pointerup /
 * pointercancel / wheel），与节点数量无关。
 */

import type { Box } from '../layout/types'

const MIN_SCALE = 0.15
const MAX_SCALE = 4
/** 适应画布时四周留白。 */
const FIT_PADDING = 40
/** 适应画布不放大——内容很少时保持 100%，放大只会让人觉得糊。 */
const MAX_FIT_SCALE = 1
/** 视野跟随时目标离视口边缘的最小距离（M5 交付物写死 40px）。 */
const FOLLOW_MARGIN = 40
/**
 * 程序性定位（适应画布 / 居中）的动画时长，受「优雅动画」开关控制（M10）。
 *
 * 比节点自己的 140ms 略长：视野要走的距离通常比单个节点远得多，
 * 两者同时开跑时，视野稍慢一点看起来才像「镜头跟过去」而不是「画面被弹了一下」。
 */
const MOVE_MS = 180

export class Canvas {
  readonly viewport: HTMLElement
  readonly content: HTMLElement

  private tx = 0
  private ty = 0
  private scale = 1

  private dragging = false
  private lastX = 0
  private lastY = 0
  private width = 0
  private height = 0
  private readonly observer: ResizeObserver
  private frame: number | null = null
  /** 「优雅动画」开着吗（M10）。只影响程序性定位，手动平移/缩放永远是即时的。 */
  private animated = false
  /** 上一次写进 style 的 transition，避免每帧都往 DOM 里塞同一个字符串。 */
  private transition = ''

  /**
   * @param onResize 视口尺寸变化后的回调。视图刚打开时容器尺寸还是 0，
   *   「适应画布」得等这个回调来了才有意义。
   */
  constructor(host: HTMLElement, private readonly onResize?: () => void) {
    this.viewport = host.createDiv({ cls: 'om-viewport' })
    // 可聚焦：跳转到编辑器之后要把焦点收回来，M5 的快捷键也挂在这上面
    this.viewport.tabIndex = -1
    this.content = this.viewport.createDiv({ cls: 'om-content' })

    // 容器尺寸缓存下来，省得每次适应画布都去读 clientWidth（会触发重排）
    this.observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      const changed = rect.width !== this.width || rect.height !== this.height
      this.width = rect.width
      this.height = rect.height
      if (changed) this.onResize?.()
    })
    this.observer.observe(this.viewport)

    this.viewport.addEventListener('pointerdown', this.onPointerDown)
    this.viewport.addEventListener('pointermove', this.onPointerMove)
    this.viewport.addEventListener('pointerup', this.onPointerUp)
    this.viewport.addEventListener('pointercancel', this.onPointerUp)
    this.viewport.addEventListener('wheel', this.onWheel, { passive: false })
  }

  destroy(): void {
    this.observer.disconnect()
    this.viewport.removeEventListener('pointerdown', this.onPointerDown)
    this.viewport.removeEventListener('pointermove', this.onPointerMove)
    this.viewport.removeEventListener('pointerup', this.onPointerUp)
    this.viewport.removeEventListener('pointercancel', this.onPointerUp)
    this.viewport.removeEventListener('wheel', this.onWheel)
    if (this.frame !== null) cancelAnimationFrame(this.frame)
  }

  /** 「优雅动画」开关（M10）。视图每次绘制时对一下，改设置后下一次定位立即生效。 */
  setAnimated(on: boolean): void {
    this.animated = on
  }

  /**
   * 内容外接矩形 → 居中并缩放到看得全。
   *
   * @param animate 平滑移过去（还要「优雅动画」开着才算数）。首次适应画布必须传 false：
   *   那时候上一个位置是原点，动画会让整张图从左上角飞进来
   * @returns 是否真的执行了。容器尺寸还没量出来时返回 false，调用方应保留「待适应」标记。
   */
  fit(bounds: Box, animate = false): boolean {
    if (bounds.w <= 0 || bounds.h <= 0 || this.width <= 0 || this.height <= 0) return false
    const avail = { w: this.width - FIT_PADDING * 2, h: this.height - FIT_PADDING * 2 }
    const s = clamp(
      Math.min(avail.w / bounds.w, avail.h / bounds.h, MAX_FIT_SCALE),
      MIN_SCALE,
      MAX_SCALE,
    )
    this.scale = s
    this.tx = centerTranslate(bounds.x * s, bounds.w * s, this.width)
    this.ty = centerTranslate(bounds.y * s, bounds.h * s, this.height)
    this.applyNow(animate)
    return true
  }

  /**
   * 把一块内容摆到屏幕正中（M10：展开 / 折叠后的视野跟随）。
   *
   * 【只平移不缩放】。折叠一下就把用户调好的缩放比例改掉，比看不见还烦人；
   * 目标比视口还大时也照样居中——那时候中间那一段才是他刚操作的地方。
   */
  centerOn(box: Box, animate = false): void {
    if (this.width <= 0 || this.height <= 0) return
    this.tx = centerTranslate(box.x * this.scale, box.w * this.scale, this.width)
    this.ty = centerTranslate(box.y * this.scale, box.h * this.scale, this.height)
    this.applyNow(animate)
  }

  /**
   * 视口在屏幕上的矩形。拖拽时【开始读一次就够】，一次拖拽内它不会变——
   * 逐帧读会白白触发强制重排（陷阱 5 的同类问题）。
   */
  viewportRect(): DOMRect {
    return this.viewport.getBoundingClientRect()
  }

  /** 客户端坐标 → 布局坐标（撤掉本层的 translate 与 scale）。rect 由调用方缓存。 */
  toContent(rect: DOMRect, clientX: number, clientY: number): { x: number; y: number } {
    return {
      x: (clientX - rect.left - this.tx) / this.scale,
      y: (clientY - rect.top - this.ty) / this.scale,
    }
  }

  /** 把键盘焦点收到导图上。preventScroll：别让浏览器顺手滚动外层容器。 */
  focus(): void {
    this.viewport.focus({ preventScroll: true })
  }

  /**
   * 视野跟随（M5）：目标在屏幕外时【最小平移】把它带进来，四周留 margin。
   *
   * 只平移不缩放——新增一个节点就把用户的缩放比例改掉，比看不见还烦人。
   */
  ensureVisible(box: Box, margin = FOLLOW_MARGIN): void {
    if (this.width <= 0 || this.height <= 0) return
    const dx = shiftInto(
      box.x * this.scale + this.tx,
      (box.x + box.w) * this.scale + this.tx,
      this.width,
      margin,
    )
    const dy = shiftInto(
      box.y * this.scale + this.ty,
      (box.y + box.h) * this.scale + this.ty,
      this.height,
      margin,
    )
    if (dx !== 0 || dy !== 0) this.panBy(dx, dy)
  }

  zoomBy(factor: number): void {
    this.zoomAt(factor, this.width / 2, this.height / 2)
  }

  /** 以视口内某点为锚点缩放——鼠标底下的内容不动。 */
  zoomAt(factor: number, px: number, py: number): void {
    const next = clamp(this.scale * factor, MIN_SCALE, MAX_SCALE)
    if (next === this.scale) return
    const k = next / this.scale
    this.tx = px - (px - this.tx) * k
    this.ty = py - (py - this.ty) * k
    this.scale = next
    this.apply()
  }

  panBy(dx: number, dy: number): void {
    this.tx += dx
    this.ty += dy
    this.apply()
  }

  // ── 事件 ────────────────────────────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return
    // 点在节点上交给上层处理（M4 起要做选中与跳转）；
    // 点在编辑框里必须原样放行，否则指针捕获会抢走文本选择和光标定位
    if ((e.target as HTMLElement).closest('.om-node, .om-editor')) return
    // 点空白也算「我在用导图」——键盘焦点收过来，否则快捷键要先点一下节点才生效
    this.focus()
    this.dragging = true
    this.lastX = e.clientX
    this.lastY = e.clientY
    this.viewport.setPointerCapture(e.pointerId)
    this.viewport.addClass('is-panning')
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return
    this.panBy(e.clientX - this.lastX, e.clientY - this.lastY)
    this.lastX = e.clientX
    this.lastY = e.clientY
  }

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (!this.dragging) return
    this.dragging = false
    if (this.viewport.hasPointerCapture(e.pointerId)) {
      this.viewport.releasePointerCapture(e.pointerId)
    }
    this.viewport.removeClass('is-panning')
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      const rect = this.viewport.getBoundingClientRect() // 每次滚轮一次，不是每节点一次
      this.zoomAt(Math.exp(-e.deltaY / 400), e.clientX - rect.left, e.clientY - rect.top)
    } else {
      this.panBy(-e.deltaX, -e.deltaY)
    }
  }

  // ── 提交 ────────────────────────────────────────────────────

  /** 合并同一帧内的多次变换，避免拖拽时每个 pointermove 都写一次样式。 */
  private apply(): void {
    if (this.frame !== null) return
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      this.write(false)
    })
  }

  /**
   * 程序性定位【立刻】写，不等下一帧（M10：消除闪屏）。
   *
   * 节点的 DOM 是同步写完的，视口变换却等一帧的话，中间那一帧画的是
   * 「新内容 + 旧视野」——打开笔记时能看见整张图先出现在左上角再跳到中间。
   */
  private applyNow(animate: boolean): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame)
      this.frame = null
    }
    this.write(animate)
  }

  private write(animate: boolean): void {
    const transition = animate && this.animated ? `transform ${MOVE_MS}ms ease-out` : ''
    if (this.transition !== transition) {
      this.content.style.transition = transition
      this.transition = transition
    }
    this.content.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`
  }
}

/**
 * 一个轴上把长 `size` 的内容摆到 `viewSize` 正中所需的平移量。
 *
 * 输入都是【屏幕像素】（布局坐标已乘过 scale）。适应画布与居中共用它，
 * 免得同一个公式写两遍、改一处漏一处。
 */
export function centerTranslate(lo: number, size: number, viewSize: number): number {
  return (viewSize - size) / 2 - lo
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * 一个轴上把 [lo, hi] 挪进 [margin, size - margin] 所需的最小位移。已经在里面就返回 0。
 *
 * 目标比可视区还大时（超长节点 / 缩放很大）优先对齐起始边——
 * 看得见开头比看得见结尾有用。
 */
export function shiftInto(lo: number, hi: number, size: number, margin: number): number {
  const min = margin
  const max = size - margin
  if (hi - lo >= max - min) return lo > min || hi < max ? min - lo : 0
  if (lo < min) return min - lo
  if (hi > max) return max - hi
  return 0
}
