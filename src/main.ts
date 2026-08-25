import { Notice, Plugin, TFile, type WorkspaceLeaf } from 'obsidian'
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

    // 笔记这一侧的「打开为导图」。右上角三个点、文件列表右键、标签页右键都走 file-menu，
    // 所以一处注册，三处都有。反方向的「打开为笔记」在 MindmapView.onPaneMenu 里。
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file, _source, leaf) => {
        if (!(file instanceof TFile) || file.extension !== 'md') return
        menu.addItem((item) =>
          item
            .setTitle('打开为导图')
            .setIcon('network')
            .onClick(() => {
              void this.openAsMindmap(file, leaf)
            }),
        )
      }),
    )

    // 侧边栏图标固定为导图图标——与 MindmapView.getIcon() 是同一个（M7）
    this.addRibbonIcon('network', '在侧边栏打开大纲思维导图', () => {
      void this.activateView('right')
    })

    this.addCommand({
      // 命令 ID 与名称都不再重复插件名：Obsidian 会自己加上插件名前缀（官方审查要求）
      id: 'open',
      name: '打开导图',
      callback: () => {
        void this.activateView('tab')
      },
    })

    this.addCommand({
      id: 'open-in-sidebar',
      name: '在侧边栏打开导图',
      callback: () => {
        void this.activateView('right')
      },
    })

    // 性能自检（M10）。手册里「首次渲染 > 500ms 就上视口虚拟化」是个条件，
    // 而 DOM 的耗时只有在真实环境里才量得准，所以把尺子交到用户手上。
    this.addCommand({
      id: 'perf-report',
      name: '性能自检',
      callback: () => {
        const view = this.mindmapViews()[0]
        // 弹 12 秒：报告有五行，默认那几秒读不完
        new Notice(view ? view.perfReport() : '请先打开大纲思维导图。', 12000)
      },
    })

    // 跟随自检。「导图没跟着笔记切换」有好几种成因，现象却一模一样，
    // 报几个事实出来，用户不必替我们猜。开着几个导图就报几份。
    //
    // 【顺手复制到剪贴板】：报告有十几行，Notice 里既读不完也选不中，
    // 而这份东西的用途本来就是贴给别人看。复制失败也不影响读，所以不打断。
    this.addCommand({
      id: 'follow-report',
      name: '跟随自检',
      callback: () => {
        const views = this.mindmapViews()
        if (views.length === 0) {
          new Notice('请先打开大纲思维导图。')
          return
        }
        const text = views.map((v) => v.diagnostics()).join('\n\n')
        new Notice(`${text}\n\n（已复制到剪贴板）`, 30000)
        void navigator.clipboard.writeText(text).catch(() => undefined)
      },
    })
  }

  /** 当前开着的导图视图。主页面区与侧边栏可以同时开着，所以是一串。 */
  private mindmapViews(): MindmapView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_MINDMAP)
      .map((leaf) => leaf.view)
      .filter((v): v is MindmapView => v instanceof MindmapView)
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
   * 把一篇笔记显示为导图。
   *
   * @param leaf 笔记所在的叶子。有就【就地换形态】——同一个标签页从 Markdown 变成导图，
   *   和「打开为笔记」正好互为反向。从文件列表右键点进来时没有叶子，那就新开一个标签页。
   */
  private async openAsMindmap(file: TFile, leaf?: WorkspaceLeaf): Promise<void> {
    const target = leaf ?? this.app.workspace.getLeaf('tab')
    // 【先真的把这篇打开、并让它成为活动笔记，再换形态】。
    //
    // 从文件列表右键点进来时这篇还不是活动笔记；从标签页右键点进来时那个叶子也未必是活动的。
    // 换形态之后，新导图是按【活动笔记】来定自己显示哪一篇的（见 MindmapView.onOpen 结尾），
    // 问到上一篇就会当着用户的面跳到别的笔记上。
    // 无条件 openFile 一次，两条路径就都不必跟事件抢时序——叶子里已经是这篇时它也很便宜。
    await target.openFile(file)
    await target.setViewState({
      type: VIEW_TYPE_MINDMAP,
      active: true,
      // 指名这一篇：换形态之后活动笔记未必还是它，让导图跟着活动笔记猜是会猜错的
      state: { file: file.path },
    })
    await this.app.workspace.revealLeaf(target)
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
