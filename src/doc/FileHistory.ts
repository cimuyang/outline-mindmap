/** Session-only history shared by all maps. File identity survives renames. */
export type HistoryDirection = 'undo' | 'redo'
export interface HistoryEntry { before: string; after: string }
interface History { undo: HistoryEntry[]; redo: HistoryEntry[] }

export class FileHistory<K extends object> {
  private readonly histories = new Map<K, History>()
  private readonly queues = new WeakMap<K, Promise<unknown>>()
  private readonly listeners = new Set<(file: K, text: string) => void>()

  constructor(private readonly maxEntries = 100, private readonly maxChars = 4_000_000,
    private readonly maxFiles = 16) {}

  /** Failed operations must not poison the queue; different files remain independent. */
  run<T>(file: K, operation: () => Promise<T> | T): Promise<T> {
    const run = (this.queues.get(file) ?? Promise.resolve()).then(operation)
    this.queues.set(file, run.catch(() => undefined))
    return run
  }

  clear(file: K): void { this.histories.delete(file) }

  subscribe(listener: (file: K, text: string) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  publish(file: K, text: string): void {
    for (const listener of this.listeners) listener(file, text)
  }

  record(file: K, before: string, after: string): void {
    if (before === after) return
    let history = this.histories.get(file)
    const previous = history?.undo.at(-1)
    const expected = history?.redo.at(-1)?.before ?? previous?.after
    if (!history || (expected !== undefined && expected !== before)) {
      history = { undo: [], redo: [] }
    }
    history.redo = []
    history.undo.push({ before, after })
    let chars = history.undo.reduce((n, e) => n + e.before.length + e.after.length, 0)
    while (history.undo.length > this.maxEntries || chars > this.maxChars) {
      const entry = history.undo.shift()
      if (!entry) break
      chars -= entry.before.length + entry.after.length
    }
    this.histories.delete(file)
    this.histories.set(file, history)
    const totalChars = (): number => [...this.histories.values()].reduce((sum, h) => sum +
      [...h.undo, ...h.redo].reduce((n, e) => n + e.before.length + e.after.length, 0), 0)
    while (this.histories.size > this.maxFiles || totalChars() > this.maxChars) {
      const oldest = this.histories.keys().next().value
      if (oldest === undefined) break
      this.histories.delete(oldest)
    }
  }

  peek(file: K, direction: HistoryDirection): HistoryEntry | undefined {
    return this.histories.get(file)?.[direction].at(-1)
  }

  /** Move the cursor only after the write succeeded. */
  commit(file: K, direction: HistoryDirection, entry: HistoryEntry): void {
    const history = this.histories.get(file)
    if (!history || history[direction].at(-1) !== entry) return
    history[direction].pop()
    history[direction === 'undo' ? 'redo' : 'undo'].push(entry)
  }
}
