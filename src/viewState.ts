import type { MapNodeRegistry } from "./mapNodeRegistry";
import type { MindMapStyle } from "./style";

export interface MindMapViewState {
	collapsed: string[];
	transform?: unknown;
	lastOpened: number;
}

export interface PluginData {
	clickToJump?: boolean;
	lockCurrentNote?: boolean;
	elegantAnimation?: boolean;
	elegantAnimationSpeed?: number;
	elegantAnimationSpring?: boolean;
	strictHeadingSpacing?: boolean;
	language?: string;
	mindMapStyle?: MindMapStyle;
	licenseCode?: string;
	licenseMachine?: string;
	licenseTier?: string;
	licenseExpiresAt?: string;
	licenseActivatedAt?: string;
	noteStyles?: Record<string, Partial<MindMapStyle>>;
	viewStates?: Record<string, MindMapViewState>;
	mapNodeRegistry?: MapNodeRegistry;
}

export const MAX_VIEW_STATES = 1000;

export function sanitizeViewStates(
	raw: unknown
): Record<string, MindMapViewState> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return {};
	}
	const result: Record<string, MindMapViewState> = {};
	for (const [key, value] of Object.entries(
		raw as Record<string, unknown>
	)) {
		const state = sanitizeViewState(value);
		if (state) {
			result[key] = state;
		}
	}
	return result;
}

export function sanitizeViewState(raw: unknown): MindMapViewState | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return null;
	}
	const value = raw as Record<string, unknown>;
	const collapsed = Array.isArray(value.collapsed)
		? value.collapsed.filter(
				(id): id is string => typeof id === "string" && id !== ""
			)
		: [];
	const transform =
		isPlainObject(value.transform) &&
		Object.keys(value.transform).length > 0
			? value.transform
			: undefined;
	const lastOpened =
		typeof value.lastOpened === "number" && Number.isFinite(value.lastOpened)
			? value.lastOpened
			: Date.now();
	if (collapsed.length === 0 && transform === undefined) {
		return null;
	}
	return {
		collapsed,
		...(transform === undefined ? {} : { transform }),
		lastOpened
	};
}

export function getViewState(
	viewStates: Record<string, MindMapViewState>,
	filePath: string
): MindMapViewState | null {
	return sanitizeViewState(viewStates[filePath]);
}

export function setViewState(
	viewStates: Record<string, MindMapViewState>,
	filePath: string,
	state: MindMapViewState,
	maxEntries = MAX_VIEW_STATES,
	now = Date.now()
): Record<string, MindMapViewState> {
	if (!filePath) {
		return viewStates;
	}
	const next = { ...viewStates };
	const sanitized = sanitizeViewState(state);
	if (!sanitized) {
		delete next[filePath];
		return next;
	}
	next[filePath] = { ...sanitized, lastOpened: now };

	const keys = Object.keys(next);
	if (maxEntries > 0 && keys.length > maxEntries) {
		const sorted = keys
			.map((key) => ({
				key,
				lastOpened: next[key].lastOpened ?? 0
			}))
			.sort((a, b) => a.lastOpened - b.lastOpened);
		for (let i = 0; i < keys.length - maxEntries; i++) {
			delete next[sorted[i].key];
		}
	}
	return next;
}

export function removeViewState(
	viewStates: Record<string, MindMapViewState>,
	filePath: string
): Record<string, MindMapViewState> {
	if (!filePath) {
		return viewStates;
	}
	const next = { ...viewStates };
	delete next[filePath];
	return next;
}

export function renameViewState(
	viewStates: Record<string, MindMapViewState>,
	oldPath: string,
	newPath: string
): Record<string, MindMapViewState> {
	if (!oldPath || !newPath || oldPath === newPath) {
		return viewStates;
	}
	const next = { ...viewStates };
	const state = next[oldPath];
	if (state) {
		next[newPath] = state;
		delete next[oldPath];
	}
	return next;
}

export function removeViewStatesForFile(
	viewStates: Record<string, MindMapViewState>,
	filePath: string
): Record<string, MindMapViewState> {
	if (!filePath) {
		return viewStates;
	}
	const prefix = filePath + "::";
	const next = { ...viewStates };
	for (const key of Object.keys(next)) {
		if (key.startsWith(prefix)) {
			delete next[key];
		}
	}
	return next;
}

export function renameViewStatesForFile(
	viewStates: Record<string, MindMapViewState>,
	oldPath: string,
	newPath: string
): Record<string, MindMapViewState> {
	if (!oldPath || !newPath || oldPath === newPath) {
		return viewStates;
	}
	const prefix = oldPath + "::";
	const next = { ...viewStates };
	for (const key of Object.keys(next)) {
		if (!key.startsWith(prefix)) {
			continue;
		}
		const newKey = newPath + "::" + key.slice(prefix.length);
		next[newKey] = next[key];
		delete next[key];
	}
	return next;
}

export function filterCollapsedUids(
	viewStates: Record<string, MindMapViewState>,
	filePath: string,
	validUids: Iterable<string>
): Set<string> {
	const state = getViewState(viewStates, filePath);
	if (!state) {
		return new Set<string>();
	}
	const valid = new Set(validUids);
	return new Set(state.collapsed.filter((uid) => valid.has(uid)));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
