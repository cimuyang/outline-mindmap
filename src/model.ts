export type MindNodeType = "heading" | "list";

export interface MindNode {
	id: string;
	type: MindNodeType;
	text: string;
	level: number;
	marker: string;
	lineIndex: number;
	blockStart: number;
	blockEnd: number;
	hiddenLines: number[];
	mapNodeKey?: string;
	children: MindNode[];
	parent: MindNode | null;
}

export interface MindTree {
	roots: MindNode[];
}

export function createMindNode(params: {
	id: string;
	type: MindNodeType;
	text: string;
	level: number;
	marker: string;
	lineIndex: number;
}): MindNode {
	return {
		...params,
		blockStart: params.lineIndex,
		blockEnd: params.lineIndex,
		hiddenLines: [],
		children: [],
		parent: null
	};
}

export function walkMindTree(roots: MindNode[], visit: (node: MindNode) => void): void {
	const stack = [...roots];
	while (stack.length > 0) {
		const node = stack.pop() as MindNode;
		visit(node);
		for (let i = node.children.length - 1; i >= 0; i--) {
			stack.push(node.children[i]);
		}
	}
}
