declare module "simple-mind-map" {
	export interface MindMapNodeData {
		data: {
			text?: string;
			uid?: string;
			expand?: boolean;
			[key: string]: unknown;
		};
		children?: MindMapNodeData[];
	}

	export interface MindMapNodeInstance {
		readonly isRoot: boolean;
		readonly isGeneralization: boolean;
		readonly layerIndex: number;
		readonly parent: MindMapNodeInstance | null;
		readonly children: MindMapNodeInstance[];
		readonly left: number;
		readonly top: number;
		readonly width: number;
		readonly height: number;
		readonly group: {
			node: SVGGElement;
			transform(transform?: Record<string, unknown>): unknown;
			opacity(value: number): void;
		};
		getData(key?: string): unknown;
		setData(data: Record<string, unknown>): void;
		getSize(...args: unknown[]): boolean;
		customNodeContentRealtimeLayout(): void;
		active(e?: MouseEvent): void;
		getRect(): {
			x: number;
			y: number;
			width: number;
			height: number;
			x2: number;
			y2: number;
		} | null;
	}

	export interface MindMapOptions {
		el: HTMLElement;
		data?: MindMapNodeData | null;
		layout?: string;
		readonly?: boolean;
		fit?: boolean;
		openPerformance?: boolean;
		performanceConfig?: {
			time?: number;
			padding?: number;
			removeNodeWhenOutCanvas?: boolean;
		};
		themeConfig?: Record<string, unknown>;
		isUseCustomNodeContent?: boolean;
		customCreateNodeContent?: (
			node: MindMapNodeInstance
		) => HTMLElement | null | undefined;
		customQuickCreateChildBtnClick?: (
			node: MindMapNodeInstance
		) => void;
		enableShortcutOnlyWhenMouseInSvg?: boolean;
		mousewheelAction?: "move" | "zoom";
		enableCtrlKeyNodeSelection?: boolean;
		customCheckEnableShortcut?: (event: KeyboardEvent) => boolean;
		beforeDragStart?: (
			nodes: MindMapNodeInstance[]
		) => boolean | void | Promise<boolean | void>;
		beforeDragEnd?: (info: {
			overlapNodeUid: string;
			prevNodeUid: string;
			nextNodeUid: string;
			beingDragNodeList: MindMapNodeInstance[];
		}) => boolean | void | Promise<boolean | void>;
		[key: string]: unknown;
	}

	export default class MindMap {
		constructor(options: MindMapOptions);

		static usePlugin(
			plugin: unknown,
			opt?: Record<string, unknown>
		): typeof MindMap;

		readonly el: HTMLElement;
		readonly opt: MindMapOptions;

		readonly renderer: {
			root: MindMapNodeInstance | null;
			activeNodeList: MindMapNodeInstance[];
			findNodeByUid(uid: string): MindMapNodeInstance | null | undefined;
			activeMultiNode(nodeList: MindMapNodeInstance[]): void;
			removeNodeFromActiveList(node: MindMapNodeInstance): void;
			forceLoadNode(node?: MindMapNodeInstance): void;
			renderByCustomNodeContentNode(node: MindMapNodeInstance): void;
		};

		readonly view: {
			scale: number;
			fit(
				getRbox?: () => unknown,
				enlarge?: boolean,
				fitPadding?: number
			): void;
			translateXY(x: number, y: number): void;
			enlarge(cx?: number, cy?: number): void;
			narrow(cx?: number, cy?: number): void;
			reset(): void;
			getTransformData(): unknown;
			setTransformData(viewData: unknown): void;
		};

		readonly keyCommand: {
			addShortcut(key: string, fn: () => void): void;
			removeShortcut(key: string, fn?: () => void): void;
			stopCheckInSvg(): void;
			recoveryCheckInSvg(): void;
		};

		render(callback?: () => void, source?: string): void;
		setThemeConfig(
			config: Record<string, unknown>,
			notRender?: boolean
		): void;
		setLayout(layout: string, notRender?: boolean): void;
		getLayout(): string;

		on(event: string, fn: (...args: any[]) => void): void;
		off(event: string, fn: (...args: any[]) => void): void;
		emit(event: string, ...args: unknown[]): void;
		execCommand(name: string, ...args: unknown[]): void;
		setData(data: MindMapNodeData): void;
		getData(withConfig?: boolean): unknown;
		resize(): void;
		destroy(): void;
	}
}

declare module "simple-mind-map/src/plugins/Drag.js" {
	const DragPlugin: unknown;
	export default DragPlugin;
}

declare module "simple-mind-map/src/plugins/KeyboardNavigation.js" {
	const KeyboardNavigationPlugin: unknown;
	export default KeyboardNavigationPlugin;
}

declare module "simple-mind-map/src/plugins/Select.js" {
	const SelectPlugin: unknown;
	export default SelectPlugin;
}

declare module "simple-mind-map/src/layouts/MindMap.js" {
	const MindMapLayout: any;
	export default MindMapLayout;
}

declare module "simple-mind-map/src/constants/constant.js" {
	export const layoutValueList: string[];
}
