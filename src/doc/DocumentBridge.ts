/**
 * 唯一接触 Obsidian 文件 API 的地方。见 操作手册.md 第 4.2、4.4 节。
 *
 * 职责：
 * - 把 EditPlan 写回文件，按「是否在编辑器中打开」选择写入路径
 * - 防回环：区分「自己写的」与「用户敲的」
 * - 文件变更 → 16ms 防抖 + rAF 合并 → 回调
 *
 * 不做解析、不做渲染、不持有树。
 */

import {
  MarkdownView,
  TFile,
  type App,
  type Component,
  type Editor,
  type WorkspaceLeaf,
} from 'obsidian'
import type { EditorView } from '@codemirror/view'
import { applyPlan as applyPlanToLines } from '../core/editplan'
import { joinLines, splitLines } from '../core/parser'
import type { EditPlan } from '../core/types'
import { planToChanges } from './changes'
import { clearHighlight, revealAndHighlight } from './highlight'
import { clearPreviewHighlight, revealPreviewLine } from './preview'
import { FileHistory, type HistoryDirection } from './FileHistory'

export interface DocumentChange {
  file: TFile
  text: string
  /** true 表示这次变更是本插件自己写进去的，视图可以据此跳过滚动 / 抢焦点之类的副作用。 */
  selfOriginated: boolean
}

/** FNV-1a 32 位。只用来判断「是不是我刚写的那份内容」，不需要抗碰撞。 */
function hashText(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 防抖窗口。不要改成 setTimeout(300)——那是肉眼可见的延迟。 */
const DEBOUNCE_MS = 16
/** 待确认的自写 hash 保留条数。一个防抖窗口内最多也就连打这么几次。 */
const PENDING_LIMIT = 16
/** 长文档阅读模式给 Obsidian 渲染目标区块的最长等待时间。 */
const PREVIEW_REVEAL_TIMEOUT_MS = 1000

export class DocumentBridge {
  private file: TFile | null = null
  private timer: number | null = null
  private frame: number | null = null
  /**
   * 本插件刚写进去的内容的 hash。
   *
   * 是【一串】而不是一个：M5 的连续按键会在一次防抖窗口里连着写好几次，
   * 只记最后一次的话，前几次的回声会被当成「用户改的」，把视图打回旧状态。
   */
  private pending: { path: string; hashes: number[] } | null = null
  /** 当前有本插件行高亮的文件。 */
  private highlighted: TFile | null = null
  /** 阅读模式下当前高亮的渲染块。 */
  private highlightedPreview: HTMLElement | null = null
  /** 长文档的目标区块可能尚未渲染；下面四项共同托管一次有界等待。 */
  private previewObserver: MutationObserver | null = null
  private previewRevealFrame: number | null = null
  private previewRevealTimeout: number | null = null
  private previewRevealToken = 0
  private readonly unsubscribeHistory: () => void
  private changeVersion = 0

  constructor(
    private readonly app: App,
    private readonly onChange: (change: DocumentChange) => void,
    private readonly history = new FileHistory<TFile>(),
  ) {
    this.unsubscribeHistory = history.subscribe((file, text) => {
      if (this.file !== file) return
      this.changeVersion++
      this.pending = null
      this.onChange({ file, text, selfOriginated: false })
    })
  }

  /**
   * 注册文件监听。交给 owner.registerEvent 托管，owner 卸载时自动解绑。
   *
   * owner 一般是【视图】而不是插件——视图关掉监听就该跟着没，挂在插件上会一直留到卸载插件。
   */
  start(owner: Component): void {
    owner.registerEvent(
      this.app.workspace.on('editor-change', (_editor, info) => {
        if (info.file) this.schedule(info.file)
      }),
    )
    owner.registerEvent(
      this.app.vault.on('modify', (f) => {
        if (f instanceof TFile) this.schedule(f)
      }),
    )
  }

  /** 设定当前关注的文件；其余文件的变更一律忽略。 */
  setFile(file: TFile | null): void {
    this.changeVersion++
    this.file = file
    this.cancelScheduled()
    this.pending = null
    // 换笔记了，上一篇里的高亮该跟着走
    this.clearHighlight()
  }

  /** 事件监听由 owner.registerEvent 托管，这里清掉未触发的定时器和残留的高亮。 */
  dispose(): void {
    this.changeVersion++
    this.unsubscribeHistory()
    this.cancelScheduled()
    this.clearHighlight()
  }

  // ── 写入（第 4.4 节）────────────────────────────────────────

  /**
   * 应用一个 EditPlan。
   *
   * `base` 是生成 plan 时的行快照（`MindTree.lines`）。写入前会逐行核对被触及的范围
   * 是否仍与 base 一致——不一致说明文件在别处被改过，行号已失效，此时【放弃写入并抛错】，
   * 宁可让用户重来一次，也绝不按错的行号动他的笔记。
   *
   * @param reveal 写完之后把编辑器滚到这一行并高亮（0-based，写入【之后】的行号）。
   *   不传就不滚。见 `revealAfterWrite` 里的陷阱 16。
   */
  async applyPlan(
    file: TFile,
    base: string[],
    plan: EditPlan,
    eol: '\n' | '\r\n',
    reveal?: number,
  ): Promise<void> {
    if (plan.length === 0) return
    this.changeVersion++

    // 排队：`vault.process` 是异步的，两次写入撞在一起时后一次的 base 会失效。
    // 视图那边是同步连打的（连按 10 次回车），这条队列是它的安全网。
    try {
      await this.history.run(file, () => this.write(file, base, plan, eol, reveal))
    } catch (err) {
      this.pending = null
      throw err
    }
  }

  private async write(
    file: TFile,
    base: string[],
    plan: EditPlan,
    eol: '\n' | '\r\n',
    reveal?: number,
  ): Promise<void> {
    const nextText = joinLines(applyPlanToLines(base, plan), eol)
    this.remember(file, hashText(nextText))

    const editor = this.editorFor(file)
    if (editor) {
      this.history.clear(file)
      const current = splitLines(editor.getValue())
      assertUnchanged(base, current, plan)
      // 一个用户操作 = 一个事务，保证 Ctrl+Z 一次撤销（陷阱 15）
      editor.transaction({ changes: planToChanges(current, plan, eol) })
      this.revealAfterWrite(file, editor, reveal)
      return
    }

    let before = ''
    let after = ''
    await this.app.vault.process(file, (data) => {
      // An editor may have opened while the asynchronous file operation waited.
      if (this.editorFor(file)) throw new Error('笔记已在编辑器中打开，请重试')
      const current = splitLines(data)
      if (base.length !== current.length || base.some((line, i) => line !== current[i])) {
        throw new Error('笔记已在别处修改，本次操作已取消')
      }
      before = data
      after = joinLines(applyPlanToLines(current, plan), eol)
      return after
    })
    this.history.record(file, before, after)
  }

  /**
   * Editor-owned history stays in the editor. File history is shared and serialized
   * with edits; exact-content checks prevent undo from overwriting external changes.
   */
  historyStep(file: TFile, direction: HistoryDirection): Promise<'ok' | 'empty' | 'conflict'> {
    return this.history.run(file, async () => {
      const editor = this.editorFor(file)
      if (editor) {
        this.history.clear(file)
        if (direction === 'undo') editor.undo()
        else editor.redo()
        this.pending = null
        this.history.publish(file, editor.getValue())
        return 'ok'
      }
      const entry = this.history.peek(file, direction)
      if (!entry) return 'empty'
      const expected = direction === 'undo' ? entry.after : entry.before
      const replacement = direction === 'undo' ? entry.before : entry.after
      let conflict = false
      await this.app.vault.process(file, (data) => {
        if (this.editorFor(file) || data !== expected) {
          conflict = true
          return data
        }
        return replacement
      })
      this.pending = null
      if (conflict) {
        this.history.clear(file)
        this.history.publish(file, await this.readText(file))
        return 'conflict'
      }
      this.history.commit(file, direction, entry)
      this.history.publish(file, replacement)
      return 'ok'
    })
  }

  /** 记住刚写出去的内容 hash。只留最近几条，够覆盖一个防抖窗口里的连打就行。 */
  private remember(file: TFile, hash: number): void {
    if (!this.pending || this.pending.path !== file.path) {
      this.pending = { path: file.path, hashes: [] }
    }
    this.pending.hashes.push(hash)
    if (this.pending.hashes.length > PENDING_LIMIT) this.pending.hashes.shift()
  }

  /**
   * 读取文件当前内容——用于【变更事件之后】（editor-change / modify、重新解析、写失败重同步）。
   *
   * 编辑器里的内容可能尚未落盘，此时必须读编辑器——`cachedRead` 会读到旧的。
   * 叶子被延迟卸载时没有编辑器，读磁盘就是对的：Obsidian 卸载视图前会先落盘。
   *
   * 【刚切到一篇笔记时不要用它，用 `loadText`】（issue #5）。
   */
  async readText(file: TFile): Promise<string> {
    const editor = this.editorFor(file)
    return editor ? editor.getValue() : await this.app.vault.cachedRead(file)
  }

  /** Recovery must wait for already queued edits before replacing the optimistic tree. */
  settledText(file: TFile): Promise<string> {
    return this.history.run(file, () => this.readText(file))
  }

  /**
   * 读取文件内容——用于【刚切到这篇笔记】的首次装入。只读磁盘，不看编辑器。
   *
   * 切换笔记时 Obsidian 先把 `view.file` 改成新的一篇，再异步读盘、装进编辑器；而
   * `active-leaf-change` / `file-open` 是从文件列表那一路同步排出来的，常常抢在读盘完成之前
   * 送到。这个窗口里按路径能找到编辑器，里面装的却还是【上一篇】的正文——照读就把上一篇
   * 画在了新笔记的标题下；整篇装入走的是 `cm.setState`，不发 `editor-change`，此后没有任何
   * 事件来纠正它。磁盘上的那篇不存在这个窗口。
   *
   * 代价：这篇若在别的标签页里有不到 2 秒的未保存改动，导图会晚 2 秒看到——Obsidian 自动保存
   * 后 `modify` 事件走 `readText` 补上。
   */
  loadText(file: TFile): Promise<string> {
    return this.app.vault.cachedRead(file)
  }

  // ── 定位跳转与高亮（M4）──────────────────────────────────────

  /**
   * 把当前可见的笔记滚动到某一行并高亮，【不抢键盘焦点、也不打开任何东西】。
   *
   * 焦点这件事有两个坑，都在这里绕开了：
   * - 只滚【已经看得见】的笔记，绝不新开标签页、不分栏、不切前台；
   * - 滚动只发 CM 的 scrollIntoView 效果，不设置选区（设了选区 = 光标进了编辑器）。
   *
   * @param line 0-based 行号（`MindNode.titleLine`）
   */
  revealLine(file: TFile, line: number): void {
    const view = this.visibleViewFor(file)
    if (!view) return
    this.clearHighlight()

    if (view.getMode() === 'preview') {
      this.revealInPreview(view, file, line)
      return
    }

    const cm = cmOf(view.editor)
    if (cm) {
      revealAndHighlight(cm, line)
      this.highlighted = file
    } else {
      // 旧版编辑器没有 cm：至少把人滚到位，高亮只好放弃
      view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true)
    }
  }

  /**
   * 写入之后让笔记跟着当前节点走（M11）。
   *
   * 【陷阱 16】不给写入事务一个滚动目标，编辑器就会把【光标】带回视野；而本插件为了
   * 不抢焦点，跳转时从不设选区（见 highlight.ts），那个编辑器的光标一直停在文首——
   * 于是每在导图里编辑一次，笔记就跳回开头一次。这里补上滚动目标，把它按住。
   *
   * 紧跟在写入事务【之后】单独发一次，而不是塞进同一个事务：
   * - 行号是按写入【之后】的文本算的，跟在后面发，位置语义才不含糊；
   * - 不必把已经测透的 `planToChanges`（Obsidian 的 EditorChange）改写成 CM 的偏移量。
   * 两次 dispatch 在同一个同步回合里完成，浏览器只绘一次，看不到抖动；这一次不改文档、
   * 不动选区，因此不会在撤销栈里多出一步（陷阱 15 仍然成立）。
   *
   * 【只滚已经开着的编辑器】：用户在导图里敲字，不该顺手弹出一个新标签页。
   */
  private revealAfterWrite(file: TFile, editor: Editor, line: number | undefined): void {
    if (line === undefined || line < 0) return
    const cm = cmOf(editor)
    if (!cm) return
    revealAndHighlight(cm, line)
    this.highlighted = file
  }

  /**
   * 清掉本插件加的行高亮。
   *
   * 记的是 TFile 而不是 EditorView——叶子随时可能被关掉，
   * 攥着一个已经销毁的编辑器实例就是泄漏（M4 验收最后一条）。
   */
  clearHighlight(): void {
    this.cancelPendingPreviewReveal()
    clearPreviewHighlight(this.highlightedPreview)
    this.highlightedPreview = null

    const file = this.highlighted
    this.highlighted = null
    if (!file) return
    const editor = this.editorFor(file)
    const cm = editor ? cmOf(editor) : null
    if (cm) clearHighlight(cm)
  }

  /**
   * 阅读模式长文档的两阶段定位：
   * 1. 目标区块已渲染时直接居中；
   * 2. 否则先让 Obsidian 按源码行滚到那里，再等它把区块放进 DOM。
   *
   * MutationObserver 只在这最多 1 秒内存活，回调合并到 rAF；连续点击会用 token
   * 取消上一次，所以旧目标绝不会在稍后反跳回来。
   */
  private revealInPreview(view: MarkdownView, file: TFile, line: number): void {
    const preview = view.previewMode
    const token = this.previewRevealToken

    const reveal = (): boolean => {
      if (token !== this.previewRevealToken) return false
      const cache = this.app.metadataCache.getFileCache(file)
      const target = revealPreviewLine(preview, cache, file.path, line)
      if (!target) return false
      this.highlightedPreview = target
      this.cancelPendingPreviewReveal()
      return true
    }

    if (reveal()) return

    const attempt = (): void => {
      this.previewRevealFrame = null
      if (token !== this.previewRevealToken) return
      const current = this.visibleViewFor(file)
      if (current !== view || current.getMode() !== 'preview') {
        this.cancelPendingPreviewReveal()
        return
      }
      reveal()
    }
    const queueAttempt = (): void => {
      if (token !== this.previewRevealToken || this.previewRevealFrame !== null) return
      this.previewRevealFrame = window.requestAnimationFrame(attempt)
    }

    this.previewObserver = new MutationObserver(queueAttempt)
    this.previewObserver.observe(preview.containerEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-om-line-start', 'data-om-line-end', 'data-om-source-path'],
    })
    this.previewRevealTimeout = window.setTimeout(() => {
      if (token === this.previewRevealToken) this.cancelPendingPreviewReveal()
    }, PREVIEW_REVEAL_TIMEOUT_MS)

    // applyScroll 的参数是源码行号。它只滚当前预览，不切模式、不抢焦点。
    preview.applyScroll(line)
    queueAttempt()
  }

  private cancelPendingPreviewReveal(): void {
    this.previewRevealToken++
    this.previewObserver?.disconnect()
    this.previewObserver = null
    if (this.previewRevealFrame !== null) window.cancelAnimationFrame(this.previewRevealFrame)
    if (this.previewRevealTimeout !== null) window.clearTimeout(this.previewRevealTimeout)
    this.previewRevealFrame = null
    this.previewRevealTimeout = null
  }

  /**
   * 【此刻屏幕上真的看得见】的那个 Markdown 视图，否则 null。
   *
   * 跳转是一个纯粹的「顺带」动作：笔记就在旁边开着，点节点时让它滚到对应行，很自然；
   * 笔记没开着（或压在别的标签页后面）时却替用户开一个 / 切一个，就变成了抢地方——
   * 「打开为导图」之后尤其明显，那正是用户表示「我现在只想编辑导图」的时候。
   * 所以这里【只认已经露着的笔记】：不开、不分栏、不 reveal、不切前台。
   *
   * 顺带一提，藏起来的编辑器也确实滚不动：没上过屏的 CodeMirror 还没量过布局，
   * `scrollIntoView` 那一下本来就是空放。
   */
  private visibleViewFor(file: TFile): MarkdownView | null {
    const leaf = this.leafFor(file)
    if (!leaf || leaf.isDeferred) return null
    const view = leaf.view
    if (!(view instanceof MarkdownView)) return null
    return view.containerEl.isShown() ? view : null
  }

  /**
   * 【已经加载好】的编辑器。活动文件绝不能走 vault.modify（陷阱 2）。
   *
   * 叶子被延迟卸载时这里返回 null，写入于是走 `vault.process`——那是对的：
   * 视图都没建起来，本来就没有编辑器事务可言，它下次加载时从磁盘读。
   */
  private editorFor(file: TFile): Editor | null {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view
      if (view instanceof MarkdownView && view.file === file &&
          leaf.getViewState().state?.['file'] === file.path) return view.editor
    }
    return null
  }

  /**
   * 这篇笔记开在哪个叶子里。
   *
   * 【不能靠 `view instanceof MarkdownView` 来找】：1.7.2 起 Obsidian 会把不可见的
   * 叶子「延迟」掉，此时 `leaf.view` 是个占位而不是 MarkdownView，于是一篇明明开着的
   * 笔记会被判成没开——跳转就为它另开一个标签页，看上去就是「点了没反应」。
   * 按视图状态里的【路径】认，延迟与否都认得出来。
   */
  private leafFor(file: TFile): WorkspaceLeaf | null {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      if (leaf.getViewState().state?.['file'] === file.path) return leaf
    }
    return null
  }

  // ── 读取与防抖（第 4.2 节）──────────────────────────────────

  private schedule(file: TFile): void {
    if (!this.file || file.path !== this.file.path) return
    if (this.timer !== null) return
    this.timer = window.setTimeout(() => {
      this.timer = null
      this.frame = window.requestAnimationFrame(() => {
        this.frame = null
        void this.emit()
      })
    }, DEBOUNCE_MS)
  }

  private cancelScheduled(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    if (this.frame !== null) window.cancelAnimationFrame(this.frame)
    this.timer = null
    this.frame = null
  }

  private async emit(): Promise<void> {
    const file = this.file
    if (!file) return
    const version = this.changeVersion
    const text = await this.readText(file)
    if (this.file !== file || version !== this.changeVersion) return

    // 文件当前内容正好等于我们写过的某一份 → 这是自己的回声。
    // 命中即整串作废：比它早的那几份都已经被覆盖，留着也没意义了。
    let selfOriginated = false
    if (this.pending && this.pending.path === file.path) {
      const hash = hashText(text)
      if (this.pending.hashes.includes(hash)) {
        selfOriginated = true
        this.pending = null
      }
    }
    this.onChange({ file, text, selfOriginated })
  }
}

/** Obsidian 的 Editor 底下就是一个 CM6 EditorView，但公开类型里没有它。 */
function cmOf(editor: Editor): EditorView | null {
  return (editor as unknown as { cm?: EditorView }).cm ?? null
}

/** 核对被 plan 触及的每一行是否仍与生成 plan 时一致。 */
function assertUnchanged(base: string[], current: string[], plan: EditPlan): void {
  for (const e of plan) {
    if (e.toLine > current.length) {
      throw new Error('文件已在别处被修改（行数变少），本次操作已取消')
    }
    for (let i = e.fromLine; i < e.toLine; i++) {
      if (base[i] !== current[i]) {
        throw new Error(`文件已在别处被修改（第 ${i + 1} 行），本次操作已取消`)
      }
    }
  }
}
