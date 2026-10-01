export class FakeClassList {
  readonly values = new Set<string>()

  add(...classes: string[]): void {
    for (const cls of classes) if (cls) this.values.add(cls)
  }

  remove(...classes: string[]): void {
    for (const cls of classes) this.values.delete(cls)
  }

  toggle(cls: string, force?: boolean): boolean {
    const on = force ?? !this.values.has(cls)
    if (on) this.values.add(cls)
    else this.values.delete(cls)
    return on
  }

  contains(cls: string): boolean {
    return this.values.has(cls)
  }
}

export class FakeElement {
  readonly classList = new FakeClassList()
  readonly dataset: Record<string, string> = {}
  readonly children: Array<FakeElement | string> = []
  readonly styles: Record<string, string> = {}
  readonly attributes: Record<string, string> = {}
  readonly captures = new Set<number>()
  readonly captureCalls: number[] = []
  readonly listeners = new Map<string, Array<{ callback: (event: any) => void; capture: boolean }>>()
  shown = true
  parent: FakeElement | null = null

  constructor(readonly tagName = 'div', readonly fragment = false) {}

  createEl(tag: string, options?: { cls?: string; text?: string }): FakeElement {
    const child = new FakeElement(tag)
    if (options?.cls) child.classList.add(options.cls)
    if (options?.text) child.appendText(options.text)
    this.appendChild(child)
    return child
  }

  createDiv(options?: { cls?: string }): FakeElement {
    return this.createEl('div', options)
  }

  createSpan(options?: { cls?: string; text?: string }): FakeElement {
    return this.createEl('span', options)
  }

  createSvg(tag: string, options?: { cls?: string; attr?: Record<string, string> }): FakeElement {
    const child = this.createEl(tag, options)
    for (const [key, value] of Object.entries(options?.attr ?? {})) child.setAttribute(key, value)
    return child
  }

  addEventListener(type: string, callback: any, options?: boolean | { capture?: boolean }): void {
    const capture = typeof options === 'boolean' ? options : options?.capture === true
    const list = this.listeners.get(type) ?? []
    list.push({ callback, capture })
    this.listeners.set(type, list)
  }

  removeEventListener(type: string, callback: unknown, options?: boolean | { capture?: boolean }): void {
    const capture = typeof options === 'boolean' ? options : options?.capture === true
    this.listeners.set(type, (this.listeners.get(type) ?? [])
      .filter(listener => listener.callback !== callback || listener.capture !== capture))
  }

  dispatch(type: string, input: Record<string, any> = {}): any {
    let stopped = false, immediate = false
    const event = { ...input, type, target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true },
      stopPropagation() { stopped = true }, stopImmediatePropagation() { stopped = immediate = true } }
    const path: FakeElement[] = []
    for (let el: FakeElement | null = this; el; el = el.parent) path.push(el)
    const invoke = (el: FakeElement, capture: boolean) => {
      for (const listener of el.listeners.get(type) ?? []) {
        if (listener.capture === capture && !immediate) listener.callback(event)
      }
    }
    for (const el of [...path].reverse()) { invoke(el, true); if (stopped) return event }
    for (const el of path) { invoke(el, false); if (stopped) break }
    return event
  }

  setAttribute(name: string, value: string): void { this.attributes[name] = value }
  getAttribute(name: string): string | null {
    if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_all, c) => c.toUpperCase())] ?? null
    return this.attributes[name] ?? null
  }
  closest(selector: string): FakeElement | null {
    const classes = selector.split(',').map(part => part.trim().slice(1))
    for (let el: FakeElement | null = this; el; el = el.parent) {
      if (classes.some(cls => el!.classList.contains(cls))) return el
    }
    return null
  }
  setPointerCapture(id: number): void { this.captures.add(id); this.captureCalls.push(id) }
  hasPointerCapture(id: number): boolean { return this.captures.has(id) }
  releasePointerCapture(id: number): void { this.captures.delete(id) }
  getBoundingClientRect(): { left: number; top: number } { return { left: 0, top: 0 } }
  focus(): void {}
  isShown(): boolean { return this.shown }

  appendChild(child: FakeElement): FakeElement {
    if (child.fragment) {
      for (const nested of [...child.children]) {
        if (typeof nested !== 'string') nested.parent = this
        this.children.push(nested)
      }
      child.children.length = 0
      return child
    }
    child.parent = this
    this.children.push(child)
    return child
  }

  appendText(text: string): void {
    this.children.push(text)
  }

  setText(text: string): void {
    this.empty()
    this.appendText(text)
  }

  empty(): void {
    this.children.length = 0
  }

  addClass(...classes: string[]): void {
    this.classList.add(...classes)
  }

  removeClass(...classes: string[]): void {
    this.classList.remove(...classes)
  }

  toggleClass(cls: string, force: boolean): void {
    this.classList.toggle(cls, force)
  }

  setCssStyles(styles: Record<string, string>): void {
    Object.assign(this.styles, styles)
  }

  remove(): void {
    if (!this.parent) return
    const index = this.parent.children.indexOf(this)
    if (index >= 0) this.parent.children.splice(index, 1)
    this.parent = null
  }
}

export function findByClass(root: FakeElement, cls: string): FakeElement[] {
  const found: FakeElement[] = []
  const visit = (node: FakeElement): void => {
    if (node.classList.contains(cls)) found.push(node)
    for (const child of node.children) if (typeof child !== 'string') visit(child)
  }
  visit(root)
  return found
}

export function textOf(root: FakeElement): string {
  return root.children
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join('')
}
