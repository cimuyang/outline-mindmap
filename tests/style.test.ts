import { describe, expect, it } from "vitest";
import {
	DEFAULT_MIND_MAP_STYLE,
	MIND_MAP_LAYOUTS,
	MIND_MAP_LINE_STYLES,
	MIND_MAP_SHAPES,
	MIND_MAP_STYLE_TEMPLATES,
	clearNoteStyleOverride,
	diffMindMapStyles,
	getEffectiveMindMapStyle,
	getSupportedLineStyles,
	getMindMapStyleTemplate,
	mergeMindMapStyles,
	normalizeMindMapStyle,
	resolveEffectiveLineStyle,
	resolveEffectiveMindMapStyle,
	sanitizeMindMapStylePartial,
	sanitizeNoteStyles,
	setNoteStyleOverride
} from "../src/style";

describe("normalizeMindMapStyle", () => {
	it("returns the documented defaults for missing data", () => {
		expect(normalizeMindMapStyle(null)).toEqual(DEFAULT_MIND_MAP_STYLE);
		expect(normalizeMindMapStyle(undefined)).toEqual(DEFAULT_MIND_MAP_STYLE);
		expect(normalizeMindMapStyle({})).toEqual(DEFAULT_MIND_MAP_STYLE);
	});

	it("keeps valid values", () => {
		expect(
			normalizeMindMapStyle({
				layout: "timeline",
				lineStyle: "curve",
				lineRadius: 12,
				lineWidth: 2,
				lineColor: "#fff",
				secondMarginX: 90,
				secondMarginY: 20,
				nodeMarginX: 40,
				nodeMarginY: 8,
				shape: "roundedRectangle",
				fillColor: "#123456",
				borderColor: "#654321",
				borderWidth: 2,
				borderRadius: 10,
				fontSize: 14
			})
		).toEqual({
			layout: "timeline",
			lineStyle: "curve",
			lineRadius: 12,
			lineWidth: 2,
			lineColor: "#fff",
			secondMarginX: 90,
			secondMarginY: 20,
			nodeMarginX: 40,
			nodeMarginY: 8,
			shape: "roundedRectangle",
			fillColor: "#123456",
			borderColor: "#654321",
			borderWidth: 2,
			borderRadius: 10,
			fontSize: 14
		});
	});

	it("falls back to defaults for invalid value types", () => {
		expect(
			normalizeMindMapStyle({
				layout: "unknown-layout",
				lineStyle: "unknown-line",
				lineRadius: -1,
				lineWidth: Number.NaN,
				lineColor: 12,
				secondMarginX: "80",
				secondMarginY: Number.POSITIVE_INFINITY,
				nodeMarginX: -10,
				nodeMarginY: Number.NaN,
				shape: "unknown-shape",
				fillColor: 123,
				borderColor: 456,
				borderWidth: -2,
				borderRadius: Number.NaN,
				fontSize: 0
			})
		).toEqual(DEFAULT_MIND_MAP_STYLE);
	});

	it("falls back to the default layout for removed legacy layouts", () => {
		expect(
			normalizeMindMapStyle({
				layout: "fishbone2",
				lineStyle: "curve",
				lineRadius: 20
			})
		).toMatchObject({
			layout: DEFAULT_MIND_MAP_STYLE.layout,
			lineStyle: "curve",
			lineRadius: 20
		});
	});

	it("fills missing fields while preserving provided fields", () => {
		expect(normalizeMindMapStyle({ lineStyle: "curve" })).toEqual({
			...DEFAULT_MIND_MAP_STYLE,
			lineStyle: "curve"
		});
	});
});

describe("mergeMindMapStyles", () => {
	it("keeps base fields when the override is partial", () => {
		const base = normalizeMindMapStyle({
			layout: "mindMap",
			lineStyle: "curve",
			lineRadius: 20,
			lineColor: "#fff"
		});
		const merged = mergeMindMapStyles(base, { lineStyle: "direct" });

		expect(merged.layout).toBe("mindMap");
		expect(merged.lineStyle).toBe("direct");
		expect(merged.lineRadius).toBe(20);
		expect(merged.lineColor).toBe("#fff");
	});

	it("ignores undefined overrides and null input", () => {
		const base = normalizeMindMapStyle({ lineStyle: "curve" });
		expect(mergeMindMapStyles(base, { lineRadius: undefined })).toEqual(base);
		expect(mergeMindMapStyles(base, null)).toEqual(base);
	});
});

describe("mind map style templates", () => {
	it("returns a normalized style for every template", () => {
		expect(getMindMapStyleTemplate("minimal")).toEqual(
			DEFAULT_MIND_MAP_STYLE
		);
		for (const key of Object.keys(MIND_MAP_STYLE_TEMPLATES)) {
			expect(getMindMapStyleTemplate(key)).toEqual(
				normalizeMindMapStyle(
					MIND_MAP_STYLE_TEMPLATES[
						key as keyof typeof MIND_MAP_STYLE_TEMPLATES
					].style
				)
			);
		}
	});

	it("falls back to the minimal template for unknown ids", () => {
		expect(getMindMapStyleTemplate("unknown-template")).toEqual(
			DEFAULT_MIND_MAP_STYLE
		);
	});

	it("provides distinct layouts across the built-in templates", () => {
		const layouts = Object.values(MIND_MAP_STYLE_TEMPLATES).map(
			(template) => template.style.layout
		);
		expect(new Set(layouts).size).toBeGreaterThan(1);
	});
});

describe("note style overrides", () => {
	const globalStyle = normalizeMindMapStyle({ lineStyle: "curve" });

	it("sanitizes only valid partial fields", () => {
		expect(
			sanitizeMindMapStylePartial({
				layout: "timeline",
				lineStyle: "bad-line",
				lineRadius: -1,
				lineWidth: 2
			})
		).toEqual({
			layout: "timeline",
			lineWidth: 2
		});
	});

	it("drops removed legacy layout overrides but keeps other fields", () => {
		expect(
			sanitizeMindMapStylePartial({
				layout: "catalogOrganization",
				lineStyle: "direct"
			})
		).toEqual({
			lineStyle: "direct"
		});
		expect(
			sanitizeNoteStyles({
				"a.md": { layout: "rightFishbone2" }
			})
		).toEqual({});
	});

	it("sanitizes note style maps", () => {
		expect(
			sanitizeNoteStyles({
				"a.md": { layout: "timeline", bad: true },
				"b.md": { lineStyle: "bad-line" },
				"c.md": {}
			})
		).toEqual({
			"a.md": { layout: "timeline" }
		});
	});

	it("merges note overrides with the global style", () => {
		expect(
			getEffectiveMindMapStyle(globalStyle, {
				layout: "mindMap",
				lineColor: "#fff"
			})
		).toMatchObject({
			layout: "mindMap",
			lineStyle: "curve",
			lineColor: "#fff"
		});
	});

	it("sets and clears note overrides", () => {
		const withOverride = setNoteStyleOverride(
			{},
			"a.md",
			{ layout: "timeline", lineStyle: "direct" }
		);
		expect(withOverride).toEqual({
			"a.md": { layout: "timeline", lineStyle: "direct" }
		});
		expect(clearNoteStyleOverride(withOverride, "a.md")).toEqual({});
	});

	it("removes overrides when the diff is empty", () => {
		expect(diffMindMapStyles(globalStyle, globalStyle)).toEqual({});
		expect(
			diffMindMapStyles(globalStyle, {
				...globalStyle,
				lineRadius: 20
			})
		).toEqual({ lineRadius: 20 });
	});
});

describe("mind map style allowed values", () => {
	it("exposes the expected layout values", () => {
		expect(MIND_MAP_LAYOUTS).toEqual([
			"logicalStructure",
			"logicalStructureLeft",
			"mindMap",
			"organizationStructure",
			"timeline",
			"timeline2",
			"verticalTimeline",
			"fishbone"
		]);
		expect(MIND_MAP_LAYOUTS).not.toContain("catalogOrganization");
		expect(MIND_MAP_LAYOUTS).not.toContain("verticalTimeline2");
		expect(MIND_MAP_LAYOUTS).not.toContain("verticalTimeline3");
		expect(MIND_MAP_LAYOUTS).not.toContain("fishbone2");
		expect(MIND_MAP_LAYOUTS).not.toContain("rightFishbone");
		expect(MIND_MAP_LAYOUTS).not.toContain("rightFishbone2");
	});

	it("exposes line styles and shapes", () => {
		expect(MIND_MAP_LINE_STYLES).toEqual(["direct", "straight", "curve"]);
		expect(MIND_MAP_SHAPES).toContain("rectangle");
		expect(MIND_MAP_SHAPES).toContain("roundedRectangle");
		expect(MIND_MAP_SHAPES).toContain("ellipse");
	});
});

describe("layout and line style compatibility", () => {
	it("supports all line styles for flexible layouts", () => {
		for (const layout of [
			"logicalStructure",
			"logicalStructureLeft",
			"mindMap",
			"organizationStructure",
			"verticalTimeline"
		] as const) {
			expect(getSupportedLineStyles(layout)).toEqual([
				"direct",
				"straight",
				"curve"
			]);
		}
	});

	it("falls back to straight for fixed-line layouts", () => {
		expect(resolveEffectiveLineStyle("timeline2", "curve")).toBe("straight");
		expect(resolveEffectiveLineStyle("fishbone", "direct")).toBe("straight");
	});

	it("keeps a supported requested line style", () => {
		expect(resolveEffectiveLineStyle("logicalStructure", "curve")).toBe(
			"curve"
		);
		expect(resolveEffectiveLineStyle("mindMap", "direct")).toBe("direct");
	});

	it("normalizes layout and line style together", () => {
		expect(
			resolveEffectiveMindMapStyle({
				...DEFAULT_MIND_MAP_STYLE,
				layout: "timeline",
				lineStyle: "curve",
				lineRadius: 12
			})
		).toMatchObject({
			layout: "timeline",
			lineStyle: "straight",
			lineRadius: 12
		});
	});
});
