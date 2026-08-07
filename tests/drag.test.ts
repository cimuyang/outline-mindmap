import { describe, expect, it } from "vitest";
import { resolveBlankDropAction } from "../src/drag";

describe("resolveBlankDropAction", () => {
	it("returns none for an existing H1 root", () => {
		expect(resolveBlankDropAction("heading", 1)).toBe("none");
	});

	it("promotes H2-H6 headings dropped on blank canvas", () => {
		for (let level = 2; level <= 6; level++) {
			expect(resolveBlankDropAction("heading", level)).toBe("promote");
		}
	});

	it("promotes list items dropped on blank canvas", () => {
		expect(resolveBlankDropAction("list", 0)).toBe("promote");
		expect(resolveBlankDropAction("list", 3)).toBe("promote");
	});
});
