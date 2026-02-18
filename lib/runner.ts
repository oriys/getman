'use client';

/**
 * Collection Runner
 *
 * Runs all requests in a collection sequentially or in parallel,
 * with optional CSV/JSON data-driven parameterization.
 */

import type {
  Collection,
  CollectionFolder,
  EnvVariable,
  SavedRequest,
  ResponseData,
  RequestTab,
  HttpMethod,
} from "./getman-store";
import {
  resolveEnvVariables,
  getVariableScopeSnapshot,
  uid,
  createDefaultTab,
} from "./getman-store";
import { sendHttpRequest, type SendRequestPayload } from "./tauri";
import { runAssertions } from "./assertions";
import type { AssertionResult } from "./getman-store";
import {
  executePreRequestScript,
  executePostResponseScript,
  type ScriptExecutionLog,
} from "./request-scripts";
import { applyAdvancedAuth } from "./advanced-auth";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RunnerOptions {
  mode: "serial" | "parallel";
  delayMs: number;
  dataSource?: DataSource;
  iterations: number;
  contractGuard?: ContractGuardOptions;
  trafficRecorder?: TrafficRecorderOptions;
  chaos?: ChaosOptions;
  performanceLab?: PerformanceLabOptions;
}

export interface DataSource {
  type: "csv" | "json";
  content: string;
}

export interface ContractGuardOptions {
  enabled: boolean;
  breakOnDrift: boolean;
  autoUpdateBaseline: boolean;
}

export interface TrafficRecorderOptions {
  enabled: boolean;
}

export interface ChaosOptions {
  enabled: boolean;
  level: "light" | "aggressive";
}

export interface PerformanceLabOptions {
  enabled: boolean;
  regressionThresholdPct: number;
  autoUpdateBaseline: boolean;
}

export interface ContractDriftIssue {
  requestId: string;
  requestName: string;
  kind: "new" | "changed";
  previousSignature?: string;
  currentSignature: string;
}

export interface DurationMetrics {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
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
  skipped?: boolean;
  skipReason?: string;
  chaosCase?: string;
  scriptLogs?: ScriptExecutionLog[];
}

export interface RunnerResult {
  collectionName: string;
  totalRequests: number;
  passedRequests: number;
  failedRequests: number;
  skippedRequests: number;
  totalAssertions: number;
  passedAssertions: number;
  failedAssertions: number;
  totalDuration: number;
  results: RunnerRequestResult[];
  effectiveMode: "serial" | "parallel";
  flowOrchestratorUsed: boolean;
  contractGuardUsed: boolean;
  contractDrifts: ContractDriftIssue[];
  contractGateFailed: boolean;
  contractBaselineUpdated: boolean;
  trafficRecorderUsed: boolean;
  recordedCollection?: Collection;
  chaosUsed: boolean;
  chaosLevel: "none" | "light" | "aggressive";
  chaosCaseCount: number;
  performanceLabUsed: boolean;
  performanceMetrics?: DurationMetrics;
  performanceBaseline?: DurationMetrics;
  performanceRegressionPct?: number;
  performanceGateFailed: boolean;
  performanceBaselineUpdated: boolean;
}

export type RunnerProgressCallback = (current: number, total: number, result: RunnerRequestResult) => void;

interface RequestExecutionTarget {
  request: SavedRequest;
  folderChain: CollectionFolder[];
}

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

const CONTRACT_BASELINE_PREFIX = "getman.contract.baseline.v1.";
const PERFORMANCE_BASELINE_PREFIX = "getman.performance.baseline.v1.";
const HTTP_METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];
type ChaosCase = "strip-body" | "drop-auth" | "invalid-json" | "random-method";

function getChaosCases(options?: ChaosOptions): ChaosCase[] {
  if (!options?.enabled) return [];
  return options.level === "aggressive"
    ? ["strip-body", "drop-auth", "invalid-json", "random-method"]
    : ["strip-body", "drop-auth"];
}

function normalizeMethod(method: string): HttpMethod {
  return HTTP_METHODS.includes(method as HttpMethod) ? (method as HttpMethod) : "GET";
}

function loadLocalStorageJson<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function saveLocalStorageJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // noop
  }
}

function normalizeContentType(contentType?: string): string {
  return (contentType || "application/octet-stream").split(";")[0].trim().toLowerCase();
}

function inferContractShape(value: unknown): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return value.length === 0 ? ["array", "empty"] : ["array", inferContractShape(value[0])];
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, inferContractShape(v)]);
    return Object.fromEntries(entries);
  }
  return typeof value;
}

function buildContractSignature(response: ResponseData): string {
  const contentType = normalizeContentType(response.contentType);
  let bodyShape: unknown = typeof response.body;
  if (contentType.includes("json")) {
    try {
      bodyShape = inferContractShape(JSON.parse(response.body || "null"));
    } catch {
      bodyShape = "invalid-json";
    }
  }
  return JSON.stringify({
    status: response.status,
    contentType,
    bodyShape,
  });
}

function percentile(sortedValues: number[], pct: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sortedValues.length) - 1)
  );
  return sortedValues[index];
}

function computeDurationMetrics(values: number[]): DurationMetrics | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    avg: Math.round(sum / sorted.length),
    p50: Math.round(percentile(sorted, 50)),
    p95: Math.round(percentile(sorted, 95)),
    p99: Math.round(percentile(sorted, 99)),
  };
}

function applyChaosCase(payload: SendRequestPayload, chaosCase: ChaosCase): SendRequestPayload {
  const mutated: SendRequestPayload = {
    ...payload,
    headers: { ...payload.headers },
  };
  if (chaosCase === "strip-body") {
    mutated.body = undefined;
    delete mutated.headers["Content-Type"];
    delete mutated.headers["content-type"];
  } else if (chaosCase === "drop-auth") {
    delete mutated.headers["Authorization"];
    delete mutated.headers["authorization"];
    delete mutated.headers["X-Api-Key"];
    delete mutated.headers["x-api-key"];
  } else if (chaosCase === "invalid-json") {
    mutated.headers["Content-Type"] = mutated.headers["Content-Type"] || "application/json";
    mutated.body = '{"invalidJson":';
  } else if (chaosCase === "random-method") {
    mutated.method = "TRACE";
  }
  return mutated;
}

function buildRecordedCollection(
  sourceCollection: Collection,
  results: RunnerRequestResult[]
): Collection | undefined {
  const recorded = results.filter((r) => !r.skipped && !r.chaosCase);
  if (recorded.length === 0) return undefined;
  const requests: SavedRequest[] = recorded.map((item, index) => {
    const tab = createDefaultTab();
    tab.method = normalizeMethod(item.method);
    tab.url = item.url;
    tab.assertions = [
      {
        id: uid(),
        type: "status",
        property: "",
        comparison: "eq",
        expected: String(item.response.status),
        enabled: true,
      },
    ];
    return {
      id: uid(),
      name: `${item.requestName} [recorded ${index + 1}]`,
      method: tab.method,
      url: tab.url,
      tab,
    };
  });
  return {
    id: uid(),
    name: `${sourceCollection.name} [Recorded]`,
    requests,
    folders: [],
  };
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

function variablesToMap(variables?: EnvVariable[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const variable of variables || []) {
    if (variable.enabled && variable.key) {
      map[variable.key] = variable.value;
    }
  }
  return map;
}

// ─── Build Request Payload ──────────────────────────────────────────────────

function buildPayloadFromTab(
  tab: RequestTab,
  dataRow: Record<string, string>,
  resolveScope?: {
    collectionVariables?: EnvVariable[];
    folderVariables?: EnvVariable[][];
    requestVariables?: EnvVariable[];
    runtimeVariables?: Record<string, string>;
  }
): SendRequestPayload {
  const resolveAll = (s: string) =>
    substituteDataVariables(
      resolveEnvVariables(s, {
        collectionVariables: resolveScope?.collectionVariables,
        folderVariables: resolveScope?.folderVariables,
        requestVariables: resolveScope?.requestVariables,
        runtimeVariables: resolveScope?.runtimeVariables,
      }),
      dataRow
    );

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

  // Cookies
  const cookieParts: string[] = [];
  for (const c of tab.cookies ?? []) {
    if (c.enabled && c.key) {
      cookieParts.push(`${resolveAll(c.key)}=${resolveAll(c.value)}`);
    }
  }
  if (cookieParts.length > 0) {
    headers["Cookie"] = cookieParts.join("; ");
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

function collectFolderRequests(
  folders: CollectionFolder[],
  chain: CollectionFolder[] = []
): RequestExecutionTarget[] {
  const targets: RequestExecutionTarget[] = [];
  for (const folder of folders) {
    const nextChain = [...chain, folder];
    targets.push(
      ...folder.requests.map((request) => ({
        request,
        folderChain: nextChain,
      }))
    );
    targets.push(...collectFolderRequests(folder.folders, nextChain));
  }
  return targets;
}

function getAllRequests(collection: Collection): RequestExecutionTarget[] {
  const rootTargets: RequestExecutionTarget[] = collection.requests.map((request) => ({
    request,
    folderChain: [],
  }));
  return [...rootTargets, ...collectFolderRequests(collection.folders)];
}

function parseFlowDependencies(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasFlowRules(tab: RequestTab): boolean {
  return Boolean(tab.flowDependsOn?.trim() || tab.flowCondition?.trim());
}

function isFlowSuccess(result: RunnerRequestResult): boolean {
  if (result.skipped) {
    return false;
  }
  if (result.response.status < 200 || result.response.status >= 400) {
    return false;
  }
  return result.assertionResults.every((assertion) => assertion.passed);
}

function createSkippedResult(
  req: SavedRequest,
  iteration: number,
  dataRow: Record<string, string>,
  reason: string,
  chaosCase?: ChaosCase
): RunnerRequestResult {
  return {
    requestId: req.id,
    requestName: req.name,
    method: req.method,
    url: req.url,
    response: {
      status: 0,
      statusText: "Skipped",
      headers: {},
      body: reason,
      time: 0,
      size: reason.length,
      contentType: "text/plain",
    },
    assertionResults: [],
    iteration,
    dataRow: Object.keys(dataRow).length > 0 ? dataRow : undefined,
    duration: 0,
    skipped: true,
    skipReason: reason,
    chaosCase,
  };
}

function getFlowSkipReason(
  req: SavedRequest,
  iteration: number,
  dataRow: Record<string, string>,
  resultById: Map<string, RunnerRequestResult>,
  resultByName: Map<string, RunnerRequestResult>
): string | null {
  const dependencies = parseFlowDependencies(req.tab.flowDependsOn || "");
  const deps: Record<string, RunnerRequestResult> = {};
  const missing: string[] = [];
  const failed: string[] = [];

  for (const dep of dependencies) {
    const depResult = resultById.get(dep) ?? resultByName.get(dep.toLowerCase());
    if (!depResult) {
      missing.push(dep);
      continue;
    }
    deps[dep] = depResult;
    if (!isFlowSuccess(depResult)) {
      failed.push(dep);
    }
  }

  if (missing.length > 0) {
    return `Missing dependency: ${missing.join(", ")}`;
  }
  if (failed.length > 0) {
    return `Dependency not successful: ${failed.join(", ")}`;
  }

  const condition = (req.tab.flowCondition || "").trim();
  if (!condition) {
    return null;
  }

  try {
    const evaluator = new Function(
      "data",
      "iteration",
      "deps",
      "results",
      `"use strict"; return (${condition});`
    );
    const conditionMatched = Boolean(
      evaluator(
        dataRow,
        iteration,
        deps,
        Array.from(resultById.values())
      )
    );
    if (!conditionMatched) {
      return "Flow condition evaluated to false";
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown flow condition error";
    return `Flow condition error: ${message}`;
  }

  return null;
}

async function runSingleRequest(
  target: RequestExecutionTarget,
  collection: Collection,
  iteration: number,
  dataRow: Record<string, string>,
  variableScopes: {
    globalVariables: Record<string, string>;
    environmentVariables: Record<string, string>;
  },
  chaosCase?: ChaosCase
): Promise<RunnerRequestResult> {
  const req = target.request;
  const runtimeVariables: Record<string, string> = {};
  const scriptLogs: ScriptExecutionLog[] = [];
  const collectionVariables = variablesToMap(collection.variables);
  const folderVariables = target.folderChain.map((folder) => variablesToMap(folder.variables));
  const requestVariables = variablesToMap(req.tab.variables);

  const preScripts = [
    { name: `${collection.name}::pre-request`, script: collection.preRequestScript || "" },
    ...target.folderChain.map((folder) => ({
      name: `${folder.name}::pre-request`,
      script: folder.preRequestScript || "",
    })),
    { name: `${req.name}::pre-request`, script: req.tab.preRequestScript || "" },
  ].filter((entry) => entry.script.trim());

  const postScripts = [
    { name: `${collection.name}::test`, script: collection.testScript || "" },
    ...target.folderChain.map((folder) => ({
      name: `${folder.name}::test`,
      script: folder.testScript || "",
    })),
    { name: `${req.name}::test`, script: req.tab.testScript || "" },
  ].filter((entry) => entry.script.trim());

  let payload = buildPayloadFromTab(req.tab, dataRow, {
    collectionVariables: collection.variables,
    folderVariables: target.folderChain.map((folder) => folder.variables || []),
    requestVariables: req.tab.variables,
    runtimeVariables,
  });
  const start = performance.now();

  try {
    for (const script of preScripts) {
      payload = executePreRequestScript(script.script, payload, {
        scriptName: script.name,
        requestName: req.name,
        globalVariables: variableScopes.globalVariables,
        environmentVariables: variableScopes.environmentVariables,
        collectionVariables,
        requestVariables,
        runtimeVariables,
        iterationData: dataRow,
        logs: scriptLogs,
      });
    }

    payload = await applyAdvancedAuth(payload, req.tab);
    if (chaosCase) {
      payload = applyChaosCase(payload, chaosCase);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Pre-request script failed";
    const scriptFailure: AssertionResult = {
      assertionId: `script-${uid()}`,
      passed: false,
      actual: "",
      message: `[Script] runtime: ${message}`,
    };
    return {
      requestId: req.id,
      requestName: req.name,
      method: payload.method,
      url: payload.url,
      response: {
        status: 0,
        statusText: "Script Error",
        headers: {},
        body: message,
        time: 0,
        size: message.length,
        contentType: "text/plain",
      },
      assertionResults: [scriptFailure],
      iteration,
      dataRow: Object.keys(dataRow).length > 0 ? dataRow : undefined,
      duration: Math.round(performance.now() - start),
      chaosCase,
      scriptLogs,
    };
  }

  const response: ResponseData = await sendHttpRequest(payload);
  const duration = Math.round(performance.now() - start);

  const assertionResults = req.tab.assertions
    ? runAssertions(req.tab.assertions, response)
    : [];
  for (const script of postScripts) {
    assertionResults.push(
      ...executePostResponseScript(
        script.script,
        {
          method: payload.method,
          url: payload.url,
          headers: payload.headers,
          body: payload.body,
        },
        response,
        {
          scriptName: script.name,
          requestName: req.name,
          globalVariables: variableScopes.globalVariables,
          environmentVariables: variableScopes.environmentVariables,
          collectionVariables,
          requestVariables,
          runtimeVariables,
          iterationData: dataRow,
          logs: scriptLogs,
        }
      )
    );
  }

  return {
    requestId: req.id,
    requestName: req.name,
    method: payload.method,
    url: payload.url,
    response,
    assertionResults,
    iteration,
    dataRow: Object.keys(dataRow).length > 0 ? dataRow : undefined,
    duration,
    chaosCase,
    scriptLogs,
  };
}

export async function runCollection(
  collection: Collection,
  options: RunnerOptions,
  onProgress?: RunnerProgressCallback,
  signal?: AbortSignal,
): Promise<RunnerResult> {
  const requests = getAllRequests(collection);
  const flowOrchestratorUsed = requests.some((target) => hasFlowRules(target.request.tab));
  const effectiveMode =
    flowOrchestratorUsed && options.mode === "parallel"
      ? "serial"
      : options.mode;
  const variableScopes = getVariableScopeSnapshot();
  const dataRows = parseDataSource(options.dataSource);
  const iterations = Math.max(1, options.iterations || dataRows.length);
  const chaosCases = getChaosCases(options.chaos);
  const totalRequests = requests.length * (1 + chaosCases.length) * iterations;
  const contractGuardUsed = Boolean(options.contractGuard?.enabled);
  const trafficRecorderUsed = Boolean(options.trafficRecorder?.enabled);
  const performanceLabUsed = Boolean(options.performanceLab?.enabled);
  const results: RunnerRequestResult[] = [];
  const startTime = performance.now();
  let completed = 0;
  const currentContractSignatures: Record<string, string> = {};

  const contractBaselineKey = `${CONTRACT_BASELINE_PREFIX}${collection.id}`;
  const previousContractBaseline =
    contractGuardUsed
      ? loadLocalStorageJson<Record<string, string>>(contractBaselineKey) || {}
      : {};

  for (let iter = 0; iter < iterations; iter++) {
    const dataRow = dataRows[iter % dataRows.length] || {};
    const resultById = new Map<string, RunnerRequestResult>();
    const resultByName = new Map<string, RunnerRequestResult>();

    if (effectiveMode === "parallel") {
      const jobs = requests.flatMap((target) => [
        { target, chaosCase: undefined as ChaosCase | undefined },
        ...chaosCases.map((chaosCase) => ({ target, chaosCase })),
      ]);
      const promises = jobs.map(async ({ target, chaosCase }) => {
        if (signal?.aborted) return null;
        const result = await runSingleRequest(
          target,
          collection,
          iter,
          dataRow,
          variableScopes,
          chaosCase
        );
        if (!result.skipped && !result.chaosCase && contractGuardUsed) {
          currentContractSignatures[target.request.id] = buildContractSignature(result.response);
        }
        completed++;
        onProgress?.(completed, totalRequests, result);
        return result;
      });
      const batchResults = await Promise.all(promises);
      results.push(...batchResults.filter((r): r is RunnerRequestResult => r !== null));
    } else {
      for (const target of requests) {
        const req = target.request;
        if (signal?.aborted) break;

        const skipReason = getFlowSkipReason(
          req,
          iter,
          dataRow,
          resultById,
          resultByName
        );
        const baseResult = skipReason
          ? createSkippedResult(req, iter, dataRow, skipReason)
          : await runSingleRequest(target, collection, iter, dataRow, variableScopes);

        if (!baseResult.skipped && contractGuardUsed) {
          currentContractSignatures[req.id] = buildContractSignature(baseResult.response);
        }

        resultById.set(req.id, baseResult);
        resultByName.set(req.name.toLowerCase(), baseResult);
        results.push(baseResult);
        completed++;
        onProgress?.(completed, totalRequests, baseResult);

        if (options.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        }

        for (const chaosCase of chaosCases) {
          if (signal?.aborted) break;
          const chaosResult = baseResult.skipped
            ? createSkippedResult(
                req,
                iter,
                dataRow,
                `Base request skipped: ${baseResult.skipReason || "flow gate"}`,
                chaosCase
              )
            : await runSingleRequest(
                target,
                collection,
                iter,
                dataRow,
                variableScopes,
                chaosCase
              );
          results.push(chaosResult);
          completed++;
          onProgress?.(completed, totalRequests, chaosResult);

          if (options.delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, options.delayMs));
          }
        }
      }
    }
  }

  const totalAssertions = results.reduce((sum, r) => sum + r.assertionResults.length, 0);
  const passedAssertions = results.reduce(
    (sum, r) => sum + r.assertionResults.filter((a) => a.passed).length, 0
  );
  const skippedRequests = results.filter((r) => r.skipped).length;
  const failedRequests = results.filter(
    (r) => !r.skipped && (r.response.status === 0 || r.response.status >= 400)
  ).length;

  let contractDrifts: ContractDriftIssue[] = [];
  let contractGateFailed = false;
  let contractBaselineUpdated = false;
  if (contractGuardUsed) {
    for (const target of requests) {
      const req = target.request;
      const currentSignature = currentContractSignatures[req.id];
      if (!currentSignature) continue;
      const previousSignature = previousContractBaseline[req.id];
      if (!previousSignature) {
        contractDrifts.push({
          requestId: req.id,
          requestName: req.name,
          kind: "new",
          currentSignature,
        });
        continue;
      }
      if (previousSignature !== currentSignature) {
        contractDrifts.push({
          requestId: req.id,
          requestName: req.name,
          kind: "changed",
          previousSignature,
          currentSignature,
        });
      }
    }
    contractGateFailed = Boolean(options.contractGuard?.breakOnDrift && contractDrifts.length > 0);
    if (options.contractGuard?.autoUpdateBaseline) {
      saveLocalStorageJson(contractBaselineKey, currentContractSignatures);
      contractBaselineUpdated = true;
    }
  }

  const performanceBaselineKey = `${PERFORMANCE_BASELINE_PREFIX}${collection.id}`;
  const performanceDurations = results
    .filter((r) => !r.skipped && !r.chaosCase)
    .map((r) => r.duration);
  const performanceMetrics = performanceLabUsed
    ? computeDurationMetrics(performanceDurations)
    : undefined;
  const performanceBaseline = performanceLabUsed
    ? loadLocalStorageJson<DurationMetrics>(performanceBaselineKey)
    : undefined;
  const performanceRegressionPct =
    performanceLabUsed &&
    performanceMetrics &&
    performanceBaseline &&
    performanceBaseline.p95 > 0
      ? Math.round(((performanceMetrics.p95 - performanceBaseline.p95) / performanceBaseline.p95) * 10000) / 100
      : undefined;
  const performanceGateFailed = Boolean(
    performanceLabUsed &&
      typeof performanceRegressionPct === "number" &&
      performanceRegressionPct > (options.performanceLab?.regressionThresholdPct ?? 20)
  );
  const performanceBaselineUpdated = Boolean(
    performanceLabUsed &&
      options.performanceLab?.autoUpdateBaseline &&
      performanceMetrics
  );
  if (performanceBaselineUpdated && performanceMetrics) {
    saveLocalStorageJson(performanceBaselineKey, performanceMetrics);
  }

  const recordedCollection = trafficRecorderUsed
    ? buildRecordedCollection(collection, results)
    : undefined;

  return {
    collectionName: collection.name,
    totalRequests: results.length,
    passedRequests: results.length - failedRequests - skippedRequests,
    failedRequests,
    skippedRequests,
    totalAssertions,
    passedAssertions,
    failedAssertions: totalAssertions - passedAssertions,
    totalDuration: Math.round(performance.now() - startTime),
    results,
    effectiveMode,
    flowOrchestratorUsed,
    contractGuardUsed,
    contractDrifts,
    contractGateFailed,
    contractBaselineUpdated,
    trafficRecorderUsed,
    recordedCollection,
    chaosUsed: chaosCases.length > 0,
    chaosLevel: options.chaos?.enabled ? options.chaos.level : "none",
    chaosCaseCount: chaosCases.length,
    performanceLabUsed,
    performanceMetrics,
    performanceBaseline,
    performanceRegressionPct,
    performanceGateFailed,
    performanceBaselineUpdated,
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
  lines.push(`  Skipped:           ${result.skippedRequests}`);
  lines.push(`  Mode:              ${result.effectiveMode}`);
  lines.push(`  Flow Orchestrator: ${result.flowOrchestratorUsed ? "on" : "off"}`);
  lines.push(`  Contract Guard:    ${result.contractGuardUsed ? "on" : "off"}`);
  lines.push(`  Contract Drifts:   ${result.contractDrifts.length}`);
  lines.push(`  Chaos Engine:      ${result.chaosUsed ? result.chaosLevel : "off"}`);
  lines.push(`  Performance Lab:   ${result.performanceLabUsed ? "on" : "off"}`);
  if (result.performanceMetrics) {
    lines.push(
      `  Latency (p50/p95/p99): ${result.performanceMetrics.p50}/${result.performanceMetrics.p95}/${result.performanceMetrics.p99}ms`
    );
  }
  if (typeof result.performanceRegressionPct === "number") {
    lines.push(`  Regression:        ${result.performanceRegressionPct}%`);
  }
  lines.push(`  Total Assertions:  ${result.totalAssertions}`);
  lines.push(`  Passed Assertions: ${result.passedAssertions}`);
  lines.push(`  Failed Assertions: ${result.failedAssertions}`);
  lines.push(`  Total Duration:    ${result.totalDuration}ms`);
  lines.push(``);

  for (const r of result.results) {
    const status = r.skipped
      ? "SKIP"
      : r.response.status === 0
        ? "ERR"
        : String(r.response.status);
    const icon = r.skipped
      ? "→"
      : r.response.status >= 200 && r.response.status < 400
        ? "✓"
        : "✗";
    const chaosLabel = r.chaosCase ? ` [chaos:${r.chaosCase}]` : "";
    lines.push(`  ${icon} [${status}] ${r.method} ${r.url} (${r.duration}ms)${chaosLabel}`);
    if (r.skipped && r.skipReason) {
      lines.push(`    ↳ ${r.skipReason}`);
    }

    for (const a of r.assertionResults) {
      const aIcon = a.passed ? "  ✓" : "  ✗";
      lines.push(`    ${aIcon} ${a.message}`);
    }
    if (r.scriptLogs?.length) {
      const errors = r.scriptLogs.filter((entry) => entry.level === "error").length;
      lines.push(`    • script logs: ${r.scriptLogs.length} (${errors} errors)`);
    }
  }

  lines.push(``);
  if (result.contractDrifts.length > 0) {
    lines.push(`Contract Drift Findings:`);
    for (const drift of result.contractDrifts) {
      lines.push(`  - ${drift.requestName}: ${drift.kind}`);
    }
    lines.push(``);
  }
  const exitCode =
    result.failedRequests === 0 &&
    result.failedAssertions === 0 &&
    !result.contractGateFailed &&
    !result.performanceGateFailed
      ? 0
      : 1;
  lines.push(`Exit Code: ${exitCode}`);

  return lines.join("\n");
}

export function generateJsonReport(result: RunnerResult): string {
  const exitCode =
    result.failedRequests === 0 &&
    result.failedAssertions === 0 &&
    !result.contractGateFailed &&
    !result.performanceGateFailed
      ? 0
      : 1;
  return JSON.stringify({
    ...result,
    exitCode,
  }, null, 2);
}
