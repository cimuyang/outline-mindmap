import { Modal, Setting, type App } from 'obsidian'
import { t, type MsgKey } from '../i18n'
import type { BranchStyle, LayoutDirection } from '../layout/types'
import {
  DEFAULT_STYLE,
  STYLE_LIMITS,
  type ColorScheme,
  type MindmapStyle,
  type NodeShape,
  type StyleStore,
} from './StyleStore'

const SHAPE_LABELS: Record<NodeShape, MsgKey> = {
  rounded: 'shape.rounded',
  pill: 'shape.pill',
  underline: 'shape.underline',
}

const DIRECTION_LABELS: Record<LayoutDirection, MsgKey> = {
  right: 'direction.right', left: 'direction.left', both: 'direction.both',
}

const BRANCH_LABELS: Record<BranchStyle, MsgKey> = {
  straight: 'branch.straight',
  curve: 'branch.curve',
  elbow: 'branch.elbow',
}

const SCHEME_LABELS: Record<ColorScheme, MsgKey> = {
  theme: 'scheme.theme',
  blue: 'scheme.blue',
  green: 'scheme.green',
  warm: 'scheme.warm',
}

export class StyleModal extends Modal {
  private readonly draft: MindmapStyle

  /**
   * @param path 当前笔记路径。为 null 表示没有笔记（此时只能应用全局设置）
   * @param title 笔记名，显示在窗口标题里
   */
  constructor(
    app: App,
    private readonly store: StyleStore,
    private readonly path: string | null,
    private readonly title: string | null,
    private readonly exportImage?: (format: 'png' | 'svg' | 'pdf', background: 'map' | 'white' | 'transparent', scale: number, page: 'fit' | 'landscape' | 'portrait', padding: number, expandAll: boolean) => Promise<void>,
    private readonly exportSize?: () => { width: number; height: number },
  ) {
    super(app)
    this.draft = { ...store.styleFor(path) }
  }

  override onOpen(): void {
    this.modalEl.addClass('om-style-modal')
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h3', {
      text: t('style.title'),
    })

    if (this.title) contentEl.createDiv({ text: this.title, cls: 'setting-item-description' })
    const appearance = contentEl.createDiv()
    const controls = appearance.createDiv()
    const renderControls = () => {
      controls.empty()
      this.buildControls(controls)
      this.buildPalette(controls)
    }
    renderControls()
    const actions = appearance.createDiv({ cls: 'om-style-actions' })
    actions.createEl('button', { text: t('style.restoreDefaults') }).onclick = () => {
      this.update({ ...DEFAULT_STYLE, background: '', edgeColor: '', levelColors: [] })
      renderControls()
    }
    let scope = this.path === null ? 'global' : 'note'
    new Setting(actions).addDropdown(dropdown => {
      if (this.path !== null) dropdown.addOption('note', t('style.scopeNote'))
      if (this.store.hasOverride(this.path)) dropdown.addOption('inherit', t('style.inheritGlobal'))
      dropdown.addOption('global', t('style.scopeGlobal')).setValue(scope)
        .onChange(value => { scope = value })
    }).addButton(button => button.setButtonText(t('style.apply')).setCta().onClick(() => {
      const path = this.targetPath()
      if (scope === 'global') this.store.applyGlobal(path, this.draft)
      else if (path !== null && scope === 'inherit') this.store.clearFile(path)
      else if (path !== null) this.store.applyFile(path, this.draft)
      this.close()
    }))
    if (this.exportImage) {
      const exportPanel = contentEl.createDiv()
      this.buildExport(exportPanel)
      const tabs = contentEl.createDiv({ cls: 'om-appearance-tabs' })
      contentEl.insertBefore(tabs, appearance)
      const styleTab = tabs.createEl('button', { text: t('style.appearance') })
      const exportTab = tabs.createEl('button', { text: t('style.export') })
      const select = (showExport: boolean) => {
        appearance.hidden = showExport
        exportPanel.hidden = !showExport
        styleTab.setAttribute('aria-pressed', String(!showExport))
        exportTab.setAttribute('aria-pressed', String(showExport))
      }
      styleTab.onclick = () => select(false)
      exportTab.onclick = () => select(true)
      select(false)
    }
  }

  override onClose(): void {
    this.store.clearPreview()
    this.contentEl.empty()
  }

  private buildPalette(host: HTMLElement): void {
    const details = host.createEl('details', { cls: 'om-style-section' })
    details.createEl('summary', { text: t('style.customColors') })
    const color = (label: string, value: string, update: (value: string) => void) => {
      new Setting(details).setName(label)
        .addColorPicker(picker => picker.setValue(value || '#808080').onChange(update))
    }
    color(t('style.background'), this.draft.background ?? '', background => this.update({ background }))
    color(t('style.edges'), this.draft.edgeColor ?? '', edgeColor => this.update({ edgeColor }))
    for (let i = 0; i < 6; i++) {
      color(t('style.level', String(i + 1)), this.draft.levelColors?.[i] ?? '', value => {
        const levelColors = Array.from({ length: 6 }, (_, level) => this.draft.levelColors?.[level] ?? '')
        levelColors[i] = value
        this.update({ levelColors, colorByLevel: true })
      })
    }
    new Setting(details).addButton(button => button.setButtonText(t('style.resetColors')).onClick(() => {
      this.update({ background: '', edgeColor: '', levelColors: [] })
      details.remove()
      this.buildPalette(host)
    }))
  }

  private buildExport(host: HTMLElement): void {
    if (!this.exportImage) return
    let background: 'map' | 'white' | 'transparent' = 'map'
    let page: 'fit' | 'landscape' | 'portrait' = 'fit'
    let scale = 2
    let padding = 24
    let expandAll = false
    const dimensions = host.createDiv({ cls: 'setting-item-description' })
    const showSize = () => {
      const size = this.exportSize?.()
      dimensions.textContent = size && !expandAll ? t('style.exportSize', String((size.width + padding * 2) * scale), String((size.height + padding * 2) * scale)) : ''
    }
    showSize()
    new Setting(host).setName(t('style.range')).addDropdown(dropdown => dropdown
      .addOption('visible', t('style.currentBranches')).addOption('all', t('style.expandAll'))
      .onChange(value => { expandAll = value === 'all'; showSize() }))
    new Setting(host).setName(t('style.background')).addDropdown(dropdown => dropdown
      .addOption('map', t('style.mapBackground')).addOption('white', t('style.white'))
      .addOption('transparent', t('style.transparent')).onChange(value => {
        if (value === 'map' || value === 'white' || value === 'transparent') background = value
      }))
    const details = host.createEl('details', { cls: 'om-style-section' })
    details.createEl('summary', { text: t('style.more') })
    new Setting(details).setName(t('style.quality')).addDropdown(dropdown => dropdown
      .addOption('1', t('style.standard')).addOption('2', t('style.high')).setValue('2')
      .onChange(value => { scale = Number(value); showSize() }))
    new Setting(details).setName(t('style.padding')).addDropdown(dropdown => dropdown
      .addOption('12', t('style.compact')).addOption('24', t('style.standard')).addOption('48', t('style.spacious'))
      .setValue('24').onChange(value => { padding = Number(value); showSize() }))
    new Setting(details).setName(t('style.pdfPage')).addDropdown(dropdown => dropdown
      .addOption('fit', t('style.fitPage')).addOption('landscape', t('style.landscape'))
      .addOption('portrait', t('style.portrait')).onChange(value => {
        if (value === 'fit' || value === 'landscape' || value === 'portrait') page = value
      }))
    const actions = host.createDiv({ cls: 'om-export-actions' })
    const buttons = (['png', 'svg', 'pdf'] as const).map(format => {
      const button = actions.createEl('button', { text: t('style.exportAs', format.toUpperCase()) })
      button.onclick = async () => {
        for (const control of buttons) control.disabled = true
        try {
          await this.exportImage?.(format, background, scale, page, padding, expandAll)
        } finally {
          for (const control of buttons) control.disabled = false
        }
      }
      return button
    })
  }

  private buildControls(host: HTMLElement): void {
    new Setting(host).setName(t('tool.layout')).addDropdown((d) => {
      for (const [value, key] of Object.entries(DIRECTION_LABELS)) d.addOption(value, t(key))
      d.setValue(this.draft.direction).onChange((v) => this.update({ direction: v as LayoutDirection }))
    })

    const details = host.createEl('details', { cls: 'om-style-section' })
    details.createEl('summary', { text: t('style.details') })
    new Setting(details)
      .setName(t('style.hGap'))
      .setDesc(t('style.hGapDesc'))
      .addSlider((s) =>
        s
          .setLimits(STYLE_LIMITS.hGap.min, STYLE_LIMITS.hGap.max, STYLE_LIMITS.hGap.step)
          .setValue(this.draft.hGap)
          .onChange((v) => this.update({ hGap: v })),
      )

    new Setting(details)
      .setName(t('style.vGap'))
      .setDesc(t('style.vGapDesc'))
      .addSlider((s) =>
        s
          .setLimits(STYLE_LIMITS.vGap.min, STYLE_LIMITS.vGap.max, STYLE_LIMITS.vGap.step)
          .setValue(this.draft.vGap)
          .onChange((v) => this.update({ vGap: v })),
      )

    new Setting(host).setName(t('style.shape')).addDropdown((d) => {
      for (const [value, key] of Object.entries(SHAPE_LABELS)) d.addOption(value, t(key))
      d.setValue(this.draft.shape).onChange((v) => this.update({ shape: v as NodeShape }))
    })

    new Setting(host).setName(t('style.branch')).addDropdown((d) => {
      for (const [value, key] of Object.entries(BRANCH_LABELS)) d.addOption(value, t(key))
      d.setValue(this.draft.branch).onChange((v) => this.update({ branch: v as BranchStyle }))
    })

    new Setting(host).setName(t('style.scheme')).addDropdown((d) => {
      for (const [value, key] of Object.entries(SCHEME_LABELS)) d.addOption(value, t(key))
      d.setValue(this.draft.scheme).onChange((v) => this.update({ scheme: v as ColorScheme }))
    })

    new Setting(host)
      .setName(t('style.levelColors'))
      .setDesc(t('style.levelColorsDesc'))
      .addToggle((s) =>
        s.setValue(this.draft.colorByLevel).onChange((v) => this.update({ colorByLevel: v })),
      )

    new Setting(details)
      .setName(t('style.fontScale'))
      .setDesc(t('style.fontScaleDesc'))
      .addSlider((s) =>
        s
          .setLimits(
            STYLE_LIMITS.fontScale.min,
            STYLE_LIMITS.fontScale.max,
            STYLE_LIMITS.fontScale.step,
          )
          .setValue(this.draft.fontScale)
          .onChange((v) => this.update({ fontScale: v })),
      )
    host.appendChild(details)
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
    this.store.setPreview(this.targetPath(), { ...this.draft })
  }
}
