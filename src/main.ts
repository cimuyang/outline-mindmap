import { MarkdownView, Notice, Plugin, TFile, type ViewState, type WorkspaceLeaf } from 'obsidian'
import { highlightExtension } from './doc/highlight'
import { annotatePreviewSection } from './doc/preview'
import { t } from './i18n'
import { OpenAsStore, type NoteMode } from './settings/OpenAsStore'
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
  styles!: StyleStore
  /** 「以导图打开」的记忆。同样就地读写 `settings.openAs`，只进 data.json。 */
  openAs!: OpenAsStore

  override async onload(): Promise<void> {
    await this.loadSettings()

    this.registerView(VIEW_TYPE_MINDMAP, (leaf) => new MindmapView(leaf, this))
    // 行高亮的 CM 扩展。注册在插件上，卸载插件时 Obsidian 自动摘掉。
    this.registerEditorExtension(highlightExtension())
    // 阅读模式是分块渲染的。只记录 Obsidian 公开的源码范围，不改渲染内容。
    this.registerMarkdownPostProcessor((element, context) => {
      const info = context.getSectionInfo(element)
      if (info) annotatePreviewSection(element, context.sourcePath, info)
    })
    this.addSettingTab(new MindmapSettingTab(this.app, this, this))

    // 单篇样式的 key 是文件路径（陷阱 7）：改名 / 移动要迁移，删除要清理，
    // 否则改一次文件名样式就丢了，删一堆笔记 data.json 里的垃圾还留着。
    // 文件夹改名也走同一条：StyleStore 按路径前缀批量迁移。
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        this.styles.rename(oldPath, file.path)
        this.openAs.rename(oldPath, file.path)
      }),
    )
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        this.styles.remove(file.path)
        this.openAs.remove(file.path)
      }),
    )

    // 笔记这一侧的「打开为导图」。右上角三个点、文件列表右键、标签页右键都走 file-menu，
    // 所以一处注册，三处都有。反方向的「打开为笔记」在 MindmapView.onPaneMenu 里。
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file, _source, leaf) => {
        if (!(file instanceof TFile) || file.extension !== 'md') return
        // 从文件列表右键进来时没有叶子：这篇若已经在某个标签页里开着，就地转换那一个，
        // 与三个点菜单的行为一致，也不会出现「一个笔记 A、一个导图 A」两个标签页。
        const target = leaf ?? this.leafShowing(file)
        // 记下此刻的阅读 / 编辑模式，「打开为笔记」时还原
        const view = target?.view
        const noteMode: NoteMode = view instanceof MarkdownView ? view.getMode() : 'source'
        menu.addItem((item) =>
          item
            .setTitle(t('menu.openAsMindmap'))
            .setIcon('network')
            .onClick(() => {
              if (this.settings.rememberOpenAs) this.openAs.remember(file.path, noteMode)
              void this.openAsMindmap(file, target)
            }),
        )
      }),
    )

    // 回放记忆：一篇记过「以导图打开」的笔记在某个标签页里以 Markdown 形态露出来了，就换成导图。
    // 两个触发点，同一个 `replay`：
    // - active-leaf-change 带着叶子来，是主路径；
    // - layout-change 是兜底。Obsidian 每次叶子装完新文件都会在 setViewState 收尾后发它，
    //   正是「现在可以安全换形态」的信号（主路径的那次事件可能来得太早，见 replay）。
    // 【形态切换不进标签页历史】（见 switchForm），所以「后退」不会退回同一篇的笔记形态，
    // 这里不需要任何「是不是在后退」的判断——回放是幂等的：是记过的笔记就换，换过了就没事可做。
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => void this.replay(leaf)),
    )
    this.registerEvent(
      this.app.workspace.on('layout-change', () =>
        void this.replay(this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ?? null),
      ),
    )

    // 侧边栏图标固定为导图图标——与 MindmapView.getIcon() 是同一个（M7）
    this.addRibbonIcon('network', t('ribbon.open'), () => {
      void this.activateView('right')
    })

    this.addCommand({
      // 命令 ID 与名称都不再重复插件名：Obsidian 会自己加上插件名前缀（官方审查要求）
      id: 'open',
      name: t('command.open'),
      callback: () => {
        void this.activateView('tab')
      },
    })

    this.addCommand({
      id: 'open-in-sidebar',
      name: t('command.openInSidebar'),
      callback: () => {
        void this.activateView('right')
      },
    })

    // 性能自检（M10）。手册里「首次渲染 > 500ms 就上视口虚拟化」是个条件，
    // 而 DOM 的耗时只有在真实环境里才量得准，所以把尺子交到用户手上。
    this.addCommand({
      id: 'perf-report',
      name: t('command.perfReport'),
      callback: () => {
        const view = this.mindmapViews()[0]
        // 弹 12 秒：报告有五行，默认那几秒读不完
        new Notice(view ? view.perfReport() : t('notice.openMindmapFirst'), 12000)
      },
    })

    // 跟随自检。「导图没跟着笔记切换」有好几种成因，现象却一模一样，
    // 报几个事实出来，用户不必替我们猜。开着几个导图就报几份。
    //
    // 【顺手复制到剪贴板】：报告有十几行，Notice 里既读不完也选不中，
    // 而这份东西的用途本来就是贴给别人看。复制失败也不影响读，所以不打断。
    this.addCommand({
      id: 'follow-report',
      name: t('command.followReport'),
      callback: () => {
        const views = this.mindmapViews()
        if (views.length === 0) {
          new Notice(t('notice.openMindmapFirst'))
          return
        }
        const text = views.map((v) => v.diagnostics()).join('\n\n')
        new Notice(`${text}\n\n${t('notice.copiedToClipboard')}`, 30000)
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
    // settings 换了一份对象，两个 store 持有的是旧的那份，必须跟着换
    const persist = (): void => {
      this.saveSettings().catch((err: unknown) => console.error('[outline-mindmap]', err))
    }
    this.styles = new StyleStore(this.settings.styles, persist)
    this.openAs = new OpenAsStore(this.settings.openAs, persist)
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }

  /** 解析类设置变了：所有开着的导图按新规则重新解析当前笔记（MindmapHost）。 */
  reloadMindmaps(): void {
    for (const view of this.mindmapViews()) void view.reparse()
  }

  /**
   * 回放「以导图打开」的记忆：这个叶子里若正以 Markdown 形态露着一篇记过的笔记，就换成导图。
   *
   * 点文件列表打开笔记时，Obsidian 先把叶子设为活动（排一个 0ms 的 active-leaf-change），
   * 再进 `setViewState` 异步读盘装内容；那次事件常常抢在读盘完成之前送到，此时叶子的
   * `setViewState` 还在进行中，而它对嵌套调用的处理是【静默忽略】——不报错、不排队。
   * 这里不必为此做任何事：回放是幂等的，读盘完成后的下一次事件（或 layout-change 兜底）
   * 会再来一遍；已经换成导图的叶子进不了下面的 instanceof 判断。
   */
  private async replay(leaf: WorkspaceLeaf | null): Promise<void> {
    const view = leaf?.view
    if (!leaf || !this.settings.rememberOpenAs || !(view instanceof MarkdownView) || !view.file) return
    if (this.openAs.isMindmap(view.file.path)) await this.openAsMindmap(view.file, leaf)
  }

  /** 已经以 Markdown 形态开着这篇笔记的叶子（延迟加载的也算，按视图状态里的路径认）。 */
  private leafShowing(file: TFile): WorkspaceLeaf | undefined {
    return this.app.workspace
      .getLeavesOfType('markdown')
      .find((leaf) => leaf.getViewState().state?.['file'] === file.path)
  }

  /**
   * 把一篇笔记显示为导图。
   *
   * @param leaf 笔记所在的叶子。有就【就地换形态】——同一个标签页从 Markdown 变成导图，
   *   和「打开为笔记」正好互为反向。没有（文件列表右键、且这篇没开着）就新开一个标签页。
   */
  private async openAsMindmap(file: TFile, leaf?: WorkspaceLeaf): Promise<void> {
    const target = leaf ?? this.app.workspace.getLeaf('tab')
    await this.switchForm(target, {
      type: VIEW_TYPE_MINDMAP,
      active: true,
      // 【钉在这一篇上】：它是这篇笔记的标签页换了形态，不跟随活动笔记，也不让导图去猜——
      // 换形态之后这个叶子里已经是导图而不是笔记，Obsidian 问「活动笔记」时会回退到
      // 【别的】标签页里最近活动的那篇，猜出来的永远是上一篇（issue #5）。
      state: { file: file.path, pinned: true },
    })
    await this.app.workspace.revealLeaf(target)
  }

  /**
   * 导图这一侧的「打开为笔记」（MindmapHost）：同一个叶子就地变回 Markdown。
   *
   * 【先忘、再换】：换回去的那一刻会触发 active-leaf-change，记忆若还在，回放那一路会立刻把它
   * 再换成导图，来回死循环。模式用转换时记下的那一个，阅读模式的用户不会被切到编辑模式。
   */
  async openAsNote(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    const mode = this.openAs.noteModeOf(file.path)
    this.openAs.forget(file.path)
    await this.switchForm(leaf, {
      type: 'markdown',
      active: true,
      state: { file: file.path, mode },
    })
  }

  /**
   * 换形态（笔记 ⇄ 导图），【不进标签页历史】。
   *
   * 它是同一篇笔记换了个样子，不是「去了另一个地方」。若记进历史，「后退」会从导图退回
   * 同一篇的笔记形态，记忆随即又把它换回导图，后退就此卡死；不记，后退 / 前进就只在笔记之间
   * 移动，前进历史也不会被这一步清掉。`popstate` 正是 Obsidian 自己的前进 / 后退调用
   * setViewState 时用来表示「这一步别记」的标记；它不在公开类型里，万一将来失效，
   * 退化行为只是「后退到笔记形态后被换回导图」，不涉及任何数据。
   */
  private switchForm(leaf: WorkspaceLeaf, state: ViewState): Promise<void> {
    return leaf.setViewState({ ...state, popstate: true } as ViewState)
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
