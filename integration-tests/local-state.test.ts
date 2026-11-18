import { afterEach, expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { requireApiVersion } from './obsidian-runtime'
import { readLocalState, writeLocalState } from '../src/settings/localState'

afterEach(() => { vi.unstubAllGlobals(); requireApiVersion.mockReturnValue(true) })

it('isolates legacy drafts and levels by vault and migrates them on first read', () => {
  const local = new Map<string, string>()
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => local.set(key, value),
    removeItem: (key: string) => local.delete(key),
  } })
  function appAt(root: string): App {
    const data = new Map<string, unknown>()
    return {
      vault: { adapter: { getResourcePath: () => root } },
      loadLocalStorage: (key: string) => data.get(key) ?? null,
      saveLocalStorage: (key: string, value: unknown) => data.set(key, value),
    } as unknown as App
  }
  const app = appAt('app://local/a/Notes'), other = appAt('app://local/b/Notes')
  const draft = { title: 'Heading', text: 'Edited', source: 'Original' }
  requireApiVersion.mockReturnValue(false)
  writeLocalState(app, 'draft', draft)
  writeLocalState(app, 'level', 0)
  expect(readLocalState(other, 'draft')).toBeNull()
  expect(readLocalState(app, 'draft')).toEqual(draft)
  requireApiVersion.mockReturnValue(true)
  expect(readLocalState(app, 'draft')).toEqual(draft)
  expect(readLocalState(app, 'level')).toBe(0)
  expect(local.size).toBe(0)
  expect(readLocalState(app, 'draft')).toEqual(draft)
  writeLocalState(app, 'draft', null)
  expect(readLocalState(app, 'draft')).toBeNull()
})
