import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const KEY_BYTES = 32;

function key(): Buffer {
  const raw = process.env.SECRETS_KEY;
  if (!raw) throw new Error("SECRETS_KEY is not set");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== KEY_BYTES) throw new Error("SECRETS_KEY must be 32 bytes base64");
  return decoded;
}

export function seal(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function open(sealed: string): string {
  const parts = sealed.split(".");
  const iv = parts[0];
  const tag = parts[1];
  const ciphertext = parts[2];
  if (!iv || !tag || !ciphertext) throw new Error("malformed sealed value");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]);
  return plain.toString("utf8");
}
