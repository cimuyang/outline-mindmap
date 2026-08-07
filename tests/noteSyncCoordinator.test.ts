import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { NoteSyncCoordinator } from "../src/noteSyncCoordinator";

function createHarness() {
	const workspace = {
		on: vi.fn(),
		off: vi.fn(),
		getLeavesOfType: vi.fn(() => [])
	};
	const vault = {
		on: vi.fn(),
		off: vi.fn(),
		cachedRead: vi.fn(async () => ""),
		process: vi.fn(async () => undefined)
	};
	const app = {
		workspace,
		vault
	} as unknown as App;
	const file = { path: "note.md", extension: "md" } as TFile;
	return { app, file };
}

describe("NoteSyncCoordinator", () => {
	it("broadcasts the latest markdown to every subscriber", async () => {
		const { app, file } = createHarness();
		const coordinator = new NoteSyncCoordinator(app, file);
		const first = vi.fn(async () => undefined);
		const second = vi.fn(async () => undefined);
		coordinator.subscribe(first);
		coordinator.subscribe(second);

		await coordinator.broadcast("# A\n## B\n");

		expect(first).toHaveBeenCalledWith("# A\n## B\n");
		expect(second).toHaveBeenCalledWith("# A\n## B\n");
		expect(coordinator.path).toBe("note.md");
		coordinator.detach();
	});

	it("stops notifying a subscriber after unsubscribe", async () => {
		const { app, file } = createHarness();
		const coordinator = new NoteSyncCoordinator(app, file);
		const subscriber = vi.fn(async () => undefined);
		coordinator.subscribe(subscriber);

		await coordinator.broadcast("# A\n");
		coordinator.unsubscribe(subscriber);
		await coordinator.broadcast("# B\n");

		expect(subscriber).toHaveBeenCalledTimes(1);
		expect(subscriber).toHaveBeenCalledWith("# A\n");
		expect(coordinator.hasSubscribers).toBe(false);
		coordinator.detach();
	});
});
