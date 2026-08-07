import type { MindNode, MindTree } from "./model";

export interface TreeTextChange {
	uid: string;
	newText: string;
}

export function diffTreeTextChanges(
	oldTree: MindTree,
	newTree: MindTree
): TreeTextChange[] | null {
	const oldNodes = flattenNodes(oldTree.roots);
	const newNodes = flattenNodes(newTree.roots);

	if (oldNodes.length !== newNodes.length) {
		return null;
	}

	const changes: TreeTextChange[] = [];
	for (let i = 0; i < oldNodes.length; i++) {
		const oldNode = oldNodes[i];
		const newNode = newNodes[i];
		if (
			oldNode.id !== newNode.id ||
			oldNode.type !== newNode.type ||
			oldNode.level !== newNode.level ||
			oldNode.mapNodeKey !== newNode.mapNodeKey ||
			(oldNode.parent?.id ?? null) !== (newNode.parent?.id ?? null) ||
			!sameHiddenLines(oldNode.hiddenLines, newNode.hiddenLines)
		) {
			return null;
		}
		if (oldNode.text !== newNode.text) {
			changes.push({ uid: newNode.id, newText: newNode.text });
		}
	}

	return changes;
}

function flattenNodes(roots: MindNode[]): MindNode[] {
	const result: MindNode[] = [];
	for (const root of roots) {
		collectNode(root, result);
	}
	return result;
}

function collectNode(node: MindNode, result: MindNode[]): void {
	result.push(node);
	for (const child of node.children) {
		collectNode(child, result);
	}
}

function sameHiddenLines(a: number[], b: number[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) {
			return false;
		}
	}
	return true;
}
