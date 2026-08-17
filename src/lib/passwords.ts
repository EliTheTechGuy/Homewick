import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * promisify drops the options overload, and the options are the entire point:
 * without them scrypt falls back to defaults far weaker than these.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/**
 * Password hashing.
 *
 * scrypt rather than a dependency, because it is in Node already and adding a
 * package to the trust chain of the thing that guards customers' door codes
 * should buy more than convenience. It is memory-hard, which is the property
 * that matters: it makes guessing expensive on the hardware an attacker would
 * actually use.
 *
 * N is the work factor. 2^15 costs roughly a tenth of a second per attempt
 * here, which nobody notices once at sign-in and which makes working through a
 * list ruinous. Raise it as machines get faster; the parameters are stored
 * with each hash so old ones keep verifying.
 */
const N = 32768;
const r = 8;
const p = 1;

/**
 * scrypt needs roughly 128 * N * r bytes, which at these settings is exactly
 * 32MB, and Node's default ceiling is also exactly 32MB. It refuses rather
 * than rounding in your favour, so the limit has to be raised explicitly.
 * Found the hard way: without this, every hash throws.
 */
const MAX_MEM = 64 * 1024 * 1024;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

/** Enough length that the work factor has something to protect. */
export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password.normalize("NFKC"), salt, KEY_BYTES, {
    N,
    r,
    p,
    maxmem: MAX_MEM,
  });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/**
 * Check a password against a stored hash.
 *
 * Never throws on a malformed hash, and never short-circuits on a mismatch:
 * both would let the shape of the answer leak through timing or an error page.
 */
export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltHex, keyHex] = parts;
  const params = {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
    maxmem: MAX_MEM,
  };
  if (!Number.isFinite(params.N) || !Number.isFinite(params.r) || !Number.isFinite(params.p)) {
    return false;
  }

  try {
    const expected = Buffer.from(keyHex, "hex");
    const actual = await scryptAsync(
      password.normalize("NFKC"),
      Buffer.from(saltHex, "hex"),
      expected.length,
      params,
    );
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * Why a password is not acceptable, or null if it is.
 *
 * Length is the only rule that reliably helps. Composition rules push people
 * towards Passw0rd! and away from four random words, which is the opposite of
 * what they are meant to do. The obvious-choices check exists because this one
 * password is the only thing between anybody and every customer's door code.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. A few unrelated words is easier to remember and harder to guess than something short and clever.`;
  }
  if (/^(.)\1+$/.test(password)) return "That is one character repeated.";

  const obvious = ["password", "homewick", "cleaning", "12345678", "qwerty", "letmein"];
  const lowered = password.toLowerCase();
  if (obvious.some((word) => lowered.includes(word))) {
    return "That contains something too easy to guess. Avoid the business name and common words.";
  }
  return null;
}
