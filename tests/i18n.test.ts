import { describe, expect, it } from "vitest";
import {
	EN_TRANSLATIONS,
	I18n,
	detectObsidianLanguage,
	isLanguageSetting,
	resolveUILanguage,
	translate
} from "../src/i18n";
import {
	DEFAULT_PLUGIN_SETTINGS,
	normalizePluginSettings
} from "../src/pluginSettings";

describe("i18n 文案完整性", () => {
	it("每条中文文案都有非空英文翻译", () => {
		const entries = Object.entries(EN_TRANSLATIONS);
		expect(entries.length).toBeGreaterThan(100);
		for (const [zh, en] of entries) {
			expect(zh.trim().length).toBeGreaterThan(0);
			expect(en.trim().length).toBeGreaterThan(0);
		}
	});

	it("中文翻译为原文，英文翻译为对应文案", () => {
		expect(translate("常规", "zh")).toBe("常规");
		expect(translate("常规", "en")).toBe("General");
		expect(translate("优雅动画", "en")).toBe("Elegant animation");
	});

	it("未收录文案回退为中文原文", () => {
		expect(translate("未收录的文案", "en")).toBe("未收录的文案");
	});

	it("变量占位符被替换", () => {
		const text = "当前 {speed}x；建议按画面流畅度调整，节点较多时适当降低。";
		expect(translate(text, "zh", { speed: "1.5" })).toContain("1.5");
		expect(translate(text, "en", { speed: "1.5" })).toContain("Currently 1.5x");
	});

	it("同名文案可通过英文覆盖区分（激活标题/按钮）", () => {
		expect(translate("激活", "en")).toBe("Activate");
		expect(translate("激活", "en", undefined, "Activation")).toBe(
			"Activation"
		);
	});
});

describe("i18n 语言解析", () => {
	it("显式语言设置生效", () => {
		expect(resolveUILanguage("zh")).toBe("zh");
		expect(resolveUILanguage("en")).toBe("en");
	});

	it("auto 回退到系统检测，且不会抛异常", () => {
		const lang = resolveUILanguage("auto");
		expect(lang === "zh" || lang === "en").toBe(true);
		expect(detectObsidianLanguage() === "zh" || detectObsidianLanguage() === "en").toBe(
			true
		);
	});

	it("语言设置校验", () => {
		expect(isLanguageSetting("auto")).toBe(true);
		expect(isLanguageSetting("zh")).toBe(true);
		expect(isLanguageSetting("en")).toBe(true);
		expect(isLanguageSetting("ja")).toBe(false);
	});

	it("I18n 实例按语言取文案", () => {
		const i18n = new I18n();
		i18n.setLanguage("en");
		expect(i18n.t("机器码")).toBe("Machine code");
		i18n.setLanguage("zh");
		expect(i18n.t("机器码")).toBe("机器码");
	});
});

describe("pluginSettings 语言字段", () => {
	it("默认跟随 Obsidian（auto）", () => {
		expect(DEFAULT_PLUGIN_SETTINGS.language).toBe("auto");
		expect(normalizePluginSettings({}).language).toBe("auto");
	});

	it("合法值保留，非法值回退 auto", () => {
		expect(normalizePluginSettings({ language: "zh" }).language).toBe("zh");
		expect(normalizePluginSettings({ language: "en" }).language).toBe("en");
		expect(
			normalizePluginSettings({ language: "ja" } as never).language
		).toBe("auto");
	});
});
