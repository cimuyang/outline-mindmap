import { ItemView, MarkdownView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type { Editor } from "obsidian";
import type OutlineMindmapPlugin from "./main";
import {
	addMapNodeRecord,
	computeMapNodeIdentityKey,
	findMapNodeRecordByKey,
	migrateMapNodeRecordToCandidate,
	reconcileMapNodeRegistry,
	removeMapNodeRecordsByKeys,
	rekeyMapNodeRecord
} from "./mapNodeRegistry";
import type { MapNodeRegistry } from "./mapNodeRegistry";
import { walkMindTree } from "./model";
import type { MindNode } from "./model";
import {
	computeHeadingMapNodeKey,
	findMapNodeCandidateForLine,
	getMapNodeCandidatesForMarkdown,
	parseMarkdownWithMapNodes
} from "./parser";
import { MindMapRenderer } from "./render";
import type { NoteSyncCoordinator } from "./noteSyncCoordinator";
import { getNodeTextRange, JumpHighlightManager } from "./highlight";
import { NoteMindMapStyleModal } from "./noteStyleModal";
import { isInRightSidebar } from "./viewPlacement";
import {
	addChildNode,
	addSiblingNode,
	appendRootNode,
	deleteNodesDetailed,
	moveNodesDetailed,
	promoteToRoot,
	updateNodeText,
	willBecomeListLevel
} from "./writer";
import type { InsertPosition, MoveMode } from "./writer";

export const VIEW_TYPE_OUTLINE_MINDMAP = "outline-mindmap-view";

export class OutlineMindmapView extends ItemView {
	private renderer: MindMapRenderer | null = null;
	private sync: NoteSyncCoordinator | null = null;
	private file: TFile | null = null;
	private markdownText = "";
	private canvasEl: HTMLElement | null = null;
	private lockAction: HTMLElement | null = null;
	private clickToJumpAction: HTMLElement | null = null;
	private nativeActionEls: HTMLElement[] = [];
	private fallbackActionBarEl: HTMLElement | null = null;
	private followActiveFile = true;
	private refreshSeq = 0;
	private renderPending: { text: string; filePath: string } | null = null;
	private renderQueue: Promise<void> = Promise.resolve();
	private isClosed = false;
	private jumpHighlight: JumpHighlightManager | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: OutlineMindmapPlugin) {
		super(leaf);
		this.icon = "network";
	}

	getViewType(): string {
		return VIEW_TYPE_OUTLINE_MINDMAP;
	}

	getDisplayText(): string {
		return this.file
			? this.file.basename
			: this.plugin.i18n.t("未打开笔记");
	}

	private t(
		text: string,
		vars?: Record<string, string | number>
	): string {
		return this.plugin.i18n.t(text, vars);
	}

	getCurrentFilePath(): string | null {
		return this.file?.path ?? null;
	}

	private get viewStateKey(): string {
		const leafId = (this.leaf as unknown as { id?: string }).id ?? "";
		return `${this.file?.path ?? ""}::${leafId}`;
	}

	getIcon(): string {
		return "network";
	}

	async onOpen(): Promise<void> {
		this.isClosed = false;
		this.renderPending = null;
		this.renderQueue = Promise.resolve();
		this.followActiveFile = !this.plugin.lockCurrentNote;
		this.renderer?.destroy();
		this.renderer = null;
		const syncPath = this.sync?.path;
		this.sync?.unsubscribe(this.applyMarkdown);
		if (syncPath) {
			this.plugin.releaseNoteSyncCoordinator(syncPath);
		}
		this.sync = null;

		const content = this.contentEl;
		content.empty();
		content.addClass("outline-mindmap-view");

		for (const action of this.nativeActionEls) {
			action.remove();
		}
		this.nativeActionEls = [];
		this.fallbackActionBarEl = null;

		this.lockAction = this.addAction("pin", this.t("锁定当前笔记"), () =>
			this.toggleLock()
		);
		this.lockAction.addClass("outline-mindmap-native-action");
		this.lockAction.addClass("outline-mindmap-action-lock");
		this.nativeActionEls.push(this.lockAction);
		this.updateLockButton();

		this.clickToJumpAction = this.addAction(
			"mouse-pointer",
			this.t("单击即跳转"),
			() =>
			void this.toggleClickToJump()
		);
		this.clickToJumpAction.addClass("outline-mindmap-native-action");
		this.clickToJumpAction.addClass("outline-mindmap-action-click");
		this.nativeActionEls.push(this.clickToJumpAction);
		this.updateClickToJumpButton();

		const fitAction = this.addAction(
			"fit-to-screen",
			this.t("适应画布"),
			() => this.renderer?.fit()
		);
		fitAction.addClass("outline-mindmap-native-action");
		fitAction.addClass("outline-mindmap-fit-action");
		fitAction.addClass("outline-mindmap-action-fit");
		this.nativeActionEls.push(fitAction);

		const settingsAction = this.addAction(
			"settings",
			this.t("设置当前笔记样式"),
			() =>
			this.openNoteStyleSettings()
		);
		settingsAction.addClass("outline-mindmap-native-action");
		settingsAction.addClass("outline-mindmap-action-settings");
		this.nativeActionEls.push(settingsAction);

		this.refreshNativeChrome();

		this.canvasEl = content.createDiv({ cls: "outline-mindmap-canvas" });
		this.canvasEl.tabIndex = 0;

		this.app.workspace.on("file-open", this.handleFileOpen);
		this.app.workspace.on("active-leaf-change", this.handleActiveLeafChange);
		this.app.vault.on("delete", this.handleFileDelete);
		this.app.vault.on("rename", this.handleFileRename);

		await this.loadActiveFile(true);
		this.refreshNativeChrome();
	}

	async onClose(): Promise<void> {
		this.isClosed = true;
		this.renderPending = null;
		this.renderQueue = Promise.resolve();
		await this.saveCurrentViewState();
		this.app.workspace.off("file-open", this.handleFileOpen);
		this.app.workspace.off("active-leaf-change", this.handleActiveLeafChange);
		this.app.vault.off("delete", this.handleFileDelete);
		this.app.vault.off("rename", this.handleFileRename);
		this.jumpHighlight?.detach();
		this.jumpHighlight = null;
		const syncPath = this.sync?.path;
		this.sync?.unsubscribe(this.applyMarkdown);
		if (syncPath) {
			this.plugin.releaseNoteSyncCoordinator(syncPath);
		}
		this.sync = null;
		this.renderer?.destroy();
		this.renderer = null;
		this.file = null;
		this.lockAction = null;
		this.clickToJumpAction = null;
		this.nativeActionEls = [];
		this.fallbackActionBarEl = null;
	}

	private handleFileOpen = (...args: unknown[]): void => {
		const file = args[0] as TFile | null;
		if (this.followActiveFile && file && file.extension === "md") {
			void this.loadActiveFile();
		}
	};

	private handleActiveLeafChange = (..._args: unknown[]): void => {
		if (!this.followActiveFile) {
			return;
		}
		const file = this.app.workspace.getActiveFile();
		if (file && file.extension === "md" && file.path !== this.file?.path) {
			void this.loadActiveFile();
		}
	};

	private handleFileDelete = async (file: unknown): Promise<void> => {
		const deleted = file as { path?: string } | null;
		if (!deleted?.path || deleted.path !== this.file?.path) {
			return;
		}
		await this.plugin.removeViewStatesForFile(deleted.path);
		await this.plugin.removeNoteMindMapStyle(deleted.path);
		await this.plugin.removeMapNodeRegistry(deleted.path);
		this.setCurrentFile(null);
		this.showEmptyState(this.t("笔记已被删除"), true);
	};

	private toggleLock(): void {
		this.followActiveFile = !this.followActiveFile;
		this.updateLockButton();
		if (this.followActiveFile) {
			void this.loadActiveFile();
		}
	}

	private updateLockButton(): void {
		if (!this.lockAction) {
			return;
		}
		setIcon(this.lockAction, this.followActiveFile ? "pin" : "pin-off");
		this.lockAction.classList.toggle("is-active", !this.followActiveFile);
		const label = this.followActiveFile
			? this.t("锁定当前笔记")
			: this.t("跟随活动笔记");
		this.lockAction.setAttribute("title", label);
		this.lockAction.setAttribute("aria-label", label);
		this.lockAction.setAttribute(
			"aria-pressed",
			String(!this.followActiveFile)
		);
	}

	private async loadActiveFile(force = false): Promise<void> {
		if (!this.followActiveFile && !force) {
			return;
		}
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
		await this.saveCurrentViewState();
		this.setCurrentFile(null);
		this.showEmptyState(this.t("请先打开一篇 Markdown 笔记"));
		return;
		}
		if (file.path === this.file?.path) {
			return;
		}

		await this.saveCurrentViewState();
		this.refreshSeq++;
		this.setCurrentFile(file);
		await this.readAndAttach(file);
	}

	private async readAndAttach(file: TFile): Promise<void> {
		let text: string;
		try {
			text = await this.app.vault.read(file);
		} catch (error) {
			this.showEmptyState(this.t("无法读取笔记内容"), true);
			return;
		}
		if (this.isClosed) {
			return;
		}

		this.markdownText = text;
		const reconciled = reconcileMapNodeRegistry(
			this.plugin.getMapNodeRegistry(),
			file.path,
			getMapNodeCandidatesForMarkdown(text, file.path)
		);
		await this.plugin.saveMapNodeRegistry(reconciled);
		const coordinator = this.plugin.getNoteSyncCoordinator(file);
		this.sync = coordinator;
		this.sync.subscribe(this.applyMarkdown);
		await this.renderCurrent();
	}

	private handleFileRename = async (
		file: unknown,
		oldPath: unknown
	): Promise<void> => {
		if (
			this.isClosed ||
			!this.file ||
			!(file instanceof TFile) ||
			typeof oldPath !== "string"
		) {
			return;
		}
		if (file.path !== this.file.path && oldPath !== this.file.path) {
			return;
		}
		if (file.extension !== "md") {
			await this.saveCurrentViewState();
			await this.plugin.removeViewStatesForFile(oldPath);
			await this.plugin.removeMapNodeRegistry(oldPath);
			this.setCurrentFile(null);
			this.showEmptyState(this.t("请先打开一篇 Markdown 笔记"));
			return;
		}
		await this.saveCurrentViewState();
		await this.plugin.renameViewStatesForFile(oldPath, file.path);
		await this.plugin.renameNoteMindMapStyle(oldPath, file.path);
		await this.plugin.renameMapNodeRegistry(oldPath, file.path);
		this.refreshSeq++;
		this.setCurrentFile(file);
		void this.readAndAttach(file);
	};

	private setCurrentFile(file: TFile | null): void {
		const pathChanged = this.file?.path !== file?.path;
		const syncPath = this.sync?.path;
		this.sync?.unsubscribe(this.applyMarkdown);
		if (syncPath) {
			this.plugin.releaseNoteSyncCoordinator(syncPath);
		}
		this.sync = null;
		if (pathChanged && this.renderer) {
			this.renderer.destroy();
			this.renderer = null;
		}
		this.file = file;
		this.jumpHighlight?.detach();
		this.jumpHighlight = null;
		this.updateNoteTitle();
	}

	private updateNoteTitle(): void {
		this.refreshNativeChrome();
	}

	refreshNativeChrome(): void {
		this.refreshNativeIcon();
		this.refreshNativeTitle();
		this.ensureRightSidebarActionBar();
	}

	private refreshNativeIcon(): void {
		this.icon = "network";
		const tabIconEl = (
			this.leaf as unknown as {
				tabHeaderInnerIconEl?: HTMLElement | null;
			}
		).tabHeaderInnerIconEl;
		if (tabIconEl) {
			setIcon(tabIconEl, "network");
		}

		const viewIconEl = (
			this as unknown as {
				iconEl?: HTMLElement | null;
			}
		).iconEl;
		if (viewIconEl) {
			setIcon(viewIconEl, "network");
		}

		const headerIconEl =
			this.containerEl.querySelector<HTMLElement>(".view-header-icon");
		if (headerIconEl) {
			setIcon(headerIconEl, "network");
		}
	}

	private ensureRightSidebarActionBar(): void {
		if (
			this.fallbackActionBarEl ||
			this.nativeActionEls.length === 0 ||
			!isInRightSidebar(this.leaf, this.app.workspace.rightSplit)
		) {
			return;
		}

		const bar = this.contentEl.createDiv({
			cls: "outline-mindmap-native-action-bar"
		});
		this.fallbackActionBarEl = bar;
		for (const action of this.nativeActionEls) {
			action.remove();
			bar.appendChild(action);
		}
		this.contentEl.prepend(bar);
	}

	private refreshNativeTitle(): void {
		const title = this.getDisplayText();
		const titlePath = this.file?.path ?? "";
		const view = this.leaf.view as unknown as {
			headerEl?: HTMLElement;
			containerEl?: HTMLElement;
		};
		const header = view.headerEl ??
			view.containerEl?.querySelector<HTMLElement>(".view-header");
		const titleEl = header?.querySelector<HTMLElement>(
			".view-header-title"
		);
		titleEl?.setText(title);

		const tabTitleEl = (
			this.leaf as unknown as {
				tabHeaderInnerTitleEl?: HTMLElement;
			}
		).tabHeaderInnerTitleEl;
		if (tabTitleEl) {
			tabTitleEl.setText(title);
			tabTitleEl.setAttribute("aria-label", titlePath || title);
			tabTitleEl.setAttribute("title", titlePath || title);
		}
	}

	private async saveCurrentViewState(): Promise<void> {
		if (!this.file || !this.renderer) {
			return;
		}
		const state = this.renderer.captureViewState();
		if (state) {
			await this.plugin.saveViewState(this.viewStateKey, state);
		}
	}

	private applyMarkdown = (text: string): Promise<void> => {
		this.markdownText = text;
		return this.renderCurrent();
	};

	private renderCurrent(): Promise<void> {
		if (!this.canvasEl || !this.file) {
			return Promise.resolve();
		}
		const text = this.markdownText;
		const filePath = this.file.path;
		this.renderPending = { text, filePath };
		const run = this.renderQueue.then(async () => {
			while (this.renderPending) {
				const next = this.renderPending;
				this.renderPending = null;
				await this.renderCurrentOnce(next.text, next.filePath);
			}
		});
		this.renderQueue = run.catch(() => undefined);
		return run;
	}

	private async renderCurrentOnce(
		text: string,
		filePath: string
	): Promise<void> {
		if (
			this.isClosed ||
			!this.canvasEl ||
			!this.file ||
			this.file.path !== filePath
		) {
			return;
		}
		const seq = this.refreshSeq;
		let tree: ReturnType<typeof parseMarkdownWithMapNodes>;
		try {
			tree = parseMarkdownWithMapNodes(text, {
				filePath,
				registry: this.plugin.getMapNodeRegistry()
			});
	} catch (error) {
		this.showEmptyState(this.t("解析 Markdown 失败"), true);
		return;
	}
	if (tree.roots.length === 0) {
		this.showEmptyState(this.t("笔记中没有标题"), false, true);
		return;
		}

		if (this.renderer) {
			try {
				this.renderer.setMapNodeRegistry(
					filePath,
					this.plugin.getMapNodeRegistry(),
					text
				);
				await this.renderer.waitForRenderEnd();
			} catch (error) {
				this.showEmptyState(this.t("渲染失败，请重试"));
			}
			return;
		}

		const renderer = new MindMapRenderer();
		this.renderer = renderer;
		renderer.setTranslate((text) => this.plugin.i18n.t(text));
		try {
			await renderer.init(
				this.canvasEl,
				text,
				{
					onCommitText: (node, newText) =>
						this.commitTextEdit(node, newText),
					onAddChild: (parent) => void this.createChildNode(parent),
					onAddSibling: (node, position) =>
						void this.createSiblingNode(node, position),
					onDelete: (nodes) => void this.performDelete(nodes),
					onMove: (nodes, target, mode) =>
						void this.performMove(nodes, target, mode),
					onPromoteToRoot: (node) => void this.promoteDraggedNode(node),
					onAddRoot: () => void this.createRootNode(),
					onOpenLink: (linkText) => {
						void this.app.workspace.openLinkText(
							linkText,
							this.file?.path ?? ""
						);
					},
					onLocateNode: (node) => void this.jumpToNode(node),
					onRenderError: (message) =>
						this.showEmptyState(message, true)
				},
				this.plugin.getViewState(this.viewStateKey),
				this.plugin.getEffectiveMindMapStyle(filePath),
				{
					filePath,
					mapNodeRegistry: this.plugin.getMapNodeRegistry()
				}
			);
		await renderer.waitForRenderEnd();
		renderer.setClickToJump(this.plugin.clickToJump);
		renderer.setElegantAnimation(
					this.plugin.getEffectiveElegantAnimation()
				);
			renderer.setElegantAnimationOptions(
				this.plugin.elegantAnimationSpeed,
				this.plugin.elegantAnimationSpring
			);
		} catch (error) {
			if (this.renderer === renderer) {
				renderer.destroy();
				this.renderer = null;
			}
			this.showEmptyState(this.t("渲染失败，请重试"));
			return;
		}

		if (seq !== this.refreshSeq) {
			renderer.destroy();
			if (this.renderer === renderer) {
				this.renderer = null;
			}
		}
	}

	private async toggleClickToJump(): Promise<void> {
		const next = !this.plugin.clickToJump;
		await this.plugin.saveClickToJump(next);
		this.updateClickToJumpButton();
		this.renderer?.setClickToJump(next);
	}

	private openNoteStyleSettings(): void {
		if (!this.file) {
			new Notice(this.t("请先打开一篇 Markdown 笔记"));
			return;
		}
	if (!this.plugin.isPro()) {
		new Notice(
			this.t("“当前笔记样式”为 Pro 专属功能，请先在插件设置中激活。")
		);
		return;
		}
		const filePath = this.file.path;
		new NoteMindMapStyleModal(this.app, this.plugin, filePath, {
			onPreview: (style) => this.renderer?.applyMindMapStyle(style),
			onRestore: () =>
				this.renderer?.applyMindMapStyle(
					this.plugin.getEffectiveMindMapStyle(filePath)
				)
		}).open();
	}

	private updateClickToJumpButton(): void {
		if (!this.clickToJumpAction) {
			return;
		}
		setIcon(
			this.clickToJumpAction,
			this.plugin.clickToJump ? "mouse-pointer-click" : "mouse-pointer"
		);
		this.clickToJumpAction.classList.toggle(
			"is-active",
			this.plugin.clickToJump
		);
		this.clickToJumpAction.setAttribute(
			"aria-pressed",
			String(this.plugin.clickToJump)
		);
	}

	applyPluginClickToJump(): void {
		this.updateClickToJumpButton();
		this.renderer?.setClickToJump(this.plugin.clickToJump);
	}

	applyPluginElegantAnimation(): void {
		this.renderer?.setElegantAnimation(
			this.plugin.getEffectiveElegantAnimation()
		);
		this.renderer?.setElegantAnimationOptions(
			this.plugin.elegantAnimationSpeed,
			this.plugin.elegantAnimationSpring
		);
	}

	applyMapNodeRegistry(): void {
		if (this.file) {
			this.renderer?.setMapNodeRegistry(
				this.file.path,
				this.plugin.getMapNodeRegistry(),
				this.markdownText
			);
		}
	}

	applyPluginMindMapStyle(): void {
		if (this.file) {
			this.renderer?.applyMindMapStyle(
				this.plugin.getEffectiveMindMapStyle(this.file.path)
			);
		}
	}

	private async jumpToNode(node: MindNode): Promise<void> {
		if (!this.file) {
			return;
		}
		const file = this.file;
		let leaf = this.findMarkdownLeaf();
		if (!leaf) {
			leaf = this.app.workspace.getLeaf("tab");
			await leaf.openFile(file, { active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
		const view = leaf.view instanceof MarkdownView ? leaf.view : null;
	const editor = view?.editor ?? (await this.waitForEditor(view));
	if (!editor) {
		new Notice(this.t("无法定位到文章对应位置"));
		return;
		}
		const line = Math.max(0, Math.min(node.lineIndex, editor.lastLine()));
		const position = { line, ch: 0 };
		editor.setCursor(position);
		editor.scrollIntoView({ from: position, to: position }, true);
		this.applyJumpHighlight(view, editor, line, node);
	}

	private findMarkdownLeaf(): WorkspaceLeaf | null {
		if (!this.file) {
			return null;
		}
		const file = this.file;
		return (
			this.app.workspace
				.getLeavesOfType("markdown")
				.find((candidate) => {
					const view = candidate.view as unknown as {
						file?: TFile | null;
					} | null;
					return view?.file?.path === file.path;
				}) ?? null
		);
	}

	private applyJumpHighlight(
		view: MarkdownView | null,
		editor: Editor,
		line: number,
		node: MindNode
	): void {
		if (!view) {
			this.jumpHighlight?.clear();
			return;
		}
		const lineText = editor.getLine(line);
		const range = getNodeTextRange(lineText, node.type);
		if (!range) {
			this.jumpHighlight?.clear();
			return;
		}
		if (!this.jumpHighlight) {
			this.jumpHighlight = new JumpHighlightManager();
		}
		this.jumpHighlight.setRange(editor, view.contentEl, line, range);
	}

	private syncNotePosition(line: number, ch = 0): void {
		if (!Number.isFinite(line) || !this.file) {
			return;
		}
		const leaf = this.findMarkdownLeaf();
		const view = leaf?.view instanceof MarkdownView ? leaf.view : null;
		const editor = view?.editor;
		if (!editor) {
			return;
		}
		const position = {
			line: Math.max(0, Math.min(line, editor.lastLine())),
			ch
		};
		const cm = (editor as unknown as { cm?: unknown }).cm;
		const cmState = (cm as {
			state?: { doc?: { line?: (line: number) => { from: number; length: number } } };
			dispatch?: (transaction: unknown) => void;
		} | null);
		const docLine = cmState?.state?.doc?.line?.(
			Math.max(1, Math.min(position.line + 1, editor.lastLine() + 1))
		);
		if (cmState?.dispatch && docLine) {
			cmState.dispatch({
				selection: {
					anchor: docLine.from + Math.min(ch, docLine.length)
				}
			});
			return;
		}
		editor.setCursor(position);
	}

	private async waitForEditor(
		view: MarkdownView | null
	): Promise<Editor | null> {
		if (!view) {
			return null;
		}
		if (view.editor) {
			return view.editor;
		}
		const deadline = Date.now() + 3000;
		while (Date.now() < deadline) {
			await new Promise<void>((resolve) =>
				window.requestAnimationFrame(() => resolve())
			);
			if (view.editor) {
				return view.editor;
			}
		}
		return null;
	}

	private collectMapNodeKeys(nodes: MindNode[]): string[] {
		const keys = new Set<string>();
		walkMindTree(nodes, (node) => {
			if (node.mapNodeKey) {
				keys.add(node.mapNodeKey);
			}
		});
		return [...keys];
	}

	private rekeyMapNodeSubtree(
		registry: MapNodeRegistry,
		filePath: string,
		node: MindNode,
		newParentKey: string | null
	): MapNodeRegistry {
		if (!node.mapNodeKey) {
			return registry;
		}
		const oldRecord = findMapNodeRecordByKey(registry, filePath, node.mapNodeKey);
		if (!oldRecord) {
			return registry;
		}
		let next = rekeyMapNodeRecord(
			registry,
			filePath,
			node.mapNodeKey,
			newParentKey
		);
		const newKey = computeMapNodeIdentityKey(
			filePath,
			newParentKey,
			oldRecord.text,
			oldRecord.occurrence
		);
		for (const child of node.children) {
			if (child.mapNodeKey) {
				next = this.rekeyMapNodeSubtree(
					next,
					filePath,
					child,
					newKey
				);
			}
		}
		return next;
	}

	private parentKeyForMoveTarget(
		target: MindNode,
		mode: MoveMode
	): string | null {
		if (mode === "child") {
			return target.mapNodeKey ?? null;
		}
		return target.parent?.mapNodeKey ?? null;
	}

	private topLevelSelectedNodes(nodes: MindNode[]): MindNode[] {
		const unique = nodes.filter(
			(node, index, all) =>
				all.findIndex((candidate) => candidate.id === node.id) === index
		);
		const selected = new Set(unique.map((node) => node.id));
		return unique.filter((node) => {
			for (
				let current: MindNode | null = node.parent;
				current !== null;
				current = current.parent
			) {
				if (selected.has(current.id)) {
					return false;
				}
			}
			return true;
		});
	}

	private registryForHeadingSubtree(
		registry: MapNodeRegistry,
		filePath: string,
		node: MindNode,
		parentKey: string | null,
		delta = 0,
		finalMarkdown?: string
	): MapNodeRegistry {
		const occurrence = node.parent
			? this.headingOccurrenceAmongSiblings(node.parent, node)
			: 1;
		const headingKey = computeHeadingMapNodeKey(
			parentKey,
			node.level + delta,
			node.text,
			occurrence
		);
		let next = registry;
		for (const child of node.children) {
			if (child.type === "heading") {
				const childNewLevel = child.level + delta;
				if (finalMarkdown && childNewLevel > 6) {
					const occurrence =
						this.headingOccurrenceAmongSiblings(node, child);
					const candidates = getMapNodeCandidatesForMarkdown(
						finalMarkdown,
						filePath
					);
					const childCandidate = candidates.find(
						(candidate) =>
							candidate.parentKey === headingKey &&
							candidate.text === child.text &&
							candidate.occurrence === occurrence
					);
					if (childCandidate) {
						next =
							this.registryForHeadingToListSubtreeFromFinalMarkdown(
								next,
								filePath,
								child,
								finalMarkdown,
								childCandidate.lineIndex
							);
					}
				} else {
					next = this.registryForHeadingSubtree(
						next,
						filePath,
						child,
						headingKey,
						delta,
						finalMarkdown
					);
				}
			} else if (child.mapNodeKey) {
				next = this.rekeyMapNodeSubtree(
					next,
					filePath,
					child,
					headingKey
				);
			}
		}
		return next;
	}

	private registryForPromotedNode(
		registry: MapNodeRegistry,
		filePath: string,
		node: MindNode
	): MapNodeRegistry {
		if (node.type === "list" && node.mapNodeKey) {
			return this.rekeyMapNodeSubtree(registry, filePath, node, null);
		}
		if (node.type === "heading") {
			const rootHeadingKey = computeHeadingMapNodeKey(
				null,
				1,
				node.text
			);
			let next = registry;
			for (const child of node.children) {
				if (child.mapNodeKey) {
					next = this.rekeyMapNodeSubtree(
						next,
						filePath,
						child,
						rootHeadingKey
					);
				}
			}
			return next;
		}
		return registry;
	}

	private async createChildNode(parent: MindNode): Promise<void> {
		if (!this.file || !this.sync) {
			return;
		}
		let result: ReturnType<typeof addChildNode>;
		try {
			result = addChildNode(
				this.markdownText,
				parent,
				"",
				this.plugin.strictHeadingSpacing
			);
		} catch (error) {
			new Notice(this.t("写回 Markdown 失败，请重试"));
			return;
		}
		let nextRegistry = this.plugin.getMapNodeRegistry();
		if (
			parent.type === "list" ||
			(parent.type === "heading" && parent.level === 6)
		) {
			const candidate = findMapNodeCandidateForLine(
				result.text,
				result.lineIndex,
				this.file.path
			);
			if (candidate) {
				const added = addMapNodeRecord(nextRegistry, this.file.path, {
					parentKey: candidate.parentKey,
					text: candidate.text,
					occurrence: candidate.occurrence
				});
				nextRegistry = added.registry;
			}
		}
		const written = await this.writeOperation(
			result.text,
			String(result.lineIndex),
			false,
			true,
			nextRegistry
		);
	}

	private async createRootNode(): Promise<void> {
		if (!this.file || !this.sync) {
			return;
		}
		const wasEmpty =
			!this.renderer?.hasRenderedRoots() &&
			this.markdownText.trim() === "";
		let result: ReturnType<typeof appendRootNode>;
		try {
			result = appendRootNode(
				this.markdownText,
				"",
				this.plugin.strictHeadingSpacing
			);
		} catch (error) {
			new Notice(this.t("写回 Markdown 失败，请重试"));
			return;
		}
		try {
			const written = await this.sync.write(result.text, {
				notify: false,
				local: true
			});
			if (!written) {
				new Notice(this.t("写回 Markdown 失败，请重试"));
				this.renderer?.forceRenderMarkdown(this.markdownText);
				return;
			}
		} catch (error) {
			new Notice(this.t("写回 Markdown 失败，请重试"));
			this.renderer?.forceRenderMarkdown(this.markdownText);
			return;
		}
		if (this.isClosed) {
			return;
		}
		this.markdownText = result.text;
		const broadcast = this.sync.broadcast(result.text);
		if (wasEmpty) {
			await broadcast.catch(() => undefined);
		} else {
			void broadcast.catch(() => undefined);
		}
		if (this.isClosed) {
			return;
		}
		if (wasEmpty) {
			if (!this.renderer) {
				await this.renderCurrent();
			}
			this.renderer?.centerNode(String(result.lineIndex));
		}
		this.syncNotePosition(result.lineIndex);
		this.renderer?.focusNodeAndEdit(String(result.lineIndex));
	}

	private async createSiblingNode(
		node: MindNode,
		position: InsertPosition
	): Promise<void> {
		if (!this.file || !this.sync) {
			return;
		}
		let result: ReturnType<typeof addSiblingNode>;
		try {
			result = addSiblingNode(
				this.markdownText,
				node,
				"",
				position,
				this.plugin.strictHeadingSpacing
			);
		} catch (error) {
			new Notice(this.t("写回 Markdown 失败，请重试"));
			return;
		}
		let nextRegistry = this.plugin.getMapNodeRegistry();
		if (node.type === "list") {
			const candidate = findMapNodeCandidateForLine(
				result.text,
				result.lineIndex,
				this.file.path
			);
			if (candidate) {
				const added = addMapNodeRecord(nextRegistry, this.file.path, {
					parentKey: candidate.parentKey,
					text: candidate.text,
					occurrence: candidate.occurrence
				});
				nextRegistry = added.registry;
			}
		}
		const written = await this.writeOperation(
			result.text,
			String(result.lineIndex),
			false,
			true,
			nextRegistry
		);
	}

	private async performDelete(nodes: MindNode[]): Promise<void> {
		if (!this.file || !this.sync) {
			return;
		}
		const filePath = this.file.path;
		const keys = this.collectMapNodeKeys(nodes);
		const nextRegistry =
			keys.length > 0
				? removeMapNodeRecordsByKeys(
						this.plugin.getMapNodeRegistry(),
						filePath,
						keys
					)
				: undefined;
		let next: string;
		try {
			const result = deleteNodesDetailed(this.markdownText, nodes);
			next = result.text;
			await this.writeOperation(
				next,
				String(result.focusLine),
				false,
				false,
				nextRegistry
			);
			return;
		} catch (error) {
			new Notice(this.t("写回 Markdown 失败，请重试"));
			return;
		}
	}

	private async performMove(
		nodes: MindNode[],
		target: MindNode,
		mode: MoveMode
	): Promise<void> {
		if (!this.file || !this.sync) {
			return;
		}
		await this.performMoveWithOptions(nodes, target, mode);
	}

	private async performMoveWithOptions(
		nodes: MindNode[],
		target: MindNode,
		mode: MoveMode
	): Promise<void> {
		if (!this.file || !this.sync) {
			return;
		}
		const filePath = this.file.path;
		let next: string;
		let nextRegistry = this.plugin.getMapNodeRegistry();
		try {
			const result = moveNodesDetailed(
				this.markdownText,
				nodes,
				target,
				mode,
				this.plugin.strictHeadingSpacing
			);
			next = result.text;
			const sortedTop = [...this.topLevelSelectedNodes(nodes)].sort(
				(a, b) => a.blockStart - b.blockStart
			);
			const parentKey = this.parentKeyForMoveTarget(target, mode);
			for (let i = 0; i < sortedTop.length; i++) {
				const node = sortedTop[i];
				if (
					node.type === "heading" &&
					willBecomeListLevel(node, target, mode)
				) {
					const finalLine = result.lineIndexes?.[i];
					if (finalLine !== undefined) {
						nextRegistry =
							this.registryForHeadingToListSubtreeFromFinalMarkdown(
								nextRegistry,
								filePath,
								node,
								next,
								finalLine
							);
					}
				} else if (node.type === "heading") {
					const delta =
						(mode === "child"
							? target.level + 1
							: target.level) - node.level;
					nextRegistry = this.registryForHeadingSubtree(
						nextRegistry,
						filePath,
						node,
						parentKey,
						delta,
						next
					);
				} else if (node.type === "list" && node.mapNodeKey) {
					nextRegistry = this.rekeyMapNodeSubtree(
						nextRegistry,
						filePath,
						node,
						parentKey
					);
				}
			}
			await this.writeOperation(
				next,
				String(result.lineIndex),
				false,
				false,
				nextRegistry
			);
			return;
	} catch (error) {
		new Notice(this.t("非法移动已被拒绝"));
		this.renderer?.forceRenderMarkdown(this.markdownText);
			return;
		}
	}

	private registryForHeadingToListSubtreeFromFinalMarkdown(
		registry: MapNodeRegistry,
		filePath: string,
		node: MindNode,
		finalMarkdown: string,
		finalLineIndex: number
	): MapNodeRegistry {
		const rootCandidate = findMapNodeCandidateForLine(
			finalMarkdown,
			finalLineIndex,
			filePath
		);
		if (!rootCandidate) {
			return registry;
		}
		const migrated = migrateMapNodeRecordToCandidate(
			registry,
			filePath,
			node.mapNodeKey ?? "",
			rootCandidate
		);
		let next = migrated.registry;
		const parentKey = migrated.key;
		const candidates = getMapNodeCandidatesForMarkdown(
			finalMarkdown,
			filePath
		);
		for (const child of node.children) {
			if (child.type === "heading") {
				const occurrence = this.headingOccurrenceAmongSiblings(
					node,
					child
				);
				const childCandidate = candidates.find(
					(candidate) =>
						candidate.parentKey === parentKey &&
						candidate.text === child.text &&
						candidate.occurrence === occurrence
				);
				if (childCandidate) {
					next =
						this.registryForHeadingToListSubtreeFromFinalMarkdown(
							next,
							filePath,
							child,
							finalMarkdown,
							childCandidate.lineIndex
						);
				}
			} else if (child.mapNodeKey) {
				next = this.rekeyMapNodeSubtree(
					next,
					filePath,
					child,
					parentKey
				);
			}
		}
		return next;
	}

	private headingOccurrenceAmongSiblings(
		parent: MindNode,
		target: MindNode
	): number {
		let occurrence = 0;
		for (const sibling of parent.children) {
			if (sibling.type === "heading" && sibling.text === target.text) {
				occurrence++;
				if (sibling === target) {
					return occurrence;
				}
			}
		}
		return 1;
	}

	private async promoteDraggedNode(node: MindNode): Promise<void> {
		if (!this.file || !this.sync) {
			return;
		}
		const filePath = this.file.path;
		const nextRegistry = this.registryForPromotedNode(
			this.plugin.getMapNodeRegistry(),
			filePath,
			node
		);
		let result: ReturnType<typeof promoteToRoot>;
		try {
			result = promoteToRoot(
				this.markdownText,
				node,
				this.plugin.strictHeadingSpacing
			);
	} catch (error) {
		new Notice(this.t("无法提升为根节点"));
		this.renderer?.forceRenderMarkdown(this.markdownText);
			return;
		}
		const written = await this.writeOperation(
			result.text,
			String(result.lineIndex),
			false,
			false,
			nextRegistry
		);
		if (written) {
			this.renderer?.activateNode(String(result.lineIndex));
		}
	}

	private async writeOperation(
		next: string,
		focusUid?: string,
		textOnly = false,
		editAfterFocus = true,
		registry?: MapNodeRegistry
	): Promise<boolean> {
		if (!this.file || !this.sync || next === this.markdownText) {
			return false;
		}
		const filePath = this.file.path;
		try {
			const written = await this.sync.write(next, {
				notify: false,
				local: true
			});
			if (!written) {
				this.renderer?.forceRenderMarkdown(this.markdownText);
				return false;
			}
			if (this.file?.path !== filePath) {
				if (registry) {
					await this.plugin.saveMapNodeRegistry(registry);
				}
				return true;
			}
			this.markdownText = next;
			if (registry) {
				await this.plugin.saveMapNodeRegistry(registry);
			}
			const broadcast = this.sync.broadcast(next);
			if (editAfterFocus) {
				void broadcast.catch(() => undefined);
			} else {
				await broadcast;
			}
			if (focusUid !== undefined) {
				this.syncNotePosition(Number(focusUid));
				if (editAfterFocus) {
					this.renderer?.focusNodeAndEdit(focusUid);
				}
			}
			return true;
		} catch (error) {
			new Notice(this.t("写回 Markdown 失败，请重试"));
			this.renderer?.forceRenderMarkdown(this.markdownText);
			return false;
		}
	}

	private async commitTextEdit(
		node: MindNode,
		newText: string
	): Promise<void> {
		if (!this.file || !this.sync) {
			return;
		}
		const filePath = this.file.path;
		const next = updateNodeText(this.markdownText, node, newText);
		if (next === this.markdownText) {
			return;
		}
		try {
			const written = await this.sync.write(next, {
				notify: false,
				onlyLine: node.lineIndex
			});
			if (!written || this.isClosed) {
				return;
			}
			let registry = this.plugin.getMapNodeRegistry();
			if (node.type === "list") {
				const candidate = findMapNodeCandidateForLine(
					next,
					node.lineIndex,
					filePath
				);
				if (candidate) {
					const migrated = migrateMapNodeRecordToCandidate(
						registry,
						filePath,
						node.mapNodeKey ?? "",
						candidate
					);
					registry = migrated.registry;
					node.mapNodeKey = migrated.key;
					for (const child of node.children) {
						if (child.mapNodeKey) {
							registry = this.rekeyMapNodeSubtree(
								registry,
								filePath,
								child,
								migrated.key
							);
						}
					}
				}
			} else if (node.type === "heading") {
				const occurrence = node.parent
					? this.headingOccurrenceAmongSiblings(node.parent, node)
					: 1;
				const newHeadingKey = computeHeadingMapNodeKey(
					node.parent?.mapNodeKey ?? null,
					node.level,
					newText,
					occurrence
				);
				node.mapNodeKey = newHeadingKey;
				for (const child of node.children) {
					if (child.mapNodeKey) {
						registry = this.rekeyMapNodeSubtree(
							registry,
							filePath,
							child,
							newHeadingKey
						);
					}
				}
			}
			if (this.file?.path !== filePath) {
				await this.plugin.saveMapNodeRegistry(registry);
				return;
			}
			this.markdownText = next;
			await this.plugin.saveMapNodeRegistry(registry);
			void this.sync.broadcast(next).catch(() => undefined);
			this.syncNotePosition(node.lineIndex);
		} catch (error) {
			new Notice(this.t("写回 Markdown 失败，请重试"));
			this.renderer?.forceRenderMarkdown(this.markdownText);
		}
	}

	private showEmptyState(
		message: string,
		retryable = false,
		allowCreateRoot = false
	): void {
		this.refreshSeq++;
		const state = this.renderer?.captureViewState();
		if (this.file && state) {
			void this.plugin.saveViewState(this.viewStateKey, state);
		}
		this.renderer?.destroy();
		this.renderer = null;
		if (!this.canvasEl) {
			return;
		}
		this.canvasEl.empty();
		const empty = this.canvasEl.createDiv({ cls: "outline-mindmap-empty" });
		const icon = empty.createDiv({ cls: "outline-mindmap-empty-icon" });
		setIcon(icon, "network");
		empty.createDiv({ cls: "outline-mindmap-empty-text", text: message });
		if (allowCreateRoot) {
			empty.createDiv({
				cls: "outline-mindmap-empty-hint",
				text: this.t("双击空白处新建根节点")
			});
			empty.addEventListener("dblclick", () => {
				void this.createRootNode();
			});
		}
		if (retryable) {
			const retry = empty.createEl("button", {
				cls: "outline-mindmap-retry-button",
				text: this.t("重新加载")
			});
			retry.addEventListener("click", () => void this.loadActiveFile());
		}
	}
}
