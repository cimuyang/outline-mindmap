export const MULTI_ROOT_MIND_MAP_LAYOUT = "multiRootMindMap";

export type LayoutDirection = "left" | "right";

export interface LayoutNodeInput {
	uid: string;
	width: number;
	height: number;
	expand: boolean;
	children: LayoutNodeInput[];
}

export interface LayoutNodeResult {
	left: number;
	top: number;
	dir: LayoutDirection | "";
}

export interface MultiRootMindMapOptions {
	secondMarginX: number;
	secondMarginY: number;
	nodeMarginX: number;
	nodeMarginY: number;
}

export interface LayoutSourceNode {
	_node?: {
		width?: number;
		height?: number;
	} | null;
	data?: {
		uid?: string;
		expand?: boolean;
	} | null;
	children?: LayoutSourceNode[] | null;
}

interface NodeMetrics {
	leftAreaHeight: number;
	rightAreaHeight: number;
	blockHeight: number;
}

export function toMultiRootLayoutInput(
	data: LayoutSourceNode
): LayoutNodeInput {
	const node = data?._node;
	return {
		uid: String(data?.data?.uid ?? ""),
		width: positiveSize(node?.width),
		height: positiveSize(node?.height),
		expand: data?.data?.expand !== false,
		children: (data?.children ?? []).map((child) =>
			toMultiRootLayoutInput(child)
		)
	};
}

export function computeMultiRootMindMapLayout(
	root: LayoutNodeInput,
	options: MultiRootMindMapOptions
): Map<string, LayoutNodeResult> {
	const results = new Map<string, LayoutNodeResult>();
	const metrics = new Map<string, NodeMetrics>();
	const rootGapY = options.secondMarginY;
	const totalRootHeight =
		root.children.reduce(
			(sum, child) =>
				sum + computeNodeMetrics(child, "right", true, options, metrics)
					.blockHeight,
			0
		) +
		(root.children.length + 1) * rootGapY;
	let blockTop = -totalRootHeight / 2 + rootGapY;

	for (const child of root.children) {
		const metric = metrics.get(child.uid);
		if (!metric) {
			continue;
		}
		const centerY = blockTop + metric.blockHeight / 2;
		layoutNode(
			child,
			0,
			centerY,
			"right",
			true,
			options,
			metrics,
			results
		);
		blockTop += metric.blockHeight + rootGapY;
	}

	results.set(root.uid, {
		left: -root.width / 2,
		top: -root.height / 2,
		dir: ""
	});
	return results;
}

function positiveSize(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: 1;
}

function computeNodeMetrics(
	node: LayoutNodeInput,
	dir: LayoutDirection,
	isBilateralRoot: boolean,
	options: MultiRootMindMapOptions,
	metrics: Map<string, NodeMetrics>
): NodeMetrics {
	if (!node.expand || node.children.length === 0) {
		const leafMetrics: NodeMetrics = {
			leftAreaHeight: 0,
			rightAreaHeight: 0,
			blockHeight: node.height
		};
		metrics.set(node.uid, leafMetrics);
		return leafMetrics;
	}

	const marginY = isBilateralRoot
		? options.secondMarginY
		: options.nodeMarginY;
	let leftSum = 0;
	let rightSum = 0;
	let leftLen = 0;
	let rightLen = 0;

	node.children.forEach((child, index) => {
		const childDir = isBilateralRoot
			? index % 2 === 0
				? "right"
				: "left"
			: dir;
		const childMetrics = computeNodeMetrics(
			child,
			childDir,
			false,
			options,
			metrics
		);
		if (childDir === "left") {
			leftSum += childMetrics.blockHeight;
			leftLen++;
		} else {
			rightSum += childMetrics.blockHeight;
			rightLen++;
		}
	});

	const leftAreaHeight = leftLen
		? leftSum + (leftLen + 1) * marginY
		: 0;
	const rightAreaHeight = rightLen
		? rightSum + (rightLen + 1) * marginY
		: 0;
	const result: NodeMetrics = {
		leftAreaHeight,
		rightAreaHeight,
		blockHeight: Math.max(
			node.height,
			leftAreaHeight,
			rightAreaHeight
		)
	};
	metrics.set(node.uid, result);
	return result;
}

function layoutNode(
	node: LayoutNodeInput,
	centerX: number,
	centerY: number,
	dir: LayoutDirection,
	isBilateralRoot: boolean,
	options: MultiRootMindMapOptions,
	metrics: Map<string, NodeMetrics>,
	results: Map<string, LayoutNodeResult>
): void {
	results.set(node.uid, {
		left: centerX - node.width / 2,
		top: centerY - node.height / 2,
		dir: isBilateralRoot ? "right" : dir
	});

	if (!node.expand || node.children.length === 0) {
		return;
	}
	const metric = metrics.get(node.uid);
	if (!metric) {
		return;
	}
	const marginX = isBilateralRoot
		? options.secondMarginX
		: options.nodeMarginX;
	const marginY = isBilateralRoot
		? options.secondMarginY
		: options.nodeMarginY;

	layoutSide(
		"left",
		node,
		centerX,
		centerY,
		dir,
		isBilateralRoot,
		marginX,
		marginY,
		options,
		metrics,
		results
	);
	layoutSide(
		"right",
		node,
		centerX,
		centerY,
		dir,
		isBilateralRoot,
		marginX,
		marginY,
		options,
		metrics,
		results
	);
}

function layoutSide(
	side: LayoutDirection,
	node: LayoutNodeInput,
	centerX: number,
	centerY: number,
	dir: LayoutDirection,
	isBilateralRoot: boolean,
	marginX: number,
	marginY: number,
	options: MultiRootMindMapOptions,
	metrics: Map<string, NodeMetrics>,
	results: Map<string, LayoutNodeResult>
): void {
	const sideChildren: Array<{
		child: LayoutNodeInput;
		childDir: LayoutDirection;
	}> = [];
	node.children.forEach((child, index) => {
		const childDir = isBilateralRoot
			? index % 2 === 0
				? "right"
				: "left"
			: dir;
		if (childDir === side) {
			sideChildren.push({ child, childDir });
		}
	});
	if (sideChildren.length === 0) {
		return;
	}

	const metric = metrics.get(node.uid);
	if (!metric) {
		return;
	}
	const areaHeight =
		side === "left" ? metric.leftAreaHeight : metric.rightAreaHeight;
	let top = centerY - areaHeight / 2 + marginY;
	for (const item of sideChildren) {
		const childMetric = metrics.get(item.child.uid);
		if (!childMetric) {
			continue;
		}
		const childCenterY = top + childMetric.blockHeight / 2;
		const childCenterX =
			side === "right"
				? centerX + node.width / 2 + marginX + item.child.width / 2
				: centerX - node.width / 2 - marginX - item.child.width / 2;
		layoutNode(
			item.child,
			childCenterX,
			childCenterY,
			item.childDir,
			false,
			options,
			metrics,
			results
		);
		top += childMetric.blockHeight + marginY;
	}
}
