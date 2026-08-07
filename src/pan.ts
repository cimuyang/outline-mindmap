export interface Rect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface PanContainer {
	left: number;
	top: number;
	width: number;
	height: number;
}

export function computePanDelta(
	node: Rect,
	container: PanContainer,
	margin: number
): { dx: number; dy: number } {
	const minLeft = container.left + margin;
	const maxRight = container.left + container.width - margin;
	const minTop = container.top + margin;
	const maxBottom = container.top + container.height - margin;

	let clientDx = 0;
	let clientDy = 0;
	if (node.left < minLeft) {
		clientDx = minLeft - node.left;
	}
	if (node.right > maxRight) {
		clientDx = maxRight - node.right;
	}
	if (node.top < minTop) {
		clientDy = minTop - node.top;
	}
	if (node.bottom > maxBottom) {
		clientDy = maxBottom - node.bottom;
	}
	return { dx: clientDx, dy: clientDy };
}

export function computeCenterTranslation(
	node: { left: number; top: number; width: number; height: number },
	container: PanContainer
): { dx: number; dy: number } {
	const nodeCenterX = node.left + node.width / 2;
	const nodeCenterY = node.top + node.height / 2;
	return {
		dx:
			container.left +
			container.width / 2 -
			nodeCenterX,
		dy:
			container.top +
			container.height / 2 -
			nodeCenterY
	};
}

export function isRectOutside(
	rect: Rect,
	container: PanContainer,
	margin: number
): boolean {
	const delta = computePanDelta(rect, container, margin);
	return delta.dx !== 0 || delta.dy !== 0;
}

export function computePanDeltaForEditor(
	node: Rect,
	editor: Rect,
	anchor: Rect | null,
	container: PanContainer,
	margin: number
): { dx: number; dy: number } {
	const editorDelta = computePanDelta(editor, container, margin);
	let dx = editorDelta.dx;
	let dy = editorDelta.dy;

	let shiftedEditor = shiftRect(editor, dx, dy);
	const shiftedNode = shiftRect(node, dx, dy);
	const shiftedAnchor = anchor ? shiftRect(anchor, dx, dy) : null;
	const contextRect = mergeRects(shiftedNode, shiftedAnchor);
	const contextDelta = computePanDelta(contextRect, container, margin);

	if (
		rectFitsWithin(
			shiftRect(shiftedEditor, contextDelta.dx, 0),
			container,
			margin
		)
	) {
		dx += contextDelta.dx;
		shiftedEditor = shiftRect(shiftedEditor, contextDelta.dx, 0);
	}
	if (
		rectFitsWithin(
			shiftRect(shiftedEditor, 0, contextDelta.dy),
			container,
			margin
		)
	) {
		dy += contextDelta.dy;
	}
	return { dx, dy };
}

function shiftRect(
	rect: Rect,
	dx: number,
	dy: number
): Rect {
	return {
		left: rect.left + dx,
		top: rect.top + dy,
		right: rect.right + dx,
		bottom: rect.bottom + dy
	};
}

function mergeRects(...rects: Array<Rect | null>): Rect {
	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	for (const rect of rects) {
		if (!rect) {
			continue;
		}
		left = Math.min(left, rect.left);
		top = Math.min(top, rect.top);
		right = Math.max(right, rect.right);
		bottom = Math.max(bottom, rect.bottom);
	}
	if (!Number.isFinite(left)) {
		return { left: 0, top: 0, right: 0, bottom: 0 };
	}
	return { left, top, right, bottom };
}

function rectFitsWithin(
	rect: Rect,
	container: PanContainer,
	margin: number
): boolean {
	return (
		rect.left >= container.left + margin &&
		rect.right <= container.left + container.width - margin &&
		rect.top >= container.top + margin &&
		rect.bottom <= container.top + container.height - margin
	);
}

export function isUsableRect(rect: {
	width: number;
	height: number;
}): boolean {
	return rect.width > 0 && rect.height > 0;
}

export function clampToContainer(
	left: number,
	top: number,
	width: number,
	height: number,
	containerWidth: number,
	containerHeight: number
): { left: number; top: number } {
	const maxLeft = Math.max(0, containerWidth - width);
	const maxTop = Math.max(0, containerHeight - height);
	return {
		left: Math.min(Math.max(0, left), maxLeft),
		top: Math.min(Math.max(0, top), maxTop)
	};
}
