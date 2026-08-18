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

import { MarkdownView, TFile, type App, type Component, type Editor } from 'obsidian'
import type { EditorView } from '@codemirror/view'
import { applyPlan as applyPlanToLines } from '../core/editplan'
import { joinLines, splitLines } from '../core/parser'
import type { EditPlan } from '../core/types'
import { planToChanges } from './changes'
import { clearHighlight, revealAndHighlight } from './highlight'

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
  /** 写入串行化：后一次写入的行号基准是前一次写完之后的文件，必须排队。 */
  private writes: Promise<void> = Promise.resolve()
  /** 当前有本插件行高亮的文件。 */
  private highlighted: TFile | null = null

  constructor(
    private readonly app: App,
    private readonly onChange: (change: DocumentChange) => void,
  ) {}

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
    this.file = file
    this.cancelScheduled()
    this.pending = null
    // 换笔记了，上一篇里的高亮该跟着走
    this.clearHighlight()
  }

  /** 事件监听由 owner.registerEvent 托管，这里清掉未触发的定时器和残留的高亮。 */
  dispose(): void {
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

    // 排队：`vault.process` 是异步的，两次写入撞在一起时后一次的 base 会失效。
    // 视图那边是同步连打的（连按 10 次回车），这条队列是它的安全网。
    const run = this.writes.then(() => this.write(file, base, plan, eol, reveal))
    this.writes = run.catch(() => undefined)
    await run
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
      const current = splitLines(editor.getValue())
      assertUnchanged(base, current, plan)
      // 一个用户操作 = 一个事务，保证 Ctrl+Z 一次撤销（陷阱 15）
      editor.transaction({ changes: planToChanges(current, plan, eol) })
      this.revealAfterWrite(file, editor, reveal)
      return
    }

    await this.app.vault.process(file, (data) => {
      const current = splitLines(data)
      assertUnchanged(base, current, plan)
      return joinLines(applyPlanToLines(current, plan), eol)
    })
  }

  /**
   * 转发撤销给编辑器（第 4.6 节）。不自建撤销栈——所有写入本来就是编辑器事务。
   *
   * @returns 文件没在编辑器里打开时返回 false，此时无从撤销。
   */
  undo(file: TFile): boolean {
    const editor = this.editorFor(file)
    if (!editor) return false
    editor.undo()
    return true
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
   * 读取文件当前内容。
   *
   * 编辑器里的内容可能尚未落盘，此时必须读编辑器——`cachedRead` 会读到旧的。
   */
  async readText(file: TFile): Promise<string> {
    const editor = this.editorFor(file)
    return editor ? editor.getValue() : await this.app.vault.cachedRead(file)
  }

  // ── 定位跳转与高亮（M4）──────────────────────────────────────

  /**
   * 把编辑器滚动到某一行并高亮，【不抢键盘焦点】。
   *
   * 焦点这件事有两个坑，都在这里绕开了：
   * - 打开文件用 `active: false`，不激活那个叶子；
   * - 滚动只发 CM 的 scrollIntoView 效果，不设置选区（设了选区 = 光标进了编辑器）。
   *
   * @param line 0-based 行号（`MindNode.titleLine`）
   */
  async revealLine(file: TFile, line: number): Promise<void> {
    const view = await this.openFor(file)
    if (!view) return
    this.clearHighlight()

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
    const file = this.highlighted
    this.highlighted = null
    if (!file) return
    const editor = this.editorFor(file)
    const cm = editor ? cmOf(editor) : null
    if (cm) clearHighlight(cm)
  }

  /** 文件已经开着就用现成的，没开就在旁边新开一个标签页且不激活它。 */
  private async openFor(file: TFile): Promise<MarkdownView | null> {
    const existing = this.viewFor(file)
    if (existing) return existing
    const leaf = this.app.workspace.getLeaf('tab')
    await leaf.openFile(file, { active: false })
    return leaf.view instanceof MarkdownView ? leaf.view : null
  }

  /** 文件是否正在某个编辑器里打开。活动文件绝不能走 vault.modify（陷阱 2）。 */
  private editorFor(file: TFile): Editor | null {
    return this.viewFor(file)?.editor ?? null
  }

  private viewFor(file: TFile): MarkdownView | null {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view
      if (view instanceof MarkdownView && view.file === file) return view
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
    const text = await this.readText(file)

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
