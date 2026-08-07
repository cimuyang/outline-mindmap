import { describe, expect, it } from "vitest";
import { normalizePluginSettings } from "../src/pluginSettings";
import { DEFAULT_MIND_MAP_STYLE } from "../src/style";
import type { PluginData } from "../src/viewState";

describe("normalizePluginSettings", () => {
	it("uses the documented defaults for missing data", () => {
		expect(normalizePluginSettings(null)).toEqual({
			clickToJump: true,
			lockCurrentNote: false,
			elegantAnimation: false,
			elegantAnimationSpeed: 1,
			elegantAnimationSpring: false,
			strictHeadingSpacing: true,
			language: "auto",
			mindMapStyle: DEFAULT_MIND_MAP_STYLE
		});
		expect(normalizePluginSettings(undefined)).toEqual({
			clickToJump: true,
			lockCurrentNote: false,
			elegantAnimation: false,
			elegantAnimationSpeed: 1,
			elegantAnimationSpring: false,
			strictHeadingSpacing: true,
			language: "auto",
			mindMapStyle: DEFAULT_MIND_MAP_STYLE
		});
	});

	it("keeps explicit boolean values", () => {
		expect(
			normalizePluginSettings({
				clickToJump: false,
				lockCurrentNote: true,
				elegantAnimation: true,
				elegantAnimationSpeed: 1.5,
				elegantAnimationSpring: true,
				strictHeadingSpacing: false
			})
		).toEqual({
			clickToJump: false,
			lockCurrentNote: true,
			elegantAnimation: true,
			elegantAnimationSpeed: 1.5,
			elegantAnimationSpring: true,
			strictHeadingSpacing: false,
			language: "auto",
			mindMapStyle: DEFAULT_MIND_MAP_STYLE
		});
	});

	it("falls back to defaults for invalid value types", () => {
		expect(
			normalizePluginSettings({
				clickToJump: "yes" as unknown as boolean,
				lockCurrentNote: 1 as unknown as boolean,
				elegantAnimation: "yes" as unknown as boolean,
				elegantAnimationSpeed: "fast" as unknown as number,
				elegantAnimationSpring: "yes" as unknown as boolean,
				strictHeadingSpacing: "yes" as unknown as boolean
			})
		).toEqual({
			clickToJump: true,
			lockCurrentNote: false,
			elegantAnimation: false,
			elegantAnimationSpeed: 1,
			elegantAnimationSpring: false,
			strictHeadingSpacing: true,
			language: "auto",
			mindMapStyle: DEFAULT_MIND_MAP_STYLE
		});
	});

	it("clamps animation speed to the configured range", () => {
		expect(
			normalizePluginSettings({
				elegantAnimationSpeed: 3
			}).elegantAnimationSpeed
		).toBe(2);
		expect(
			normalizePluginSettings({
				elegantAnimationSpeed: 0.2
			}).elegantAnimationSpeed
		).toBe(0.5);
	});

	it("keeps a valid mind map style and falls back for invalid ones", () => {
		expect(
			normalizePluginSettings({
				mindMapStyle: {
					lineStyle: "direct",
					lineRadius: 12
				} as unknown as PluginData["mindMapStyle"]
			}).mindMapStyle
		).toMatchObject({
			lineStyle: "direct",
			lineRadius: 12
		});

		expect(
			normalizePluginSettings({
				mindMapStyle: {
					layout: "bad-layout",
					lineStyle: "bad-line",
					lineRadius: -1
				} as unknown as PluginData["mindMapStyle"]
			}).mindMapStyle
		).toEqual(DEFAULT_MIND_MAP_STYLE);
	});

	it("falls back to the default layout when old data uses a removed layout", () => {
		const normalized = normalizePluginSettings({
			mindMapStyle: {
				layout: "fishbone2",
				lineStyle: "curve",
				lineRadius: 12
			} as unknown as PluginData["mindMapStyle"]
		}).mindMapStyle;

		expect(normalized.layout).toBe(DEFAULT_MIND_MAP_STYLE.layout);
		expect(normalized.lineStyle).toBe("curve");
		expect(normalized.lineRadius).toBe(12);
	});
});
