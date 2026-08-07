import MindMap from "simple-mind-map";
import Drag from "simple-mind-map/src/plugins/Drag.js";
import KeyboardNavigation from "simple-mind-map/src/plugins/KeyboardNavigation.js";
import Select from "simple-mind-map/src/plugins/Select.js";
import type { MindMapNodeData, MindMapNodeInstance } from "simple-mind-map";
import { MULTI_ROOT_MIND_MAP_LAYOUT } from "./multiRootMindMapLayout";
import { MultiRootMindMapLayout } from "./multiRootMindMapRendererLayout";
import { renderInlineMarkdown } from "./inlineMarkdown";
import type { MapNodeRegistry } from "./mapNodeRegistry";
import type { MindNode, MindTree } from "./model";
import {
	computeCenterTranslation,
	clampToContainer,
	computePanDeltaForEditor,
	isRectOutside,
	isUsableRect
} from "./pan";
import { parseMarkdown, parseMarkdownWithMapNodes } from "./parser";
import { diffTreeTextChanges } from "./diff";
import { JUMP_DELAY_MS, shouldTriggerJump } from "./jump";
import { installNodeShortcuts, resolveEditorKeyAction } from "./shortcuts";
import type { InsertPosition, MoveMode } from "./writer";
import { canMoveNodes } from "./writer";
import { resolveBlankDropAction } from "./drag";
import { resolveFocusStrategy } from "./focus";
import type { MindMapViewState } from "./viewState";
import {
	DEFAULT_MIND_MAP_STYLE,
	resolveEffectiveMindMapStyle
} from "./style";
import type { MindMapStyle } from "./style";
import {
	ELEGANT_ANIMATION_PADDING,
	easeOutCubic,
	easeOutSpring,
	getAnimationDistance,
	getAnimationDuration,
	interpolateNumberWithEasing,
	interpolateViewStateWithEasing,
	resolveAnimationTargetViewport,
	shouldDegradeAnimation
} from "./animation";
import type {
	AnimationBoundsRect,
	ViewTransformData,
	ViewTransformState
} from "./animation";

MindMap.usePlugin(Drag);
MindMap.usePlugin(KeyboardNavigation);
MindMap.usePlugin(Select);
const MindMapPrototype = MindMap as unknown as {
	prototype: Record<string, unknown>;
};
MindMapPrototype.prototype[MULTI_ROOT_MIND_MAP_LAYOUT] =
	MultiRootMindMapLayout;
const DragPrototype = Drag as unknown as {
	prototype: Record<string, unknown>;
};
const originalCheckOverlapNode = DragPrototype.prototype
	.checkOverlapNode as ((...args: unknown[]) => unknown) | undefined;
if (originalCheckOverlapNode) {
	DragPrototype.prototype.checkOverlapNode = function (
		this: { mindMap?: { opt?: Record<string, unknown> } },
		...args: unknown[]
	): unknown {
		const mindMap = this.mindMap;
		const originalLayout = mindMap?.opt?.layout;
		if (originalLayout === MULTI_ROOT_MIND_MAP_LAYOUT && mindMap?.opt) {
			mindMap.opt.layout = "mindMap";
		}
		try {
			return originalCheckOverlapNode.apply(this, args);
		} finally {
			if (mindMap?.opt && originalLayout !== undefined) {
				mindMap.opt.layout = originalLayout;
			}
		}
	};
}

export interface MindMapRendererCallbacks {
	onCommitText: (node: MindNode, newText: string) => void | Promise<void>;
	onAddChild: (parent: MindNode) => void | Promise<void>;
	onAddSibling: (
		node: MindNode,
		position: InsertPosition
	) => void | Promise<void>;
	onDelete: (nodes: MindNode[]) => void | Promise<void>;
	onMove: (
		nodes: MindNode[],
		target: MindNode,
		mode: MoveMode
	) => void | Promise<void>;
	onPromoteToRoot?: (node: MindNode) => void | Promise<void>;
	onAddRoot?: () => void;
	onOpenLink?: (linkText: string) => void;
	onLocateNode?: (node: MindNode) => void | Promise<void>;
	onRenderError?: (message: string) => void;
}

interface DragResolution {
	move: { nodes: MindNode[]; target: MindNode; mode: MoveMode } | null;
	invalid: boolean;
}

interface NodePosition {
	left: number;
	top: number;
}

interface NodeMotion {
	node: MindMapNodeInstance;
	from: NodePosition;
	to: NodePosition;
	appeared: boolean;
}

interface PendingExpandAnimation {
	node: MindMapNodeInstance;
	expand: boolean;
	oldPositions: Map<string, NodePosition>;
	oldView: ViewTransformData;
}

interface RunningExpandAnimation {
	fromView: ViewTransformData;
	toView: ViewTransformData;
	motions: NodeMotion[];
	startedAt: number;
	duration: number;
	easing: (t: number) => number;
	snapshotEl: HTMLElement;
}

const BUILTIN_SHORTCUTS_TO_REMOVE = [
	"Tab",
	"Insert",
	"Enter",
	"Shift+Tab",
	"Control+g",
	"/",
	"Del|Backspace",
	"Shift+Backspace",
	"F2",
	"Control+a",
	"Control+l",
	"Control+z",
	"Control+y",
	"Control+i",
	"Control+Up",
	"Control+Down",
	"Control+c",
	"Control+x",
	"Control+v",
	"Control+Enter"
];

const SUPPRESS_AFTER_INTERACTION_MS = 250;
const EDIT_VISIBLE_MARGIN = 24;

export class MindMapRenderer {
	private mindMap: MindMap | null = null;
	private container: HTMLElement | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private textarea: HTMLTextAreaElement | null = null;
	private editingNode: MindMapNodeInstance | null = null;
	private editingMindNode: MindNode | null = null;
	private isComposing = false;
	private destroyed = false;
	private currentMarkdown = "";
	private pendingMarkdown = "";
	private currentTree: MindTree = { roots: [] };
	private dragNextMove: {
		nodes: MindNode[];
		target: MindNode;
		mode: MoveMode;
	} | null = null;
	private dragNextPromote: MindNode | null = null;
	private nodeShortcutCleanup: (() => void) | null = null;
	private mindNodeByUid = new Map<string, MindNode>();
	private contentByUid = new Map<string, HTMLElement>();
	private pendingActiveUids: string[] = [];
	private pendingFocusUid: string | null = null;
	private pendingCenterUid: string | null = null;
	private pendingCenterAt = 0;
	private renderPending = false;
	private clickToJump = false;
	private elegantAnimation = false;
	private animationSpeed = 1;
	private animationSpring = false;
	private mindMapStyle: MindMapStyle = DEFAULT_MIND_MAP_STYLE;
	private filePath = "";
	private mapNodeRegistry: MapNodeRegistry = {};
	private nodeCount = 0;
	private animationFrameId: number | null = null;
	private pendingExpandAnimation: PendingExpandAnimation | null = null;
	private runningExpandAnimation: RunningExpandAnimation | null = null;
	private animationSnapshotEl: HTMLElement | null = null;
	private rebuildSnapshotEl: HTMLElement | null = null;
	private animationCancelHandler: ((event: Event) => void) | null = null;
	private pendingJumpTimer: number | null = null;
	private dragActive = false;
	private dragEndedAt = 0;
	private ctrlKeyDownOnNode = false;
	private lastEditEndedAt = 0;
	private restoreViewData: ReturnType<MindMap["view"]["getTransformData"]> | null =
		null;
	private initialViewState: MindMapViewState | null = null;
	private containerClickHandler: ((event: MouseEvent) => void) | null = null;
	private containerMousedownHandler: ((event: MouseEvent) => void) | null =
		null;
	private containerDblclickHandler: ((event: MouseEvent) => void) | null =
		null;
	private windowCompositionStartHandler: () => void = () => {
		this.isComposing = true;
	};
	private windowCompositionEndHandler: () => void = () => {
		this.isComposing = false;
	};
	private callbacks: MindMapRendererCallbacks = {
		onCommitText: () => undefined,
		onAddChild: () => undefined,
		onAddSibling: () => undefined,
		onDelete: () => undefined,
		onMove: () => undefined,
		onAddRoot: () => undefined
	};
	private t: (text: string) => string = (text) => text;

	async init(
		container: HTMLElement,
		markdown: string,
		callbacks: MindMapRendererCallbacks,
		viewState: MindMapViewState | null = null,
		mindMapStyle: MindMapStyle = DEFAULT_MIND_MAP_STYLE,
		options: {
			filePath?: string;
			mapNodeRegistry?: MapNodeRegistry;
		} = {}
	): Promise<void> {
		this.destroy();
		this.destroyed = false;
		this.container = container;
		this.callbacks = callbacks;
		this.mindMapStyle = resolveEffectiveMindMapStyle(mindMapStyle);
		this.filePath = options.filePath ?? "";
		this.mapNodeRegistry = options.mapNodeRegistry ?? {};
		this.currentMarkdown = markdown;
		this.pendingMarkdown = markdown;
		this.initialViewState = viewState;
		this.restoreViewData = (viewState?.transform ??
			null) as ReturnType<MindMap["view"]["getTransformData"]> | null;
		clearElement(container);

		await waitForContainerSize(container);
		if (this.destroyed) {
			return;
		}

		const markdownToUse = this.pendingMarkdown || markdown;
		this.currentMarkdown = markdownToUse;
		const tree = this.parseMarkdownForRender(markdownToUse);
		const nodeCount = countNodes(tree.roots);
		this.nodeCount = nodeCount;
		this.currentTree = tree;
		this.mindNodeByUid.clear();
		this.contentByUid.clear();
		const data = buildMindMapData(
			tree.roots,
			this.mindNodeByUid,
			viewState ? new Set(viewState.collapsed) : null
		);
		this.mindMap = new MindMap({
			el: container,
			data,
			layout: resolveRendererLayout(this.mindMapStyle.layout),
			readonly: false,
			fit: true,
			openPerformance: nodeCount >= 1000,
			isUseCustomNodeContent: true,
			customCreateNodeContent: (node) => this.createNodeContent(node),
			customQuickCreateChildBtnClick: (node) =>
				this.addChildFromQuickCreateButton(node),
			themeConfig: buildThemeConfig(container, this.mindMapStyle),
			enableShortcutOnlyWhenMouseInSvg: false,
			mousewheelAction: "move",
			enableCtrlKeyNodeSelection: true,
			customCheckEnableShortcut: (event) => {
				if (this.isComposing || this.editingNode) {
					return false;
				}
				if (document.activeElement === this.container) {
					return true;
				}
				const target = event.target as Node | null;
				return (
					target === document.body ||
					(target !== null && this.container?.contains(target) === true)
				);
			},
			beforeDragStart: (nodes) => this.onBeforeDragStart(nodes),
			beforeDragEnd: (info) => this.onBeforeDragEnd(info)
		});

		const rendererWithAdd = this.mindMap.renderer as unknown as {
			addNodeToActiveList?: (
				node: MindMapNodeInstance,
				notEmit?: boolean
			) => void;
		};
		if (rendererWithAdd.addNodeToActiveList) {
			const originalAddNode = rendererWithAdd.addNodeToActiveList.bind(
				this.mindMap.renderer
			);
			rendererWithAdd.addNodeToActiveList = (
				node: MindMapNodeInstance,
				notEmit?: boolean
			) => {
				if (!node.isRoot) {
					originalAddNode(node, notEmit);
				}
			};
		}

		this.removeBuiltinShortcuts();
		this.nodeShortcutCleanup = installNodeShortcuts(this.mindMap, {
			onAddChild: (node) => this.addChildFromShortcut(node),
			onAddSibling: (node, position) =>
				this.addSiblingFromShortcut(node, position),
			onDelete: (node) => this.deleteFromShortcut(node),
			onToggleExpand: (node) => this.toggleExpandFromShortcut(node),
			onEdit: (node) => void this.startEdit(node)
		});
		this.mindMap.keyCommand.addShortcut("Control+0", () => this.fit());
		window.addEventListener(
			"compositionstart",
			this.windowCompositionStartHandler
		);
		window.addEventListener(
			"compositionend",
			this.windowCompositionEndHandler
		);
		this.bindMindMapEvents();
		this.bindContainerClick();
		this.bindContainerDblclick();
		this.hideRootLines();
		if (this.restoreViewData && this.mindMap) {
			this.mindMap.view.setTransformData(this.restoreViewData);
		}

		this.resizeObserver = new ResizeObserver(() => {
			if (
				this.mindMap &&
				container.clientWidth > 0 &&
				container.clientHeight > 0
			) {
				this.mindMap.resize();
			}
		});
		this.resizeObserver.observe(container);
	}

	renderMarkdown(markdown: string): void {
		this.pendingMarkdown = markdown;
		if (!this.mindMap) {
			return;
		}
		this.currentMarkdown = markdown;
		let tree: MindTree;
		try {
			tree = this.parseMarkdownForRender(markdown);
		} catch (error) {
			this.reportRenderError(this.t("解析 Markdown 失败"));
			return;
		}
		this.nodeCount = countNodes(tree.roots);
		const changes = diffTreeTextChanges(this.currentTree, tree);
		if (changes === null) {
			this.cancelEdit();
			this.rebuildTree(tree);
			return;
		}
		if (changes.length === 0) {
			return;
		}
		if (
			this.editingMindNode &&
			changes.some((change) => change.uid === this.editingMindNode?.id)
		) {
			this.cancelEdit();
		}
		this.currentTree = tree;
		this.refreshMap();
		this.updateNodeTextsInMap(changes);
	}

	forceRenderMarkdown(markdown: string): void {
		this.pendingMarkdown = markdown;
		if (!this.mindMap) {
			return;
		}
		this.currentMarkdown = markdown;
		let tree: MindTree;
		try {
			tree = this.parseMarkdownForRender(markdown);
		} catch (error) {
			this.reportRenderError(this.t("解析 Markdown 失败"));
			return;
		}
		this.nodeCount = countNodes(tree.roots);
		this.cancelEdit();
		this.rebuildTree(tree);
	}

	private parseMarkdownForRender(markdown: string): MindTree {
		if (!this.filePath) {
			return parseMarkdown(markdown);
		}
		return parseMarkdownWithMapNodes(markdown, {
			filePath: this.filePath,
			registry: this.mapNodeRegistry
		});
	}

	setMapNodeRegistry(
		filePath: string,
		registry: MapNodeRegistry,
		markdown = this.currentMarkdown
	): void {
		this.filePath = filePath;
		this.mapNodeRegistry = registry;
		if (markdown) {
			this.renderMarkdown(markdown);
		}
	}

	hasRenderedRoots(): boolean {
		return this.currentTree.roots.length > 0;
	}

	waitForRenderEnd(timeoutMs = 1000): Promise<void> {
		if (!this.mindMap || !this.renderPending) {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			const startedAt = Date.now();
			const check = (): void => {
				if (
					this.destroyed ||
					!this.renderPending ||
					Date.now() - startedAt >= timeoutMs
				) {
					resolve();
					return;
				}
				requestAnimationFrame(check);
			};
			check();
		});
	}

	fit(): void {
		if (this.mindMap) {
			this.mindMap.resize();
			this.mindMap.view.fit();
		}
	}

	centerNode(uid: string): void {
		if (!this.mindMap || !this.container) {
			this.pendingCenterUid = uid;
			this.pendingCenterAt = Date.now();
			return;
		}
		const node = this.mindMap.renderer.findNodeByUid(uid);
		if (!node) {
			this.pendingCenterUid = uid;
			this.pendingCenterAt = Date.now();
			return;
		}
		const rect = this.readNodeRect(node);
		const containerRect = this.container.getBoundingClientRect();
		if (!rect || !isUsableRect(rect)) {
			this.pendingCenterUid = uid;
			this.pendingCenterAt = Date.now();
			return;
		}
		this.pendingCenterUid = null;
		const { dx, dy } = computeCenterTranslation(
			{
				left: rect.left,
				top: rect.top,
				width: rect.width,
				height: rect.height
			},
			{
				left: containerRect.left,
				top: containerRect.top,
				width: containerRect.width,
				height: containerRect.height
			}
		);
		this.mindMap.view.translateXY(dx, dy);
	}

	private resolvePendingCenter(): void {
		if (this.pendingCenterUid === null || !this.mindMap || !this.container) {
			return;
		}
		if (Date.now() - this.pendingCenterAt > 1000) {
			this.pendingCenterUid = null;
			this.fit();
			return;
		}
		const uid = this.pendingCenterUid;
		const node = this.mindMap.renderer.findNodeByUid(uid);
		const rect = node ? this.readNodeRect(node) : null;
		if (!node || !rect || !isUsableRect(rect)) {
			return;
		}
		this.pendingCenterUid = null;
		const containerRect = this.container.getBoundingClientRect();
		const { dx, dy } = computeCenterTranslation(
			{
				left: rect.left,
				top: rect.top,
				width: rect.width,
				height: rect.height
			},
			{
				left: containerRect.left,
				top: containerRect.top,
				width: containerRect.width,
				height: containerRect.height
			}
		);
		this.mindMap.view.translateXY(dx, dy);
	}

	focusMap(): void {
		this.container?.focus();
	}

	activateNode(uid: string): boolean {
		return this.activateNodeByUid(uid);
	}

	focusNodeAndEdit(uid: string): void {
		if (!this.mindMap) {
			return;
		}
		const node = this.mindMap.renderer.findNodeByUid(uid);
		const strategy = resolveFocusStrategy({
			renderPending: this.renderPending,
			nodeFound: node != null,
			isRoot: node?.isRoot === true
		});
		if (strategy === "defer") {
			this.pendingFocusUid = uid;
			return;
		}
		this.pendingFocusUid = null;
		if (strategy === "edit-now" && node) {
			this.activateNodeByUid(uid);
			void this.startEdit(node);
		}
	}

	captureViewState(): MindMapViewState | null {
		if (!this.mindMap || !this.mindMap.renderer.root) {
			return null;
		}
		const collapsedUids = new Set<string>();
		collectCollapsedUids(this.mindMap.renderer.root, collapsedUids);
		return {
			collapsed: [...collapsedUids],
			transform: this.mindMap.view.getTransformData(),
			lastOpened: Date.now()
		};
	}

	setClickToJump(enabled: boolean): void {
		this.clickToJump = enabled;
		if (!enabled) {
			this.clearPendingJump();
		}
	}

	setElegantAnimation(enabled: boolean): void {
		this.elegantAnimation = enabled;
		if (!enabled) {
			this.cancelAnimation();
		}
	}

	setTranslate(t: (text: string) => string): void {
		this.t = t;
	}

	setElegantAnimationOptions(speed: number, spring: boolean): void {
		this.animationSpeed = speed;
		this.animationSpring = spring;
	}

	applyMindMapStyle(style: MindMapStyle): void {
		const nextStyle = resolveEffectiveMindMapStyle(style);
		if (!this.mindMap) {
			this.mindMapStyle = nextStyle;
			return;
		}
		const container = this.container ?? this.mindMap.el;
		const themeConfig = buildThemeConfig(container, nextStyle);
		const previousLayout = this.mindMapStyle.layout;
		this.mindMapStyle = nextStyle;
		if (previousLayout !== nextStyle.layout) {
			this.restoreViewData = null;
			this.mindMap.setThemeConfig(themeConfig, true);
			this.mindMap.setLayout(resolveRendererLayout(nextStyle.layout), true);
			this.mindMap.render(() => {
				if (this.mindMap) {
					this.mindMap.resize();
					this.mindMap.view.fit();
				}
			}, "CHANGE_LAYOUT");
			return;
		}
		this.mindMap.setThemeConfig(themeConfig);
	}

	destroy(): void {
		this.destroyed = true;
		this.clearPendingJump();
		this.cancelAnimation();
		this.removeRebuildSnapshot();
		this.dragActive = false;
		this.dragEndedAt = 0;
		this.cancelEdit();
		window.removeEventListener(
			"compositionstart",
			this.windowCompositionStartHandler
		);
		window.removeEventListener(
			"compositionend",
			this.windowCompositionEndHandler
		);
		this.nodeShortcutCleanup?.();
		this.nodeShortcutCleanup = null;
		this.dragNextMove = null;
		this.dragNextPromote = null;
		this.pendingActiveUids = [];
		this.pendingFocusUid = null;
		this.pendingCenterUid = null;
		this.pendingCenterAt = 0;
		this.renderPending = false;
		this.restoreViewData = null;
		this.initialViewState = null;
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
		if (this.containerClickHandler && this.container) {
			this.container.removeEventListener(
				"click",
				this.containerClickHandler,
				true
			);
			this.containerClickHandler = null;
		}
		if (this.containerMousedownHandler && this.container) {
			this.container.removeEventListener(
				"mousedown",
				this.containerMousedownHandler,
				true
			);
			this.containerMousedownHandler = null;
		}
		if (this.containerDblclickHandler && this.container) {
			this.container.removeEventListener(
				"dblclick",
				this.containerDblclickHandler
			);
			this.containerDblclickHandler = null;
		}
		if (this.mindMap) {
			this.mindMap.destroy();
			this.mindMap = null;
		}
		this.mindNodeByUid.clear();
		this.contentByUid.clear();
		this.container = null;
	}

	private createNodeContent(node: MindMapNodeInstance): HTMLElement {
		const el = document.createElement("div");
		el.className = "outline-mindmap-node-content";
		if (node.isRoot) {
			el.style.minWidth = "1px";
			el.style.minHeight = "1px";
			return el;
		}

		const text = String(node.getData("text") ?? "");
		el.innerHTML = renderInlineMarkdown(text);
		el.title = text;
		this.contentByUid.set(String(node.getData("uid") ?? ""), el);

		const mindNode = this.mindNodeByUid.get(String(node.getData("uid") ?? ""));
		if (mindNode) {
			el.classList.add(
				mindNode.type === "heading" ? "is-heading" : "is-list"
			);
		}
		if (node.layerIndex <= 1) {
			el.classList.add("is-first-level");
		}
		return el;
	}

	private refreshTree(tree: MindTree): void {
		if (!this.mindMap) {
			return;
		}
		const collapsedUids = new Set<string>();
		if (this.mindMap.renderer.root) {
			collectCollapsedUids(this.mindMap.renderer.root, collapsedUids);
			this.restoreViewData = this.mindMap.view.getTransformData();
		}
		this.currentTree = tree;
		this.mindNodeByUid.clear();
		this.contentByUid.clear();
		const data = buildMindMapData(
			tree.roots,
			this.mindNodeByUid,
			collapsedUids
		);
		this.createRebuildSnapshot();
		try {
			this.mindMap.setData(data);
			this.renderPending = true;
			this.hideRootLines();
		} catch (error) {
			this.removeRebuildSnapshot();
			this.pendingActiveUids = [];
			this.renderPending = false;
			this.reportRenderError(this.t("渲染思维导图失败"));
		}
	}

	private rebuildTree(tree: MindTree): void {
		if (!this.mindMap) {
			return;
		}
		this.pendingActiveUids = this.mindMap.renderer.activeNodeList
			.map((node) => String(node.getData("uid") ?? ""))
			.filter((uid) => uid !== "");
		this.refreshTree(tree);
	}

	private updateNodeTextInMap(uid: string, newText: string): boolean {
		if (!this.mindMap) {
			return false;
		}
		const node = this.mindMap.renderer.findNodeByUid(uid);
		if (!node || node.isRoot) {
			return false;
		}
		node.setData({ text: newText });
		const content = this.contentByUid.get(uid);
		if (content) {
			content.innerHTML = renderInlineMarkdown(newText);
			content.title = newText;
		}
		this.refreshCustomNodeContents([node]);
		return true;
	}

	private updateNodeTextsInMap(
		changes: Array<{ uid: string; newText: string }>
	): void {
		if (!this.mindMap) {
			return;
		}
		const touchedNodes: MindMapNodeInstance[] = [];
		for (const change of changes) {
			const node = this.mindMap.renderer.findNodeByUid(change.uid);
			if (!node || node.isRoot) {
				continue;
			}
			node.setData({ text: change.newText });
			const content = this.contentByUid.get(change.uid);
			if (content) {
				content.innerHTML = renderInlineMarkdown(change.newText);
				content.title = change.newText;
			}
			touchedNodes.push(node);
		}
		this.refreshCustomNodeContents(touchedNodes);
	}

	private refreshCustomNodeContents(
		nodes: MindMapNodeInstance[]
	): void {
		if (!this.mindMap || nodes.length === 0) {
			return;
		}
		for (const node of nodes) {
			node.getSize();
			node.customNodeContentRealtimeLayout();
		}
		this.mindMap.render();
	}

	private restoreActiveNodes(): void {
		if (!this.mindMap || this.pendingActiveUids.length === 0) {
			return;
		}
		const uids = this.pendingActiveUids;
		this.pendingActiveUids = [];
		const nodes = uids
			.map((uid) => this.mindMap?.renderer.findNodeByUid(uid))
			.filter(
				(node): node is MindMapNodeInstance =>
					node != null && !node.isRoot
			);
		if (nodes.length > 0) {
			this.mindMap.renderer.activeMultiNode(nodes);
		}
	}

	private resolvePendingFocus(): void {
		if (this.pendingFocusUid === null || !this.mindMap) {
			return;
		}
		const uid = this.pendingFocusUid;
		const node = this.mindMap.renderer.findNodeByUid(uid);
		if (!node) {
			return;
		}
		if (node.isRoot) {
			this.pendingFocusUid = null;
			return;
		}
		this.pendingFocusUid = null;
		this.activateNodeByUid(uid);
		void this.startEdit(node);
	}

	private refreshMap(): void {
		this.mindNodeByUid.clear();
		for (const root of this.currentTree.roots) {
			walkTree(root, (node) => {
				this.mindNodeByUid.set(node.id, node);
			});
		}
	}

	private reportRenderError(message: string): void {
		this.callbacks.onRenderError?.(message);
	}

	private removeBuiltinShortcuts(): void {
		if (!this.mindMap) {
			return;
		}
		for (const shortcut of BUILTIN_SHORTCUTS_TO_REMOVE) {
			this.mindMap.keyCommand.removeShortcut(shortcut);
		}
	}

	private bindMindMapEvents(): void {
		if (!this.mindMap) {
			return;
		}
		this.mindMap.on("node_click", (node: MindMapNodeInstance, e: MouseEvent) =>
			this.onNodeClick(node, e)
		);
		this.mindMap.on("node_active", () => {
			this.filterRootNodesFromActiveList();
		});
		this.mindMap.on(
			"node_mousedown",
			(_node: MindMapNodeInstance, e: MouseEvent) => {
				this.ctrlKeyDownOnNode = e.ctrlKey || e.metaKey;
			}
		);
		this.mindMap.on("node_mouseup", () => {
			this.ctrlKeyDownOnNode = false;
		});
		this.mindMap.on("expand_btn_click", (node: MindMapNodeInstance) =>
			this.onExpandButtonClick(node)
		);
		this.mindMap.on("node_dblclick", (node: MindMapNodeInstance, e: MouseEvent) => {
			if (e.ctrlKey || e.metaKey) {
				return;
			}
			this.clearPendingJump();
			if (!node.isRoot) {
				void this.startEdit(node);
			}
		});
		this.mindMap.on("draw_click", () => {
			this.clearPendingJump();
			this.finishEdit(true);
		});
		this.mindMap.on("svg_mousedown", () => {
			this.clearPendingJump();
			this.finishEdit(true);
		});
		this.mindMap.on("node_dragging", () => {
			this.dragActive = true;
			this.clearPendingJump();
		});
		this.mindMap.on("node_tree_render_end", () => {
			this.renderPending = false;
			this.hideRootLines();
			this.removeRebuildSnapshot();
			if (this.restoreViewData && this.mindMap) {
				const viewData = this.restoreViewData;
				this.restoreViewData = null;
				this.mindMap.view.setTransformData(viewData);
			}
			this.restoreActiveNodes();
			this.resolvePendingCenter();
			this.resolvePendingFocus();
			this.runPendingExpandAnimation();
		});
		this.mindMap.on("node_dragend", (info: {
			overlapNodeUid: string;
			prevNodeUid: string;
			nextNodeUid: string;
		}) => this.onNodeDragEnd(info));
	}

	private filterRootNodesFromActiveList(): void {
		if (!this.mindMap) {
			return;
		}
		const roots = this.mindMap.renderer.activeNodeList.filter(
			(node) => node.isRoot
		);
		for (const root of roots) {
			this.mindMap.renderer.removeNodeFromActiveList(root);
		}
	}

	private onNodeClick(node: MindMapNodeInstance, e: MouseEvent): void {
		this.clearPendingJump();
		if (node.isRoot) {
			return;
		}
		if (e.ctrlKey || e.metaKey) {
			return;
		}
		const mindNode = this.mindNodeByUid.get(
			String(node.getData("uid") ?? "")
		);
		if (!mindNode) {
			return;
		}
		const target = e.target as HTMLElement | null;
		const isLink = target?.closest?.("a") != null;
		const now = Date.now();
		const isEditing =
			this.editingNode !== null ||
			now - this.lastEditEndedAt < SUPPRESS_AFTER_INTERACTION_MS;
		const isDragging =
			this.dragActive ||
			now - this.dragEndedAt < SUPPRESS_AFTER_INTERACTION_MS;
		if (
			!shouldTriggerJump({
				clickToJump: this.clickToJump,
				isEditing,
				isDragging,
				isLink
			})
		) {
			return;
		}
		this.pendingJumpTimer = window.setTimeout(() => {
			this.pendingJumpTimer = null;
			this.callbacks.onLocateNode?.(mindNode);
		}, JUMP_DELAY_MS);
	}

	private clearPendingJump(): void {
		if (this.pendingJumpTimer !== null) {
			window.clearTimeout(this.pendingJumpTimer);
			this.pendingJumpTimer = null;
		}
	}

	private bindContainerClick(): void {
		if (!this.container) {
			return;
		}
		this.containerClickHandler = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			const link = target?.closest?.("a");
			if (!link) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			const note = link.getAttribute("data-note");
			if (note) {
				this.callbacks.onOpenLink?.(note);
				return;
			}
			const href = link.getAttribute("href");
			if (href) {
				window.open(href, "_blank", "noopener");
			}
		};
		this.container.addEventListener("click", this.containerClickHandler, true);
		this.containerMousedownHandler = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			if (target?.closest?.("a")) {
				event.stopPropagation();
			}
		};
		this.container.addEventListener(
			"mousedown",
			this.containerMousedownHandler,
			true
		);
	}

	private bindContainerDblclick(): void {
		if (!this.container) {
			return;
		}
		this.containerDblclickHandler = (event: MouseEvent) => {
			if (
				this.editingNode ||
				Date.now() - this.lastEditEndedAt < SUPPRESS_AFTER_INTERACTION_MS
			) {
				return;
			}
			const target = event.target as HTMLElement | null;
			if (!target) {
				return;
			}
			if (target.closest(".smm-node")) {
				return;
			}
			if (target.closest("textarea") || target.closest("a")) {
				return;
			}
			this.clearPendingJump();
			this.callbacks.onAddRoot?.();
		};
		this.container.addEventListener(
			"dblclick",
			this.containerDblclickHandler
		);
	}

	private onBeforeDragStart(nodes: MindMapNodeInstance[]): boolean {
		if (
			this.editingNode ||
			nodes.length === 0 ||
			nodes[0].isRoot ||
			this.ctrlKeyDownOnNode
		) {
			return true;
		}
		this.dragActive = true;
		this.clearPendingJump();
		return false;
	}

	private onBeforeDragEnd(info: {
		overlapNodeUid: string;
		prevNodeUid: string;
		nextNodeUid: string;
		beingDragNodeList: MindMapNodeInstance[];
	}): boolean {
		this.dragNextPromote = null;
		this.dragNextMove = null;
		const draggedNodes = info.beingDragNodeList
			.map((node) =>
				this.mindNodeByUid.get(String(node.getData("uid") ?? ""))
			)
			.filter((node): node is MindNode => node != null);
		if (
			draggedNodes.length === 0 ||
			info.beingDragNodeList.some((node) => node.isRoot)
		) {
			return false;
		}
		const resolution = this.resolveDragMove(draggedNodes, info);
		if (!resolution.move) {
			if (resolution.invalid) {
				this.markInvalidDrag();
			}
			return resolution.invalid;
		}
		this.dragNextMove = resolution.move;
		return false;
	}

	private resolveDragMove(
		draggedNodes: MindNode[],
		info: {
			overlapNodeUid: string;
			prevNodeUid: string;
			nextNodeUid: string;
		}
	): DragResolution {
		let mode: MoveMode | null = null;
		let targetUid = "";
		if (info.overlapNodeUid) {
			mode = "child";
			targetUid = info.overlapNodeUid;
		} else if (info.prevNodeUid) {
			mode = "after";
			targetUid = info.prevNodeUid;
		} else if (info.nextNodeUid) {
			mode = "before";
			targetUid = info.nextNodeUid;
		}
		if (!mode || !targetUid) {
			if (
				draggedNodes.length === 1 &&
				resolveBlankDropAction(
					draggedNodes[0].type,
					draggedNodes[0].level
				) === "promote"
			) {
				this.dragNextPromote = draggedNodes[0];
			}
			return { move: null, invalid: false };
		}

		const target = this.mindNodeByUid.get(targetUid);
		if (!target) {
			return { move: null, invalid: false };
		}
		if (!canMoveNodes(this.currentMarkdown, draggedNodes, target, mode)) {
			return { move: null, invalid: true };
		}
		return { move: { nodes: draggedNodes, target, mode }, invalid: false };
	}

	private onNodeDragEnd(info: {
		overlapNodeUid: string;
		prevNodeUid: string;
		nextNodeUid: string;
	}): void {
		this.dragActive = false;
		this.dragEndedAt = Date.now();
		this.clearPendingJump();
		const promoteNode = this.dragNextPromote;
		this.dragNextPromote = null;
		if (promoteNode) {
			void this.callbacks.onPromoteToRoot?.(promoteNode);
			return;
		}
		const move = this.dragNextMove;
		this.dragNextMove = null;
		if (move) {
			void this.callbacks.onMove(move.nodes, move.target, move.mode);
		}
	}

	private markInvalidDrag(): void {
		this.container?.classList.add("is-invalid-drag");
		window.setTimeout(() => {
			this.container?.classList.remove("is-invalid-drag");
		}, 250);
	}

	private addChildFromShortcut(node: MindMapNodeInstance): void {
		this.addChildFromMindMapNode(node);
	}

	private addChildFromQuickCreateButton(node: MindMapNodeInstance): void {
		this.addChildFromMindMapNode(node);
	}

	private addChildFromMindMapNode(node: MindMapNodeInstance): void {
		const mindNode = this.mindNodeByUid.get(
			String(node.getData("uid") ?? "")
		);
		if (mindNode) {
			void this.callbacks.onAddChild(mindNode);
		}
	}

	private addSiblingFromShortcut(
		node: MindMapNodeInstance,
		position: InsertPosition
	): void {
		const mindNode = this.mindNodeByUid.get(
			String(node.getData("uid") ?? "")
		);
		if (mindNode) {
			void this.callbacks.onAddSibling(mindNode, position);
		}
	}

	private deleteFromShortcut(nodes: MindMapNodeInstance[]): void {
		const mindNodes = nodes
			.map((node) =>
				this.mindNodeByUid.get(String(node.getData("uid") ?? ""))
			)
			.filter((node): node is MindNode => node != null);
		if (mindNodes.length > 0) {
			void this.callbacks.onDelete(mindNodes);
		}
	}

	private toggleExpandFromShortcut(node: MindMapNodeInstance): void {
		if (!this.mindMap || node.children.length === 0) {
			return;
		}
		this.toggleNodeExpand(node, !node.getData("expand"));
	}

	private onExpandButtonClick(node: MindMapNodeInstance): void {
		if (
			!this.elegantAnimation ||
			this.animationFrameId !== null ||
			this.pendingExpandAnimation
		) {
			return;
		}
		this.captureExpandAnimation(node, node.getData("expand") !== false);
	}

	private toggleNodeExpand(
		node: MindMapNodeInstance,
		expand: boolean
	): void {
		if (!this.mindMap) {
			return;
		}
		if (
			!this.elegantAnimation ||
			this.animationFrameId !== null ||
			this.pendingExpandAnimation ||
			shouldDegradeAnimation(
				this.nodeCount,
				this.mindMap.opt.openPerformance === true
			)
		) {
			this.mindMap.execCommand("SET_NODE_EXPAND", node, expand);
			return;
		}
		this.captureExpandAnimation(node, expand);
		this.mindMap.execCommand("SET_NODE_EXPAND", node, expand);
	}

	private captureExpandAnimation(
		node: MindMapNodeInstance,
		expand: boolean
	): void {
		if (!this.mindMap || !this.mindMap.renderer.root) {
			return;
		}
		const oldView = this.mindMap.view.getTransformData();
		if (!isViewTransformData(oldView)) {
			return;
		}
		this.pendingExpandAnimation = {
			node,
			expand,
			oldPositions: this.collectNodePositions(
				this.mindMap.renderer.root
			),
			oldView
		};
		this.createAnimationSnapshot();
		this.bindAnimationCancel();
	}

	private collectNodePositions(
		root: MindMapNodeInstance
	): Map<string, NodePosition> {
		const positions = new Map<string, NodePosition>();
		const visit = (node: MindMapNodeInstance): void => {
			const uid = String(node.getData("uid") ?? "");
			if (uid) {
				positions.set(uid, { left: node.left, top: node.top });
			}
			if (node.getData("expand") !== false) {
				for (const child of node.children) {
					visit(child);
				}
			}
		};
		visit(root);
		return positions;
	}

	private runPendingExpandAnimation(): void {
		const pending = this.pendingExpandAnimation;
		if (!pending || !this.mindMap || !this.mindMap.renderer.root) {
			return;
		}
		this.pendingExpandAnimation = null;
		const toView = this.computeTargetViewport(pending.node, pending.expand);
		if (!toView) {
			this.finishAnimation();
			return;
		}
		const newPositions = this.collectNodePositions(
			this.mindMap.renderer.root
		);
		const motions = this.buildNodeMotions(
			pending.oldPositions,
			newPositions
		);
		this.animationSnapshotEl =
			this.animationSnapshotEl ?? this.createAnimationSnapshot();
		const snapshotEl = this.animationSnapshotEl;
		const easing = this.animationSpring ? easeOutSpring : easeOutCubic;
		const distance = getAnimationDistance(
			pending.oldView.state,
			toView.state
		);
		this.runningExpandAnimation = {
			fromView: pending.oldView,
			toView,
			motions,
			startedAt: performance.now(),
			duration: getAnimationDuration(this.nodeCount, {
				speed: this.animationSpeed,
				distance
			}),
			easing,
			snapshotEl: snapshotEl ?? document.createElement("div")
		};
		this.animationFrameId = requestAnimationFrame(() =>
			this.animateFrame()
		);
	}

	private computeTargetViewport(
		node: MindMapNodeInstance,
		expand: boolean
	): ViewTransformData | null {
		if (!this.mindMap) {
			return null;
		}
		const current = this.mindMap.view.getTransformData();
		if (!isViewTransformData(current)) {
			return null;
		}
		if (!this.container) {
			return current;
		}
		const anchorRect: AnimationBoundsRect = {
			x: node.left,
			y: node.top,
			width: node.width,
			height: node.height,
			x2: node.left + node.width,
			y2: node.top + node.height
		};
		const state = resolveAnimationTargetViewport(
			current.state,
			current.state,
			anchorRect,
			null,
			expand,
			{
				viewportWidth: this.container.clientWidth,
				viewportHeight: this.container.clientHeight,
				padding: ELEGANT_ANIMATION_PADDING
			}
		);
		return { ...current, state };
	}

	private buildNodeMotions(
		oldPositions: Map<string, NodePosition>,
		newPositions: Map<string, NodePosition>
	): NodeMotion[] {
		const motions: NodeMotion[] = [];
		if (!this.mindMap) {
			return motions;
		}
		for (const [uid, to] of newPositions) {
			const node = this.mindMap.renderer.findNodeByUid(uid);
			if (!node) {
				continue;
			}
			const from = oldPositions.get(uid);
			if (from) {
				this.setNodeGroupPosition(node, from.left, from.top);
				node.group.opacity(1);
				motions.push({
					node,
					from,
					to,
					appeared: false
				});
				continue;
			}
			const parent = node.parent;
			const parentUid = parent ? String(parent.getData("uid") ?? "") : "";
			const parentPosition = parent
				? newPositions.get(parentUid)
				: undefined;
			const start = parentPosition ?? to;
			this.setNodeGroupPosition(node, start.left, start.top);
			node.group.opacity(0);
			motions.push({
				node,
				from: start,
				to,
				appeared: true
			});
		}
		return motions;
	}

	private setNodeGroupPosition(
		node: MindMapNodeInstance,
		left: number,
		top: number
	): void {
		node.group.transform({ translate: [left, top] });
	}

	private createAnimationSnapshot(): HTMLElement | null {
		if (!this.container || this.animationSnapshotEl) {
			return this.animationSnapshotEl;
		}
		const svg = this.container.querySelector("svg");
		if (!svg) {
			return null;
		}
		const clone = svg.cloneNode(true) as SVGSVGElement;
		const el = document.createElement("div");
		el.className = "outline-mindmap-animation-snapshot";
		el.appendChild(clone);
		this.container.appendChild(el);
		this.animationSnapshotEl = el;
		return el;
	}

	private createRebuildSnapshot(): void {
		if (!this.container || this.rebuildSnapshotEl) {
			return;
		}
		const svg = this.container.querySelector("svg");
		if (!svg) {
			return;
		}
		const clone = svg.cloneNode(true) as SVGSVGElement;
		const el = document.createElement("div");
		el.className = "outline-mindmap-animation-snapshot";
		el.appendChild(clone);
		this.container.appendChild(el);
		this.rebuildSnapshotEl = el;
	}

	private removeRebuildSnapshot(): void {
		if (this.rebuildSnapshotEl) {
			this.rebuildSnapshotEl.remove();
			this.rebuildSnapshotEl = null;
		}
	}

	private animateFrame(): void {
		const animation = this.runningExpandAnimation;
		if (!animation || !this.mindMap) {
			this.finishAnimation();
			return;
		}
		const elapsed = performance.now() - animation.startedAt;
		const progress = Math.min(1, elapsed / animation.duration);
		const eased = animation.easing(progress);
		const opacity = Math.max(0, Math.min(1, eased));
		const state = interpolateViewStateWithEasing(
			animation.fromView.state,
			animation.toView.state,
			progress,
			animation.easing
		);
		this.applyViewState(state);
		for (const motion of animation.motions) {
			const left = interpolateNumberWithEasing(
				motion.from.left,
				motion.to.left,
				progress,
				animation.easing
			);
			const top = interpolateNumberWithEasing(
				motion.from.top,
				motion.to.top,
				progress,
				animation.easing
			);
			this.setNodeGroupPosition(motion.node, left, top);
			if (motion.appeared) {
				motion.node.group.opacity(opacity);
			}
		}
		if (animation.snapshotEl) {
			animation.snapshotEl.style.opacity = String(
				Math.max(0, Math.min(1, 1 - eased))
			);
		}
		if (progress < 1) {
			this.animationFrameId = requestAnimationFrame(() =>
				this.animateFrame()
			);
		} else {
			this.finishAnimation();
		}
	}

	private applyViewState(state: ViewTransformState): void {
		if (!this.mindMap) {
			return;
		}
		this.mindMap.view.setTransformData({
			state,
			transform: {
				origin: [0, 0],
				scale: state.scale,
				translate: [state.x, state.y]
			}
		});
	}

	private finishAnimation(): void {
		const animation = this.runningExpandAnimation;
		if (animation && this.mindMap) {
			this.applyViewState(animation.toView.state);
			for (const motion of animation.motions) {
				this.setNodeGroupPosition(
					motion.node,
					motion.to.left,
					motion.to.top
				);
				motion.node.group.opacity(1);
			}
		}
		if (this.animationFrameId !== null) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}
		this.removeAnimationSnapshot();
		this.unbindAnimationCancel();
		this.runningExpandAnimation = null;
		this.pendingExpandAnimation = null;
	}

	private cancelAnimation(): void {
		this.finishAnimation();
	}

	private removeAnimationSnapshot(): void {
		if (this.animationSnapshotEl) {
			this.animationSnapshotEl.remove();
			this.animationSnapshotEl = null;
		}
	}

	private bindAnimationCancel(): void {
		if (this.animationCancelHandler || !this.container) {
			return;
		}
		this.animationCancelHandler = () => this.finishAnimation();
		this.container.addEventListener(
			"mousedown",
			this.animationCancelHandler,
			true
		);
		this.container.addEventListener(
			"wheel",
			this.animationCancelHandler
		);
		this.container.addEventListener(
			"dblclick",
			this.animationCancelHandler
		);
		window.addEventListener("keydown", this.animationCancelHandler);
	}

	private unbindAnimationCancel(): void {
		if (!this.animationCancelHandler || !this.container) {
			this.animationCancelHandler = null;
			return;
		}
		const handler = this.animationCancelHandler;
		this.container.removeEventListener("mousedown", handler, true);
		this.container.removeEventListener("wheel", handler);
		this.container.removeEventListener("dblclick", handler);
		window.removeEventListener("keydown", handler);
		this.animationCancelHandler = null;
	}

	private activateNodeByUid(uid: string): boolean {
		if (!this.mindMap) {
			return false;
		}
		const node = this.mindMap.renderer.findNodeByUid(uid);
		if (!node || node.isRoot) {
			return false;
		}
		node.active();
		return true;
	}

	private hideRootLines(): void {
		if (!this.mindMap) {
			return;
		}
		const root = this.mindMap.renderer.root;
		if (!root) {
			return;
		}
		const lines = (
			root as unknown as {
				_lines?: Array<{ addClass(className: string): void }>;
			}
		)._lines;
		if (!lines) {
			return;
		}
		for (const line of lines) {
			line.addClass("outline-mindmap-root-line");
		}
	}

	private ensureEditorVisible(
		node: MindMapNodeInstance,
		editorWidth: number,
		editorHeight: number
	): void {
		if (!this.mindMap || !this.container) {
			return;
		}
		const containerRect = this.container.getBoundingClientRect();
		for (let attempt = 0; attempt < 2; attempt++) {
			const nodeRect = this.readNodeRect(node);
			if (!nodeRect) {
				return;
			}
			const editorRect = {
				left: nodeRect.left,
				top: nodeRect.top,
				right: nodeRect.left + editorWidth,
				bottom: nodeRect.top + editorHeight
			};
			const anchorRect = this.readParentAnchorRect(node);
			const { dx, dy } = computePanDeltaForEditor(
				nodeRect,
				editorRect,
				anchorRect,
				containerRect,
				EDIT_VISIBLE_MARGIN
			);
			if (dx === 0 && dy === 0) {
				return;
			}
			this.mindMap.view.translateXY(dx, dy);
		}
		this.ensureNodeVisibleAfterEditorConflict(
			node,
			editorWidth,
			editorHeight,
			containerRect
		);
	}

	private ensureNodeVisibleAfterEditorConflict(
		node: MindMapNodeInstance,
		editorWidth: number,
		editorHeight: number,
		containerRect: DOMRect
	): void {
		const nodeRect = this.readNodeRect(node);
		if (!nodeRect || !this.mindMap) {
			return;
		}
		if (!isRectOutside(
			nodeRect,
			containerRect,
			EDIT_VISIBLE_MARGIN
		)) {
			return;
		}

		const targetRect = node.getRect();
		if (!targetRect) {
			return;
		}
		this.mindMap.view.fit(
			() => targetRect,
			false,
			EDIT_VISIBLE_MARGIN
		);

		for (let attempt = 0; attempt < 2; attempt++) {
			const nextNodeRect = this.readNodeRect(node);
			if (!nextNodeRect) {
				return;
			}
			const editorRect = {
				left: nextNodeRect.left,
				top: nextNodeRect.top,
				right: nextNodeRect.left + editorWidth,
				bottom: nextNodeRect.top + editorHeight
			};
			const anchorRect = this.readParentAnchorRect(node);
			const { dx, dy } = computePanDeltaForEditor(
				nextNodeRect,
				editorRect,
				anchorRect,
				containerRect,
				EDIT_VISIBLE_MARGIN
			);
			if (dx === 0 && dy === 0) {
				return;
			}
			this.mindMap.view.translateXY(dx, dy);
		}
	}

	private readNodeRect(node: MindMapNodeInstance): DOMRect | null {
		if (!this.mindMap) {
			return null;
		}
		let rect = node.group.node.getBoundingClientRect();
		if (!isUsableRect(rect)) {
			this.mindMap.renderer.forceLoadNode(node);
			rect = node.group.node.getBoundingClientRect();
		}
		return isUsableRect(rect) ? rect : null;
	}

	private readParentAnchorRect(
		node: MindMapNodeInstance
	): { left: number; top: number; right: number; bottom: number } | null {
		if (!node.parent || node.parent.isRoot) {
			return null;
		}
		const rect = this.readNodeRect(node.parent);
		return rect
			? {
					left: rect.left,
					top: rect.top,
					right: rect.right,
					bottom: rect.bottom
				}
			: null;
	}

	private async startEdit(node: MindMapNodeInstance): Promise<void> {
		if (!this.mindMap || !this.container) {
			return;
		}
		if (this.editingNode) {
			await this.finishEdit(true);
		}
		if (this.destroyed || !this.mindMap || !this.container) {
			return;
		}
		const current = this.mindMap.renderer.findNodeByUid(
			String(node.getData("uid") ?? "")
		);
		if (!current) {
			return;
		}
		node = current;
		const mindNode = this.mindNodeByUid.get(String(node.getData("uid") ?? ""));
		if (!mindNode) {
			return;
		}

		const initialNodeRect =
			this.readNodeRect(node) ?? {
				left: 0,
				top: 0,
				right: 0,
				bottom: 0,
				width: 0,
				height: 0
			};
		const containerRect = this.container.getBoundingClientRect();
		const scale = this.mindMap.view.scale || 1;
		const maxEditorWidth = Math.max(
			80,
			containerRect.width - EDIT_VISIBLE_MARGIN * 2
		);
		const maxEditorHeight = Math.max(
			36,
			containerRect.height - EDIT_VISIBLE_MARGIN * 2
		);
		const textareaWidth = Math.min(
			Math.max(initialNodeRect.width + 12, 180),
			maxEditorWidth
		);
		const textareaHeight = Math.min(
			Math.max(initialNodeRect.height + 14, 36),
			maxEditorHeight
		);

		this.ensureEditorVisible(node, textareaWidth, textareaHeight);

		const nodeRect = this.readNodeRect(node) ?? initialNodeRect;
		const textareaPosition = clampToContainer(
			nodeRect.left - containerRect.left,
			nodeRect.top - containerRect.top,
			textareaWidth,
			textareaHeight,
			containerRect.width,
			containerRect.height
		);

		const textarea = document.createElement("textarea");
		textarea.className = "outline-mindmap-text-editor";
		textarea.value = String(node.getData("text") ?? "");
		textarea.spellcheck = false;
		textarea.setAttribute("autocorrect", "off");
		textarea.setAttribute("autocapitalize", "off");
		textarea.style.left = `${textareaPosition.left}px`;
		textarea.style.top = `${textareaPosition.top}px`;
		textarea.style.width = `${textareaWidth}px`;
		textarea.style.height = `${textareaHeight}px`;
		textarea.style.fontSize = `${14 * scale}px`;
		textarea.style.lineHeight = `${1.4 * scale}px`;
		textarea.addEventListener("input", () =>
			this.updateEditorVerticalAlignment(textarea, textareaHeight, scale)
		);
		textarea.addEventListener("keydown", (event) =>
			this.onEditorKeydown(event)
		);
		textarea.addEventListener("compositionstart", () => {
			this.isComposing = true;
		});
		textarea.addEventListener("compositionend", () => {
			this.isComposing = false;
		});
		textarea.addEventListener("blur", () => this.finishEdit(true));

		this.container.appendChild(textarea);
		this.textarea = textarea;
		this.editingNode = node;
		this.editingMindNode = mindNode;
		this.isComposing = false;
		this.updateEditorVerticalAlignment(textarea, textareaHeight, scale);
		this.focusTextarea(textarea);
		textarea.select();
	}

	private focusTextarea(textarea: HTMLTextAreaElement): void {
		let attempts = 0;
		const retry = (): void => {
			if (this.textarea !== textarea) {
				return;
			}
			if (document.activeElement === textarea) {
				return;
			}
			textarea.focus();
			if (attempts < 4) {
				attempts++;
				requestAnimationFrame(retry);
			}
		};
		textarea.focus();
		retry();
	}

	private updateEditorVerticalAlignment(
		textarea: HTMLTextAreaElement,
		height: number,
		scale: number
	): void {
		const normalLineHeight = Math.max(1, 1.4 * scale);
		const isSingleLine =
			textarea.value.split("\n").length <= 1 &&
			textarea.scrollHeight <= textarea.clientHeight;
		if (isSingleLine) {
			textarea.style.paddingTop = "0px";
			textarea.style.paddingBottom = "0px";
			textarea.style.lineHeight = `${Math.max(1, height - 4)}px`;
			return;
		}
		textarea.style.paddingTop = "6px";
		textarea.style.paddingBottom = "6px";
		textarea.style.lineHeight = `${normalLineHeight}px`;
	}

	private async onEditorKeydown(event: KeyboardEvent): Promise<void> {
		const action = resolveEditorKeyAction({
			key: event.key,
			shiftKey: event.shiftKey,
			isComposing: this.isComposing
		});
		if (action === null) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (action === "cancel") {
			this.finishEdit(false);
			return;
		}
		if (action === "commit") {
			const pending = this.finishEdit(true);
			this.focusMap();
			await pending;
			this.focusMap();
			return;
		}
		const parent = this.editingMindNode;
		await this.finishEdit(true);
		this.focusMap();
		if (parent) {
			void this.callbacks.onAddChild(parent);
		}
	}

	private async finishEdit(commit: boolean): Promise<void> {
		if (!this.textarea || !this.editingNode || !this.editingMindNode) {
			return;
		}
		const node = this.editingNode;
		const mindNode = this.editingMindNode;
		const oldText = String(node.getData("text") ?? "");
		const newText = this.textarea.value.replace(/\r?\n/g, " ");
		this.cancelEdit();
		if (commit && newText !== oldText) {
			await this.callbacks.onCommitText(mindNode, newText);
		}
	}

	private cancelEdit(): void {
		this.lastEditEndedAt = Date.now();
		if (this.textarea) {
			this.textarea.remove();
			this.textarea = null;
		}
		this.editingNode = null;
		this.editingMindNode = null;
		this.isComposing = false;
	}
}

function buildMindMapData(
	roots: MindNode[],
	map: Map<string, MindNode>,
	collapsedUids: Set<string> | null
): MindMapNodeData {
	return {
		data: { text: "", uid: "root", expand: true },
		children: roots.map((node) =>
			toMindMapData(node, map, collapsedUids)
		)
	};
}

function resolveRendererLayout(
	layout: MindMapStyle["layout"]
): string {
	return layout === "mindMap" ? MULTI_ROOT_MIND_MAP_LAYOUT : layout;
}

function toMindMapData(
	node: MindNode,
	map: Map<string, MindNode>,
	collapsedUids: Set<string> | null
): MindMapNodeData {
	map.set(node.id, node);
	const expand = collapsedUids !== null && collapsedUids.has(node.id) ? false : true;
	return {
		data: { text: node.text, uid: node.id, expand },
		children: node.children.map((child) =>
			toMindMapData(child, map, collapsedUids)
		)
	};
}

function walkTree(node: MindNode, visit: (node: MindNode) => void): void {
	visit(node);
	for (const child of node.children) {
		walkTree(child, visit);
	}
}

function countNodes(roots: MindNode[]): number {
	let count = 0;
	for (const root of roots) {
		walkTree(root, () => {
			count++;
		});
	}
	return count;
}

function isViewTransformData(value: unknown): value is ViewTransformData {
	if (!value || typeof value !== "object") {
		return false;
	}
	const state = (value as { state?: unknown }).state;
	if (!state || typeof state !== "object") {
		return false;
	}
	const s = state as Record<string, unknown>;
	return (
		typeof s.scale === "number" &&
		typeof s.x === "number" &&
		typeof s.y === "number" &&
		typeof s.sx === "number" &&
		typeof s.sy === "number"
	);
}

function collectCollapsedUids(
	node: MindMapNodeInstance,
	result: Set<string>
): void {
	if (node.getData("expand") === false && !node.isRoot) {
		result.add(String(node.getData("uid") ?? ""));
	}
	for (const child of node.children) {
		collectCollapsedUids(child, result);
	}
}

function buildThemeConfig(
	container: HTMLElement,
	style: MindMapStyle = DEFAULT_MIND_MAP_STYLE
): Record<string, unknown> {
	const lineColor =
		style.lineColor ||
		resolveCssVar(container, "--background-modifier-border") ||
		resolveCssVar(container, "--text-faint") ||
		"rgba(128, 128, 128, 0.45)";
	const hoverColor =
		resolveCssVar(container, "--interactive-accent") || "#549688";

	return {
		backgroundColor: "transparent",
		lineColor,
		lineWidth: style.lineWidth,
		lineStyle: style.lineStyle,
		lineRadius: style.lineRadius,
		rootLineKeepSameInCurve: true,
		hoverRectColor: hoverColor,
		hoverRectRadius: style.borderRadius,
		root: {
			fillColor: "transparent",
			borderColor: "transparent",
			borderWidth: 0,
			hoverRectColor: hoverColor,
			hoverRectRadius: style.borderRadius
		},
		second: {
			marginX: style.secondMarginX,
			marginY: style.secondMarginY,
			shape: style.shape,
			fillColor: style.fillColor,
			borderColor: style.borderColor,
			borderWidth: style.borderWidth,
			borderRadius: style.borderRadius,
			fontSize: style.fontSize,
			hoverRectColor: hoverColor,
			hoverRectRadius: style.borderRadius
		},
		node: {
			marginX: style.nodeMarginX,
			marginY: style.nodeMarginY,
			shape: style.shape,
			fillColor: style.fillColor,
			borderColor: style.borderColor,
			borderWidth: style.borderWidth,
			borderRadius: style.borderRadius,
			fontSize: style.fontSize,
			hoverRectColor: hoverColor,
			hoverRectRadius: style.borderRadius
		}
	};
}

function resolveCssVar(container: HTMLElement, variable: string): string {
	const raw = window.getComputedStyle(container).getPropertyValue(variable).trim();
	if (!raw) {
		return "";
	}
	const probe = document.createElement("span");
	probe.style.color = `var(${variable})`;
	container.appendChild(probe);
	const color = window.getComputedStyle(probe).color;
	probe.remove();
	return color && color !== "transparent" ? color : "";
}

function waitForContainerSize(container: HTMLElement): Promise<void> {
	return new Promise((resolve) => {
		if (container.clientWidth > 0 && container.clientHeight > 0) {
			resolve();
			return;
		}
		const observer = new ResizeObserver(() => {
			if (container.clientWidth > 0 && container.clientHeight > 0) {
				observer.disconnect();
				resolve();
			}
		});
		observer.observe(container);
	});
}

function clearElement(el: HTMLElement): void {
	while (el.firstChild) {
		el.removeChild(el.firstChild);
	}
}
