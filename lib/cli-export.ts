'use client';

/**
 * CLI Export
 *
 * Exports a collection in a CLI-compatible JSON format that can be
 * consumed by a CI runner. Also generates shell scripts for headless execution.
 */

import type { Collection, SavedRequest, RequestTab } from "./getman-store";
import { resolveEnvVariables } from "./getman-store";

// ─── CLI-compatible format ──────────────────────────────────────────────────

export interface CliCollectionFormat {
  name: string;
  version: "1.0";
  requests: CliRequest[];
  settings?: {
    delayMs?: number;
    mode?: "serial" | "parallel";
  };
}

export interface CliRequest {
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  assertions?: CliAssertion[];
  timeout?: number;
  retryCount?: number;
}

export interface CliAssertion {
  type: string;
  property?: string;
  comparison: string;
  expected: string;
}

function tabToCliRequest(tab: RequestTab, name: string): CliRequest {
  const headers: Record<string, string> = {};
  for (const h of tab.headers) {
    if (h.enabled && h.key) {
      headers[h.key] = h.value;
    }
  }

  // Auth headers
  if (tab.authType === "bearer" && tab.authToken) {
    headers["Authorization"] = `Bearer ${tab.authToken}`;
  } else if (tab.authType === "basic" && tab.authUsername) {
    headers["Authorization"] = `Basic ${btoa(`${tab.authUsername}:${tab.authPassword}`)}`;
  } else if (tab.authType === "api-key" && tab.authApiAddTo === "header") {
    headers[tab.authApiKey] = tab.authApiValue;
  }

  let body: string | undefined;
  if (!["GET", "HEAD", "OPTIONS"].includes(tab.method)) {
    if (tab.bodyType === "json" || tab.bodyType === "raw") {
      body = tab.bodyContent;
    }
  }

  const assertions: CliAssertion[] = (tab.assertions || [])
    .filter((a) => a.enabled)
    .map((a) => ({
      type: a.type,
      property: a.property || undefined,
      comparison: a.comparison,
      expected: a.expected,
    }));

  return {
    name,
    method: tab.method,
    url: tab.url,
    headers,
    body,
    assertions: assertions.length > 0 ? assertions : undefined,
    timeout: tab.settings?.timeoutMs || undefined,
    retryCount: tab.settings?.retryCount || undefined,
  };
}

export function exportCliFormat(collection: Collection): string {
  const requests: CliRequest[] = [];

  for (const req of collection.requests) {
    requests.push(tabToCliRequest(req.tab, req.name));
  }

  for (const folder of collection.folders) {
    for (const req of folder.requests) {
      requests.push(tabToCliRequest(req.tab, `${folder.name}/${req.name}`));
    }
  }

  const format: CliCollectionFormat = {
    name: collection.name,
    version: "1.0",
    requests,
  };

  return JSON.stringify(format, null, 2);
}

// ─── Shell Script Generation ────────────────────────────────────────────────

function escapeShell(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function exportShellScript(collection: Collection): string {
  const lines: string[] = [];

  lines.push("#!/bin/bash");
  lines.push(`# Getman Collection Runner: ${collection.name}`);
  lines.push(`# Generated at ${new Date().toISOString()}`);
  lines.push("");
  lines.push("set -e");
  lines.push("PASS=0");
  lines.push("FAIL=0");
  lines.push("");

  const allRequests: SavedRequest[] = [
    ...collection.requests,
    ...collection.folders.flatMap((f) => f.requests),
  ];

  for (const req of allRequests) {
    const tab = req.tab;
    lines.push(`echo "Running: ${req.name}"`);

    let curlCmd = `curl -s -w "\\n%{http_code}" -X ${tab.method}`;

    for (const h of tab.headers) {
      if (h.enabled && h.key) {
        curlCmd += ` -H ${escapeShell(`${h.key}: ${h.value}`)}`;
      }
    }

    if (tab.authType === "bearer" && tab.authToken) {
      curlCmd += ` -H ${escapeShell(`Authorization: Bearer ${tab.authToken}`)}`;
    } else if (tab.authType === "basic" && tab.authUsername) {
      curlCmd += ` -u ${escapeShell(`${tab.authUsername}:${tab.authPassword}`)}`;
    }

    if (!["GET", "HEAD", "OPTIONS"].includes(tab.method) && tab.bodyContent) {
      curlCmd += ` -d ${escapeShell(tab.bodyContent)}`;
    }

    if (tab.settings?.timeoutMs) {
      curlCmd += ` --max-time ${Math.ceil(tab.settings.timeoutMs / 1000)}`;
    }

    curlCmd += ` ${escapeShell(tab.url)}`;

    lines.push(`RESPONSE=$(${curlCmd})`);
    lines.push(`HTTP_CODE=$(echo "$RESPONSE" | tail -1)`);
    lines.push(`BODY=$(echo "$RESPONSE" | sed '$d')`);

    // Simple status code assertion
    const statusAssertions = (tab.assertions || []).filter((a) => a.enabled && a.type === "status");
    if (statusAssertions.length > 0) {
      for (const a of statusAssertions) {
        if (a.comparison === "eq") {
          lines.push(`if [ "$HTTP_CODE" = "${a.expected}" ]; then`);
          lines.push(`  echo "  ✓ Status = ${a.expected}"`);
          lines.push(`  PASS=$((PASS+1))`);
          lines.push(`else`);
          lines.push(`  echo "  ✗ Expected status ${a.expected}, got $HTTP_CODE"`);
          lines.push(`  FAIL=$((FAIL+1))`);
          lines.push(`fi`);
        }
      }
    } else {
      lines.push(`if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 400 ]; then`);
      lines.push(`  echo "  ✓ Status: $HTTP_CODE"`);
      lines.push(`  PASS=$((PASS+1))`);
      lines.push(`else`);
      lines.push(`  echo "  ✗ Status: $HTTP_CODE"`);
      lines.push(`  FAIL=$((FAIL+1))`);
      lines.push(`fi`);
    }

    lines.push("");
  }

  lines.push(`echo ""`);
  lines.push(`echo "Results: $PASS passed, $FAIL failed"`);
  lines.push(`if [ "$FAIL" -gt 0 ]; then exit 1; fi`);

  return lines.join("\n");
}
