import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import type { Editor } from "obsidian";
import type { MindNodeType } from "./model";

export interface TextRange {
	from: number;
	to: number;
}

const HEADING_MARKER_RE = /^(#{1,6})[ \t]+/;
const LIST_MARKER_RE = /^[ \t]*([-*+]|\d+[.)])([ \t]+)/;
const TASK_MARKER_RE = /^\[[ xX]\](?:[ \t]+|$)/;

export function getNodeTextRange(
	line: string,
	type: MindNodeType
): TextRange | null {
	const marker = type === "heading" ? HEADING_MARKER_RE : LIST_MARKER_RE;
	const match = line.match(marker);
	if (!match) {
		return null;
	}
	let from = match[0].length;
	if (type === "list") {
		const task = line.slice(from).match(TASK_MARKER_RE);
		if (task) {
			from += task[0].length;
		}
	}
	const to = line.length;
	return from < to ? { from, to } : null;
}

export interface HighlightTransactionState {
	docChanged: boolean;
}

export function shouldClearHighlightOnChange(
	state: HighlightTransactionState
): boolean {
	return state.docChanged;
}

interface HighlightRange {
	from: number;
	to: number;
}

const setHighlightEffect = StateEffect.define<HighlightRange | null>();
const markDecoration = Decoration.mark({
	class: "outline-mindmap-jump-highlight"
});

const highlightField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update: (decorations, transaction) => {
		if (shouldClearHighlightOnChange({ docChanged: transaction.docChanged })) {
			return Decoration.none;
		}
		let next = decorations;
		for (const effect of transaction.effects) {
			if (effect.is(setHighlightEffect)) {
				next = effect.value
					? Decoration.set([
							markDecoration.range(effect.value.from, effect.value.to)
					  ])
					: Decoration.none;
			}
		}
		return next;
	},
	provide: (field) => EditorView.decorations.from(field)
});

export class JumpHighlightManager {
	private view: EditorView | null = null;
	private container: HTMLElement | null = null;
	private range: HighlightRange | null = null;
	private readonly mousedownHandler = (): void => {
		this.clear();
	};

	setRange(
		editor: Editor,
		container: HTMLElement,
		lineIndex: number,
		range: TextRange
	): void {
		const view = resolveEditorView(editor);
		if (!view || range.from < 0 || range.to < range.from) {
			return;
		}
		const lineNo = lineIndex + 1;
		const doc = view.state.doc;
		if (lineNo < 1 || lineNo > doc.lines) {
			return;
		}
		const line = doc.line(lineNo);
		const absFrom = line.from + range.from;
		const absTo = line.from + range.to;
		if (absFrom > absTo || absTo > line.to) {
			return;
		}
		if (this.view !== view || this.container !== container) {
			this.detach();
			this.view = view;
			this.container = container;
			container.addEventListener("mousedown", this.mousedownHandler, true);
		}
		this.range = { from: absFrom, to: absTo };
		const effects: StateEffect<unknown>[] = [];
		if (!view.state.field(highlightField, false)) {
			effects.push(StateEffect.appendConfig.of(highlightField));
		}
		effects.push(setHighlightEffect.of(this.range));
		this.dispatch(effects);
	}

	clear(): void {
		if (!this.view || !this.range) {
			return;
		}
		this.range = null;
		this.dispatch([setHighlightEffect.of(null)]);
	}

	detach(): void {
		this.clear();
		if (this.container) {
			this.container.removeEventListener(
				"mousedown",
				this.mousedownHandler,
				true
			);
			this.container = null;
		}
		this.view = null;
	}

	private dispatch(effects: StateEffect<unknown>[]): void {
		if (!this.view) {
			return;
		}
		try {
			this.view.dispatch({ effects });
		} catch {
			this.view = null;
			this.container = null;
			this.range = null;
		}
	}
}

function resolveEditorView(editor: Editor): EditorView | null {
	const cm = (editor as unknown as { cm?: EditorView }).cm;
	return cm ?? null;
}
