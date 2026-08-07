import type {
	App,
	Editor,
	EditorPosition,
	EditorTransaction,
	TFile
} from "obsidian";

export interface SyncCallbacks {
	onMarkdownChanged: (text: string) => void;
	onReadError?: () => void;
}

export interface SyncWriteOptions {
	notify?: boolean;
	onlyLine?: number;
	local?: boolean;
}

const DEBOUNCE_MS = 16;

interface OpenEditorView {
	file: TFile | null;
	editor: Editor;
}

export class SyncManager {
	private readonly app: App;
	private readonly file: TFile;
	private readonly callbacks: SyncCallbacks;
	private readonly editorChangeHandler: (...args: unknown[]) => void;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private isApplying = false;
	private lastAppliedText: string | null = null;
	private disposed = false;
	private readonly modifyHandler: (...args: unknown[]) => void;

	constructor(app: App, file: TFile, callbacks: SyncCallbacks) {
		this.app = app;
		this.file = file;
		this.callbacks = callbacks;
		this.editorChangeHandler = (...args) => {
			const editor = args[0] as Editor;
			const view = args[1];
			const changedFile = (view as { file?: TFile | null } | null)?.file;
			if (
				this.disposed ||
				this.isApplying ||
				!changedFile ||
				changedFile.path !== this.file.path
			) {
				return;
			}
			const text = editor.getValue();
			if (normalizeLineEndings(text) === this.lastAppliedText) {
				return;
			}
			this.scheduleApply(text);
		};
		this.modifyHandler = (...args: unknown[]) => {
			const changedFile = args[0] as TFile;
			if (
				this.disposed ||
				this.isApplying ||
				changedFile.path !== this.file.path
			) {
				return;
			}
			this.scheduleParse();
		};
	}

	attach(): void {
		this.app.workspace.on("editor-change", this.editorChangeHandler);
		this.app.vault.on("modify", this.modifyHandler);
	}

	detach(): void {
		this.disposed = true;
		this.app.workspace.off("editor-change", this.editorChangeHandler);
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		this.app.vault.off("modify", this.modifyHandler);
	}

	async write(text: string, options?: SyncWriteOptions): Promise<boolean> {
		if (
			this.disposed ||
			this.isApplying ||
			normalizeLineEndings(text) === this.lastAppliedText
		) {
			return false;
		}
		const notify = options?.notify !== false;
		const onlyLine = options?.onlyLine;
		const local = options?.local === true && onlyLine === undefined;

		this.isApplying = true;
		try {
			const editor = this.findOpenEditor();
			if (editor) {
				const editorText = editor.getValue();
				const canUseLocal =
					local &&
					(this.lastAppliedText === null ||
						normalizeLineEndings(editorText) ===
							this.lastAppliedText);
				editor.transaction(
					onlyLine !== undefined
						? buildSingleLineReplaceTransaction(editor, onlyLine, text)
						: canUseLocal
							? buildLocalReplaceTransaction(editor, text)
							: buildFullReplaceTransaction(editor, text)
				);
			} else {
				await this.app.vault.process(this.file, () => text);
			}
			if (this.disposed) {
				return false;
			}
			this.lastAppliedText = normalizeLineEndings(text);
			if (notify) {
				this.callbacks.onMarkdownChanged(text);
			}
			return true;
		} finally {
			this.isApplying = false;
		}
	}

	private scheduleParse(): void {
		this.scheduleApply(undefined);
	}

	private scheduleApply(text: string | undefined): void {
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			if (text === undefined) {
				void this.parseFile();
			} else {
				this.applyText(text);
			}
		}, DEBOUNCE_MS);
	}

	private applyText(text: string): void {
		if (
			this.disposed ||
			normalizeLineEndings(text) === this.lastAppliedText
		) {
			return;
		}
		this.callbacks.onMarkdownChanged(text);
	}

	private async parseFile(): Promise<void> {
		if (this.disposed) {
			return;
		}
		let text: string;
		try {
			text = await this.app.vault.cachedRead(this.file);
		} catch (error) {
			this.callbacks.onReadError?.();
			return;
		}
		if (this.disposed || normalizeLineEndings(text) === this.lastAppliedText) {
			return;
		}
		this.callbacks.onMarkdownChanged(text);
	}

	private findOpenEditor(): Editor | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view as unknown as OpenEditorView | null;
			if (!view || view.file?.path !== this.file.path) {
				continue;
			}
			const editor = view.editor;
			if (editor) {
				return editor;
			}
		}
		return null;
	}
}

export interface MinimalTextReplacement {
	from: EditorPosition;
	to: EditorPosition;
	text: string;
}

export function computeMinimalTextReplacement(
	oldText: string,
	newText: string
): MinimalTextReplacement {
	const oldNorm = normalizeLineEndings(oldText);
	const newNorm = normalizeLineEndings(newText);
	let prefix = 0;
	const maxPrefix = Math.min(oldNorm.length, newNorm.length);
	while (
		prefix < maxPrefix &&
		oldNorm.charCodeAt(prefix) === newNorm.charCodeAt(prefix)
	) {
		prefix++;
	}
	let suffix = 0;
	const maxSuffix = Math.min(
		oldNorm.length - prefix,
		newNorm.length - prefix
	);
	while (
		suffix < maxSuffix &&
		oldNorm.charCodeAt(oldNorm.length - 1 - suffix) ===
			newNorm.charCodeAt(newNorm.length - 1 - suffix)
	) {
		suffix++;
	}
	return {
		from: offsetToPosition(oldNorm, prefix),
		to: offsetToPosition(oldNorm, oldNorm.length - suffix),
		text: newNorm.slice(prefix, newNorm.length - suffix)
	};
}

function buildFullReplaceTransaction(
	editor: Editor,
	text: string
): EditorTransaction {
	const lastLine = Math.max(0, editor.lastLine());
	return {
		changes: [
			{
				from: { line: 0, ch: 0 },
				to: { line: lastLine, ch: editor.getLine(lastLine).length },
				text: normalizeLineEndings(text)
			}
		]
	};
}

function buildLocalReplaceTransaction(
	editor: Editor,
	text: string
): EditorTransaction {
	const replacement = computeMinimalTextReplacement(
		editor.getValue(),
		text
	);
	return {
		changes: [
			{
				from: replacement.from,
				to: replacement.to,
				text: replacement.text
			}
		]
	};
}

function buildSingleLineReplaceTransaction(
	editor: Editor,
	onlyLine: number,
	text: string
): EditorTransaction {
	const line = Math.max(0, Math.min(onlyLine, editor.lastLine()));
	const oldLine = editor.getLine(line);
	const newLines = normalizeLineEndings(text).split("\n");
	return {
		changes: [
			{
				from: { line, ch: 0 },
				to: { line, ch: oldLine.length },
				text: newLines[line] ?? ""
			}
		]
	};
}

function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n/g, "\n");
}

function offsetToPosition(text: string, offset: number): EditorPosition {
	const before = text.slice(0, offset);
	const lines = before.split("\n");
	return {
		line: lines.length - 1,
		ch: lines[lines.length - 1]?.length ?? 0
	};
}
