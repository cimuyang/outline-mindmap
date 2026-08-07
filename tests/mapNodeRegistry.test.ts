import { describe, expect, it } from "vitest";
import {
	addMapNodeRecord,
	cleanupStaleMapNodeRecords,
	computeMapNodeIdentityKey,
	filterMapNodeRegistryByFilePaths,
	findMapNodeRecord,
	getMapNodeRecords,
	matchMapNodeRegistry,
	migrateMapNodeRecordToCandidate,
	rekeyMapNodeRecord,
	reconcileMapNodeRegistry,
	removeMapNodeRecord,
	removeMapNodeRecordsByKeys,
	removeMapNodeSubtreeByKey,
	removeMapNodeRegistryForFile,
	renameMapNodeRegistryFile,
	sanitizeMapNodeRegistry
} from "../src/mapNodeRegistry";
import type { MapNodeRegistry } from "../src/mapNodeRegistry";

describe("mapNodeRegistry", () => {
	it("computes unique identity keys by parent, text and occurrence", () => {
		const file = "note.md";
		const a = computeMapNodeIdentityKey(file, "h6", "环节", 1);
		const b = computeMapNodeIdentityKey(file, "other", "环节", 1);
		const c = computeMapNodeIdentityKey(file, "h6", "环节", 2);
		expect(a).not.toBe(b);
		expect(a).not.toBe(c);
		expect(computeMapNodeIdentityKey(file, "h6", "环节", 1)).toBe(a);
	});

	it("sanitizes invalid registry data", () => {
		expect(sanitizeMapNodeRegistry(null)).toEqual({});
		expect(sanitizeMapNodeRegistry([])).toEqual({});
		expect(
			sanitizeMapNodeRegistry({
				"note.md": [
					{ parentKey: "h6", text: "节点", occurrence: 1 },
					{ parentKey: "h6", text: "节点", occurrence: 1 },
					{ text: 123 }
				]
			})
		).toMatchObject({
			"note.md": [
				{ parentKey: "h6", text: "节点", occurrence: 1 }
			]
		});
	});

	it("adds records with automatic occurrence for same text", () => {
		let registry: MapNodeRegistry = {};
		const first = addMapNodeRecord(registry, "note.md", {
			parentKey: "h6",
			text: "环节"
		});
		registry = first.registry;
		const second = addMapNodeRecord(registry, "note.md", {
			parentKey: "h6",
			text: "环节"
		});
		registry = second.registry;
		expect(first.record.occurrence).toBe(1);
		expect(second.record.occurrence).toBe(2);
		expect(getMapNodeRecords(registry, "note.md")).toHaveLength(2);
	});

	it("matches registered candidates by document occurrence", () => {
		const registry: MapNodeRegistry = {
			"note.md": [
				{
					key: computeMapNodeIdentityKey("note.md", "h6", "环节", 1),
					parentKey: "h6",
					text: "环节",
					occurrence: 1,
					updatedAt: 1
				}
			]
		};
		const matches = matchMapNodeRegistry(registry, "note.md", [
			{ parentKey: "h6", text: "环节" },
			{ parentKey: "h6", text: "环节" },
			{ parentKey: "h6", text: "其他" }
		]);
		expect(matches.map((match) => match.candidateIndex)).toEqual([0]);
	});

	it("keeps identity after text migration and ignores list marker type", () => {
		let registry: MapNodeRegistry = {};
		const added = addMapNodeRecord(registry, "note.md", {
			parentKey: "h6",
			text: "旧文字"
		});
		registry = added.registry;
		const migrated = migrateMapNodeRecordToCandidate(
			registry,
			"note.md",
			added.record.key,
			{
				parentKey: "h6",
				text: "新文字",
				occurrence: 1
			}
		);
		registry = migrated.registry;
		expect(
			findMapNodeRecord(registry, "note.md", "h6", "新文字", 1)
		).toBeDefined();
		expect(
			findMapNodeRecord(registry, "note.md", "h6", "旧文字", 1)
		).toBeUndefined();
		const typedAsOrdered = computeMapNodeIdentityKey(
			"note.md",
			"h6",
			"新文字",
			1
		);
		expect(typedAsOrdered).toBe(
			computeMapNodeIdentityKey("note.md", "h6", "新文字", 1)
		);
	});

	it("migrates an empty created node to the real duplicate occurrence", () => {
		let registry: MapNodeRegistry = {};
		const first = addMapNodeRecord(registry, "note.md", {
			parentKey: "h6",
			text: "H7",
			occurrence: 1
		});
		registry = first.registry;
		const empty = addMapNodeRecord(registry, "note.md", {
			parentKey: "h6",
			text: "",
			occurrence: 1
		});
		registry = empty.registry;

		const migrated = migrateMapNodeRecordToCandidate(
			registry,
			"note.md",
			empty.record.key,
			{
				parentKey: "h6",
				text: "H7",
				occurrence: 2
			}
		);

		registry = migrated.registry;
		expect(
			findMapNodeRecord(registry, "note.md", "h6", "H7", 1)
		).toBeDefined();
		expect(
			findMapNodeRecord(registry, "note.md", "h6", "H7", 2)
		).toBeDefined();
		expect(
			findMapNodeRecord(registry, "note.md", "h6", "", 1)
		).toBeUndefined();
	});

	it("does not steal an existing identity when candidate key conflicts", () => {
		const firstKey = computeMapNodeIdentityKey(
			"note.md",
			"h6",
			"H7",
			1
		);
		const emptyKey = computeMapNodeIdentityKey("note.md", "h6", "", 1);
		const registry: MapNodeRegistry = {
			"note.md": [
				{
					key: firstKey,
					parentKey: "h6",
					text: "H7",
					occurrence: 1,
					updatedAt: 1
				},
				{
					key: emptyKey,
					parentKey: "h6",
					text: "",
					occurrence: 1,
					updatedAt: 1
				}
			]
		};
		const migrated = migrateMapNodeRecordToCandidate(
			registry,
			"note.md",
			emptyKey,
			{
				parentKey: "h6",
				text: "H7",
				occurrence: 1
			}
		);
		expect(migrated.key).toBe(firstKey);
		expect(
			findMapNodeRecord(registry, "note.md", "h6", "H7", 1)
		).toBeDefined();
		expect(
			getMapNodeRecords(migrated.registry, "note.md").find(
				(record) => record.key === emptyKey
			)
		).toBeUndefined();
	});

	it("removes a record and cleans stale keys", () => {
		const key = computeMapNodeIdentityKey("note.md", "h6", "节点", 1);
		const registry: MapNodeRegistry = {
			"note.md": [
				{
					key,
					parentKey: "h6",
					text: "节点",
					occurrence: 1,
					updatedAt: 1
				},
				{
					key: computeMapNodeIdentityKey("note.md", "h6", "旧节点", 1),
					parentKey: "h6",
					text: "旧节点",
					occurrence: 1,
					updatedAt: 1
				}
			]
		};
		expect(
			getMapNodeRecords(
				removeMapNodeRecord(registry, "note.md", key),
				"note.md"
			)
		).toHaveLength(1);
		expect(
			getMapNodeRecords(
				cleanupStaleMapNodeRecords(registry, "note.md", [key]),
				"note.md"
			)
		).toEqual([
			expect.objectContaining({ key, text: "节点" })
		]);
	});

	it("removes multiple records by keys", () => {
		const a = computeMapNodeIdentityKey("note.md", "h6", "A", 1);
		const b = computeMapNodeIdentityKey("note.md", "h6", "B", 1);
		const registry: MapNodeRegistry = {
			"note.md": [
				{
					key: a,
					parentKey: "h6",
					text: "A",
					occurrence: 1,
					updatedAt: 1
				},
				{
					key: b,
					parentKey: "h6",
					text: "B",
					occurrence: 1,
					updatedAt: 1
				}
			]
		};
		const next = removeMapNodeRecordsByKeys(registry, "note.md", [a, b]);
		expect(next).toEqual({});
	});

	it("rekeys a record to a new parent", () => {
		const oldKey = computeMapNodeIdentityKey("note.md", "h6", "节点", 1);
		const newKey = computeMapNodeIdentityKey("note.md", "h7", "节点", 1);
		const registry: MapNodeRegistry = {
			"note.md": [
				{
					key: oldKey,
					parentKey: "h6",
					text: "节点",
					occurrence: 1,
					updatedAt: 1
				}
			]
		};
		const next = rekeyMapNodeRecord(registry, "note.md", oldKey, "h7");
		expect(getMapNodeRecords(next, "note.md")[0]).toMatchObject({
			key: newKey,
			parentKey: "h7",
			text: "节点",
			occurrence: 1
		});
	});

	it("removes descendant records by subtree key", () => {
		const rootKey = computeMapNodeIdentityKey("note.md", "h6", "父", 1);
		const childKey = computeMapNodeIdentityKey("note.md", rootKey, "子", 1);
		const registry: MapNodeRegistry = {
			"note.md": [
				{
					key: rootKey,
					parentKey: "h6",
					text: "父",
					occurrence: 1,
					updatedAt: 1
				},
				{
					key: childKey,
					parentKey: rootKey,
					text: "子",
					occurrence: 1,
					updatedAt: 1
				}
			]
		};
		const next = removeMapNodeSubtreeByKey(registry, "note.md", rootKey);
		expect(next).toEqual({});
	});

	it("reconciles away stale records", () => {
		const key = computeMapNodeIdentityKey("note.md", "h6", "旧节点", 1);
		const registry: MapNodeRegistry = {
			"note.md": [
				{
					key,
					parentKey: "h6",
					text: "旧节点",
					occurrence: 1,
					updatedAt: 1
				}
			]
		};
		const next = reconcileMapNodeRegistry(registry, "note.md", [
			{ parentKey: "h6", text: "新节点" }
		]);
		expect(next).toEqual({});
	});

	it("removes and renames file registries", () => {
		const registry: MapNodeRegistry = {
			"old.md": [
				{
					key: computeMapNodeIdentityKey("old.md", "h6", "节点", 1),
					parentKey: "h6",
					text: "节点",
					occurrence: 1,
					updatedAt: 1
				}
			]
		};
		expect(removeMapNodeRegistryForFile(registry, "old.md")).toEqual({});
		const renamed = renameMapNodeRegistryFile(registry, "old.md", "new.md");
		expect(getMapNodeRecords(renamed, "old.md")).toEqual([]);
		expect(getMapNodeRecords(renamed, "new.md")[0]).toMatchObject({
			key: computeMapNodeIdentityKey("new.md", "h6", "节点", 1),
			parentKey: "h6",
			text: "节点",
			occurrence: 1
		});
	});

	it("rewrites nested parent keys when renaming a file", () => {
		const parentKey = computeMapNodeIdentityKey(
			"old.md",
			"h6",
			"父节点",
			1
		);
		const childKey = computeMapNodeIdentityKey(
			"old.md",
			parentKey,
			"子节点",
			1
		);
		const registry: MapNodeRegistry = {
			"old.md": [
				{
					key: parentKey,
					parentKey: "h6",
					text: "父节点",
					occurrence: 1,
					updatedAt: 1
				},
				{
					key: childKey,
					parentKey,
					text: "子节点",
					occurrence: 1,
					updatedAt: 1
				}
			]
		};
		const renamed = renameMapNodeRegistryFile(
			registry,
			"old.md",
			"new.md"
		);
		const records = getMapNodeRecords(renamed, "new.md");
		const newParentKey = computeMapNodeIdentityKey(
			"new.md",
			"h6",
			"父节点",
			1
		);
		expect(
			records.find((record) => record.text === "父节点")?.key
		).toBe(newParentKey);
		expect(
			records.find((record) => record.text === "子节点")?.parentKey
		).toBe(newParentKey);
		expect(
			records.find((record) => record.text === "子节点")?.key
		).toBe(
			computeMapNodeIdentityKey(
				"new.md",
				newParentKey,
				"子节点",
				1
			)
		);
	});

	it("filters registries to existing file paths", () => {
		const key = computeMapNodeIdentityKey("keep.md", "h6", "节点", 1);
		const registry: MapNodeRegistry = {
			"keep.md": [
				{
					key,
					parentKey: "h6",
					text: "节点",
					occurrence: 1,
					updatedAt: 1
				}
			],
			"removed.md": [
				{
					key: computeMapNodeIdentityKey(
						"removed.md",
						"h6",
						"旧节点",
						1
					),
					parentKey: "h6",
					text: "旧节点",
					occurrence: 1,
					updatedAt: 1
				}
			]
		};
		expect(
			filterMapNodeRegistryByFilePaths(registry, ["keep.md"])
		).toEqual({
			"keep.md": registry["keep.md"]
		});
	});
});
