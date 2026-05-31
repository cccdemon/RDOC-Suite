import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret } from "../../services/secrets.js";

describe("encryptSecret / decryptSecret", () => {
  it("round-trip returns the original plaintext", () => {
    const plain = "my-discord-bot-token-abcdef1234567890";
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it("round-trip for empty string", () => {
    expect(decryptSecret(encryptSecret(""))).toBe("");
  });

  it("round-trip for unicode / emoji content", () => {
    const plain = "token-🚀-日本語-Ω-€";
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it("round-trip for long token (512 chars)", () => {
    const plain = "x".repeat(512);
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it("two encryptions of the same value produce different ciphertexts (random IV + salt)", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(a.salt).not.toBe(b.salt);
  });

  it("output fields are valid base64", () => {
    const enc = encryptSecret("hello");
    for (const field of ["ciphertext", "iv", "salt", "tag"] as const) {
      expect(() => Buffer.from(enc[field], "base64")).not.toThrow();
    }
  });

  it("tampered auth tag throws on decrypt", () => {
    const enc = encryptSecret("secret");
    const bad = { ...enc, tag: Buffer.alloc(16).toString("base64") };
    expect(() => decryptSecret(bad)).toThrow();
  });

  it("tampered ciphertext throws on decrypt", () => {
    const enc = encryptSecret("secret");
    const raw = Buffer.from(enc.ciphertext, "base64");
    raw[0] ^= 0xff;
    const bad = { ...enc, ciphertext: raw.toString("base64") };
    expect(() => decryptSecret(bad)).toThrow();
  });

  it("mismatched salt (different key) throws on decrypt", () => {
    const enc = encryptSecret("secret");
    const wrongSalt = { ...enc, salt: Buffer.alloc(16).toString("base64") };
    expect(() => decryptSecret(wrongSalt)).toThrow();
  });
});
