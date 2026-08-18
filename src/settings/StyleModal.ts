/**
 * 样式窗口（M8）。
 *
 * 顶部固定三个按钮：应用全局设置 / 应用单篇笔记设置 / 取消。
 * 拖动任何一项都【实时预览】——预览只走 StyleStore 的内存态，
 * 按下「应用」之前 data.json 一个字节都不会变，笔记更是从头到尾没被碰过（红线 1）。
 *
 * 【点窗口外面默认视为应用】：Obsidian 的遮罩点击会直接 close()，
 * 我们在 onClose 里补上那次应用——用户看着预览满意了随手点开画布，
 * 结果样式被悄悄丢掉，是最让人恼火的一种交互。
 */

import { Modal, Setting, type App } from 'obsidian'
import type { BranchStyle } from '../layout/types'
import {
  STYLE_LIMITS,
  type ColorScheme,
  type MindmapStyle,
  type NodeShape,
  type StyleStore,
} from './StyleStore'

const SHAPE_LABELS: Record<NodeShape, string> = {
  rounded: '圆角矩形',
  pill: '胶囊',
  underline: '下划线',
}

const BRANCH_LABELS: Record<BranchStyle, string> = {
  straight: '直线',
  curve: '斜线',
  elbow: '折线',
}

const SCHEME_LABELS: Record<ColorScheme, string> = {
  theme: '跟随主题',
  blue: '蓝',
  green: '绿',
  warm: '暖',
}

export class StyleModal extends Modal {
  private readonly draft: MindmapStyle
  /** 已经按过三个按钮之一。没按过就关窗（点遮罩、Esc）按「应用」处理。 */
  private settled = false

  /**
   * @param path 当前笔记路径。为 null 表示没有笔记（此时只能应用全局设置）
   * @param title 笔记名，显示在窗口标题里
   */
  constructor(
    app: App,
    private readonly store: StyleStore,
    private readonly path: string | null,
    private readonly title: string | null,
  ) {
    super(app)
    this.draft = { ...store.styleFor(path) }
  }

  override onOpen(): void {
    this.modalEl.addClass('om-style-modal')
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h3', {
      text: this.title ? `导图样式：${this.title}` : '导图样式',
    })

    this.buildActions(contentEl)
    this.buildControls(contentEl)
  }

  override onClose(): void {
    // 没按按钮就关掉 = 应用。有笔记时落到单篇，没笔记时只能落到全局
    if (!this.settled) {
      const path = this.targetPath()
      if (path !== null) this.store.applyFile(path, this.draft)
      else this.store.applyGlobal(null, this.draft)
    }
    // 应用过的话预览已经被清掉了；这一行是给「取消」和异常路径兜底
    this.store.clearPreview()
    this.contentEl.empty()
  }

  /** 三个按钮固定在顶部：下面的控件再多、窗口再滚，它们始终在手边。 */
  private buildActions(host: HTMLElement): void {
    const bar = host.createDiv({ cls: 'om-style-actions' })

    const global = bar.createEl('button', { text: '应用全局设置' })
    global.addEventListener('click', () => {
      this.settled = true
      this.store.applyGlobal(this.targetPath(), this.draft)
      this.close()
    })

    const single = bar.createEl('button', { text: '应用单篇笔记设置', cls: 'mod-cta' })
    single.addEventListener('click', () => {
      const path = this.targetPath()
      if (path === null) return
      this.settled = true
      this.store.applyFile(path, this.draft)
      this.close()
    })
    if (this.path === null) {
      // 没有笔记就没有「单篇」可言。禁用而不是隐藏，免得按钮位置忽左忽右
      single.disabled = true
      single.setAttribute('aria-label', '当前没有打开的笔记')
    }

    const cancel = bar.createEl('button', { text: '取消' })
    cancel.addEventListener('click', () => {
      this.settled = true
      this.store.clearPreview() // 预览撤销 → 画面回到打开窗口之前的样子
      this.close()
    })
  }

  private buildControls(host: HTMLElement): void {
    new Setting(host)
      .setName('主题间距 · 横向')
      .setDesc('父节点与子节点之间的水平距离。')
      .addSlider((s) =>
        s
          .setLimits(STYLE_LIMITS.hGap.min, STYLE_LIMITS.hGap.max, STYLE_LIMITS.hGap.step)
          .setValue(this.draft.hGap)
          .setDynamicTooltip()
          .onChange((v) => this.update({ hGap: v })),
      )

    new Setting(host)
      .setName('主题间距 · 纵向')
      .setDesc('相邻分支之间的垂直距离。')
      .addSlider((s) =>
        s
          .setLimits(STYLE_LIMITS.vGap.min, STYLE_LIMITS.vGap.max, STYLE_LIMITS.vGap.step)
          .setValue(this.draft.vGap)
          .setDynamicTooltip()
          .onChange((v) => this.update({ vGap: v })),
      )

    new Setting(host).setName('节点形状').addDropdown((d) => {
      for (const [value, label] of Object.entries(SHAPE_LABELS)) d.addOption(value, label)
      d.setValue(this.draft.shape).onChange((v) => this.update({ shape: v as NodeShape }))
    })

    new Setting(host).setName('分支样式').addDropdown((d) => {
      for (const [value, label] of Object.entries(BRANCH_LABELS)) d.addOption(value, label)
      d.setValue(this.draft.branch).onChange((v) => this.update({ branch: v as BranchStyle }))
    })

    new Setting(host).setName('配色方案').addDropdown((d) => {
      for (const [value, label] of Object.entries(SCHEME_LABELS)) d.addOption(value, label)
      d.setValue(this.draft.scheme).onChange((v) => this.update({ scheme: v as ColorScheme }))
    })

    new Setting(host)
      .setName('字号缩放')
      .setDesc('1.0 表示跟随主题字号。')
      .addSlider((s) =>
        s
          .setLimits(
            STYLE_LIMITS.fontScale.min,
            STYLE_LIMITS.fontScale.max,
            STYLE_LIMITS.fontScale.step,
          )
          .setValue(this.draft.fontScale)
          .setDynamicTooltip()
          .onChange((v) => this.update({ fontScale: v })),
      )
  }

  /**
   * 要写到哪一篇上。
   *
   * 平时就是打开窗口时的那篇；窗口开着的时候笔记被改了名，以 StyleStore 迁移过的路径为准，
   * 否则会往一个已经不存在的文件名底下写配置——用户只会看到「样式没生效」。
   */
  private targetPath(): string | null {
    const moved = this.store.previewPath()
    return moved === undefined ? this.path : moved
  }

  /** 改一项 → 立刻预览。传副本进去：draft 之后还会被继续改，store 不该跟着变。 */
  private update(patch: Partial<MindmapStyle>): void {
    Object.assign(this.draft, patch)
    this.store.setPreview(this.path, { ...this.draft })
  }
}
