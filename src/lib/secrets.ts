import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

/**
 * Encryption for entry codes and key locations.
 *
 * A leak here is a burglary, not an embarrassment. The key lives in the
 * environment, outside the database, so a dump of Postgres on its own does
 * not open anybody's front door.
 *
 * AES-256-GCM. Stored layout: [12-byte IV][16-byte auth tag][ciphertext].
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
  const raw = process.env.ACCESS_SECRET_KEY;
  if (!raw) {
    throw new Error(
      "ACCESS_SECRET_KEY is not set. Generate one with: openssl rand -base64 32",
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("ACCESS_SECRET_KEY must be 32 bytes, base64-encoded.");
  }
  return buf;
}

export function encryptSecret(plaintext: string | null | undefined): Buffer | null {
  if (!plaintext) return null;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptSecret(stored: Buffer | null | undefined): string | null {
  if (!stored || stored.length <= IV_BYTES + TAG_BYTES) return null;
  const iv = stored.subarray(0, IV_BYTES);
  const tag = stored.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = stored.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function isSecretKeyConfigured(): boolean {
  return Boolean(process.env.ACCESS_SECRET_KEY);
}
