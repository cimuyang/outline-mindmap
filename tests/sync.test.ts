import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App, Editor, EditorTransaction, TFile } from "obsidian";
import {
	computeMinimalTextReplacement,
	SyncManager
} from "../src/sync";

function createHarness(initialContent = "# A\n- x\n") {
	const filePath = "note.md";
	let content = initialContent;
	const modifyListeners: Array<(...args: unknown[]) => void> = [];
	const editorChangeListeners: Array<(...args: unknown[]) => void> = [];
	let openEditors: Editor[] = [];

	const transactionMock = vi.fn((tx: EditorTransaction) => {
		const change = tx.changes?.[0];
		if (change) {
			const from = change.from ?? { line: 0, ch: 0 };
			const to = change.to ?? { line: 0, ch: 0 };
			const replacement = (change.text ?? "").replace(/\r\n/g, "\n");
			const fromOffset = positionToOffset(content, from);
			const toOffset = positionToOffset(content, to);
			content =
				content.slice(0, fromOffset) +
				replacement +
				content.slice(toOffset);
			for (const listener of [...modifyListeners]) {
				listener({ path: filePath });
			}
		}
	});

	const editor = {
		getValue: () => content,
		lastLine: () => content.split("\n").length - 1,
		getLine: (line: number) => content.split("\n")[line] ?? "",
		transaction: transactionMock
	} as unknown as Editor;
	openEditors = [editor];

	const onMock = vi.fn(
		(event: string, cb: (...args: unknown[]) => void) => {
			if (event === "modify") {
				modifyListeners.push(cb);
			} else if (event === "editor-change") {
				editorChangeListeners.push(cb);
			}
		}
	);
	const offMock = vi.fn(
		(event: string, cb: (...args: unknown[]) => void) => {
			if (event === "modify") {
				const index = modifyListeners.indexOf(cb);
				if (index !== -1) {
					modifyListeners.splice(index, 1);
				}
			} else if (event === "editor-change") {
				const index = editorChangeListeners.indexOf(cb);
				if (index !== -1) {
					editorChangeListeners.splice(index, 1);
				}
			}
		}
	);
	const cachedReadMock = vi.fn(async () => content);
	const processMock = vi.fn(
		async (_file: unknown, fn: (file: unknown) => string) => {
			content = fn(filePath);
		}
	);

	const workspace = {
		on: onMock,
		off: offMock,
		getLeavesOfType: vi.fn((type: string) => {
			if (type !== "markdown") {
				return [];
			}
			return openEditors.map((openEditor) => ({
				view: { file: { path: filePath }, editor: openEditor }
			}));
		})
	};

	const app = { vault: { on: onMock, off: offMock, cachedRead: cachedReadMock, process: processMock }, workspace } as unknown as App;
	const file = { path: filePath, extension: "md" } as TFile;

	return {
		app,
		file,
		editor,
		modifyListeners,
		transactionMock,
		processMock,
		cachedReadMock,
		getContent: () => content,
		setOpenEditors: (editors: Editor[]) => {
			openEditors = editors;
		},
		emitModify: () => {
			for (const listener of [...modifyListeners]) {
				listener({ path: filePath });
			}
		},
		emitEditorChange: () => {
			for (const listener of [...editorChangeListeners]) {
				listener(editor, { file: { path: filePath } });
			}
		}
	};
}

describe("SyncManager", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("debounces external modify and refreshes the map", async () => {
		const { app, file, modifyListeners, cachedReadMock } = createHarness();
		const onMarkdownChanged = vi.fn();
		const sync = new SyncManager(app, file, { onMarkdownChanged });
		sync.attach();

		expect(modifyListeners).toHaveLength(1);
		modifyListeners[0]({ path: "note.md" });
		modifyListeners[0]({ path: "note.md" });
		modifyListeners[0]({ path: "note.md" });

		await vi.advanceTimersByTimeAsync(10);
		expect(onMarkdownChanged).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(10);
		expect(onMarkdownChanged).toHaveBeenCalledTimes(1);
		expect(onMarkdownChanged).toHaveBeenCalledWith("# A\n- x\n");
		expect(cachedReadMock).toHaveBeenCalledTimes(1);

		sync.detach();
	});

	it("uses editor-change text directly without cachedRead", async () => {
		const { app, file, emitEditorChange, cachedReadMock } =
			createHarness("# A\n");
		const onMarkdownChanged = vi.fn();
		const sync = new SyncManager(app, file, { onMarkdownChanged });
		sync.attach();

		emitEditorChange();
		await vi.advanceTimersByTimeAsync(20);

		expect(onMarkdownChanged).toHaveBeenCalledWith("# A\n");
		expect(cachedReadMock).not.toHaveBeenCalled();

		sync.detach();
	});

	it("ignores modify events for other files", async () => {
		const { app, file, modifyListeners } = createHarness();
		const onMarkdownChanged = vi.fn();
		const sync = new SyncManager(app, file, { onMarkdownChanged });
		sync.attach();

		modifyListeners[0]({ path: "other.md" });
		await vi.advanceTimersByTimeAsync(200);
		expect(onMarkdownChanged).not.toHaveBeenCalled();

		sync.detach();
	});

	it("writes through the open editor as one full replacement", async () => {
		const { app, file, editor, transactionMock, getContent } = createHarness();
		const onMarkdownChanged = vi.fn();
		const sync = new SyncManager(app, file, { onMarkdownChanged });
		sync.attach();

		await sync.write("# A\n- 新\n- x\n");

		expect(transactionMock).toHaveBeenCalledTimes(1);
		expect(getContent()).toBe("# A\n- 新\n- x\n");
		expect(onMarkdownChanged).toHaveBeenCalledWith("# A\n- 新\n- x\n");

		await vi.advanceTimersByTimeAsync(200);
		expect(onMarkdownChanged).toHaveBeenCalledTimes(1);

		sync.detach();
		expect(editor).toBeDefined();
	});

	it("writes local structural changes through a minimal editor range", async () => {
		const { app, file, transactionMock, getContent } = createHarness(
			"# A\n- x\n- y\n"
		);
		const onMarkdownChanged = vi.fn();
		const sync = new SyncManager(app, file, { onMarkdownChanged });
		sync.attach();

		await sync.write("# A\n- 新\n- y\n", {
			notify: false,
			local: true
		});

		expect(getContent()).toBe("# A\n- 新\n- y\n");
		const tx = transactionMock.mock.calls[0][0] as EditorTransaction;
		const change = tx.changes?.[0];
		expect(change?.from).not.toEqual({ line: 0, ch: 0 });
		expect(change?.to).not.toEqual({ line: 2, ch: 3 });
		expect(change?.text).toContain("新");
		expect(onMarkdownChanged).not.toHaveBeenCalled();

		sync.detach();
	});

	it("onlyLine replaces only the target line in the open editor", async () => {
		const { app, file, transactionMock, getContent } = createHarness(
			"# A\n- x\n- y\n"
		);
		const onMarkdownChanged = vi.fn();
		const sync = new SyncManager(app, file, { onMarkdownChanged });
		sync.attach();

		await sync.write("# A\n- 新\n- y\n", { onlyLine: 1 });

		expect(transactionMock).toHaveBeenCalledTimes(1);
		expect(getContent()).toBe("# A\n- 新\n- y\n");
		expect(onMarkdownChanged).toHaveBeenCalledWith("# A\n- 新\n- y\n");

		sync.detach();
	});

	it("onlyLine transaction uses the target line range", async () => {
		const { app, file, transactionMock } = createHarness(
			"# A\n- x\n- y\n"
		);
		const sync = new SyncManager(app, file, {
			onMarkdownChanged: vi.fn()
		});
		sync.attach();

		await sync.write("# A\n- 新\n- y\n", { onlyLine: 1 });

		const tx = transactionMock.mock.calls[0][0] as EditorTransaction;
		expect(tx.changes?.[0]?.from).toEqual({ line: 1, ch: 0 });
		expect(tx.changes?.[0]?.to).toEqual({ line: 1, ch: 3 });
		expect(tx.changes?.[0]?.text).toBe("- 新");

		sync.detach();
	});

	it("onlyLine with notify disabled updates the line without refreshing the map", async () => {
		const { app, file, getContent } = createHarness("# A\n- x\n- y\n");
		const onMarkdownChanged = vi.fn();
		const sync = new SyncManager(app, file, { onMarkdownChanged });
		sync.attach();

		await sync.write("# A\n- 新\n- y\n", {
			notify: false,
			onlyLine: 1
		});

		expect(getContent()).toBe("# A\n- 新\n- y\n");
		expect(onMarkdownChanged).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(200);
		expect(onMarkdownChanged).not.toHaveBeenCalled();

		sync.detach();
	});

	it("onlyLine falls back to vault.process when no editor is open", async () => {
		const { app, file, processMock, setOpenEditors, getContent } =
			createHarness("# A\n- x\n");
		setOpenEditors([]);
		const onMarkdownChanged = vi.fn();
		const sync = new SyncManager(app, file, { onMarkdownChanged });
		sync.attach();

		await sync.write("# A\n- 新\n", { onlyLine: 0 });

		expect(processMock).toHaveBeenCalledTimes(1);
		expect(getContent()).toBe("# A\n- 新\n");
		expect(onMarkdownChanged).toHaveBeenCalledWith("# A\n- 新\n");

		sync.detach();
	});

	it("onlyLine records lastAppliedText and skips a delayed modify echo", async () => {
		const { app, file, emitModify } = createHarness();
		const onMarkdownChanged = vi.fn();
		const sync = new SyncManager(app, file, { onMarkdownChanged });
		sync.attach();

		await sync.write("# A\n- 新\n", {
			notify: false,
			onlyLine: 1
		});
		expect(onMarkdownChanged).not.toHaveBeenCalled();

		emitModify();
		await vi.advanceTimersByTimeAsync(200);
		expect(onMarkdownChanged).not.toHaveBeenCalled();

		sync.detach();
	});

	it("falls back to vault.process when no editor is open", async () => {
		const { app, file, processMock, setOpenEditors, getContent } =
			createHarness();
		setOpenEditors([]);
		const onMarkdownChanged = vi.fn();
		const sync = new SyncManager(app, file, { onMarkdownChanged });
		sync.attach();

		await sync.write("# A\n- y\n");

		expect(processMock).toHaveBeenCalledTimes(1);
		expect(getContent()).toBe("# A\n- y\n");
		expect(onMarkdownChanged).toHaveBeenCalledWith("# A\n- y\n");

		sync.detach();
	});

	it("skips a delayed modify echo carrying the applied text", async () => {
		const { app, file, setOpenEditors, emitModify } = createHarness();
		setOpenEditors([]);
		const onMarkdownChanged = vi.fn();
		const sync = new SyncManager(app, file, { onMarkdownChanged });
		sync.attach();

		await sync.write("# A\n- 新\n- x\n");
		expect(onMarkdownChanged).toHaveBeenCalledTimes(1);

		emitModify();
		await vi.advanceTimersByTimeAsync(200);
		expect(onMarkdownChanged).toHaveBeenCalledTimes(1);

		sync.detach();
	});

	it("write with notify disabled updates the file without refreshing the map", async () => {
		const { app, file, editor, transactionMock, getContent } = createHarness();
		const onMarkdownChanged = vi.fn();
		const sync = new SyncManager(app, file, { onMarkdownChanged });
		sync.attach();

		await sync.write("# A\n- 局部\n", { notify: false });

		expect(transactionMock).toHaveBeenCalledTimes(1);
		expect(getContent()).toBe("# A\n- 局部\n");
		expect(onMarkdownChanged).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(200);
		expect(onMarkdownChanged).not.toHaveBeenCalled();
		expect(editor).toBeDefined();

		sync.detach();
	});

	it("detach cancels pending debounce and stops listening", async () => {
		const { app, file, modifyListeners } = createHarness();
		const onMarkdownChanged = vi.fn();
		const sync = new SyncManager(app, file, { onMarkdownChanged });
		sync.attach();

		modifyListeners[0]({ path: "note.md" });
		sync.detach();
		expect(modifyListeners).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(200);
		expect(onMarkdownChanged).not.toHaveBeenCalled();
	});
});

describe("computeMinimalTextReplacement", () => {
	it("replaces only the changed middle section", () => {
		const result = computeMinimalTextReplacement(
			"# A\n- x\n- y\n",
			"# A\n- 新\n- y\n"
		);
		expect(result.text).toBe("新");
		expect(result.from).toEqual({ line: 1, ch: 2 });
		expect(result.to).toEqual({ line: 1, ch: 3 });
	});

	it("inserts a line before an existing line", () => {
		const result = computeMinimalTextReplacement(
			"# A\n- y\n",
			"# A\n- x\n- y\n"
		);
		expect(result.text).toBe("x\n- ");
		expect(result.from).toEqual({ line: 1, ch: 2 });
		expect(result.to).toEqual({ line: 1, ch: 2 });
	});

	it("appends at end without a trailing newline", () => {
		const result = computeMinimalTextReplacement("# A", "# A\n- x");
		expect(result.text).toBe("\n- x");
		expect(result.from).toEqual({ line: 0, ch: 3 });
		expect(result.to).toEqual({ line: 0, ch: 3 });
	});
});

function positionToOffset(
	text: string,
	position: { line: number; ch: number }
): number {
	const lines = text.split("\n");
	let offset = 0;
	for (let i = 0; i < position.line; i++) {
		offset += (lines[i]?.length ?? 0) + 1;
	}
	offset += Math.min(position.ch, lines[position.line]?.length ?? 0);
	return offset;
}
