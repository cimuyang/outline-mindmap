import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../src/parser";
import { walkMindTree } from "../src/model";

function buildLargeNote(nodeCount: number): string {
	const h2Count = nodeCount >= 2000 ? 100 : 60;
	const h3Count = nodeCount - 1 - h2Count;
	const lines: string[] = ["# 压测根节点"];
	let h3PerH2 = Math.floor(h3Count / h2Count);
	let remainder = h3Count % h2Count;
	for (let h2 = 0; h2 < h2Count; h2++) {
		lines.push(`## 二级节点 ${h2 + 1}`);
		const count = h3PerH2 + (remainder > 0 ? 1 : 0);
		remainder--;
		for (let h3 = 0; h3 < count; h3++) {
			lines.push(`### 三级节点 ${h2 + 1}-${h3 + 1}`);
		}
	}
	return lines.join("\n") + "\n";
}

describe("large note performance", () => {
	for (const nodeCount of [500, 1000, 2000]) {
		it(`parses a ${nodeCount}-node note quickly`, () => {
			const markdown = buildLargeNote(nodeCount);
			const start = performance.now();
			const tree = parseMarkdown(markdown);
			const elapsed = performance.now() - start;

			let actualCount = 0;
			walkMindTree(tree.roots, () => {
				actualCount++;
			});

			expect(actualCount).toBe(nodeCount);
			expect(elapsed).toBeLessThan(500);
		});
	}

});
