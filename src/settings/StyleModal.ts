import { Modal, Setting, type ToggleComponent, type App } from 'obsidian'
import { readFont, headingFont } from '../view/measure'
import { label } from '../view/strings'
import { t, type MsgKey } from '../i18n'
import type { BranchStyle, LayoutDirection } from '../layout/types'
import {
  DEFAULT_STYLE, DEFAULT_HEADING_SIZES,
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
  text: 'shape.text',
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
  private colorToggle?: ToggleComponent
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
    this.store.setPreview(this.path, { ...this.draft })
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
      const row = new Setting(details).setName(label)
      const hint = row.controlEl.createSpan({ cls: 'om-color-source', text: t('style.themeColor') })
      hint.hidden = !!value
      row.addColorPicker(picker => {
        const input = row.controlEl.querySelector('input[type=color]')
        input?.setAttribute('aria-label', label)
        input?.toggleClass('om-color-inherited', !value)
        if (value) picker.setValue(value)
        picker.onChange(next => {
          hint.hidden = true
          input?.removeClass('om-color-inherited')
          update(next)
        })
      })
    }
    color(t('style.background'), this.draft.background ?? '', background => this.update({ background }))
    color(t('style.edges'), this.draft.edgeColor ?? '', edgeColor => this.update({ edgeColor }))
    for (let i = 0; i < 6; i++) {
      color(t('style.level', String(i + 1)), this.draft.levelColors?.[i] ?? '', value => {
        const levelColors = Array.from({ length: 6 }, (_, level) => this.draft.levelColors?.[level] ?? '')
        levelColors[i] = value
        this.update({ levelColors, colorByLevel: true })
        this.colorToggle?.setValue(true)
      })
    }
    new Setting(details).addButton(button => button.setButtonText(t('style.resetColors')).onClick(() => {
      this.update({ background: '', edgeColor: '', levelColors: [] })
      details.remove()
      this.buildPalette(host)
      const palette = host.lastElementChild as HTMLDetailsElement | null
      if (palette) palette.open = true
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
      .addToggle(s => {
        this.colorToggle = s
        s.setValue(this.draft.colorByLevel).onChange(v => this.update({ colorByLevel: v }))
      })
    const typography = host.createEl('details', { cls: 'om-style-section om-heading-controls' })
    typography.createEl('summary', { text: label('自定义标题字号', 'Customize heading sizes') })
    typography.hidden = !this.draft.sizeByHeading
    new Setting(host).setName(label('按标题级别调整字号', 'Size headings by level'))
      .setDesc(label('突出主标题，可在下方调整 H1–H6。', 'Emphasize headings and fine-tune H1–H6 below.'))
      .addToggle(toggle => toggle.setValue(this.draft.sizeByHeading).onChange(value => {
        typography.hidden = !value
        this.update({ sizeByHeading: value })
      }))
    const refreshSizes = this.buildHeadingSizes(typography)

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
          .onChange(v => { this.update({ fontScale: v }); refreshSizes() }),
      )
    host.appendChild(details)
    host.appendChild(typography)
  }

  private buildHeadingSizes(panel: HTMLElement): () => void {
    const refresh: Array<(base: ReturnType<typeof readFont>) => void> = []
    const sync = () => {
      const base = readFont(this.modalEl, this.draft.fontScale)
      refresh.forEach(update => update(base))
    }
    DEFAULT_HEADING_SIZES.forEach((_, i) => {
      const row = new Setting(panel).setName('H' + (i + 1))
      row.addSlider(slider => {
        slider.setLimits(75, 200, 0.25)
        slider.sliderEl.setAttribute('aria-label', 'H' + (i + 1))
        const value = row.controlEl.createEl('output', { cls: 'om-size-value' })
        refresh.push(base => {
          const percent = this.draft.headingSizes[i]!
          slider.setValue(percent)
          value.textContent = percent + '% · ' + headingFont(base, percent).size + ' px'
          slider.sliderEl.setAttribute('aria-valuetext', value.textContent)
        })
        slider.onChange(percent => {
          const headingSizes = [...this.draft.headingSizes]
          headingSizes[i] = percent
          this.update({ headingSizes })
          sync()
        })
      })
    })
    new Setting(panel).addButton(button => button.setButtonText(label('恢复默认字号', 'Reset heading sizes')).onClick(() => {
      this.update({ headingSizes: DEFAULT_HEADING_SIZES })
      sync()
    }))
    sync()
    return sync
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
