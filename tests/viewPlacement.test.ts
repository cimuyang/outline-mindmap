import { describe, expect, it } from "vitest";
import {
	findMindMapLeaf,
	isInRightSidebar
} from "../src/viewPlacement";
import type {
	WorkspaceLeafLike,
	WorkspaceNodeLike
} from "../src/viewPlacement";

describe("viewPlacement", () => {
	const rightSplit = {} as WorkspaceNodeLike;
	const root = { parent: null } as WorkspaceNodeLike;
	const rightTabs = { parent: rightSplit } as WorkspaceNodeLike;
	const mainTabs = { parent: root } as WorkspaceNodeLike;
	const rightLeaf = { parent: rightTabs } as WorkspaceLeafLike;
	const mainLeaf = { parent: mainTabs } as WorkspaceLeafLike;

	it("detects whether a leaf belongs to the right sidebar", () => {
		expect(isInRightSidebar(rightLeaf, rightSplit)).toBe(true);
		expect(isInRightSidebar(mainLeaf, rightSplit)).toBe(false);
		expect(isInRightSidebar(rightLeaf, undefined)).toBe(false);
	});

	it("finds the right sidebar leaf when opening on the right", () => {
		expect(
			findMindMapLeaf([mainLeaf, rightLeaf], "right", rightSplit)
		).toBe(rightLeaf);
	});

	it("finds a non-right leaf when opening in a tab", () => {
		expect(
			findMindMapLeaf([rightLeaf, mainLeaf], "tab", rightSplit)
		).toBe(mainLeaf);
	});

	it("returns null when no matching leaf exists", () => {
		expect(
			findMindMapLeaf([mainLeaf], "right", rightSplit)
		).toBeNull();
		expect(
			findMindMapLeaf([rightLeaf], "tab", rightSplit)
		).toBeNull();
	});
});
