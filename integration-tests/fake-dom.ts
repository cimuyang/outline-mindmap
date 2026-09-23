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

  addEventListener(_type: string, _callback: unknown): void {}

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

  addClass(cls: string): void {
    this.classList.add(cls)
  }

  removeClass(cls: string): void {
    this.classList.remove(cls)
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
