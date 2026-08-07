import { describe, expect, it } from "vitest";
import { resolveFocusStrategy } from "../src/focus";
import type { FocusStrategy } from "../src/focus";

describe("resolveFocusStrategy", () => {
	const matrix: Array<{
		renderPending: boolean;
		nodeFound: boolean;
		isRoot: boolean;
		expected: FocusStrategy;
	}> = [
		{ renderPending: false, nodeFound: false, isRoot: false, expected: "defer" },
		{ renderPending: false, nodeFound: false, isRoot: true, expected: "defer" },
		{ renderPending: false, nodeFound: true, isRoot: false, expected: "edit-now" },
		{ renderPending: false, nodeFound: true, isRoot: true, expected: "drop" },
		{ renderPending: true, nodeFound: false, isRoot: false, expected: "defer" },
		{ renderPending: true, nodeFound: false, isRoot: true, expected: "defer" },
		{ renderPending: true, nodeFound: true, isRoot: false, expected: "defer" },
		{ renderPending: true, nodeFound: true, isRoot: true, expected: "defer" }
	];

	it("covers the full renderPending x nodeFound x isRoot matrix", () => {
		for (const item of matrix) {
			expect(
				resolveFocusStrategy({
					renderPending: item.renderPending,
					nodeFound: item.nodeFound,
					isRoot: item.isRoot
				})
			).toBe(item.expected);
		}
	});
});
