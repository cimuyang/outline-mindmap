import { describe, expect, it } from "vitest";
import {
	clampToContainer,
	computeCenterTranslation,
	computePanDelta,
	computePanDeltaForEditor,
	isRectOutside,
	isUsableRect
} from "../src/pan";

describe("computeCenterTranslation", () => {
	it("moves the node center to the viewport center", () => {
		const container = { left: 100, top: 50, width: 800, height: 600 };
		const result = computeCenterTranslation(
			{ left: 300, top: 400, width: 100, height: 40 },
			container
		);
		expect(result).toEqual({ dx: 150, dy: -70 });
	});
});

describe("computePanDelta", () => {
	const container = { left: 0, top: 0, width: 1000, height: 600 };
	const margin = 24;

	it("returns zero when the node is fully visible", () => {
		expect(
			computePanDelta(
				{ left: 100, top: 100, right: 200, bottom: 140 },
				container,
				margin
			)
		).toEqual({ dx: 0, dy: 0 });
	});

	it("pans right overflow only", () => {
		expect(
			computePanDelta(
				{ left: 900, top: 100, right: 1020, bottom: 140 },
				container,
				margin
			)
		).toEqual({ dx: -44, dy: 0 });
	});

	it("pans bottom overflow only", () => {
		expect(
			computePanDelta(
				{ left: 100, top: 100, right: 200, bottom: 600 },
				container,
				margin
			)
		).toEqual({ dx: 0, dy: -24 });
	});

	it("pans left overflow only", () => {
		expect(
			computePanDelta(
				{ left: 10, top: 100, right: 200, bottom: 140 },
				container,
				margin
			)
		).toEqual({ dx: 14, dy: 0 });
	});

	it("pans top overflow only", () => {
		expect(
			computePanDelta(
				{ left: 100, top: 5, right: 200, bottom: 140 },
				container,
				margin
			)
		).toEqual({ dx: 0, dy: 19 });
	});

	it("lets the right overflow win when both sides overflow", () => {
		expect(
			computePanDelta(
				{ left: 10, top: 100, right: 990, bottom: 140 },
				container,
				margin
			)
		).toEqual({ dx: -14, dy: 0 });
	});

	it("respects the margin boundary exactly", () => {
		expect(
			computePanDelta(
				{ left: 24, top: 24, right: 200, bottom: 140 },
				container,
				margin
			)
		).toEqual({ dx: 0, dy: 0 });
		expect(
			computePanDelta(
				{ left: 23, top: 100, right: 200, bottom: 140 },
				container,
				margin
			)
		).toEqual({ dx: 1, dy: 0 });
	});

	it("returns client pixel offsets directly", () => {
		expect(
			computePanDelta(
				{ left: -76, top: 100, right: 200, bottom: 140 },
				container,
				margin
			)
		).toEqual({ dx: 100, dy: 0 });
		expect(
			computePanDelta(
				{ left: 900, top: 100, right: 1076, bottom: 140 },
				container,
				margin
			)
		).toEqual({ dx: -100, dy: 0 });
	});

	it("accounts for a non-zero container origin", () => {
		expect(
			computePanDelta(
				{ left: 60, top: 20, right: 200, bottom: 140 },
				{ left: 50, top: 30, width: 1000, height: 600 },
				margin
			)
		).toEqual({ dx: 14, dy: 34 });
	});
});

describe("isRectOutside", () => {
	const container = { left: 0, top: 0, width: 1000, height: 600 };
	const margin = 24;

	it("returns false when the rect is fully visible", () => {
		expect(
			isRectOutside(
				{ left: 100, top: 100, right: 200, bottom: 140 },
				container,
				margin
			)
		).toBe(false);
	});

	it("returns true for left overflow", () => {
		expect(
			isRectOutside(
				{ left: 10, top: 100, right: 200, bottom: 140 },
				container,
				margin
			)
		).toBe(true);
	});
});

describe("computePanDeltaForEditor", () => {
	const container = { left: 0, top: 0, width: 1000, height: 600 };
	const margin = 24;

	it("pans the editor to the right margin when it overflows", () => {
		expect(
			computePanDeltaForEditor(
				{ left: 800, top: 100, right: 900, bottom: 140 },
				{ left: 800, top: 100, right: 1000, bottom: 140 },
				null,
				container,
				margin
			)
		).toEqual({ dx: -24, dy: 0 });
	});

	it("keeps the node visible when the editor already fits", () => {
		expect(
			computePanDeltaForEditor(
				{ left: 10, top: 100, right: 110, bottom: 140 },
				{ left: 24, top: 100, right: 224, bottom: 140 },
				null,
				container,
				margin
			)
		).toEqual({ dx: 14, dy: 0 });
	});

	it("pans a left-branch node and its editor back into view", () => {
		expect(
			computePanDeltaForEditor(
				{ left: -260, top: 100, right: -160, bottom: 140 },
				{ left: -260, top: 100, right: 40, bottom: 140 },
				null,
				container,
				margin
			)
		).toEqual({ dx: 284, dy: 0 });
	});

	it("keeps a wide editor within the right margin when a left node remains clipped", () => {
		expect(
			computePanDeltaForEditor(
				{ left: -100, top: 100, right: 0, bottom: 140 },
				{ left: 0, top: 100, right: 952, bottom: 140 },
				null,
				container,
				margin
			)
		).toEqual({ dx: 24, dy: 0 });
	});

	it("handles left overflow with a non-zero container origin", () => {
		expect(
			computePanDeltaForEditor(
				{ left: 90, top: 120, right: 190, bottom: 160 },
				{ left: 90, top: 120, right: 390, bottom: 160 },
				null,
				{ left: 80, top: 30, width: 1000, height: 600 },
				margin
			)
		).toEqual({ dx: 14, dy: 0 });
	});

	it("does not push an editor at the right margin to fix a clipped node", () => {
		expect(
			computePanDeltaForEditor(
				{ left: 10, top: 100, right: 110, bottom: 140 },
				{ left: 776, top: 100, right: 976, bottom: 140 },
				null,
				container,
				margin
			)
		).toEqual({ dx: 0, dy: 0 });
	});

	it("prioritizes right overflow when both editor sides overflow", () => {
		expect(
			computePanDeltaForEditor(
				{ left: 100, top: 100, right: 200, bottom: 140 },
				{ left: 0, top: 100, right: 1000, bottom: 140 },
				null,
				container,
				margin
			)
		).toEqual({ dx: -24, dy: 0 });
	});

	it("considers parent anchor context when the editor has room", () => {
		expect(
			computePanDeltaForEditor(
				{ left: 100, top: 100, right: 200, bottom: 140 },
				{ left: 100, top: 100, right: 300, bottom: 140 },
				{ left: 0, top: 100, right: 50, bottom: 140 },
				container,
				margin
			)
		).toEqual({ dx: 24, dy: 0 });
	});

	it("pans vertically when the editor overflows the bottom", () => {
		expect(
			computePanDeltaForEditor(
				{ left: 100, top: 100, right: 200, bottom: 140 },
				{ left: 100, top: 100, right: 300, bottom: 640 },
				null,
				container,
				margin
			)
		).toEqual({ dx: 0, dy: -64 });
	});
});

describe("isUsableRect", () => {
	it("returns true when width and height are positive", () => {
		expect(isUsableRect({ width: 100, height: 40 })).toBe(true);
	});

	it("returns false when width is zero", () => {
		expect(isUsableRect({ width: 0, height: 40 })).toBe(false);
	});

	it("returns false when height is zero", () => {
		expect(isUsableRect({ width: 100, height: 0 })).toBe(false);
	});

	it("returns false for non-positive dimensions", () => {
		expect(isUsableRect({ width: -1, height: 40 })).toBe(false);
		expect(isUsableRect({ width: 100, height: -2 })).toBe(false);
	});
});

describe("clampToContainer", () => {
	it("keeps coordinates inside the container", () => {
		expect(clampToContainer(100, 50, 100, 40, 800, 600)).toEqual({
			left: 100,
			top: 50
		});
	});

	it("clamps overflow on both axes", () => {
		expect(clampToContainer(900, 700, 100, 40, 800, 600)).toEqual({
			left: 700,
			top: 560
		});
	});

	it("clamps negative coordinates to zero", () => {
		expect(clampToContainer(-10, -20, 100, 40, 800, 600)).toEqual({
			left: 0,
			top: 0
		});
	});

	it("clamps a single overflowing axis", () => {
		expect(clampToContainer(900, 50, 100, 40, 800, 600)).toEqual({
			left: 700,
			top: 50
		});
	});

	it("clamps to zero when the editor is larger than the container", () => {
		expect(clampToContainer(10, 10, 1000, 700, 800, 600)).toEqual({
			left: 0,
			top: 0
		});
	});
});
