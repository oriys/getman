'use client';

/**
 * Collection Runner
 *
 * Runs all requests in a collection sequentially or in parallel,
 * with optional CSV/JSON data-driven parameterization.
 */

import type { Collection, SavedRequest, ResponseData, RequestTab } from "./getman-store";
import { resolveEnvVariables, uid } from "./getman-store";
import { sendHttpRequest, type SendRequestPayload } from "./tauri";
import { runAssertions } from "./assertions";
import type { AssertionResult } from "./getman-store";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RunnerOptions {
  mode: "serial" | "parallel";
  delayMs: number;
  dataSource?: DataSource;
  iterations: number;
}

export interface DataSource {
  type: "csv" | "json";
  content: string;
}

export interface RunnerRequestResult {
  requestId: string;
  requestName: string;
  method: string;
  url: string;
  response: ResponseData;
  assertionResults: AssertionResult[];
  iteration: number;
  dataRow?: Record<string, string>;
  duration: number;
}

export interface RunnerResult {
  collectionName: string;
  totalRequests: number;
  passedRequests: number;
  failedRequests: number;
  totalAssertions: number;
  passedAssertions: number;
  failedAssertions: number;
  totalDuration: number;
  results: RunnerRequestResult[];
}

export type RunnerProgressCallback = (current: number, total: number, result: RunnerRequestResult) => void;

// ─── Data Parsing ────────────────────────────────────────────────────────────

function parseCsvData(csv: string): Record<string, string>[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [{}];

  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] || "";
    });
    return row;
  });
}

function parseJsonData(json: string): Record<string, string>[] {
  const data = JSON.parse(json);
  if (Array.isArray(data)) {
    return data.map((row) => {
      const obj: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        obj[k] = String(v);
      }
      return obj;
    });
  }
  return [{}];
}

function parseDataSource(source?: DataSource): Record<string, string>[] {
  if (!source || !source.content.trim()) return [{}];

  try {
    if (source.type === "csv") return parseCsvData(source.content);
    if (source.type === "json") return parseJsonData(source.content);
  } catch {
    // fallback
  }
  return [{}];
}

// ─── Variable Substitution ──────────────────────────────────────────────────

function substituteDataVariables(input: string, data: Record<string, string>): string {
  let result = input;
  for (const [key, value] of Object.entries(data)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\{\\{${escaped}\\}\\}`, "g"), value);
  }
  return result;
}

// ─── Build Request Payload ──────────────────────────────────────────────────

function buildPayloadFromTab(tab: RequestTab, dataRow: Record<string, string>): SendRequestPayload {
  const resolveAll = (s: string) => substituteDataVariables(resolveEnvVariables(s), dataRow);

  const headers: Record<string, string> = {};
  for (const h of tab.headers) {
    if (h.enabled && h.key) {
      headers[resolveAll(h.key)] = resolveAll(h.value);
    }
  }

  // Auth headers
  if (tab.authType === "bearer" && tab.authToken) {
    headers["Authorization"] = `Bearer ${resolveAll(tab.authToken)}`;
  } else if (tab.authType === "basic" && tab.authUsername) {
    const encoded = btoa(`${resolveAll(tab.authUsername)}:${resolveAll(tab.authPassword)}`);
    headers["Authorization"] = `Basic ${encoded}`;
  } else if (tab.authType === "api-key" && tab.authApiAddTo === "header") {
    headers[resolveAll(tab.authApiKey)] = resolveAll(tab.authApiValue);
  }

  let body: string | undefined;
  if (!["GET", "HEAD", "OPTIONS"].includes(tab.method)) {
    if (tab.bodyType === "json") {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      body = resolveAll(tab.bodyContent);
    } else if (tab.bodyType === "raw") {
      body = resolveAll(tab.bodyContent);
    } else if (tab.bodyType === "x-www-form-urlencoded") {
      headers["Content-Type"] = headers["Content-Type"] || "application/x-www-form-urlencoded";
      const params = new URLSearchParams();
      for (const f of tab.bodyFormData) {
        if (f.enabled && f.key) params.set(f.key, resolveAll(f.value));
      }
      body = params.toString();
    }
  }

  const url = resolveAll(tab.url);
  const requestId = uid();

  return {
    url,
    method: tab.method,
    headers,
    body,
    requestId,
    timeoutMs: tab.settings?.timeoutMs || undefined,
    retryCount: tab.settings?.retryCount || undefined,
    retryDelayMs: tab.settings?.retryDelayMs || undefined,
    proxyUrl: tab.settings?.proxyUrl || undefined,
    verifySsl: tab.settings?.verifySsl ?? true,
  };
}

// ─── Runner ──────────────────────────────────────────────────────────────────

function getAllRequests(collection: Collection): SavedRequest[] {
  const reqs: SavedRequest[] = [...collection.requests];
  for (const folder of collection.folders) {
    reqs.push(...folder.requests);
  }
  return reqs;
}

async function runSingleRequest(
  req: SavedRequest,
  iteration: number,
  dataRow: Record<string, string>
): Promise<RunnerRequestResult> {
  const payload = buildPayloadFromTab(req.tab, dataRow);
  const start = performance.now();

  const response: ResponseData = await sendHttpRequest(payload);
  const duration = Math.round(performance.now() - start);

  const assertionResults = req.tab.assertions
    ? runAssertions(req.tab.assertions, response)
    : [];

  return {
    requestId: req.id,
    requestName: req.name,
    method: req.method,
    url: req.url,
    response,
    assertionResults,
    iteration,
    dataRow: Object.keys(dataRow).length > 0 ? dataRow : undefined,
    duration,
  };
}

export async function runCollection(
  collection: Collection,
  options: RunnerOptions,
  onProgress?: RunnerProgressCallback,
  signal?: AbortSignal,
): Promise<RunnerResult> {
  const requests = getAllRequests(collection);
  const dataRows = parseDataSource(options.dataSource);
  const iterations = Math.max(1, options.iterations || dataRows.length);
  const totalRequests = requests.length * iterations;
  const results: RunnerRequestResult[] = [];
  const startTime = performance.now();
  let completed = 0;

  for (let iter = 0; iter < iterations; iter++) {
    const dataRow = dataRows[iter % dataRows.length] || {};

    if (options.mode === "parallel") {
      const promises = requests.map(async (req) => {
        if (signal?.aborted) return null;
        const result = await runSingleRequest(req, iter, dataRow);
        completed++;
        onProgress?.(completed, totalRequests, result);
        return result;
      });
      const batchResults = await Promise.all(promises);
      results.push(...batchResults.filter((r): r is RunnerRequestResult => r !== null));
    } else {
      for (const req of requests) {
        if (signal?.aborted) break;

        const result = await runSingleRequest(req, iter, dataRow);
        results.push(result);
        completed++;
        onProgress?.(completed, totalRequests, result);

        if (options.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        }
      }
    }
  }

  const totalAssertions = results.reduce((sum, r) => sum + r.assertionResults.length, 0);
  const passedAssertions = results.reduce(
    (sum, r) => sum + r.assertionResults.filter((a) => a.passed).length, 0
  );
  const failedRequests = results.filter((r) => r.response.status === 0 || r.response.status >= 400).length;

  return {
    collectionName: collection.name,
    totalRequests: results.length,
    passedRequests: results.length - failedRequests,
    failedRequests,
    totalAssertions,
    passedAssertions,
    failedAssertions: totalAssertions - passedAssertions,
    totalDuration: Math.round(performance.now() - startTime),
    results,
  };
}

// ─── Report Generation (for CLI) ────────────────────────────────────────────

export function generateTextReport(result: RunnerResult): string {
  const lines: string[] = [];

  lines.push(`\n╔══════════════════════════════════════════════════════════════╗`);
  lines.push(`║  Collection Runner Report: ${result.collectionName}`);
  lines.push(`╚══════════════════════════════════════════════════════════════╝\n`);

  lines.push(`Summary:`);
  lines.push(`  Total Requests:    ${result.totalRequests}`);
  lines.push(`  Passed:            ${result.passedRequests}`);
  lines.push(`  Failed:            ${result.failedRequests}`);
  lines.push(`  Total Assertions:  ${result.totalAssertions}`);
  lines.push(`  Passed Assertions: ${result.passedAssertions}`);
  lines.push(`  Failed Assertions: ${result.failedAssertions}`);
  lines.push(`  Total Duration:    ${result.totalDuration}ms`);
  lines.push(``);

  for (const r of result.results) {
    const status = r.response.status === 0 ? "ERR" : String(r.response.status);
    const icon = r.response.status >= 200 && r.response.status < 400 ? "✓" : "✗";
    lines.push(`  ${icon} [${status}] ${r.method} ${r.url} (${r.duration}ms)`);

    for (const a of r.assertionResults) {
      const aIcon = a.passed ? "  ✓" : "  ✗";
      lines.push(`    ${aIcon} ${a.message}`);
    }
  }

  lines.push(``);
  const exitCode = result.failedRequests === 0 && result.failedAssertions === 0 ? 0 : 1;
  lines.push(`Exit Code: ${exitCode}`);

  return lines.join("\n");
}

export function generateJsonReport(result: RunnerResult): string {
  return JSON.stringify({
    ...result,
    exitCode: result.failedRequests === 0 && result.failedAssertions === 0 ? 0 : 1,
  }, null, 2);
}
