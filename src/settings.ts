import {
	ButtonComponent,
	DropdownComponent,
	Notice,
	PluginSettingTab,
	Setting,
	SliderComponent,
	TextComponent,
	ToggleComponent
} from "obsidian";
import type { App } from "obsidian";
import type OutlineMindmapPlugin from "./main";
import {
	DEFAULT_MIND_MAP_STYLE,
	MIND_MAP_STYLE_TEMPLATES,
	getMindMapStyleTemplate,
	resolveEffectiveMindMapStyle
} from "./style";
import type { MindMapStyle } from "./style";
import { MindMapStyleSettingsForm } from "./styleSettingsForm";
import { formatMachineCode } from "./license";
import type { LicenseVerifyResult } from "./license";
import type { LanguageSetting } from "./i18n";

export class OutlineMindmapSettingTab extends PluginSettingTab {
	private styleFields: MindMapStyleSettingsForm | null = null;
	private draftStyle: MindMapStyle = { ...DEFAULT_MIND_MAP_STYLE };
	private clickToJumpToggle: ToggleComponent | null = null;
	private lockCurrentNoteToggle: ToggleComponent | null = null;
	private strictHeadingSpacingToggle: ToggleComponent | null = null;
	private elegantAnimationToggle: ToggleComponent | null = null;
	private animationSpeedSetting: Setting | null = null;
	private animationSpeedSlider: SliderComponent | null = null;
	private elegantAnimationSpringToggle: ToggleComponent | null = null;
	private styleTemplateDropdown: DropdownComponent | null = null;
	private languageDropdown: DropdownComponent | null = null;
	private activationSectionEl: HTMLElement | null = null;
	private activationCodeInput: TextComponent | null = null;
	private activationErrorEl: HTMLElement | null = null;

	constructor(app: App, private plugin: OutlineMindmapPlugin) {
		super(app, plugin);
	}

	getSettingDefinitions() {
		return [];
	}

	private t(
		text: string,
		vars?: Record<string, string | number>,
		enOverride?: string
	): string {
		return this.plugin.i18n.t(text, vars, enOverride);
	}

	display(): void {
		this.containerEl.empty();
		this.draftStyle = this.plugin.isPro()
			? { ...this.plugin.mindMapStyle }
			: { ...DEFAULT_MIND_MAP_STYLE };
		this.clickToJumpToggle = null;
		this.lockCurrentNoteToggle = null;
		this.strictHeadingSpacingToggle = null;
		this.elegantAnimationToggle = null;
		this.animationSpeedSetting = null;
		this.animationSpeedSlider = null;
		this.elegantAnimationSpringToggle = null;
		this.styleTemplateDropdown = null;
		this.languageDropdown = null;
		this.activationSectionEl = null;
		this.activationCodeInput = null;
		this.activationErrorEl = null;

		const regularSection = this.containerEl.createDiv();
		const activationSection = this.containerEl.createDiv();
		const animationSection = this.containerEl.createDiv();
		const styleSection = this.containerEl.createDiv();
		this.renderRegularSection(regularSection);
		this.renderActivationSection(activationSection);
		this.renderAnimationSection(animationSection);
		this.renderStyleSection(styleSection);
	}

	private renderRegularSection(container: HTMLElement): void {
		new Setting(container).setName(this.t("常规")).setHeading();

		new Setting(container)
			.setName(this.t("单击即跳转"))
			.setDesc(
				this.t(
					"建议保持开启；开启后单击导图节点会定位到 Markdown 对应行，双击节点直接编辑。"
				)
			)
			.addToggle((toggle) =>
				(this.clickToJumpToggle = toggle)
					.setValue(this.plugin.clickToJump)
					.onChange(async (value) => {
						await this.plugin.saveClickToJump(value);
						this.plugin.syncClickToJumpToViews();
					})
			);

		new Setting(container)
			.setName(this.t("锁定当前笔记"))
			.setDesc(
				this.t(
					"建议保持关闭；开启后新打开或重新打开导图视图会固定到当前笔记，不影响已打开视图。"
				)
			)
			.addToggle((toggle) =>
				(this.lockCurrentNoteToggle = toggle)
					.setValue(this.plugin.lockCurrentNote)
					.onChange((value) => {
						void this.plugin.saveLockCurrentNote(value);
					})
			);

		new Setting(container)
			.setName(this.t("严格空行"))
			.setDesc(
				this.t(
					"建议保持开启；开启时新建/移动标题会预留正文空行，关闭时只补一个常规空行。"
				)
			)
			.addToggle((toggle) =>
				(this.strictHeadingSpacingToggle = toggle)
					.setValue(this.plugin.strictHeadingSpacing)
					.onChange(async (value) => {
						await this.plugin.saveStrictHeadingSpacing(value);
					})
			);

		new Setting(container)
			.setName(this.t("界面语言"))
			.setDesc(
				this.t("默认跟随 Obsidian 语言；可手动固定为中文或 English。")
			)
			.addDropdown((dropdown) => {
				this.languageDropdown = dropdown;
				dropdown
					.addOption("auto", this.t("跟随 Obsidian"))
					.addOption("zh", this.t("中文"))
					.addOption("en", "English")
					.setValue(this.plugin.languageSetting)
					.onChange(async (value) => {
						await this.plugin.saveLanguage(
							value as LanguageSetting
						);
						this.display();
					});
			});

		this.addSectionResetButton(container, this.t("常规"), () => {
			void this.restoreRegularSectionDefaults();
		});
	}

	private renderAnimationSection(container: HTMLElement): void {
		const pro = this.plugin.isPro();
		new Setting(container)
			.setName(pro ? this.t("优雅动画") : this.t("优雅动画（Pro）"))
			.setHeading();
		if (!pro) {
			this.renderProLockBanner(container, this.t("优雅动画"));
		}

		new Setting(container)
			.setName(this.t("动画开关"))
			.setDesc(
				this.t(
					"建议开启；展开或收起节点时使用更平滑的位移动画，并自动调整视野。节点数量较多时，建议关闭以保证大图流畅。"
				)
			)
		.addToggle((toggle) =>
			(this.elegantAnimationToggle = toggle)
				.setValue(this.plugin.getEffectiveElegantAnimation())
				.setDisabled(!pro)
				.onChange(async (value) => {
						await this.plugin.saveElegantAnimation(value);
						this.plugin.syncElegantAnimationToViews();
					})
			);

		const speedSetting = new Setting(container)
			.setName(this.t("动画速度"))
			.setDesc(
				this.t("当前 {speed}x；建议按画面流畅度调整，节点较多时适当降低。", {
					speed: this.plugin.elegantAnimationSpeed.toFixed(1)
				})
			);
		this.animationSpeedSetting = speedSetting;
		speedSetting.addSlider((slider) => {
			this.animationSpeedSlider = slider;
			return slider
				.setLimits(0.5, 2, 0.1)
				.setValue(pro ? this.plugin.elegantAnimationSpeed : 1)
				.setDisabled(!pro)
				.onChange(async (value) => {
					await this.plugin.saveElegantAnimationSpeed(value);
					speedSetting.setDesc(
						this.t(
							"当前 {speed}x；建议按画面流畅度调整，节点较多时适当降低。",
							{ speed: value.toFixed(1) }
						)
					);
				});
		});

		new Setting(container)
			.setName(this.t("微弹性收尾"))
			.setDesc(
				this.t("建议保持关闭以获得平滑稳定的收尾；需要轻微回弹时再开启。")
			)
			.addToggle((toggle) =>
				(this.elegantAnimationSpringToggle = toggle)
					.setValue(
						pro ? this.plugin.elegantAnimationSpring : false
					)
					.setDisabled(!pro)
					.onChange(async (value) => {
						await this.plugin.saveElegantAnimationSpring(value);
					})
			);

		this.addSectionResetButton(
			container,
			this.t("优雅动画"),
			() => {
				void this.restoreAnimationSectionDefaults();
			},
			!pro
		);
	}

	private renderStyleSection(container: HTMLElement): void {
		const pro = this.plugin.isPro();
		new Setting(container)
			.setName(
				pro ? this.t("思维导图样式") : this.t("思维导图样式（Pro）")
			)
			.setHeading();
		if (!pro) {
			this.renderProLockBanner(container, this.t("思维导图样式"));
		}

		new Setting(container)
			.setName(this.t("样式模板"))
			.setDesc(
				this.t(
					"选择模板会填入下方自定义项；点击“保存全局样式”后才会应用到导图。"
				)
			)
			.addDropdown((dropdown) => {
				this.styleTemplateDropdown = dropdown;
				dropdown.addOption("custom", this.t("自定义"));
				for (const [id, template] of Object.entries(
					MIND_MAP_STYLE_TEMPLATES
				)) {
					dropdown.addOption(id, this.t(template.name));
				}
			dropdown
				.setValue(this.getCurrentTemplateId())
				.setDisabled(!pro)
				.onChange((value) => {
						if (value === "custom") {
							return;
						}
						this.draftStyle = getMindMapStyleTemplate(value);
						this.styleFields?.setStyle(this.draftStyle);
					});
			});

		const fieldsContainer = container.createDiv();
		this.styleFields = new MindMapStyleSettingsForm(
			fieldsContainer,
			this.draftStyle,
			(style) => {
				this.draftStyle = style;
			},
			!pro,
			(text, vars) => this.t(text, vars)
		);
		this.styleFields.render();

		new Setting(container)
			.setName(this.t("保存全局样式"))
			.setDesc(
				this.t(
					"保存后应用到所有已打开的导图视图；样式只存插件数据，不修改 Markdown。"
				)
			)
			.addButton((button) =>
				button
					.setButtonText(this.t("保存全局样式"))
					.setCta()
					.setDisabled(!pro)
					.onClick(() => {
						void this.saveGlobalStyle();
					})
			);

		this.addSectionResetButton(
			container,
			this.t("思维导图样式"),
			() => {
				void this.restoreStyleSectionDefaults();
			},
			!pro
		);
	}

	private renderActivationSection(container: HTMLElement): void {
		this.activationSectionEl = container;
		new Setting(container)
			.setName(this.t("激活", undefined, "Activation"))
			.setHeading();
		const status = this.plugin.getLicenseStatus();
		new Setting(container)
			.setName(this.t("激活状态"))
			.setDesc(
				status.activated
					? this.t("已激活 Pro（终身版）；到期 {expires}，订单 {order}。", {
							expires: status.payload?.expiresAt ?? "",
							order: status.payload?.order ?? ""
					  })
					: this.t(
							"未激活；激活后可解锁“优雅动画”与“思维导图样式”。"
					  )
			);
		const machineCode = status.machineCode;
		const grouped = machineCode
			? formatMachineCode(machineCode)
			: this.t("（计算中…）");
		new Setting(container)
			.setName(this.t("机器码"))
			.setDesc(
				this.t("请将机器码连同订单截图发送给作者，以换取激活码。")
			)
			.addText((text) =>
				text
					.setPlaceholder(this.t("64 位十六进制机器码"))
					.setValue(grouped)
					.setDisabled(true)
			)
			.addButton((button) =>
				button
					.setButtonText(this.t("复制"))
					.onClick(() => {
						void this.copyMachineCode(machineCode);
					})
			);
		new Setting(container)
			.setName(this.t("激活码"))
			.setDesc(this.t("粘贴 PRO- 开头的激活码并点击“激活”。"))
			.addText(
				(text) =>
					(this.activationCodeInput = text).setPlaceholder(
						"PRO-xxxx.xxxx.xxxx..."
					)
			)
			.addButton((button) =>
				button
					.setButtonText(this.t("激活"))
					.setCta()
					.onClick(() => {
						void this.submitActivation();
					})
			);
		this.activationErrorEl = container.createDiv({
			cls: "outline-mindmap-license-error"
		});
		this.activationErrorEl.style.display = "none";
	}

	private async copyMachineCode(machineCode: string): Promise<void> {
		if (!machineCode) {
			new Notice(this.t("机器码尚未生成，请稍后重试。"));
			return;
		}
		try {
			await navigator.clipboard.writeText(machineCode);
			new Notice(this.t("机器码已复制"));
		} catch {
			new Notice(this.t("复制失败，请手动选择复制"));
		}
	}

	private async submitActivation(): Promise<void> {
		const code = this.activationCodeInput?.getValue().trim() ?? "";
		if (!code) {
			this.showActivationError(this.t("请输入激活码。"));
			return;
		}
		const result: LicenseVerifyResult =
			await this.plugin.activateLicense(code);
		if (result.ok) {
			this.hideActivationError();
			new Notice(this.t("激活成功，Pro 功能已解锁"));
			const restoreScroll = this.preserveSettingsScroll();
			this.display();
			restoreScroll();
			this.plugin.syncElegantAnimationToViews();
			this.plugin.syncMindMapStyleToViews();
			return;
		}
		this.showActivationError(this.activationErrorMessage(result.reason));
	}

	private showActivationError(message: string): void {
		if (!this.activationErrorEl) {
			return;
		}
		this.activationErrorEl.setText(message);
		this.activationErrorEl.style.display = "block";
	}

	private hideActivationError(): void {
		if (this.activationErrorEl) {
			this.activationErrorEl.style.display = "none";
		}
	}

	private activationErrorMessage(reason: string): string {
		switch (reason) {
			case "format":
				return this.t("激活码格式不正确，请检查后重试。");
			case "signature":
				return this.t("激活码无效或已被篡改，请联系作者。");
			case "unsupported":
				return this.t("激活码档位或版本不受支持。");
			case "machine-mismatch":
				return this.t(
					"激活码与当前设备不匹配（可能设备码已变化），请确认后重试或联系作者换绑。"
				);
			case "expired":
				return this.t("激活码已过期。");
			default:
				return this.t("激活失败，请重试。");
		}
	}

	private scrollToActivation(): void {
		this.activationSectionEl?.scrollIntoView({
			behavior: "smooth",
			block: "start"
		});
	}

	private renderProLockBanner(
		container: HTMLElement,
		sectionName: string
	): void {
		new Setting(container)
			.setName(this.t("Pro 专属"))
			.setDesc(
				this.t("“{name}”为 Pro 专属功能，激活后可解锁全部选项。", {
					name: sectionName
				})
			)
			.addButton((button) =>
				button
					.setButtonText(this.t("前往激活"))
					.onClick(() => this.scrollToActivation())
			);
	}

	private addSectionResetButton(
		container: HTMLElement,
		name: string,
		onClick: () => void,
		disabled = false
	): void {
		new Setting(container)
			.setName(this.t("恢复本分区默认"))
			.setDesc(
				disabled
					? this.t("“{name}”为 Pro 专属，激活后可用。", { name })
					: this.t("将“{name}”分区恢复为建议值并保存。", { name })
			)
			.addButton((button) =>
				button
					.setButtonText(this.t("恢复"))
					.setCta()
					.setDisabled(disabled)
					.onClick(onClick)
			);
	}

	private async restoreRegularSectionDefaults(): Promise<void> {
		const restoreScroll = this.preserveSettingsScroll();
		await this.plugin.saveClickToJump(true);
		await this.plugin.saveLockCurrentNote(false);
		await this.plugin.saveStrictHeadingSpacing(true);
		this.clickToJumpToggle?.setValue(true);
		this.lockCurrentNoteToggle?.setValue(false);
		this.strictHeadingSpacingToggle?.setValue(true);
		this.plugin.syncClickToJumpToViews();
		restoreScroll();
	}

	private async restoreAnimationSectionDefaults(): Promise<void> {
		const restoreScroll = this.preserveSettingsScroll();
		await this.plugin.saveElegantAnimation(false);
		await this.plugin.saveElegantAnimationSpeed(1);
		await this.plugin.saveElegantAnimationSpring(false);
		this.elegantAnimationToggle?.setValue(false);
		this.animationSpeedSlider?.setValue(1);
		this.animationSpeedSetting?.setDesc(
			this.t("当前 {speed}x；建议按画面流畅度调整，节点较多时适当降低。", {
				speed: "1.0"
			})
		);
		this.elegantAnimationSpringToggle?.setValue(false);
		this.plugin.syncElegantAnimationToViews();
		restoreScroll();
	}

	private async restoreStyleSectionDefaults(): Promise<void> {
		const restoreScroll = this.preserveSettingsScroll();
		this.draftStyle = { ...DEFAULT_MIND_MAP_STYLE };
		this.styleFields?.setStyle(this.draftStyle);
		this.styleTemplateDropdown?.setValue(this.getCurrentTemplateId());
		await this.saveGlobalStyle();
		restoreScroll();
	}

	private preserveSettingsScroll(): () => void {
		const container =
			this.containerEl.closest<HTMLElement>(
				".vertical-tab-content-container"
			);
		const scrollTop = container?.scrollTop ?? 0;
		const scrollLeft = container?.scrollLeft ?? 0;
		return () => {
			window.requestAnimationFrame(() => {
				if (!container) {
					return;
				}
				container.scrollTop = scrollTop;
				container.scrollLeft = scrollLeft;
			});
		};
	}

	private async saveGlobalStyle(): Promise<void> {
		const style = resolveEffectiveMindMapStyle(
			this.styleFields?.getStyle() ?? this.draftStyle
		);
		this.draftStyle = style;
		await this.plugin.saveMindMapStyle(style);
		this.plugin.syncMindMapStyleToViews();
		this.styleFields?.setStyle(style);
	}

	private getCurrentTemplateId(): string {
		for (const [id, template] of Object.entries(
			MIND_MAP_STYLE_TEMPLATES
		)) {
			if (
				JSON.stringify(this.draftStyle) ===
				JSON.stringify(getMindMapStyleTemplate(id))
			) {
				return id;
			}
		}
		return "custom";
	}
}
