export const MIND_MAP_LAYOUTS = [
	"logicalStructure",
	"logicalStructureLeft",
	"mindMap",
	"organizationStructure",
	"timeline",
	"timeline2",
	"verticalTimeline",
	"fishbone"
] as const;

export type MindMapLayout = (typeof MIND_MAP_LAYOUTS)[number];

export const MIND_MAP_LINE_STYLES = ["direct", "straight", "curve"] as const;

export type MindMapLineStyle = (typeof MIND_MAP_LINE_STYLES)[number];

export const MIND_MAP_SHAPES = [
	"rectangle",
	"diamond",
	"parallelogram",
	"roundedRectangle",
	"octagonalRectangle",
	"outerTriangularRectangle",
	"innerTriangularRectangle",
	"ellipse",
	"circle"
] as const;

export type MindMapShape = (typeof MIND_MAP_SHAPES)[number];

export interface MindMapStyle {
	layout: MindMapLayout;
	lineStyle: MindMapLineStyle;
	lineRadius: number;
	lineWidth: number;
	lineColor: string;
	secondMarginX: number;
	secondMarginY: number;
	nodeMarginX: number;
	nodeMarginY: number;
	shape: MindMapShape;
	fillColor: string;
	borderColor: string;
	borderWidth: number;
	borderRadius: number;
	fontSize: number;
}

export const DEFAULT_MIND_MAP_STYLE: MindMapStyle = {
	layout: "logicalStructure",
	lineStyle: "straight",
	lineRadius: 8,
	lineWidth: 1,
	lineColor: "",
	secondMarginX: 80,
	secondMarginY: 30,
	nodeMarginX: 48,
	nodeMarginY: 10,
	shape: "rectangle",
	fillColor: "transparent",
	borderColor: "transparent",
	borderWidth: 0,
	borderRadius: 6,
	fontSize: 13
};

export const MIND_MAP_STYLE_TEMPLATES = {
	minimal: {
		name: "简洁大纲",
		style: { ...DEFAULT_MIND_MAP_STYLE }
	},
	classic: {
		name: "经典思维导图",
		style: {
			layout: "mindMap",
			lineStyle: "curve",
			lineRadius: 8,
			lineWidth: 1,
			lineColor: "",
			secondMarginX: 100,
			secondMarginY: 40,
			nodeMarginX: 50,
			nodeMarginY: 16,
			shape: "roundedRectangle",
			fillColor: "#ffffff",
			borderColor: "#549688",
			borderWidth: 1,
			borderRadius: 6,
			fontSize: 14
		}
	},
	cards: {
		name: "卡片风",
		style: {
			layout: "logicalStructure",
			lineStyle: "straight",
			lineRadius: 12,
			lineWidth: 1,
			lineColor: "",
			secondMarginX: 90,
			secondMarginY: 28,
			nodeMarginX: 52,
			nodeMarginY: 14,
			shape: "roundedRectangle",
			fillColor: "#f7fbfb",
			borderColor: "#8ab4b0",
			borderWidth: 1,
			borderRadius: 10,
			fontSize: 13
		}
	},
	timeline: {
		name: "时间线",
		style: {
			layout: "timeline",
			lineStyle: "straight",
			lineRadius: 8,
			lineWidth: 1,
			lineColor: "",
			secondMarginX: 90,
			secondMarginY: 40,
			nodeMarginX: 50,
			nodeMarginY: 12,
			shape: "roundedRectangle",
			fillColor: "#f7f7f7",
			borderColor: "#999999",
			borderWidth: 1,
			borderRadius: 6,
			fontSize: 13
		}
	}
} as const satisfies Record<
	string,
	{ name: string; style: MindMapStyle }
>;

export type MindMapStyleTemplateId = keyof typeof MIND_MAP_STYLE_TEMPLATES;

const MIND_MAP_STYLE_KEYS = [
	"layout",
	"lineStyle",
	"lineRadius",
	"lineWidth",
	"lineColor",
	"secondMarginX",
	"secondMarginY",
	"nodeMarginX",
	"nodeMarginY",
	"shape",
	"fillColor",
	"borderColor",
	"borderWidth",
	"borderRadius",
	"fontSize"
] as const;

export type MindMapStyleKey = (typeof MIND_MAP_STYLE_KEYS)[number];

export type MindMapNoteStyles = Record<string, Partial<MindMapStyle>>;

export function getMindMapStyleTemplate(
	templateId: unknown
): MindMapStyle {
	const id = isRecord(MIND_MAP_STYLE_TEMPLATES)
		? (templateId as MindMapStyleTemplateId)
		: "minimal";
	const template = MIND_MAP_STYLE_TEMPLATES[id];
	return normalizeMindMapStyle(template?.style ?? DEFAULT_MIND_MAP_STYLE);
}

export function sanitizeMindMapStylePartial(
	raw: unknown
): Partial<MindMapStyle> {
	if (!isRecord(raw)) {
		return {};
	}
	const result: Record<string, unknown> = {};
	for (const key of MIND_MAP_STYLE_KEYS) {
		if (raw[key] === undefined) {
			continue;
		}
		if (isValidMindMapStylePartialValue(key, raw[key])) {
			result[key] = raw[key];
		}
	}
	return result as Partial<MindMapStyle>;
}

function isValidMindMapStylePartialValue(
	key: MindMapStyleKey,
	value: unknown
): boolean {
	switch (key) {
		case "layout":
			return MIND_MAP_LAYOUTS.includes(value as MindMapLayout);
		case "lineStyle":
			return MIND_MAP_LINE_STYLES.includes(value as MindMapLineStyle);
		case "shape":
			return MIND_MAP_SHAPES.includes(value as MindMapShape);
		case "fontSize":
			return finitePositiveNumber(value, Number.NaN) === value;
		case "lineRadius":
		case "lineWidth":
		case "secondMarginX":
		case "secondMarginY":
		case "nodeMarginX":
		case "nodeMarginY":
		case "borderWidth":
		case "borderRadius":
			return finiteNonNegativeNumber(value, Number.NaN) === value;
		case "lineColor":
		case "fillColor":
		case "borderColor":
			return typeof value === "string";
	}
	return false;
}

export function sanitizeNoteStyles(raw: unknown): MindMapNoteStyles {
	if (!isRecord(raw)) {
		return {};
	}
	const result: MindMapNoteStyles = {};
	for (const [path, value] of Object.entries(raw)) {
		if (!path) {
			continue;
		}
		const partial = sanitizeMindMapStylePartial(value);
		if (Object.keys(partial).length > 0) {
			result[path] = partial;
		}
	}
	return result;
}

export function getEffectiveMindMapStyle(
	globalStyle: MindMapStyle,
	noteOverride: Partial<MindMapStyle> | null | undefined
): MindMapStyle {
	return resolveEffectiveMindMapStyle(
		mergeMindMapStyles(globalStyle, noteOverride)
	);
}

export function setNoteStyleOverride(
	noteStyles: MindMapNoteStyles,
	filePath: string,
	override: Partial<MindMapStyle> | null | undefined
): MindMapNoteStyles {
	const next = { ...noteStyles };
	const clean = sanitizeMindMapStylePartial(override);
	if (!filePath || Object.keys(clean).length === 0) {
		delete next[filePath];
	} else {
		next[filePath] = clean;
	}
	return next;
}

export function clearNoteStyleOverride(
	noteStyles: MindMapNoteStyles,
	filePath: string
): MindMapNoteStyles {
	const next = { ...noteStyles };
	delete next[filePath];
	return next;
}

export function renameNoteStyleOverride(
	noteStyles: MindMapNoteStyles,
	oldPath: string,
	newPath: string
): MindMapNoteStyles {
	if (!oldPath || !newPath || oldPath === newPath) {
		return noteStyles;
	}
	const next = { ...noteStyles };
	const override = next[oldPath];
	if (override) {
		next[newPath] = override;
		delete next[oldPath];
	}
	return next;
}

export function diffMindMapStyles(
	base: MindMapStyle,
	next: MindMapStyle
): Partial<MindMapStyle> {
	const result: Record<string, unknown> = {};
	for (const key of MIND_MAP_STYLE_KEYS) {
		if (base[key] !== next[key]) {
			result[key] = next[key];
		}
	}
	return result as Partial<MindMapStyle>;
}

const LINE_STYLE_SUPPORT: Record<MindMapLayout, readonly MindMapLineStyle[]> = {
	logicalStructure: ["direct", "straight", "curve"],
	logicalStructureLeft: ["direct", "straight", "curve"],
	mindMap: ["direct", "straight", "curve"],
	organizationStructure: ["direct", "straight", "curve"],
	timeline: ["straight"],
	timeline2: ["straight"],
	verticalTimeline: ["direct", "straight", "curve"],
	fishbone: ["straight"]
};

export function normalizeMindMapStyle(raw: unknown): MindMapStyle {
	const value = isRecord(raw) ? raw : {};
	return {
		layout: oneOf(value.layout, MIND_MAP_LAYOUTS, DEFAULT_MIND_MAP_STYLE.layout),
		lineStyle: oneOf(
			value.lineStyle,
			MIND_MAP_LINE_STYLES,
			DEFAULT_MIND_MAP_STYLE.lineStyle
		),
		lineRadius: finiteNonNegativeNumber(
			value.lineRadius,
			DEFAULT_MIND_MAP_STYLE.lineRadius
		),
		lineWidth: finiteNonNegativeNumber(
			value.lineWidth,
			DEFAULT_MIND_MAP_STYLE.lineWidth
		),
		lineColor: stringValue(value.lineColor, DEFAULT_MIND_MAP_STYLE.lineColor),
		secondMarginX: finiteNonNegativeNumber(
			value.secondMarginX,
			DEFAULT_MIND_MAP_STYLE.secondMarginX
		),
		secondMarginY: finiteNonNegativeNumber(
			value.secondMarginY,
			DEFAULT_MIND_MAP_STYLE.secondMarginY
		),
		nodeMarginX: finiteNonNegativeNumber(
			value.nodeMarginX,
			DEFAULT_MIND_MAP_STYLE.nodeMarginX
		),
		nodeMarginY: finiteNonNegativeNumber(
			value.nodeMarginY,
			DEFAULT_MIND_MAP_STYLE.nodeMarginY
		),
		shape: oneOf(value.shape, MIND_MAP_SHAPES, DEFAULT_MIND_MAP_STYLE.shape),
		fillColor: stringValue(
			value.fillColor,
			DEFAULT_MIND_MAP_STYLE.fillColor
		),
		borderColor: stringValue(
			value.borderColor,
			DEFAULT_MIND_MAP_STYLE.borderColor
		),
		borderWidth: finiteNonNegativeNumber(
			value.borderWidth,
			DEFAULT_MIND_MAP_STYLE.borderWidth
		),
		borderRadius: finiteNonNegativeNumber(
			value.borderRadius,
			DEFAULT_MIND_MAP_STYLE.borderRadius
		),
		fontSize: finitePositiveNumber(
			value.fontSize,
			DEFAULT_MIND_MAP_STYLE.fontSize
		)
	};
}

export function mergeMindMapStyles(
	base: MindMapStyle,
	override: Partial<MindMapStyle> | null | undefined
): MindMapStyle {
	if (!isRecord(override)) {
		return normalizeMindMapStyle(base);
	}
	const defined: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(override)) {
		if (item !== undefined) {
			defined[key] = item;
		}
	}
	return normalizeMindMapStyle({ ...base, ...defined });
}

export function getSupportedLineStyles(
	layout: MindMapLayout
): readonly MindMapLineStyle[] {
	return LINE_STYLE_SUPPORT[layout] ?? ["straight"];
}

export function resolveEffectiveLineStyle(
	layout: MindMapLayout,
	requested: MindMapLineStyle
): MindMapLineStyle {
	const supported = getSupportedLineStyles(layout);
	if (supported.includes(requested)) {
		return requested;
	}
	return supported.includes("straight") ? "straight" : supported[0] ?? "straight";
}

export function resolveEffectiveMindMapStyle(style: MindMapStyle): MindMapStyle {
	const normalized = normalizeMindMapStyle(style);
	return {
		...normalized,
		lineStyle: resolveEffectiveLineStyle(
			normalized.layout,
			normalized.lineStyle
		)
	};
}

export function buildNoteStyleOverrides(
	globalStyle: MindMapStyle,
	draftStyle: MindMapStyle
): Partial<MindMapStyle> {
	return diffMindMapStyles(
		globalStyle,
		resolveEffectiveMindMapStyle(draftStyle)
	);
}

function oneOf<T extends string>(
	value: unknown,
	allowed: readonly T[],
	fallback: T
): T {
	return allowed.includes(value as T) ? (value as T) : fallback;
}

function finiteNonNegativeNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: fallback;
}

function finitePositiveNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: fallback;
}

function stringValue(value: unknown, fallback: string): string {
	return typeof value === "string" ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
