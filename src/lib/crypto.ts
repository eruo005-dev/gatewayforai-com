import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALG = "aes-256-gcm";

let _masterKey: Buffer | undefined;
function masterKey(): Buffer {
  if (_masterKey) return _masterKey;
  const hex = process.env.MASTER_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("MASTER_KEY env var must be 64 hex characters");
  }
  _masterKey = Buffer.from(hex, "hex");
  return _masterKey;
}

/** AES-256-GCM. Output layout: base64( IV(12) | authTag(16) | ciphertext ). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decrypt(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  if (buf.length < 29) throw new Error("ciphertext too short");
  const decipher = createDecipheriv(ALG, masterKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function generateGatewayKey(): string {
  return "gw_live_" + randomBytes(24).toString("base64url");
}

export function maskKey(k: string): string {
  return k.length <= 10 ? "••••" : `${k.slice(0, 5)}…${k.slice(-4)}`;
}
