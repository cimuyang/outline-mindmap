import { describe, expect, it } from "vitest";
import {
	buildNoteStyleOverrides,
	DEFAULT_MIND_MAP_STYLE,
	normalizeMindMapStyle
} from "../src/style";

describe("buildNoteStyleOverrides", () => {
	it("returns only fields that differ from the global style", () => {
		const globalStyle = normalizeMindMapStyle({
			layout: "logicalStructure",
			lineStyle: "straight",
			lineRadius: 8
		});
		const draftStyle = {
			...DEFAULT_MIND_MAP_STYLE,
			layout: "mindMap" as const,
			lineStyle: "straight" as const,
			lineRadius: 20
		};

		expect(buildNoteStyleOverrides(globalStyle, draftStyle)).toEqual({
			layout: "mindMap",
			lineRadius: 20
		});
	});

	it("returns an empty object when the draft matches the global style", () => {
		const globalStyle = normalizeMindMapStyle({ lineStyle: "curve" });
		expect(
			buildNoteStyleOverrides(globalStyle, { ...globalStyle })
		).toEqual({});
	});
});
