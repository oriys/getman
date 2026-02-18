'use client';

import type { SendRequestPayload } from "./tauri";

export interface AdvancedAuthConfig {
  authType: string;
  authUsername?: string;
  authPassword?: string;
  ntlmDomain?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsSessionToken?: string;
  awsRegion?: string;
  awsService?: string;
  wsseUsername?: string;
  wssePassword?: string;
}

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function fromString(value: string): Uint8Array {
  return encoder.encode(value);
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", fromString(value));
  return toHex(new Uint8Array(bytes));
}

async function sha1Base64(parts: Uint8Array[]): Promise<string> {
  const merged = concatBytes(...parts);
  const digest = await crypto.subtle.digest("SHA-1", merged);
  return toBase64(new Uint8Array(digest));
}

async function hmacSha256(key: Uint8Array, value: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signed = await crypto.subtle.sign("HMAC", cryptoKey, fromString(value));
  return new Uint8Array(signed);
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function buildCanonicalUri(pathname: string): string {
  if (!pathname) {
    return "/";
  }
  return pathname
    .split("/")
    .map((seg) => encodeRfc3986(seg))
    .join("/");
}

function buildCanonicalQuery(url: URL): string {
  const pairs: [string, string][] = [];
  url.searchParams.forEach((value, key) => {
    pairs.push([encodeRfc3986(key), encodeRfc3986(value)]);
  });

  pairs.sort((a, b) => {
    if (a[0] === b[0]) {
      return a[1].localeCompare(b[1]);
    }
    return a[0].localeCompare(b[0]);
  });

  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

function buildIsoDate(now: Date): { amzDate: string; shortDate: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    shortDate: iso.slice(0, 8),
  };
}

async function applyWsseAuth(
  payload: SendRequestPayload,
  auth: AdvancedAuthConfig
): Promise<SendRequestPayload> {
  const username = (auth.wsseUsername || "").trim();
  const password = auth.wssePassword || "";
  if (!username || !password) {
    throw new Error("WSSE auth requires username and password");
  }

  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = toBase64(nonceBytes);
  const created = new Date().toISOString();
  const digest = await sha1Base64([
    nonceBytes,
    fromString(created),
    fromString(password),
  ]);

  return {
    ...payload,
    headers: {
      ...payload.headers,
      Authorization: 'WSSE profile="UsernameToken"',
      "X-WSSE": `UsernameToken Username="${username}", PasswordDigest="${digest}", Nonce="${nonce}", Created="${created}"`,
    },
  };
}

async function applyAwsSigV4Auth(
  payload: SendRequestPayload,
  auth: AdvancedAuthConfig
): Promise<SendRequestPayload> {
  const accessKeyId = (auth.awsAccessKeyId || "").trim();
  const secretAccessKey = auth.awsSecretAccessKey || "";
  const region = (auth.awsRegion || "").trim();
  const service = (auth.awsService || "").trim();
  const sessionToken = auth.awsSessionToken || "";

  if (!accessKeyId || !secretAccessKey || !region || !service) {
    throw new Error("AWS SigV4 requires accessKeyId, secretAccessKey, region, and service");
  }

  const requestUrl = new URL(payload.url);
  const now = new Date();
  const { amzDate, shortDate } = buildIsoDate(now);
  const body = payload.body ?? "";
  const payloadHash = await sha256Hex(body);

  const signedHeadersSource: Record<string, string> = {
    ...payload.headers,
    host: requestUrl.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  };
  if (sessionToken.trim()) {
    signedHeadersSource["x-amz-security-token"] = sessionToken;
  }
  delete signedHeadersSource.authorization;
  delete signedHeadersSource.Authorization;

  const canonicalEntries = Object.entries(signedHeadersSource)
    .map(([key, value]) => [
      key.trim().toLowerCase(),
      String(value).trim().replace(/\s+/g, " "),
    ] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const canonicalHeaders = canonicalEntries
    .map(([k, v]) => `${k}:${v}\n`)
    .join("");
  const signedHeaders = canonicalEntries.map(([k]) => k).join(";");

  const canonicalRequest = [
    payload.method.toUpperCase(),
    buildCanonicalUri(requestUrl.pathname || "/"),
    buildCanonicalQuery(requestUrl),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${shortDate}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmacSha256(
    fromString(`AWS4${secretAccessKey}`),
    shortDate
  );
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    ...payload,
    headers: {
      ...payload.headers,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      ...(sessionToken.trim()
        ? { "x-amz-security-token": sessionToken }
        : {}),
      Authorization: authorization,
    },
  };
}

async function applyDigestAuth(
  payload: SendRequestPayload,
  auth: AdvancedAuthConfig
): Promise<SendRequestPayload> {
  const username = (auth.authUsername || "").trim();
  const password = auth.authPassword || "";
  if (!username || !password) {
    throw new Error("Digest auth requires username and password");
  }
  return {
    ...payload,
    digestUsername: username,
    digestPassword: password,
  };
}

async function applyNtlmAuth(
  payload: SendRequestPayload,
  auth: AdvancedAuthConfig
): Promise<SendRequestPayload> {
  const username = (auth.authUsername || "").trim();
  const password = auth.authPassword || "";
  if (!username || !password) {
    throw new Error("NTLM auth requires username and password");
  }
  return {
    ...payload,
    ntlmUsername: username,
    ntlmPassword: password,
    ntlmDomain: (auth.ntlmDomain || "").trim(),
  };
}

export async function applyAdvancedAuth(
  payload: SendRequestPayload,
  auth: AdvancedAuthConfig
): Promise<SendRequestPayload> {
  if (auth.authType === "ntlm") {
    return applyNtlmAuth(payload, auth);
  }
  if (auth.authType === "digest") {
    return applyDigestAuth(payload, auth);
  }
  if (auth.authType === "awsv4") {
    return applyAwsSigV4Auth(payload, auth);
  }
  if (auth.authType === "wsse") {
    return applyWsseAuth(payload, auth);
  }
  return payload;
}
