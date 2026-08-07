import type MindMap from "simple-mind-map";
import type { MindMapNodeInstance } from "simple-mind-map";

export type ShortcutInsertPosition = "before" | "after";

export interface NodeShortcutHandlers {
	onAddChild: (node: MindMapNodeInstance) => void;
	onAddSibling: (
		node: MindMapNodeInstance,
		position: ShortcutInsertPosition
	) => void;
	onDelete: (nodes: MindMapNodeInstance[]) => void;
	onToggleExpand: (node: MindMapNodeInstance) => void;
	onEdit: (node: MindMapNodeInstance) => void;
}

export type EditorKeyAction =
	| "cancel"
	| "commit"
	| "commit-and-add-child"
	| null;

export interface EditorKeyState {
	key: string;
	shiftKey: boolean;
	isComposing: boolean;
}

export function resolveEditorKeyAction(state: EditorKeyState): EditorKeyAction {
	if (state.isComposing) {
		return null;
	}
	if (state.key === "Escape") {
		return "cancel";
	}
	if (state.key === "Enter" && !state.shiftKey) {
		return "commit";
	}
	if (state.key === "Tab" && !state.shiftKey) {
		return "commit-and-add-child";
	}
	return null;
}

export function installNodeShortcuts(
	mindMap: MindMap,
	handlers: NodeShortcutHandlers
): () => void {
	const runOnActiveNode = (fn: (node: MindMapNodeInstance) => void): void => {
		const node = mindMap.renderer.activeNodeList[0];
		if (node && !node.isRoot) {
			fn(node);
		}
	};
	const runOnActiveNodes = (
		fn: (nodes: MindMapNodeInstance[]) => void
	): void => {
		const nodes = mindMap.renderer.activeNodeList.filter(
			(node) => !node.isRoot
		);
		if (nodes.length > 0) {
			fn(nodes);
		}
	};

	const bindings: Array<[string, () => void]> = [
		["Tab", () => runOnActiveNode(handlers.onAddChild)],
		[
			"Enter",
			() => runOnActiveNode((node) => handlers.onAddSibling(node, "after"))
		],
		[
			"Shift+Enter",
			() => runOnActiveNode((node) => handlers.onAddSibling(node, "before"))
		],
		["Del|Backspace", () => runOnActiveNodes(handlers.onDelete)],
		["F2", () => runOnActiveNode(handlers.onEdit)],
		["Spacebar", () => runOnActiveNode(handlers.onToggleExpand)]
	];

	for (const [key, fn] of bindings) {
		mindMap.keyCommand.addShortcut(key, fn);
	}

	return () => {
		for (const [key] of bindings) {
			mindMap.keyCommand.removeShortcut(key);
		}
	};
}
