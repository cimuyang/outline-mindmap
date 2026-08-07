import {
	computeMapNodeIdentityKey,
	matchMapNodeRegistry
} from "./mapNodeRegistry";
import type {
	MapNodeCandidate,
	MapNodeRegistry
} from "./mapNodeRegistry";
import { createMindNode } from "./model";
import type { MindNode, MindTree } from "./model";

const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;
const LIST_MARKER_RE = /^([-*+]|\d+[.)])([ \t]+)(.*)$/;
const EMPTY_LIST_RE = /^([-*+]|\d+[.)])$/;
const TASK_RE = /^(\[[ xX]\])([ \t]+)(.*)$/;
const EMPTY_TASK_RE = /^\[[ xX]\]$/;
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const FRONTMATTER_RE = /^---[ \t]*$/;

interface ListMatch {
	token: string;
	separator: string;
	content: string;
}

interface TaskMatch {
	suffix: string;
	text: string;
}

export function parseMarkdown(text: string): MindTree {
	const lines = text.split(/\r?\n/);
	const roots: MindNode[] = [];
	const stack: MindNode[] = [];
	let currentHeadingLevel = 0;
	let inCode = false;
	let start = 0;

	if (lines.length > 0 && FRONTMATTER_RE.test(lines[0])) {
		const close = lines.findIndex(
			(line, index) => index > 0 && FRONTMATTER_RE.test(line)
		);
		if (close !== -1) {
			start = close + 1;
		}
	}

	const attachHidden = (lineIndex: number): void => {
		if (stack.length === 0) return;
		stack[stack.length - 1].hiddenLines.push(lineIndex);
	};

	for (let i = start; i < lines.length; i++) {
		const line = lines[i];

		if (inCode) {
			if (FENCE_RE.test(line)) inCode = false;
			attachHidden(i);
			continue;
		}

		if (FENCE_RE.test(line)) {
			inCode = true;
			attachHidden(i);
			continue;
		}

		const heading = line.match(HEADING_RE);
		if (heading) {
			const level = heading[1].length;
			currentHeadingLevel = level;
			while (stack.length > 0) {
				const top = stack[stack.length - 1];
				if (top.type === "list" || top.level >= level) {
					stack.pop();
				} else {
					break;
				}
			}
			const node = createMindNode({
				id: String(i),
				type: "heading",
				text: heading[2],
				level,
				marker: "",
				lineIndex: i
			});
			linkNode(node, stack, roots);
			stack.push(node);
			continue;
		}

		const indent = line.match(/^[ \t]*/)?.[0] ?? "";
		const list = matchList(line.slice(indent.length));
		if (list) {
			if (listShouldBeHiddenForHeadingLevel(currentHeadingLevel)) {
				attachHidden(i);
				continue;
			}
			const level = indentLevel(indent);
			const task = matchTask(list.content);
			const marker = task
				? indent + list.token + list.separator + task.suffix
				: indent + list.token + list.separator;
			const text = task ? task.text : list.content;

			while (stack.length > 0) {
				const top = stack[stack.length - 1];
				if (top.type !== "list") break;
				if (top.level >= level) {
					stack.pop();
				} else {
					break;
				}
			}

			if (stack.length === 0) {
				attachHidden(i);
				continue;
			}

			const node = createMindNode({
				id: String(i),
				type: "list",
				text,
				level,
				marker,
				lineIndex: i
			});
			linkNode(node, stack, roots);
			stack.push(node);
			continue;
		}

		if (line.trim() !== "") {
			attachHidden(i);
		}
	}

	for (const root of roots) {
		finalizeBlock(root);
	}

	return { roots };
}

export function parseMarkdownWithMapNodes(
	text: string,
	options: {
		filePath: string;
		registry: MapNodeRegistry;
	}
): MindTree {
	return parseMarkdown(text);
}

export interface MapNodeLineCandidate {
	lineIndex: number;
	parentKey: string | null;
	text: string;
	occurrence: number;
	candidateKey: string;
}

export function findMapNodeCandidateForLine(
	text: string,
	lineIndex: number,
	filePath: string
): MapNodeLineCandidate | null {
	const tree = parseMarkdown(text);
	const candidates = collectMapNodeCandidates(tree.roots, filePath);
	for (const entry of candidates.byNode.values()) {
		if (entry.node.lineIndex === lineIndex) {
			return {
				lineIndex: entry.node.lineIndex,
				parentKey: entry.parentKey,
				text: entry.text,
				occurrence: entry.occurrence,
				candidateKey: entry.candidateKey
			};
		}
	}
	return null;
}

export function getMapNodeCandidatesForMarkdown(
	text: string,
	filePath: string
): MapNodeLineCandidate[] {
	const tree = parseMarkdown(text);
	const candidates = collectMapNodeCandidates(tree.roots, filePath);
	return [...candidates.byNode.values()].map((entry) => ({
		lineIndex: entry.node.lineIndex,
		parentKey: entry.parentKey,
		text: entry.text,
		occurrence: entry.occurrence,
		candidateKey: entry.candidateKey
	}));
}

export function computeHeadingMapNodeKey(
	parentKey: string | null,
	level: number,
	text: string,
	occurrence = 1
): string {
	return headingMapNodeKey(parentKey, level, text, occurrence);
}

interface MapNodeCandidateEntry {
	node: MindNode;
	index: number;
	parentKey: string | null;
	text: string;
	occurrence: number;
	candidateKey: string;
}

interface MapNodeCandidateCollection {
	list: MapNodeCandidate[];
	byNode: Map<MindNode, MapNodeCandidateEntry>;
}

function collectMapNodeCandidates(
	roots: MindNode[],
	filePath: string
): MapNodeCandidateCollection {
	const list: MapNodeCandidate[] = [];
	const byNode = new Map<MindNode, MapNodeCandidateEntry>();
	const occurrences = new Map<string, number>();
	const headingOccurrences = new Map<string, number>();
	let index = 0;

	const visit = (node: MindNode, parentKey: string | null): void => {
		if (node.type === "heading") {
			const headingKey = headingOccurrenceKey(
				parentKey,
				node.level,
				node.text
			);
			const occurrence = (headingOccurrences.get(headingKey) ?? 0) + 1;
			headingOccurrences.set(headingKey, occurrence);
			node.mapNodeKey = headingMapNodeKey(
				parentKey,
				node.level,
				node.text,
				occurrence
			);
		} else {
			const countKey = occurrenceKey(parentKey, node.text);
			const occurrence = (occurrences.get(countKey) ?? 0) + 1;
			occurrences.set(countKey, occurrence);
			const candidateKey = computeMapNodeIdentityKey(
				filePath,
				parentKey,
				node.text,
				occurrence
			);
			byNode.set(node, {
				node,
				index,
				parentKey,
				text: node.text,
				occurrence,
				candidateKey
			});
			list.push({ parentKey, text: node.text });
			index++;
		}
		for (const child of node.children) {
			const childParentKey =
				node.type === "heading"
					? (node.mapNodeKey ?? null)
					: (byNode.get(node)?.candidateKey ?? null);
			visit(child, childParentKey);
		}
	};

	for (const root of roots) {
		visit(root, null);
	}
	return { list, byNode };
}

function pruneUnregisteredMapNodes(
	roots: MindNode[],
	byNode: Map<MindNode, MapNodeCandidateEntry>,
	matchedIndexes: Set<number>,
	recordByIndex: Map<number, { key: string }>
): MindNode[] {
	const visitChildren = (parent: MindNode): void => {
		const kept: MindNode[] = [];
		for (const child of parent.children) {
			if (child.type === "heading") {
				child.parent = parent;
				kept.push(child);
				visitChildren(child);
				continue;
			}
			const entry = byNode.get(child);
			if (entry && matchedIndexes.has(entry.index)) {
				child.mapNodeKey =
					recordByIndex.get(entry.index)?.key ?? entry.candidateKey;
				child.parent = parent;
				kept.push(child);
				visitChildren(child);
				continue;
			}
			flattenNodeToHidden(child, parent);
		}
		parent.children = kept;
	};

	for (const root of roots) {
		visitChildren(root);
	}
	return roots;
}

function flattenNodeToHidden(node: MindNode, parent: MindNode): void {
	const lines = new Set<number>(parent.hiddenLines);
	const collect = (current: MindNode): void => {
		lines.add(current.lineIndex);
		for (const hidden of current.hiddenLines) {
			lines.add(hidden);
		}
		for (const child of current.children) {
			collect(child);
		}
	};
	collect(node);
	parent.hiddenLines = [...lines].sort((a, b) => a - b);
}

function headingMapNodeKey(
	parentKey: string | null,
	level: number,
	text: string,
	occurrence = 1
): string {
	const label =
		occurrence > 1
			? `heading:${level}:${text}#${occurrence}`
			: `heading:${level}:${text}`;
	return parentKey ? `${parentKey} > ${label}` : label;
}

function occurrenceKey(parentKey: string | null, text: string): string {
	return JSON.stringify([parentKey ?? "", text]);
}

function headingOccurrenceKey(
	parentKey: string | null,
	level: number,
	text: string
): string {
	return JSON.stringify([parentKey ?? "", level, text]);
}

export function listShouldBeHiddenForHeadingLevel(level: number): boolean {
	return false;
}

function linkNode(node: MindNode, stack: MindNode[], roots: MindNode[]): void {
	if (stack.length === 0) {
		roots.push(node);
		return;
	}
	const parent = stack[stack.length - 1];
	node.parent = parent;
	parent.children.push(node);
}

function matchList(line: string): ListMatch | null {
	const normal = line.match(LIST_MARKER_RE);
	if (normal) {
		return { token: normal[1], separator: normal[2], content: normal[3] };
	}
	const empty = line.match(EMPTY_LIST_RE);
	if (empty) {
		return { token: empty[1], separator: "", content: "" };
	}
	return null;
}

function matchTask(content: string): TaskMatch | null {
	const normal = content.match(TASK_RE);
	if (normal) {
		return { suffix: normal[1] + normal[2], text: normal[3] };
	}
	const empty = content.match(EMPTY_TASK_RE);
	if (empty) {
		return { suffix: empty[0], text: "" };
	}
	return null;
}

function indentLevel(indent: string): number {
	let level = 0;
	for (const char of indent) {
		level += char === "\t" ? 4 : 1;
	}
	return level;
}

function finalizeBlock(node: MindNode): number {
	let end = node.lineIndex;
	for (const hidden of node.hiddenLines) {
		end = Math.max(end, hidden);
	}
	for (const child of node.children) {
		end = Math.max(end, finalizeBlock(child));
	}
	node.blockEnd = end;
	return end;
}
