import { Notice, Plugin, type WorkspaceLeaf } from 'obsidian'
import { highlightExtension } from './doc/highlight'
import {
  MindmapSettingTab,
  normalizeSettings,
  type MindmapHost,
  type MindmapSettings,
} from './settings/SettingsTab'
import { StyleStore } from './settings/StyleStore'
import { MindmapView, VIEW_TYPE_MINDMAP } from './view/MindmapView'

/** 插件入口，只做注册与装配（第 3 章）。 */
export default class OutlineMindmapPlugin extends Plugin implements MindmapHost {
  settings: MindmapSettings = normalizeSettings(null)
  /** 样式两级存储。它就地读写 `settings.styles`，落盘复用 saveSettings（红线 1：只进 data.json）。 */
  styles: StyleStore = this.makeStyleStore()

  override async onload(): Promise<void> {
    await this.loadSettings()

    this.registerView(VIEW_TYPE_MINDMAP, (leaf) => new MindmapView(leaf, this))
    // 行高亮的 CM 扩展。注册在插件上，卸载插件时 Obsidian 自动摘掉。
    this.registerEditorExtension(highlightExtension())
    this.addSettingTab(new MindmapSettingTab(this.app, this, this))

    // 单篇样式的 key 是文件路径（陷阱 7）：改名 / 移动要迁移，删除要清理，
    // 否则改一次文件名样式就丢了，删一堆笔记 data.json 里的垃圾还留着。
    // 文件夹改名也走同一条：StyleStore 按路径前缀批量迁移。
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        this.styles.rename(oldPath, file.path)
      }),
    )
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        this.styles.remove(file.path)
      }),
    )

    // 侧边栏图标固定为导图图标——与 MindmapView.getIcon() 是同一个（M7）
    this.addRibbonIcon('network', '在侧边栏打开大纲思维导图', () => {
      void this.activateView('right')
    })

    this.addCommand({
      id: 'open-outline-mindmap',
      name: '打开大纲思维导图',
      callback: () => {
        void this.activateView('tab')
      },
    })

    this.addCommand({
      id: 'open-outline-mindmap-sidebar',
      name: '在侧边栏打开大纲思维导图',
      callback: () => {
        void this.activateView('right')
      },
    })

    // 性能自检（M10）。手册里「首次渲染 > 500ms 就上视口虚拟化」是个条件，
    // 而 DOM 的耗时只有在真实环境里才量得准，所以把尺子交到用户手上。
    this.addCommand({
      id: 'outline-mindmap-perf-report',
      name: '导图性能自检',
      callback: () => {
        const view = this.app.workspace
          .getLeavesOfType(VIEW_TYPE_MINDMAP)
          .map((leaf) => leaf.view)
          .find((v): v is MindmapView => v instanceof MindmapView)
        // 弹 12 秒：报告有五行，默认那几秒读不完
        new Notice(view ? view.perfReport() : '请先打开大纲思维导图。', 12000)
      },
    })
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData())
    // settings 换了一份对象，StyleStore 持有的是旧的那份，必须跟着换
    this.styles = this.makeStyleStore()
  }

  private makeStyleStore(): StyleStore {
    return new StyleStore(this.settings.styles, () => {
      this.saveSettings().catch((err: unknown) => console.error('[outline-mindmap]', err))
    })
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }

  /**
   * 打开导图。同一个 `MindmapView` 既能待在主页面区，也能待在右侧边栏（M7）——
   * 两处各找各的叶子，因此可以同时开着、互不干扰。
   *
   * @param where `'tab'` = 主页面区新标签页；`'right'` = 右侧边栏
   */
  private async activateView(where: 'tab' | 'right'): Promise<void> {
    const workspace = this.app.workspace
    const inSidebar = (leaf: WorkspaceLeaf): boolean => leaf.getRoot() === workspace.rightSplit

    const existing = workspace
      .getLeavesOfType(VIEW_TYPE_MINDMAP)
      .find((leaf) => inSidebar(leaf) === (where === 'right'))
    const leaf = existing ?? (where === 'right' ? workspace.getRightLeaf(false) : workspace.getLeaf('tab'))
    if (!leaf) return
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE_MINDMAP, active: true })
    await workspace.revealLeaf(leaf)
  }
}
