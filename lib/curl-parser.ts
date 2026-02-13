import {
  type HttpMethod,
  type KeyValue,
  type RequestTab,
  createDefaultTab,
  createEmptyKV,
  uid,
} from "./getman-store";

/**
 * Check whether a string looks like a curl command.
 */
export function isCurlCommand(text: string): boolean {
  const trimmed = text.trimStart();
  return /^curl\s/i.test(trimmed);
}

// ─── Tokeniser ────────────────────────────────────────────────────────────────

/**
 * Split a curl command string into tokens, respecting single/double quotes,
 * backslash escapes and line-continuation characters (`\` at end of line).
 */
function tokenize(input: string): string[] {
  // Normalise line continuations (backslash + optional whitespace + newline)
  const text = input.replace(/\\\s*\n/g, " ").trim();

  const tokens: string[] = [];
  let current = "";
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === "'" ) {
      // Single-quoted string – no escape processing inside
      i++; // skip opening quote
      while (i < text.length && text[i] !== "'") {
        current += text[i];
        i++;
      }
      i++; // skip closing quote
    } else if (ch === '"') {
      // Double-quoted string – honour backslash escapes
      i++; // skip opening quote
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < text.length) {
          i++;
          current += text[i];
        } else {
          current += text[i];
        }
        i++;
      }
      i++; // skip closing quote
    } else if (ch === "$" && i + 1 < text.length && text[i + 1] === "'") {
      // $'...' ANSI-C quoting (common in copied curl commands)
      i += 2; // skip $'
      while (i < text.length && text[i] !== "'") {
        if (text[i] === "\\" && i + 1 < text.length) {
          const next = text[i + 1];
          if (next === "n") { current += "\n"; i += 2; }
          else if (next === "t") { current += "\t"; i += 2; }
          else if (next === "\\") { current += "\\"; i += 2; }
          else if (next === "'") { current += "'"; i += 2; }
          else { current += text[i + 1]; i += 2; }
        } else {
          current += text[i];
          i++;
        }
      }
      i++; // skip closing quote
    } else if (ch === "\\") {
      // Backslash outside quotes – take next char literally
      i++;
      if (i < text.length) {
        current += text[i];
        i++;
      }
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      i++;
    } else {
      current += ch;
      i++;
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

interface ParsedCurl {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
  formFields: { key: string; value: string }[];
  user: string | undefined;          // -u / --user
  isFormData: boolean;               // -F / --form
  compressed: boolean;               // --compressed
}

const VALID_METHODS = new Set<string>(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function parseCurlTokens(tokens: string[]): ParsedCurl {
  let method: string | undefined;
  let url: string | undefined;
  const headers: Record<string, string> = {};
  let body: string | undefined;
  const formFields: { key: string; value: string }[] = [];
  let user: string | undefined;
  let isFormData = false;
  let compressed = false;

  let i = 0;

  // Skip the leading "curl" token
  if (tokens.length > 0 && tokens[0].toLowerCase() === "curl") {
    i = 1;
  }

  while (i < tokens.length) {
    const token = tokens[i];

    if (token === "-X" || token === "--request") {
      i++;
      if (i < tokens.length) {
        method = tokens[i].toUpperCase();
      }
    } else if (token === "-H" || token === "--header") {
      i++;
      if (i < tokens.length) {
        const header = tokens[i];
        const colonIdx = header.indexOf(":");
        if (colonIdx !== -1) {
          const key = header.slice(0, colonIdx).trim();
          const value = header.slice(colonIdx + 1).trim();
          headers[key] = value;
        }
      }
    } else if (token === "-d" || token === "--data" || token === "--data-raw" || token === "--data-binary" || token === "--data-ascii") {
      i++;
      if (i < tokens.length) {
        body = tokens[i];
      }
    } else if (token === "--data-urlencode") {
      i++;
      if (i < tokens.length) {
        // Append to body as url-encoded
        const part = tokens[i];
        body = body ? `${body}&${part}` : part;
      }
    } else if (token === "-F" || token === "--form") {
      isFormData = true;
      i++;
      if (i < tokens.length) {
        const field = tokens[i];
        const eqIdx = field.indexOf("=");
        if (eqIdx !== -1) {
          formFields.push({
            key: field.slice(0, eqIdx),
            value: field.slice(eqIdx + 1),
          });
        }
      }
    } else if (token === "-u" || token === "--user") {
      i++;
      if (i < tokens.length) {
        user = tokens[i];
      }
    } else if (token === "--compressed") {
      compressed = true;
    } else if (token === "-A" || token === "--user-agent") {
      i++;
      if (i < tokens.length) {
        headers["User-Agent"] = tokens[i];
      }
    } else if (token === "-e" || token === "--referer") {
      i++;
      if (i < tokens.length) {
        headers["Referer"] = tokens[i];
      }
    } else if (token === "-b" || token === "--cookie") {
      i++;
      if (i < tokens.length) {
        headers["Cookie"] = tokens[i];
      }
    } else if (
      token === "-k" || token === "--insecure" ||
      token === "-L" || token === "--location" ||
      token === "-s" || token === "--silent" ||
      token === "-S" || token === "--show-error" ||
      token === "-v" || token === "--verbose" ||
      token === "-i" || token === "--include" ||
      token === "--http1.1" || token === "--http2"
    ) {
      // Flags we recognise but ignore (no value)
    } else if (token === "-o" || token === "--output" ||
               token === "--connect-timeout" || token === "-m" || token === "--max-time" ||
               token === "--retry" || token === "-C" || token === "--continue-at") {
      // Flags with a value that we skip
      i++;
    } else if (token.startsWith("-") && !token.startsWith("--")) {
      // Possibly combined short flags like -sSL; skip
    } else if (!url) {
      // Treat as the URL
      url = token;
    }

    i++;
  }

  // Default method inference
  let resolvedMethod: HttpMethod = "GET";
  if (method && VALID_METHODS.has(method)) {
    resolvedMethod = method as HttpMethod;
  } else if (!method && (body !== undefined || formFields.length > 0)) {
    resolvedMethod = "POST";
  }

  return {
    method: resolvedMethod,
    url: url ?? "",
    headers,
    body,
    formFields,
    user,
    isFormData,
    compressed,
  };
}

// ─── Build RequestTab ─────────────────────────────────────────────────────────

function parseQueryParams(urlString: string): { baseUrl: string; params: KeyValue[] } {
  try {
    const urlObj = new URL(urlString);
    const params: KeyValue[] = [];
    urlObj.searchParams.forEach((value, key) => {
      params.push({ id: uid(), key, value, enabled: true });
    });
    // Remove search params from URL to get the base
    urlObj.search = "";
    return { baseUrl: urlObj.toString(), params };
  } catch {
    return { baseUrl: urlString, params: [] };
  }
}

function parseCookieHeader(cookieString: string): KeyValue[] {
  return cookieString.split(";").map((part) => {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) {
      return { id: uid(), key: part.trim(), value: "", enabled: true };
    }
    return {
      id: uid(),
      key: part.slice(0, eqIdx).trim(),
      value: part.slice(eqIdx + 1).trim(),
      enabled: true,
    };
  }).filter((kv) => kv.key.length > 0);
}

/**
 * Parse a curl command string and return a partial RequestTab with the
 * extracted configuration.
 */
export function parseCurlCommand(curlString: string): RequestTab {
  const tokens = tokenize(curlString);
  const parsed = parseCurlTokens(tokens);

  const tab = createDefaultTab();

  // URL & query params
  const { baseUrl, params } = parseQueryParams(parsed.url);
  tab.url = baseUrl;
  tab.params = params.length > 0 ? [...params, createEmptyKV()] : [createEmptyKV()];

  // Method
  tab.method = parsed.method;

  // Headers (except Cookie and Content-Type which are handled separately)
  const headerKVs: KeyValue[] = [];
  let contentType = "";
  for (const [key, value] of Object.entries(parsed.headers)) {
    if (key.toLowerCase() === "cookie") {
      tab.cookies = [...parseCookieHeader(value), createEmptyKV()];
    } else if (key.toLowerCase() === "content-type") {
      contentType = value;
      headerKVs.push({ id: uid(), key, value, enabled: true });
    } else if (key.toLowerCase() === "authorization") {
      // Parse auth header
      const authValue = value;
      if (authValue.startsWith("Bearer ")) {
        tab.authType = "bearer";
        tab.authToken = authValue.slice(7);
      } else if (authValue.startsWith("Basic ")) {
        tab.authType = "basic";
        try {
          const decoded = atob(authValue.slice(6));
          const colonIdx = decoded.indexOf(":");
          if (colonIdx !== -1) {
            tab.authUsername = decoded.slice(0, colonIdx);
            tab.authPassword = decoded.slice(colonIdx + 1);
          }
        } catch {
          // If decoding fails, add as regular header
          headerKVs.push({ id: uid(), key, value, enabled: true });
        }
      } else {
        headerKVs.push({ id: uid(), key, value, enabled: true });
      }
    } else {
      headerKVs.push({ id: uid(), key, value, enabled: true });
    }
  }
  tab.headers = headerKVs.length > 0 ? [...headerKVs, createEmptyKV()] : [createEmptyKV()];

  // Basic auth via -u flag
  if (parsed.user) {
    const colonIdx = parsed.user.indexOf(":");
    tab.authType = "basic";
    if (colonIdx !== -1) {
      tab.authUsername = parsed.user.slice(0, colonIdx);
      tab.authPassword = parsed.user.slice(colonIdx + 1);
    } else {
      tab.authUsername = parsed.user;
    }
  }

  // Body
  if (parsed.isFormData && parsed.formFields.length > 0) {
    tab.bodyType = "form-data";
    tab.bodyFormData = [
      ...parsed.formFields.map((f) => ({
        id: uid(),
        key: f.key,
        value: f.value,
        enabled: true,
      })),
      createEmptyKV(),
    ];
  } else if (parsed.body !== undefined) {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      tab.bodyType = "x-www-form-urlencoded";
      try {
        const searchParams = new URLSearchParams(parsed.body);
        const fields: KeyValue[] = [];
        searchParams.forEach((value, key) => {
          fields.push({ id: uid(), key, value, enabled: true });
        });
        tab.bodyFormData = fields.length > 0 ? [...fields, createEmptyKV()] : [createEmptyKV()];
      } catch {
        tab.bodyType = "raw";
        tab.bodyContent = parsed.body;
      }
    } else if (contentType.includes("application/json")) {
      tab.bodyType = "json";
      tab.bodyContent = parsed.body;
    } else {
      // Try to detect JSON body
      const trimmedBody = parsed.body.trim();
      if ((trimmedBody.startsWith("{") && trimmedBody.endsWith("}")) ||
          (trimmedBody.startsWith("[") && trimmedBody.endsWith("]"))) {
        tab.bodyType = "json";
        tab.bodyContent = parsed.body;
      } else {
        tab.bodyType = "raw";
        tab.bodyContent = parsed.body;
      }
    }
  }

  // Name from URL
  try {
    const urlObj = new URL(tab.url);
    tab.name = urlObj.pathname === "/" ? urlObj.hostname : urlObj.pathname.split("/").pop() || urlObj.hostname;
  } catch {
    tab.name = "Imported Request";
  }

  return tab;
}
