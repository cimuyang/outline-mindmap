import { describe, expect, it } from "vitest";
import { diffTreeTextChanges } from "../src/diff";
import { parseMarkdown } from "../src/parser";

describe("diffTreeTextChanges", () => {
	it("returns text changes when the structure is identical", () => {
		const oldTree = parseMarkdown("###### A\n- one\n  - child\n");
		const newTree = parseMarkdown("###### B\n- one\n  - updated\n");

		expect(diffTreeTextChanges(oldTree, newTree)).toEqual([
			{ uid: "0", newText: "B" },
			{ uid: "2", newText: "updated" }
		]);
	});

	it("returns an empty array when nothing changed", () => {
		const text = "# A\n- one\n";
		expect(diffTreeTextChanges(parseMarkdown(text), parseMarkdown(text))).toEqual([]);
	});

	it("returns an empty array for two empty trees", () => {
		expect(diffTreeTextChanges(parseMarkdown(""), parseMarkdown(""))).toEqual([]);
	});

	it("returns null when a node is added", () => {
		const oldTree = parseMarkdown("# A\n");
		const newTree = parseMarkdown("# A\n## B\n");
		expect(diffTreeTextChanges(oldTree, newTree)).toBeNull();
	});

	it("returns null when a node is deleted", () => {
		const oldTree = parseMarkdown("# A\n## B\n");
		const newTree = parseMarkdown("# A\n");
		expect(diffTreeTextChanges(oldTree, newTree)).toBeNull();
	});

	it("returns text changes when sibling nodes swap lines", () => {
		const oldTree = parseMarkdown("# A\n# B\n");
		const newTree = parseMarkdown("# B\n# A\n");
		expect(diffTreeTextChanges(oldTree, newTree)).toEqual([
			{ uid: "0", newText: "B" },
			{ uid: "1", newText: "A" }
		]);
	});

	it("returns null when a node moves to a different parent", () => {
		const oldTree = parseMarkdown("###### A\n- x\n- y\n");
		const newTree = parseMarkdown("###### A\n- x\n  - y\n");
		expect(diffTreeTextChanges(oldTree, newTree)).toBeNull();
	});

	it("returns null when a heading level changes", () => {
		const oldTree = parseMarkdown("###### A\n# B\n");
		const newTree = parseMarkdown("##### A\n# B\n");
		expect(diffTreeTextChanges(oldTree, newTree)).toBeNull();
	});

	it("returns null when hidden lines change", () => {
		const oldTree = parseMarkdown("# A\n# B\n");
		const newTree = parseMarkdown("# A\nhidden\n# B\n");
		expect(diffTreeTextChanges(oldTree, newTree)).toBeNull();
	});

	it("returns null when one tree is empty and the other is not", () => {
		expect(diffTreeTextChanges(parseMarkdown(""), parseMarkdown("# A\n"))).toBeNull();
		expect(diffTreeTextChanges(parseMarkdown("# A\n"), parseMarkdown(""))).toBeNull();
	});
});
