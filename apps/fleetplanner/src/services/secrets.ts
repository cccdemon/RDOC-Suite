import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { getEnv } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";

function masterSecret(): string {
  return getEnv().SESSION_SECRET;
}

function deriveKey(salt: Buffer): Buffer {
  return scryptSync(masterSecret(), salt, 32);
}

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  salt: string;
  tag: string;
};

export function encryptSecret(plaintext: string): EncryptedSecret {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    salt: salt.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const salt = Buffer.from(secret.salt, "base64");
  const iv = Buffer.from(secret.iv, "base64");
  const key = deriveKey(salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
