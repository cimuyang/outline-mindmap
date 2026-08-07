import { describe, expect, it, vi } from "vitest";
import type { MindMapNodeInstance } from "simple-mind-map";
import {
	installNodeShortcuts,
	resolveEditorKeyAction,
	type NodeShortcutHandlers
} from "../src/shortcuts";

type MindMapLike = Parameters<typeof installNodeShortcuts>[0];

function createHarness() {
	const registered = new Map<string, Array<() => void>>();
	const keyCommand = {
		addShortcut: vi.fn((key: string, fn: () => void) => {
			const list = registered.get(key) ?? [];
			list.push(fn);
			registered.set(key, list);
		}),
		removeShortcut: vi.fn((key: string) => {
			registered.delete(key);
		})
	};
	const mindMap = {
		keyCommand,
		renderer: {
			activeNodeList: [] as MindMapNodeInstance[]
		}
	} as unknown as MindMapLike;
	return {
		mindMap,
		registered,
		setActive(node: MindMapNodeInstance | null) {
			mindMap.renderer.activeNodeList = node ? [node] : [];
		},
		setActiveList(nodes: MindMapNodeInstance[]) {
			mindMap.renderer.activeNodeList = nodes;
		}
	};
}

function createHandlers(): NodeShortcutHandlers {
	return {
		onAddChild: vi.fn(),
		onAddSibling: vi.fn(),
		onDelete: vi.fn(),
		onToggleExpand: vi.fn(),
		onEdit: vi.fn()
	};
}

describe("installNodeShortcuts", () => {
	it("registers the node operation shortcut keys", () => {
		const { mindMap, registered } = createHarness();
		installNodeShortcuts(mindMap, createHandlers());
		expect([...registered.keys()]).toEqual([
			"Tab",
			"Enter",
			"Shift+Enter",
			"Del|Backspace",
			"F2",
			"Spacebar"
		]);
	});

	it("ignores root nodes and dispatches operations for active nodes", () => {
		const handlers = createHandlers();
		const { mindMap, registered, setActive } = createHarness();
		installNodeShortcuts(mindMap, handlers);

		setActive({ isRoot: true } as unknown as MindMapNodeInstance);
		registered.get("Tab")?.[0]();
		expect(handlers.onAddChild).not.toHaveBeenCalled();

		setActive({ isRoot: false } as unknown as MindMapNodeInstance);
		registered.get("Tab")?.[0]();
		expect(handlers.onAddChild).toHaveBeenCalledTimes(1);
		registered.get("Enter")?.[0]();
		expect(handlers.onAddSibling).toHaveBeenCalledWith(
			expect.objectContaining({ isRoot: false }),
			"after"
		);
		registered.get("Shift+Enter")?.[0]();
		expect(handlers.onAddSibling).toHaveBeenCalledWith(
			expect.objectContaining({ isRoot: false }),
			"before"
		);
		registered.get("F2")?.[0]();
		expect(handlers.onEdit).toHaveBeenCalledTimes(1);
		registered.get("Del|Backspace")?.[0]();
		expect(handlers.onDelete).toHaveBeenCalledWith([
			expect.objectContaining({ isRoot: false })
		]);
		registered.get("Spacebar")?.[0]();
		expect(handlers.onToggleExpand).toHaveBeenCalledTimes(1);
	});

	it("passes all non-root active nodes to delete", () => {
		const handlers = createHandlers();
		const { mindMap, registered, setActiveList } = createHarness();
		installNodeShortcuts(mindMap, handlers);

		const root = { isRoot: true } as unknown as MindMapNodeInstance;
		const a = { isRoot: false } as unknown as MindMapNodeInstance;
		const b = { isRoot: false } as unknown as MindMapNodeInstance;
		setActiveList([root, a, b]);
		registered.get("Del|Backspace")?.[0]();

		expect(handlers.onDelete).toHaveBeenCalledWith([a, b]);
	});

	it("cleanup removes every registered shortcut", () => {
		const { mindMap, registered } = createHarness();
		const unbind = installNodeShortcuts(mindMap, createHandlers());
		expect(registered.size).toBe(6);
		unbind();
		expect(registered.size).toBe(0);
	});
});

describe("resolveEditorKeyAction", () => {
	it("returns null for every key during IME composition", () => {
		expect(
			resolveEditorKeyAction({
				key: "Enter",
				shiftKey: false,
				isComposing: true
			})
		).toBeNull();
		expect(
			resolveEditorKeyAction({
				key: "Tab",
				shiftKey: false,
				isComposing: true
			})
		).toBeNull();
		expect(
			resolveEditorKeyAction({
				key: "Escape",
				shiftKey: false,
				isComposing: true
			})
		).toBeNull();
	});

	it("maps Enter to commit and Tab to commit plus add child", () => {
		expect(
			resolveEditorKeyAction({
				key: "Enter",
				shiftKey: false,
				isComposing: false
			})
		).toBe("commit");
		expect(
			resolveEditorKeyAction({
				key: "Tab",
				shiftKey: false,
				isComposing: false
			})
		).toBe("commit-and-add-child");
		expect(
			resolveEditorKeyAction({
				key: "Escape",
				shiftKey: false,
				isComposing: false
			})
		).toBe("cancel");
	});

	it("leaves Shift+Enter, Shift+Tab and other keys alone", () => {
		expect(
			resolveEditorKeyAction({
				key: "Enter",
				shiftKey: true,
				isComposing: false
			})
		).toBeNull();
		expect(
			resolveEditorKeyAction({
				key: "Tab",
				shiftKey: true,
				isComposing: false
			})
		).toBeNull();
		expect(
			resolveEditorKeyAction({
				key: "a",
				shiftKey: false,
				isComposing: false
			})
		).toBeNull();
	});
});
