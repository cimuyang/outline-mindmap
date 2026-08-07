import type { App, TFile } from "obsidian";
import { SyncManager } from "./sync";
import type { SyncWriteOptions } from "./sync";

export type NoteSyncSubscriber = (
	text: string
) => void | Promise<void>;

export class NoteSyncCoordinator {
	private readonly sync: SyncManager;
	private readonly filePath: string;
	private readonly subscribers = new Set<NoteSyncSubscriber>();

	constructor(
		app: App,
		file: TFile,
		onReadError?: () => void
	) {
		this.filePath = file.path;
		this.sync = new SyncManager(app, file, {
			onMarkdownChanged: (text) => {
				void this.broadcast(text);
			},
			onReadError
		});
		this.sync.attach();
	}

	get path(): string {
		return this.filePath;
	}

	subscribe(callback: NoteSyncSubscriber): () => void {
		this.subscribers.add(callback);
		return () => this.unsubscribe(callback);
	}

	unsubscribe(callback: NoteSyncSubscriber): void {
		this.subscribers.delete(callback);
	}

	get hasSubscribers(): boolean {
		return this.subscribers.size > 0;
	}

	async broadcast(text: string): Promise<void> {
		await Promise.all(
			[...this.subscribers].map((callback) =>
				Promise.resolve(callback(text))
			)
		);
	}

	write(
		text: string,
		options?: SyncWriteOptions
	): Promise<boolean> {
		return this.sync.write(text, options);
	}

	detach(): void {
		this.sync.detach();
	}
}
