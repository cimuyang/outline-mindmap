export interface MapNodeRecord {
	key: string;
	parentKey: string | null;
	text: string;
	occurrence: number;
	updatedAt: number;
}

export interface MapNodeCandidate {
	parentKey: string | null;
	text: string;
}

export interface MapNodeMatch {
	candidateIndex: number;
	record: MapNodeRecord;
}

export type MapNodeRegistry = Record<string, MapNodeRecord[]>;

export const MAX_MAP_NODE_RECORDS_PER_FILE = 5000;

export function computeMapNodeIdentityKey(
	filePath: string,
	parentKey: string | null,
	text: string,
	occurrence: number
): string {
	return JSON.stringify([filePath, parentKey ?? "", text, occurrence]);
}

export function sanitizeMapNodeRegistry(raw: unknown): MapNodeRegistry {
	if (!isPlainObject(raw)) {
		return {};
	}
	const result: MapNodeRegistry = {};
	for (const [filePath, records] of Object.entries(
		raw as Record<string, unknown>
	)) {
		if (!filePath || !Array.isArray(records)) {
			continue;
		}
		const seen = new Set<string>();
		const normalized: MapNodeRecord[] = [];
		for (const item of records) {
			const record = sanitizeMapNodeRecord(item, filePath);
			if (!record || seen.has(record.key)) {
				continue;
			}
			seen.add(record.key);
			normalized.push(record);
			if (normalized.length >= MAX_MAP_NODE_RECORDS_PER_FILE) {
				break;
			}
		}
		if (normalized.length > 0) {
			result[filePath] = normalized;
		}
	}
	return result;
}

export function getMapNodeRecords(
	registry: MapNodeRegistry,
	filePath: string
): MapNodeRecord[] {
	return registry[filePath] ?? [];
}

export function addMapNodeRecord(
	registry: MapNodeRegistry,
	filePath: string,
	input: {
		parentKey: string | null;
		text: string;
		occurrence?: number;
		updatedAt?: number;
	}
): { registry: MapNodeRegistry; record: MapNodeRecord } {
	if (!filePath) {
		return { registry, record: createInvalidRecord(filePath, input) };
	}
	const records = getMapNodeRecords(registry, filePath);
	const sameText = records.filter(
		(record) =>
			record.parentKey === input.parentKey &&
			record.text === input.text
	);
	const occurrence =
		input.occurrence && input.occurrence >= 1
			? input.occurrence
			: sameText.length + 1;
	const record = createMapNodeRecord(
		filePath,
		input.parentKey,
		input.text,
		occurrence,
		input.updatedAt
	);
	const nextRecords = records.filter((item) => item.key !== record.key);
	nextRecords.push(record);
	return {
		registry: { ...registry, [filePath]: nextRecords },
		record
	};
}

export function matchMapNodeRegistry(
	registry: MapNodeRegistry,
	filePath: string,
	candidates: MapNodeCandidate[]
): MapNodeMatch[] {
	const recordsByKey = new Map<string, MapNodeRecord>();
	for (const record of getMapNodeRecords(registry, filePath)) {
		recordsByKey.set(record.key, record);
	}
	const counts = new Map<string, number>();
	const matches: MapNodeMatch[] = [];
	for (let i = 0; i < candidates.length; i++) {
		const candidate = candidates[i];
		const countKey = candidateKey(candidate.parentKey, candidate.text);
		const occurrence = (counts.get(countKey) ?? 0) + 1;
		counts.set(countKey, occurrence);
		const key = computeMapNodeIdentityKey(
			filePath,
			candidate.parentKey,
			candidate.text,
			occurrence
		);
		const record = recordsByKey.get(key);
		if (record) {
			matches.push({ candidateIndex: i, record });
		}
	}
	return matches;
}

export function reconcileMapNodeRegistry(
	registry: MapNodeRegistry,
	filePath: string,
	candidates: MapNodeCandidate[]
): MapNodeRegistry {
	const matches = matchMapNodeRegistry(registry, filePath, candidates);
	return cleanupStaleMapNodeRecords(
		registry,
		filePath,
		matches.map((match) => match.record.key)
	);
}

export function findMapNodeRecord(
	registry: MapNodeRegistry,
	filePath: string,
	parentKey: string | null,
	text: string,
	occurrence: number
): MapNodeRecord | undefined {
	const key = computeMapNodeIdentityKey(
		filePath,
		parentKey,
		text,
		occurrence
	);
	return getMapNodeRecords(registry, filePath).find(
		(record) => record.key === key
	);
}

export function findMapNodeRecordByKey(
	registry: MapNodeRegistry,
	filePath: string,
	key: string
): MapNodeRecord | undefined {
	return getMapNodeRecords(registry, filePath).find(
		(record) => record.key === key
	);
}

export interface MapNodeCandidateInput {
	parentKey: string | null;
	text: string;
	occurrence: number;
}

export function migrateMapNodeRecordToCandidate(
	registry: MapNodeRegistry,
	filePath: string,
	oldKey: string,
	candidate: MapNodeCandidateInput,
	now = Date.now()
): { registry: MapNodeRegistry; key: string } {
	if (!filePath) {
		return { registry, key: oldKey };
	}
	const records = getMapNodeRecords(registry, filePath);
	const oldRecord = records.find((record) => record.key === oldKey);
	if (!oldRecord) {
		const added = addMapNodeRecord(registry, filePath, {
			parentKey: candidate.parentKey,
			text: candidate.text,
			occurrence: candidate.occurrence,
			updatedAt: now
		});
		return { registry: added.registry, key: added.record.key };
	}
	const newKey = computeMapNodeIdentityKey(
		filePath,
		candidate.parentKey,
		candidate.text,
		candidate.occurrence
	);
	const conflict = records.find(
		(record) => record.key === newKey && record.key !== oldKey
	);
	if (conflict) {
		const nextRecords = records.filter((record) => record.key !== oldKey);
		return {
			registry: setFileRecords(registry, filePath, nextRecords),
			key: conflict.key
		};
	}
	const nextRecords = records.filter(
		(record) => record.key !== oldKey && record.key !== newKey
	);
	nextRecords.push({
		key: newKey,
		parentKey: candidate.parentKey,
		text: candidate.text,
		occurrence: candidate.occurrence,
		updatedAt: now
	});
	return {
		registry: setFileRecords(registry, filePath, nextRecords),
		key: newKey
	};
}

export function removeMapNodeRecord(
	registry: MapNodeRegistry,
	filePath: string,
	key: string
): MapNodeRegistry {
	const records = getMapNodeRecords(registry, filePath);
	const nextRecords = records.filter((record) => record.key !== key);
	return setFileRecords(registry, filePath, nextRecords);
}

export function removeMapNodeRecordsByKeys(
	registry: MapNodeRegistry,
	filePath: string,
	keys: Iterable<string>
): MapNodeRegistry {
	const remove = new Set(keys);
	const records = getMapNodeRecords(registry, filePath).filter(
		(record) => !remove.has(record.key)
	);
	return setFileRecords(registry, filePath, records);
}

export function removeMapNodeSubtreeByKey(
	registry: MapNodeRegistry,
	filePath: string,
	rootKey: string
): MapNodeRegistry {
	const records = getMapNodeRecords(registry, filePath);
	const remove = new Set<string>([rootKey]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const record of records) {
			if (
				remove.has(record.parentKey ?? "") &&
				!remove.has(record.key)
			) {
				remove.add(record.key);
				changed = true;
			}
		}
	}
	return setFileRecords(
		registry,
		filePath,
		records.filter((record) => !remove.has(record.key))
	);
}

export function rekeyMapNodeRecord(
	registry: MapNodeRegistry,
	filePath: string,
	oldKey: string,
	newParentKey: string | null,
	now = Date.now()
): MapNodeRegistry {
	const records = getMapNodeRecords(registry, filePath);
	const oldRecord = records.find((record) => record.key === oldKey);
	if (!oldRecord || !filePath) {
		return registry;
	}
	const newKey = computeMapNodeIdentityKey(
		filePath,
		newParentKey,
		oldRecord.text,
		oldRecord.occurrence
	);
	const nextRecords = records.filter(
		(record) => record.key !== oldKey && record.key !== newKey
	);
	nextRecords.push({
		key: newKey,
		parentKey: newParentKey,
		text: oldRecord.text,
		occurrence: oldRecord.occurrence,
		updatedAt: now
	});
	return { ...registry, [filePath]: nextRecords };
}

export function cleanupStaleMapNodeRecords(
	registry: MapNodeRegistry,
	filePath: string,
	validKeys: Iterable<string>
): MapNodeRegistry {
	const valid = new Set(validKeys);
	const records = getMapNodeRecords(registry, filePath).filter((record) =>
		valid.has(record.key)
	);
	return setFileRecords(registry, filePath, records);
}

export function removeMapNodeRegistryForFile(
	registry: MapNodeRegistry,
	filePath: string
): MapNodeRegistry {
	if (!filePath) {
		return registry;
	}
	const next = { ...registry };
	delete next[filePath];
	return next;
}

export function renameMapNodeRegistryFile(
	registry: MapNodeRegistry,
	oldPath: string,
	newPath: string
): MapNodeRegistry {
	if (!oldPath || !newPath || oldPath === newPath) {
		return registry;
	}
	const moved = getMapNodeRecords(registry, oldPath);
	const next = removeMapNodeRegistryForFile(registry, oldPath);
	const existing = getMapNodeRecords(next, newPath);
	const seen = new Set(existing.map((record) => record.key));
	for (const record of moved) {
		const newParentKey =
			record.parentKey === null
				? null
				: record.parentKey.split(oldPath).join(newPath);
		const key = computeMapNodeIdentityKey(
			newPath,
			newParentKey,
			record.text,
			record.occurrence
		);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		existing.push({ ...record, key, parentKey: newParentKey });
	}
	return setFileRecords(next, newPath, existing);
}

export function filterMapNodeRegistryByFilePaths(
	registry: MapNodeRegistry,
	filePaths: Iterable<string>
): MapNodeRegistry {
	const valid = new Set(filePaths);
	const result: MapNodeRegistry = {};
	for (const [filePath, records] of Object.entries(registry)) {
		if (valid.has(filePath)) {
			result[filePath] = records;
		}
	}
	return result;
}

function setFileRecords(
	registry: MapNodeRegistry,
	filePath: string,
	records: MapNodeRecord[]
): MapNodeRegistry {
	if (records.length === 0) {
		return removeMapNodeRegistryForFile(registry, filePath);
	}
	return { ...registry, [filePath]: records };
}

function createMapNodeRecord(
	filePath: string,
	parentKey: string | null,
	text: string,
	occurrence: number,
	updatedAt?: number
): MapNodeRecord {
	return {
		key: computeMapNodeIdentityKey(
			filePath,
			parentKey,
			text,
			occurrence
		),
		parentKey,
		text,
		occurrence,
		updatedAt:
			typeof updatedAt === "number" && Number.isFinite(updatedAt)
				? updatedAt
				: Date.now()
	};
}

function createInvalidRecord(
	filePath: string,
	input: {
		parentKey: string | null;
		text: string;
		occurrence?: number;
		updatedAt?: number;
	}
): MapNodeRecord {
	return createMapNodeRecord(
		filePath,
		input.parentKey,
		input.text,
		input.occurrence ?? 1,
		input.updatedAt
	);
}

function sanitizeMapNodeRecord(
	raw: unknown,
	filePath: string
): MapNodeRecord | null {
	if (!isPlainObject(raw)) {
		return null;
	}
	const value = raw as Record<string, unknown>;
	const parentKey =
		typeof value.parentKey === "string" ? value.parentKey : null;
	const text = value.text;
	if (typeof text !== "string") {
		return null;
	}
	const occurrence =
		typeof value.occurrence === "number" &&
		Number.isInteger(value.occurrence) &&
		value.occurrence >= 1
			? value.occurrence
			: 1;
	return createMapNodeRecord(
		filePath,
		parentKey,
		text,
		occurrence,
		typeof value.updatedAt === "number" ? value.updatedAt : undefined
	);
}

function candidateKey(parentKey: string | null, text: string): string {
	return JSON.stringify([parentKey ?? "", text]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
