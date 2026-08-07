import { walkMindTree } from "./model";
import type { MindNode } from "./model";
import { parseMarkdown } from "./parser";

export type InsertPosition = "before" | "after";
export type MoveMode = "child" | "before" | "after";

export function willBecomeListLevel(
	node: MindNode,
	target: MindNode,
	mode: MoveMode
): boolean {
	if (node.type !== "heading") {
		return false;
	}
	if (target.type === "list") {
		return true;
	}
	return (
		target.type === "heading" &&
		mode === "child" &&
		target.level + 1 > 6
	);
}

const LINE_SPLIT_RE = /\r?\n/;
const HEADING_LINE_RE = /^(#{1,6})[ \t]+/;
const LIST_MARKER_RE = /^(\s*)([-*+]|\d+[.)])(.*)$/;
const ORDERED_TOKEN_RE = /^(\d+)([.)])$/;
const FENCE_LINE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const BLOCKQUOTE_LINE_RE = /^[ \t]{0,3}>/;
const TABLE_LINE_RE = /^[ \t]{0,3}\|/;
const TASK_LINE_RE = /^\s*\[[ xX]\]\s/;

interface BlockLine {
	lineIndex: number;
	text: string;
}

interface InsertBlockResult {
	lines: string[];
	lineIndex: number;
}

function headingLine(level: number, text: string): string {
	return "#".repeat(level) + " " + text;
}

function headingWithPlaceholder(
	level: number,
	text: string,
	strictHeadingSpacing: boolean
): string[] {
	return strictHeadingSpacing
		? [headingLine(level, text), "", "", ""]
		: [headingLine(level, text), ""];
}

function insertBlockAt(
	lines: string[],
	insertAt: number,
	block: string[],
	skipBlanks = true,
	blankBefore = skipBlanks
): InsertBlockResult {
	let index = insertAt;
	if (skipBlanks) {
		while (index < lines.length && lines[index].trim() === "") {
			index++;
		}
	}
	if (blankBefore && index > 0 && lines[index - 1].trim() !== "") {
		lines.splice(index, 0, "");
		index++;
	}
	lines.splice(index, 0, ...block);
	return { lines, lineIndex: index };
}

export function updateNodeText(text: string, node: MindNode, newText: string): string {
	const lines = splitLines(text);
	lines[node.lineIndex] =
		node.type === "heading"
			? "#".repeat(node.level) + " " + newText
			: markerWithText(node.marker, newText);
	return joinLines(lines, text);
}

export function renumberOrderedSiblingGroups(
	text: string,
	affectedLineIndexes?: Set<number>,
	affectedTexts?: Set<string>
): string {
	const tree = parseMarkdown(text);
	const lines = splitLines(text);
	const groups: MindNode[][] = [];
	collectOrderedGroups(
		tree.roots,
		groups,
		affectedLineIndexes,
		affectedTexts
	);

	for (const group of groups) {
		const suffix = orderedMarkerSuffix(group[0].marker);
		group.forEach((node, index) => {
			const line = lines[node.lineIndex];
			if (line !== undefined) {
				lines[node.lineIndex] = rewriteOrderedLine(
					line,
					index + 1,
					suffix
				);
			}
		});
	}

	return joinLines(lines, text);
}

export function appendRootNode(
	text: string,
	newText = "",
	strictHeadingSpacing = true
): { text: string; lineIndex: number } {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const block = headingWithPlaceholder(1, newText, strictHeadingSpacing);
	if (text === "") {
		return { text: block.join(eol), lineIndex: 0 };
	}
	const lines = splitLines(text);
	const inserted = insertBlockAt(lines, lines.length, block, true);
	const resultText = joinLines(inserted.lines, text);
	return {
		text: resultText,
		lineIndex: inserted.lineIndex
	};
}

export function promoteToRoot(
	text: string,
	node: MindNode,
	strictHeadingSpacing = true
): { text: string; lineIndex: number } {
	if (node.type === "heading" && node.level === 1) {
		throw new Error("根节点无需提升");
	}

	const lines = splitLines(text);
	const eol = text.includes("\r\n") ? "\r\n" : "\n";

	const structureIndexes = new Set<number>();
	const structureNodes = new Map<number, MindNode>();
	walkMindTree([node], (current) => {
		structureIndexes.add(current.lineIndex);
		structureNodes.set(current.lineIndex, current);
	});

	const blockLines: BlockLine[] = [];
	for (let i = node.blockStart; i <= node.blockEnd; i++) {
		if (lines[i].trim() !== "") {
			blockLines.push({ lineIndex: i, text: lines[i] });
		}
	}

	const newLevelOf = (current: MindNode): number => treeDepth(current, node) + 1;
	const outputLines = normalizeMovedBlockLines(
		blockLines,
		structureIndexes,
		structureNodes,
		(current) => {
			const newLevel = newLevelOf(current);
			if (newLevel <= 6) {
				return "#".repeat(newLevel) + " " + current.text;
			}
			return markerWithText(newMarkerForLevel(current, newLevel), current.text);
		},
		(current) => newMarkerForLevel(current, newLevelOf(current))
	);

	const remaining: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (i >= node.blockStart && i <= node.blockEnd && lines[i].trim() !== "") {
			continue;
		}
		remaining.push(lines[i]);
	}

	const base = remaining.join(eol);

	let resultText = "";
	if (remaining.length > 0 && base !== "") {
		resultText += base;
		if (!base.endsWith(eol)) {
			resultText += eol;
		}
		const baseContent = base.endsWith(eol) ? base.slice(0, -eol.length) : base;
		const lastLine = baseContent.split(eol).pop() ?? "";
		if (lastLine.trim() !== "") {
			resultText += eol;
		}
	}
	resultText += outputLines.join(eol) + eol;

	const tree = parseMarkdown(resultText);
	const lastRoot = tree.roots[tree.roots.length - 1];
	if (lastRoot === undefined || lastRoot.text !== node.text) {
		throw new Error("提升为根节点后校验失败");
	}
	const finalText = containsList(node)
		? renumberOrderedSiblingGroups(
				resultText,
				undefined,
				collectOrderedAffectedTexts([node])
			)
		: resultText;
	return { text: finalText, lineIndex: lastRoot.lineIndex };
}

function normalizeMovedBlockLines(
	blockLines: BlockLine[],
	structureIndexes: Set<number>,
	structureNodes: Map<number, MindNode>,
	rewriteStructureOf: (current: MindNode) => string,
	newMarkerOf: (current: MindNode) => string
): string[] {
	const output: string[] = [];
	const headingFlags: boolean[] = [];
	let prevIsHeadingPara = false;
	let inCode = false;
	for (const item of blockLines) {
		if (item.text.trim() === "") {
			output.push("");
			headingFlags.push(false);
			continue;
		}
		if (structureIndexes.has(item.lineIndex)) {
			const current = structureNodes.get(item.lineIndex);
			if (current === undefined) {
				headingFlags.push(false);
				continue;
			}
			const rewritten = rewriteStructureOf(current);
			output.push(rewritten);
			headingFlags.push(HEADING_LINE_RE.test(rewritten));
			prevIsHeadingPara = false;
		} else {
			if (FENCE_LINE_RE.test(item.text)) {
				inCode = !inCode;
			}
			const owner = nearestStructureNode(item.lineIndex, structureNodes);
			const newMarker = owner === undefined ? "" : newMarkerOf(owner);
			const shifted =
				owner === undefined
					? item.text
					: shiftHiddenContent(item.text, owner, newMarkerOf);
			const isHeadingPara =
				!inCode && newMarker === "" && isPlainParagraphLine(shifted);
			// 列表转标题时，原 Shift+Enter 续行若仍保留 4 个及以上前导空格，
			// 会被 Markdown 渲染成缩进代码块；统一去缩进为标准段落。
			let lineToPush = shifted;
			if (isHeadingPara && owner?.type === "list" && /^[ \t]{4,}/.test(shifted)) {
				lineToPush = shifted.replace(/^[ \t]+/, "");
			}
			if (isHeadingPara && prevIsHeadingPara) {
				output.push("");
				headingFlags.push(false);
			}
			output.push(lineToPush);
			headingFlags.push(false);
			prevIsHeadingPara = isHeadingPara;
		}
	}
	return normalizeHeadingBlockSpacing(output, headingFlags);
}

function normalizeHeadingBlockSpacing(lines: string[], headingFlags: boolean[]): string[] {
	const output: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const isHeading = headingFlags[i] === true;
		const prev = output[output.length - 1];
		if (isHeading && prev !== undefined && prev.trim() !== "") {
			output.push("");
		}
		output.push(line);
		const next = lines[i + 1];
		if (isHeading && (next === undefined || next.trim() !== "")) {
			output.push("");
		}
	}
	return output;
}

function newMarkerForLevel(current: MindNode, newLevel: number): string {
	if (newLevel <= 6) {
		return "";
	}
	const indent = "\t".repeat(Math.max(0, newLevel - 7));
	if (current.type === "list") {
		return indent + markerTextWithoutLeading(current.marker);
	}
	return indent + "- ";
}

function nearestStructureNode(
	lineIndex: number,
	structureNodes: Map<number, MindNode>
): MindNode | undefined {
	for (const node of structureNodes.values()) {
		if (node.hiddenLines.includes(lineIndex)) {
			return node;
		}
	}
	let found: MindNode | undefined;
	for (const [index, node] of structureNodes) {
		if (index <= lineIndex && (found === undefined || index > found.lineIndex)) {
			found = node;
		}
	}
	return found;
}

function shiftHiddenContent(
	line: string,
	owner: MindNode,
	newMarkerOf: (current: MindNode) => string
): string {
	const oldLeading = leadingWhitespace(line);
	const newMarker = newMarkerOf(owner);
	if (newMarker !== "" && isListContentLine(line)) {
		const relWidth = Math.max(
			0,
			indentWidth(oldLeading) - contentBaseWidth(owner.marker)
		);
		const extraTabs = relWidth > 0 ? Math.ceil(relWidth / 4) : 0;
		return (
			leadingWhitespace(newMarker) +
			"\t".repeat(1 + extraTabs) +
			line.slice(oldLeading.length)
		);
	}
	const newBase = contentBaseWidth(newMarker);
	if (oldLeading === "") {
		return newBase > 0 ? " ".repeat(newBase) + line : line;
	}
	const oldWidth = indentWidth(oldLeading);
	const oldBase = contentBaseWidth(owner.marker);
	const newWidth = Math.max(0, oldWidth - oldBase) + newBase;
	return " ".repeat(newWidth) + line.slice(oldLeading.length);
}

function isListContentLine(line: string): boolean {
	if (TASK_LINE_RE.test(line)) {
		return true;
	}
	const indent = leadingWhitespace(line);
	return /^([-*+]|\d+[.)])([ \t]+|$)/.test(line.slice(indent.length));
}

function contentBaseWidth(marker: string): number {
	const leading = leadingWhitespace(marker);
	return indentWidth(leading) + marker.slice(leading.length).length;
}

function isPlainParagraphLine(line: string): boolean {
	if (line.trim() === "") {
		return false;
	}
	if (FENCE_LINE_RE.test(line)) {
		return false;
	}
	if (BLOCKQUOTE_LINE_RE.test(line)) {
		return false;
	}
	if (TABLE_LINE_RE.test(line)) {
		return false;
	}
	if (HEADING_LINE_RE.test(line)) {
		return false;
	}
	if (TASK_LINE_RE.test(line)) {
		return false;
	}
	const indent = leadingWhitespace(line);
	const rest = line.slice(indent.length);
	if (/^([-*+]|\d+[.)])([ \t]+|$)/.test(rest)) {
		return false;
	}
	return true;
}

export function addChildNode(
	text: string,
	parent: MindNode,
	newText: string,
	strictHeadingSpacing = true
): { text: string; lineIndex: number } {
	const lines = splitLines(text);
	if (parent.type === "heading") {
		if (parent.level < 6) {
			const inserted = insertBlockAt(
				lines,
				parent.blockEnd + 1,
				headingWithPlaceholder(
					parent.level + 1,
					newText,
					strictHeadingSpacing
				),
				true
			);
			return { text: joinLines(inserted.lines, text), lineIndex: inserted.lineIndex };
		}
		const childLine = makeListLine("", "-", "", newText);
		const inserted = insertBlockAt(lines, parent.blockEnd + 1, [childLine], false, true);
		return { text: joinLines(inserted.lines, text), lineIndex: inserted.lineIndex };
	}
	const childLine = makeListLine(listChildIndent(parent.marker), "-", "", newText);
	const inserted = insertBlockAt(lines, parent.blockEnd + 1, [childLine], false, false);
	return { text: joinLines(inserted.lines, text), lineIndex: inserted.lineIndex };
}

export function addSiblingNode(
	text: string,
	node: MindNode,
	newText: string,
	position: InsertPosition,
	strictHeadingSpacing = true
): { text: string; lineIndex: number } {
	const lines = splitLines(text);
	let block: string[];
	let skipBlanks = true;
	if (node.type === "heading") {
		block = headingWithPlaceholder(
			node.level,
			newText,
			strictHeadingSpacing
		);
	} else {
		skipBlanks = false;
		const parts = parseListMarker(node.marker);
		block = [
			makeListLine(
				leadingWhitespace(node.marker),
				siblingToken(parts.token, position),
				parts.suffix,
				newText
			)
		];
	}
	const inserted = insertBlockAt(
		lines,
		position === "before" ? node.blockStart : node.blockEnd + 1,
		block,
		skipBlanks,
		skipBlanks
	);
	const resultText = joinLines(inserted.lines, text);
	const affectedLineIndexes = new Set<number>([inserted.lineIndex]);
	const affectedTexts = new Set<string>([node.text, newText]);
	return {
		text:
			node.type === "list" && isOrderedMarker(node.marker)
				? renumberOrderedSiblingGroups(
						resultText,
						affectedLineIndexes,
						affectedTexts
					)
				: resultText,
		lineIndex: inserted.lineIndex
	};
}

export function deleteNode(text: string, node: MindNode): string {
	const lines = splitLines(text);
	const remaining: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (i >= node.blockStart && i <= node.blockEnd) {
			continue;
		}
		remaining.push(lines[i]);
	}
	const resultText = joinLines(
		normalizeDeletionGap(remaining, node.blockStart, node, text),
		text
	);
	return containsList(node)
		? renumberOrderedSiblingGroups(
				resultText,
				undefined,
				collectOrderedAffectedTexts([node])
			)
		: resultText;
}

export interface DeleteNodesResult {
	text: string;
	focusLine: number;
}

export function deleteNodesDetailed(
	text: string,
	nodes: MindNode[]
): DeleteNodesResult {
	const topLevel = topLevelSelectedNodes(nodes);
	const sortedDesc = [...topLevel].sort(
		(a, b) => b.blockStart - a.blockStart
	);
	let result = text;
	for (const node of sortedDesc) {
		result = deleteNode(result, node);
	}
	const first = [...topLevel].sort(
		(a, b) => a.blockStart - b.blockStart
	)[0];
	const focusLine = first
		? findNearestStructureLine(
				parseMarkdown(result).roots,
				first.blockStart
			)
		: 0;
	return { text: result, focusLine };
}

export function deleteNodes(text: string, nodes: MindNode[]): string {
	return deleteNodesDetailed(text, nodes).text;
}

function topLevelSelectedNodes(nodes: MindNode[]): MindNode[] {
	const unique = nodes.filter(
		(node, index, all) =>
			all.findIndex((candidate) => candidate.id === node.id) === index
	);
	const selected = new Set(unique.map((node) => node.id));
	return unique.filter((node) => {
		for (
			let current: MindNode | null = node.parent;
			current !== null;
			current = current.parent
		) {
			if (selected.has(current.id)) {
				return false;
			}
		}
		return true;
	});
}

function collectOrderedAffectedTexts(nodes: MindNode[]): Set<string> {
	const texts = new Set<string>();
	walkMindTree(nodes, (node) => {
		texts.add(node.text);
		if (node.parent) {
			for (const sibling of node.parent.children) {
				texts.add(sibling.text);
			}
		}
	});
	return texts;
}

function findNearestStructureLine(
	roots: MindNode[],
	targetLine: number
): number {
	let bestLine = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	const visit = (node: MindNode): void => {
		const distance = Math.abs(node.lineIndex - targetLine);
		if (
			distance < bestDistance ||
			(distance === bestDistance && node.lineIndex > bestLine)
		) {
			bestDistance = distance;
			bestLine = node.lineIndex;
		}
		for (const child of node.children) {
			visit(child);
		}
	};
	for (const root of roots) {
		visit(root);
	}
	return bestLine;
}

function normalizeDeletionGap(
	lines: string[],
	insertion: number,
	node: MindNode,
	original: string
): string[] {
	const before = lines.slice(0, insertion);
	const after = lines.slice(insertion);
	const prevIndex = lastNonEmptyLine(before);
	const nextIndex = firstNonEmptyLine(after);
	const trimmedBefore = prevIndex === -1 ? [] : before.slice(0, prevIndex + 1);
	const trimmedAfter = nextIndex === -1 ? [] : after.slice(nextIndex);
	const prev = trimmedBefore[trimmedBefore.length - 1];
	const next = trimmedAfter[0];

	if (
		prev !== undefined &&
		next !== undefined &&
		shouldKeepDeletionBlank(node, prev, next)
	) {
		trimmedBefore.push("");
	}

	const result = [...trimmedBefore, ...trimmedAfter];
	if (
		result.length > 0 &&
		(original.endsWith("\r\n") || original.endsWith("\n")) &&
		result[result.length - 1] !== ""
	) {
		result.push("");
	}
	return result;
}

function lastNonEmptyLine(lines: string[]): number {
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i].trim() !== "") {
			return i;
		}
	}
	return -1;
}

function firstNonEmptyLine(lines: string[]): number {
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() !== "") {
			return i;
		}
	}
	return -1;
}

function shouldKeepDeletionBlank(
	node: MindNode,
	prev: string,
	next: string
): boolean {
	if (HEADING_LINE_RE.test(next) || node.type === "heading") {
		return true;
	}
	const prevIsList = LIST_MARKER_RE.test(prev);
	const nextIsList = LIST_MARKER_RE.test(next);
	if (node.type === "list" && prevIsList && nextIsList) {
		return false;
	}
	return isPlainParagraphLine(prev) || isPlainParagraphLine(next);
}

function rewriteMovedBlockLines(
	text: string,
	node: MindNode,
	target: MindNode,
	mode: MoveMode
): string[] {
	const lines = splitLines(text);
	const start = node.blockStart;
	const end = node.blockEnd;
	const structureIndexes = new Set<number>();
	const structureNodes = new Map<number, MindNode>();
	walkMindTree([node], (current) => {
		structureIndexes.add(current.lineIndex);
		structureNodes.set(current.lineIndex, current);
	});

	const blockLines: BlockLine[] = [];
	for (let i = start; i <= end; i++) {
		if (lines[i].trim() !== "") {
			blockLines.push({ lineIndex: i, text: lines[i] });
		}
	}

	const newDepth =
		target.type === "heading"
			? mode === "child"
				? target.level + 1
				: target.level
			: 0;
	const listToHeading =
		node.type === "list" &&
		target.type === "heading" &&
		newDepth <= 6;
	const headingToList =
		node.type === "heading" &&
		(target.type === "list" ||
			(target.type === "heading" &&
				mode === "child" &&
				newDepth > 6));

	let rewriteStructureOf: (current: MindNode) => string;
	let newMarkerOf: (current: MindNode) => string;
	if (listToHeading) {
		const indentFor = (current: MindNode): string =>
			"\t".repeat(Math.max(0, listRelDepth(current, node) - 1));
		rewriteStructureOf = (current) => {
			if (current === node) {
				return "#".repeat(newDepth) + " " + node.text;
			}
			return markerWithText(
				indentFor(current) + markerTextWithoutLeading(current.marker),
				current.text
			);
		};
		newMarkerOf = (current) =>
			current === node
				? ""
				: indentFor(current) + markerTextWithoutLeading(current.marker);
	} else if (headingToList) {
		const base = listNewBaseIndent(target, mode);
		const indentFor = (current: MindNode): string =>
			base + "\t".repeat(treeDepth(current, node));
		const defaultToken = listTokenForTarget(target);
		rewriteStructureOf = (current) =>
			markerWithText(
				indentFor(current) +
					(current.type === "list"
						? markerTextWithoutLeading(current.marker)
						: defaultToken),
				current.text
			);
		newMarkerOf = (current) =>
			indentFor(current) +
			(current.type === "list"
				? markerTextWithoutLeading(current.marker)
				: defaultToken);
	} else if (node.type === "heading") {
		const delta =
			(mode === "child" ? target.level + 1 : target.level) - node.level;
		rewriteStructureOf = (current) => {
			if (current.type === "list") {
				return lines[current.lineIndex];
			}
			const newLevel = current.level + delta;
			if (newLevel <= 6) {
				return "#".repeat(newLevel) + " " + current.text;
			}
			return (
				"\t".repeat(Math.max(0, treeDepth(current, node) - 1)) +
				"- " +
				current.text
			);
		};
		newMarkerOf = (current) => {
			if (current.type === "list") {
				return current.marker;
			}
			const newLevel = current.level + delta;
			return newLevel <= 6
				? ""
				: "\t".repeat(Math.max(0, treeDepth(current, node) - 1)) + "- ";
		};
	} else {
		const newBase = listNewBaseIndent(target, mode);
		const indentFor = (current: MindNode): string =>
			newBase + "\t".repeat(listRelDepth(current, node));
		rewriteStructureOf = (current) =>
			markerWithText(
				indentFor(current) + markerTextWithoutLeading(current.marker),
				current.text
			);
		newMarkerOf = (current) =>
			indentFor(current) + markerTextWithoutLeading(current.marker);
	}

	const outputLines = normalizeMovedBlockLines(
		blockLines,
		structureIndexes,
		structureNodes,
		rewriteStructureOf,
		newMarkerOf
	);
	return outputLines;
}

function countNonEmptyBlockLines(
	lines: string[],
	start: number,
	end: number
): number {
	let count = 0;
	for (let i = start; i <= end; i++) {
		if (lines[i]?.trim() !== "") {
			count++;
		}
	}
	return count;
}

export function moveNode(
	text: string,
	node: MindNode,
	target: MindNode,
	mode: MoveMode,
	strictHeadingSpacing = true
): string {
	validateMove(node, target, mode);
	const outputLines = rewriteMovedBlockLines(text, node, target, mode);
	const lines = splitLines(text);
	const start = node.blockStart;
	const end = node.blockEnd;
	const removedCount = countNonEmptyBlockLines(lines, start, end);

	let insertAt = mode === "before" ? target.blockStart : target.blockEnd + 1;
	if (insertAt > start) {
		insertAt -= removedCount;
	}

	const remaining: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (i >= start && i <= end && lines[i].trim() !== "") {
			continue;
		}
		remaining.push(lines[i]);
	}

	const before = remaining.slice(0, insertAt);
	const after = remaining.slice(insertAt);
	const firstIsHeading = outputLines.length > 0 && HEADING_LINE_RE.test(outputLines[0]);
	if (firstIsHeading && before.length > 0 && before[before.length - 1].trim() !== "") {
		before.push("");
	}

	const lineIndex = before.length;
	const resultText = joinLines([...before, ...outputLines, ...after], text);
	const finalText = resultText;
	const needsRenumber =
		node.type === "list" ||
		target.type === "list" ||
		containsList(node);
	return needsRenumber
		? renumberOrderedSiblingGroups(
				finalText,
				new Set([lineIndex]),
				collectOrderedAffectedTexts([node])
			)
		: finalText;
}

export interface MoveNodesResult {
	text: string;
	lineIndex: number;
	lineIndexes?: number[];
}

export function moveNodesDetailed(
	text: string,
	nodes: MindNode[],
	target: MindNode,
	mode: MoveMode,
	strictHeadingSpacing = true
): MoveNodesResult {
	validateMoveNodes(nodes, target, mode);
	const selected = topLevelSelectedNodes(nodes);

	const sorted = [...selected].sort((a, b) => a.blockStart - b.blockStart);
	const outputBlocks = sorted.map((node) =>
		rewriteMovedBlockLines(text, node, target, mode)
	);
	const lines = splitLines(text);
	const insertAtOriginal =
		mode === "before" ? target.blockStart : target.blockEnd + 1;
	let removedBeforeInsert = 0;
	const remaining: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const inSelectedBlock = sorted.some(
			(node) =>
				i >= node.blockStart &&
				i <= node.blockEnd &&
				lines[i].trim() !== ""
		);
		if (inSelectedBlock) {
			if (i < insertAtOriginal) {
				removedBeforeInsert++;
			}
			continue;
		}
		remaining.push(lines[i]);
	}

	const insertAt = Math.max(0, insertAtOriginal - removedBeforeInsert);
	const before = remaining.slice(0, insertAt);
	const after = remaining.slice(insertAt);
	const outputLines = outputBlocks.reduce<string[]>(
		(all, block) => all.concat(block),
		[]
	);
	const firstIsHeading =
		outputLines.length > 0 && HEADING_LINE_RE.test(outputLines[0]);
	if (
		firstIsHeading &&
		before.length > 0 &&
		before[before.length - 1].trim() !== ""
	) {
		before.push("");
	}

	const lineIndexes: number[] = [];
	let cursor = before.length;
	for (const block of outputBlocks) {
		lineIndexes.push(cursor);
		cursor += block.length;
	}
	const lineIndex = before.length;
	const resultText = joinLines([...before, ...outputLines, ...after], text);
	const finalText = resultText;
	const needsRenumber =
		target.type === "list" ||
		selected.some((node) => node.type === "list" || containsList(node));
	return {
		text: needsRenumber
			? renumberOrderedSiblingGroups(
					finalText,
					new Set([lineIndex]),
					collectOrderedAffectedTexts(selected)
				)
			: finalText,
		lineIndex,
		lineIndexes
	};
}

export function moveNodes(
	text: string,
	nodes: MindNode[],
	target: MindNode,
	mode: MoveMode,
	strictHeadingSpacing = true
): string {
	return moveNodesDetailed(
		text,
		nodes,
		target,
		mode,
		strictHeadingSpacing
	).text;
}

export function canMoveNode(
	text: string,
	node: MindNode,
	target: MindNode,
	mode: MoveMode
): boolean {
	try {
		validateMove(node, target, mode);
		return true;
	} catch {
		return false;
	}
}

export function canMoveNodes(
	text: string,
	nodes: MindNode[],
	target: MindNode,
	mode: MoveMode
): boolean {
	try {
		validateMoveNodes(nodes, target, mode);
		return true;
	} catch {
		return false;
	}
}

function validateMoveNodes(
	nodes: MindNode[],
	target: MindNode,
	mode: MoveMode
): void {
	const selected = topLevelSelectedNodes(nodes);
	const selectedIds = new Set(selected.map((node) => node.id));
	if (selectedIds.has(target.id)) {
		throw new Error("不能将节点移动到选中节点内部");
	}
	for (const node of selected) {
		if (isDescendantOf(node, target)) {
			throw new Error("不能将节点移动到自己的后代节点中");
		}
		validateMove(node, target, mode);
	}
}

function validateMove(node: MindNode, target: MindNode, mode: MoveMode): void {
	if (node === target && mode === "child") {
		throw new Error("不能将节点移动到自身内部");
	}
	if (isDescendantOf(node, target)) {
		throw new Error("不能将节点移动到自己的后代节点中");
	}
}

function isDescendantOf(ancestor: MindNode, node: MindNode): boolean {
	for (let current: MindNode | null = node.parent; current !== null; current = current.parent) {
		if (current === ancestor) {
			return true;
		}
	}
	return false;
}

function listNewBaseIndent(target: MindNode, mode: MoveMode): string {
	if (mode === "child") {
		return target.type === "list" ? leadingWhitespace(target.marker) + "\t" : "";
	}
	return target.type === "list" ? leadingWhitespace(target.marker) : "";
}

function listChildIndent(parentMarker: string): string {
	return leadingWhitespace(parentMarker) + "\t";
}

function listRelDepth(node: MindNode, root: MindNode): number {
	let depth = 0;
	for (
		let current: MindNode | null = node;
		current !== null && current !== root;
		current = current.parent
	) {
		if (current.type === "list") {
			depth++;
		}
	}
	return depth;
}

function treeDepth(node: MindNode, root: MindNode): number {
	let depth = 0;
	for (
		let current: MindNode | null = node;
		current !== null && current !== root;
		current = current.parent
	) {
		depth++;
	}
	return depth;
}

function leadingWhitespace(line: string): string {
	return line.match(/^[ \t]*/)?.[0] ?? "";
}

function markerTextWithoutLeading(marker: string): string {
	return marker.slice(leadingWhitespace(marker).length);
}

function indentWidth(ws: string): number {
	let width = 0;
	for (const char of ws) {
		width += char === "\t" ? 4 : 1;
	}
	return width;
}

function parseListMarker(marker: string): { token: string; suffix: string } {
	const match = marker.match(LIST_MARKER_RE);
	if (!match) {
		throw new Error(`无法解析列表标记: ${JSON.stringify(marker)}`);
	}
	return { token: match[2], suffix: match[3] };
}

function siblingToken(token: string, position: InsertPosition): string {
	const ordered = token.match(ORDERED_TOKEN_RE);
	if (!ordered) {
		return token;
	}
	const number = parseInt(ordered[1], 10);
	const next = position === "after" ? number + 1 : Math.max(1, number - 1);
	return String(next) + ordered[2];
}

function collectOrderedGroups(
	children: MindNode[],
	groups: MindNode[][],
	affectedLineIndexes?: Set<number>,
	affectedTexts?: Set<string>
): void {
	const byIndent = new Map<number, MindNode[]>();
	for (const child of children) {
		if (child.type === "list" && isOrderedMarker(child.marker)) {
			const key = indentWidth(leadingWhitespace(child.marker));
			const group = byIndent.get(key) ?? [];
			group.push(child);
			byIndent.set(key, group);
		}
	}
	for (const group of byIndent.values()) {
		const isAffected =
			affectedLineIndexes === undefined && affectedTexts === undefined
				? true
				: group.some(
						(node) =>
							affectedLineIndexes?.has(node.lineIndex) ||
							affectedTexts?.has(node.text)
					);
		if (group.length > 0 && isAffected) {
			groups.push(group);
		}
	}
	for (const child of children) {
		collectOrderedGroups(
			child.children,
			groups,
			affectedLineIndexes,
			affectedTexts
		);
	}
}

function isOrderedMarker(marker: string): boolean {
	return /^\d+[.)]/.test(markerTextWithoutLeading(marker));
}

function orderedMarkerSuffix(marker: string): string {
	return markerTextWithoutLeading(marker).match(/^\d+([.)])/)?.[1] ?? ".";
}

function rewriteOrderedLine(
	line: string,
	number: number,
	suffix: string
): string {
	const match = line.match(/^(\s*)(\d+)([.)])(\s*)(.*)$/);
	if (!match) {
		return line;
	}
	return match[1] + String(number) + suffix + match[4] + match[5];
}

function containsList(node: MindNode): boolean {
	if (node.type === "list") {
		return true;
	}
	return node.children.some((child) => containsList(child));
}

function listTokenForTarget(target: MindNode): string {
	if (target.type !== "list") {
		return "- ";
	}
	const suffix = markerTextWithoutLeading(target.marker).match(/^\d+([.)])/)?.[1];
	return suffix === undefined ? "- " : "1" + suffix;
}

function makeListLine(indent: string, token: string, suffix: string, newText: string): string {
	return markerWithText(indent + token + suffix, newText);
}

function markerWithText(marker: string, newText: string): string {
	if (newText === "" || /\s$/.test(marker)) {
		return marker + newText;
	}
	return marker + " " + newText;
}

function splitLines(text: string): string[] {
	return text.split(LINE_SPLIT_RE);
}

function joinLines(lines: string[], original: string): string {
	return lines.join(original.includes("\r\n") ? "\r\n" : "\n");
}
