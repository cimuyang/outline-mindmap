/**
 * 节点内联输入框。M5「全程无鼠标」链路的落点。
 *
 * 【为什么用 contenteditable 而不是 input】
 * 节点是一个会【折行】的盒子（measure.ts 到 320px 就换行），高度由行数决定。
 * `<input>` 永远单行，一旦文字超过一行，输入框的高度就和布局算出来的节点高度对不上，
 * 一进编辑态整块就跳。contenteditable 用的是和 `.om-node` 完全相同的
 * `white-space: pre-wrap` + `overflow-wrap: anywhere`，折行位置与 measure.ts 一致。
 *
 * 代价是「粘贴带格式」，用 `contenteditable="plaintext-only"`（Electron/Chromium 原生支持）
 * 从根上掐掉；再在读取时把空白折成单个空格兜底——节点文本绝不允许含换行（tree.ts 会抛错）。
 *
 * 本文件不碰树、不生成 EditPlan，只负责「一个能打字的框」和三个键（Enter / Tab / Esc）。
 */

import type { Box } from '../layout/types'

/** 提交时按下的是哪个键——决定提交之后紧接着开哪种草稿。 */
export type CommitNext = 'sibling' | 'child' | 'none'

export interface InlineEditorHooks {
  /** 每次输入。视图据此做乐观更新：改内存里的 text → 重排 → 编辑框跟着新的 box 走。 */
  onInput: (text: string) => void
  onCommit: (text: string, next: CommitNext) => void
  onCancel: () => void
}

/**
 * 节点文本必须是单行：任何空白（换行、Tab、contenteditable 爱生成的不换行空格）
 * 都折成一个普通空格。
 *
 * 不做 trim——正在打字的人刚敲下的那个空格不能被吞掉。收尾的 trim 交给提交时。
 */
export function sanitize(raw: string): string {
  return raw.replace(/\s+/g, ' ')
}

export class InlineEditor {
  private readonly host: HTMLElement
  private readonly input: HTMLElement
  private open = false
  /** 自己关自己的过程中会触发 blur，别让它再回头提交一次。 */
  private closing = false

  constructor(
    layer: HTMLElement,
    private readonly hooks: InlineEditorHooks,
  ) {
    this.host = layer.createDiv({ cls: 'om-editor' })
    this.input = this.host.createDiv({ cls: 'om-editor-input' })
    // plaintext-only：粘贴自动降级为纯文本，省掉一整套 HTML 清洗
    this.input.setAttribute('contenteditable', 'plaintext-only')
    this.input.setAttribute('spellcheck', 'false')
    this.host.style.display = 'none'

    this.input.addEventListener('keydown', this.onKeyDown)
    this.input.addEventListener('input', this.onInput)
    this.input.addEventListener('blur', this.onBlur)
  }

  destroy(): void {
    this.input.removeEventListener('keydown', this.onKeyDown)
    this.input.removeEventListener('input', this.onInput)
    this.input.removeEventListener('blur', this.onBlur)
    this.host.remove()
  }

  get active(): boolean {
    return this.open
  }

  get text(): string {
    return sanitize(this.input.textContent ?? '')
  }

  /** 打开编辑框。文字整体选中——F2 之后直接打字就是覆盖，这是重命名最常见的意图。 */
  start(box: Box, text: string): void {
    this.open = true
    this.input.textContent = text
    this.place(box)
    this.host.style.display = ''
    this.input.focus({ preventScroll: true })
    this.selectAll()
  }

  /** 输入导致重排后，把编辑框挪到节点的新位置。 */
  place(box: Box): void {
    this.host.style.transform = `translate(${box.x}px, ${box.y}px)`
    this.host.style.width = `${box.w}px`
    this.host.style.minHeight = `${box.h}px`
  }

  /** 关掉编辑框，不触发任何回调。 */
  stop(): void {
    if (!this.open) return
    this.closing = true
    this.open = false
    this.host.style.display = 'none'
    this.input.textContent = ''
    this.closing = false
  }

  // ── 事件 ────────────────────────────────────────────────────

  /**
   * 编辑态下键盘全部归编辑框所有：一律 stopPropagation，
   * 否则方向键会同时被视图当成「移动选中」。
   */
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.open) return
    e.stopPropagation()
    // 输入法组词期间的回车是「确认候选词」，不是提交
    if (e.isComposing || e.keyCode === 229) return

    switch (e.key) {
      case 'Enter':
        e.preventDefault()
        // Shift+Enter = 只确认不再新增，给「改完就停」留一条不用摸鼠标的路
        this.hooks.onCommit(this.text, e.shiftKey ? 'none' : 'sibling')
        break
      case 'Tab':
        e.preventDefault()
        this.hooks.onCommit(this.text, 'child')
        break
      case 'Escape':
        e.preventDefault()
        this.hooks.onCancel()
        break
      default:
        break
    }
  }

  private readonly onInput = (): void => {
    if (!this.open) return
    const text = this.text
    // 粘贴进来的换行已经在 text 里被折掉了，DOM 也得跟着改，否则会多出一行高度
    if ((this.input.textContent ?? '') !== text) {
      this.input.textContent = text
      this.caretToEnd()
    }
    this.hooks.onInput(text)
  }

  private readonly onBlur = (): void => {
    if (!this.open || this.closing) return
    // 点到别处 = 确认。取消要按 Esc——用户打了半天字，默认丢掉太狠
    this.hooks.onCommit(this.text, 'none')
  }

  private selectAll(): void {
    this.setRange(false)
  }

  private caretToEnd(): void {
    this.setRange(true)
  }

  private setRange(collapse: boolean): void {
    const range = document.createRange()
    range.selectNodeContents(this.input)
    if (collapse) range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }
}
