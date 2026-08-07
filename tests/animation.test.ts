import { describe, expect, it } from "vitest";
import {
	ELEGANT_ANIMATION_DEGRADE_THRESHOLD,
	clamp,
	easeOutCubic,
	easeOutSpring,
	easeInOutCubic,
	getAnimationDistance,
	getAnimationDuration,
	interpolateNumber,
	interpolateViewState,
	interpolateViewStateWithEasing,
	resolveAnimationTargetViewport,
	shouldDegradeAnimation
} from "../src/animation";

describe("clamp", () => {
	it("clamps values below and above the range", () => {
		expect(clamp(-1, 0, 1)).toBe(0);
		expect(clamp(2, 0, 1)).toBe(1);
		expect(clamp(0.5, 0, 1)).toBe(0.5);
	});
});

describe("easeInOutCubic", () => {
	it("returns exact endpoints", () => {
		expect(easeInOutCubic(0)).toBe(0);
		expect(easeInOutCubic(1)).toBe(1);
	});

	it("is monotonic at the midpoint", () => {
		expect(easeInOutCubic(0.25)).toBeLessThan(easeInOutCubic(0.5));
		expect(easeInOutCubic(0.5)).toBeLessThan(easeInOutCubic(0.75));
	});
});

describe("easeOutCubic", () => {
	it("returns exact endpoints and stays monotonic", () => {
		expect(easeOutCubic(0)).toBe(0);
		expect(easeOutCubic(1)).toBe(1);
		expect(easeOutCubic(0.25)).toBeLessThan(easeOutCubic(0.5));
		expect(easeOutCubic(0.5)).toBeLessThan(easeOutCubic(0.75));
	});
});

describe("easeOutSpring", () => {
	it("returns exact endpoints with a gentle overshoot in between", () => {
		expect(easeOutSpring(0)).toBe(0);
		expect(easeOutSpring(1)).toBe(1);
		expect(easeOutSpring(0.6)).toBeGreaterThan(1);
	});
});

describe("interpolateNumber", () => {
	it("interpolates between two values", () => {
		expect(interpolateNumber(0, 100, 0)).toBe(0);
		expect(interpolateNumber(0, 100, 1)).toBe(100);
		expect(interpolateNumber(10, 20, 0.5)).toBe(18.75);
	});
});

describe("interpolateViewState", () => {
	it("interpolates every state field", () => {
		const from = { scale: 1, x: 0, y: 0, sx: 0, sy: 0 };
		const to = { scale: 0.5, x: 100, y: 50, sx: 10, sy: 20 };
		expect(interpolateViewState(from, to, 0)).toEqual(from);
		expect(interpolateViewState(from, to, 1)).toEqual(to);
		expect(interpolateViewState(from, to, 0.5)).toEqual({
			scale: 0.5625,
			x: 87.5,
			y: 43.75,
			sx: 8.75,
			sy: 17.5
		});
	});
});

describe("interpolateViewStateWithEasing", () => {
	it("uses the supplied easing instead of the default ease-out", () => {
		const from = { scale: 1, x: 0, y: 0, sx: 0, sy: 0 };
		const to = { scale: 1, x: 100, y: 0, sx: 0, sy: 0 };
		const target = interpolateViewStateWithEasing(
			from,
			to,
			0.6,
			easeOutSpring
		);

		expect(target.x).toBe(100 * easeOutSpring(0.6));
		expect(target.x).toBeGreaterThan(100);
	});
});

describe("resolveAnimationTargetViewport", () => {
	const current = { scale: 1, x: 0, y: 0, sx: 0, sy: 0 };
	const anchor = {
		x: 300,
		y: 100,
		width: 100,
		height: 40,
		x2: 400,
		y2: 140
	};
	const subtree = {
		x: 300,
		y: 100,
		width: 2000,
		height: 400,
		x2: 2300,
		y2: 500
	};
	const options = {
		viewportWidth: 1000,
		viewportHeight: 600,
		padding: 48
	};

	it("limits an over-right expansion shift", () => {
		const baseline = {
			scale: 0.5,
			x: 1500,
			y: 0,
			sx: 0,
			sy: 0
		};
		const target = resolveAnimationTargetViewport(
			current,
			baseline,
			anchor,
			subtree,
			true,
			options
		);

		expect(Math.abs(target.x - current.x)).toBeLessThanOrEqual(500);
		expect(target.x).toBeLessThanOrEqual(500);
	});

	it("keeps the anchor node intersecting the viewport", () => {
		const baseline = {
			scale: 0.5,
			x: 1500,
			y: 0,
			sx: 0,
			sy: 0
		};
		const target = resolveAnimationTargetViewport(
			current,
			baseline,
			anchor,
			subtree,
			true,
			options
		);
		const projected = projectForTest(anchor, current, target);

		expect(projected.left).toBeLessThan(options.viewportWidth - options.padding);
		expect(projected.right).toBeGreaterThan(options.padding);
	});

	it("keeps the expanded subtree intersecting the viewport", () => {
		const baseline = {
			scale: 0.5,
			x: 1500,
			y: 0,
			sx: 0,
			sy: 0
		};
		const target = resolveAnimationTargetViewport(
			current,
			baseline,
			anchor,
			subtree,
			true,
			options
		);
		const projected = projectForTest(subtree, current, target);

		expect(projected.left).toBeLessThan(options.viewportWidth - options.padding);
		expect(projected.right).toBeGreaterThan(options.padding);
	});

	it("raises below-readable scales to the readable scale", () => {
		const baseline = {
			scale: 0.1,
			x: 0,
			y: 0,
			sx: 0,
			sy: 0
		};
		const target = resolveAnimationTargetViewport(
			{ ...current, scale: 0.5 },
			baseline,
			anchor,
			subtree,
			true,
			options
		);

		expect(target.scale).toBe(1);
	});

	it("keeps an already readable scale", () => {
		const target = resolveAnimationTargetViewport(
			{ ...current, scale: 1.5 },
			{ ...current, scale: 1.5 },
			anchor,
			subtree,
			true,
			options
		);

		expect(target.scale).toBe(1.5);
	});

	it("centers a world anchor with non-zero translate and zoomed current scale", () => {
		const zoomedCurrent = {
			scale: 0.5,
			x: 100,
			y: 20,
			sx: 0,
			sy: 0
		};
		const target = resolveAnimationTargetViewport(
			zoomedCurrent,
			zoomedCurrent,
			anchor,
			null,
			false,
			options
		);
		const projected = projectForTest(anchor, zoomedCurrent, target);

		expect(target.x).toBe(150);
		expect(target.y).toBe(180);
		expect(projected.left + projected.right).toBeCloseTo(1000);
		expect(projected.top + projected.bottom).toBeCloseTo(600);
	});

	it("bounds collapse translation and keeps the node visible", () => {
		const baseline = {
			scale: 0.5,
			x: 800,
			y: 400,
			sx: 7,
			sy: 8
		};
		const target = resolveAnimationTargetViewport(
			current,
			baseline,
			anchor,
			null,
			false,
			options
		);
		const projected = projectForTest(anchor, current, target);

		expect(Math.abs(target.x - current.x)).toBeLessThanOrEqual(500);
		expect(projected.right).toBeGreaterThanOrEqual(options.padding);
		expect(projected.left).toBeLessThanOrEqual(
			options.viewportWidth - options.padding
		);
	});

	it("centers an offscreen left anchor in the viewport", () => {
		const leftAnchor = {
			x: -800,
			y: 0,
			width: 100,
			height: 40,
			x2: -700,
			y2: 40
		};
		const leftSubtree = {
			x: -3000,
			y: 0,
			width: 2300,
			height: 40,
			x2: -700,
			y2: 40
		};
		const target = resolveAnimationTargetViewport(
			current,
			{
				scale: 0.6,
				x: -600,
				y: 0,
				sx: 0,
				sy: 0
			},
			leftAnchor,
			leftSubtree,
			true,
			options
		);
		const projected = projectForTest(leftAnchor, current, target);

		expect(target.x).toBe(1250);
		expect(projected.left + projected.right).toBeCloseTo(1000);
		expect(projected.right).toBeGreaterThanOrEqual(options.padding);
		expect(projected.left).toBeLessThanOrEqual(
			options.viewportWidth - options.padding
		);
	});

	it("keeps the expanded left subtree intersecting the viewport", () => {
		const leftAnchor = {
			x: -800,
			y: 0,
			width: 100,
			height: 40,
			x2: -700,
			y2: 40
		};
		const leftSubtree = {
			x: -3000,
			y: 0,
			width: 2300,
			height: 40,
			x2: -700,
			y2: 40
		};
		const target = resolveAnimationTargetViewport(
			current,
			{
				scale: 0.6,
				x: -600,
				y: 0,
				sx: 0,
				sy: 0
			},
			leftAnchor,
			leftSubtree,
			true,
			options
		);
		const projected = projectForTest(leftSubtree, current, target);

		expect(projected.right).toBeGreaterThanOrEqual(options.padding);
		expect(projected.left).toBeLessThanOrEqual(
			options.viewportWidth - options.padding
		);
	});
});

function projectForTest(
	rect: { x: number; y: number; x2: number; y2: number },
	_from: { scale: number; x: number; y: number },
	to: { scale: number; x: number; y: number }
): { left: number; top: number; right: number; bottom: number } {
	return {
		left: rect.x * to.scale + to.x,
		top: rect.y * to.scale + to.y,
		right: rect.x2 * to.scale + to.x,
		bottom: rect.y2 * to.scale + to.y
	};
}

describe("shouldDegradeAnimation", () => {
	it("degrades when performance mode is enabled", () => {
		expect(shouldDegradeAnimation(10, true)).toBe(true);
	});

	it("degrades at the node count threshold", () => {
		expect(
			shouldDegradeAnimation(ELEGANT_ANIMATION_DEGRADE_THRESHOLD - 1, false)
		).toBe(false);
		expect(
			shouldDegradeAnimation(ELEGANT_ANIMATION_DEGRADE_THRESHOLD, false)
		).toBe(true);
	});
});

describe("getAnimationDuration", () => {
	it("uses a shorter duration above the degradation threshold", () => {
		expect(getAnimationDuration(10)).toBe(320);
		expect(getAnimationDuration(ELEGANT_ANIMATION_DEGRADE_THRESHOLD)).toBe(
			180
		);
	});

	it("applies speed and distance factors", () => {
		expect(getAnimationDuration(10, { speed: 2, distance: 0 })).toBe(640);
		expect(getAnimationDuration(10, { speed: 0.5, distance: 0 })).toBe(
			160
		);
		expect(getAnimationDuration(10, { speed: 1, distance: 1000 })).toBe(
			480
		);
	});
});

describe("getAnimationDistance", () => {
	it("measures translate and scale travel", () => {
		const from = { scale: 1, x: 0, y: 0, sx: 0, sy: 0 };
		const to = { scale: 1, x: 100, y: 0, sx: 0, sy: 0 };
		expect(getAnimationDistance(from, to)).toBe(100);
		expect(
			getAnimationDistance(
				from,
				{ scale: 2, x: 0, y: 0, sx: 0, sy: 0 }
			)
		).toBeCloseTo(800 * Math.LN2);
	});
});
