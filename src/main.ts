import { MarkdownView, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import type { Editor, MarkdownFileInfo, TFile } from "obsidian";
import {
	OutlineMindmapView,
	VIEW_TYPE_OUTLINE_MINDMAP
} from "./view";
import type { MindMapViewState, PluginData } from "./viewState";
import {
	addMapNodeRecord,
	filterMapNodeRegistryByFilePaths,
	findMapNodeRecord,
	removeMapNodeSubtreeByKey
} from "./mapNodeRegistry";
import type { MapNodeRegistry } from "./mapNodeRegistry";
import { findMapNodeCandidateForLine } from "./parser";
import {
	removeMapNodeRegistryForFile,
	renameMapNodeRegistryFile,
	sanitizeMapNodeRegistry
} from "./mapNodeRegistry";
import {
	getViewState,
	removeViewStatesForFile,
	removeViewState,
	renameViewStatesForFile,
	renameViewState,
	sanitizeViewStates,
	setViewState
} from "./viewState";
import { findMindMapLeaf } from "./viewPlacement";
import type { ViewPlacement } from "./viewPlacement";
import { normalizePluginSettings } from "./pluginSettings";
import {
	LicenseManager,
	resolveElegantAnimationEnabled,
	resolveMindMapStyleForPro
} from "./license";
import { I18n, resolveUILanguage } from "./i18n";
import type { LanguageSetting } from "./i18n";
import type { LicensePayload, LicenseVerifyResult } from "./license";
import { OutlineMindmapSettingTab } from "./settings";
import { NoteSyncCoordinator } from "./noteSyncCoordinator";
import {
	clearNoteStyleOverride,
	DEFAULT_MIND_MAP_STYLE,
	getEffectiveMindMapStyle,
	normalizeMindMapStyle,
	renameNoteStyleOverride,
	sanitizeNoteStyles,
	setNoteStyleOverride
} from "./style";
import type { MindMapNoteStyles, MindMapStyle } from "./style";

export default class OutlineMindmapPlugin extends Plugin {
	clickToJump = true;
	lockCurrentNote = false;
	elegantAnimation = false;
	elegantAnimationSpeed = 1;
	elegantAnimationSpring = false;
	strictHeadingSpacing = true;
	mindMapStyle: MindMapStyle = DEFAULT_MIND_MAP_STYLE;
	private noteStyles: MindMapNoteStyles = {};
	private viewStates: Record<string, MindMapViewState> = {};
	private mapNodeRegistry: MapNodeRegistry = {};
	private noteSyncCoordinators = new Map<string, NoteSyncCoordinator>();
	license = new LicenseManager();
	i18n = new I18n();
	languageSetting: LanguageSetting = "auto";

	async onload() {
		const data = (await this.loadData()) as Partial<PluginData> | null;
		const settings = normalizePluginSettings(data);
		this.clickToJump = settings.clickToJump;
		this.lockCurrentNote = settings.lockCurrentNote;
		this.elegantAnimation = settings.elegantAnimation;
		this.elegantAnimationSpeed = settings.elegantAnimationSpeed;
		this.elegantAnimationSpring = settings.elegantAnimationSpring;
		this.strictHeadingSpacing = settings.strictHeadingSpacing;
		this.mindMapStyle = settings.mindMapStyle;
		this.languageSetting = settings.language;
		this.applyLanguage();
		await this.license.init(data?.licenseCode);
		this.noteStyles = sanitizeNoteStyles(data?.noteStyles);
		this.viewStates = sanitizeViewStates(data?.viewStates);
		const rawRegistry = sanitizeMapNodeRegistry(data?.mapNodeRegistry);
		const filteredRegistry = filterMapNodeRegistryByFilePaths(
			rawRegistry,
			this.app.vault.getMarkdownFiles().map((file) => file.path)
		);
		this.mapNodeRegistry = filteredRegistry;
		if (JSON.stringify(rawRegistry) !== JSON.stringify(filteredRegistry)) {
			await this.savePluginData();
		}

		this.registerView(
			VIEW_TYPE_OUTLINE_MINDMAP,
			(leaf: WorkspaceLeaf) => new OutlineMindmapView(leaf, this)
		);

		this.addCommand({
			id: "open-outline-mindmap",
			name: this.i18n.t("打开大纲思维导图"),
			callback: () => {
				void this.activateView();
			}
		});
		this.addCommand({
			id: "open-outline-mindmap-right",
			name: this.i18n.t("在右侧边栏打开大纲思维导图"),
			callback: () => {
				void this.activateView("right");
			}
		});
		this.addCommand({
			id: "convert-list-to-map-node",
			name: this.i18n.t("将当前 H7+ 列表转为导图节点"),
			editorCallback: (editor, view) => {
				void this.convertCurrentListToMapNode(editor, view);
			}
		});
		this.addCommand({
			id: "convert-map-node-to-body",
			name: this.i18n.t("将当前导图节点转回普通正文"),
			editorCallback: (editor, view) => {
				void this.convertCurrentMapNodeToBody(editor, view);
			}
		});
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				const path = (file as { path?: string } | null)?.path;
				if (path) {
					this.removeNoteSyncCoordinator(path);
					void this.removeMapNodeRegistry(path);
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				const path = (file as { path?: string } | null)?.path;
				if (path && typeof oldPath === "string") {
					this.removeNoteSyncCoordinator(oldPath);
					void this.renameMapNodeRegistry(oldPath, path);
				}
			})
		);
		this.addSettingTab(new OutlineMindmapSettingTab(this.app, this));
	}

	onunload(): void {
		for (const coordinator of this.noteSyncCoordinators.values()) {
			coordinator.detach();
		}
		this.noteSyncCoordinators.clear();
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_OUTLINE_MINDMAP);
	}

	async activateView(placement: ViewPlacement = "tab") {
		const { workspace } = this.app;
		let leaf = findMindMapLeaf(
			workspace.getLeavesOfType(VIEW_TYPE_OUTLINE_MINDMAP),
			placement,
			workspace.rightSplit
		);
		if (!leaf) {
			if (placement === "right") {
				leaf = workspace.getRightLeaf(false);
			}
			if (!leaf) {
				leaf = workspace.getLeaf("tab");
			}
			await leaf.setViewState({
				type: VIEW_TYPE_OUTLINE_MINDMAP,
				active: true
			});
		}
		await workspace.revealLeaf(leaf);
		if (leaf.view instanceof OutlineMindmapView) {
			leaf.view.refreshNativeChrome();
		}
	}

	async saveClickToJump(value: boolean): Promise<void> {
		this.clickToJump = value;
		await this.savePluginData();
	}

	async saveLockCurrentNote(value: boolean): Promise<void> {
		this.lockCurrentNote = value;
		await this.savePluginData();
	}

	async saveElegantAnimation(value: boolean): Promise<void> {
		if (!this.isPro()) {
			return;
		}
		this.elegantAnimation = value;
		await this.savePluginData();
	}

	async saveElegantAnimationSpeed(value: number): Promise<void> {
		if (!this.isPro()) {
			return;
		}
		this.elegantAnimationSpeed = Math.min(
			2,
			Math.max(0.5, value)
		);
		await this.savePluginData();
		this.syncElegantAnimationToViews();
	}

	async saveElegantAnimationSpring(value: boolean): Promise<void> {
		if (!this.isPro()) {
			return;
		}
		this.elegantAnimationSpring = value;
		await this.savePluginData();
		this.syncElegantAnimationToViews();
	}

	async saveStrictHeadingSpacing(value: boolean): Promise<void> {
		this.strictHeadingSpacing = value;
		await this.savePluginData();
	}

	async saveLanguage(value: LanguageSetting): Promise<void> {
		this.languageSetting = value;
		this.applyLanguage();
		await this.savePluginData();
	}

	applyLanguage(): void {
		this.i18n.setLanguage(resolveUILanguage(this.languageSetting));
	}

	async saveMindMapStyle(style: MindMapStyle): Promise<void> {
		if (!this.isPro()) {
			return;
		}
		this.mindMapStyle = normalizeMindMapStyle(style);
		await this.savePluginData();
	}

	syncClickToJumpToViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			VIEW_TYPE_OUTLINE_MINDMAP
		)) {
			if (leaf.view instanceof OutlineMindmapView) {
				leaf.view.applyPluginClickToJump();
			}
		}
	}

	isPro(): boolean {
		return this.license.isPro();
	}

	getLicenseStatus(): {
		activated: boolean;
		machineCode: string;
		payload: LicensePayload | null;
	} {
		return {
			activated: this.license.isPro(),
			machineCode: this.license.machineCode,
			payload: this.license.payload
		};
	}

	async activateLicense(code: string): Promise<LicenseVerifyResult> {
		const result = await this.license.activate(code);
		if (result.ok) {
			await this.savePluginData();
		}
		return result;
	}

	syncElegantAnimationToViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			VIEW_TYPE_OUTLINE_MINDMAP
		)) {
			if (leaf.view instanceof OutlineMindmapView) {
				leaf.view.applyPluginElegantAnimation();
			}
		}
	}

	syncMindMapStyleToViews(filePath?: string): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			VIEW_TYPE_OUTLINE_MINDMAP
		)) {
			if (leaf.view instanceof OutlineMindmapView) {
				if (
					filePath &&
					leaf.view.getCurrentFilePath() !== filePath
				) {
					continue;
				}
				leaf.view.applyPluginMindMapStyle();
			}
		}
	}

	getEffectiveMindMapStyle(filePath: string): MindMapStyle {
		return resolveMindMapStyleForPro(
			this.isPro(),
			getEffectiveMindMapStyle(
				this.mindMapStyle,
				this.noteStyles[filePath]
			),
			DEFAULT_MIND_MAP_STYLE
		);
	}

	getEffectiveElegantAnimation(): boolean {
		return resolveElegantAnimationEnabled(
			this.isPro(),
			this.elegantAnimation
		);
	}

	getNoteStyleOverride(
		filePath: string
	): Partial<MindMapStyle> | undefined {
		return this.noteStyles[filePath];
	}

	async saveNoteMindMapStyle(
		filePath: string,
		override: Partial<MindMapStyle>
	): Promise<void> {
		if (!this.isPro()) {
			return;
		}
		this.noteStyles = setNoteStyleOverride(
			this.noteStyles,
			filePath,
			override
		);
		await this.savePluginData();
		this.syncMindMapStyleToViews(filePath);
	}

	async clearNoteMindMapStyle(filePath: string): Promise<void> {
		if (!this.isPro()) {
			return;
		}
		this.noteStyles = clearNoteStyleOverride(this.noteStyles, filePath);
		await this.savePluginData();
		this.syncMindMapStyleToViews(filePath);
	}

	async removeNoteMindMapStyle(filePath: string): Promise<void> {
		this.noteStyles = clearNoteStyleOverride(this.noteStyles, filePath);
		await this.savePluginData();
	}

	async renameNoteMindMapStyle(
		oldPath: string,
		newPath: string
	): Promise<void> {
		this.noteStyles = renameNoteStyleOverride(
			this.noteStyles,
			oldPath,
			newPath
		);
		await this.savePluginData();
	}

	getViewState(filePath: string): MindMapViewState | null {
		return getViewState(this.viewStates, filePath);
	}

	async saveViewState(
		filePath: string,
		state: MindMapViewState
	): Promise<void> {
		this.viewStates = setViewState(this.viewStates, filePath, state);
		await this.savePluginData();
	}

	async removeViewState(filePath: string): Promise<void> {
		this.viewStates = removeViewState(this.viewStates, filePath);
		await this.savePluginData();
	}

	async removeViewStatesForFile(filePath: string): Promise<void> {
		this.viewStates = removeViewStatesForFile(this.viewStates, filePath);
		await this.savePluginData();
	}

	async renameViewState(
		oldPath: string,
		newPath: string
	): Promise<void> {
		this.viewStates = renameViewState(this.viewStates, oldPath, newPath);
		await this.savePluginData();
	}

	async renameViewStatesForFile(
		oldPath: string,
		newPath: string
	): Promise<void> {
		this.viewStates = renameViewStatesForFile(
			this.viewStates,
			oldPath,
			newPath
		);
		await this.savePluginData();
	}

	getMapNodeRegistry(): MapNodeRegistry {
		return this.mapNodeRegistry;
	}

	getNoteSyncCoordinator(file: TFile): NoteSyncCoordinator {
		const existing = this.noteSyncCoordinators.get(file.path);
		if (existing) {
			return existing;
		}
		const coordinator = new NoteSyncCoordinator(this.app, file);
		this.noteSyncCoordinators.set(file.path, coordinator);
		return coordinator;
	}

	releaseNoteSyncCoordinator(filePath: string): void {
		const coordinator = this.noteSyncCoordinators.get(filePath);
		if (!coordinator || coordinator.hasSubscribers) {
			return;
		}
		coordinator.detach();
		this.noteSyncCoordinators.delete(filePath);
	}

	removeNoteSyncCoordinator(filePath: string): void {
		const coordinator = this.noteSyncCoordinators.get(filePath);
		if (!coordinator) {
			return;
		}
		coordinator.detach();
		this.noteSyncCoordinators.delete(filePath);
	}

	async saveMapNodeRegistry(registry: MapNodeRegistry): Promise<void> {
		this.mapNodeRegistry = sanitizeMapNodeRegistry(registry);
		await this.savePluginData();
	}

	async removeMapNodeRegistry(filePath: string): Promise<void> {
		this.mapNodeRegistry = removeMapNodeRegistryForFile(
			this.mapNodeRegistry,
			filePath
		);
		await this.savePluginData();
	}

	async renameMapNodeRegistry(
		oldPath: string,
		newPath: string
	): Promise<void> {
		this.mapNodeRegistry = renameMapNodeRegistryFile(
			this.mapNodeRegistry,
			oldPath,
			newPath
		);
		await this.savePluginData();
	}

	private async convertCurrentListToMapNode(
		editor: Editor,
		view: MarkdownView | MarkdownFileInfo
	): Promise<void> {
	const file = view.file;
	if (!file || file.extension !== "md") {
		new Notice(this.i18n.t("请先打开一篇 Markdown 笔记"));
		return;
	}
		const lineIndex = editor.getCursor().line;
		const candidate = findMapNodeCandidateForLine(
			editor.getValue(),
			lineIndex,
			file.path
		);
	if (!candidate) {
		new Notice(this.i18n.t("当前行不是 H6 标题下的 H7+ 列表"));
		return;
	}
		if (
			findMapNodeRecord(
				this.mapNodeRegistry,
				file.path,
				candidate.parentKey,
				candidate.text,
				candidate.occurrence
			)
	) {
		new Notice(this.i18n.t("当前列表已是导图节点"));
		return;
	}
		const added = addMapNodeRecord(this.mapNodeRegistry, file.path, {
			parentKey: candidate.parentKey,
			text: candidate.text,
			occurrence: candidate.occurrence
		});
	this.mapNodeRegistry = added.registry;
	await this.savePluginData();
	this.syncMapNodeRegistryToViews(file.path);
	new Notice(this.i18n.t("已转为导图节点"));
}

	private async convertCurrentMapNodeToBody(
		editor: Editor,
		view: MarkdownView | MarkdownFileInfo
	): Promise<void> {
	const file = view.file;
	if (!file || file.extension !== "md") {
		new Notice(this.i18n.t("请先打开一篇 Markdown 笔记"));
		return;
	}
		const lineIndex = editor.getCursor().line;
		const candidate = findMapNodeCandidateForLine(
			editor.getValue(),
			lineIndex,
			file.path
		);
	if (!candidate) {
		new Notice(this.i18n.t("当前行不是 H6 标题下的 H7+ 列表"));
		return;
	}
		const record = findMapNodeRecord(
			this.mapNodeRegistry,
			file.path,
			candidate.parentKey,
			candidate.text,
			candidate.occurrence
		);
	if (!record) {
		new Notice(this.i18n.t("当前列表不是导图节点"));
		return;
	}
	this.mapNodeRegistry = removeMapNodeSubtreeByKey(
		this.mapNodeRegistry,
		file.path,
		record.key
	);
	await this.savePluginData();
	this.syncMapNodeRegistryToViews(file.path);
	new Notice(this.i18n.t("已转回普通正文"));
}

	private syncMapNodeRegistryToViews(filePath?: string): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			VIEW_TYPE_OUTLINE_MINDMAP
		)) {
			if (leaf.view instanceof OutlineMindmapView) {
				if (filePath && leaf.view.getCurrentFilePath() !== filePath) {
					continue;
				}
				leaf.view.applyMapNodeRegistry();
			}
		}
	}

	private async savePluginData(): Promise<void> {
		const data: PluginData = {
			clickToJump: this.clickToJump,
			lockCurrentNote: this.lockCurrentNote,
			elegantAnimation: this.elegantAnimation,
			elegantAnimationSpeed: this.elegantAnimationSpeed,
			elegantAnimationSpring: this.elegantAnimationSpring,
			strictHeadingSpacing: this.strictHeadingSpacing,
			language: this.languageSetting,
			mindMapStyle: this.mindMapStyle,
			licenseCode: this.license.code,
			licenseMachine: this.license.machineCode,
			licenseTier: this.license.payload?.tier ?? "",
			licenseExpiresAt: this.license.payload?.expiresAt ?? "",
			licenseActivatedAt: this.license.activationDate,
			noteStyles: this.noteStyles,
			viewStates: this.viewStates,
			mapNodeRegistry: this.mapNodeRegistry
		};
		await this.saveData(data);
	}
}
