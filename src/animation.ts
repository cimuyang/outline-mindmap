export interface ViewTransformState {
	scale: number;
	x: number;
	y: number;
	sx: number;
	sy: number;
}

export interface ViewTransformData {
	transform: unknown;
	state: ViewTransformState;
}

export interface AnimationBoundsRect {
	x: number;
	y: number;
	width: number;
	height: number;
	x2: number;
	y2: number;
}

export interface AnimationTargetViewportOptions {
	viewportWidth: number;
	viewportHeight: number;
	padding: number;
	maxHorizontalShiftRatio?: number;
	maxVerticalShiftRatio?: number;
	minScaleRatio?: number;
	readableScale?: number;
}

export interface AnimationDurationOptions {
	speed?: number;
	distance?: number;
}

export type EasingFunction = (t: number) => number;

export const ELEGANT_ANIMATION_DURATION_MS = 320;
export const ELEGANT_ANIMATION_PADDING = 48;
export const ELEGANT_ANIMATION_DEGRADE_THRESHOLD = 1000;
export const ELEGANT_ANIMATION_READABLE_SCALE = 1;

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function easeInOutCubic(t: number): number {
	const value = clamp(t, 0, 1);
	return value < 0.5
		? 4 * value * value * value
		: 1 - Math.pow(-2 * value + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
	const value = clamp(t, 0, 1);
	return 1 - Math.pow(1 - value, 3);
}

export function easeOutSpring(t: number): number {
	const value = clamp(t, 0, 1);
	const c1 = 1.4;
	const c3 = c1 + 1;
	return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
}

export function interpolateNumberWithEasing(
	from: number,
	to: number,
	t: number,
	easing: EasingFunction
): number {
	return from + (to - from) * easing(t);
}

export function interpolateNumber(
	from: number,
	to: number,
	t: number
): number {
	return interpolateNumberWithEasing(from, to, t, easeOutCubic);
}

export function interpolateViewStateWithEasing(
	from: ViewTransformState,
	to: ViewTransformState,
	t: number,
	easing: EasingFunction
): ViewTransformState {
	return {
		scale: interpolateNumberWithEasing(from.scale, to.scale, t, easing),
		x: interpolateNumberWithEasing(from.x, to.x, t, easing),
		y: interpolateNumberWithEasing(from.y, to.y, t, easing),
		sx: interpolateNumberWithEasing(from.sx, to.sx, t, easing),
		sy: interpolateNumberWithEasing(from.sy, to.sy, t, easing)
	};
}

export function interpolateViewState(
	from: ViewTransformState,
	to: ViewTransformState,
	t: number
): ViewTransformState {
	return interpolateViewStateWithEasing(from, to, t, easeOutCubic);
}

export function resolveAnimationTargetViewport(
	current: ViewTransformState,
	baseline: ViewTransformState,
	anchorRect: AnimationBoundsRect,
	subtreeRect: AnimationBoundsRect | null,
	expand: boolean,
	options: AnimationTargetViewportOptions
): ViewTransformState {
	const readableScale =
		options.readableScale ?? ELEGANT_ANIMATION_READABLE_SCALE;
	const targetScale = Math.max(current.scale, readableScale);
	const anchorCenterX =
		(anchorRect.x + anchorRect.width / 2) * targetScale;
	const anchorCenterY =
		(anchorRect.y + anchorRect.height / 2) * targetScale;

	return {
		...baseline,
		scale: targetScale,
		x: options.viewportWidth / 2 - anchorCenterX,
		y: options.viewportHeight / 2 - anchorCenterY,
		sx: current.sx,
		sy: current.sy
	};
}

export function shouldDegradeAnimation(
	nodeCount: number,
	openPerformance: boolean
): boolean {
	return openPerformance || nodeCount >= ELEGANT_ANIMATION_DEGRADE_THRESHOLD;
}

export function getAnimationDuration(
	nodeCount: number,
	options: AnimationDurationOptions = {}
): number {
	const base = nodeCount >= ELEGANT_ANIMATION_DEGRADE_THRESHOLD
		? 180
		: ELEGANT_ANIMATION_DURATION_MS;
	const speed = clamp(options.speed ?? 1, 0.5, 2);
	const distanceFactor =
		1 + clamp(Math.max(0, options.distance ?? 0) / 2000, 0, 0.5);
	return Math.round(base * speed * distanceFactor);
}

export function getAnimationDistance(
	from: ViewTransformState,
	to: ViewTransformState
): number {
	const translateDistance = Math.hypot(to.x - from.x, to.y - from.y);
	const scaleDistance =
		Math.abs(Math.log(Math.max(0.0001, to.scale / from.scale))) * 800;
	return translateDistance + scaleDistance;
}
