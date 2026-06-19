import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALG = "aes-256-gcm";

// AES-256-GCM blob layout: IV(12) | authTag(16) | ciphertext. These named offsets
// replace the magic numbers in decrypt() so the layout is self-documenting.
const IV_BYTES = 12; // GCM nonce length
const TAG_BYTES = 16; // GCM auth tag length
const CT_OFFSET = IV_BYTES + TAG_BYTES; // 28 — ciphertext starts here
const MIN_BLOB_BYTES = CT_OFFSET + 1; // 29 — IV + tag + ≥1 byte of ciphertext

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
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decrypt(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  if (buf.length < MIN_BLOB_BYTES) throw new Error("ciphertext too short");
  const decipher = createDecipheriv(ALG, masterKey(), buf.subarray(0, IV_BYTES));
  decipher.setAuthTag(buf.subarray(IV_BYTES, CT_OFFSET));
  return Buffer.concat([decipher.update(buf.subarray(CT_OFFSET)), decipher.final()]).toString("utf8");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function generateGatewayKey(): string {
  return "gw_live_" + randomBytes(24).toString("base64url");
}

export function generateSubKey(): string {
  return "gw_sub_" + randomBytes(24).toString("base64url");
}

/**
 * Mask a secret for display: first-4 + last-4 with the middle hidden, but ONLY
 * when the key is long enough (>= 16 chars) that a meaningful amount stays
 * hidden. Real provider keys are >= 16 chars; anything shorter is fully hidden
 * to avoid leaking most of a short key.
 */
export function maskKey(k: string): string {
  return k.length < 16 ? "••••" : `${k.slice(0, 4)}…${k.slice(-4)}`;
}
