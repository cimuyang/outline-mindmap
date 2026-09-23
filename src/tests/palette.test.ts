import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')
const colors = [...css.matchAll(/--om-level-\d:\s*(\d+),\s*(\d+),\s*(\d+);/g)]
  .map(m => m.slice(1).map(Number))
function luminance(rgb: number[]): number {
  const linear = rgb.map(c => { const s = c / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4 })
  return linear[0]! * .2126 + linear[1]! * .7152 + linear[2]! * .0722
}
const contrast = (a: number[], b: number[]): number =>
  (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)

describe('level palette readability', () => {
  it('provides six distinct colors in both modes with readable text over all built-in schemes', () => {
    expect(colors).toHaveLength(12)
    const schemes = [{ rgb: [74, 142, 240], alpha: .08 }, { rgb: [58, 166, 117], alpha: .08 },
      { rgb: [224, 138, 60], alpha: .1 }, { rgb: [0, 0, 0], alpha: 0 }]
    for (const [mode, backgrounds] of [[0, [255, 245]], [1, [30, 38]]] as const) {
      const palette = colors.slice(mode * 6, mode * 6 + 6)
      expect(new Set(palette.map(c => c.join(','))).size).toBe(6)
      for (const color of palette) for (const background of backgrounds) for (const scheme of schemes) {
        const blended = scheme.rgb.map(c => c * scheme.alpha + background * (1 - scheme.alpha))
        expect(contrast(color, blended)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
