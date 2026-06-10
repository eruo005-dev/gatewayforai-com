import { describe, it, expect } from "vitest";
import { encrypt, decrypt, sha256, generateGatewayKey, maskKey } from "@/lib/crypto";

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

  it("masks keys to first-5 + last-4", () => {
    expect(maskKey("sk-proj-abcdefgh1234x4Tz")).toBe("sk-pr…x4Tz");
    expect(maskKey("short")).toBe("••••");
  });
});
