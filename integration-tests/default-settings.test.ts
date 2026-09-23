import { describe, expect, it } from 'vitest'
import { normalizeSettings } from '../src/settings/SettingsTab'
import { StyleStore } from '../src/settings/StyleStore'

describe('new defaults without migrating user choices', () => {
  it('uses the five requested defaults only for new or missing values', () => {
    const settings = normalizeSettings(null)
    expect(settings).toMatchObject({ gracefulAnimation: true, strictLineBreak: false, listNodes: false })
    expect(settings.styles.defaults).toMatchObject({ branch: 'elbow', scheme: 'blue', colorByLevel: false })
    const partial = normalizeSettings({ listNodes: true, styles: { defaults: { scheme: 'warm' } } })
    expect(partial.listNodes).toBe(true)
    expect(partial.styles.defaults).toMatchObject({ branch: 'elbow', scheme: 'warm' })
  })
  it('preserves every explicit old setting and per-note style on upgrade', () => {
    const saved = {
      gracefulAnimation: false, strictLineBreak: true, listNodes: true,
      styles: { defaults: { branch: 'curve', scheme: 'theme', colorByLevel: true },
        perFile: { 'note.md': { branch: 'straight', scheme: 'green', fontScale: 1.2 } } },
    }
    const original = JSON.stringify(saved)
    const settings = normalizeSettings(saved)
    expect(settings).toMatchObject(saved)
    const store = new StyleStore(settings.styles, () => {})
    expect(store.styleFor('note.md')).toMatchObject({ branch: 'straight', scheme: 'green', fontScale: 1.2 })
    expect(store.styleFor('other.md')).toMatchObject({ branch: 'curve', scheme: 'theme', colorByLevel: true })
    expect(JSON.stringify(saved)).toBe(original)
  })
})
