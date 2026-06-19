import { describe, it, expect, afterEach, vi } from "vitest";
import { encrypt, decrypt, sha256, generateGatewayKey, maskKey } from "@/lib/crypto";

const VALID_MASTER_KEY = "ab".repeat(32); // 64 hex chars (matches tests/setup.ts)

/**
 * Re-import crypto.ts with a given MASTER_KEY env value. crypto.ts caches the
 * parsed master key in a module-level `_masterKey` singleton, so we must
 * vi.resetModules() before each dynamic import to force the validation branch
 * (`/^[0-9a-fA-F]{64}$/`) to run again against the new env value.
 */
async function freshCrypto(masterKey: string | undefined) {
  vi.resetModules();
  if (masterKey === undefined) delete process.env.MASTER_KEY;
  else process.env.MASTER_KEY = masterKey;
  return import("@/lib/crypto");
}

describe("crypto", () => {
  it("round-trips a secret", () => {
    const ct = encrypt("sk-test-12345");
    expect(ct).not.toContain("sk-test");
    expect(decrypt(ct)).toBe("sk-test-12345");
  });

  it("uses a unique IV per encryption (same input → different ciphertext)", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("rejects tampered ciphertext", () => {
    const ct = encrypt("secret");
    const buf = Buffer.from(ct, "base64");
    buf[buf.length - 1] ^= 0xff;
    expect(() => decrypt(buf.toString("base64"))).toThrow();
  });

  it("sha256 is hex and deterministic", () => {
    expect(sha256("gw_live_abc")).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256("x")).toBe(sha256("x"));
  });

  it("generates gw_live_ keys with ≥24 bytes of entropy", () => {
    const k = generateGatewayKey();
    expect(k).toMatch(/^gw_live_[A-Za-z0-9_-]{32,}$/);
    expect(generateGatewayKey()).not.toBe(k);
  });

  it("masks long keys to first-4 + last-4", () => {
    // 24 chars: first-4 "sk-p", last-4 "x4Tz".
    expect(maskKey("sk-proj-abcdefgh1234x4Tz")).toBe("sk-p…x4Tz");
    expect(maskKey("short")).toBe("••••");
  });

  it("fully hides short keys (< 16 chars) rather than leaking most of them", () => {
    // 14 chars: previously leaked first-5 + last-4 = most of the key.
    expect(maskKey("sk-1234567890ab")).toBe("••••");
    // 16 chars is the threshold where revealing 4+4 hides a meaningful middle.
    expect(maskKey("0123456789abcdef")).toBe("0123…cdef");
  });

  it("rejects auth-tag tamper (byte in tag range flipped)", () => {
    const ct = encrypt("secret");
    const buf = Buffer.from(ct, "base64");
    buf[15] ^= 0xff; // byte 15 is within the auth-tag range (bytes 12-27)
    expect(() => decrypt(buf.toString("base64"))).toThrow();
  });

  it("rejects ciphertext that is too short", () => {
    expect(() => decrypt("AAAA")).toThrow("ciphertext too short");
  });

  it("rejects IV tamper (byte 0 flipped) (MEDIUM 16)", () => {
    // Byte 0 is within the 12-byte IV prefix. Flipping it changes the GCM
    // keystream so the auth tag no longer verifies → decrypt must throw.
    const ct = encrypt("secret");
    const buf = Buffer.from(ct, "base64");
    buf[0] ^= 0xff;
    expect(() => decrypt(buf.toString("base64"))).toThrow();
  });

  it("encrypted blob is long enough to contain IV(12) + tag(16) + ciphertext", () => {
    // base64-decoded length must exceed 28 (IV 12 + tag 16) for a non-empty
    // plaintext. Pins that both the IV and the GCM auth tag are present in the
    // output layout — fails if either prefix is dropped.
    const blob = encrypt("hello world");
    const decoded = Buffer.from(blob, "base64");
    expect(decoded.length).toBeGreaterThan(28);
    expect(decoded.length).toBeGreaterThanOrEqual(12 + 16 + "hello world".length);
  });
});

describe("MASTER_KEY validation", () => {
  // crypto.ts caches the master key, so each case re-imports with a fresh env.
  afterEach(async () => {
    // Restore a valid key in the live module so other suites are unaffected.
    await freshCrypto(VALID_MASTER_KEY);
    vi.resetModules();
    process.env.MASTER_KEY = VALID_MASTER_KEY;
  });

  it("throws /64 hex/ when MASTER_KEY is too short", async () => {
    const { encrypt: enc } = await freshCrypto("tooshort");
    expect(() => enc("x")).toThrow(/64 hex/);
  });

  it("throws /64 hex/ when MASTER_KEY is 64 NON-hex chars", async () => {
    // Correct length (64) but contains non-hex chars — must still be rejected.
    // This fails if the regex /^[0-9a-fA-F]{64}$/ is weakened to e.g. /.+/.
    const nonHex = "z".repeat(64);
    const { encrypt: enc } = await freshCrypto(nonHex);
    expect(() => enc("x")).toThrow(/64 hex/);
  });

  it("throws /64 hex/ when MASTER_KEY is unset", async () => {
    const { decrypt: dec } = await freshCrypto(undefined);
    expect(() => dec("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toThrow(/64 hex/);
  });

  it("accepts a valid 64-hex MASTER_KEY (round-trips)", async () => {
    const { encrypt: enc, decrypt: dec } = await freshCrypto(VALID_MASTER_KEY);
    expect(dec(enc("ok"))).toBe("ok");
  });
});
