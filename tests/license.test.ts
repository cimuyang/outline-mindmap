import { describe, expect, it } from "vitest";
import {
	buildFingerprintRaw,
	computeMachineCode,
	formatMachineCode,
	isExpired,
	LicenseManager,
	normalizeMachineCode,
	resolveElegantAnimationEnabled,
	resolveMindMapStyleForPro,
	verifyLicenseCode
} from "../src/license";
import type { LicensePayload } from "../src/license";
import { DEFAULT_MIND_MAP_STYLE } from "../src/style";

const EC_ALGO: EcKeyImportParams = { name: "ECDSA", namedCurve: "P-256" };
const SIGN_ALGO: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };
const P256_SIG_LENGTH = 64;
const PREFIX = "PRO-";

async function makeTestKeyPair(): Promise<{
	publicJwk: JsonWebKey;
	privateJwk: JsonWebKey;
}> {
	const keyPair = await crypto.subtle.generateKey(EC_ALGO, true, [
		"sign",
		"verify"
	]);
	const [publicJwk, privateJwk] = await Promise.all([
		crypto.subtle.exportKey("jwk", keyPair.publicKey),
		crypto.subtle.exportKey("jwk", keyPair.privateKey)
	]);
	return { publicJwk, privateJwk };
}

async function encodeLicenseCode(
	privateJwk: JsonWebKey,
	payload: LicensePayload
): Promise<string> {
	const privateKey = await crypto.subtle.importKey(
		"jwk",
		privateJwk,
		EC_ALGO,
		false,
		["sign"]
	);
	const data = new TextEncoder().encode(JSON.stringify(payload));
	const sig = new Uint8Array(
		await crypto.subtle.sign(SIGN_ALGO, privateKey, data)
	);
	const combined = new Uint8Array(data.length + P256_SIG_LENGTH);
	combined.set(data, 0);
	combined.set(sig, data.length);
	const b64 = Buffer.from(combined).toString("base64url");
	return PREFIX + (b64.match(/.{1,5}/g) ?? []).join(".");
}

function payloadFor(
	machine: string,
	overrides: Partial<LicensePayload> = {}
): LicensePayload {
	return {
		v: 1,
		machine,
		tier: "pro",
		order: "TEST-001",
		issuedAt: "2026-08-07",
		expiresAt: "2099-12-31",
		...overrides
	};
}

describe("license 机器指纹", () => {
	it("机器码为 64 位十六进制且同进程内两次计算一致", async () => {
		const first = await computeMachineCode();
		const second = await computeMachineCode();
		expect(first).toMatch(/^[0-9a-f]{64}$/);
		expect(first).toBe(second);
	});

	it("指纹原始串包含平台、架构与核心数", () => {
		const raw = buildFingerprintRaw();
		expect(raw).toContain(process.platform);
		expect(raw).toContain(process.arch);
	});

	it("机器码分组展示与归一化还原", () => {
		const raw = "a".repeat(64);
		const grouped = formatMachineCode(raw);
		expect(grouped).toBe(
			"aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa"
		);
		expect(normalizeMachineCode(grouped)).toBe(raw);
		expect(normalizeMachineCode("ABCD-EFGH 1234")).toBe("abcdef1234");
	});
});

describe("license 验签", () => {
	it("合法激活码验证通过", async () => {
		const { publicJwk, privateJwk } = await makeTestKeyPair();
		const machine = "a".repeat(64);
		const code = await encodeLicenseCode(privateJwk, payloadFor(machine));
		const result = await verifyLicenseCode(code, machine, publicJwk);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.payload.machine).toBe(machine);
			expect(result.payload.tier).toBe("pro");
		}
	});

	it("篡改激活码验签失败", async () => {
		const { publicJwk, privateJwk } = await makeTestKeyPair();
		const machine = "a".repeat(64);
		const code = await encodeLicenseCode(privateJwk, payloadFor(machine));
		const flip = code.slice(-2) === "AA" ? "BB" : "AA";
		const tampered = code.slice(0, -2) + flip;
		const result = await verifyLicenseCode(tampered, machine, publicJwk);
		expect(result).toEqual({ ok: false, reason: "signature" });
	});

	it("机器码不匹配返回 machine-mismatch", async () => {
		const { publicJwk, privateJwk } = await makeTestKeyPair();
		const code = await encodeLicenseCode(
			privateJwk,
			payloadFor("a".repeat(64))
		);
		const result = await verifyLicenseCode(
			code,
			"f".repeat(64),
			publicJwk
		);
		expect(result).toEqual({ ok: false, reason: "machine-mismatch" });
	});

	it("已过期返回 expired", async () => {
		const { publicJwk, privateJwk } = await makeTestKeyPair();
		const machine = "a".repeat(64);
		const code = await encodeLicenseCode(
			privateJwk,
			payloadFor(machine, { expiresAt: "2020-01-01" })
		);
		const result = await verifyLicenseCode(code, machine, publicJwk);
		expect(result).toEqual({ ok: false, reason: "expired" });
	});

	it("未知档位返回 unsupported", async () => {
		const { publicJwk, privateJwk } = await makeTestKeyPair();
		const machine = "a".repeat(64);
		const code = await encodeLicenseCode(
			privateJwk,
			payloadFor(machine, { tier: "ultra" })
		);
		const result = await verifyLicenseCode(code, machine, publicJwk);
		expect(result).toEqual({ ok: false, reason: "unsupported" });
	});

	it("格式错误返回 format", async () => {
		const { publicJwk } = await makeTestKeyPair();
		const result = await verifyLicenseCode(
			"NOT-A-CODE",
			"a".repeat(64),
			publicJwk
		);
		expect(result).toEqual({ ok: false, reason: "format" });
	});
});

describe("license 到期判断", () => {
	it("边界日期当天未过期", () => {
		expect(isExpired("2026-08-07", "2026-08-07")).toBe(false);
		expect(isExpired("2099-12-31")).toBe(false);
	});

	it("到期日早于今天视为过期", () => {
		expect(isExpired("2026-08-06", "2026-08-07")).toBe(true);
		expect(isExpired("2020-01-01")).toBe(true);
	});
});

describe("license 锁定逻辑", () => {
	it("未激活时动画关闭、样式回退默认", () => {
		expect(resolveElegantAnimationEnabled(false, true)).toBe(false);
		expect(resolveElegantAnimationEnabled(true, true)).toBe(true);
		const custom = { ...DEFAULT_MIND_MAP_STYLE, fontSize: 24 };
		expect(resolveMindMapStyleForPro(false, custom, DEFAULT_MIND_MAP_STYLE)).toBe(
			DEFAULT_MIND_MAP_STYLE
		);
		expect(resolveMindMapStyleForPro(true, custom, DEFAULT_MIND_MAP_STYLE)).toBe(
			custom
		);
	});

	it("LicenseManager 无激活码时保持未激活", async () => {
		const { publicJwk } = await makeTestKeyPair();
		const manager = new LicenseManager(publicJwk);
		await manager.init(undefined, "a".repeat(64));
		expect(manager.isPro()).toBe(false);
		expect(manager.code).toBe("");
	});

	it("LicenseManager 错误激活码不改变状态，正确激活码解锁", async () => {
		const { publicJwk, privateJwk } = await makeTestKeyPair();
		const machine = "a".repeat(64);
		const code = await encodeLicenseCode(privateJwk, payloadFor(machine));
		const manager = new LicenseManager(publicJwk);
		await manager.init(undefined, machine);

		const bad = await manager.activate("PRO-bad");
		expect(bad.ok).toBe(false);
		expect(manager.isPro()).toBe(false);

		const ok = await manager.activate(code);
		expect(ok.ok).toBe(true);
		expect(manager.isPro()).toBe(true);
		expect(manager.code).toBe(code);
	});

	it("LicenseManager 重新加载时重新验签，机器码不匹配则失效", async () => {
		const { publicJwk, privateJwk } = await makeTestKeyPair();
		const machine = "a".repeat(64);
		const code = await encodeLicenseCode(privateJwk, payloadFor(machine));

		const sameMachine = new LicenseManager(publicJwk);
		await sameMachine.init(code, machine);
		expect(sameMachine.isPro()).toBe(true);

		const otherMachine = new LicenseManager(publicJwk);
		await otherMachine.init(code, "f".repeat(64));
		expect(otherMachine.isPro()).toBe(false);
	});
});
