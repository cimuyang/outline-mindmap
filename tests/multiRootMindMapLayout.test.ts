import { describe, expect, it } from "vitest";
import {
	computeMultiRootMindMapLayout,
	toMultiRootLayoutInput
} from "../src/multiRootMindMapLayout";
import type { LayoutNodeInput } from "../src/multiRootMindMapLayout";

const options = {
	secondMarginX: 60,
	secondMarginY: 20,
	nodeMarginX: 30,
	nodeMarginY: 10
};

function node(
	uid: string,
	width = 40,
	height = 20,
	children: LayoutNodeInput[] = []
): LayoutNodeInput {
	return { uid, width, height, expand: true, children };
}

function layout(input: LayoutNodeInput) {
	return computeMultiRootMindMapLayout(input, options);
}

describe("computeMultiRootMindMapLayout", () => {
	it("puts a single H1 root's children on both sides", () => {
		const h1 = node("h1", 80, 30, [
			node("right", 40, 20),
			node("left", 40, 20)
		]);
		const results = layout(
			node("root", 1, 1, [h1])
		);

		expect(results.get("h1")?.dir).toBe("right");
		expect(results.get("right")?.dir).toBe("right");
		expect(results.get("left")?.dir).toBe("left");
		expect(results.get("right")?.left ?? 0).toBeGreaterThan(
			(results.get("h1")?.left ?? 0) + h1.width
		);
		expect(results.get("left")?.left ?? 0).toBeLessThan(
			results.get("h1")?.left ?? 0
		);
	});

	it("stacks multiple H1 roots vertically while each root branches on both sides", () => {
		const h1 = node("h1", 80, 30, [
			node("h1-right", 40, 20),
			node("h1-left", 40, 20)
		]);
		const h2 = node("h2", 80, 30, [
			node("h2-right", 40, 20),
			node("h2-left", 40, 20)
		]);
		const results = layout(node("root", 1, 1, [h1, h2]));

		expect((results.get("h2")?.top ?? 0)).toBeGreaterThan(
			results.get("h1")?.top ?? 0
		);
		expect(results.get("h1-right")?.dir).toBe("right");
		expect(results.get("h1-left")?.dir).toBe("left");
		expect(results.get("h2-right")?.dir).toBe("right");
		expect(results.get("h2-left")?.dir).toBe("left");
	});

	it("keeps deep descendants on the same side as their parent branch", () => {
		const h1 = node("h1", 80, 30, [
			node("right", 40, 20, [node("right-deep", 40, 20)]),
			node("left", 40, 20, [node("left-deep", 40, 20)])
		]);
		const results = layout(node("root", 1, 1, [h1]));
		const right = results.get("right");
		const left = results.get("left");
		const rightLeft = right?.left ?? 0;
		const leftLeft = left?.left ?? 0;

		expect((results.get("right-deep")?.left ?? 0)).toBeGreaterThan(
			rightLeft + 40
		);
		expect((results.get("left-deep")?.left ?? 0)).toBeLessThan(
			leftLeft - 40
		);
	});

	it("does not lay out children of a collapsed root", () => {
		const h1 = node("h1", 80, 30);
		h1.expand = false;
		h1.children = [node("hidden-child", 40, 20)];
		const results = layout(node("root", 1, 1, [h1]));

		expect(results.get("hidden-child")).toBeUndefined();
	});

	it("keeps multiple H1 roots visible when one is a free root without children", () => {
		const freeRoot = node("free", 60, 24);
		const h1 = node("h1", 80, 30, [
			node("right", 40, 20),
			node("left", 40, 20)
		]);
		const results = layout(node("root", 1, 1, [freeRoot, h1]));

		expect(results.get("free")).toBeDefined();
		expect(results.get("h1")).toBeDefined();
		expect(Number.isFinite(results.get("free")?.left)).toBe(true);
		expect(Number.isFinite(results.get("free")?.top)).toBe(true);
		expect((results.get("h1")?.top ?? 0)).toBeGreaterThan(
			results.get("free")?.top ?? 0
		);
	});

	it("lays out zero-size nodes without producing undefined positions", () => {
		const results = layout(
			node("root", 0, 0, [
				node("free", 0, 0),
				node("h1", 0, 0, [
					node("child", 0, 0),
					node("other", 0, 0)
				])
			])
		);

		for (const uid of ["root", "free", "h1", "child", "other"]) {
			expect(results.get(uid)).toBeDefined();
			expect(Number.isFinite(results.get(uid)?.left)).toBe(true);
			expect(Number.isFinite(results.get(uid)?.top)).toBe(true);
		}
	});

	it("centers the hidden root at the origin", () => {
		const results = layout(
			node("root", 2, 2, [
				node("h1", 80, 30, [
					node("right", 40, 20),
					node("left", 40, 20)
				])
			])
		);

		expect(results.get("root")).toEqual({
			left: -1,
			top: -1,
			dir: ""
		});
	});
});

describe("toMultiRootLayoutInput", () => {
	it("traverses H1 roots and free roots even when node instances are missing", () => {
		const input = toMultiRootLayoutInput({
			data: { uid: "root", expand: true },
			children: [
				{ data: { uid: "free", expand: true }, children: [] },
				{
					data: { uid: "h1", expand: true },
					children: [{ data: { uid: "child", expand: false }, children: [] }]
				}
			]
		});

		expect(input.uid).toBe("root");
		expect(input.children.map((child) => child.uid)).toEqual([
			"free",
			"h1"
		]);
		expect(input.children[1]?.children[0]?.uid).toBe("child");
		expect(input.children[1]?.children[0]?.expand).toBe(false);
	});

	it("falls back to a positive size when width or height is zero", () => {
		const input = toMultiRootLayoutInput({
			_node: { width: 0, height: 0 },
			data: { uid: "empty", expand: true },
			children: []
		});

		expect(input.width).toBe(1);
		expect(input.height).toBe(1);
	});
});
