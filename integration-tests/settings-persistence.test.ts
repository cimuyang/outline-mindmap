import { describe, expect, it, vi } from 'vitest'
import OutlineMindmapPlugin from '../src/main'

describe('serialized settings persistence', () => {
  it('writes snapshots in order even if an earlier save is slow', async () => {
    const plugin = new OutlineMindmapPlugin({} as any)
    let finish!: () => void
    const save = vi.spyOn(plugin, 'saveData').mockImplementationOnce(() =>
      new Promise<void>(resolve => { finish = resolve })).mockResolvedValue(undefined)
    plugin.settings.lockFile = true
    const first = plugin.saveSettings()
    plugin.settings.lockFile = false
    const second = plugin.saveSettings()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]![0].lockFile).toBe(true)
    finish(); await first; await second
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]![0].lockFile).toBe(false)
  })

  it('a failed save does not block later preferences', async () => {
    const plugin = new OutlineMindmapPlugin({} as any)
    const save = vi.spyOn(plugin, 'saveData').mockRejectedValueOnce(Error('disk full')).mockResolvedValue(undefined)
    await expect(plugin.saveSettings()).rejects.toThrow('disk full')
    await expect(plugin.saveSettings()).resolves.toBeUndefined()
    expect(save).toHaveBeenCalledTimes(2)
  })
})
