export type BlankDropAction = "none" | "promote";

export function resolveBlankDropAction(
	nodeType: "heading" | "list",
	level: number
): BlankDropAction {
	if (nodeType === "heading" && level === 1) {
		return "none";
	}
	return "promote";
}
