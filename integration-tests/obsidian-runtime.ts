import { vi } from 'vitest'
import { FakeElement } from './fake-dom'

export const renderMath = vi.fn((source: string, display: boolean): HTMLElement => {
  if (source === String.raw`\bad`) throw new Error('invalid formula')
  const el = new FakeElement(display ? 'div' : 'span')
  el.appendText(`⟦${source}⟧`)
  return el as unknown as HTMLElement
})

export const finishRenderMath = vi.fn(async (): Promise<void> => {})
