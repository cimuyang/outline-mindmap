/**
 * 插件设置：四个开关（M8）。样式本身在 StyleStore / StyleModal 里。
 *
 * 【所有配置存在插件自身的 data.json，绝不写进笔记】（第 1 章红线）。
 */

import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian'
import { defaultStyleData, normalizeStyleData, type StyleData, type StyleStore } from './StyleStore'

export interface MindmapSettings {
  /** 单击节点是否跳转到笔记对应位置。关掉之后单击只选中。 */
  clickToJump: boolean
  /** 锁定当前笔记：开启后导图不再跟着活动笔记切换（M7）。 */
  lockFile: boolean
  /** 优雅动画：节点位置变化时做过渡。默认关——节点一多，动画就是卡顿的来源（红线 4）。 */
  gracefulAnimation: boolean
  /** 严格换行：新增 / 移动节点时，相邻标题之间补足 3 个空行（附录 A.6）。 */
  strictLineBreak: boolean
  /** 全局样式 + 单篇样式。运行时由 StyleStore 就地读写这一份对象。 */
  styles: StyleData
}

export const DEFAULT_SETTINGS: MindmapSettings = {
  clickToJump: true,
  lockFile: false,
  gracefulAnimation: false,
  strictLineBreak: true,
  styles: defaultStyleData(),
}

/** data.json 里读到的东西 → 一份合法设置。缺字段、类型不对、超范围的一律收拢。 */
export function normalizeSettings(raw: unknown): MindmapSettings {
  const o = (raw ?? {}) as Record<string, unknown>
  const bool = (key: keyof MindmapSettings, fallback: boolean): boolean =>
    typeof o[key] === 'boolean' ? (o[key] as boolean) : fallback
  return {
    clickToJump: bool('clickToJump', DEFAULT_SETTINGS.clickToJump),
    lockFile: bool('lockFile', DEFAULT_SETTINGS.lockFile),
    gracefulAnimation: bool('gracefulAnimation', DEFAULT_SETTINGS.gracefulAnimation),
    strictLineBreak: bool('strictLineBreak', DEFAULT_SETTINGS.strictLineBreak),
    styles: normalizeStyleData(o['styles']),
  }
}

/**
 * 视图需要的插件能力。
 *
 * 视图不直接依赖插件类——那会让 main.ts 与 view/ 互相 import。
 */
export interface MindmapHost {
  readonly settings: MindmapSettings
  readonly styles: StyleStore
  saveSettings(): Promise<void>
}

export class MindmapSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private readonly host: MindmapHost,
  ) {
    super(app, plugin)
  }

  override display(): void {
    const { containerEl } = this
    containerEl.empty()

    this.toggle(
      '单击即跳转',
      '单击导图节点时，把编辑器滚动到对应标题并高亮。关闭后单击只选中节点。',
      'clickToJump',
    )
    this.toggle(
      '锁定当前笔记',
      '开启后，导图停在当前这篇笔记上，不再跟着活动笔记切换。',
      'lockFile',
    )
    this.toggle(
      '优雅动画',
      '节点位置变化时做一段过渡动画。节点较多时会明显变卡，默认关闭。',
      'gracefulAnimation',
    )
    this.toggle(
      '严格换行',
      '新增或移动节点时，在相邻的两个标题之间补足 3 个空行。关闭后只写必要的那一行。',
      'strictLineBreak',
    )
  }

  /** 四个开关长得一模一样，写成一个方法免得同一段代码抄四遍。 */
  private toggle(name: string, desc: string, key: BooleanSettingKey): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addToggle((t) =>
        t.setValue(this.host.settings[key]).onChange(async (value) => {
          this.host.settings[key] = value
          await this.host.saveSettings()
        }),
      )
  }
}

type BooleanSettingKey = {
  [K in keyof MindmapSettings]: MindmapSettings[K] extends boolean ? K : never
}[keyof MindmapSettings]
