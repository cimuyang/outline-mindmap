import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../src/parser";
import { walkMindTree } from "../src/model";
import type { MindNode, MindTree } from "../src/model";
import {
	addChildNode,
	addSiblingNode,
	appendRootNode,
	canMoveNode,
	deleteNode,
	deleteNodes,
	deleteNodesDetailed,
	canMoveNodes,
	moveNode,
	moveNodes,
	moveNodesDetailed,
	promoteToRoot,
	renumberOrderedSiblingGroups,
	updateNodeText,
	willBecomeListLevel
} from "../src/writer";

function findNode(tree: MindTree, lineIndex: number): MindNode {
	let found: MindNode | null = null;
	walkMindTree(tree.roots, (node) => {
		if (node.lineIndex === lineIndex) {
			found = node;
		}
	});
	if (found === null) {
		throw new Error(`未找到 line ${lineIndex} 的节点`);
	}
	return found;
}

function md(lines: string[]): string {
	return lines.join("\n") + "\n";
}

function expectTextAndReparse(result: string, expected: string): void {
	expect(result).toBe(expected);
	expect(parseMarkdown(result)).toEqual(parseMarkdown(expected));
}

describe("updateNodeText", () => {
	it("updates a heading line only", () => {
		const input = md(["# 项目", "这是简介", "## 目标", "- 完成插件"]);
		const tree = parseMarkdown(input);
		const result = updateNodeText(input, findNode(tree, 0), "新名字");
		expectTextAndReparse(result, md(["# 新名字", "这是简介", "## 目标", "- 完成插件"]));
	});

	it("keeps the empty heading marker", () => {
		const empty = md(["# ", "- 项"]);
		const tree = parseMarkdown(empty);
		expectTextAndReparse(
			updateNodeText(empty, findNode(tree, 0), "项目"),
			md(["# 项目", "- 项"])
		);

		const filled = md(["# 项目", "- 项"]);
		const tree2 = parseMarkdown(filled);
		expectTextAndReparse(
			updateNodeText(filled, findNode(tree2, 0), ""),
			md(["# ", "- 项"])
		);
	});

	it("preserves list and task markers", () => {
		const input = md(["###### 清单", "- [ ] 未完成", "  1. 子项"]);
		const tree = parseMarkdown(input);
		expectTextAndReparse(
			updateNodeText(input, findNode(tree, 1), "已完成"),
			md(["###### 清单", "- [ ] 已完成", "  1. 子项"])
		);
		expectTextAndReparse(
			updateNodeText(input, findNode(tree, 2), "新子项"),
			md(["###### 清单", "- [ ] 未完成", "  1. 新子项"])
		);
	});

	it("normalizes an empty list marker when adding text", () => {
		const input = md(["###### H", "-"]);
		const tree = parseMarkdown(input);
		expectTextAndReparse(
			updateNodeText(input, findNode(tree, 1), "abc"),
			md(["###### H", "- abc"])
		);
	});
});

describe("addChildNode", () => {
	it("adds a heading child under a heading", () => {
		const input = md(["# A", "- x"]);
		const tree = parseMarkdown(input);
		const result = addChildNode(input, findNode(tree, 0), "B");
		expectTextAndReparse(result.text, "# A\n- x\n\n## B\n\n\n");
		expect(result.lineIndex).toBe(3);
	});

	it("keeps an existing heading placeholder before a new child heading", () => {
		const input = "# A\n\n\n";
		const tree = parseMarkdown(input);
		const result = addChildNode(input, findNode(tree, 0), "B");
		expectTextAndReparse(result.text, "# A\n\n\n\n## B\n\n\n");
		expect(result.lineIndex).toBe(4);
	});

	it("adds a child heading after heading text with a blank separator", () => {
		const input = "# A\n正文\n";
		const tree = parseMarkdown(input);
		const result = addChildNode(input, findNode(tree, 0), "C");
		expectTextAndReparse(result.text, "# A\n正文\n\n## C\n\n\n");
		expect(result.lineIndex).toBe(3);
	});

	it("adds a list child with default indent", () => {
		const input = md(["###### A", "- x", "- y"]);
		const tree = parseMarkdown(input);
		const result = addChildNode(input, findNode(tree, 1), "子");
		expectTextAndReparse(result.text, md(["###### A", "- x", "\t- 子", "- y"]));
		expect(result.lineIndex).toBe(2);
	});

	it("adds a tab-indented child even when existing children use spaces", () => {
		const input = md(["###### A", "- x", "  - x1", "  - x2"]);
		const tree = parseMarkdown(input);
		const result = addChildNode(input, findNode(tree, 1), "x3");
		expectTextAndReparse(
			result.text,
			md(["###### A", "- x", "  - x1", "  - x2", "\t- x3"])
		);
		expect(result.lineIndex).toBe(4);
	});

	it("adds a tab-indented child when the first child is wider", () => {
		const input = md(["###### A", "- x", "    - x1"]);
		const tree = parseMarkdown(input);
		const result = addChildNode(input, findNode(tree, 1), "x2");
		expectTextAndReparse(result.text, md(["###### A", "- x", "    - x1", "\t- x2"]));
		expect(result.lineIndex).toBe(3);
	});

	it("adds nested tab children under a tab-indented list", () => {
		const input = md(["###### A", "- x", "\t- x1"]);
		const tree = parseMarkdown(input);
		const result = addChildNode(input, findNode(tree, 2), "y");
		expectTextAndReparse(result.text, md(["###### A", "- x", "\t- x1", "\t\t- y"]));
		expect(result.lineIndex).toBe(3);
	});

	it("adds a list child under an H6 heading", () => {
		const input = md(["###### A"]);
		const tree = parseMarkdown(input);
		const result = addChildNode(input, findNode(tree, 0), "B");
		expectTextAndReparse(result.text, md(["###### A", "", "- B"]));
		expect(result.lineIndex).toBe(2);
		const parsed = parseMarkdown(result.text);
		expect(findNode(parsed, 2).type).toBe("list");
	});
});

describe("addSiblingNode", () => {
	it("adds a heading sibling after the subtree", () => {
		const input = md(["# A", "## B", "- x", "## C"]);
		const tree = parseMarkdown(input);
		const result = addSiblingNode(input, findNode(tree, 1), "D", "after");
		expectTextAndReparse(
			result.text,
			md(["# A", "## B", "- x", "", "## D", "", "", "", "## C"])
		);
		expect(result.lineIndex).toBe(4);
	});

	it("adds a heading sibling before the subtree", () => {
		const input = md(["# A", "## B", "- x", "## C"]);
		const tree = parseMarkdown(input);
		const result = addSiblingNode(input, findNode(tree, 1), "D", "before");
		expectTextAndReparse(
			result.text,
			md(["# A", "", "## D", "", "", "", "## B", "- x", "## C"])
		);
		expect(result.lineIndex).toBe(2);
	});

	it("adds a list sibling after the subtree", () => {
		const input = md(["###### A", "- x", "  - x1", "- y"]);
		const tree = parseMarkdown(input);
		const result = addSiblingNode(input, findNode(tree, 1), "新", "after");
		expectTextAndReparse(
			result.text,
			md(["###### A", "- x", "  - x1", "- 新", "- y"])
		);
		expect(result.lineIndex).toBe(3);
	});

	it("adds a list sibling before the subtree", () => {
		const input = md(["###### A", "- x", "  - x1", "- y"]);
		const tree = parseMarkdown(input);
		const result = addSiblingNode(input, findNode(tree, 1), "新", "before");
		expectTextAndReparse(
			result.text,
			md(["###### A", "- 新", "- x", "  - x1", "- y"])
		);
		expect(result.lineIndex).toBe(1);
	});

	it("keeps the unordered marker character", () => {
		const input = md(["###### A", "* x"]);
		const tree = parseMarkdown(input);
		const result = addSiblingNode(input, findNode(tree, 1), "新", "after");
		expectTextAndReparse(result.text, md(["###### A", "* x", "* 新"]));
		expect(result.lineIndex).toBe(2);
	});

	it("numbers ordered siblings", () => {
		const input = md(["###### A", "1. x"]);
		const tree = parseMarkdown(input);
		const after = addSiblingNode(input, findNode(tree, 1), "新", "after");
		expectTextAndReparse(after.text, md(["###### A", "1. x", "2. 新"]));
		expect(after.lineIndex).toBe(2);
		const before = addSiblingNode(input, findNode(tree, 1), "新", "before");
		expectTextAndReparse(before.text, md(["###### A", "1. 新", "2. x"]));
		expect(before.lineIndex).toBe(1);
	});

	it("keeps ordered numbers at least one", () => {
		const input = md(["###### A", "2. x"]);
		const tree = parseMarkdown(input);
		const result = addSiblingNode(input, findNode(tree, 1), "新", "before");
		expectTextAndReparse(result.text, md(["###### A", "1. 新", "2. x"]));
		expect(result.lineIndex).toBe(1);
	});

	it("keeps the task marker for siblings", () => {
		const input = md(["###### A", "- [ ] x"]);
		const tree = parseMarkdown(input);
		const result = addSiblingNode(input, findNode(tree, 1), "新", "after");
		expectTextAndReparse(result.text, md(["###### A", "- [ ] x", "- [ ] 新"]));
		expect(result.lineIndex).toBe(2);
	});

	it("keeps a tab indent for list siblings", () => {
		const input = md(["###### A", "- x", "\t- x1"]);
		const tree = parseMarkdown(input);
		const result = addSiblingNode(input, findNode(tree, 2), "新", "after");
		expectTextAndReparse(result.text, md(["###### A", "- x", "\t- x1", "\t- 新"]));
		expect(result.lineIndex).toBe(3);
	});
});

describe("renumberOrderedSiblingGroups", () => {
	it("renumbers a mixed ordered sibling group and unifies its suffix", () => {
		const input = md(["###### A", "3) a", "1. b", "4) c"]);
		expect(renumberOrderedSiblingGroups(input)).toBe(
			md(["###### A", "1) a", "2) b", "3) c"])
		);
	});

	it("renumbers nested ordered groups independently", () => {
		const input = md([
			"###### A",
			"2. a",
			"3. b",
			"\t2) a1",
			"\t5) a2",
			"4. c"
		]);
		expect(renumberOrderedSiblingGroups(input)).toBe(
			md([
				"###### A",
				"1. a",
				"2. b",
				"\t1) a1",
				"\t2) a2",
				"3. c"
			])
		);
	});

	it("leaves unordered lists and headings unchanged", () => {
		const input = md(["###### A", "- x", "3. y", "正文"]);
		expect(renumberOrderedSiblingGroups(input)).toBe(
			md(["###### A", "- x", "1. y", "正文"])
		);
	});
});

describe("deleteNode", () => {
	it("removes a list subtree and its hidden content", () => {
		const input = md(["###### A", "- x", "  - x1", "隐藏行", "- y"]);
		const tree = parseMarkdown(input);
		const result = deleteNode(input, findNode(tree, 1));
		expectTextAndReparse(result, md(["###### A", "- y"]));
	});

	it("removes a heading subtree", () => {
		const input = md(["# A", "## B", "- b1", "> 隐藏", "# C"]);
		const tree = parseMarkdown(input);
		const result = deleteNode(input, findNode(tree, 1));
		expectTextAndReparse(result, md(["# A", "", "# C"]));
	});

	it("removes a root heading and its subtree", () => {
		const input = md(["# A", "## B", "# C"]);
		const tree = parseMarkdown(input);
		const result = deleteNode(input, findNode(tree, 0));
		expectTextAndReparse(result, md(["# C"]));
	});

	it("removes blank lines inside a deleted list block", () => {
		const input = md(["###### A", "- x", "", "  - x1", "- y"]);
		const tree = parseMarkdown(input);
		const result = deleteNode(input, findNode(tree, 1));
		expectTextAndReparse(result, md(["###### A", "- y"]));
	});

	it("removes placeholder blank lines when deleting a heading", () => {
		const input = md(["# A", "", "## B", "", "", "", "# C"]);
		const tree = parseMarkdown(input);
		const result = deleteNode(input, findNode(tree, 2));
		expectTextAndReparse(result, md(["# A", "", "# C"]));
	});

	it("removes leading blank lines when deleting the first root", () => {
		const input = md(["# A", "", "## B", "", "# C"]);
		const tree = parseMarkdown(input);
		const result = deleteNode(input, findNode(tree, 0));
		expectTextAndReparse(result, md(["# C"]));
	});

	it("collapses trailing blank lines when deleting the last root", () => {
		const input = md(["# A", "", "# B", "", "", ""]);
		const tree = parseMarkdown(input);
		const result = deleteNode(input, findNode(tree, 2));
		expectTextAndReparse(result, md(["# A"]));
	});

	it("returns empty text when deleting the only root", () => {
		const input = md(["# A", "", ""]);
		const tree = parseMarkdown(input);
		const result = deleteNode(input, findNode(tree, 0));
		expect(result).toBe("");
	});

	it("keeps list siblings adjacent when deleting a list node", () => {
		const input = md(["###### H", "- a", "- b", "- c"]);
		const tree = parseMarkdown(input);
		const result = deleteNode(input, findNode(tree, 2));
		expectTextAndReparse(result, md(["###### H", "- a", "- c"]));
	});

	it("keeps one blank before a heading when deleting a list node", () => {
		const input = md(["###### A", "- x", "# B"]);
		const tree = parseMarkdown(input);
		const result = deleteNode(input, findNode(tree, 1));
		expectTextAndReparse(result, md(["###### A", "", "# B"]));
	});

	it("renumbers ordered siblings after deleting one item", () => {
		const input = md(["###### A", "1. a", "3. b", "4. c"]);
		const tree = parseMarkdown(input);
		const result = deleteNode(input, findNode(tree, 2));
		expectTextAndReparse(result, md(["###### A", "1. a", "2. c"]));
	});

	it("preserves CRLF, frontmatter and missing trailing newlines", () => {
		const crlf = "# A\r\n\r\n## B\r\n\r\n\r\n\r\n# C\r\n";
		const crlfTree = parseMarkdown(crlf);
		expect(deleteNode(crlf, findNode(crlfTree, 2))).toBe(
			"# A\r\n\r\n# C\r\n"
		);

		const frontmatter = "---\ntitle: x\n---\n# A\n# B\n";
		const fmTree = parseMarkdown(frontmatter);
		expect(deleteNode(frontmatter, findNode(fmTree, 3))).toBe(
			"---\ntitle: x\n---\n\n# B\n"
		);

		const noTrailing = "# A\n\n## B\n\n\n\n# C";
		const noTrailingTree = parseMarkdown(noTrailing);
		expect(deleteNode(noTrailing, findNode(noTrailingTree, 2))).toBe(
			"# A\n\n# C"
		);
	});
});

describe("deleteNodes", () => {
	it("deletes multiple ordered siblings in one result and renumbers them", () => {
		const input = md(["###### A", "1. a", "2. b", "3. c", "4. d"]);
		const tree = parseMarkdown(input);
		const result = deleteNodes(input, [
			findNode(tree, 2),
			findNode(tree, 3)
		]);
		expectTextAndReparse(result, md(["###### A", "1. a", "2. d"]));
	});

	it("deduplicates selected descendants and deletes only the top-level block", () => {
		const input = md(["# A", "## B", "### C", "# D"]);
		const tree = parseMarkdown(input);
		const result = deleteNodes(input, [
			findNode(tree, 1),
			findNode(tree, 2)
		]);
		expectTextAndReparse(result, md(["# A", "", "# D"]));
	});

	it("deletes mixed heading and list selections across parents", () => {
		const input = md(["# A", "###### B", "- x", "# C", "###### D", "- y", "# E"]);
		const tree = parseMarkdown(input);
		const result = deleteNodes(input, [
			findNode(tree, 1),
			findNode(tree, 5)
		]);
		expectTextAndReparse(
			result,
			md(["# A", "", "# C", "###### D", "", "# E"])
		);
	});

	it("returns a surviving structure line after batch deletion", () => {
		const input = md(["# A", "## B", "### C", "# D"]);
		const tree = parseMarkdown(input);
		const result = deleteNodesDetailed(input, [
			findNode(tree, 1),
			findNode(tree, 2)
		]);
		expect(result.text).toBe("# A\n\n# D\n");
		const finalTree = parseMarkdown(result.text);
		expect(findNode(finalTree, result.focusLine).type).toBe("heading");
		expect(result.focusLine).toBeGreaterThan(0);
	});
});

describe("moveNode", () => {
	it("shifts heading levels when becoming a child", () => {
		const input = md(["# A", "## A1", "### A1a", "## A2", "# B", "## B1", "### B1a"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 4), findNode(tree, 1), "child");
		expectTextAndReparse(
			result,
			md([
				"# A",
				"## A1",
				"### A1a",
				"",
				"### B",
				"",
				"#### B1",
				"",
				"##### B1a",
				"",
				"## A2"
			])
		);

		const parsed = parseMarkdown(result);
		expect(findNode(parsed, 4).level).toBe(3);
		expect(findNode(parsed, 6).level).toBe(4);
		expect(findNode(parsed, 8).level).toBe(5);
	});

	it("moves a heading after a sibling (target after original block)", () => {
		const input = md(["# A", "## B", "## C"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 1), findNode(tree, 2), "after");
		expectTextAndReparse(result, md(["# A", "## C", "", "## B", ""]));
	});

	it("moves a heading before a sibling (target before original block)", () => {
		const input = md(["# A", "## B", "## C"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 2), findNode(tree, 1), "before");
		expectTextAndReparse(result, md(["# A", "", "## C", "", "## B"]));
	});

	it("moves a list into another list and shifts indents and hidden content", () => {
		const input = md(["###### H", "- a", "  - a1", "    继续", "- b"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 1), findNode(tree, 4), "child");
		expectTextAndReparse(
			result,
			md(["###### H", "- b", "\t- a", "\t\t- a1", " ".repeat(10) + "继续"])
		);
	});

	it("moves a list after a sibling and keeps its indent", () => {
		const input = md(["###### H", "- a", "  - a1", "- b"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 1), findNode(tree, 3), "after");
		expectTextAndReparse(result, md(["###### H", "- b", "- a", "\t- a1"]));
	});

	it("converts a list into a heading when moved as a heading child", () => {
		const input = md(["###### H", "- a", "  - a1", "## I"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 1), findNode(tree, 3), "child");
		expectTextAndReparse(
			result,
			md(["###### H", "## I", "", "### a", "", "- a1"])
		);

		const parsed = parseMarkdown(result);
		const a = findNode(parsed, 3);
		expect(a.type).toBe("heading");
		expect(a.level).toBe(3);
		expect(a.children.map((node) => node.text)).toEqual(["a1"]);
	});

	it("moves a tab-indented list to a deeper tab level", () => {
		const input = md(["###### H", "- a", "\t- a1", "- b", "\t- b1"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 1), findNode(tree, 4), "child");
		expectTextAndReparse(
			result,
			md(["###### H", "- b", "\t- b1", "\t\t- a", "\t\t\t- a1"])
		);
	});

	it("renumbers source and target ordered groups after moving an item", () => {
		const input = md(["###### A", "1. a", "3. b", "4. c"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 1), findNode(tree, 3), "after");
		expectTextAndReparse(result, md(["###### A", "1. b", "2. c", "3. a"]));
	});

	it("converts a heading into an ordered list when moving before an ordered item", () => {
		const input = md(["###### H", "1. a", "2. b", "## C"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 3), findNode(tree, 1), "before");
		expectTextAndReparse(result, md(["###### H", "1. C", "2. a", "3. b"]));
	});

	it("converts a list into a heading when moved before a heading", () => {
		const input = md(["###### H", "- x", "###### B", "- y"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 1), findNode(tree, 2), "before");
		expectTextAndReparse(
			result,
			md(["###### H", "", "###### x", "", "###### B", "- y"])
		);
	});

	it("converts a list into a heading when moved after a heading", () => {
		const input = md(["###### H", "- x", "###### B", "- y"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 1), findNode(tree, 2), "after");
		expectTextAndReparse(
			result,
			md(["###### H", "###### B", "- y", "", "###### x", ""])
		);
	});

	it("moves a heading together with its hidden content", () => {
		const input = md(["# A", "## B", "隐藏B", "# C"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 3), findNode(tree, 1), "child");
		expectTextAndReparse(result, md(["# A", "## B", "隐藏B", "", "### C", ""]));
	});

	it("moves a heading with body text and keeps a blank before the next heading", () => {
		const input = md(["# A", "## B", "正文B", "### B1", "# C"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 1), findNode(tree, 4), "child");
		expectTextAndReparse(result, md(["# A", "# C", "", "## B", "", "正文B", "", "### B1", ""]));
	});

	it("converts a heading subtree into a list child", () => {
		const input = md(["##### H", "###### L", "- a", "## B", "### B1"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 3), findNode(tree, 2), "child");
		expectTextAndReparse(
			result,
			md(["##### H", "###### L", "- a", "\t- B", "\t\t- B1"])
		);
	});

	it("converts a heading subtree into lists under an H6 child", () => {
		const input = md(["###### A", "## B", "### B1"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 1), findNode(tree, 0), "child");
		expectTextAndReparse(result, md(["###### A", "- B", "\t- B1"]));
	});

	it("converts a heading into a list sibling", () => {
		const input = md(["###### H", "- x", "## B"]);
		const tree = parseMarkdown(input);
		const resultBefore = moveNode(input, findNode(tree, 2), findNode(tree, 1), "before");
		expectTextAndReparse(resultBefore, md(["###### H", "- B", "- x"]));
		const resultAfter = moveNode(input, findNode(tree, 2), findNode(tree, 1), "after");
		expectTextAndReparse(resultAfter, md(["###### H", "- x", "- B"]));
	});

	it("converts a list into an H1 before the first root heading", () => {
		const input = md(["###### H", "- x", "# A"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 1), findNode(tree, 2), "before");
		expectTextAndReparse(result, md(["###### H", "", "# x", "", "# A"]));

		const parsed = parseMarkdown(result);
		expect(parsed.roots).toHaveLength(3);
		expect(parsed.roots.map((root) => root.text)).toEqual(["H", "x", "A"]);
	});

	it("converts a list into a root heading before a non-first root", () => {
		const input = md(["###### A", "- x", "# B", "###### C", "- y"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 4), findNode(tree, 2), "before");
		expectTextAndReparse(
			result,
			md(["###### A", "- x", "", "# y", "", "# B", "###### C"])
		);
	});

	it("converts a list subtree into a heading child and keeps lists as tab indents", () => {
		const input = md([
			"##### A",
			"###### C",
			"- x",
			"  - x1",
			"    - x2",
			"## B"
		]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 2), findNode(tree, 5), "child");
		expectTextAndReparse(
			result,
			md([
				"##### A",
				"###### C",
				"## B",
				"",
				"### x",
				"",
				"- x1",
				"\t- x2"
			])
		);

		const parsed = parseMarkdown(result);
		expect(findNode(parsed, 4).type).toBe("heading");
		expect(findNode(parsed, 4).level).toBe(3);
		expect(findNode(parsed, 6).type).toBe("list");
		expect(findNode(parsed, 7).type).toBe("list");
	});

	it("converts a list into an H5 heading sibling", () => {
		const input = md(["# A", "##### B", "###### C", "- x"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 3), findNode(tree, 1), "before");
		expectTextAndReparse(
			result,
			md(["# A", "", "##### x", "", "##### B", "###### C"])
		);

		const parsed = parseMarkdown(result);
		expect(findNode(parsed, 2).level).toBe(5);
	});

	it("keeps a list as the seventh layer under an H6 child", () => {
		const input = md(["##### H", "###### A", "- x", "\t- x1", "###### A2"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 2), findNode(tree, 4), "child");
		expectTextAndReparse(
			result,
			md(["##### H", "###### A", "###### A2", "- x", "\t- x1"])
		);

		const parsed = parseMarkdown(result);
		expect(findNode(parsed, 3).type).toBe("list");
		expect(findNode(parsed, 4).type).toBe("list");
	});

	it("converts a heading subtree into lists while preserving list tokens", () => {
		const input = md(["##### H", "###### L", "- a", "## B", "### B1", "  1. 子项"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 3), findNode(tree, 2), "child");
		expectTextAndReparse(
			result,
			md([
				"##### H",
				"###### L",
				"- a",
				"\t- B",
				"\t\t- B1",
				"\t".repeat(3) + "1. 子项"
			])
		);
	});

	it("aligns heading hidden content to the new list content base", () => {
		const input = md(["##### H", "###### L", "- a", "## B", "  正文", "### B1"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 3), findNode(tree, 2), "child");
		expectTextAndReparse(
			result,
			md([
				"##### H",
				"###### L",
				"- a",
				"\t- B",
				" ".repeat(8) + "正文",
				"\t\t- B1"
			])
		);
	});

	it("moves a deep list to a shallower level and realigns its continuation", () => {
		const input = md(["# A", "###### B", "- C", "\t- D", "      继续", "- E"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 3), findNode(tree, 5), "after");
		expectTextAndReparse(result, md(["# A", "###### B", "- C", "- E", "- D", "  继续"]));

		const parsed = parseMarkdown(result);
		const moved = findNode(parsed, 4);
		expect(moved.type).toBe("list");
		expect(moved.hiddenLines).toEqual([5]);
	});

	it("keeps hidden content when converting a list into a heading", () => {
		const input = md(["###### H", "- x", "  隐藏", "  - x1", "###### B"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 1), findNode(tree, 4), "before");
		expectTextAndReparse(
			result,
			md(["###### H", "", "###### x", "", "隐藏", "- x1", "###### B"])
		);
	});

	it("preserves hidden content and CRLF during type conversion", () => {
		const input = "# H\r\n###### L\r\n- a\r\n## B\r\n隐藏B\r\n### B1\r\n";
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 3), findNode(tree, 2), "child");
		expectTextAndReparse(
			result,
			"# H\r\n###### L\r\n- a\r\n\t- B\r\n      隐藏B\r\n\t\t- B1\r\n"
		);
	});

	it("converts heading body paragraphs into list continuation lines", () => {
		const input = md(["# H", "###### L", "- a", "## B", "正文一", "正文二"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 3), findNode(tree, 2), "child");
		expectTextAndReparse(
			result,
			md([
				"# H",
				"###### L",
				"- a",
				"	- B",
				" ".repeat(6) + "正文一",
				" ".repeat(6) + "正文二"
			])
		);
	});

	it("keeps a blockquote when converting a heading into a list", () => {
		const input = md(["# H", "###### L", "- a", "## B", "> 引用", "### B1"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 3), findNode(tree, 2), "child");
		expectTextAndReparse(
			result,
			md([
				"# H",
				"###### L",
				"- a",
				"	- B",
				" ".repeat(6) + "> 引用",
				"		- B1"
			])
		);
	});

	it("keeps a fenced code block when converting a heading into a list", () => {
		const input = md(["# H", "###### L", "- a", "## B", "```", "code", "```", "### B1"]);
		const tree = parseMarkdown(input);
		const result = moveNode(input, findNode(tree, 3), findNode(tree, 2), "child");
		expectTextAndReparse(
			result,
			md([
				"# H",
				"###### L",
				"- a",
				"	- B",
				" ".repeat(6) + "```",
				" ".repeat(6) + "code",
				" ".repeat(6) + "```",
				"		- B1"
			])
		);
	});

	it("rejects a move into an own descendant", () => {
		const input = md(["# A", "## B", "### C"]);
		const tree = parseMarkdown(input);
		expect(() => moveNode(input, findNode(tree, 0), findNode(tree, 2), "child")).toThrow();
		expect(() => moveNode(input, findNode(tree, 0), findNode(tree, 2), "before")).toThrow();
	});

	it("rejects moving a node into itself", () => {
		const input = md(["# A", "## B"]);
		const tree = parseMarkdown(input);
		expect(() => moveNode(input, findNode(tree, 1), findNode(tree, 1), "child")).toThrow();
	});
});

describe("moveNode list conversion", () => {
	it("reports heading moves that become H7+ list level", () => {
		const input = md(["###### A", "- x", "## B"]);
		const tree = parseMarkdown(input);
		expect(
			willBecomeListLevel(findNode(tree, 0), findNode(tree, 1), "child")
		).toBe(true);
		expect(
			willBecomeListLevel(findNode(tree, 0), findNode(tree, 2), "before")
		).toBe(false);
		expect(
			willBecomeListLevel(findNode(tree, 1), findNode(tree, 0), "child")
		).toBe(false);
	});

	it("keeps body lists as nodes when moving an H6 heading to H7+", () => {
		const input = "###### 目标\n###### 内容\n- 正文\n";
		const tree = parseMarkdown(input);
		const target = tree.roots[0];
		const node = tree.roots[1];
		const result = moveNode(input, node, target, "child");
		expect(result).toBe("###### 目标\n- 内容\n\t- 正文\n");
		const parsed = parseMarkdown(result);
		const moved = parsed.roots[0]?.children[0];
		expect(moved?.type).toBe("list");
		expect(moved?.text).toBe("内容");
		expect(moved?.children.map((node) => node.text)).toEqual(["正文"]);
	});

});

describe("moveNodes", () => {
	it("moves selected unordered siblings after a target while preserving order", () => {
		const input = md(["###### H", "- a", "- b", "- c", "- d"]);
		const tree = parseMarkdown(input);
		const result = moveNodes(
			input,
			[findNode(tree, 2), findNode(tree, 3)],
			findNode(tree, 4),
			"after"
		);
		expectTextAndReparse(
			result,
			md(["###### H", "- a", "- d", "- b", "- c"])
		);
	});

	it("deduplicates selected descendants and moves only top-level blocks", () => {
		const input = md(["# A", "## B", "### C", "## D"]);
		const tree = parseMarkdown(input);
		const result = moveNodes(
			input,
			[findNode(tree, 1), findNode(tree, 2)],
			findNode(tree, 3),
			"before"
		);
		const parsed = parseMarkdown(result);
		expect(parsed.roots.map((root) => root.text)).toEqual(["A"]);
		expect(findNode(parsed, 0).children.map((child) => child.text)).toEqual([
			"B",
			"D"
		]);
		expect(findNode(parsed, 0).children[0]?.children[0]?.text).toBe("C");
	});

	it("renumbers ordered siblings after moving a block", () => {
		const input = md(["###### H", "1. a", "2. b", "3. c", "4. d"]);
		const tree = parseMarkdown(input);
		const result = moveNodes(
			input,
			[findNode(tree, 2), findNode(tree, 3)],
			findNode(tree, 4),
			"after"
		);
		expectTextAndReparse(
			result,
			md(["###### H", "1. a", "2. d", "3. b", "4. c"])
		);
	});

	it("returns the first moved node line after batch move", () => {
		const input = md(["###### H", "1. a", "2. b", "3. c", "4. d"]);
		const tree = parseMarkdown(input);
		const result = moveNodesDetailed(
			input,
			[findNode(tree, 2), findNode(tree, 3)],
			findNode(tree, 4),
			"after"
		);
		expect(result.text).toBe(
			md(["###### H", "1. a", "2. d", "3. b", "4. c"])
		);
		expect(result.lineIndex).toBe(3);
	});

	it("does not renumber unrelated ordered lists", () => {
		const input = md([
			"###### Other",
			"1. u",
			"3. v",
			"4. w",
			"###### H",
			"1. a",
			"2. b",
			"3. c",
			"4. d"
		]);
		const tree = parseMarkdown(input);
		const result = moveNodes(
			input,
			[findNode(tree, 6), findNode(tree, 7)],
			findNode(tree, 8),
			"after"
		);
		const lines = result.split("\n");
		expect(lines.slice(0, 4).join("\n")).toBe(
			"###### Other\n1. u\n3. v\n4. w"
		);
	});

	it("converts selected headings into ordered list items before an ordered target", () => {
		const input = md(["##### H", "###### L", "1. a", "2. b", "## C", "## D"]);
		const tree = parseMarkdown(input);
		const result = moveNodes(
			input,
			[findNode(tree, 4), findNode(tree, 5)],
			findNode(tree, 2),
			"before"
		);
		expectTextAndReparse(
			result,
			md(["##### H", "###### L", "1. C", "2. D", "3. a", "4. b"])
		);
	});

	it("moves selected items from different roots before a shared target", () => {
		const input = md(["###### A", "- a", "- b", "###### B", "- x", "- y"]);
		const tree = parseMarkdown(input);
		const result = moveNodes(
			input,
			[findNode(tree, 2), findNode(tree, 4)],
			findNode(tree, 5),
			"before"
		);
		const parsed = parseMarkdown(result);
		expect(parsed.roots.map((root) => root.text)).toEqual(["A", "B"]);
		expect(parsed.roots[0]?.children.map((child) => child.text)).toEqual([
			"a"
		]);
		expect(parsed.roots[1]?.children.map((child) => child.text)).toEqual([
			"b",
			"x",
			"y"
		]);
	});

	it("rejects a target inside the selected subtree", () => {
		const input = md(["# A", "## B", "### C"]);
		const tree = parseMarkdown(input);
		expect(() =>
			moveNodes(
				input,
				[findNode(tree, 1), findNode(tree, 2)],
				findNode(tree, 2),
				"before"
			)
		).toThrow();
		expect(
			canMoveNodes(
				input,
				[findNode(tree, 1), findNode(tree, 2)],
				findNode(tree, 2),
				"before"
			)
		).toBe(false);
	});

	it("converts overflowing descendant headings to lists instead of 7+ hashes", () => {
		const input = md([
			"# A",
			"",
			"## B",
			"",
			"# 1",
			"",
			"###### H",
			"- x"
		]);
		const tree = parseMarkdown(input);
		const result = moveNode(
			input,
			findNode(tree, 0),
			findNode(tree, 6),
			"before"
		);
		expect(result).not.toMatch(/^#{7,}[ \t]/m);
		const parsed = parseMarkdown(result);
		const rootOne = parsed.roots.find((node) => node.text === "1");
		const root = rootOne?.children.find((node) => node.text === "A");
		expect(root?.type).toBe("heading");
		expect(root?.level).toBe(6);
		const child = root?.children.find((node) => node.text === "B");
		expect(child?.type).toBe("list");
	});

	it("returns final line indexes for every moved top-level block", () => {
		const input = md([
			"# A",
			"",
			"## B",
			"",
			"# 1",
			"",
			"###### H",
			"- x"
		]);
		const tree = parseMarkdown(input);
		const result = moveNodesDetailed(
			input,
			[findNode(tree, 0)],
			findNode(tree, 6),
			"before"
		);
		expect(result.lineIndexes).toEqual([4]);
		expect(result.lineIndex).toBe(4);
	});

	it("moves an H1 with body lists and duplicate H2 children to H7+ as lists", () => {
		const input = md([
			"# A",
			"1. 笔记",
			"2. 笔记",
			"## B",
			"## B",
			"# 1",
			"###### H",
			"- x"
		]);
		const tree = parseMarkdown(input);
		const result = moveNode(
			input,
			findNode(tree, 0),
			findNode(tree, 6),
			"child"
		);
		expect(result).not.toMatch(/^#{7,}[ \t]/m);
		const parsed = parseMarkdown(result);
		const rootOne = parsed.roots.find((node) => node.text === "1");
		const h6 = rootOne?.children.find((node) => node.text === "H");
		const a = h6?.children.find((node) => node.text === "A");
		expect(a?.type).toBe("list");
		expect(a?.children.map((node) => node.text)).toEqual([
			"笔记",
			"笔记",
			"B",
			"B"
		]);
	});
});

describe("canMoveNode", () => {
	it("accepts all drag moves except self and descendants", () => {
		const input = md(["###### H", "- x", "## B"]);
		const tree = parseMarkdown(input);
		expect(canMoveNode(input, findNode(tree, 1), findNode(tree, 0), "before")).toBe(true);
		expect(canMoveNode(input, findNode(tree, 2), findNode(tree, 0), "child")).toBe(true);
		expect(canMoveNode(input, findNode(tree, 2), findNode(tree, 1), "child")).toBe(true);
		expect(canMoveNode(input, findNode(tree, 0), findNode(tree, 1), "child")).toBe(false);
	});
});

describe("line endings", () => {
	it("preserves CRLF when editing and moving", () => {
		const input = "###### A\r\n- x\r\n- y\r\n";
		const tree = parseMarkdown(input);
		const updated = updateNodeText(input, findNode(tree, 1), "新");
		expect(updated).toBe("###### A\r\n- 新\r\n- y\r\n");

		const moved = moveNode(input, findNode(tree, 2), findNode(tree, 1), "before");
		expect(moved).toBe("###### A\r\n- y\r\n- x\r\n");
	});
});

describe("appendRootNode", () => {
	it("creates an H1 with a trailing newline in an empty file", () => {
		const result = appendRootNode("");
		expect(result).toEqual({ text: "# \n\n\n", lineIndex: 0 });
		const tree = parseMarkdown(result.text);
		expect(tree.roots).toHaveLength(1);
		expect(tree.roots[0]).toMatchObject({
			type: "heading",
			level: 1,
			lineIndex: 0
		});
	});

	it("uses the provided text and keeps the empty heading marker", () => {
		expect(appendRootNode("# A\n", "新节点").text).toBe(
			"# A\n\n# 新节点\n\n\n"
		);
		expect(appendRootNode("# A\n", "").text).toBe("# A\n\n# \n\n\n");
	});

	it("appends after a file without a trailing newline", () => {
		const result = appendRootNode("# A", "新节点");
		expect(result).toEqual({
			text: "# A\n\n# 新节点\n\n\n",
			lineIndex: 2
		});
		const tree = parseMarkdown(result.text);
		expect(tree.roots.map((root) => root.lineIndex)).toEqual([0, 2]);
	});

	it("appends after a file with a trailing newline", () => {
		const result = appendRootNode("# A\n- x\n", "新节点");
		expect(result).toEqual({
			text: "# A\n- x\n\n# 新节点\n\n\n",
			lineIndex: 3
		});
	});

	it("preserves existing trailing blank lines when appending", () => {
		const result = appendRootNode("# A\n- x\n\n", "新节点");
		expect(result).toEqual({
			text: "# A\n- x\n\n\n# 新节点\n\n\n",
			lineIndex: 4
		});
	});

	it("preserves CRLF line endings", () => {
		const result = appendRootNode("# A\r\n- x\r\n", "新节点");
		expect(result).toEqual({
			text: "# A\r\n- x\r\n\r\n# 新节点\r\n\r\n\r\n",
			lineIndex: 3
		});
	});

	it("appends after frontmatter and makes the new H1 the last root", () => {
		const input = "---\ntitle: x\n---\n# A\n";
		const result = appendRootNode(input, "新节点");
		expect(result.text).toBe(
			"---\ntitle: x\n---\n# A\n\n# 新节点\n\n\n"
		);
		expect(result.lineIndex).toBe(5);
		const tree = parseMarkdown(result.text);
		expect(tree.roots.map((root) => root.text)).toEqual(["A", "新节点"]);
	});

	it("appends after frontmatter-only content", () => {
		const input = "---\ntitle: x\n---\n";
		const result = appendRootNode(input, "新节点");
		expect(result).toEqual({
			text: "---\ntitle: x\n---\n\n# 新节点\n\n\n",
			lineIndex: 4
		});
		const tree = parseMarkdown(result.text);
		expect(tree.roots.map((root) => root.text)).toEqual(["新节点"]);
	});
});

describe("strictHeadingSpacing", () => {
	it("uses one blank line for an appended H1 when disabled", () => {
		expect(appendRootNode("# A\n", "B", false).text).toBe("# A\n\n# B\n");
		expect(appendRootNode("", "", false).text).toBe("# \n");
	});

	it("uses one blank line for child headings when disabled", () => {
		const input = "# A\n- x\n";
		const tree = parseMarkdown(input);
		const result = addChildNode(input, findNode(tree, 0), "B", false);
		expect(result.text).toBe("# A\n- x\n\n## B\n");
		expect(result.lineIndex).toBe(3);
	});

	it("uses one blank line for sibling headings when disabled", () => {
		const input = "# A\n## B\n";
		const tree = parseMarkdown(input);
		const result = addSiblingNode(
			input,
			findNode(tree, 1),
			"C",
			"after",
			false
		);
		expect(result.text).toBe("# A\n## B\n\n## C\n");
		expect(result.lineIndex).toBe(3);
	});

	it("accepts the strict flag on move and promote without adding a 3-line placeholder", () => {
		const moveInput = "# A\n## B\n- x\n## C\n";
		const moveTree = parseMarkdown(moveInput);
		const moved = moveNode(
			moveInput,
			findNode(moveTree, 1),
			findNode(moveTree, 3),
			"before",
			false
		);
		expect(moved).not.toContain("## B\n\n\n\n");
		expect(parseMarkdown(moved)).toEqual(parseMarkdown(moved));

		const promoteInput = "# A\n## B\n# C\n";
		const promoteTree = parseMarkdown(promoteInput);
		const promoted = promoteToRoot(
			promoteInput,
			findNode(promoteTree, 1),
			false
		);
		expect(promoted.text).not.toContain("# B\n\n\n\n");
		const promotedRoots = parseMarkdown(promoted.text).roots;
		expect(promotedRoots[promotedRoots.length - 1]?.text).toBe("B");
	});
});

describe("operation chain", () => {
	it("keeps real line indexes through create, sibling and promote operations", () => {
		let text = "# A\n";
		let result = appendRootNode(text);
		text = result.text;
		expect(result.lineIndex).toBe(2);

		let tree = parseMarkdown(text);
		let child = addChildNode(text, findNode(tree, result.lineIndex), "B");
		text = child.text;
		expect(child.lineIndex).toBe(6);

		tree = parseMarkdown(text);
		let sibling = addSiblingNode(text, findNode(tree, child.lineIndex), "C", "after");
		text = sibling.text;
		expect(sibling.lineIndex).toBe(10);

		tree = parseMarkdown(text);
		let promoted = promoteToRoot(text, findNode(tree, sibling.lineIndex));
		text = promoted.text;
		expect(promoted.lineIndex).toBe(12);

		const finalTree = parseMarkdown(text);
		expect(finalTree.roots.map((root) => root.text)).toEqual(["A", "", "C"]);
		expectTextAndReparse(text, "# A\n\n# \n\n\n\n## B\n\n\n\n\n\n# C\n\n");
	});
});

describe("promoteToRoot", () => {
	it("promotes an H2 to an H1 and converts the list subtree to headings", () => {
		const input = md([
			"# A",
			"##### B",
			"###### B1",
			"- x",
			"  - x1",
			"## C",
			"# D"
		]);
		const tree = parseMarkdown(input);
		const result = promoteToRoot(input, findNode(tree, 1));
		const expected = md([
			"# A",
			"## C",
			"# D",
			"",
			"# B",
			"",
			"## B1",
			"",
			"### x",
			"",
			"#### x1",
			""
		]);
		expect(result.text).toBe(expected);
		expect(result.lineIndex).toBe(4);

		const parsed = parseMarkdown(result.text);
		const root = parsed.roots[parsed.roots.length - 1];
		expect(root.text).toBe("B");
		expect(root.level).toBe(1);
		expect(root.children.map((child) => child.text)).toEqual(["B1"]);
		expect(root.children[0].level).toBe(2);
		expect(root.children[0].children[0].text).toBe("x");
		expect(root.children[0].children[0].type).toBe("heading");
		expect(root.children[0].children[0].level).toBe(3);
		expect(root.children[0].children[0].children[0].text).toBe("x1");
		expect(root.children[0].children[0].children[0].type).toBe("heading");
		expect(root.children[0].children[0].children[0].level).toBe(4);
		expect(root.blockStart).toBe(4);
		expect(root.blockEnd).toBe(10);
		expect(root.hiddenLines).toEqual([]);
	});

	it("promotes an H5 and shifts the whole heading subtree", () => {
		const input = md(["# A", "##### E", "###### E1", "## C"]);
		const tree = parseMarkdown(input);
		const result = promoteToRoot(input, findNode(tree, 1));
		const expected = md(["# A", "## C", "", "# E", "", "## E1", ""]);
		expect(result.text).toBe(expected);
		expect(result.lineIndex).toBe(3);

		const parsed = parseMarkdown(result.text);
		const root = parsed.roots[parsed.roots.length - 1];
		expect(root.text).toBe("E");
		expect(root.level).toBe(1);
		expect(root.children[0].text).toBe("E1");
		expect(root.children[0].level).toBe(2);
	});

	it("promotes an H5 with body text and keeps blank lines around paragraphs", () => {
		const input = md(["# A", "##### B", "正文", "###### B1", "## C"]);
		const tree = parseMarkdown(input);
		const result = promoteToRoot(input, findNode(tree, 1));
		const expected = md(["# A", "## C", "", "# B", "", "正文", "", "## B1", ""]);
		expect(result.text).toBe(expected);
		expect(result.lineIndex).toBe(3);

		const parsed = parseMarkdown(result.text);
		const root = parsed.roots[parsed.roots.length - 1];
		expect(root.text).toBe("B");
		expect(root.children[0].text).toBe("B1");
		expect(root.children[0].level).toBe(2);
	});

	it("paragraphizes body text when promoting a deep list into a root heading", () => {
		const input = md(["# A", "###### B", "- C", "  正文一", "  正文二"]);
		const tree = parseMarkdown(input);
		const result = promoteToRoot(input, findNode(tree, 2));
		const expected = md(["# A", "###### B", "", "# C", "", "正文一", "", "正文二"]);
		expect(result.text).toBe(expected);
		expect(result.lineIndex).toBe(3);

		const parsed = parseMarkdown(result.text);
		const root = parsed.roots[parsed.roots.length - 1];
		expect(root.text).toBe("C");
		expect(root.hiddenLines).toEqual([5, 7]);
		expect(root.blockEnd).toBe(7);
	});

	it("drops the ordered marker and paragraphizes body when promoting", () => {
		const input = md(["# A", "###### B", "- x", "  1. 事项", "  正文一", "  正文二"]);
		const tree = parseMarkdown(input);
		const result = promoteToRoot(input, findNode(tree, 2));
		const expected = md([
			"# A",
			"###### B",
			"",
			"# x",
			"",
			"## 事项",
			"",
			"正文一",
			"",
			"正文二"
		]);
		expect(result.text).toBe(expected);
		expect(result.lineIndex).toBe(3);
	});

	it("dedents deep list continuation so it never becomes an indented code block", () => {
		const input = md(["# A", "###### B", "- x", "      深缩进正文", "      第二段"]);
		const tree = parseMarkdown(input);
		const result = promoteToRoot(input, findNode(tree, 2));
		const expected = md([
			"# A",
			"###### B",
			"",
			"# x",
			"",
			"深缩进正文",
			"",
			"第二段"
		]);
		expect(result.text).toBe(expected);
		expect(result.lineIndex).toBe(3);

		const parsed = parseMarkdown(result.text);
		const root = parsed.roots[parsed.roots.length - 1];
		expect(root.text).toBe("x");
		expect(root.hiddenLines).toEqual([5, 7]);
	});

	it("preserves CRLF, frontmatter and files without a trailing newline when paragraphizing", () => {
		const crlf = "# A\r\n###### B\r\n- C\r\n  正文一\r\n  正文二\r\n";
		const result1 = promoteToRoot(crlf, findNode(parseMarkdown(crlf), 2));
		expect(result1.text).toBe(
			"# A\r\n###### B\r\n\r\n# C\r\n\r\n正文一\r\n\r\n正文二\r\n"
		);
		expect(result1.lineIndex).toBe(3);

		const noTrailing = "# A\n###### B\n- C\n  正文一\n  正文二";
		const result2 = promoteToRoot(noTrailing, findNode(parseMarkdown(noTrailing), 2));
		expect(result2.text).toBe("# A\n###### B\n\n# C\n\n正文一\n\n正文二\n");
		expect(result2.lineIndex).toBe(3);

		const fm = "---\ntitle: x\n---\n###### B\n- C\n  正文一\n  正文二\n";
		const result3 = promoteToRoot(fm, findNode(parseMarkdown(fm), 4));
		expect(result3.text).toBe("---\ntitle: x\n---\n###### B\n\n# C\n\n正文一\n\n正文二\n");
		expect(result3.lineIndex).toBe(5);
	});

	it("converts an H5 with 7/8-level lists into H1/H2/H3/H4 headings", () => {
		const input = md(["# 总纲", "##### B", "###### C", "- D", "\t- E"]);
		const tree = parseMarkdown(input);
		const result = promoteToRoot(input, findNode(tree, 1));
		const expected = md(["# 总纲", "", "# B", "", "## C", "", "### D", "", "#### E", ""]);
		expect(result.text).toBe(expected);
		expect(result.lineIndex).toBe(2);

		const parsed = parseMarkdown(result.text);
		const root = parsed.roots[parsed.roots.length - 1];
		expect(root.text).toBe("B");
		expect(root.children.map((child) => child.text)).toEqual(["C"]);
		expect(root.children[0].level).toBe(2);
		expect(root.children[0].children[0].text).toBe("D");
		expect(root.children[0].children[0].type).toBe("heading");
		expect(root.children[0].children[0].level).toBe(3);
		expect(root.children[0].children[0].children[0].text).toBe("E");
		expect(root.children[0].children[0].children[0].level).toBe(4);
	});

	it("promotes a list item to an H1 and converts its subtree to headings", () => {
		const input = md(["###### H", "- x", "  - x1", "    - x2", "- y"]);
		const tree = parseMarkdown(input);
		const result = promoteToRoot(input, findNode(tree, 1));
		const expected = md([
			"###### H",
			"- y",
			"",
			"# x",
			"",
			"## x1",
			"",
			"### x2",
			""
		]);
		expect(result.text).toBe(expected);
		expect(result.lineIndex).toBe(3);

		const parsed = parseMarkdown(result.text);
		const root = parsed.roots[parsed.roots.length - 1];
		expect(root.text).toBe("x");
		expect(root.type).toBe("heading");
		expect(root.level).toBe(1);
		expect(root.children[0].text).toBe("x1");
		expect(root.children[0].type).toBe("heading");
		expect(root.children[0].level).toBe(2);
		expect(root.children[0].children[0].text).toBe("x2");
		expect(root.children[0].children[0].type).toBe("heading");
		expect(root.children[0].children[0].level).toBe(3);
	});

	it("promotes an H6 so its 7/8-level lists become H2/H3 headings", () => {
		const input = md(["# 总纲", "###### F", "- G", "\t- H"]);
		const tree = parseMarkdown(input);
		const result = promoteToRoot(input, findNode(tree, 1));
		const expected = md(["# 总纲", "", "# F", "", "## G", "", "### H", ""]);
		expect(result.text).toBe(expected);
		expect(result.lineIndex).toBe(2);

		const parsed = parseMarkdown(result.text);
		const root = parsed.roots[parsed.roots.length - 1];
		expect(root.children.map((child) => child.text)).toEqual(["G"]);
		expect(root.children[0].level).toBe(2);
		expect(root.children[0].children[0].text).toBe("H");
		expect(root.children[0].children[0].level).toBe(3);
	});

	it("drops list markers within six levels and keeps them beyond the sixth", () => {
		const input = md([
			"# A",
			"###### B",
			"- 1",
			"\t- 2",
			"\t\t- 3",
			"\t\t\t- 4",
			"\t\t\t\t- 5",
			"\t\t\t\t\t1. 6",
			"\t\t\t\t\t\t- [ ] 7"
		]);
		const tree = parseMarkdown(input);
		const result = promoteToRoot(input, findNode(tree, 1));
		const expected = md([
			"# A",
			"",
			"# B",
			"",
			"## 1",
			"",
			"### 2",
			"",
			"#### 3",
			"",
			"##### 4",
			"",
			"###### 5",
			"",
			"1. 6",
			"\t- [ ] 7"
		]);
		expect(result.text).toBe(expected);
		expect(result.lineIndex).toBe(2);

		const parsed = parseMarkdown(result.text);
		const root = parsed.roots[parsed.roots.length - 1];
		expect(root.text).toBe("B");
		expect(root.blockStart).toBe(2);
		expect(root.blockEnd).toBe(15);
		let current = root;
		for (const text of ["1", "2", "3", "4", "5"]) {
			expect(current.children[0].text).toBe(text);
			expect(current.children[0].type).toBe("heading");
			current = current.children[0];
		}
		expect(current.children[0].text).toBe("6");
		expect(current.children[0].type).toBe("list");
		expect(current.children[0].marker).toBe("1. ");
		expect(current.children[0].children[0].text).toBe("7");
		expect(current.children[0].children[0].type).toBe("list");
		expect(current.children[0].children[0].marker).toBe("\t- [ ] ");
	});

	it("moves hidden content with the block and keeps blank lines in place", () => {
		const input = md(["# A", "###### B", "隐藏B", "- x", "  继续", "", "# C"]);
		const tree = parseMarkdown(input);
		const result = promoteToRoot(input, findNode(tree, 1));
		const expected = md([
			"# A",
			"",
			"# C",
			"",
			"# B",
			"",
			"隐藏B",
			"",
			"## x",
			"",
			"继续"
		]);
		expect(result.text).toBe(expected);

		const parsed = parseMarkdown(result.text);
		const root = parsed.roots[parsed.roots.length - 1];
		expect(root.text).toBe("B");
		expect(root.hiddenLines).toEqual([6]);
		const headingChild = root.children[0];
		expect(headingChild.text).toBe("x");
		expect(headingChild.type).toBe("heading");
		expect(headingChild.hiddenLines).toEqual([10]);
	});

	it("shifts deep list continuation out of code-block indentation", () => {
		const input = md(["# A", "###### B", "- C", "\t- D", "      继续", "        保留"]);
		const tree = parseMarkdown(input);
		const result = promoteToRoot(input, findNode(tree, 1));
		const expected = md(["# A", "", "# B", "", "## C", "", "### D", "", "继续", "", "  保留"]);
		expect(result.text).toBe(expected);
		expect(result.lineIndex).toBe(2);

		const parsed = parseMarkdown(result.text);
		const root = parsed.roots[parsed.roots.length - 1];
		expect(root.children[0].text).toBe("C");
		expect(root.children[0].children[0].text).toBe("D");
		expect(root.children[0].children[0].hiddenLines).toEqual([8, 10]);
		expect(root.children[0].children[0].blockEnd).toBe(10);
	});

	it("handles blocks at the end and files without a trailing newline", () => {
		const atEndInput = "# A\n## B\n";
		const atEnd = promoteToRoot(atEndInput, findNode(parseMarkdown(atEndInput), 1));
		expect(atEnd).toEqual({ text: "# A\n\n# B\n\n", lineIndex: 2 });

		const noTrailingInput = "# A\n## B";
		const noTrailing = promoteToRoot(
			noTrailingInput,
			findNode(parseMarkdown(noTrailingInput), 1)
		);
		expect(noTrailing).toEqual({ text: "# A\n\n# B\n\n", lineIndex: 2 });

		const onlyBlockInput = "###### B\n- x\n";
		const onlyBlock = promoteToRoot(
			onlyBlockInput,
			findNode(parseMarkdown(onlyBlockInput), 0)
		);
		expect(onlyBlock).toEqual({ text: "# B\n\n## x\n\n", lineIndex: 0 });
	});

	it("preserves CRLF line endings", () => {
		const input = "# A\r\n###### B\r\n- x\r\n";
		const tree = parseMarkdown(input);
		const result = promoteToRoot(input, findNode(tree, 1));
		expect(result).toEqual({ text: "# A\r\n\r\n# B\r\n\r\n## x\r\n\r\n", lineIndex: 2 });
		expectTextAndReparse(result.text, "# A\r\n\r\n# B\r\n\r\n## x\r\n\r\n");
	});

	it("keeps frontmatter intact and appends the new root after it", () => {
		const input = "---\ntitle: x\n---\n# A\n## B\n";
		const tree = parseMarkdown(input);
		const result = promoteToRoot(input, findNode(tree, 4));
		expect(result.text).toBe("---\ntitle: x\n---\n# A\n\n# B\n\n");
		expect(result.lineIndex).toBe(5);
		const parsed = parseMarkdown(result.text);
		expect(parsed.roots.map((root) => root.text)).toEqual(["A", "B"]);
	});

	it("keeps the empty heading marker when promoting an empty node", () => {
		const input = md(["# A", "## "]);
		const tree = parseMarkdown(input);
		const result = promoteToRoot(input, findNode(tree, 1));
		expect(result).toEqual({ text: "# A\n\n# \n\n", lineIndex: 2 });
	});

	it("rejects an existing H1 root", () => {
		const input = md(["# A", "## B"]);
		const tree = parseMarkdown(input);
		expect(() => promoteToRoot(input, findNode(tree, 0))).toThrow("根节点无需提升");
	});
});
