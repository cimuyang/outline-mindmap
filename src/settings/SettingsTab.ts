/**
 * 插件设置：四个开关（M8）。样式本身在 StyleStore / StyleModal 里。
 *
 * 【所有配置存在插件自身的 data.json，绝不写进笔记】（第 1 章红线）。
 */

import { Notice, PluginSettingTab, Setting, type App, type Plugin, type TFile, type WorkspaceLeaf } from 'obsidian'
import { label } from '../view/strings'
import { t, type MsgKey } from '../i18n'
import type { FileHistory } from '../doc/FileHistory'
import type { SearchState } from '../view/search'
import { normalizeOpenAsData, type NoteMode, type OpenAsData } from './OpenAsStore'
import { normalizeViewPreferences, type ViewPreferenceData, type ViewPreferences } from './ViewPreferences'
import { defaultStyleData, normalizeStyleData, type StyleData, type StyleStore } from './StyleStore'

export interface MindmapSettings {
  /** 单击节点是否跳转到笔记对应位置。关掉之后单击只选中。 */
  initialLevel: number
  nodeBody: boolean
  clickToJump: boolean
  /** 固定显示一篇笔记：开启后导图不再跟着活动笔记切换（M7。键名保持 lockFile，不迁移旧配置）。 */
  lockFile: boolean
  mapMode: 'follow' | 'fixed' | 'independent'
  /** 默认启用短过渡；大图与系统减少动态效果时使用即时布局。 */
  gracefulAnimation: boolean
  /** 严格换行：新增 / 移动节点时，相邻标题之间补足 3 个空行（附录 A.6）。 */
  strictLineBreak: boolean
  /** 把列表项显示为导图节点。关掉后导图只画标题，列表行只是最近标题的正文。 */
  orderedListNodes: boolean
  deepListMarker: '-' | '1.'
  listNodes: boolean
  /** 记住每篇笔记的打开方式：用「打开为导图」转换过的笔记，下次打开直接是导图（v1.3.2）。 */
  rememberOpenAs: boolean
  /** 全局样式 + 单篇样式。运行时由 StyleStore 就地读写这一份对象。 */
  styles: StyleData
  /** 要以导图打开的笔记。运行时由 OpenAsStore 就地读写这一份对象。 */
  openAs: OpenAsData
  views: ViewPreferenceData
}

export const DEFAULT_SETTINGS: MindmapSettings = {
  initialLevel: 0,
  nodeBody: false,
  clickToJump: true,
  lockFile: false,
  mapMode: 'fixed',
  gracefulAnimation: true,
  strictLineBreak: false,
  listNodes: false,
  orderedListNodes: false,
  deepListMarker: '-',
  rememberOpenAs: true,
  styles: defaultStyleData(),
  openAs: {},
  views: {},
}

/** data.json 里读到的东西 → 一份合法设置。缺字段、类型不对、超范围的一律收拢。 */
export function normalizeSettings(raw: unknown): MindmapSettings {
  const o = (raw ?? {}) as Record<string, unknown>
  const bool = (key: keyof MindmapSettings, fallback: boolean): boolean =>
    typeof o[key] === 'boolean' ? o[key] : fallback
  return {
    initialLevel: Number.isInteger(o.initialLevel) && Number(o.initialLevel) >= -1 && Number(o.initialLevel) <= 6 ? Number(o.initialLevel) : 0,
    nodeBody: bool('nodeBody', false),
    clickToJump: bool('clickToJump', DEFAULT_SETTINGS.clickToJump),
    mapMode: o.mapMode === 'follow' || o.mapMode === 'fixed' || o.mapMode === 'independent'
      ? o.mapMode : o.independentMaps === true ? 'independent' : 'fixed',
    lockFile: bool('lockFile', DEFAULT_SETTINGS.lockFile),
    gracefulAnimation: bool('gracefulAnimation', DEFAULT_SETTINGS.gracefulAnimation),
    strictLineBreak: bool('strictLineBreak', DEFAULT_SETTINGS.strictLineBreak),
    deepListMarker: o.deepListMarker === '1.' ? '1.' : '-',
    orderedListNodes: bool('orderedListNodes', false),
    listNodes: bool('listNodes', DEFAULT_SETTINGS.listNodes),
    rememberOpenAs: bool('rememberOpenAs', DEFAULT_SETTINGS.rememberOpenAs),
    styles: normalizeStyleData(o['styles']),
    openAs: normalizeOpenAsData(o['openAs']),
    views: normalizeViewPreferences(o['views']),
  }
}

/**
 * 视图需要的插件能力。
 *
 * 视图不直接依赖插件类——那会让 main.ts 与 view/ 互相 import。
 */
export interface MindmapHost {
  readonly fileHistory: FileHistory<TFile>
  readonly settings: MindmapSettings
  readonly styles: StyleStore
  readonly preferences: ViewPreferences
  saveSettings(): Promise<void>
  /** 解析类设置变了（如「把列表项显示为节点」）：让所有导图按新规则重新解析当前笔记。 */
  reloadMindmaps(): void
  refreshMapMode?(): void
  /** 导图这一侧的「打开为笔记」：同一个叶子就地变回 Markdown，并忘掉「以导图打开」的记忆。 */
  openAsNote(leaf: WorkspaceLeaf, file: TFile, mode?: NoteMode): Promise<void>
  openSearchResult(leaf: WorkspaceLeaf, file: TFile, state: SearchState, mode?: NoteMode): Promise<void>
}

export class MindmapSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private readonly host: MindmapHost,
  ) {
    super(app, plugin)
  }

  private groups(): SettingsGroup[] {
    return [
      { type: 'group', heading: label('正文与卡片', 'Body cards'), items: [
        { name: label('启用节点正文', 'Node body'), desc: label('点击节点旁的正文图标直接编辑。支持自动保存、置顶保留和侧栏／底栏停靠。', 'Read next to a node or pin the body panel to keep writing.'),
          render: row => {
            row.addToggle(toggle => toggle.setValue(this.host.settings.nodeBody).onChange(async value => {
              this.host.settings.nodeBody = value
              await this.host.saveSettings()
              this.host.reloadMindmaps()
            }))
          },
        },
      ] },
      { type: 'group', heading: t('settings.openMode'), items: [
        { name: t('settings.mainArea'), desc: t('settings.mainAreaDesc'),
          render: row => {
            row.addDropdown(dropdown => dropdown
              .addOption('follow', t('settings.follow'))
              .addOption('fixed', t('settings.fixed'))
              .addOption('independent', t('settings.independentMaps'))
              .setValue(this.host.settings.mapMode)
              .onChange(async mode => {
                if (mode !== 'follow' && mode !== 'fixed' && mode !== 'independent') return
                this.host.settings.mapMode = mode
                this.host.refreshMapMode?.()
                await this.host.saveSettings()
              }))
          },
        },
        { name: t('settings.lockFile'), desc: t('settings.lockFileDesc'),
          render: row => {
            row.addDropdown(dropdown => dropdown.addOption('follow', t('settings.follow')).addOption('fixed', t('settings.fixed'))
                .setValue(this.host.settings.lockFile ? 'fixed' : 'follow').onChange(async value => {
                  this.host.settings.lockFile = value === 'fixed'
                  this.host.refreshMapMode?.()
                  await this.host.saveSettings()
                }))
          },
        },
        this.toggle('settings.rememberOpenAs', 'settings.rememberOpenAsDesc', 'rememberOpenAs'),
      ] },
      { type: 'group', heading: t('settings.nodes'), items: [
        this.toggle('settings.strictLineBreak', 'settings.strictLineBreakDesc', 'strictLineBreak'),
        this.toggle('settings.listNodes', 'settings.listNodesDesc', 'listNodes', () => this.host.reloadMindmaps()),
        this.toggle('settings.orderedListNodes', 'settings.orderedListNodesDesc', 'orderedListNodes', () => this.host.reloadMindmaps()),
        { name: t('settings.deepFormat'), desc: t('settings.deepFormatDesc'),
          render: row => {
            row.addDropdown(dropdown => dropdown.addOption('-', t('settings.unordered')).addOption('1.', t('settings.ordered'))
                .setValue(this.host.settings.deepListMarker).onChange(async value => {
                  this.host.settings.deepListMarker = value === '1.' ? '1.' : '-'
                  await this.host.saveSettings()
                }))
          },
        },
      ] },
      { type: 'group', heading: t('settings.interaction'), items: [
        { name: label('节点移动快捷键', 'Branch movement hotkeys'),
          desc: label('上移、下移、提升或降低选中分支。', 'Reorder, promote or demote the selected branch.'),
          render: row => { row.addButton(button => button.setButtonText(label('配置', 'Configure')).onClick(() => this.openMovementHotkeys())) },
        },
        this.toggle('settings.clickToJump', 'settings.clickToJumpDesc', 'clickToJump'),
        this.toggle('settings.gracefulAnimation', 'settings.gracefulAnimationDesc', 'gracefulAnimation'),
      ] },
    ]
  }

  override getSettingDefinitions() { return this.groups() }

  private openMovementHotkeys(): void {
    // Older hosts expose the native hotkey page through the settings controller.
    type HotkeyPage = { searchComponent?: { inputEl: HTMLInputElement } }
    const settings = (this.app as App & { setting?: { openTabById?: (id: string) => HotkeyPage | undefined } }).setting
    const page = settings?.openTabById?.('hotkeys')
    const query = label('移动分支 ·', 'Move branch ·')
    const input = page?.searchComponent?.inputEl
    if (input) {
      input.value = query
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.focus()
    } else {
      new Notice(label('请在设置 → 快捷键中搜索「移动分支」。', 'Search for “Move branch” in Settings → Hotkeys.'))
    }
  }

  override display(): void {
    this.containerEl.empty()
    for (const group of this.groups()) {
      new Setting(this.containerEl).setName(group.heading).setHeading()
      for (const item of group.items) {
        item.render(new Setting(this.containerEl).setName(item.name).setDesc(item.desc))
      }
    }
  }

  private toggle(name: MsgKey, desc: MsgKey, key: BooleanSettingKey, afterChange?: () => void): SettingsRow {
    return { name: t(name), desc: t(desc), render: row => {
      row.addToggle(control => control.setValue(this.host.settings[key]).onChange(async value => {
        this.host.settings[key] = value
        afterChange?.()
        await this.host.saveSettings()
      }))
    } }
  }
}

interface SettingsRow {
  name: string
  desc: string
  render(row: Setting): void
}

interface SettingsGroup {
  type: 'group'
  heading: string
  items: SettingsRow[]
}

type BooleanSettingKey = {
  [K in keyof MindmapSettings]: MindmapSettings[K] extends boolean ? K : never
}[keyof MindmapSettings]
