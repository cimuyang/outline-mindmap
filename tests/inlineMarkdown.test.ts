import { describe, expect, it } from "vitest";
import { renderInlineMarkdown } from "../src/inlineMarkdown";

describe("renderInlineMarkdown", () => {
	it("renders bold, italic, strikethrough and inline code", () => {
		expect(
			renderInlineMarkdown("**bold** *italic* _em_ ~~del~~ `code`")
		).toBe(
			"<strong>bold</strong> <em>italic</em> <em>em</em> <del>del</del> <code>code</code>"
		);
	});

	it("escapes HTML and filters dangerous link schemes", () => {
		expect(renderInlineMarkdown("<script>alert(1)</script>")).toBe(
			"&lt;script&gt;alert(1)&lt;/script&gt;"
		);
		expect(renderInlineMarkdown("[bad](javascript:alert)")).toBe("bad");
	});

	it("renders external links and wiki links", () => {
		expect(renderInlineMarkdown("[OpenAI](https://openai.com)")).toBe(
			'<a href="https://openai.com">OpenAI</a>'
		);
		expect(renderInlineMarkdown("[[note]] [[note|别名]]")).toBe(
			'<a class="outline-mindmap-internal-link" data-note="note">note</a> ' +
				'<a class="outline-mindmap-internal-link" data-note="note">别名</a>'
		);
	});

	it("keeps inline code content untouched by other replacements", () => {
		expect(renderInlineMarkdown("`**x** [y](https://a.b)`")).toBe(
			"<code>**x** [y](https://a.b)</code>"
		);
		expect(renderInlineMarkdown("`==x==`")).toBe("<code>==x==</code>");
	});

	it("renders Obsidian highlight and nested inline formatting", () => {
		expect(renderInlineMarkdown("==高亮==")).toBe(
			'<mark class="outline-mindmap-highlight">高亮</mark>'
		);
		expect(
			renderInlineMarkdown(
				"==**粗体**== **==高亮==** ==*斜体*== ==~~删除~~=="
			)
		).toBe(
			'<mark class="outline-mindmap-highlight"><strong>粗体</strong></mark> ' +
				'<strong><mark class="outline-mindmap-highlight">高亮</mark></strong> ' +
				'<mark class="outline-mindmap-highlight"><em>斜体</em></mark> ' +
				'<mark class="outline-mindmap-highlight"><del>删除</del></mark>'
		);
	});

	it("renders bold italic triple asterisks and nested combinations", () => {
		expect(renderInlineMarkdown("***加粗倾斜***")).toBe(
			"<strong><em>加粗倾斜</em></strong>"
		);
		expect(
			renderInlineMarkdown("~~***==加粗倾斜高亮删除线==***~~")
		).toBe(
			"<del><strong><em><mark class=\"outline-mindmap-highlight\">加粗倾斜高亮删除线</mark></em></strong></del>"
		);
		expect(renderInlineMarkdown("==***加粗倾斜***==")).toBe(
			'<mark class="outline-mindmap-highlight"><strong><em>加粗倾斜</em></strong></mark>'
		);
		expect(renderInlineMarkdown("***~~删除~~***")).toBe(
			"<strong><em><del>删除</del></em></strong>"
		);
		expect(renderInlineMarkdown("***[链接](https://example.com)***")).toBe(
			'<strong><em><a href="https://example.com">链接</a></em></strong>'
		);
		expect(renderInlineMarkdown("***`代码`***")).toBe(
			"<strong><em><code>代码</code></em></strong>"
		);
		expect(renderInlineMarkdown("`***代码***`")).toBe(
			"<code>***代码***</code>"
		);
		expect(renderInlineMarkdown("****")).toBe("****");
	});

	it("renders nested links and inline code inside highlight", () => {
		expect(renderInlineMarkdown("==`code`==")).toBe(
			'<mark class="outline-mindmap-highlight"><code>code</code></mark>'
		);
		expect(renderInlineMarkdown("==[链接](https://example.com)==")).toBe(
			'<mark class="outline-mindmap-highlight"><a href="https://example.com">链接</a></mark>'
		);
		expect(renderInlineMarkdown("==[[note|别名]]==")).toBe(
			'<mark class="outline-mindmap-highlight"><a class="outline-mindmap-internal-link" data-note="note">别名</a></mark>'
		);
		expect(renderInlineMarkdown("[**粗体链接**](https://example.com)")).toBe(
			'<a href="https://example.com"><strong>粗体链接</strong></a>'
		);
		expect(renderInlineMarkdown("[==高亮链接==](https://example.com)")).toBe(
			'<a href="https://example.com"><mark class="outline-mindmap-highlight">高亮链接</mark></a>'
		);
		expect(
			renderInlineMarkdown("**==高亮==和[链接](https://example.com)**")
		).toBe(
			'<strong><mark class="outline-mindmap-highlight">高亮</mark>和<a href="https://example.com">链接</a></strong>'
		);
	});

	it("keeps equal-sign runs literal instead of creating empty highlights", () => {
		expect(renderInlineMarkdown("==== ==")).toBe("==== ==");
	});

	it("renders links with parentheses and titles", () => {
		expect(
			renderInlineMarkdown("[OpenAI](https://openai.com/chat_(v2))")
		).toBe('<a href="https://openai.com/chat_(v2)">OpenAI</a>');
		expect(renderInlineMarkdown("[OpenAI](https://openai.com \"标题\")")).toBe(
			'<a href="https://openai.com">OpenAI</a>'
		);
		expect(
			renderInlineMarkdown("[OpenAI](https://openai.com/chat_(v2) '标题')")
		).toBe('<a href="https://openai.com/chat_(v2)">OpenAI</a>');
	});
});
