import { describe, expect, it, vi } from "vitest";

vi.mock("simple-mind-map", () => {
	function MockMindMap(): void {
		// no-op
	}
	MockMindMap.usePlugin = (): void => {
		// no-op
	};
	return { default: MockMindMap };
});

vi.mock("simple-mind-map/src/plugins/Drag.js", () => {
	function MockDrag(): void {
		// no-op
	}
	return { default: MockDrag };
});

vi.mock("simple-mind-map/src/plugins/KeyboardNavigation.js", () => {
	function MockKeyboardNavigation(): void {
		// no-op
	}
	return { default: MockKeyboardNavigation };
});

vi.mock("simple-mind-map/src/plugins/Select.js", () => {
	function MockSelect(): void {
		// no-op
	}
	return { default: MockSelect };
});

vi.mock("simple-mind-map/src/constants/constant.js", () => {
	const layoutValueList: string[] = [];
	return { layoutValueList };
});

vi.mock("simple-mind-map/src/layouts/MindMap.js", () => {
	class MockMindMapLayout {
		// no-op base layout
	}
	return { default: MockMindMapLayout };
});

import { MindMapRenderer } from "../src/render";

describe("MindMapRenderer registry sync", () => {
	it("keeps the latest markdown when syncing registry before renderer init", () => {
		const renderer = new MindMapRenderer();
		renderer.setMapNodeRegistry(
			"note.md",
			{},
			"# H1\n## H2\n"
		);
		const state = renderer as unknown as {
			pendingMarkdown: string;
		};
		expect(state.pendingMarkdown).toBe("# H1\n## H2\n");
	});

	it("force render stores the rollback markdown before renderer init", () => {
		const renderer = new MindMapRenderer();
		renderer.forceRenderMarkdown("# 回滚\n");
		const state = renderer as unknown as {
			pendingMarkdown: string;
		};
		expect(state.pendingMarkdown).toBe("# 回滚\n");
	});
});
