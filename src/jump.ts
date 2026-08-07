export const JUMP_DELAY_MS = 300;

export interface JumpTriggerState {
	clickToJump: boolean;
	isEditing: boolean;
	isDragging: boolean;
	isLink: boolean;
}

export function shouldTriggerJump(state: JumpTriggerState): boolean {
	return (
		state.clickToJump &&
		!state.isEditing &&
		!state.isDragging &&
		!state.isLink
	);
}
