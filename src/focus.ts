export type FocusStrategy = "edit-now" | "defer" | "drop";

export function resolveFocusStrategy(state: {
	renderPending: boolean;
	nodeFound: boolean;
	isRoot: boolean;
}): FocusStrategy {
	if (state.renderPending || !state.nodeFound) {
		return "defer";
	}
	if (state.nodeFound && state.isRoot) {
		return "drop";
	}
	return "edit-now";
}
