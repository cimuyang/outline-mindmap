import type { PluginData } from "./viewState";
import type { MindMapStyle } from "./style";
import { DEFAULT_MIND_MAP_STYLE, normalizeMindMapStyle } from "./style";
import type { LanguageSetting } from "./i18n";
import { isLanguageSetting } from "./i18n";

export interface PluginSettings {
	clickToJump: boolean;
	lockCurrentNote: boolean;
	elegantAnimation: boolean;
	elegantAnimationSpeed: number;
	elegantAnimationSpring: boolean;
	strictHeadingSpacing: boolean;
	language: LanguageSetting;
	mindMapStyle: MindMapStyle;
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
	clickToJump: true,
	lockCurrentNote: false,
	elegantAnimation: false,
	elegantAnimationSpeed: 1,
	elegantAnimationSpring: false,
	strictHeadingSpacing: true,
	language: "auto",
	mindMapStyle: DEFAULT_MIND_MAP_STYLE
};

export function normalizePluginSettings(
	data: Partial<PluginData> | null | undefined
): PluginSettings {
	const raw = data ?? {};
	return {
		clickToJump:
			typeof raw.clickToJump === "boolean"
				? raw.clickToJump
				: DEFAULT_PLUGIN_SETTINGS.clickToJump,
		lockCurrentNote:
			typeof raw.lockCurrentNote === "boolean"
				? raw.lockCurrentNote
				: DEFAULT_PLUGIN_SETTINGS.lockCurrentNote,
		elegantAnimation:
			typeof raw.elegantAnimation === "boolean"
				? raw.elegantAnimation
				: DEFAULT_PLUGIN_SETTINGS.elegantAnimation,
		elegantAnimationSpeed:
			typeof raw.elegantAnimationSpeed === "number" &&
			Number.isFinite(raw.elegantAnimationSpeed)
				? Math.min(2, Math.max(0.5, raw.elegantAnimationSpeed))
				: DEFAULT_PLUGIN_SETTINGS.elegantAnimationSpeed,
		elegantAnimationSpring:
			typeof raw.elegantAnimationSpring === "boolean"
				? raw.elegantAnimationSpring
				: DEFAULT_PLUGIN_SETTINGS.elegantAnimationSpring,
		strictHeadingSpacing:
			typeof raw.strictHeadingSpacing === "boolean"
				? raw.strictHeadingSpacing
				: DEFAULT_PLUGIN_SETTINGS.strictHeadingSpacing,
		language: isLanguageSetting(raw.language)
			? raw.language
			: DEFAULT_PLUGIN_SETTINGS.language,
		mindMapStyle: normalizeMindMapStyle(raw.mindMapStyle)
	};
}
