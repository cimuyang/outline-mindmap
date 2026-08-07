import { Modal, Notice, Setting } from "obsidian";
import type { App } from "obsidian";
import type OutlineMindmapPlugin from "./main";
import {
	buildNoteStyleOverrides,
	resolveEffectiveMindMapStyle
} from "./style";
import type { MindMapStyle } from "./style";
import { MindMapStyleSettingsForm } from "./styleSettingsForm";

export interface NoteStyleModalCallbacks {
	onPreview?: (style: MindMapStyle) => void;
	onRestore?: () => void;
}

export class NoteMindMapStyleModal extends Modal {
	private styleFields: MindMapStyleSettingsForm | null = null;
	private draftStyle: MindMapStyle;
	private originalStyle: MindMapStyle;
	private shouldRestoreOnClose = true;
	private closing = false;
	private outsideClickHandler: ((event: MouseEvent) => void) | null = null;

	constructor(
		app: App,
		private plugin: OutlineMindmapPlugin,
		private filePath: string,
		private callbacks: NoteStyleModalCallbacks = {}
	) {
		super(app);
		this.draftStyle = plugin.getEffectiveMindMapStyle(filePath);
		this.originalStyle = { ...this.draftStyle };
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		this.modalEl.addClass("outline-mindmap-note-style-modal");
		titleEl.setText(this.plugin.i18n.t("单篇笔记样式"));
		contentEl.empty();

		const actionContainer = contentEl.createDiv({
			cls: "outline-mindmap-note-style-actions"
		});
		new Setting(actionContainer)
			.setName(this.plugin.i18n.t("操作"))
			.addButton((button) =>
				button
					.setButtonText(this.plugin.i18n.t("应用全局设置"))
					.onClick(() => {
						void this.applyGlobal();
					})
			)
			.addButton((button) =>
				button
					.setButtonText(this.plugin.i18n.t("应用单篇笔记设置"))
					.setCta()
					.onClick(() => {
						void this.applySingle();
					})
			)
			.addButton((button) =>
				button
					.setButtonText(this.plugin.i18n.t("取消"))
					.onClick(() => {
						this.close();
					})
			);

		const fieldsContainer = contentEl.createDiv({
			cls: "outline-mindmap-note-style-fields"
		});
		this.styleFields = new MindMapStyleSettingsForm(
			fieldsContainer,
			this.draftStyle,
			(style) => {
				this.draftStyle = style;
				this.preview();
			},
			!this.plugin.isPro(),
			this.plugin.i18n.t.bind(this.plugin.i18n)
		);
		this.styleFields.render();

		this.outsideClickHandler = (event: MouseEvent) => {
			if (event.target instanceof Node && !this.modalEl.contains(event.target)) {
				void this.applySingle();
			}
		};
		this.containerEl.addEventListener(
			"mousedown",
			this.outsideClickHandler
		);
	}

	onClose(): void {
		if (this.outsideClickHandler) {
			this.containerEl.removeEventListener(
				"mousedown",
				this.outsideClickHandler
			);
			this.outsideClickHandler = null;
		}
		if (this.shouldRestoreOnClose) {
			this.callbacks.onRestore?.();
		}
		this.contentEl.empty();
	}

	private async applyGlobal(): Promise<void> {
		if (this.closing) {
			return;
		}
		this.closing = true;
		try {
			await this.plugin.clearNoteMindMapStyle(this.filePath);
		} catch (error) {
			this.closing = false;
			new Notice(this.plugin.i18n.t("应用全局设置失败，请重试"));
			return;
		}
		this.shouldRestoreOnClose = false;
		this.close();
	}

	private async applySingle(): Promise<void> {
		if (this.closing) {
			return;
		}
		this.closing = true;
		const overrides = buildNoteStyleOverrides(
			this.plugin.mindMapStyle,
			this.styleFields?.getStyle() ?? this.draftStyle
		);
		try {
			await this.plugin.saveNoteMindMapStyle(this.filePath, overrides);
		} catch (error) {
			this.closing = false;
			new Notice(this.plugin.i18n.t("保存单篇笔记样式失败，请重试"));
			return;
		}
		this.shouldRestoreOnClose = false;
		this.close();
	}

	private preview(): void {
		const style = this.styleFields?.getStyle() ?? this.draftStyle;
		this.callbacks.onPreview?.(resolveEffectiveMindMapStyle(style));
	}
}
