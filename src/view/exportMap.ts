import { imagePdf } from './imagePdf'

export class ExportSizeError extends Error {}

const SVG = 'http://www.w3.org/2000/svg'

/** Capture the visible branches in map coordinates, independent of pan and zoom. */
export async function exportMap(
  content: HTMLElement, name: string, format: 'svg' | 'png' | 'pdf', background: string,
  density = 2, page: 'fit' | 'landscape' | 'portrait' = 'fit', padding = 24,
): Promise<void> {
  const doc = content.ownerDocument
  const win = doc.defaultView!
  const nodes = Array.from(content.querySelectorAll<HTMLElement>('.om-node[data-node-id]:not(.is-hidden)'))
  if (!nodes.length) throw new Error('Empty mindmap')
  const origin = content.getBoundingClientRect()
  const scale = new DOMMatrixReadOnly(win.getComputedStyle(content).transform).a
  const x = (value: number) => (value - origin.left) / scale
  const y = (value: number) => (value - origin.top) / scale
  const boxes = nodes.map(node => node.getBoundingClientRect())
  const left = Math.floor(Math.min(...boxes.map(box => x(box.left)))) - padding
  const top = Math.floor(Math.min(...boxes.map(box => y(box.top)))) - padding
  const width = Math.ceil(Math.max(...boxes.map(box => x(box.right)))) - left + padding
  const height = Math.ceil(Math.max(...boxes.map(box => y(box.bottom)))) - top + padding

  function element<K extends keyof SVGElementTagNameMap>(
    tag: K, attributes: Record<string, string | number>, parent?: SVGElement,
  ): SVGElementTagNameMap[K] {
    const el = doc.createElementNS(SVG, tag)
    for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, String(value))
    parent?.appendChild(el)
    return el
  }

  const svg = element('svg', { width, height, viewBox: [left, top, width, height].join(' ') })
  if (background) element('rect', { x: left, y: top, width, height, fill: background }, svg)
  const path = content.querySelector('.om-edges')
  if (path) {
    const style = win.getComputedStyle(path)
    element('path', {
      d: path.getAttribute('d') ?? '', fill: 'none', stroke: style.stroke,
      'stroke-width': style.strokeWidth, 'stroke-linecap': style.strokeLinecap,
    }, svg)
  }

  for (const [index, node] of nodes.entries()) {
    const box = boxes[index]!
    const style = win.getComputedStyle(node)
    const bx = x(box.left), by = y(box.top), w = box.width / scale, h = box.height / scale
    element('rect', {
      x: bx, y: by, width: w, height: h, rx: Math.min(parseFloat(style.borderRadius) || 0, h / 2),
      fill: style.backgroundColor,
      stroke: parseFloat(style.borderTopWidth) ? style.borderTopColor : 'none',
      'stroke-width': parseFloat(style.borderTopWidth) || 0,
    }, svg)
    if (!parseFloat(style.borderTopWidth) && parseFloat(style.borderBottomWidth)) {
      element('line', { x1: bx, x2: bx + w, y1: by + h, y2: by + h,
        stroke: style.borderBottomColor, 'stroke-width': style.borderBottomWidth }, svg)
    }
    const label = node.querySelector('.om-node-text')
    if (!label) continue
    for (const formula of Array.from(label.querySelectorAll<HTMLElement>('[data-om-formula]'))) {
      const rect = formula.getBoundingClientRect()
      const mathSvg = formula.querySelector('svg')
      if (mathSvg && !mathSvg.querySelector('use')) {
        const glyphs = mathSvg.cloneNode(true) as SVGSVGElement
        glyphs.setAttribute('x', String(x(rect.left)))
        glyphs.setAttribute('y', String(y(rect.top)))
        glyphs.setAttribute('width', String(rect.width / scale))
        glyphs.setAttribute('height', String(rect.height / scale))
        glyphs.style.color = win.getComputedStyle(formula).color
        svg.appendChild(glyphs)
      } else {
        const font = win.getComputedStyle(formula)
        const fallback = element('text', { x: x(rect.left), y: y(rect.bottom), fill: font.color,
          'font-family': 'monospace', 'font-size': font.fontSize, textLength: rect.width / scale,
          lengthAdjust: 'spacingAndGlyphs' }, svg)
        fallback.textContent = formula.dataset.omFormula ?? ''
      }
    }
    const walker = doc.createTreeWalker(label, NodeFilter.SHOW_TEXT)
    const range = doc.createRange()
    for (let item = walker.nextNode(); item; item = walker.nextNode()) {
      const value = item.textContent ?? ''
      const parent = item.parentElement
      if (!parent || !value || parent.closest('[data-om-formula]')) continue
      const font = win.getComputedStyle(parent)
      range.selectNodeContents(item)
      const lines = range.getClientRects()
      const draw = (text: string, rect: DOMRect) => {
        if (!rect.width || !rect.height) return
        const baseline = y(rect.bottom) - (rect.height / scale - parseFloat(font.fontSize)) / 2
          - parseFloat(font.fontSize) * 0.16
        if (font.backgroundColor !== 'rgba(0, 0, 0, 0)' && !parent.matches('.om-search-match')) {
          element('rect', { x: x(rect.left), y: y(rect.top), width: rect.width / scale,
            height: rect.height / scale, rx: 2, fill: font.backgroundColor }, svg)
        }
        const el = element('text', {
          x: x(rect.left), y: baseline, fill: font.color, 'font-family': font.fontFamily,
          'font-size': font.fontSize, 'font-weight': font.fontWeight, 'font-style': font.fontStyle,
          'text-decoration': font.textDecorationLine,
        }, svg)
        el.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
        el.textContent = text
      }
      if (lines.length === 1) {
        draw(value, lines[0]!)
        continue
      }
      let start = 0
      let end = 0
      let last: DOMRect | undefined
      for (const character of value) {
        range.setStart(item, end)
        end += character.length
        range.setEnd(item, end)
        const rect = range.getBoundingClientRect()
        if (last && Math.abs(last.top - rect.top) > 1) {
          range.setStart(item, start)
          range.setEnd(item, end - character.length)
          draw(value.slice(start, end - character.length), range.getBoundingClientRect())
          start = end - character.length
        }
        last = rect
      }
      range.setStart(item, start)
      range.setEnd(item, end)
      draw(value.slice(start, end), range.getBoundingClientRect())
    }
  }

  let blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' })
  if (format !== 'svg') {
    if (width * height * density ** 2 > 32_000_000 || Math.max(width, height) * density > 16384) {
      throw new ExportSizeError('PNG dimensions exceed the export limit')
    }
    const source = URL.createObjectURL(blob)
    try {
      const image = doc.createElement('img')
      image.src = source
      await image.decode()
      const canvas = doc.createElement('canvas')
      canvas.width = width * density
      canvas.height = height * density
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas is unavailable')
      if (format === 'pdf') {
        context.fillStyle = '#fff'
        context.fillRect(0, 0, canvas.width, canvas.height)
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image encoding failed')),
          format === 'pdf' ? 'image/jpeg' : 'image/png', 0.96))
      if (format === 'pdf') blob = imagePdf(blob, canvas.width, canvas.height, page, density)
    } finally {
      URL.revokeObjectURL(source)
    }
  }
  const url = URL.createObjectURL(blob)
  const link = doc.createElement('a')
  link.href = url
  link.download = name + '.' + format
  doc.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    win.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}
