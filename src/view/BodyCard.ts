import { Component, MarkdownRenderer, Notice, Menu, setIcon, type App } from 'obsidian'
import { label } from './strings'

export interface BodyCardHooks {
  write(value: string): Promise<void>
  draft(value: string | null): void
  close(): void
  reload(): void
}
/** One screen-space surface; the owner controls source identity and transactions. */
export class BodyCard extends Component {
  readonly el: HTMLElement
  private readonly input: HTMLTextAreaElement
  private readonly preview: HTMLElement
  private readonly status: HTMLElement
  private readonly edit: HTMLButtonElement
  private readonly pin: HTMLButtonElement
  private readonly footer: HTMLElement
  private readonly reloadButton: HTMLButtonElement
  private readonly title: HTMLElement
  private saved: string
  private timer: number | undefined
  private timerWindow?: Window
  private running: Promise<boolean> | null = null
  private pendingSince = 0
  private composing = false
  private disposed = false
  private conflict = false
  private writable: boolean
  private rendering: Component | null = null
  private generation = 0
  get retained(): boolean { return this.el.hasClass('is-retained') }
  get dirty(): boolean { return this.input.value !== this.saved }
  get value(): string { return this.input.value }
  get editing(): boolean { return !this.input.hidden }
  get pinned(): boolean { return this.el.hasClass('is-pinned') }
  constructor(host: HTMLElement, private app: App, private path: string, title: string,
    text: string, writable: boolean, private hooks: BodyCardHooks, draft?: string) {
    super()
    this.saved = text
    this.writable = writable
    this.el = host.createDiv({ cls: 'om-body-card' })
    this.el.setAttribute('role', 'region')
    this.el.setAttribute('aria-description', label('节点正文', 'Node body'))
    const header = this.el.createDiv({ cls: 'om-body-header' })
    this.title = header.createEl('strong', { text: title })
    const button = (icon: string, name: string, action: () => void): HTMLButtonElement => {
      const el = header.createEl('button', { cls: 'om-body-action' }); el.type = 'button'
      el.setAttribute('aria-label', name); setIcon(el, icon); el.onclick = action; return el
    }
    this.edit = button('pencil', label('编辑正文', 'Edit body'), () => { void this.toggleEdit() })
    const keep = button('pin', label('置顶保留卡片', 'Keep card open'), () => {
      this.el.toggleClass('is-retained', !this.retained)
      keep.setAttribute('aria-pressed', String(this.retained))
    })
    keep.setAttribute('aria-pressed', 'false')
    this.pin = button('panel-right', label('固定正文面板', 'Pin body panel'), () => this.setPinned(!this.pinned))
    this.pin.setAttribute('aria-pressed', 'false')
    keep.hidden = true; this.pin.hidden = true
    button('ellipsis', label('更多', 'More'), () => {
      const menu = new Menu()
      menu.addItem(item => item.setTitle(label('保留此卡片', 'Keep card open')).setChecked(this.retained).onClick(() => keep.click()))
      menu.addItem(item => item.setTitle(label('停靠侧栏', 'Dock panel')).setChecked(this.pinned).onClick(() => this.setPinned(!this.pinned)))
      const rect = this.edit.getBoundingClientRect()
      menu.showAtPosition({ x: rect.right, y: rect.bottom })
    })
    button('x', label('关闭', 'Close'), () => { void this.close() })
    this.preview = this.el.createDiv({ cls: 'om-body-preview markdown-rendered' })
    this.input = this.el.createEl('textarea', { cls: 'om-body-input' })
    this.input.setAttribute('aria-label', label('正文', 'Body'))
    this.input.value = draft ?? text
    this.input.hidden = !writable
    this.preview.hidden = !this.input.hidden
    if (this.editing) {
      setIcon(this.edit, 'book-open')
      this.edit.setAttribute('aria-label', label('阅读正文', 'Read body'))
    }
    const footer = this.footer = this.el.createDiv({ cls: 'om-body-footer' })
    this.status = header.createDiv({ cls: 'om-body-status' })
    header.insertBefore(this.status, this.edit)
    this.status.setAttribute('aria-live', 'polite')
    this.reloadButton = footer.createEl('button', { text: label('保留草稿并重载', 'Keep draft and reload') })
    this.footer.hidden = true
    this.reloadButton.onclick = () => { if (this.dirty) hooks.draft(this.value); hooks.reload() }
    this.setWritable(writable)
    this.state(draft === undefined ? label('已保存', 'Saved') : label('已恢复草稿 · 请检查后保存', 'Draft restored · review before saving'))
    this.registerDomEvent(this.input, 'compositionstart', () => { this.composing = true; this.timerWindow?.clearTimeout(this.timer) })
    this.registerDomEvent(this.input, 'compositionend', () => { this.composing = false; this.schedule() })
    this.registerDomEvent(this.input, 'blur', () => { void this.flush() })
    this.registerDomEvent(this.input, 'input', () => { hooks.draft(this.dirty ? this.value : null); this.schedule() })
    this.registerDomEvent(this.el, 'keydown', event => {
      event.stopPropagation()
      if (event.isComposing) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void this.flush() }
      if (event.key === 'Escape') { event.preventDefault(); void this.close() }
    })
    this.register(() => { if (!host.querySelector('.om-body-card.is-pinned')) host.removeClass('om-body-pinned') })
    this.registerDomEvent(header, 'pointerdown', event => {
      if (event.button !== 0 || this.pinned || (event.target as HTMLElement).closest('button')) return
      const rect = this.el.getBoundingClientRect(), parent = host.getBoundingClientRect()
      const x = event.clientX, y = event.clientY
      header.setPointerCapture(event.pointerId)
      const move = (next: PointerEvent) => {
        this.el.setCssProps({ '--om-card-left': `${Math.max(0, Math.min(host.clientWidth - this.el.offsetWidth, rect.left - parent.left + next.clientX - x))}px` })
        this.el.setCssProps({ '--om-card-top': `${Math.max(0, Math.min(host.clientHeight - 44, rect.top - parent.top + next.clientY - y))}px` })
      }
      const end = () => { header.removeEventListener('pointermove', move); header.removeEventListener('pointerup', end); header.removeEventListener('lostpointercapture', end) }
      header.addEventListener('pointermove', move)
      header.addEventListener('pointerup', end)
      header.addEventListener('lostpointercapture', end)
    })
    for (const edge of ['se', 's', 'e', 'n', 'w', 'ne', 'nw', 'sw']) {
    const grip = this.el.createDiv({ cls: 'om-body-resize om-resize-' + edge })
    grip.setAttribute('aria-label', label('调整卡片大小', 'Resize card'))
    this.registerDomEvent(grip, 'pointerdown', event => {
      event.preventDefault(); event.stopPropagation()
      const x = event.clientX, y = event.clientY, width = this.el.offsetWidth, height = this.el.offsetHeight
      const left = this.el.offsetLeft, top = this.el.offsetTop
      grip.setPointerCapture(event.pointerId)
      const move = (next: PointerEvent) => {
        if (this.pinned) {
          const narrow = host.clientWidth <= 650
          host.style.setProperty('--om-panel-width', `${Math.max(280, Math.min(host.clientWidth * .7, width + x - next.clientX))}px`)
          if (narrow) host.style.setProperty('--om-panel-height', `${Math.max(180, Math.min(host.clientHeight * .7, height + y - next.clientY))}px`)
        } else {
          const dx = next.clientX - x, dy = next.clientY - y
          const minW = Math.min(280, host.clientWidth), minH = Math.min(220, host.clientHeight)
          if (edge.includes('e')) this.el.style.width = Math.max(minW, Math.min(host.clientWidth - left, width + dx)) + 'px'
          if (edge.includes('s')) this.el.style.height = Math.max(minH, Math.min(host.clientHeight - top, height + dy)) + 'px'
          if (edge.includes('w')) { const w = Math.max(minW, Math.min(left + width, width - dx)); this.el.style.width = w + 'px'; this.el.setCssProps({ '--om-card-left': left + width - w + 'px' }) }
          if (edge.includes('n')) { const h = Math.max(minH, Math.min(top + height, height - dy)); this.el.style.height = h + 'px'; this.el.setCssProps({ '--om-card-top': top + height - h + 'px' }) }

        }
      }
      const end = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('lostpointercapture', end) }
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('lostpointercapture', end)
    })
    }
    this.load()
    this.render()
  }
  private async close(): Promise<void> {
    await this.flush()
    if (this.dirty) this.hooks.draft(this.value)
    this.hooks.close()
  }
  setPinned(value: boolean): void {
    if (value) {
      this.el.parentElement?.querySelectorAll('.om-body-card.is-pinned').forEach(other => {
        if (other !== this.el) other.removeClass('is-pinned')
      })
    }
    this.el.toggleClass('is-pinned', value)
    this.el.setCssStyles({ width: '', height: '' })
    this.el.parentElement?.toggleClass('om-body-pinned', !!this.el.parentElement.querySelector('.om-body-card.is-pinned'))
    this.pin.setAttribute('aria-pressed', String(value))
  }
  setWritable(value: boolean): void {
    this.writable = value
    this.input.readOnly = !value
    this.edit.disabled = !value
    if (!value) this.timerWindow?.clearTimeout(this.timer)
  }
  setTitle(title: string): void { this.title.setText(title) }
  update(text: string): void {
    if (this.running) return
    if (text === this.saved) return
    if (this.dirty || this.composing) { this.markConflict(); return }
    const start = this.input.selectionStart, end = this.input.selectionEnd, scroll = this.input.scrollTop
    this.saved = text; this.input.value = text
    this.input.setSelectionRange(Math.min(start, text.length), Math.min(end, text.length))
    this.input.scrollTop = scroll
    this.conflict = false; this.footer.hidden = true
    this.state(label('已同步', 'Synced')); this.render()
  }
  markConflict(): void {
    this.timerWindow?.clearTimeout(this.timer); this.conflict = true; this.footer.hidden = false
    if (this.dirty) this.hooks.draft(this.value)
    this.state(label('原文已变化 · 草稿已保留', 'Source changed · draft preserved'))
  }
  private state(text: string): void { this.status.setText(text); this.status.toggleClass('is-saved', text === label('已保存', 'Saved')) }
  private schedule(): void {
    this.timerWindow?.clearTimeout(this.timer)
    if (!this.dirty) { this.state(label('已保存', 'Saved')); return }
    this.state(label('未保存', 'Unsaved'))
    if (!this.pendingSince) this.pendingSince = Date.now()
    if (!this.composing && !this.conflict && this.writable) {
      this.timerWindow = this.el.ownerDocument.defaultView!
      this.timer = this.timerWindow.setTimeout(() => { void this.flush() }, Math.max(0, Math.min(400, 2000 - (Date.now() - this.pendingSince))))
    }
  }
  async flush(): Promise<boolean> {
    this.timerWindow?.clearTimeout(this.timer)
    if (this.running) { await this.running; return this.dirty ? this.flush() : true }
    if (!this.dirty) return true
    if (this.composing || this.conflict || !this.writable || this.disposed) return false
    const value = this.value
    this.pendingSince = 0
    this.state(label('保存中…', 'Saving…'))
    this.running = (async () => {
      try {
        await this.hooks.write(value)
        this.saved = value
        this.hooks.draft(this.dirty ? this.value : null)
        this.state(this.dirty ? label('未保存', 'Unsaved') : label('已保存', 'Saved'))
        return true
      } catch (error) {
        this.markConflict()
        new Notice(error instanceof Error ? error.message : String(error))
        return false
      }
    })()
    const ok = await this.running
    this.running = null
    if (ok && this.dirty) return this.flush()
    return ok
  }
  private async toggleEdit(): Promise<void> {
    if (this.editing && !await this.flush()) return
    this.input.hidden = !this.input.hidden; this.preview.hidden = !this.input.hidden
    setIcon(this.edit, this.editing ? 'book-open' : 'pencil')
    this.edit.setAttribute('aria-label', this.editing ? label('阅读正文', 'Read body') : label('编辑正文', 'Edit body'))
    if (this.editing) this.input.focus(); else this.render()
  }
  private render(): void {
    const generation = ++this.generation
    if (this.rendering) this.removeChild(this.rendering)
    this.rendering = this.addChild(new Component())
    const target = this.preview.ownerDocument.createDocumentFragment().createDiv()
    void MarkdownRenderer.render(this.app, this.value || label('暂无正文', 'No body text'), target, this.path, this.rendering)
      .then(() => { if (!this.disposed && generation === this.generation) { this.preview.empty(); this.preview.appendChild(target) } })
      .catch(() => { if (!this.disposed && generation === this.generation) this.preview.setText(this.value) })
  }
  override onunload(): void {
    this.disposed = true; this.generation++; this.timerWindow?.clearTimeout(this.timer)
    if (this.dirty) this.hooks.draft(this.value)
    this.el.remove()
  }
}
