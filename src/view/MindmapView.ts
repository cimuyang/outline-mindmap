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

import {
  FileView,
  ItemView,
  MarkdownView,
  Notice,
  loadMathJax,
  Menu,
  type TFile,
  type ViewStateResult,
  type WorkspaceLeaf,
} from 'obsidian'
import { selectedBranches, copyBranches, pastePlan } from '../core/clipboard'
import { applyPlan } from '../core/editplan'
import { joinLines, parse } from '../core/parser'
import { reconcile } from '../core/reconcile'
import {
  maxDepthDrop,
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
import type { HistoryDirection } from '../doc/FileHistory'
import type { MindmapHost } from '../settings/SettingsTab'
import { StyleModal } from '../settings/StyleModal'
import { DEFAULT_STYLE, type MindmapStyle } from '../settings/StyleStore'
import type { NoteMode } from '../settings/OpenAsStore'
import type { ViewportState } from '../settings/ViewPreferences'
import { t } from '../i18n'
import { clearHeadingFilter, showHeadingLevel } from '../core/folding'
import { bodyIndicators, bodyRange, readBody, bodyPlan, rebaseBody, type BodyRange } from '../core/body'
import { label } from './strings'
import { BodyCard } from './BodyCard'
import { Canvas } from './Canvas'
import { Connectors } from './Connectors'
import { DragController, subtreeIds, type DropResult } from './DragController'
import { InlineEditor, type CommitNext } from './Editor'
import { exportMap, ExportSizeError } from './exportMap'
import { fileToShow } from './follow'
import { NodeRenderer } from './NodeRenderer'
import { Toolbar } from './Toolbar'
import { LayoutMotion, MOTION_NODE_LIMIT } from './LayoutMotion'
import { searchState, searchTargets, type SearchState } from './search'
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
  private retainedBodies = new Map<BodyCard, NonNullable<MindmapView['bodySession']>>()
  private bodyCard: BodyCard | null = null
  private bodySession: { file: TFile; base: string[]; range: BodyRange; title: string; writing: boolean } | null = null
  private bodyOpenGeneration = 0
  private loadGeneration = 0
  private headingLevel = 0
  private static clipboardSource: { text: string; path: string } | null = null
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
  /** 布局方向：与其他样式一样由单篇 / 全局配置解析。 */
  private direction: LayoutDirection = DEFAULT_LAYOUT.direction
  /** 当前笔记生效的样式（M8）：预览 > 单篇 > 全局，由 StyleStore 裁定。 */
  private style: MindmapStyle = DEFAULT_STYLE
  private unsubscribeStyle: (() => void) | null = null
  private unsubscribePreferences: (() => void) | null = null
  private initialViewport: ViewportState | undefined
  private styleViewport: ViewportState | undefined
  private previewingStyle = false
  private noteMode: NoteMode = 'source'
  private locked = false
  private forcedLock = false
  private modeObserver: MutationObserver | null = null
  private modeContainers: HTMLElement[] = []
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
  private historyBusy = 0
  private search: { state: SearchState; path: string | null; pending: boolean } | null = null
  private searchBar!: HTMLElement
  private searchFocusId: string | null = null
  private motion!: LayoutMotion
  private reducedMotion: MediaQueryList | null = null
  /** 首次绘制恢复记忆视野；没有记忆时适应画布。尺寸为零时延后。 */
  private needsFit = true
  /** onOpen 是否已经把各个部件建起来了。setState 可能比它先到。 */
  private ready = false
  /**
   * setState 早于 onOpen 时先记在这儿的笔记路径，onOpen 收尾时认领。
   *
   * 「早于 onOpen」= 这个视图正在被创建：要么是「笔记 → 导图」换形态，要么是
   * 恢复工作区。钉住的照办，跟随型的只当回退，取舍见 follow.ts。
   */
  private pendingPath: string | null = null
  /**
   * 钉在一篇笔记上（「打开为导图」换出来的那种），不跟随活动笔记；写进视图状态，重启后仍钉着。
   * 与之相对的是侧边栏图标 / 命令面板打开的【跟随型】导图。
   */
  private pinned = false
  commandMap = false

  get sourceFile(): TFile | null { return this.file }
  /**
   * 只给「跟随自检」命令看的留痕：最近 16 次「该不该换笔记」的判定。
   *
   * 「导图没跟着笔记切换」有三种完全不同的成因——事件没送到、送到了但
   * `getActiveFile()` 还是旧的、或者被某条规则挡下了——光看现象分不出是哪一种，
   * 只看一张事后的快照也分不出（快照上写着「活动笔记没变」，是没变还是没看见？）。
   * 记下【每一次判定的来源、看到的活动笔记、和结论】，切一次笔记就能读出真相。
   *
   * 代价是每次事件往数组里塞一个字符串、超过 16 条丢掉最早的，与节点数无关。
   */
  private readonly trail: string[] = []
  /** 这个视图实例是什么时候建起来的。视图被卸载重建过，事件计数会归零，得看得出来。 */
  private readonly bornAt = Date.now()

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
    return this.file ? t('view.titleWithNote', this.file.basename) : t('view.title')
  }

  override getIcon(): string {
    return 'network'
  }

  override getEphemeralState(): Record<string, unknown> {
    return this.search ? { ...this.search.state } : {}
  }

  override setEphemeralState(value: unknown): void {
    const state = searchState(value)
    if (!state) return
    this.searchFocusId = null
    this.search = { state, path: this.pendingPath ?? this.file?.path ?? null, pending: true }
    if (this.ready && this.tree) this.applySearch()
  }

  private clearSearch(): void {
    this.search = null
    this.searchFocusId = null
    this.nodeRenderer?.setSearch(new Map())
    this.searchBar?.empty()
    this.searchBar?.addClass('is-hidden')
  }

  private applySearch(): void {
    const request = this.search
    const tree = this.tree
    if (!request || !tree || !this.file || !this.ready) return
    if (request.path !== null && request.path !== this.file.path) { this.clearSearch(); this.draw(); return }
    const targets = searchTargets(tree, request.state)
    if (!targets) {
      this.clearSearch()
      this.draw()
      new Notice(t('notice.searchStale'))
      return
    }
    const highlights = new Map<string, string[]>()
    for (const target of targets) {
      if (!target.node) continue
      const terms = highlights.get(target.node.id) ?? []
      if (!target.body && target.text) terms.push(target.text)
      highlights.set(target.node.id, terms)
    }
    this.nodeRenderer.setSearch(highlights)
    const first = targets.find(target => target.node)
    if (request.pending && first?.node) {
      this.headingLevel = 0; this.rememberLevel(0); clearHeadingFilter(tree)
      for (const target of targets) {
        for (let parent = target.node?.parent; parent; parent = parent.parent) parent.collapsed = false
      }
      this.setSelection(first.node.id)
      this.searchFocusId = first.node.id
    }
    this.searchBar.empty()
    this.searchBar.removeClass('is-hidden')
    this.searchBar.createSpan({ text: t(targets.some(x => x.body) ? 'search.body' : 'search.matches', targets.length) })
    const open = this.searchBar.createEl('button', { text: t('search.openNote') })
    open.addEventListener('click', () => {
      const file = this.file
      if (file) void this.host.openSearchResult(this.leaf, file, request.state, this.noteMode).catch(err => this.report(err))
    })
    const close = this.searchBar.createEl('button', { text: t('search.clear') })
    close.addEventListener('click', () => { this.clearSearch(); this.draw(); this.canvas.focus() })
    // Body text is absent from the outline: show the exact source hit without
    // creating editable pseudo-nodes or changing the document/layout geometry.
    const bodyIndex = targets.findIndex(target => target.body)
    if (bodyIndex >= 0) {
      const { content, matches } = request.state.match
      const [from, to] = matches[bodyIndex]!
      const start = Math.max(content.lastIndexOf('\n', Math.max(0, from - 1)) + 1, from - 48)
      const lineEnd = content.indexOf('\n', to)
      const end = Math.min(lineEnd < 0 ? content.length : lineEnd, to + 96)
      const excerpt = this.searchBar.createDiv({ cls: 'om-search-excerpt' })
      excerpt.appendText((start > 0 ? '…' : '') + content.slice(start, from))
      excerpt.createEl('mark', { cls: 'om-search-match', text: content.slice(from, Math.min(to, from + 160)) + (to - from > 160 ? '…' : '') })
      excerpt.appendText(content.slice(to, end) + (end < content.length ? '…' : ''))
    }
    this.draw()
    this.focusSearch()
    request.pending = false
  }

  private focusSearch(): void {
    if (!this.searchFocusId) return
    const box = this.boxes.get(this.searchFocusId)
    if (box && this.canvas.centerOn(box, true, 0.85)) {
      this.searchFocusId = null
      this.needsFit = false
    }
  }

  private resizeCanvas(): void {
    this.initializeViewport()
    this.focusSearch()
  }

  private initializeViewport(): void {
    if (!this.needsFit) return
    const restored = this.initialViewport
      ? this.canvas.restore(this.initialViewport, this.boxes.values()) : this.canvas.fit(this.bounds)
    if (restored) {
      this.needsFit = false
      this.initialViewport = undefined
    }
  }

  private rememberViewport(): void {
    if (!this.file || this.needsFit || !this.boxes.size) return
    const viewport = this.canvas.snapshot()
    if (viewport) this.host.preferences.rememberViewport(this.file.path, viewport)
  }

  private canWriteFile(file: TFile): boolean {
    return !this.host.preferences.isLocked(file.path) && !this.bridge.isReading(file) &&
      !(this.file === file && this.noteMode === 'preview')
  }

  private canEdit(): boolean {
    this.syncLock()
    return !!this.file && !this.locked
  }

  private syncLock(force = false): void {
    const mode = this.file ? this.bridge.noteMode(this.file) : null
    if (mode) this.noteMode = mode
    const forced = !!this.file && this.noteMode === 'preview'
    const locked = forced || (!!this.file && this.host.preferences.isLocked(this.file.path))
    const changed = locked !== this.locked || forced !== this.forcedLock
    this.locked = locked
    this.forcedLock = forced
    if (locked && changed) {
      this.drag.cancel()
      this.cancelSession()
      this.flushPending()
    }
    if (changed || force) {
      this.contentEl.toggleClass('is-locked', locked)
      this.toolbar.setLocked(locked, forced, !!this.file)
      this.bodyCard?.setWritable(!locked)
      for (const card of this.retainedBodies.keys()) card.setWritable(!locked)
    }
  }

  private toggleLock(): void {
    this.syncLock()
    if (this.file && !this.forcedLock) this.host.preferences.setLocked(this.file.path, !this.locked)
  }

  /** Mode toggles can keep the same file/leaf; observe their public DOM and query getMode(). */
  private observeNoteMode(): void {
    if (typeof MutationObserver === 'undefined') return
    const containers = this.app.workspace.getLeavesOfType('markdown')
      .map(leaf => leaf.view)
      .filter((view): view is MarkdownView => view instanceof MarkdownView && view.file === this.file)
      .map(view => view.contentEl)
    if (containers.length === this.modeContainers.length &&
        containers.every((el, index) => el === this.modeContainers[index])) return
    this.modeObserver?.disconnect()
    this.modeContainers = containers
    this.modeObserver = new MutationObserver(() => this.syncLock())
    for (const el of containers) this.modeObserver.observe(el, {
      attributes: true, attributeFilter: ['class', 'style'], childList: true, subtree: true,
    })
  }

  /**
   * 视图状态里记住当前这篇笔记的路径，以及是不是钉住的。
   *
   * 路径的两个用处：一是「笔记 ⇄ 导图」互转时把目标笔记直接交给新视图（那一刻活动笔记
   * 可能已经不是它了）；二是重启 Obsidian 后导图还停在原来那篇上。
   */
  override getState(): Record<string, unknown> {
    return { ...super.getState(), file: this.file?.path ?? this.pendingPath ?? null, commandMap: this.commandMap, pinned: this.pinned, noteMode: this.noteMode }
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result)
    const { file: path, pinned, noteMode, commandMap } =
      (state as { file?: unknown; pinned?: unknown; noteMode?: unknown; commandMap?: unknown } | null) ?? {}
    if (typeof path !== 'string') return
    this.commandMap = commandMap === true
    this.setPinned(this.commandMap ? this.host.settings.mapMode !== 'follow' : pinned === true)
    if (this.commandMap) this.navigation = false
    if (this.pinned || !this.ready || this.file?.path === path) {
      this.noteMode = noteMode === 'preview' ||
        (noteMode === undefined && this.host.settings.openAs?.[path]?.noteMode === 'preview') ? 'preview' : 'source'
    }
    // setState 早于 onOpen = 视图正在被创建（换形态 / 恢复工作区）。showFile 要用
    // onOpen 里才建起来的 bridge，所以先记下来，等 onOpen 收尾时按取舍规则认领。
    if (!this.ready) {
      this.pendingPath = path
      return
    }
    // 视图已经活着还收到 setState：仍然按同一条取舍规则来，不无条件采信。
    //
    // 【为什么不照办】：跟随型导图这条路上来的路径不一定是「谁明确要求换到这一篇」——工作区被
    // 保存 / 恢复、叶子被搬动、Obsidian 自己回放视图状态时，送来的都是【存档里那一篇】。
    // 无条件采信就会把导图硬拽回上一篇，而且此后没有任何事件来纠正它。钉住的则正好该照办。
    await this.showRestored(path)
    this.syncLock(true)
  }

  /**
   * 钉住 = 这个标签页是「一篇笔记换了形态」，于是也像笔记标签页一样可被导航复用：
   * 在它里面点开别的笔记，会在这个标签页里打开，而不是另开一个；「后退」也能回到导图。
   * 跟随型导图是工具面板，不参与导航。
   */
  async refreshMapMode(): Promise<void> {
    if (this.commandMap) {
      this.pinned = this.host.settings.mapMode !== 'follow'
      this.app.workspace.requestSaveLayout()
    }
    if (this.ready) await this.syncActiveFile()
  }

  private setPinned(pinned: boolean): void {
    this.pinned = pinned
    this.navigation = pinned
  }

  /**
   * 按 follow.ts 的取舍规则处理一条存档路径。
   *
   * @returns 是否定下了一篇并显示了它；false 表示两个候选都没有，由调用方决定怎么兜底
   */
  private async showRestored(path: string): Promise<boolean> {
    const target = fileToShow(
      this.app.vault.getFileByPath(path),
      this.activeMarkdownFile(),
      this.pinned || (!this.commandMap && this.host.settings.lockFile),
    )
    if (target) await this.showFile(target)
    return target !== null
  }

  /**
   * 指名显示某一篇笔记，不看活动笔记是哪一篇。
   *
   * 「笔记 → 导图」转换时由外部调用：那一刻这个叶子刚从 Markdown 变过来，
   * `getActiveFile()` 未必还指着它。
   */
  async showFile(file: TFile): Promise<void> {
    // 已经在显示它、且树也建起来了 → 什么都不用做。
    //
    // 【树还是 null 时不能就这么返回】：路径相同但树是空的（setState 重复到达、
    // 上一次读取被后手判定失效而丢弃）意味着屏幕上是一张永远空着的图。
    // 这种情况往下走，只补读一次文本——不重新 adoptFile，选中与折叠态原封不动。
    if (this.file?.path === file.path) {
      if (this.tree) return
    } else {
      this.adoptFile(file)
      // 先把上一篇的画面清掉：读取是异步的，不清的话这段空隙里还是上一篇的导图
      this.draw()
    }
    const generation = ++this.loadGeneration
    const text = await this.bridge.loadText(file)
    if (generation !== this.loadGeneration || this.file?.path !== file.path) return // 读取期间又换了一篇，见 syncActiveFile 里的同一道判断
    this.refresh(text)
  }

  /** 导图这一侧的「打开为笔记」（三个点菜单）。 */
  override onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source)
    const file = this.file
    if (!file) return
    menu.addItem(item => item.setTitle(t('menu.undo')).setIcon('undo-2')
      .setDisabled(!this.canEdit() || !!this.historyBusy || !!this.session)
      .onClick(() => void this.stepHistory('undo')))
    menu.addItem(item => item.setTitle(t('menu.redo')).setIcon('redo-2')
      .setDisabled(!this.canEdit() || !!this.historyBusy || !!this.session)
      .onClick(() => void this.stepHistory('redo')))
    menu.addItem((item) =>
      item
        .setTitle(t('menu.openAsNote'))
        .setIcon('file-text')
        // 就地换形态：同一个叶子从导图变回 Markdown，不另开标签页。逻辑在 main.ts，
        // 因为它还要忘掉「以导图打开」的记忆，而记忆归插件管。
        .onClick(() => void this.host.openAsNote(this.leaf, file, this.noteMode)),
    )
  }

  override async onOpen(): Promise<void> {
    // NodeRenderer 直接复用 Obsidian 的 renderMath()，因此在第一次画节点之前把 MathJax
    // 准备好。放在「导图视图打开」而不是插件 onload：从不用导图的人不会为它付启动成本。
    try {
      await loadMathJax()
    } catch (err: unknown) {
      // 数学引擎失效不该拖垮整张导图；NodeRenderer 会把公式退回 `$...$` 源码显示。
      console.warn('[outline-mindmap] loadMathJax failed', err)
    }

    const host = this.contentEl
    const win = host.ownerDocument.defaultView ?? window
    this.motion = new LayoutMotion({
      now: () => win.performance.now(),
      request: callback => win.requestAnimationFrame(callback),
      cancel: id => win.cancelAnimationFrame(id),
    })
    this.reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)')
    const onMotionChange = (): void => { if (this.ready) this.draw() }
    this.reducedMotion.addEventListener('change', onMotionChange)
    this.register(() => this.reducedMotion?.removeEventListener('change', onMotionChange))
    host.empty()
    host.addClass('om-root')

    // 视图刚打开时容器尺寸是 0，适应画布得等 ResizeObserver 报出真实尺寸。
    //
    // 【容器 resize 只重算视口，不自动重排】（M7 交付物）：Canvas 自己缓存新的宽高，
    // 这里除了「还没适应过画布」的那一次之外什么都不做——侧边栏拖宽拖窄是连续事件，
    // 每一帧都重新布局会卡，而且会把用户调好的缩放比例冲掉。
    this.canvas = new Canvas(host, () => this.resizeCanvas(), {
      onUserChange: () => this.rememberViewport(),
      onGestureStart: () => {
        this.motion.finish()
        this.drag.cancel()
        this.cancelSession()
        this.flushPending()
      },
      panNodes: () => { this.syncLock(); return this.locked },
    })
    this.empty = host.createDiv({ cls: 'om-empty', text: t('view.empty') })
    this.searchBar = host.createDiv({ cls: 'om-search-bar is-hidden' })

    // 工具栏（M7）。浮在画布上层，两种形态（主页面 / 侧边栏）共用同一套按钮。
    this.toolbar = new Toolbar(host, {
      fit: () => this.fitToScreen(),
      zoom: (factor) => this.canvas.zoomBy(factor),
      expandAll: () => this.setAllCollapsed(![...(this.tree?.byId.values() ?? [])].some(n => n.viewHidden || n.children.length && n.collapsed)),
      collapseAll: () => this.setAllCollapsed(true),
      foldMenu: event => this.openFoldMenu(event),
      toggleLock: () => this.toggleLock(),
      openStyle: () => this.openStyle(),
      afterAction: () => this.canvas.focus(),
    })

    this.connectors = new Connectors(this.canvas.content.createSvg('svg', { cls: 'om-svg' }))

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
      enabled: () => this.canEdit() && !this.editor.active && this.session === null && this.tree !== null && !this.historyBusy,
      onDrop: this.onDrop,
      onVisual: (dragging, into) => this.nodeRenderer.setDragVisual(dragging, into),
    })

    // 事件委托：整个图层只有这些监听器，与节点数量无关（第 2 章）
    this.registerDomEvent(nodeLayer, 'click', this.onLayerClick)
    this.registerDomEvent(this.canvas.viewport, 'contextmenu', this.onNodeMenu)
    this.registerDomEvent(this.canvas.viewport, 'dblclick', this.onDoubleClick)
    this.registerDomEvent(this.canvas.viewport, 'keydown', this.onKeyDown)
    this.registerDomEvent(this.canvas.viewport, 'pointerdown', () => this.motion.finish(), true)

    this.bridge = new DocumentBridge(this.app, this.onDocumentChange, this.host.fileHistory,
      file => this.canWriteFile(file))
    // 交给 this（ItemView 也是 Component）托管，视图关闭时监听自动解绑
    this.bridge.start(this)
    this.unsubscribePreferences = this.host.preferences.subscribe(() => this.syncLock(true))
    this.syncLock(true)

    // 样式变了就重绘。样式窗口拖滑块时也走这条 → 实时预览（M8）。
    // 变的可能是别篇笔记的单篇样式，跟自己无关时 resolveStyle 返回 false，一帧都不浪费。
    this.unsubscribeStyle = this.host.styles.subscribe(() => {
      this.styleChanged()
    })
    this.resolveStyle()

    // 【用事件自带的载荷判定】，不回头问 getActiveFile()：活动叶子不是笔记（比如导图自己）时，
    // Obsidian 会把「活动笔记」回退成别的标签页里最近活动的那篇，点一下导图就可能把图切走。
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        this.observeNoteMode()
        this.syncLock()
        void this.syncActiveFile(false, 'file-open', file)
      }),
    )
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        this.observeNoteMode()
        this.syncLock()
        const view = leaf?.view
        void this.syncActiveFile(false, 'leaf-change', view instanceof FileView ? view.file : null)
      }),
    )
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      this.observeNoteMode()
      this.syncLock()
    }))
    // 正在显示的这篇被删了。syncActiveFile 现在会忽略瞬时的「没有活动笔记」，
    // 所以这一路必须显式收尾，否则屏幕上会留着一张已经不存在的笔记的导图。
    this.registerEvent(
      this.app.vault.on('delete', (f) => {
        if (!this.file || (this.file.path !== f.path && !this.file.path.startsWith(`${f.path}/`))) return
        this.adoptFile(null)
        this.draw()
        const active = this.activeMarkdownFile()
        if (!this.pinned && (this.commandMap || !this.host.settings.lockFile) && active &&
            active.path !== f.path && !active.path.startsWith(`${f.path}/`)) {
          void this.syncActiveFile(false, 'delete', active)
        }
      }),
    )
    this.registerEvent(
      this.app.workspace.on('css-change', () => {
        // 换主题 / 改字号 → 测量全部作废
        this.font = null
        clearMeasureCache()
        this.draw()
      }),
    )

    this.ready = true

    // 该显示哪一篇：钉住的照办，否则活动笔记优先、存档路径只是回退。理由见 follow.ts，
    // 一句话是「后台的跟随型导图会被 Obsidian 整个卸载，醒来时它存的那一篇早就过时了」。
    const pending = this.pendingPath
    this.pendingPath = null
    const shown = pending !== null && (await this.showRestored(pending))
    if (!shown) await this.syncActiveFile(true, 'onOpen')
  }

  override async onClose(): Promise<void> {
    this.loadGeneration++
    for (const card of this.retainedBodies.keys()) await card.flush()
    if (this.bodyCard) await this.bodyCard.flush()
    this.closeBody()
    this.modeObserver?.disconnect()
    this.modeObserver = null
    this.modeContainers = []
    this.unsubscribePreferences?.()
    this.unsubscribePreferences = null
    this.host.preferences.flush()
    this.motion?.reset()
    this.clearSearch()
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
    this.ready = false
    this.pendingPath = null
    // 容器里的 DOM 一次清干净（M10 验收：开关视图 50 次不涨内存）。
    // 各个部件的 destroy 只负责自己挂上去的那些元素，剩下的空状态、图层容器由这里收尾。
    this.contentEl.empty()
  }

  /**
   * 视图尺寸变化时的一道兜底：顺手和活动笔记对一次表。
   *
   * 「导图没跟着笔记切换」还有一类成因是【事件根本没送到】：视图被折叠 / 卸载期间
   * 换过笔记，重新露出来时 Obsidian 不会补发 file-open，也就没有任何后续事件来纠正它。
   * 而「重新变得可见」必定伴随一次 resize，正好借它对表。
   *
   * 【这不是轮询】：`syncActiveFile` 头一行就是引用相等比较，笔记没换时它一个字都不做，
   * 更碰不到渲染路径。拖侧边栏宽度会连着触发几十次，代价也只是几十次指针比较。
   */
  override onResize(): void {
    void this.syncActiveFile(false, 'resize')
  }

  /**
   * 「跟随自检」命令的报告（命令面板里那一条）。
   *
   * 报的是事实，不是结论。三种成因在留痕上各自长什么样：
   * - 切笔记时留痕【一条都没多】→ 事件没送到这个视图（视图被卸载过、或被别的东西吃了）
   * - 留痕里「看到」的还是旧那篇 → `getActiveFile()` 给的是过时的
   * - 「看到」的是新那篇却写着没换 → 被某条规则挡下了，结论那一栏会写是哪条
   */
  diagnostics(): string {
    const ws = this.app.workspace
    const active = ws.getActiveFile()
    const alive = Math.round((Date.now() - this.bornAt) / 1000)
    return [
      t(
        'diag.title',
        this.leaf.getRoot() === ws.rootSplit ? t('diag.mainArea') : t('diag.sidebar'),
        alive,
      ),
      t('diag.activeNote', active?.path ?? t('diag.none')),
      t('diag.showing', (this.file?.path ?? t('diag.none')) + (this.tree ? '' : t('diag.treeEmpty'))),
      t(
        'diag.switches',
        this.host.settings.lockFile ? t('diag.on') : t('diag.off'),
        this.host.settings.clickToJump ? t('diag.on') : t('diag.off'),
      ),
      t('diag.pinned', this.pinned ? t('diag.on') : t('diag.off')),
      t('diag.trail', this.trail.length),
      ...(this.trail.length === 0 ? [t('diag.noEvents')] : this.trail.map((s) => `    ${s}`)),
    ].join('\n')
  }

  /**
   * 记一次「该不该换笔记」的判定。留痕带上来源与当时看到的活动笔记，
   * 「没送到」和「送到了但看到的是旧的」才分得开。
   */
  private note(source: string, active: TFile | null, outcome: string): void {
    const at = ((Date.now() - this.bornAt) / 1000).toFixed(1)
    this.trail.push(`+${at}s ${source} → ${active?.basename ?? t('diag.none')} → ${outcome}`)
    if (this.trail.length > 16) this.trail.shift()
  }

  /**
   * 适应画布。缩放比例按【当前容器尺寸】算——Canvas 的宽高来自 ResizeObserver，
   * 因此侧边栏被拖到多窄都是对的（M7 交付物）。
   *
   * 手动点「适应画布」是平滑移过去的（M10，受「优雅动画」开关控制）；
   * 打开笔记时的那次自动适应不带动画，见 draw() 末尾。
   */
  fitToScreen(): void {
    if (this.canvas.fit(this.bounds, true)) {
      this.needsFit = false
      this.initialViewport = undefined
      this.rememberViewport()
    }
  }

  /** 展开 / 折叠全部（M7 工具栏）。只有有子节点的节点需要改。 */
  private setAllCollapsed(collapsed: boolean): void {
    this.headingLevel = 0
    if (this.tree) clearHeadingFilter(this.tree)
    this.rememberLevel(0)
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
    this.rememberViewport()
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
    if (!collapsed) { this.headingLevel = 0; this.rememberLevel(0); if (this.tree) clearHeadingFilter(this.tree) }
    node.collapsed = collapsed
    this.draw()
    this.centerSubtree(node.id)
    this.rememberViewport()
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
    // 多彩标题：层级 class 常年在节点上，着不着色由根上的这一个开关说了算
    root.toggleClass('om-level-colors', next.colorByLevel)
    if (prev.background || next.background) root.style.setProperty('--om-custom-background', next.background ?? '')
    if (prev.edgeColor || next.edgeColor) root.style.setProperty('--om-custom-edge', next.edgeColor ?? '')
    for (let i = 0; (prev.levelColors || next.levelColors) && i < 6; i++) {
      const color = next.levelColors?.[i]
      const rgb = color?.slice(1).match(/../g)?.map(channel => parseInt(channel, 16)).join(', ')
      root.style.setProperty('--om-custom-level-' + (i + 1), rgb ?? '')
    }
    // 字号缩放变了 → 之前量出来的每一个宽高都作废
    if (changed && prev.fontScale !== next.fontScale) this.font = null
    this.style = next
    this.direction = next.direction
    return changed
  }

  private styleChanged(): void {
    const preview = this.host.styles.previewPath() === (this.file?.path ?? null)
    const current = !this.needsFit && this.boxes.size ? this.canvas.snapshot() : undefined
    if (preview && !this.previewingStyle) {
      this.styleViewport = current
      this.previewingStyle = true
    }
    // Reuse the pre-preview anchor throughout the draft and on Cancel. Coordinates
    // valid in the new layout stay put; otherwise restore chooses a visible fallback.
    const anchor = this.previewingStyle ? this.styleViewport : current
    if (this.resolveStyle()) {
      this.draw()
      if (anchor && this.canvas.restore(anchor, this.boxes.values())) {
        const restored = this.canvas.snapshot()
        if (restored && current && (restored.x !== current.x || restored.y !== current.y)) this.motion.finish()
      }
    }
    if (!preview) {
      this.previewingStyle = false
      this.styleViewport = undefined
    }
  }

  /** 打开样式窗口（M8）。没有笔记时窗口里只有「应用全局设置」可按。 */
  private openStyle(): void {
    const source = this.file
    new StyleModal(
      this.app,
      this.host.styles,
      this.file?.path ?? null,
      this.file?.basename ?? null,
      source ? async (format, background, scale, page, padding, expandAll) => {
        let exportLayer: HTMLElement | undefined
        try {
          if (this.file !== source || !this.ready) throw new Error('The source map changed')
          this.motion.finish()
          if (expandAll && this.tree) {
            const fullTree = parse(joinLines(this.tree.lines, this.tree.eol), this.parseOptions())
            const boxes = layout(fullTree, this.layoutOptions())
            const nodes = visibleNodes(fullTree)
            const bounds = boundsOf(boxes)
            exportLayer = this.contentEl.createDiv({ cls: 'om-content om-export-layer' })
            const connectors = new Connectors(exportLayer.createSvg('svg', { cls: 'om-svg' }))
            connectors.render(nodes, boxes, this.style.branch, bounds.x + bounds.w, bounds.y + bounds.h)
            const renderer = new NodeRenderer(exportLayer.createDiv({ cls: 'om-nodes' }))
            renderer.render(nodes, boxes, new Set(), rootSide(this.direction))
          }
          await exportMap(exportLayer ?? this.canvas.content, this.file?.basename ?? 'mindmap', format,
            background === 'white' || (format === 'pdf' && background === 'transparent') ? '#fff'
              : background === 'transparent' ? '' : this.style.background ?? getComputedStyle(this.contentEl)
                .getPropertyValue('--background-primary').trim(), scale, page, padding)
        } catch (error) {
          console.error(error)
          new Notice(t(error instanceof ExportSizeError ? 'style.exportTooLarge' : 'style.exportFailed'))
        } finally {
          exportLayer?.remove()
        }
      } : undefined,
      () => ({ width: Math.ceil(this.bounds.w), height: Math.ceil(this.bounds.h) }),
    ).open()
  }

  /** 解析 / 序列化选项。每次现取，改设置后下一次编辑立即生效。 */
  private parseOptions(): ParseOptions {
    return {
      strictLineBreak: this.host.settings.strictLineBreak,
      listNodes: this.host.settings.listNodes,
      orderedListNodes: this.host.settings.orderedListNodes,
      deepListMarker: this.host.settings.listNodes && this.host.settings.orderedListNodes
        ? this.host.settings.deepListMarker : this.host.settings.orderedListNodes ? '1.' : '-',
    }
  }

  // ── 数据 ────────────────────────────────────────────────────

  /**
   * 换到另一篇笔记（或空）时要重置的那一整套状态。
   *
   * syncActiveFile 与 showFile 共用这一份：两处各抄一遍的话，往后加一个字段
   * 只改了一边，就会出现「跟着活动笔记切换是干净的、手动指名切换却残留上一篇」这种鬼故事。
   */
  private adoptFile(next: TFile | null): void {
    this.loadGeneration++
    this.closeBody()
    this.canvas.cancelGesture()
    this.drag.cancel()
    this.motion?.reset()
    if (this.search?.path !== next?.path) this.clearSearch()
    this.cancelSession()
    this.file = next
    this.headingLevel = Number(this.app.loadLocalStorage?.('outline-mindmap:level:' + next?.path) ?? Math.max(0, this.host.settings.initialLevel))
    this.styleViewport = undefined
    this.previewingStyle = false
    if (!this.pinned) this.noteMode = 'source'
    this.initialViewport = next ? this.host.preferences.viewportFor(next.path) : undefined
    this.tree = null // 切换笔记即重置折叠态（第 4.5 节的 v1 决策）
    this.setSelection(null)
    this.pendingText = null
    this.needsFit = true
    this.bridge.setFile(next)
    // 换笔记就换样式：这一篇可能有自己的单篇样式（M8）
    this.resolveStyle()
    this.observeNoteMode()
    this.syncLock(true)
    // 刷新标签页标题。updateHeader 不在公开类型里，取不到就算了——标题旧一点不影响功能。
    ;(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.()
  }

  /** 当前活动笔记，非 Markdown 一律当没有。 */
  private activeMarkdownFile(): TFile | null {
    return markdownOnly(this.app.workspace.getActiveFile())
  }

  /**
   * @param force 视图刚打开时即使没有活动笔记也要走一遍，好把空状态画出来。
   * @param source 是谁叫的。只用于自检留痕，见 `note`。
   * @param candidate 事件自带的那篇（`file-open` 的参数、`active-leaf-change` 里叶子的文件）。
   *   不传才去问 `getActiveFile()`——只有没有事件载荷可用的兜底路径（打开、resize、删除）这么做。
   */
  private async syncActiveFile(
    force = false,
    source = '内部',
    candidate?: TFile | null,
  ): Promise<void> {
    const next = candidate === undefined ? this.activeMarkdownFile() : markdownOnly(candidate)
    // 钉住的导图（「打开为导图」换出来的）与全局「固定显示一篇笔记」（M7 设置项，键名仍是 lockFile）：
    // 都不跟着活动笔记走。force 那次是视图刚打开时的首次同步，必须放行——否则新开一个导图会是空的。
    if ((this.pinned || (!this.commandMap && this.host.settings.lockFile)) && this.file && !force) {
      this.note(source, next, t('trail.blockedByPin'))
      return
    }

    // 【瞬时的「没有活动笔记」不算换笔记】。切标签页、点一下侧边栏的空隙里，
    // getActiveFile() 会短暂地返回 null；照单全收就是把整张图清空重画一遍——
    // 折叠态和视野一起没，用户看到的是闪一下白。
    // 真正需要清空的只有「这篇被删了」，那一路由 vault 的 delete 监听带 force 进来。
    if (!next && !force) {
      this.note(source, next, t('trail.noActive'))
      return
    }
    if (next === this.file && !force) {
      this.note(source, next, t('trail.sameNote'))
      return
    }

    this.note(source, next, t('trail.switched', next?.basename ?? t('diag.none')))
    this.adoptFile(next)

    if (!next) {
      this.draw()
      return
    }

    // 先把上一篇的画面清掉：读取是异步的，不清的话这段空隙里屏幕上还是上一篇的导图
    this.draw()

    const generation = ++this.loadGeneration
    const text = await this.bridge.loadText(next)
    // 【读取期间可能又换了一篇】。A→B 快速切换时，若 A 的读取比 B 慢，
    // A 的后手回来会把 A 的文本刷进 B 的视图，画面就永久停在上一篇上（不会自愈）。
    // 身份对不上就直接丢弃——B 自己那一次同步会把正确的内容刷进来。
    if (generation !== this.loadGeneration || this.file !== next) return
    this.refresh(text)
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
    this.loadGeneration++
    const geometry = (tree: MindTree | null): string => tree ? [...tree.byId.values()].map(n => JSON.stringify([n.id, n.text, n.depth, n.parent?.id, n.collapsed, n.viewHidden])).join('|') : ''
    const previousGeometry = geometry(this.tree)
    this.tree = reconcile(this.tree, parse(text, this.parseOptions()))
    if (this.headingLevel > 0) showHeadingLevel(this.tree, this.headingLevel)
    // 被别处删掉的节点不能继续留在选中集合里，否则删除/拖拽会拿着不存在的 id 去生成 plan
    this.syncBody()
    const activeCard = this.bodyCard, activeSession = this.bodySession
    for (const [card, session] of this.retainedBodies) {
      this.bodyCard = card; this.bodySession = session; this.syncBody()
    }
    this.bodyCard = activeCard; this.bodySession = activeSession
    const byId = this.tree.byId
    for (const id of [...this.selection]) if (!byId.has(id)) this.selection.delete(id)
    if (this.focusId !== null && !byId.has(this.focusId)) {
      this.focusId = null
      if (this.search) this.search.pending = true
    }
    if (this.search && !this.search.pending && !searchTargets(this.tree, this.search.state)) this.clearSearch()
    if (this.search) this.applySearch()
    else if (this.boxes.size && previousGeometry === geometry(this.tree)) {
      this.nodeRenderer.setBodyIndicators(this.host.settings.nodeBody ? bodyIndicators(this.tree) : new Set())
    } else this.draw()
  }

  /** 编辑结束后补上编辑期间被挡下的外部变更。 */
  private flushPending(): void {
    const text = this.pendingText
    if (text === null || this.session) return
    this.pendingText = null
    this.refresh(text)
  }

  /**
   * 设置里的解析选项变了（「把列表项显示为节点」）：按新规则重新解析当前笔记。
   * 折叠态与节点 id 由 reconcile 保住；正在编辑时不开进来（开关在设置页，点它时编辑框已收起）。
   */
  async reparse(): Promise<void> {
    if (!this.host.settings.nodeBody) this.closeBody()
    const file = this.file
    if (!file) return
    const generation = ++this.loadGeneration
    const text = await this.bridge.readText(file)
    if (generation !== this.loadGeneration || this.file?.path !== file.path) return // 读取期间换了笔记，那一路自己会刷
    this.refresh(text)
    this.draw()
  }

  // ── 渲染 ────────────────────────────────────────────────────

  private draw(): void {
    const tree = this.tree
    const hasContent = tree !== null && tree.root.children.length > 0
    this.empty.toggleClass('is-visible', !hasContent)
    const motionAllowed = this.host.settings.gracefulAnimation && !this.reducedMotion?.matches
    if (!tree || !hasContent) {
      this.motion.reset()
      this.nodeRenderer.render([], new Map(), this.selection, rootSide(this.direction))
      this.connectors.render([], new Map(), this.style.branch, 0, 0)
      this.boxes = new Map()
      this.order = []
      this.bounds = { x: 0, y: 0, w: 0, h: 0 }
      return
    }

    this.toolbar.setFolded([...tree.byId.values()].some(n => n.collapsed || n.viewHidden))
    this.contentEl.toggleClass('om-body-enabled', this.host.settings.nodeBody)
    const boxes = layout(tree, this.layoutOptions())
    const nodes = visibleNodes(tree)
    const bodyIds = this.host.settings.nodeBody ? bodyIndicators(tree) : new Set<string>()
    const animated = motionAllowed && nodes.length <= MOTION_NODE_LIMIT
    this.canvas.setAnimated(animated)
    this.boxes = boxes
    this.order = nodes.map((n) => n.id)
    this.bounds = boundsOf(boxes)
    // Keep logical hit targets at their final positions. Pointer interaction finishes
    // the short transition before hit-testing, so edits never use intermediate geometry.
    this.motion.update(boxes, animated && !this.needsFit && !this.session && !this.drag.active, frame => {
      this.nodeRenderer.render(nodes, frame, this.selection, rootSide(this.direction))
      this.nodeRenderer.setBodyIndicators(bodyIds)
      const bounds = boundsOf(frame)
      this.connectors.render(nodes, frame, this.style.branch, bounds.x + bounds.w, bounds.y + bounds.h)
    })

    this.initializeViewport()
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
      measure: (node) => { const box = measureNode(node.text, font); return this.host.settings.nodeBody ? { ...box, w: box.w + 24 } : box },
    }
  }

  /** 字体只从 CSS 变量读一次，之后缓存；css-change 与字号缩放变化时作废。 */
  private currentFont(): FontSpec {
    if (this.font) return this.font
    const font = readFont(this.contentEl, this.style.fontScale)
    // DOM 必须用与测量完全相同的字体，否则折行结果对不上
    this.contentEl.setCssProps({
      '--om-font-family': font.family,
      '--om-font-size': `${font.size}px`,
      '--om-line-height': `${font.lineHeight}px`,
      // 折叠按钮跟着字号缩放走（M11）。命中区是 CSS 里另外撑出来的，与这个直径无关
      '--om-toggle-size': `${toggleSize(this.style.fontScale)}px`,
    })
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
    if (!tree || tree.root.children.length === 0) return t('perf.noNote')

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
      t('perf.title', nodes),
      t('perf.layout', ms(layoutMs)),
      t('perf.cold', ms(coldMs)),
      t('perf.warm', ms(warmMs)),
      coldMs > 500 ? t('perf.needsVirtualize') : t('perf.ok'),
    ].join('\n')
  }

  /** 把某个节点带进视野。最小平移，留 40px 边距（M5 交付物）。 */
  private reveal(id: string | null): void {
    const box = id === null ? undefined : this.boxes.get(id)
    if (box) this.canvas.ensureVisible(box)
    this.rememberViewport()
  }

  // ── 鼠标 ────────────────────────────────────────────────────

  private readonly onLayerClick = (e: MouseEvent): void => {
    // 拖拽松手后浏览器还会补一个 click，不吃掉它就会顺手跳转到笔记里去
    if (this.drag.consumeClick()) return

    const target = e.target as HTMLElement
    const host = target.closest<HTMLElement>('.om-node')
    const id = host?.dataset['nodeId']
    if (!id || !this.tree) return
    const node = this.tree.byId.get(id)
    if (!node) return

    if (target.closest('.om-body-button')) { void this.openBody(node); return }
    if (target.closest('.om-toggle')) {
      if (node.children.length === 0) return
      this.setCollapsed(node, !node.collapsed)
      return
    }

    // Ctrl/⌘ + 左键 = 加选 / 减选（M6，为批量删除服务）。加选时不跳转：
    // 正在攒一批要删的节点，编辑器却在一路乱滚，很吵。
    if (e.ctrlKey || e.metaKey) {
      this.toggleSelection(id)
      this.nodeRenderer.setSelection(this.selection)
      this.canvas.focus()
      return
    }

    this.select(id)
    // 焦点必须留在导图上，否则后面的快捷键全废
    this.canvas.focus()
    if (this.host.settings.clickToJump && this.file && !this.session) {
      this.jumpTo(node.titleLine)
    }
  }

  private readonly onDoubleClick = (e: MouseEvent): void => {
    if ((e.target as HTMLElement).closest('.om-toggle, .om-body-button')) return
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

  /**
   * 跳转到笔记对应行。
   *
   * 【只滚已经露着的编辑器】：笔记没开、或压在别的标签页后面时，这一下什么都不做。
   * 于是「打开为导图」天然就是纯导图模式——那个叶子里已经没有编辑器了，点节点只选中。
   * 不抢焦点、不新开标签页，细节见 DocumentBridge.revealLine。
   */
  private jumpTo(line: number): void {
    const file = this.file
    if (!file || line < 0) return
    this.bridge.revealLine(file, line)
  }

  // ── 键盘（M5）───────────────────────────────────────────────

  /**
   * 导图的快捷键。编辑态下的按键由 InlineEditor 自己吃掉并 stopPropagation，
   * 传不到这里；`editor.active` 那一行是兜底。
   */
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.motion?.finish()
    if (this.editor.active || e.isComposing || (e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable=true], .cm-editor')) return
    // 拖拽中按 Esc = 放弃这次拖拽，文件一个字都不写
    if (e.key === 'Escape' && this.drag.active) {
      e.preventDefault()
      this.drag.cancel()
      return
    }
    const mod = e.ctrlKey || e.metaKey

    if (mod && !e.altKey && (e.key.toLowerCase() === 'z' ||
        (!e.shiftKey && e.key.toLowerCase() === 'y'))) {
      e.preventDefault()
      e.stopPropagation()
      void this.stepHistory(e.shiftKey || e.key.toLowerCase() === 'y' ? 'redo' : 'undo')
      return
    }
    if (this.historyBusy) { e.preventDefault(); return }
    if (mod && !e.altKey && ['c', 'x', 'v'].includes(e.key.toLowerCase())) {
      e.preventDefault(); e.stopPropagation(); void this.clipboardAction(e.key.toLowerCase(), e.shiftKey); return
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
    this.nodeRenderer.setSelection(this.selection)
    if (this.bodyCard?.pinned && !this.bodyCard.retained && this.bodySession?.range.start !== (this.tree?.byId.get(id)?.titleLine ?? -2) + 1) {
      const node = this.tree?.byId.get(id); if (node) void this.openBody(node, true, false)
    }
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
    this.bodyOpenGeneration++
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

  private async stepHistory(direction: HistoryDirection): Promise<void> {
    if (!this.canEdit()) return
    const file = this.file
    if (!file || this.session) return
    this.drag.cancel()
    this.historyBusy++
    try {
      const result = await this.bridge.historyStep(file, direction)
      if (result === 'conflict') new Notice(t('notice.historyConflict'))
      else if (result === 'empty') new Notice(t(direction === 'undo' ? 'notice.cannotUndo' : 'notice.cannotRedo'))
    } catch (err) {
      this.onWriteFailed(err, file)
    } finally {
      this.historyBusy--
    }
  }

  // ── 编辑会话 ────────────────────────────────────────────────

  private readonly onNodeMenu = (event: MouseEvent): void => {
    if (this.session || !(event.target instanceof Element)) return
    const id = event.target.closest<HTMLElement>('.om-node')?.dataset.nodeId
    if (!id || !this.tree?.byId.has(id)) return
    const { orderedListNodes, listNodes } = this.host.settings

    event.preventDefault()
    const menu = new Menu()
    if (!this.selection.has(id)) this.setSelection(id)
    else this.focusId = id
    this.bodyOpenGeneration++
    this.nodeRenderer.setSelection(this.selection)
    const target = this.tree.byId.get(id)!
    const act = (action: string, sibling = false) => { this.focusId = id; void this.clipboardAction(action, sibling) }
    if (this.host.settings.nodeBody) menu.addItem(item => item.setTitle(label('正文', 'Body')).setIcon('file-text').onClick(() => { void this.openBody(target) }))
    menu.addSeparator()
    menu.addItem(item => item.setTitle(label('复制', 'Copy')).setIcon('copy').onClick(() => act('c')))
    menu.addItem(item => item.setTitle(label('剪切', 'Cut')).setIcon('scissors').setDisabled(!this.canEdit()).onClick(() => act('x')))
    menu.addItem(item => {
      item.setTitle(label('粘贴', 'Paste')).setIcon('clipboard-paste').setDisabled(!this.canEdit())
      const nested = item as typeof item & { setSubmenu?: () => Menu }
      const sub = nested.setSubmenu?.() ?? new Menu()
      if (!nested.setSubmenu) item.onClick(() => sub.showAtMouseEvent(event))
      sub.addItem(entry => entry.setTitle(label('作为子节点', 'As child')).onClick(() => act('v')))
      sub.addItem(entry => entry.setTitle(label('作为同级节点', 'As sibling')).onClick(() => act('v', true)))
    })
    menu.addItem(item => {
      item.setTitle(label('更多', 'More')).setIcon('ellipsis')
      const nested = item as typeof item & { setSubmenu?: () => Menu }
      const sub = nested.setSubmenu?.() ?? new Menu()
      if (!nested.setSubmenu) item.onClick(() => sub.showAtMouseEvent(event))
      sub.addItem(entry => entry.setTitle(label('编辑标题', 'Edit title')).setDisabled(!this.canEdit()).onClick(() => this.beginRename(id)))
      sub.addItem(entry => entry.setTitle(label('仅复制标题', 'Copy title')).onClick(() => { void this.contentEl.ownerDocument.defaultView!.navigator.clipboard.writeText(target.text).catch(error => this.report(error)) }))
      if (orderedListNodes) sub.addItem(entry => entry.setTitle(t('menu.addOrdered')).setDisabled(!this.canEdit()).onClick(() => this.beginDraft({ type: 'child', parentId: id, marker: '1.' })))
      if (listNodes) sub.addItem(entry => entry.setTitle(t('menu.addUnordered')).setDisabled(!this.canEdit()).onClick(() => this.beginDraft({ type: 'child', parentId: id, marker: '-' })))
    })
    menu.addSeparator()
    menu.addItem(item => item.setTitle(label('删除', 'Delete')).setIcon('trash-2').setDisabled(!this.canEdit()).onClick(() => this.removeSelected()))
    menu.showAtMouseEvent(event)
  }

  private async clipboardAction(action: string, sibling = false): Promise<void> {
    const tree = this.tree, file = this.file
    if (!tree || !file || this.session) return
    try {
      if (action === 'c' || action === 'x') {
        if (action === 'x' && !this.canEdit()) return
        const nodes = selectedBranches(tree, this.selection)
        if (!nodes.length) return
        const text = copyBranches(tree, this.selection)
        await this.contentEl.ownerDocument.defaultView!.navigator.clipboard.writeText(text)
        MindmapView.clipboardSource = { text, path: file.path }
        if (action === 'x') {
          if (this.file !== file || this.tree !== tree) throw new Error('笔记已更新，已复制但未剪切')
          this.applyEdit(removeSubtree(tree, nodes.map(n => n.id)))
        }
        return
      }
      if (!this.canEdit()) return
      const parent = this.selectedNode()
      const text = await this.contentEl.ownerDocument.defaultView!.navigator.clipboard.readText()
      if (!text.trim()) return
      if (this.file !== file || this.tree !== tree) throw new Error('笔记已更新，请重新粘贴')
      if (!this.canEdit()) return
      const source = MindmapView.clipboardSource
      const content = source?.text === text && source.path !== file.path ? this.rebaseClipboardLinks(text, source.path, file.path) : text
      const plan = pastePlan(tree, parent, content, this.parseOptions(), sibling)
      if (parent && !sibling) parent.collapsed = false
      this.applyEdit(plan)
    } catch (error) { this.report(error) }
  }

  private rebaseClipboardLinks(text: string, source: string, target: string): string {
    // Fenced and inline code stays literal; links outside code use Obsidian's resolver.
    let fence: string | null = null
    return text.split('\n').map(line => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
      if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null; return line }
      if (fence) return line
      return line.replace(/(`+)([^`]*?)\1|!?\[\[([^\]]+)\]\]|!?\[([^\]]*)\]\(([^\s)]+)\)/g, (all, ticks: string | undefined, _code: string, wiki: string | undefined, alias: string, url: string) => {
        if (ticks) return all
        const raw = wiki?.split('|')[0] ?? url
        if (!raw || /^(?:[a-z]+:|#|\/)/i.test(raw)) return all
        const hash = raw.indexOf('#'), link = hash < 0 ? raw : raw.slice(0, hash), subpath = hash < 0 ? '' : raw.slice(hash)
        let decoded = link
        try { decoded = decodeURIComponent(link) } catch { return all }
        const file = this.app.metadataCache.getFirstLinkpathDest(decoded, source)
        if (!file) return all
        const caption = wiki?.includes('|') ? wiki.slice(wiki.indexOf('|') + 1) : wiki ? undefined : alias
        return (all.startsWith('!') ? '!' : '') + this.app.fileManager.generateMarkdownLink(file, target, subpath, caption)
      })
    }).join('\n')
  }

  async runAction(action: string): Promise<void> {
    const active = this.contentEl.ownerDocument.activeElement
    if (active?.closest('input, textarea, [contenteditable=true], .cm-editor')) return
    if (action === 'copy') return this.clipboardAction('c')
    if (action === 'cut') return this.clipboardAction('x')
    if (action === 'paste') return this.clipboardAction('v')
    if (action === 'paste-sibling') return this.clipboardAction('v', true)
    const node = this.selectedNode()
    if (action === 'copy-title' && node) {
      try { await this.contentEl.ownerDocument.defaultView!.navigator.clipboard.writeText(node.text) } catch (error) { this.report(error) }
    }
    if (action === 'body' && node) await this.openBody(node)
    if (action === 'rename' && node) this.beginRename(node.id)
    if (action === 'expand') this.setAllCollapsed(false)
    if (action === 'collapse') this.setAllCollapsed(true)
    if (/^level-[1-6]$/.test(action)) this.chooseLevel(Number(action.slice(-1)))
    if (action === 'undo' || action === 'redo') await this.stepHistory(action)
  }

  private rememberLevel(level: number): void {
    if (this.file) this.app.saveLocalStorage?.('outline-mindmap:level:' + this.file.path, level)
  }
  private chooseLevel(level: number): void {
    if (!this.tree) return
    this.headingLevel = level; showHeadingLevel(this.tree, level); this.rememberLevel(level)
    this.setSelection(null); this.draw()
  }
  private openFoldMenu(event: MouseEvent): void {
    const menu = new Menu()
    menu.addItem(item => item.setTitle(t('tool.expand')).onClick(() => this.setAllCollapsed(false)))
    menu.addItem(item => item.setTitle(t('tool.collapse')).onClick(() => this.setAllCollapsed(true)))
    menu.addSeparator()
    for (let level = 1; level <= 6; level++) menu.addItem(item => item
      .setTitle(label(`标题显示到 H${level}`, `Headings through H${level}`)).setChecked(this.headingLevel === level)
      .onClick(() => this.chooseLevel(level)))
    menu.showAtMouseEvent(event)
  }

  private closeBody(): void {
    for (const card of this.retainedBodies.keys()) this.removeChild(card)
    this.retainedBodies.clear()
    this.bodyOpenGeneration++
    if (this.bodyCard) this.removeChild(this.bodyCard)
    this.bodyCard = null; this.bodySession = null
  }

  private syncBody(): void {
    const session = this.bodySession, card = this.bodyCard, tree = this.tree
    if (!session || !card || !tree || session.file !== this.file || session.writing) return
    const range = rebaseBody(session.base, tree.lines, session.range)
    if (range) {
      session.range = range; session.base = [...tree.lines]
      card.update(readBody(tree.lines, range)); return
    }
    // Refresh an unchanged title at the same line only in read/clean mode.
    const node = [...tree.byId.values()].find(n => n.titleLine === session.range.start - 1 && n.text === session.title)
    if (!card.dirty && node && session.base.slice(0, node.titleLine + 1).every((line, i) => line === tree.lines[i])) {
      session.range = bodyRange(tree, node); session.base = [...tree.lines]
      card.update(readBody(tree.lines, session.range))
    } else card.markConflict()
  }

  private async openBody(node: MindNode, restore = true, focus = true): Promise<void> {
    if (!this.host.settings.nodeBody || !this.file || !this.tree) return
    for (const [card, session] of this.retainedBodies) {
      if (session.file === this.file && session.range.start === node.titleLine + 1) {
        card.el.parentElement?.appendChild(card.el)
        if (focus) card.el.querySelector('textarea')?.focus({ preventScroll: true })
        return
      }
    }
    const request = ++this.bodyOpenGeneration
    const file = this.file, nodeId = node.id
    const pinned = this.bodyCard?.pinned ?? false
    if (this.bodyCard && !await this.bodyCard.flush()) return
    if (this.file !== file || !this.tree || request !== this.bodyOpenGeneration) return
    const currentNode = this.tree.byId.get(nodeId)
    if (!focus && this.focusId !== nodeId) return
    if (!currentNode) return
    node = currentNode
    if (this.bodyCard && this.bodySession && this.bodyCard.retained) {
      this.bodyCard.setPinned(false)
      this.retainedBodies.set(this.bodyCard, this.bodySession)
    } else if (this.bodyCard) this.removeChild(this.bodyCard)
    this.bodyCard = null; this.bodySession = null
    const range = bodyRange(this.tree, node)
    const session = { file, base: [...this.tree.lines], range, title: node.text, writing: false }
    this.bodySession = session
    const key = 'outline-mindmap:body-draft:' + file.path + ':' + node.titleLine
    const source = readBody(session.base, range)
    const recovered: unknown = this.app.loadLocalStorage(key)
    const draft = restore && recovered && typeof recovered === 'object' &&
      'text' in recovered && typeof recovered.text === 'string' && 'title' in recovered && recovered.title === node.text ? recovered.text : undefined
    const card = new BodyCard(this.contentEl, this.app, file.path, node.text, source, this.canEdit(), {
      draft: value => { this.app.saveLocalStorage(key, value === null ? null : { text: value, title: session.title, source: readBody(session.base, session.range) }) },
      close: () => {
        this.retainedBodies.delete(card); this.removeChild(card)
        if (this.bodyCard === card) { this.bodyCard = null; this.bodySession = null }
        this.canvas.focus()
      },
      reload: () => {
        const current = this.tree && [...this.tree.byId.values()].find(n => n.titleLine === session.range.start - 1 && n.text === session.title)
        this.retainedBodies.delete(card); this.removeChild(card)
        if (this.bodyCard === card) { this.bodyCard = null; this.bodySession = null }
        if (current) void this.openBody(current, false)
        else new Notice(label('节点已变化，草稿保存在本机，请重新选择原节点。', 'The node changed. The draft remains on this device. Select the source node again.'))
      },
      write: async value => {
        if (this.file !== file || !this.canEdit()) throw new Error(label('笔记已切换或锁定，草稿已保留', 'Note changed or locked; draft preserved'))
        const current = await this.bridge.readText(file)
        const parsed = parse(current, this.parseOptions())
        const rebased = rebaseBody(session.base, parsed.lines, session.range)
        if (!rebased) throw new Error(label('原文已更新，请保留草稿后重新载入', 'Source changed. Keep the draft and reload.'))
        session.base = parsed.lines; session.range = rebased
        const plan = bodyPlan(rebased, value)
        session.writing = true
        try {
          await this.bridge.applyPlan(file, session.base, plan, parsed.eol)
          session.base = applyPlan(session.base, plan)
          session.range = { ...rebased, end: rebased.start + plan[0]!.lines.length }
          if (this.file === file) this.refresh(joinLines(session.base, parsed.eol))
        } finally { session.writing = false }
      },
    }, draft)
    this.bodyCard = card; this.addChild(card)
    card.setPinned(pinned)
    card.el.addEventListener('pointerdown', () => {
      for (const element of Array.from(this.contentEl.querySelectorAll<HTMLElement>('.om-body-card'))) element.style.zIndex = '20'
      card.el.style.zIndex = '21'
    })
    if (focus) card.el.querySelector('textarea')?.focus({ preventScroll: true })
    if (focus) { this.setSelection(node.id); this.nodeRenderer.setSelection(this.selection) }
    if (draft !== undefined && recovered && typeof recovered === 'object' && 'source' in recovered && recovered.source !== source) card.markConflict()
    const anchor = this.contentEl.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`)
    if (anchor) {
      const rect = anchor.getBoundingClientRect(), host = this.contentEl.getBoundingClientRect()
      card.el.style.left = `${Math.max(12, Math.min(rect.right - host.left + 12, host.width - 432))}px`
      card.el.style.top = `${Math.max(56, Math.min(rect.top - host.top, host.height - 300))}px`
    }
  }

  private startSibling(): void {
    const node = this.selectedNode()
    // 没有选中（空笔记、刚打开）时回车 = 新建一个自由根
    if (!node) this.beginDraft({ type: 'root' })
    else this.beginDraft({ type: 'sibling', refId: node.id })
  }

  private startChild(): void {
    const node = this.selectedNode()
    if (!node) return
    // 「忽略列表节点」开着时第 6 层下没法再挂子节点：列表语法会被解析回正文，
    // 写进去就是一棵看不见的子树。用用户的语言拦在编辑框打开之前。
    if (!this.host.settings.listNodes && !this.host.settings.orderedListNodes && node.depth >= 6) {
      new Notice(t('notice.listNodesRequired'))
      return
    }
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
    if (!this.canEdit() || this.historyBusy) return
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
      index = intent.marker ? 0 : parent.children.length
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
    if (!this.canEdit() || this.historyBusy) return
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
    if (!this.canEdit()) return
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
    if (!this.canEdit()) { this.cancelSession(); this.flushPending(); return }
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
    const node = this.applyEdit(outcome.plan, (t) => resolveAt(t, outcome.parentId, outcome.index), text.trim())
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
    if (!this.canEdit()) return
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
    if (!this.canEdit()) return
    const tree = this.tree
    if (!tree || !this.file) return

    // 同 startChild 的拦截，但要看整棵子树：标题层级跳跃被保留（A.3），
    // 父挪深一层可能把某个后代推过第 6 层。core 里的同名断言只是兜底。
    if (!this.host.settings.listNodes && !this.host.settings.orderedListNodes) {
      const node = tree.byId.get(dragId)
      const parentDepth = result.parentId === null ? 0 : (tree.byId.get(result.parentId)?.depth ?? 0)
      if (node && parentDepth + 1 + maxDepthDrop(node) >= 7) {
        new Notice(t('notice.listNodesRequired'))
        return
      }
    }

    let plan: EditPlan
    try {
      plan = moveSubtree(tree, dragId, result.parentId, result.index, this.parseOptions())
    } catch (err) {
      this.report(err)
      return
    }
    // 换了一棵新树，被移动的节点要按结构位置重新找（它的 id 由 reconcile 保住，但对象是新的）
    const node = this.applyEdit(plan, (t) => resolveAt(t, result.parentId, result.index), tree.byId.get(dragId)?.text)
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
  private applyEdit(plan: EditPlan, locate?: (tree: MindTree) => MindNode | null, expectedText?: string): MindNode | null {
    if (!this.canEdit()) return null
    const tree = this.tree
    const file = this.file
    if (!tree || !file || plan.length === 0 || this.historyBusy) return null
    const base = tree.lines
    const eol = tree.eol

    let text: string
    try {
      text = joinLines(applyPlan(base, plan), eol)
    } catch (err) {
      this.report(err)
      return null
    }
    if (locate && expectedText !== undefined) {
      const parsed = reconcile(tree, parse(text, this.parseOptions()))
      if (locate(parsed)?.text !== expectedText) {
        new Notice(t('notice.invalidStructure'))
        this.draw()
        return null
      }
    }
    this.refresh(text)

    // refresh 之后 this.tree 已经是写入后的那棵树，目标节点的行号才是笔记该停的位置。
    // 跟随受「单击即跳转」管：关掉那个开关的人本来就不想让编辑器跟着导图动。
    const target = this.tree && locate ? locate(this.tree) : null
    const reveal = target && this.host.settings.clickToJump ? target.titleLine : undefined
    this.bridge
      .applyPlan(file, base, plan, eol, reveal)
      .catch((err: unknown) => this.onWriteFailed(err, file))
    return target
  }

  /**
   * 写盘失败（多半是文件在别处被改过、行号已失效）。
   *
   * 此时内存里的树是「我们以为的样子」，和磁盘不一致，必须以文件为准重新来过。
   */
  private onWriteFailed(err: unknown, file: TFile): void {
    if (this.file !== file || !this.ready) { this.report(err); return }
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
      const text = await this.bridge.settledText(file)
      if (this.file === file && this.ready) this.refresh(text)
    } finally {
      this.resyncing = false
    }
  }

  private report(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err)
    new Notice(t('notice.operationAborted', msg))
    console.error('[outline-mindmap]', err)
  }
}

/** 只认 Markdown 笔记；PDF、图片、Canvas 之类的文件视图一律当没有。 */
function markdownOnly(file: TFile | null): TFile | null {
  return file && file.extension === 'md' ? file : null
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
