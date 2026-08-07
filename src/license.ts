import { arch, cpus, platform, release, totalmem } from "os";
import type { MindMapStyle } from "./style";

// ===== 常量 =====

export const CODE_PREFIX = "PRO-";
const CODE_GROUP_SEP = ".";
const P256_SIG_LENGTH = 64; // ECDSA P-256 签名原始格式 r||s，各 32 字节
const EC_ALGO: EcKeyImportParams = { name: "ECDSA", namedCurve: "P-256" };
const SIGN_ALGO: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };

// 公钥：由 tools/gen-keypair.mjs 生成（tools/keys/public.jwk.json）。
// 若重新生成密钥对，必须同步更新此常量，否则所有已发激活码将无法验证。
export const PRO_PUBLIC_KEY_JWK: JsonWebKey = {
	kty: "EC",
	crv: "P-256",
	x: "83kU4nJyEyfhePJ1Olynj2WpXuXnecHFdTTYva-1S14",
	y: "f3OlJoTo2kYfdsrGJ9AdeyexPVc4qpd3fILefGXipi8"
};

// ===== 类型 =====

export interface LicensePayload {
	v: number;
	machine: string;
	tier: string;
	order: string;
	issuedAt: string;
	expiresAt: string;
}

export type LicenseVerifyResult =
	| { ok: true; payload: LicensePayload }
	| {
			ok: false;
			reason:
				| "format"
				| "signature"
				| "unsupported"
				| "machine-mismatch"
				| "expired";
	  };

// ===== 机器指纹 =====

// 指纹参数（Phase 21 已冻结，发布后不得变更）：
// 平台 | 系统大版本 | CPU 架构 | CPU 型号 | 逻辑核心数 | 内存 GB（向下取整）
export function buildFingerprintRaw(): string {
	const osMajor = release().split(".")[0] ?? "";
	const cpuModel = (cpus()[0]?.model ?? "unknown").trim();
	const cores = String(cpus().length);
	const memGb = String(Math.floor(totalmem() / 1024 ** 3));
	return [platform(), osMajor, arch(), cpuModel, cores, memGb].join("|");
}

export async function computeMachineCode(): Promise<string> {
	return sha256Hex(buildFingerprintRaw());
}

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text)
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0")
	).join("");
}

// ===== 机器码展示/归一化 =====

export function formatMachineCode(machineCode: string): string {
	const lower = machineCode.toLowerCase();
	return lower.match(/.{1,4}/g)?.join("-") ?? lower;
}

export function normalizeMachineCode(input: string): string {
	return input.toLowerCase().replace(/[^0-9a-f]/g, "");
}

export function isMachineCode(value: string): boolean {
	return /^[0-9a-f]{64}$/.test(value);
}

// ===== 激活码解析与验签 =====

function parseLicenseCode(
	code: string
): {
	data: Uint8Array<ArrayBuffer>;
	signature: Uint8Array<ArrayBuffer>;
} | null {
	if (!code.startsWith(CODE_PREFIX)) {
		return null;
	}
	const b64 = code.slice(CODE_PREFIX.length).split(CODE_GROUP_SEP).join("");
	if (b64.length < 20) {
		return null;
	}
	let combined: Uint8Array;
	try {
		combined = base64UrlDecode(b64);
	} catch {
		return null;
	}
	if (combined.length <= P256_SIG_LENGTH) {
		return null;
	}
	const payloadLength = combined.length - P256_SIG_LENGTH;
	const data = new Uint8Array(payloadLength);
	data.set(combined.subarray(0, payloadLength));
	const signature = new Uint8Array(P256_SIG_LENGTH);
	signature.set(combined.subarray(payloadLength));
	return {
		data,
		signature
	};
}

function base64UrlDecode(input: string): Uint8Array {
	const b64 =
		input.replace(/-/g, "+").replace(/_/g, "/") +
		"=".repeat((4 - (input.length % 4)) % 4);
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function validatePayload(raw: unknown): LicensePayload {
	if (!raw || typeof raw !== "object") {
		throw new Error("payload");
	}
	const value = raw as Record<string, unknown>;
	if (
		typeof value.v !== "number" ||
		typeof value.machine !== "string" ||
		typeof value.tier !== "string" ||
		typeof value.order !== "string" ||
		typeof value.issuedAt !== "string" ||
		typeof value.expiresAt !== "string"
	) {
		throw new Error("payload");
	}
	return {
		v: value.v,
		machine: value.machine,
		tier: value.tier,
		order: value.order,
		issuedAt: value.issuedAt,
		expiresAt: value.expiresAt
	};
}

export function isExpired(expiresAt: string, today?: string): boolean {
	const todayStr = today ?? new Date().toISOString().slice(0, 10);
	// YYYY-MM-DD 字典序比较即可
	return expiresAt < todayStr;
}

// 校验顺序：验签 → 格式版本 → 档位 → 到期时间 → 机器码
export async function verifyLicenseCode(
	code: string,
	machineCode: string,
	publicJwk: JsonWebKey = PRO_PUBLIC_KEY_JWK
): Promise<LicenseVerifyResult> {
	const parsed = parseLicenseCode(code);
	if (!parsed) {
		return { ok: false, reason: "format" };
	}
	let publicKey: CryptoKey;
	try {
		publicKey = await crypto.subtle.importKey(
			"jwk",
			publicJwk,
			EC_ALGO,
			false,
			["verify"]
		);
	} catch {
		return { ok: false, reason: "format" };
	}
	const valid = await crypto.subtle.verify(
		SIGN_ALGO,
		publicKey,
		parsed.signature,
		parsed.data
	);
	if (!valid) {
		return { ok: false, reason: "signature" };
	}
	let payload: LicensePayload;
	try {
		payload = validatePayload(
			JSON.parse(new TextDecoder().decode(parsed.data)) as unknown
		);
	} catch {
		return { ok: false, reason: "format" };
	}
	if (payload.v !== 1 || payload.tier !== "pro") {
		return { ok: false, reason: "unsupported" };
	}
	if (isExpired(payload.expiresAt)) {
		return { ok: false, reason: "expired" };
	}
	if (payload.machine.toLowerCase() !== machineCode.toLowerCase()) {
		return { ok: false, reason: "machine-mismatch" };
	}
	return { ok: true, payload };
}

// ===== 激活状态管理 =====

export function resolveElegantAnimationEnabled(
	isPro: boolean,
	stored: boolean
): boolean {
	return isPro ? stored : false;
}

export function resolveMindMapStyleForPro(
	isPro: boolean,
	style: MindMapStyle,
	defaultStyle: MindMapStyle
): MindMapStyle {
	return isPro ? style : defaultStyle;
}

export class LicenseManager {
	private storedCode = "";
	private currentPayload: LicensePayload | null = null;
	private currentMachineCode = "";
	private activatedAt = "";

	constructor(
		private readonly publicJwk: JsonWebKey = PRO_PUBLIC_KEY_JWK
	) {}

	get code(): string {
		return this.storedCode;
	}

	get payload(): LicensePayload | null {
		return this.currentPayload;
	}

	get machineCode(): string {
		return this.currentMachineCode;
	}

	get activationDate(): string {
		return this.activatedAt;
	}

	isPro(): boolean {
		return this.currentPayload !== null;
	}

	async init(savedCode: string | undefined, machineCode?: string): Promise<void> {
		this.currentMachineCode = machineCode ?? (await computeMachineCode());
		this.storedCode = savedCode?.trim() ?? "";
		this.currentPayload = null;
		this.activatedAt = "";
		if (this.storedCode !== "") {
			const result = await verifyLicenseCode(
				this.storedCode,
				this.currentMachineCode,
				this.publicJwk
			);
			if (result.ok) {
				this.currentPayload = result.payload;
				this.activatedAt = result.payload.issuedAt;
			}
		}
	}

	async activate(code: string): Promise<LicenseVerifyResult> {
		const result = await verifyLicenseCode(
			code.trim(),
			this.currentMachineCode,
			this.publicJwk
		);
		if (result.ok) {
			this.storedCode = code.trim();
			this.currentPayload = result.payload;
			this.activatedAt = result.payload.issuedAt;
		}
		return result;
	}
}
