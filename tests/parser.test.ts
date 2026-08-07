import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	findMapNodeCandidateForLine,
	getMapNodeCandidatesForMarkdown,
	parseMarkdown
} from "../src/parser";
import { walkMindTree } from "../src/model";
import type { MindNode } from "../src/model";

interface ExpectedNode {
	id: string;
	type: "heading" | "list";
	text: string;
	level: number;
	marker: string;
	lineIndex: number;
	blockStart: number;
	blockEnd: number;
	hiddenLines: number[];
	children: ExpectedNode[];
}

interface ExpectedTree {
	roots: ExpectedNode[];
}

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));

function toPlain(node: MindNode): ExpectedNode {
	return {
		id: node.id,
		type: node.type,
		text: node.text,
		level: node.level,
		marker: node.marker,
		lineIndex: node.lineIndex,
		blockStart: node.blockStart,
		blockEnd: node.blockEnd,
		hiddenLines: [...node.hiddenLines],
		children: node.children.map(toPlain)
	};
}

function assertParentPointers(nodes: MindNode[], parent: MindNode | null = null): void {
	for (const node of nodes) {
		expect(node.parent).toBe(parent);
		assertParentPointers(node.children, node);
	}
}

describe("parser fixtures", () => {
	const files = readdirSync(fixturesDir)
		.filter((file) => file.endsWith(".md"))
		.sort();

	for (const file of files) {
		const name = file.replace(/\.md$/, "");
		const text = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8");
		const expected = JSON.parse(
			readFileSync(new URL(`./fixtures/${name}.expected.json`, import.meta.url), "utf8")
		) as ExpectedTree;

		it(`parses ${name}`, () => {
			const tree = parseMarkdown(text);
			expect(tree.roots.map(toPlain)).toEqual(expected.roots);
			assertParentPointers(tree.roots);

			const ids: string[] = [];
			walkMindTree(tree.roots, (node) => ids.push(node.id));
			expect(new Set(ids).size).toBe(ids.length);
		});
	}

	it("crlf fixture really uses CRLF line endings", () => {
		const text = readFileSync(new URL("./fixtures/crlf.md", import.meta.url), "utf8");
		expect(text.includes("\r\n")).toBe(true);
	});

	it("treats every list under any heading as a map node", () => {
		const text = "# H1\n- A\n  - A1\n## H2\n1. B\n";
		const tree = parseMarkdown(text);
		const h1 = tree.roots[0];
		expect(h1?.children.map((node) => node.text)).toEqual(["A", "H2"]);
		expect(h1?.children[0]?.children.map((node) => node.text)).toEqual([
			"A1"
		]);
		expect(h1?.hiddenLines).toEqual([]);
		expect(h1?.children[1]?.children.map((node) => node.text)).toEqual([
			"B"
		]);
	});

	it("finds H7/H8 line candidates for markdown commands", () => {
		const text = "###### H6\n- A\n  - A1\n- B\n";
		const a = findMapNodeCandidateForLine(text, 1, "note.md");
		const a1 = findMapNodeCandidateForLine(text, 2, "note.md");
		const b = findMapNodeCandidateForLine(text, 3, "note.md");
		expect(a).toMatchObject({
			lineIndex: 1,
			parentKey: "heading:6:H6",
			text: "A",
			occurrence: 1
		});
		expect(a1?.parentKey).toBe(a?.candidateKey);
		expect(b).toMatchObject({
			lineIndex: 3,
			parentKey: "heading:6:H6",
			text: "B",
			occurrence: 1
		});
	});

	it("finds list candidates under any heading and null for plain lines", () => {
		const text = "## H2\n- A\n正文\n";
		expect(findMapNodeCandidateForLine(text, 1, "note.md")).toMatchObject({
			text: "A"
		});
		expect(findMapNodeCandidateForLine(text, 2, "note.md")).toBeNull();
	});

	it("assigns occurrence for duplicate candidate lines", () => {
		const text = "###### H6\n- A\n- A\n";
		expect(findMapNodeCandidateForLine(text, 1, "note.md")).toMatchObject({
			occurrence: 1
		});
		expect(findMapNodeCandidateForLine(text, 2, "note.md")).toMatchObject({
			occurrence: 2
		});
	});

	it("lists all H7+ candidates for registry reconciliation", () => {
		const text = "###### H6\n- A\n  - A1\n- B\n";
		const candidates = getMapNodeCandidatesForMarkdown(text, "note.md");
		expect(candidates.map((candidate) => candidate.text)).toEqual([
			"A",
			"A1",
			"B"
		]);
	});
});
