import { type RequestTab, resolveEnvVariables } from "./getman-store";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CodeLanguage =
  | "curl"
  | "javascript-fetch"
  | "python-requests"
  | "go-native"
  | "php-curl"
  | "node-axios";

export interface CodeLanguageOption {
  id: CodeLanguage;
  label: string;
}

export const CODE_LANGUAGES: CodeLanguageOption[] = [
  { id: "curl", label: "cURL" },
  { id: "javascript-fetch", label: "JavaScript (fetch)" },
  { id: "node-axios", label: "Node.js (axios)" },
  { id: "python-requests", label: "Python (requests)" },
  { id: "go-native", label: "Go (net/http)" },
  { id: "php-curl", label: "PHP (cURL)" },
];

// ─── Resolved Request ─────────────────────────────────────────────────────────

interface ResolvedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
  formFields: { key: string; value: string }[];
  bodyType: string;
}

function resolveRequest(tab: RequestTab): ResolvedRequest {
  const resolvedUrl = resolveEnvVariables(tab.url);
  let url: string;
  try {
    const urlObj = new URL(resolvedUrl);
    for (const p of tab.params) {
      if (p.enabled && p.key) {
        urlObj.searchParams.set(p.key, resolveEnvVariables(p.value));
      }
    }
    if (tab.authType === "api-key" && tab.authApiAddTo === "query") {
      urlObj.searchParams.set(
        resolveEnvVariables(tab.authApiKey),
        resolveEnvVariables(tab.authApiValue)
      );
    }
    url = urlObj.toString();
  } catch {
    url = resolvedUrl;
  }

  const headers: Record<string, string> = {};
  for (const h of tab.headers) {
    if (h.enabled && h.key) {
      headers[h.key] = resolveEnvVariables(h.value);
    }
  }

  // Cookies
  const cookieParts: string[] = [];
  for (const c of tab.cookies ?? []) {
    if (c.enabled && c.key) {
      cookieParts.push(`${resolveEnvVariables(c.key)}=${resolveEnvVariables(c.value)}`);
    }
  }
  if (cookieParts.length > 0) {
    headers["Cookie"] = cookieParts.join("; ");
  }

  // Auth headers
  if (tab.authType === "bearer" && tab.authToken) {
    headers["Authorization"] = `Bearer ${resolveEnvVariables(tab.authToken)}`;
  } else if (tab.authType === "basic" && tab.authUsername) {
    headers["Authorization"] = `Basic ${btoa(`${resolveEnvVariables(tab.authUsername)}:${resolveEnvVariables(tab.authPassword)}`)}`;
  } else if (tab.authType === "api-key" && tab.authApiAddTo === "header") {
    headers[resolveEnvVariables(tab.authApiKey)] = resolveEnvVariables(tab.authApiValue);
  }

  let body: string | undefined;
  const formFields: { key: string; value: string }[] = [];

  if (!["GET", "HEAD", "OPTIONS"].includes(tab.method)) {
    if (tab.bodyType === "json") {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      body = resolveEnvVariables(tab.bodyContent);
    } else if (tab.bodyType === "raw") {
      body = resolveEnvVariables(tab.bodyContent);
    } else if (tab.bodyType === "x-www-form-urlencoded") {
      headers["Content-Type"] = headers["Content-Type"] || "application/x-www-form-urlencoded";
      const params = new URLSearchParams();
      for (const f of tab.bodyFormData) {
        if (f.enabled && f.key) params.set(f.key, resolveEnvVariables(f.value));
      }
      body = params.toString();
    } else if (tab.bodyType === "form-data") {
      for (const f of tab.bodyFormData) {
        if (f.enabled && f.key) {
          formFields.push({ key: f.key, value: resolveEnvVariables(f.value) });
        }
      }
    } else if (tab.bodyType === "graphql") {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      let variables = {};
      try {
        variables = JSON.parse(resolveEnvVariables(tab.graphqlVariables || "{}"));
      } catch {
        // Keep empty variables on parse error
      }
      body = JSON.stringify({
        query: resolveEnvVariables(tab.graphqlQuery),
        variables,
      });
    }
  }

  return { method: tab.method, url, headers, body, formFields, bodyType: tab.bodyType };
}

// ─── Generators ───────────────────────────────────────────────────────────────

function escapeShellSingle(s: string): string {
  return s.replace(/'/g, "'\\''");
}

function generateCurl(req: ResolvedRequest): string {
  const parts: string[] = ["curl"];

  if (req.method !== "GET") {
    parts.push(`-X ${req.method}`);
  }

  parts.push(`'${escapeShellSingle(req.url)}'`);

  for (const [key, value] of Object.entries(req.headers)) {
    parts.push(`-H '${escapeShellSingle(key)}: ${escapeShellSingle(value)}'`);
  }

  if (req.formFields.length > 0) {
    for (const f of req.formFields) {
      parts.push(`-F '${escapeShellSingle(f.key)}=${escapeShellSingle(f.value)}'`);
    }
  } else if (req.body) {
    parts.push(`-d '${escapeShellSingle(req.body)}'`);
  }

  return parts.join(" \\\n  ");
}

function generateJavaScriptFetch(req: ResolvedRequest): string {
  const lines: string[] = [];
  const hasHeaders = Object.keys(req.headers).length > 0;
  const hasBody = req.body || req.formFields.length > 0;

  lines.push(`const response = await fetch('${req.url}', {`);
  lines.push(`  method: '${req.method}',`);

  if (hasHeaders) {
    lines.push(`  headers: {`);
    const entries = Object.entries(req.headers);
    entries.forEach(([key, value], i) => {
      const comma = i < entries.length - 1 ? "," : "";
      lines.push(`    '${key}': '${value}'${comma}`);
    });
    lines.push(`  },`);
  }

  if (req.formFields.length > 0) {
    lines.push(`  body: new URLSearchParams({`);
    req.formFields.forEach((f, i) => {
      const comma = i < req.formFields.length - 1 ? "," : "";
      lines.push(`    '${f.key}': '${f.value}'${comma}`);
    });
    lines.push(`  })`);
  } else if (req.body) {
    const escaped = req.body.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
    lines.push(`  body: '${escaped}'`);
  }

  lines.push(`});`);
  lines.push(``);
  lines.push(`const data = await response.text();`);
  lines.push(`console.log(data);`);

  return lines.join("\n");
}

function generateNodeAxios(req: ResolvedRequest): string {
  const lines: string[] = [];
  const hasHeaders = Object.keys(req.headers).length > 0;

  lines.push(`const axios = require('axios');`);
  lines.push(``);

  if (req.formFields.length > 0) {
    lines.push(`const params = new URLSearchParams();`);
    for (const f of req.formFields) {
      lines.push(`params.append('${f.key}', '${f.value}');`);
    }
    lines.push(``);
  }

  lines.push(`const response = await axios({`);
  lines.push(`  method: '${req.method.toLowerCase()}',`);
  lines.push(`  url: '${req.url}',`);

  if (hasHeaders) {
    lines.push(`  headers: {`);
    const entries = Object.entries(req.headers);
    entries.forEach(([key, value], i) => {
      const comma = i < entries.length - 1 ? "," : "";
      lines.push(`    '${key}': '${value}'${comma}`);
    });
    lines.push(`  },`);
  }

  if (req.formFields.length > 0) {
    lines.push(`  data: params`);
  } else if (req.body) {
    const escaped = req.body.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
    lines.push(`  data: '${escaped}'`);
  }

  lines.push(`});`);
  lines.push(``);
  lines.push(`console.log(response.data);`);

  return lines.join("\n");
}

function generatePythonRequests(req: ResolvedRequest): string {
  const lines: string[] = [];
  const hasHeaders = Object.keys(req.headers).length > 0;
  const method = req.method.toLowerCase();

  lines.push(`import requests`);
  lines.push(``);
  lines.push(`url = '${req.url}'`);

  if (hasHeaders) {
    lines.push(`headers = {`);
    const entries = Object.entries(req.headers);
    entries.forEach(([key, value], i) => {
      const comma = i < entries.length - 1 ? "," : "";
      lines.push(`    '${key}': '${value}'${comma}`);
    });
    lines.push(`}`);
  }

  if (req.formFields.length > 0) {
    lines.push(`data = {`);
    req.formFields.forEach((f, i) => {
      const comma = i < req.formFields.length - 1 ? "," : "";
      lines.push(`    '${f.key}': '${f.value}'${comma}`);
    });
    lines.push(`}`);
  } else if (req.body) {
    const escaped = req.body.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
    lines.push(`data = '${escaped}'`);
  }

  const args: string[] = ["url"];
  if (hasHeaders) args.push("headers=headers");
  if (req.formFields.length > 0) {
    args.push("data=data");
  } else if (req.body) {
    args.push("data=data");
  }

  lines.push(``);
  lines.push(`response = requests.${method}(${args.join(", ")})`);
  lines.push(`print(response.text)`);

  return lines.join("\n");
}

function generateGoNative(req: ResolvedRequest): string {
  const lines: string[] = [];
  const hasBody = req.body || req.formFields.length > 0;

  lines.push(`package main`);
  lines.push(``);
  lines.push(`import (`);
  lines.push(`\t"fmt"`);
  lines.push(`\t"io"`);
  lines.push(`\t"net/http"`);
  if (hasBody) {
    if (req.formFields.length > 0) {
      lines.push(`\t"net/url"`);
      lines.push(`\t"strings"`);
    } else {
      lines.push(`\t"strings"`);
    }
  }
  lines.push(`)`);
  lines.push(``);
  lines.push(`func main() {`);

  if (req.formFields.length > 0) {
    lines.push(`\tdata := url.Values{}`);
    for (const f of req.formFields) {
      lines.push(`\tdata.Set("${f.key}", "${f.value}")`);
    }
    lines.push(``);
    lines.push(`\treq, err := http.NewRequest("${req.method}", "${req.url}", strings.NewReader(data.Encode()))`);
  } else if (req.body) {
    const escaped = req.body.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
    lines.push(`\tbody := strings.NewReader("${escaped}")`);
    lines.push(`\treq, err := http.NewRequest("${req.method}", "${req.url}", body)`);
  } else {
    lines.push(`\treq, err := http.NewRequest("${req.method}", "${req.url}", nil)`);
  }

  lines.push(`\tif err != nil {`);
  lines.push(`\t\tpanic(err)`);
  lines.push(`\t}`);

  for (const [key, value] of Object.entries(req.headers)) {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    lines.push(`\treq.Header.Set("${key}", "${escaped}")`);
  }

  lines.push(``);
  lines.push(`\tclient := &http.Client{}`);
  lines.push(`\tresp, err := client.Do(req)`);
  lines.push(`\tif err != nil {`);
  lines.push(`\t\tpanic(err)`);
  lines.push(`\t}`);
  lines.push(`\tdefer resp.Body.Close()`);
  lines.push(``);
  lines.push(`\trespBody, err := io.ReadAll(resp.Body)`);
  lines.push(`\tif err != nil {`);
  lines.push(`\t\tpanic(err)`);
  lines.push(`\t}`);
  lines.push(`\tfmt.Println(string(respBody))`);
  lines.push(`}`);

  return lines.join("\n");
}

function generatePhpCurl(req: ResolvedRequest): string {
  const lines: string[] = [];

  lines.push(`<?php`);
  lines.push(``);
  lines.push(`$ch = curl_init();`);
  lines.push(``);
  lines.push(`curl_setopt($ch, CURLOPT_URL, '${escapeShellSingle(req.url)}');`);
  lines.push(`curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);`);
  lines.push(`curl_setopt($ch, CURLOPT_CUSTOMREQUEST, '${req.method}');`);

  const headerEntries = Object.entries(req.headers);
  if (headerEntries.length > 0) {
    lines.push(`curl_setopt($ch, CURLOPT_HTTPHEADER, [`);
    headerEntries.forEach(([key, value]) => {
      lines.push(`    '${escapeShellSingle(key)}: ${escapeShellSingle(value)}',`);
    });
    lines.push(`]);`);
  }

  if (req.formFields.length > 0) {
    lines.push(`curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query([`);
    req.formFields.forEach((f) => {
      lines.push(`    '${escapeShellSingle(f.key)}' => '${escapeShellSingle(f.value)}',`);
    });
    lines.push(`]));`);
  } else if (req.body) {
    const escaped = req.body.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
    lines.push(`curl_setopt($ch, CURLOPT_POSTFIELDS, '${escaped}');`);
  }

  lines.push(``);
  lines.push(`$response = curl_exec($ch);`);
  lines.push(`curl_close($ch);`);
  lines.push(``);
  lines.push(`echo $response;`);

  return lines.join("\n");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function generateCode(tab: RequestTab, language: CodeLanguage): string {
  const req = resolveRequest(tab);

  switch (language) {
    case "curl":
      return generateCurl(req);
    case "javascript-fetch":
      return generateJavaScriptFetch(req);
    case "node-axios":
      return generateNodeAxios(req);
    case "python-requests":
      return generatePythonRequests(req);
    case "go-native":
      return generateGoNative(req);
    case "php-curl":
      return generatePhpCurl(req);
    default:
      return generateCurl(req);
  }
}
