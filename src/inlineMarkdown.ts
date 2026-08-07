const CODE_PREFIX = "\u0000outline-code-";
const CODE_SUFFIX = "\u0000";
const LINK_PREFIX_RE =
	/^\[([^\[\]\n]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:\s+(?:"[^"]*"|'[^']*'|&quot;[^&"]*&quot;|&#39;[^&']*&#39;))?\)/;
const WIKI_LINK_PREFIX_RE =
	/^\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/;

interface InlineMatch {
	html: string;
	length: number;
}

interface DelimiterOptions {
	openerNotFollowedBy?: string;
	boundary?: boolean;
	requireNonWhitespace?: boolean;
}

export function renderInlineMarkdown(text: string): string {
	const codeSpans: string[] = [];
	let result = escapeHtml(text);

	result = result.replace(/`([^`\n]+)`/g, (_match, code: string) => {
		codeSpans.push(code);
		return CODE_PREFIX + (codeSpans.length - 1) + CODE_SUFFIX;
	});

	return parseInline(result, codeSpans);
}

function parseInline(text: string, codeSpans: string[]): string {
	let result = "";
	let index = 0;

	while (index < text.length) {
		const match =
			matchCodePlaceholder(text, index, codeSpans) ??
			matchWikiLink(text, index, codeSpans) ??
			matchStandardLink(text, index, codeSpans) ??
			matchDelimited(text, index, "==", "==", (inner) => ({
				html: `<mark class="outline-mindmap-highlight">${inner}</mark>`,
				length: 0
			}), {
				openerNotFollowedBy: "=",
				requireNonWhitespace: true
			}, codeSpans) ??
			matchDelimited(text, index, "***", "***", (inner) => ({
				html: `<strong><em>${inner}</em></strong>`,
				length: 0
			}), {
				openerNotFollowedBy: "*"
			}, codeSpans) ??
			matchDelimited(text, index, "**", "**", (inner) => ({
				html: `<strong>${inner}</strong>`,
				length: 0
			}), {
				openerNotFollowedBy: "*"
			}, codeSpans) ??
			matchDelimited(text, index, "~~", "~~", (inner) => ({
				html: `<del>${inner}</del>`,
				length: 0
			}), {
				openerNotFollowedBy: "~"
			}, codeSpans) ??
			matchDelimited(text, index, "*", "*", (inner) => ({
				html: `<em>${inner}</em>`,
				length: 0
			}), {
				openerNotFollowedBy: "*"
			}, codeSpans) ??
			matchDelimited(text, index, "_", "_", (inner) => ({
				html: `<em>${inner}</em>`,
				length: 0
			}), {
				boundary: true
			}, codeSpans);

		if (match) {
			result += match.html;
			index += match.length;
			continue;
		}

		result += text[index];
		index++;
	}

	return result;
}

function matchCodePlaceholder(
	text: string,
	start: number,
	codeSpans: string[]
): InlineMatch | null {
	if (!text.startsWith(CODE_PREFIX, start)) {
		return null;
	}
	const end = text.indexOf(CODE_SUFFIX, start + CODE_PREFIX.length);
	if (end === -1) {
		return null;
	}
	const index = Number(text.slice(start + CODE_PREFIX.length, end));
	const code = codeSpans[index];
	if (code === undefined) {
		return null;
	}
	return {
		html: `<code>${code}</code>`,
		length: end + CODE_SUFFIX.length - start
	};
}

function matchWikiLink(
	text: string,
	start: number,
	codeSpans: string[]
): InlineMatch | null {
	const match = text.slice(start).match(WIKI_LINK_PREFIX_RE);
	if (!match) {
		return null;
	}
	const note = match[1];
	const display = parseInline(match[2] || note, codeSpans);
	return {
		html: `<a class="outline-mindmap-internal-link" data-note="${note}">${display}</a>`,
		length: match[0].length
	};
}

function matchStandardLink(
	text: string,
	start: number,
	codeSpans: string[]
): InlineMatch | null {
	const match = text.slice(start).match(LINK_PREFIX_RE);
	if (!match) {
		return null;
	}
	const label = parseInline(match[1], codeSpans);
	const href = safeUrl(match[2]);
	return {
		html: href ? `<a href="${href}">${label}</a>` : label,
		length: match[0].length
	};
}

function matchDelimited(
	text: string,
	start: number,
	opener: string,
	closer: string,
	render: (inner: string) => InlineMatch,
	options: DelimiterOptions,
	codeSpans: string[]
): InlineMatch | null {
	if (!text.startsWith(opener, start)) {
		return null;
	}
	const innerStart = start + opener.length;
	if (
		options.openerNotFollowedBy !== undefined &&
		text[innerStart] === options.openerNotFollowedBy
	) {
		return null;
	}
	const close = text.indexOf(closer, innerStart);
	if (close === -1) {
		return null;
	}
	const inner = text.slice(innerStart, close);
	if (inner.length === 0) {
		return null;
	}
	if (options.requireNonWhitespace && inner.trim().length === 0) {
		return null;
	}
	if (
		options.boundary &&
		((start > 0 && WORD_CHAR.test(text[start - 1])) ||
			(close + closer.length < text.length &&
				WORD_CHAR.test(text[close + closer.length])))
	) {
		return null;
	}
	const rendered = render(parseInline(inner, codeSpans));
	return {
		html: rendered.html,
		length: close + closer.length - start
	};
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function safeUrl(value: string): string {
	const trimmed = value.trim();
	const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
	if (!scheme) {
		return trimmed;
	}
	return ["http", "https", "mailto", "tel"].includes(scheme[1].toLowerCase())
		? trimmed
		: "";
}

const WORD_CHAR = /\w/;
