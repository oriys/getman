'use client';

export type BenchmarkLoadMode = "fixed_iterations" | "fixed_duration";
export type BenchmarkRunStatus = "queued" | "running" | "completed" | "cancelled" | "failed";

export interface BenchmarkRequestSnapshot {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface BenchmarkSpecPayload {
  id?: string;
  name?: string;
  target: {
    requestId?: string;
    requestSnapshot: BenchmarkRequestSnapshot;
  };
  load: {
    mode: BenchmarkLoadMode;
    iterations?: number;
    durationMs?: number;
    concurrency: number;
  };
  transport: {
    keepAlive: boolean;
    followRedirects: boolean;
    proxyUrl?: string;
    verifySsl: boolean;
  };
  timing: {
    timeoutMs: number;
    warmupDurationMs?: number;
    warmupIterations?: number;
  };
  logging: {
    sampleErrorsTopK: number;
    saveBodies: "none" | "errors";
  };
  env: {
    variablesSnapshot: Record<string, string>;
    randomSeed?: number;
  };
}

export interface BenchmarkLatencyMetrics {
  minMs: number;
  avgMs: number;
  maxMs: number;
  stddevMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface BenchmarkSummaryMetrics {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  errorRate: number;
  rpsAvg: number;
  rpsPeak: number;
  bytesIn: number;
  bytesOut: number;
  latency: BenchmarkLatencyMetrics;
  statusCodeCounts: Record<string, number>;
  errorTypeCounts: Record<string, number>;
}

export interface BenchmarkTimeseriesPoint {
  bucketTsMs: number;
  rpsSuccess: number;
  rpsError: number;
  latencyP95Ms: number;
  latencyAvgMs: number;
  bytesIn: number;
  bytesOut: number;
}

export interface BenchmarkHistogramBucket {
  lowerBoundMs: number;
  upperBoundMs: number;
  count: number;
}

export interface BenchmarkErrorSample {
  errorType: string;
  statusCode?: number;
  message: string;
  count: number;
  sampleBody?: string;
}

export interface BenchmarkAggregatedMetrics {
  summary: BenchmarkSummaryMetrics;
  timeseries: BenchmarkTimeseriesPoint[];
  histogram: BenchmarkHistogramBucket[];
  topErrors: BenchmarkErrorSample[];
}

export interface BenchmarkRunSummary {
  runId: string;
  specId: string;
  requestId?: string;
  status: BenchmarkRunStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  specHash?: string;
}

export interface BenchmarkRunDetail {
  run: BenchmarkRunSummary;
  spec: BenchmarkSpecPayload;
  environmentFingerprint: {
    os: string;
    arch: string;
    cpuCount: number;
    appVersion: string;
  };
  metrics?: BenchmarkAggregatedMetrics;
}

export interface BenchmarkStartResponse {
  runId: string;
}

export interface BenchmarkExportPayload {
  fileName: string;
  mimeType: string;
  content: string;
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    Object.prototype.hasOwnProperty.call(window, "__TAURI_INTERNALS__")
  );
}

async function invokeBenchmark<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error("Benchmark is only supported in the desktop app");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export async function startBenchmark(spec: BenchmarkSpecPayload): Promise<BenchmarkStartResponse> {
  return invokeBenchmark<BenchmarkStartResponse>("start_benchmark", { spec });
}

export async function listBenchmarkRuns(
  requestId?: string,
  limit = 50,
): Promise<BenchmarkRunSummary[]> {
  return invokeBenchmark<BenchmarkRunSummary[]>("list_benchmark_runs", {
    requestId,
    limit,
  });
}

export async function getBenchmarkRun(runId: string): Promise<BenchmarkRunDetail | null> {
  return invokeBenchmark<BenchmarkRunDetail | null>("get_benchmark_run", { runId });
}

export async function cancelBenchmarkRun(runId: string): Promise<boolean> {
  return invokeBenchmark<boolean>("cancel_benchmark_run", { runId });
}

export async function exportBenchmarkRun(
  runId: string,
  format: "json" | "csv",
): Promise<BenchmarkExportPayload> {
  return invokeBenchmark<BenchmarkExportPayload>("export_benchmark_run", { runId, format });
}

