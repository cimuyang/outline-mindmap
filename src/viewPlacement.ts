export type ViewPlacement = "tab" | "right";

export interface WorkspaceNodeLike {
	parent?: WorkspaceNodeLike | null;
}

export interface WorkspaceLeafLike {
	parent?: WorkspaceNodeLike | null;
}

export function isInRightSidebar(
	leaf: WorkspaceLeafLike,
	rightSplit: WorkspaceNodeLike | null | undefined
): boolean {
	if (!rightSplit) {
		return false;
	}
	let current: WorkspaceNodeLike | null | undefined = leaf.parent;
	while (current) {
		if (current === rightSplit) {
			return true;
		}
		current = current.parent;
	}
	return false;
}

export function findMindMapLeaf<T extends WorkspaceLeafLike>(
	leaves: T[],
	placement: ViewPlacement,
	rightSplit: WorkspaceNodeLike | null | undefined
): T | null {
	const target = placement === "right";
	return (
		leaves.find(
			(leaf) => isInRightSidebar(leaf, rightSplit) === target
		) ?? null
	);
}
