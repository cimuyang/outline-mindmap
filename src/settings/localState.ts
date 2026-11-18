import { requireApiVersion, type App } from 'obsidian'

// The resource URL distinguishes vaults with identical display names.
function legacyKey(app: App, key: string): string {
  const root = app.vault.adapter.getResourcePath('.').split('?')[0]
  return JSON.stringify(['outline-mindmap', root, key])
}

export function readLocalState(app: App, key: string): unknown {
  if (requireApiVersion('1.8.7')) {
    const saved: unknown = app.loadLocalStorage(key)
    if (saved != null) return saved
  }
  const id = legacyKey(app, key)
  const raw = window.localStorage.getItem(id)
  if (raw === null) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (requireApiVersion('1.8.7')) {
    app.saveLocalStorage(key, value)
    window.localStorage.removeItem(id)
  }
  return value
}

export function writeLocalState(app: App, key: string, value: unknown): void {
  const id = legacyKey(app, key)
  if (requireApiVersion('1.8.7')) {
    app.saveLocalStorage(key, value)
    window.localStorage.removeItem(id)
  } else if (value == null) {
    window.localStorage.removeItem(id)
  } else {
    window.localStorage.setItem(id, JSON.stringify(value))
  }
}
