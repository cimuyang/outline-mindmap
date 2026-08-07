import { describe, expect, it } from "vitest";
import {
	getNodeTextRange,
	shouldClearHighlightOnChange
} from "../src/highlight";

describe("getNodeTextRange", () => {
	it("highlights only the heading text", () => {
		expect(getNodeTextRange("## 标题", "heading")).toEqual({
			from: 3,
			to: 5
		});
		expect(getNodeTextRange("###### 标题", "heading")).toEqual({
			from: 7,
			to: 9
		});
	});

	it("supports tab separators in headings", () => {
		expect(getNodeTextRange("#\t标题", "heading")).toEqual({
			from: 2,
			to: 4
		});
	});

	it("highlights only the list item text", () => {
		expect(getNodeTextRange("  - 内容", "list")).toEqual({
			from: 4,
			to: 6
		});
		expect(getNodeTextRange("1. 内容", "list")).toEqual({
			from: 3,
			to: 5
		});
	});

	it("skips task markers", () => {
		expect(getNodeTextRange("- [ ] 待办", "list")).toEqual({
			from: 6,
			to: 8
		});
		expect(getNodeTextRange("- [x] 完成", "list")).toEqual({
			from: 6,
			to: 8
		});
		expect(getNodeTextRange("- [X]\t完成", "list")).toEqual({
			from: 6,
			to: 8
		});
	});

	it("returns null for empty node text", () => {
		expect(getNodeTextRange("# ", "heading")).toBeNull();
		expect(getNodeTextRange("- ", "list")).toBeNull();
		expect(getNodeTextRange("- [ ]", "list")).toBeNull();
		expect(getNodeTextRange("- [x] ", "list")).toBeNull();
	});

	it("returns null when the line does not match the node type", () => {
		expect(getNodeTextRange("plain text", "list")).toBeNull();
		expect(getNodeTextRange("####", "heading")).toBeNull();
	});
});

describe("shouldClearHighlightOnChange", () => {
	it("clears the highlight when the document changes", () => {
		expect(shouldClearHighlightOnChange({ docChanged: true })).toBe(true);
	});

	it("keeps the highlight on selection-only updates", () => {
		expect(shouldClearHighlightOnChange({ docChanged: false })).toBe(false);
	});
});
