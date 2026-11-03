export function imagePdf(jpeg: Blob, width: number, height: number, page: 'fit' | 'landscape' | 'portrait', density = 1): Blob {
  const [w, h] = page === 'fit' ? [width * 0.75 / density, height * 0.75 / density] : page === 'landscape' ? [842, 595] : [595, 842]
  const scale = Math.min(w / width, h / height)
  const dw = width * scale, dh = height * scale
  const drawing = `q ${dw} 0 0 ${dh} ${(w - dw) / 2} ${(h - dh) / 2} cm /Map Do Q\n`
  const parts: BlobPart[] = ['%PDF-1.4\n']
  const offsets = [0]
  let cursor = 9
  const append = (value: string | Blob) => {
    parts.push(value)
    cursor += typeof value === 'string' ? value.length : value.size
  }
  const object = (body: string, stream?: Blob) => {
    const id = offsets.length
    offsets.push(cursor)
    append(`${id} 0 obj\n${body}`)
    if (stream) {
      append(stream)
      append('\nendstream')
    }
    append('\nendobj\n')
  }
  object('<< /Type /Catalog /Pages 2 0 R >>')
  object('<< /Type /Pages /Count 1 /Kids [3 0 R] >>')
  object(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Map 4 0 R >> >> /Contents 5 0 R >>`)
  object(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.size} >>\nstream\n`, jpeg)
  object(`<< /Length ${drawing.length} >>\nstream\n${drawing}endstream`)
  const xref = cursor
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`)
  for (const offset of offsets.slice(1)) append(`${String(offset).padStart(10, '0')} 00000 n \n`)
  append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(parts, { type: 'application/pdf' })
}
