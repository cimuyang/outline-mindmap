import { describe, expect, it } from "vitest";
import { shouldTriggerJump } from "../src/jump";

describe("shouldTriggerJump", () => {
	it("returns true when click-to-jump is on and nothing blocks", () => {
		expect(
			shouldTriggerJump({
				clickToJump: true,
				isEditing: false,
				isDragging: false,
				isLink: false
			})
		).toBe(true);
	});

	it("returns false when click-to-jump is disabled", () => {
		expect(
			shouldTriggerJump({
				clickToJump: false,
				isEditing: false,
				isDragging: false,
				isLink: false
			})
		).toBe(false);
	});

	it("returns false while editing a node", () => {
		expect(
			shouldTriggerJump({
				clickToJump: true,
				isEditing: true,
				isDragging: false,
				isLink: false
			})
		).toBe(false);
	});

	it("returns false while dragging", () => {
		expect(
			shouldTriggerJump({
				clickToJump: true,
				isEditing: false,
				isDragging: true,
				isLink: false
			})
		).toBe(false);
	});

	it("returns false when the click target is a link", () => {
		expect(
			shouldTriggerJump({
				clickToJump: true,
				isEditing: false,
				isDragging: false,
				isLink: true
			})
		).toBe(false);
	});
});
