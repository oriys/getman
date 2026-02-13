'use client';

/**
 * Sensitive Data Security
 *
 * Provides AES-GCM encryption for secrets and masked display for tokens.
 * Uses the Web Crypto API (available in both browser and Tauri WebView).
 */

// ─── Masking ─────────────────────────────────────────────────────────────────

export function maskSecret(value: string, visibleChars: number = 4): string {
  if (!value) return "";
  if (value.length <= visibleChars) return "•".repeat(value.length);
  return "•".repeat(value.length - visibleChars) + value.slice(-visibleChars);
}

export function maskToken(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(value.length);
  return value.slice(0, 4) + "•".repeat(value.length - 8) + value.slice(-4);
}

// ─── Encryption (AES-GCM via Web Crypto API) ────────────────────────────────

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptSecret(plaintext: string, password: string): Promise<string> {
  if (!plaintext) return "";

  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoder.encode(plaintext)
  );

  // Format: base64(salt + iv + ciphertext)
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);

  return btoa(String.fromCharCode(...combined));
}

export async function decryptSecret(ciphertext: string, password: string): Promise<string> {
  if (!ciphertext) return "";

  try {
    const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 16 + IV_LENGTH);
    const data = combined.slice(16 + IV_LENGTH);

    const key = await deriveKey(password, salt);

    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      data
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    throw new Error("Failed to decrypt: invalid password or corrupted data");
  }
}

// ─── Sensitive Field Detection ──────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /api[_-]?key/i,
  /authorization/i,
  /bearer/i,
  /credential/i,
  /private[_-]?key/i,
];

export function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(fieldName));
}
