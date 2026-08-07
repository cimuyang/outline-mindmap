import { describe, expect, it } from "vitest";
import {
	filterCollapsedUids,
	getViewState,
	removeViewStatesForFile,
	removeViewState,
	renameViewStatesForFile,
	renameViewState,
	sanitizeViewState,
	sanitizeViewStates,
	setViewState
} from "../src/viewState";
import type { MindMapViewState } from "../src/viewState";

describe("view state persistence helpers", () => {
	it("sanitizes view states and drops empty or invalid entries", () => {
		expect(sanitizeViewState(null)).toBeNull();
		expect(
			sanitizeViewState({ collapsed: [], transform: undefined })
		).toBeNull();
		expect(
			sanitizeViewState({
				collapsed: ["1", 2],
				transform: null,
				lastOpened: 10
			})
		).toEqual({ collapsed: ["1"], lastOpened: 10 });
		expect(
			sanitizeViewStates({
				keep: {
					collapsed: ["0"],
					transform: { x: 1 },
					lastOpened: 10
				},
				bad: null,
				empty: { collapsed: [], transform: undefined }
			})
		).toEqual({
			keep: {
				collapsed: ["0"],
				transform: { x: 1 },
				lastOpened: 10
			}
		});
	});

	it("gets a sanitized state by file path", () => {
		const states: Record<string, MindMapViewState> = {
			"note.md": {
				collapsed: ["0", "3"],
				transform: { x: 12, y: 4, scale: 0.8 },
				lastOpened: 10
			}
		};
		expect(getViewState(states, "note.md")).toEqual({
			collapsed: ["0", "3"],
			transform: { x: 12, y: 4, scale: 0.8 },
			lastOpened: 10
		});
		expect(getViewState(states, "missing.md")).toBeNull();
	});

	it("stores states and evicts the least recently opened entry", () => {
		let states: Record<string, MindMapViewState> = {};
		states = setViewState(
			states,
			"a.md",
			{ collapsed: [], transform: { x: 1 }, lastOpened: 1 },
			3,
			10
		);
		states = setViewState(
			states,
			"b.md",
			{ collapsed: [], transform: { x: 2 }, lastOpened: 2 },
			3,
			20
		);
		states = setViewState(
			states,
			"c.md",
			{ collapsed: [], transform: { x: 3 }, lastOpened: 3 },
			3,
			30
		);
		states = setViewState(
			states,
			"d.md",
			{ collapsed: [], transform: { x: 4 }, lastOpened: 4 },
			3,
			40
		);

		expect(Object.keys(states).sort()).toEqual(["b.md", "c.md", "d.md"]);
		expect(states["d.md"].lastOpened).toBe(40);
	});

	it("removes an empty state when saving", () => {
		const states = {
			"a.md": {
				collapsed: ["1"],
				transform: { x: 1 },
				lastOpened: 10
			}
		};
		const next = setViewState(
			states,
			"a.md",
			{ collapsed: [], transform: undefined, lastOpened: 20 },
			10,
			20
		);
		expect(next).toEqual({});
	});

	it("removes and renames view states", () => {
		const states = {
			"old.md": {
				collapsed: ["0"],
				transform: { x: 1 },
				lastOpened: 10
			},
			"keep.md": {
				collapsed: [],
				transform: { x: 2 },
				lastOpened: 20
			}
		};
		expect(removeViewState(states, "old.md")).toEqual({
			"keep.md": states["keep.md"]
		});
		expect(renameViewState(states, "old.md", "new.md")).toEqual({
			"new.md": states["old.md"],
			"keep.md": states["keep.md"]
		});
	});

	it("removes and renames all per-leaf view states for a file", () => {
		let states: Record<string, MindMapViewState> = {};
		states = setViewState(
			states,
			"note.md::tab",
			{ collapsed: ["1"], lastOpened: 1 }
		);
		states = setViewState(
			states,
			"note.md::right",
			{ collapsed: ["2"], lastOpened: 2 }
		);
		states = setViewState(
			states,
			"other.md::tab",
			{ collapsed: ["3"], lastOpened: 3 }
		);

		expect(Object.keys(removeViewStatesForFile(states, "note.md"))).toEqual([
			"other.md::tab"
		]);

		const renamed = renameViewStatesForFile(
			states,
			"note.md",
			"renamed.md"
		);
		expect(Object.keys(renamed).sort()).toEqual([
			"other.md::tab",
			"renamed.md::right",
			"renamed.md::tab"
		]);
	});

	it("only restores collapsed uids that still exist", () => {
		const states = {
			"note.md": {
				collapsed: ["0", "8", "2"],
				transform: undefined,
				lastOpened: 10
			}
		};
		expect(
			[...filterCollapsedUids(states, "note.md", ["0", "2"])]
		).toEqual(["0", "2"]);
	});
});
