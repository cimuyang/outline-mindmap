/**
 * 导图视图。M5 起可编辑。
 *
 * 数据流（第 4.1 节，单向）：
 *   文件内容 → parse → reconcile（保住 id / 折叠态）→ layout → DOM
 *
 * 【编辑走的是同一条单向流】，只是把「等文件事件回来」换成了同步自算：
 *   意图 → planEdit → EditPlan → 本地 applyPlan 得到新文本 → refresh（同步）
 *                              └→ DocumentBridge 排队落盘（异步，不挡交互）
 * 树依旧是文本的投影——投影的那份文本，正是我们即将写进文件的那份。
 * 这样连按 10 次回车不必等 10 次 I/O，也就不会丢事件。
 */

import { ItemView, Notice, TFile, type WorkspaceLeaf } from 'obsidian'
import { applyPlan } from '../core/editplan'
import { joinLines, parse } from '../core/parser'
import { reconcile } from '../core/reconcile'
import {
  moveSubtree,
  navigate,
  planEdit,
  removeSubtree,
  resolveAt,
  selectionAfterRemoval,
  visibleAncestor,
  type EditIntent,
  type EditOutcome,
  type NavDirection,
} from '../core/tree'
import type { EditPlan, MindNode, MindTree, ParseOptions } from '../core/types'
import {
  DEFAULT_LAYOUT,
  boundsOf,
  layout,
  rootSide,
  sideOf,
  subtreeBounds,
  visibleNodes,
} from '../layout'
import type { NodeSide } from '../layout'
import type { Box, LayoutDirection, LayoutOptions, LayoutResult } from '../layout/types'
import { DocumentBridge, type DocumentChange } from '../doc/DocumentBridge'
import type { MindmapHost } from '../settings/SettingsTab'
import { StyleModal } from '../settings/StyleModal'
import { DEFAULT_STYLE, type MindmapStyle } from '../settings/StyleStore'
import { Canvas } from './Canvas'
import { Connectors } from './Connectors'
import { DragController, subtreeIds, type DropResult } from './DragController'
import { InlineEditor, type CommitNext } from './Editor'
import { NodeRenderer } from './NodeRenderer'
import { Toolbar } from './Toolbar'
import { clearMeasureCache, measureNode, readFont, toggleSize, type FontSpec } from './measure'

export const VIEW_TYPE_MINDMAP = 'outline-mindmap'

/** 草稿节点的 id。它不在文件里，提交前一直只活在内存树上。 */
const DRAFT_ID = '__draft__'

/**
 * 一次编辑会话。
 *
 * `intent` 决定提交时生成哪种 EditPlan；`draft` 为 true 表示正在编辑的是草稿节点
 * （文件里还没有它，Esc 掉就什么都没发生过）。
 */
interface Session {
  node: MindNode
  intent: EditIntent
  draft: boolean
  /** 编辑已有节点时用来 Esc 还原——编辑期间 node.text 是被乐观改掉的。 */
  originalText: string
  /** Esc 之后选中该回到哪儿。取消一次新增，选中就该回到按下 Enter 时的那个节点。 */
  returnTo: string | null
}

export class MindmapView extends ItemView {
  private canvas!: Canvas
  private nodeRenderer!: NodeRenderer
  private connectors!: Connectors
  private editor!: InlineEditor
  private drag!: DragController
  private bridge!: DocumentBridge
  private toolbar!: Toolbar
  private empty!: HTMLElement

  private file: TFile | null = null
  private tree: MindTree | null = null
  private font: FontSpec | null = null
  private boxes: LayoutResult = new Map()
  private bounds: Box = { x: 0, y: 0, w: 0, h: 0 }
  /** 布局方向（M9：向右 / 向左 / 两侧）。工具栏的菜单按 LAYOUT_DIRECTIONS 生成。 */
  private direction: LayoutDirection = DEFAULT_LAYOUT.direction
  /** 当前笔记生效的样式（M8）：预览 > 单篇 > 全局，由 StyleStore 裁定。 */
  private style: MindmapStyle = DEFAULT_STYLE
  private unsubscribeStyle: (() => void) | null = null
  /**
   * 选中集合。Ctrl+左键可多选（M6），用于批量删除。
   * 【批量移动推迟到 v2】（第 6 章）——拖拽永远只搬 `focusId` 那一棵子树。
   */
  private readonly selection = new Set<string>()
  /** 主选中：方向键、Enter/Tab/F2 都作用在它身上。总是 selection 里的一员。 */
  private focusId: string | null = null
  /** 可见节点 id（文档序），拖拽落点判定要用。draw 时顺手记下，免得再走一遍树。 */
  private order: string[] = []
  private session: Session | null = null
  /** 编辑期间到达的外部变更：先攒着，等编辑结束再刷，免得草稿被冲掉。 */
  private pendingText: string | null = null
  /** 写盘失败后正在重新同步，别把同一个错误弹十遍。 */
  private resyncing = false
  /** 换一篇笔记后的第一次绘制要自动适应画布，之后不再动用户的视野。 */
  private needsFit = true

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: MindmapHost,
  ) {
    super(leaf)
  }

  override getViewType(): string {
    return VIEW_TYPE_MINDMAP
  }

  override getDisplayText(): string {
    return this.file ? `导图：${this.file.basename}` : '大纲思维导图'
  }

  override getIcon(): string {
    return 'network'
  }

  override async onOpen(): Promise<void> {
    const host = this.contentEl
    host.empty()
    host.addClass('om-root')

    // 视图刚打开时容器尺寸是 0，适应画布得等 ResizeObserver 报出真实尺寸。
    //
    // 【容器 resize 只重算视口，不自动重排】（M7 交付物）：Canvas 自己缓存新的宽高，
    // 这里除了「还没适应过画布」的那一次之外什么都不做——侧边栏拖宽拖窄是连续事件，
    // 每一帧都重新布局会卡，而且会把用户调好的缩放比例冲掉。
    this.canvas = new Canvas(host, () => {
      if (this.needsFit && this.canvas.fit(this.bounds)) this.needsFit = false
    })
    this.empty = host.createDiv({ cls: 'om-empty', text: '当前没有可显示的笔记' })

    // 工具栏（M7）。浮在画布上层，两种形态（主页面 / 侧边栏）共用同一套按钮。
    this.toolbar = new Toolbar(host, {
      fit: () => this.fitToScreen(),
      zoom: (factor) => this.canvas.zoomBy(factor),
      expandAll: () => this.setAllCollapsed(false),
      collapseAll: () => this.setAllCollapsed(true),
      direction: () => this.direction,
      setDirection: (dir) => this.setDirection(dir),
      openStyle: () => this.openStyle(),
      afterAction: () => this.canvas.focus(),
    })

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'om-svg')
    this.canvas.content.appendChild(svg)
    this.connectors = new Connectors(svg)

    const nodeLayer = this.canvas.content.createDiv({ cls: 'om-nodes' })
    this.nodeRenderer = new NodeRenderer(nodeLayer)
    // 编辑框挂在节点层【外面】：它不该被 nodeLayer 的委托监听器扫到
    this.editor = new InlineEditor(this.canvas.content, {
      onInput: this.onEditorInput,
      onCommit: this.onEditorCommit,
      onCancel: this.onEditorCancel,
    })

    // 拖拽（M6）。它自己在节点图层上委托 4 个 pointer 事件，同样与节点数量无关。
    this.drag = new DragController(nodeLayer, {
      canvas: this.canvas,
      tree: () => this.tree,
      boxes: () => this.boxes,
      order: () => this.order,
      enabled: () => !this.editor.active && this.session === null && this.tree !== null,
      onDrop: this.onDrop,
      onVisual: (dragging, into) => this.nodeRenderer.setDragVisual(dragging, into),
    })

    // 事件委托：整个图层只有这些监听器，与节点数量无关（第 2 章）
    this.registerDomEvent(nodeLayer, 'click', this.onLayerClick)
    this.registerDomEvent(this.canvas.viewport, 'dblclick', this.onDoubleClick)
    this.registerDomEvent(this.canvas.viewport, 'keydown', this.onKeyDown)

    this.bridge = new DocumentBridge(this.app, this.onDocumentChange)
    // 交给 this（ItemView 也是 Component）托管，视图关闭时监听自动解绑
    this.bridge.start(this)

    // 样式变了就重绘。样式窗口拖滑块时也走这条 → 实时预览（M8）。
    // 变的可能是别篇笔记的单篇样式，跟自己无关时 resolveStyle 返回 false，一帧都不浪费。
    this.unsubscribeStyle = this.host.styles.subscribe(() => {
      if (this.resolveStyle()) this.draw()
    })
    this.resolveStyle()

    this.registerEvent(this.app.workspace.on('file-open', () => this.syncActiveFile()))
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.syncActiveFile()))
    this.registerEvent(
      this.app.workspace.on('css-change', () => {
        // 换主题 / 改字号 → 测量全部作废
        this.font = null
        clearMeasureCache()
        this.draw()
      }),
    )

    await this.syncActiveFile(true)
  }

  override async onClose(): Promise<void> {
    // 关视图时未提交的编辑一律作废：这时候再往文件里写字，用户根本看不见
    this.cancelSession()
    this.unsubscribeStyle?.()
    this.unsubscribeStyle = null
    this.toolbar.destroy()
    this.drag.destroy()
    this.editor.destroy()
    this.bridge.dispose()
    this.nodeRenderer.destroy()
    this.connectors.destroy()
    this.canvas.destroy()
    this.tree = null
    this.boxes = new Map()
    this.order = []
    this.selection.clear()
    this.focusId = null
    this.file = null
    // 容器里的 DOM 一次清干净（M10 验收：开关视图 50 次不涨内存）。
    // 各个部件的 destroy 只负责自己挂上去的那些元素，剩下的空状态、图层容器由这里收尾。
    this.contentEl.empty()
  }

  /**
   * 适应画布。缩放比例按【当前容器尺寸】算——Canvas 的宽高来自 ResizeObserver，
   * 因此侧边栏被拖到多窄都是对的（M7 交付物）。
   *
   * 手动点「适应画布」是平滑移过去的（M10，受「优雅动画」开关控制）；
   * 打开笔记时的那次自动适应不带动画，见 draw() 末尾。
   */
  fitToScreen(): void {
    this.canvas.fit(this.bounds, true)
  }

  /** 展开 / 折叠全部（M7 工具栏）。只有有子节点的节点需要改。 */
  private setAllCollapsed(collapsed: boolean): void {
    const tree = this.tree
    if (!tree) return
    const walk = (n: MindNode): void => {
      for (const c of n.children) {
        if (c.children.length > 0) c.collapsed = collapsed
        walk(c)
      }
    }
    walk(tree.root)
    // 全部折叠后主选中可能被藏进了某个折叠节点里，把它提到最近的可见祖先上，
    // 否则接下来的方向键会从一个看不见的地方开始走
    if (this.focusId !== null) this.setSelection(visibleAncestor(tree, this.focusId))
    this.draw()
    // 视野跟着一起展开 / 收起（M10）。有主选中就跟着它那一支，
    // 没有就把整张图摆正中——否则「折叠全部」之后地图缩成一小坨躲在角落里
    if (!this.centerSubtree(this.focusId)) this.canvas.centerOn(this.bounds, true)
  }

  /**
   * 把某个节点连同它当前可见的后代摆到屏幕正中（M10 交付物）。
   *
   * 展开时子树刚长出来 → 居中的是长大后的整块；折叠时后代没有 Box →
   * `subtreeBounds` 自然收缩成节点自己，视野跟着一起收。
   *
   * @returns 目标不存在（没选中、已被藏起来）时返回 false，调用方可以另作打算
   */
  private centerSubtree(id: string | null): boolean {
    const node = id === null ? undefined : this.tree?.byId.get(id)
    if (!node) return false
    const box = subtreeBounds(node, this.boxes)
    if (!box) return false
    this.canvas.centerOn(box, true)
    return true
  }

  /**
   * 展开 / 折叠一个节点，并让视野跟着一起展开 / 收起（M10）。
   *
   * 折叠按钮、方向键的折叠/展开、拖拽落进折叠节点，都该是同一种手感，
   * 所以统一走这一条。
   */
  private setCollapsed(node: MindNode, collapsed: boolean): void {
    node.collapsed = collapsed
    this.draw()
    this.centerSubtree(node.id)
  }

  /**
   * 取当前笔记该用的样式，落到 CSS class 与测量上（M8）。
   *
   * StyleStore 从不就地改样式对象（应用与预览都是新对象），所以比一次引用就够，
   * 不必逐字段比。
   *
   * @returns 样式是否真的变了。没变就别重绘——预览时每拖一格滑块，所有导图视图都会被叫醒
   */
  private resolveStyle(): boolean {
    const next = this.host.styles.styleFor(this.file?.path ?? null)
    const prev = this.style
    const changed = prev !== next
    const root = this.contentEl
    if (changed) root.removeClass(`om-shape-${prev.shape}`, `om-scheme-${prev.scheme}`)
    // 首次调用时 prev 还是默认样式、class 一个都没挂上，所以这里无条件加一次
    root.addClass(`om-shape-${next.shape}`, `om-scheme-${next.scheme}`)
    // 字号缩放变了 → 之前量出来的每一个宽高都作废
    if (changed && prev.fontScale !== next.fontScale) this.font = null
    this.style = next
    return changed
  }

  /** 打开样式窗口（M8）。没有笔记时窗口里只有「应用全局设置」可按。 */
  private openStyle(): void {
    new StyleModal(
      this.app,
      this.host.styles,
      this.file?.path ?? null,
      this.file?.basename ?? null,
    ).open()
  }

  /** 解析 / 序列化选项。目前只有「严格换行」，每次现取，改设置后下一次编辑立即生效。 */
  private parseOptions(): ParseOptions {
    return { strictLineBreak: this.host.settings.strictLineBreak }
  }

  /** 切换布局方向。切完自动适应画布（M7 交付物）。 */
  private setDirection(dir: LayoutDirection): void {
    if (this.direction === dir) return
    this.direction = dir
    this.draw()
    this.fitToScreen()
  }

  // ── 数据 ────────────────────────────────────────────────────

  /** @param force 视图刚打开时即使没有活动笔记也要走一遍，好把空状态画出来。 */
  private async syncActiveFile(force = false): Promise<void> {
    // 「锁定当前笔记」（M7 设置项）：锁上之后导图不再跟着活动笔记走。
    // force 那次是视图刚打开时的首次同步，必须放行——否则锁着的时候新开一个导图会是空的。
    if (this.host.settings.lockFile && this.file && !force) return

    const file = this.app.workspace.getActiveFile()
    const next = file && file.extension === 'md' ? file : null
    if (next === this.file && !force) return

    this.cancelSession()
    this.file = next
    this.tree = null // 切换笔记即重置折叠态（第 4.5 节的 v1 决策）
    this.setSelection(null)
    this.pendingText = null
    this.needsFit = true
    this.bridge.setFile(next)
    // 换笔记就换样式：这一篇可能有自己的单篇样式（M8）
    this.resolveStyle()
    // 刷新标签页标题。updateHeader 不在公开类型里，取不到就算了——标题旧一点不影响功能。
    ;(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.()

    if (!next) {
      this.draw()
      return
    }
    this.refresh(await this.bridge.readText(next))
  }

  private readonly onDocumentChange = (change: DocumentChange): void => {
    if (!this.file || change.file.path !== this.file.path) return
    // 自己写的那份内容早在写之前就同步刷过了，回声一律丢弃
    if (change.selfOriginated) return
    // 编辑期间来的外部变更先攒着：现在刷会把草稿和光标一起冲掉
    if (this.session) {
      this.pendingText = change.text
      return
    }
    this.refresh(change.text)
  }

  private refresh(text: string): void {
    this.tree = reconcile(this.tree, parse(text))
    // 被别处删掉的节点不能继续留在选中集合里，否则删除/拖拽会拿着不存在的 id 去生成 plan
    const byId = this.tree.byId
    for (const id of [...this.selection]) if (!byId.has(id)) this.selection.delete(id)
    if (this.focusId !== null && !byId.has(this.focusId)) this.focusId = null
    this.draw()
  }

  /** 编辑结束后补上编辑期间被挡下的外部变更。 */
  private flushPending(): void {
    const text = this.pendingText
    if (text === null || this.session) return
    this.pendingText = null
    this.refresh(text)
  }

  // ── 渲染 ────────────────────────────────────────────────────

  private draw(): void {
    const tree = this.tree
    const hasContent = tree !== null && tree.root.children.length > 0
    this.empty.toggleClass('is-visible', !hasContent)
    // 优雅动画默认关（红线 4：节点一多，过渡就是掉帧的来源）。开关在设置页，
    // 改完不发事件，所以每次绘制顺手对一下——一个元素上的 classList 操作，可以忽略不计。
    // 节点自己的过渡看 class，视野移动的过渡看 Canvas 里的这个标志（M10）。
    const animated = this.host.settings.gracefulAnimation
    this.contentEl.toggleClass('om-animated', animated)
    this.canvas.setAnimated(animated)
    if (!tree || !hasContent) {
      this.nodeRenderer.render([], new Map(), this.selection, rootSide(this.direction))
      this.connectors.render([], new Map(), this.style.branch, 0, 0)
      this.boxes = new Map()
      this.order = []
      this.bounds = { x: 0, y: 0, w: 0, h: 0 }
      return
    }

    const boxes = layout(tree, this.layoutOptions())
    const nodes = visibleNodes(tree)

    this.nodeRenderer.render(nodes, boxes, this.selection, rootSide(this.direction))
    this.boxes = boxes
    this.order = nodes.map((n) => n.id)
    this.bounds = boundsOf(boxes)
    this.connectors.render(
      nodes,
      boxes,
      this.style.branch,
      this.bounds.x + this.bounds.w,
      this.bounds.y + this.bounds.h,
    )

    if (this.needsFit && this.canvas.fit(this.bounds)) this.needsFit = false
  }

  /** 当前样式对应的布局参数。draw 与性能自检共用，免得两处各写一份。 */
  private layoutOptions(): LayoutOptions {
    const font = this.currentFont()
    return {
      ...DEFAULT_LAYOUT,
      direction: this.direction,
      hGap: this.style.hGap,
      vGap: this.style.vGap,
      // 根之间的距离跟着纵向间距走，但不小于默认值：纵向间距调大之后，
      // 两棵根挨得比同一棵树里的兄弟还近，看上去就像它们是一家的
      rootGap: Math.max(DEFAULT_LAYOUT.rootGap, this.style.vGap * 2),
      measure: (node) => measureNode(node.text, font),
    }
  }

  /** 字体只从 CSS 变量读一次，之后缓存；css-change 与字号缩放变化时作废。 */
  private currentFont(): FontSpec {
    if (this.font) return this.font
    const font = readFont(this.contentEl, this.style.fontScale)
    // DOM 必须用与测量完全相同的字体，否则折行结果对不上
    this.contentEl.style.setProperty('--om-font-family', font.family)
    this.contentEl.style.setProperty('--om-font-size', `${font.size}px`)
    this.contentEl.style.setProperty('--om-line-height', `${font.lineHeight}px`)
    // 折叠按钮跟着字号缩放走（M11）。命中区是 CSS 里另外撑出来的，与这个直径无关
    this.contentEl.style.setProperty('--om-toggle-size', `${toggleSize(this.style.fontScale)}px`)
    this.font = font
    return font
  }

  /**
   * 性能自检（M10）。命令面板里的「导图性能自检」调它，结果直接弹给用户。
   *
   * 为什么要做在插件里：M10 那条「首次渲染 > 500ms 就上视口虚拟化」是个【条件】，
   * 而 DOM 的耗时在 node 环境的单测里根本量不到——只有在真实 Obsidian、真实主题、
   * 真实机器上跑一次，这个条件才有答案。纯计算那一段由 src/tests/perf.test.ts 守着。
   *
   * 「冷渲染」= 丢掉整个 DOM 复用池重建一遍，等价于第一次打开这篇笔记；
   * 每次测量后都读一次 offsetHeight，把浏览器的样式计算与排版一起算进来
   * （绘制那一步在主线程之外，量不到，报告里如实说明）。
   */
  perfReport(): string {
    const tree = this.tree
    if (!tree || tree.root.children.length === 0) return '导图性能自检：当前没有可显示的笔记。'

    const nodes = visibleNodes(tree).length
    const t0 = performance.now()
    layout(tree, this.layoutOptions())
    const layoutMs = performance.now() - t0

    this.nodeRenderer.destroy()
    const t1 = performance.now()
    this.draw()
    void this.canvas.viewport.offsetHeight
    const coldMs = performance.now() - t1

    const t2 = performance.now()
    this.draw()
    void this.canvas.viewport.offsetHeight
    const warmMs = performance.now() - t2

    const ms = (v: number): string => `${v.toFixed(1)}ms`
    return [
      `导图性能自检（${nodes} 个可见节点）`,
      `· 布局：${ms(layoutMs)}`,
      `· 首次渲染：${ms(coldMs)}（建全部 DOM + 样式与排版）`,
      `· 重绘：${ms(warmMs)}（复用现有 DOM）`,
      coldMs > 500 ? '首次渲染超过 500ms，按手册 M10 需要引入视口虚拟化。' : '首次渲染在 500ms 以内。',
    ].join('\n')
  }

  /** 把某个节点带进视野。最小平移，留 40px 边距（M5 交付物）。 */
  private reveal(id: string | null): void {
    const box = id === null ? undefined : this.boxes.get(id)
    if (box) this.canvas.ensureVisible(box)
  }

  // ── 鼠标 ────────────────────────────────────────────────────

  private readonly onLayerClick = (e: MouseEvent): void => {
    // 拖拽松手后浏览器还会补一个 click，不吃掉它就会顺手跳转到笔记里去
    if (this.drag.consumeClick()) return

    const target = e.target as HTMLElement
    const host = target.closest('.om-node') as HTMLElement | null
    const id = host?.dataset['nodeId']
    if (!id || !this.tree) return
    const node = this.tree.byId.get(id)
    if (!node) return

    if (target.closest('.om-toggle')) {
      if (node.children.length === 0) return
      this.setCollapsed(node, !node.collapsed)
      return
    }

    // Ctrl/⌘ + 左键 = 加选 / 减选（M6，为批量删除服务）。加选时不跳转：
    // 正在攒一批要删的节点，编辑器却在一路乱滚，很吵。
    if (e.ctrlKey || e.metaKey) {
      this.toggleSelection(id)
      this.draw()
      this.canvas.focus()
      return
    }

    this.select(id)
    // 焦点必须留在导图上，否则后面的快捷键全废
    this.canvas.focus()
    if (this.host.settings.clickToJump && this.file && !this.session) {
      void this.jumpTo(node.titleLine)
    }
  }

  private readonly onDoubleClick = (e: MouseEvent): void => {
    if (this.editor.active) return
    const id = (e.target as HTMLElement).closest('.om-node')?.getAttribute('data-node-id')
    if (id) {
      // 双击节点 = 编辑它（与 F2 同义）
      this.beginRename(id)
      return
    }
    if ((e.target as HTMLElement).closest('.om-editor')) return
    // 双击空白 = 新建自由根，空笔记也能用
    this.beginDraft({ type: 'root' })
  }

  /** 跳转到笔记对应行。不抢焦点——细节见 DocumentBridge.revealLine。 */
  private async jumpTo(line: number): Promise<void> {
    const file = this.file
    if (!file || line < 0) return
    await this.bridge.revealLine(file, line)
    // 新开标签页是异步的，等它落定后再确认一次焦点还在导图上
    this.canvas.focus()
  }

  // ── 键盘（M5）───────────────────────────────────────────────

  /**
   * 导图的快捷键。编辑态下的按键由 InlineEditor 自己吃掉并 stopPropagation，
   * 传不到这里；`editor.active` 那一行是兜底。
   */
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.editor.active || e.isComposing) return
    // 拖拽中按 Esc = 放弃这次拖拽，文件一个字都不写
    if (e.key === 'Escape' && this.drag.active) {
      e.preventDefault()
      this.drag.cancel()
      return
    }
    const mod = e.ctrlKey || e.metaKey

    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      this.undo()
      return
    }
    if (mod || e.altKey) return

    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        e.preventDefault()
        this.move(this.arrowToNav(e.key))
        break
      case 'Enter':
        e.preventDefault()
        this.startSibling()
        break
      case 'Tab':
        e.preventDefault()
        this.startChild()
        break
      case 'F2':
        e.preventDefault()
        if (this.focusId) this.beginRename(this.focusId)
        break
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        this.removeSelected()
        break
      default:
        break
    }
  }

  /**
   * 方向键 → 导航意图。
   *
   * 水平方向按【主选中节点所在的那一侧】解释：节点朝左生长时，← 才是「进到子节点里去」、
   * → 是「回到父节点」。否则在分支向左的导图里按 →，选中会看着往左跑，手感是反的。
   *
   * 翻转只发生在这一层：`navigate()` 里的 'right' 恒定表示「往深处走」、'left' 恒定表示
   * 「往回收」，core 不需要知道屏幕上哪边是哪边。
   */
  private arrowToNav(key: string): NavDirection {
    const dir = arrowToDirection(key)
    if (dir !== 'left' && dir !== 'right') return dir
    if (this.focusSide() === 'right') return dir
    return dir === 'left' ? 'right' : 'left'
  }

  /** 主选中节点朝哪一侧生长。没有选中 / 还没布局时按整体方向算。 */
  private focusSide(): NodeSide {
    const fallback = rootSide(this.direction)
    const id = this.focusId
    if (id === null) return fallback
    const node = this.tree?.byId.get(id)
    const box = this.boxes.get(id)
    if (!node || !box) return fallback
    return sideOf(box, node.parent ? this.boxes.get(node.parent.id) : undefined, fallback)
  }

  private move(dir: NavDirection): void {
    const tree = this.tree
    if (!tree) return
    if (!this.focusId) {
      const first = tree.root.children[0]
      if (first) this.select(first.id)
      return
    }
    const action = navigate(tree, this.focusId, dir)
    if (!action) return
    if (action.type === 'select') {
      this.select(action.id)
      return
    }
    const node = tree.byId.get(action.id)
    if (!node) return
    this.setCollapsed(node, action.type === 'collapse')
  }

  private select(id: string): void {
    this.setSelection(id)
    this.draw()
    this.reveal(id)
  }

  /** 单选：清掉其余的。`null` = 什么都不选。 */
  private setSelection(id: string | null): void {
    this.selection.clear()
    if (id !== null) this.selection.add(id)
    this.focusId = id
  }

  /** Ctrl+左键：加选 / 减选。减掉主选中时，主选中让给集合里剩下的最后一个。 */
  private toggleSelection(id: string): void {
    if (this.selection.delete(id)) {
      if (this.focusId === id) {
        let last: string | null = null
        for (const rest of this.selection) last = rest
        this.focusId = last
      }
      return
    }
    this.selection.add(id)
    this.focusId = id
  }

  /** 选中的节点 id，按文档序。批量删除要按文档序合并范围。 */
  private selectionIds(): string[] {
    const tree = this.tree
    if (!tree || this.selection.size === 0) return []
    const out: string[] = []
    const walk = (n: MindNode): void => {
      for (const c of n.children) {
        if (this.selection.has(c.id)) out.push(c.id)
        walk(c)
      }
    }
    walk(tree.root)
    return out
  }

  private undo(): void {
    const file = this.file
    if (!file) return
    // 不自建撤销栈：所有写入都是编辑器事务，转发过去天然一致（第 4.6 节）
    if (!this.bridge.undo(file)) new Notice('笔记没有在编辑器里打开，无法撤销')
  }

  // ── 编辑会话 ────────────────────────────────────────────────

  private startSibling(): void {
    const node = this.selectedNode()
    // 没有选中（空笔记、刚打开）时回车 = 新建一个自由根
    if (!node) this.beginDraft({ type: 'root' })
    else this.beginDraft({ type: 'sibling', refId: node.id })
  }

  private startChild(): void {
    const node = this.selectedNode()
    if (!node) return
    this.beginDraft({ type: 'child', parentId: node.id })
  }

  private selectedNode(): MindNode | null {
    if (!this.tree || !this.focusId) return null
    return this.tree.byId.get(this.focusId) ?? null
  }

  /**
   * 开一个草稿节点：先在内存树上挂出来，让它参与布局和渲染，编辑框盖在它上面。
   *
   * 【为什么不先往文件里写一个空节点再改名】——那样 Esc 会留下一行 `## `，
   * 而且一次新增会变成「插入 + 重命名」两次撤销。草稿只活在内存里，
   * 提交时才生成唯一的一次写入。
   */
  private beginDraft(intent: EditIntent): void {
    const tree = this.tree
    if (!tree || !this.file || this.session) return

    let parent: MindNode | null = null
    let index = 0
    if (intent.type === 'sibling') {
      const ref = tree.byId.get(intent.refId)
      if (!ref?.parent) return
      parent = ref.parent
      index = parent.children.indexOf(ref) + 1
    } else if (intent.type === 'child') {
      parent = intent.parentId === null ? tree.root : (tree.byId.get(intent.parentId) ?? null)
      if (!parent) return
      parent.collapsed = false // 往折叠着的节点里加子节点，得先让人看见
      index = parent.children.length
    } else if (intent.type === 'root') {
      parent = tree.root
      index = parent.children.length
    } else {
      return
    }

    const draft = makeDraft(parent, index)
    tree.byId.set(DRAFT_ID, draft)
    this.session = {
      node: draft,
      intent,
      draft: true,
      originalText: '',
      returnTo: this.focusId,
    }
    this.openEditor(draft, '')
  }

  private beginRename(id: string): void {
    const tree = this.tree
    if (!tree || !this.file || this.session) return
    const node = tree.byId.get(id)
    if (!node) return
    this.session = {
      node,
      intent: { type: 'rename', id },
      draft: false,
      originalText: node.text,
      returnTo: id,
    }
    this.openEditor(node, node.text)
  }

  private openEditor(node: MindNode, text: string): void {
    // 进编辑态就只剩这一个选中：多选着开编辑框，用户分不清接下来的操作作用在谁身上
    this.setSelection(node.id)
    this.draw()
    const box = this.boxes.get(node.id)
    if (!box) {
      // 布局里没有它（理论上不会发生），别把用户卡在半个编辑态里
      this.cancelSession()
      return
    }
    this.canvas.ensureVisible(box)
    this.editor.start(box, text)
  }

  /** 输入时的乐观更新：直接改内存里的 text → 重排 → 编辑框跟着新盒子走。 */
  private readonly onEditorInput = (text: string): void => {
    const s = this.session
    if (!s) return
    s.node.text = text
    this.draw()
    const box = this.boxes.get(s.node.id)
    if (box) {
      this.editor.place(box)
      this.canvas.ensureVisible(box)
    }
  }

  private readonly onEditorCommit = (text: string, next: CommitNext): void => {
    const s = this.session
    if (!s) return
    const value = text.trim()

    // 一个字都没打的草稿，被「点到别处」结束掉时不该往笔记里塞一行空标题——
    // 用户根本没输入任何东西。按 Enter / Tab 明确要求继续时才照常创建。
    if (s.draft && value === '' && next === 'none') {
      this.onEditorCancel()
      return
    }

    this.editor.stop()
    this.session = null

    const committed = this.commit(s, value)
    this.canvas.focus()

    if (committed && next !== 'none') {
      this.beginDraft(
        next === 'sibling'
          ? { type: 'sibling', refId: committed }
          : { type: 'child', parentId: committed },
      )
      return
    }
    if (committed) this.select(committed)
    this.flushPending()
  }

  private readonly onEditorCancel = (): void => {
    this.cancelSession()
    this.canvas.focus()
    this.flushPending()
  }

  /** Esc / 关视图：把内存里的乐观改动原样退回去，文件一个字都不写。 */
  private cancelSession(): void {
    const s = this.session
    this.session = null
    this.editor.stop()
    if (!s) return
    if (s.draft) this.detachDraft(s.node)
    else s.node.text = s.originalText
    // 回到按下 Enter / F2 之前选中的那个节点；它可能已经被外部改动删掉了，所以要核一遍
    this.setSelection(s.returnTo !== null && this.tree?.byId.has(s.returnTo) ? s.returnTo : null)
    this.draw()
  }

  /**
   * 落盘一次编辑，返回提交后目标节点的 id。
   *
   * 顺序很重要：先把草稿从树上摘掉再 planEdit——`insertChild` 要数父节点现有的子节点，
   * 草稿混在里面会把插入点算到它自己后面。
   */
  private commit(s: Session, text: string): string | null {
    const tree = this.tree
    if (!tree || !this.file) return null
    if (s.draft) this.detachDraft(s.node)
    else s.node.text = s.originalText // plan 只按行号取原文，内存里的乐观值先退回去

    let outcome: EditOutcome
    try {
      outcome = planEdit(tree, s.intent, text, this.parseOptions())
    } catch (err) {
      this.report(err)
      this.draw() // 乐观改动已经退回去了，把画面同步回真实状态
      return null
    }
    // applyEdit 里的 refresh 换了一棵新树，节点得按结构位置重新找
    const node = this.applyEdit(outcome.plan, (t) => resolveAt(t, outcome.parentId, outcome.index))
    if (node) {
      this.setSelection(node.id)
      this.draw()
      this.reveal(node.id)
    }
    return node?.id ?? null
  }

  private detachDraft(draft: MindNode): void {
    const parent = draft.parent
    if (parent) {
      const i = parent.children.indexOf(draft)
      if (i >= 0) parent.children.splice(i, 1)
    }
    draft.parent = null
    this.tree?.byId.delete(DRAFT_ID)
    this.selection.delete(DRAFT_ID)
    if (this.focusId === DRAFT_ID) this.focusId = null
  }

  /**
   * Delete / Backspace：删掉选中的节点【及其整棵子树】。
   *
   * Ctrl+左键多选时一次删掉一批（M6）：`removeSubtree` 自己会过滤掉
   * 「祖先已在删除列表里」的 id 并合并相邻范围，所以这里一次性全交给它，
   * 得到的仍是【一次】可撤销的变更。
   */
  private removeSelected(): void {
    const tree = this.tree
    const ids = this.selectionIds()
    if (!tree || ids.length === 0) return

    let plan: EditPlan
    try {
      plan = removeSubtree(tree, ids)
    } catch (err) {
      this.report(err)
      return
    }
    const nextId = selectionAfterBatch(tree, ids)
    // 删除之后笔记跟到「删完剩下的那个选中节点」；一个都不剩就别滚了（M11）
    this.applyEdit(plan, (t) => (nextId === null ? null : (t.byId.get(nextId) ?? null)))
    this.setSelection(nextId)
    this.draw()
    this.reveal(nextId)
  }

  /** 拖拽落点（M6）。结构变更本身全在 core/tree.ts 的 `moveSubtree` 里。 */
  private readonly onDrop = (dragId: string, result: DropResult): void => {
    const tree = this.tree
    if (!tree || !this.file) return

    let plan: EditPlan
    try {
      plan = moveSubtree(tree, dragId, result.parentId, result.index, this.parseOptions())
    } catch (err) {
      this.report(err)
      return
    }
    // 换了一棵新树，被移动的节点要按结构位置重新找（它的 id 由 reconcile 保住，但对象是新的）
    const node = this.applyEdit(plan, (t) => resolveAt(t, result.parentId, result.index))
    if (!node) return
    // 放进一个折叠着的节点里，得让人看见结果
    for (let p = node.parent; p; p = p.parent) p.collapsed = false
    this.setSelection(node.id)
    this.draw()
    this.reveal(node.id)
  }

  /**
   * 应用一个 EditPlan：本地同步算出新文本并立刻重绘，落盘异步排队。
   *
   * 这样连按 10 次回车时，第 2 次的行号基准是第 1 次之后的文本，不必等 I/O 回来；
   * 写入在 DocumentBridge 里排队，顺序与这里生成的顺序一致。
   *
   * @param locate 在写入后的新树上找出这次编辑的目标节点。它决定笔记要跟到哪一行（M11），
   *   同时作为返回值交还给调用方——那棵树只在这里现成，调用方不必自己再找一遍。
   */
  private applyEdit(plan: EditPlan, locate?: (tree: MindTree) => MindNode | null): MindNode | null {
    const tree = this.tree
    const file = this.file
    if (!tree || !file || plan.length === 0) return null
    const base = tree.lines
    const eol = tree.eol

    let text: string
    try {
      text = joinLines(applyPlan(base, plan), eol)
    } catch (err) {
      this.report(err)
      return null
    }
    this.refresh(text)

    // refresh 之后 this.tree 已经是写入后的那棵树，目标节点的行号才是笔记该停的位置。
    // 跟随受「单击即跳转」管：关掉那个开关的人本来就不想让编辑器跟着导图动。
    const target = this.tree && locate ? locate(this.tree) : null
    const reveal = target && this.host.settings.clickToJump ? target.titleLine : undefined
    this.bridge
      .applyPlan(file, base, plan, eol, reveal)
      .catch((err: unknown) => this.onWriteFailed(err))
    return target
  }

  /**
   * 写盘失败（多半是文件在别处被改过、行号已失效）。
   *
   * 此时内存里的树是「我们以为的样子」，和磁盘不一致，必须以文件为准重新来过。
   */
  private onWriteFailed(err: unknown): void {
    if (this.resyncing) return
    this.resyncing = true
    this.report(err)
    void this.resync()
  }

  private async resync(): Promise<void> {
    try {
      this.cancelSession()
      const file = this.file
      if (!file) return
      this.tree = null
      this.setSelection(null)
      this.refresh(await this.bridge.readText(file))
    } finally {
      this.resyncing = false
    }
  }

  private report(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err)
    new Notice(`导图操作未完成：${msg}`)
    console.error('[outline-mindmap]', err)
  }
}

/**
 * 批量删除后，选中该落到哪儿。
 *
 * 从第一个（文档序）被删节点出发问 `selectionAfterRemoval`，若答案本身也在这批要删的
 * 范围里就继续往下问。走过的记下来——两个互为候选的根节点会把它绕成死循环。
 */
function selectionAfterBatch(tree: MindTree, ids: string[]): string | null {
  const first = ids[0]
  if (first === undefined) return null
  const doomed = new Set<string>()
  for (const id of ids) {
    const node = tree.byId.get(id)
    if (node) for (const sub of subtreeIds(node)) doomed.add(sub)
  }

  const seen = new Set<string>()
  let candidate = selectionAfterRemoval(tree, first)
  while (candidate !== null && doomed.has(candidate)) {
    if (seen.has(candidate)) return null
    seen.add(candidate)
    candidate = selectionAfterRemoval(tree, candidate)
  }
  return candidate
}

function arrowToDirection(key: string): NavDirection {
  switch (key) {
    case 'ArrowUp':
      return 'up'
    case 'ArrowDown':
      return 'down'
    case 'ArrowLeft':
      return 'left'
    default:
      return 'right'
  }
}

/**
 * 造一个草稿节点并挂到父节点下。
 *
 * 行号一律给 -1：它在文件里没有对应的行，任何按行号来的操作（跳转、生成 plan）
 * 都必须先把它摘掉。depth 只影响显示，真正的 depth / kind 由 tree.ts 在提交时定。
 */
function makeDraft(parent: MindNode, index: number): MindNode {
  const draft: MindNode = {
    id: DRAFT_ID,
    text: '',
    depth: parent.depth + 1,
    kind: 'heading',
    children: [],
    parent,
    titleLine: -1,
    bodyEnd: -1,
    blockStart: -1,
    blockEnd: -1,
    collapsed: false,
  }
  parent.children.splice(index, 0, draft)
  return draft
}
