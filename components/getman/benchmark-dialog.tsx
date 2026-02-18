"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Download, Play, Save, Square } from "lucide-react";
import {
  type CollectionFolder,
  defaultSettings,
  type RequestTab,
  resolveEnvVariables,
  useGetmanStore,
} from "@/lib/getman-store";
import {
  cancelBenchmarkRun,
  exportBenchmarkRun,
  getBenchmarkRun,
  listBenchmarkRuns,
  startBenchmark,
  type BenchmarkRunDetail,
  type BenchmarkRunSummary,
  type BenchmarkSpecPayload,
} from "@/lib/benchmark";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

const PRESET_KEY = "getman.benchmark.preset.v1";

interface TargetOption {
  id: string;
  requestId: string;
  label: string;
  tab: RequestTab;
}

interface BenchmarkPreset {
  mode: "fixed_iterations" | "fixed_duration";
  concurrency: number;
  iterations: number;
  durationSec: number;
  timeoutMs: number;
  keepAlive: boolean;
  followRedirects: boolean;
  warmupSec: number;
  sampleErrorsTopK: number;
}

interface CompareMetricRow {
  label: string;
  left: number;
  right: number;
  unit?: string;
}

function walkFolderRequests(folder: CollectionFolder): TargetOption[] {
  const current = folder.requests.map((request) => ({
    id: request.id,
    requestId: request.id,
    label: `${request.name} (${request.method})`,
    tab: request.tab,
  }));

  for (const child of folder.folders) {
    current.push(...walkFolderRequests(child));
  }
  return current;
}

function buildRequestSnapshot(tab: RequestTab) {
  const resolve = (value: string) => resolveEnvVariables(value);
  const headers: Record<string, string> = {};

  for (const header of tab.headers) {
    if (!header.enabled || !header.key) continue;
    headers[resolve(header.key)] = resolve(header.value);
  }

  if (tab.authType === "bearer" && tab.authToken) {
    headers.Authorization = `Bearer ${resolve(tab.authToken)}`;
  } else if (tab.authType === "basic" && tab.authUsername) {
    const encoded = btoa(`${resolve(tab.authUsername)}:${resolve(tab.authPassword)}`);
    headers.Authorization = `Basic ${encoded}`;
  } else if (tab.authType === "api-key" && tab.authApiAddTo === "header" && tab.authApiKey) {
    headers[resolve(tab.authApiKey)] = resolve(tab.authApiValue);
  } else if (tab.authType === "oauth2" && tab.oauth2AccessToken) {
    headers.Authorization = `Bearer ${resolve(tab.oauth2AccessToken)}`;
  }

  const cookieValues: string[] = [];
  for (const cookie of tab.cookies ?? []) {
    if (cookie.enabled && cookie.key) {
      cookieValues.push(`${resolve(cookie.key)}=${resolve(cookie.value)}`);
    }
  }
  if (cookieValues.length > 0) {
    headers.Cookie = cookieValues.join("; ");
  }

  let url = resolve(tab.url);
  try {
    const parsed = new URL(url);
    for (const param of tab.params) {
      if (!param.enabled || !param.key) continue;
      parsed.searchParams.set(resolve(param.key), resolve(param.value));
    }
    if (tab.authType === "api-key" && tab.authApiAddTo === "query" && tab.authApiKey) {
      parsed.searchParams.set(resolve(tab.authApiKey), resolve(tab.authApiValue));
    }
    url = parsed.toString();
  } catch {
    // Keep resolved URL if it cannot be parsed.
  }

  let body: string | undefined;
  if (!["GET", "HEAD", "OPTIONS"].includes(tab.method)) {
    if (tab.bodyType === "json") {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      body = resolve(tab.bodyContent);
    } else if (tab.bodyType === "raw") {
      body = resolve(tab.bodyContent);
    } else if (tab.bodyType === "x-www-form-urlencoded") {
      headers["Content-Type"] = headers["Content-Type"] || "application/x-www-form-urlencoded";
      const params = new URLSearchParams();
      for (const field of tab.bodyFormData) {
        if (field.enabled && field.key) {
          params.set(resolve(field.key), resolve(field.value));
        }
      }
      body = params.toString();
    } else if (tab.bodyType === "form-data") {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      const payload: Record<string, string> = {};
      for (const field of tab.bodyFormData) {
        if (field.enabled && field.key) {
          payload[resolve(field.key)] = resolve(field.value);
        }
      }
      body = JSON.stringify(payload);
    } else if (tab.bodyType === "graphql") {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      let variables: unknown = {};
      try {
        variables = JSON.parse(resolve(tab.graphqlVariables || "{}"));
      } catch {
        variables = {};
      }
      body = JSON.stringify({
        query: resolve(tab.graphqlQuery),
        variables,
      });
    } else if (tab.bodyType === "binary") {
      headers["Content-Type"] = headers["Content-Type"] || "application/octet-stream";
      body = tab.bodyContent;
    }
  }

  return {
    method: tab.method,
    url,
    headers,
    body,
  };
}

function formatNumber(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "0";
}

function shortRunId(runId: string): string {
  return runId.length <= 16 ? runId : `${runId.slice(0, 10)}…${runId.slice(-4)}`;
}

function buildCompareRows(left?: BenchmarkRunDetail | null, right?: BenchmarkRunDetail | null): CompareMetricRow[] {
  const leftSummary = left?.metrics?.summary;
  const rightSummary = right?.metrics?.summary;

  return [
    { label: "RPS", left: leftSummary?.rpsAvg || 0, right: rightSummary?.rpsAvg || 0 },
    { label: "Error Rate", left: leftSummary?.errorRate || 0, right: rightSummary?.errorRate || 0, unit: "%" },
    {
      label: "p95 Latency",
      left: leftSummary?.latency.p95Ms || 0,
      right: rightSummary?.latency.p95Ms || 0,
      unit: "ms",
    },
    {
      label: "p99 Latency",
      left: leftSummary?.latency.p99Ms || 0,
      right: rightSummary?.latency.p99Ms || 0,
      unit: "ms",
    },
  ];
}

export function BenchmarkDialog() {
  const store = useGetmanStore();
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [mode, setMode] = useState<"fixed_iterations" | "fixed_duration">("fixed_duration");
  const [concurrency, setConcurrency] = useState(10);
  const [iterations, setIterations] = useState(200);
  const [durationSec, setDurationSec] = useState(30);
  const [timeoutMs, setTimeoutMs] = useState(10000);
  const [keepAlive, setKeepAlive] = useState(true);
  const [followRedirects, setFollowRedirects] = useState(true);
  const [warmupSec, setWarmupSec] = useState(3);
  const [sampleErrorsTopK, setSampleErrorsTopK] = useState(10);
  const [isRunning, setIsRunning] = useState(false);
  const [runningRunId, setRunningRunId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<BenchmarkRunDetail | null>(null);
  const [runHistory, setRunHistory] = useState<BenchmarkRunSummary[]>([]);
  const [compareLeftId, setCompareLeftId] = useState("");
  const [compareRightId, setCompareRightId] = useState("");
  const [compareLeftRun, setCompareLeftRun] = useState<BenchmarkRunDetail | null>(null);
  const [compareRightRun, setCompareRightRun] = useState<BenchmarkRunDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const pollTokenRef = useRef<string | null>(null);

  const targetOptions = useMemo<TargetOption[]>(() => {
    const options: TargetOption[] = [];
    const activeTab = store.tabs.find((tab) => tab.id === store.activeTabId);
    if (activeTab) {
      options.push({
        id: `tab:${activeTab.id}`,
        requestId: activeTab.id,
        label: `Active Tab · ${activeTab.name} (${activeTab.method})`,
        tab: activeTab,
      });
    }

    for (const collection of store.collections) {
      for (const request of collection.requests) {
        options.push({
          id: `saved:${request.id}`,
          requestId: request.id,
          label: `${collection.name} · ${request.name} (${request.method})`,
          tab: request.tab,
        });
      }
      for (const folder of collection.folders) {
        for (const request of walkFolderRequests(folder)) {
          options.push({
            ...request,
            id: `saved:${request.id}`,
            label: `${collection.name} · ${request.label}`,
          });
        }
      }
    }
    return options;
  }, [store.activeTabId, store.collections, store.tabs]);

  const selectedTarget = targetOptions.find((option) => option.id === selectedTargetId) || null;

  useEffect(() => {
    if (!selectedTargetId && targetOptions.length > 0) {
      setSelectedTargetId(targetOptions[0].id);
    }
  }, [selectedTargetId, targetOptions]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PRESET_KEY);
      if (!raw) return;
      const preset = JSON.parse(raw) as Partial<BenchmarkPreset>;
      if (preset.mode === "fixed_duration" || preset.mode === "fixed_iterations") setMode(preset.mode);
      if (typeof preset.concurrency === "number") setConcurrency(Math.max(1, preset.concurrency));
      if (typeof preset.iterations === "number") setIterations(Math.max(1, preset.iterations));
      if (typeof preset.durationSec === "number") setDurationSec(Math.max(1, preset.durationSec));
      if (typeof preset.timeoutMs === "number") setTimeoutMs(Math.max(100, preset.timeoutMs));
      if (typeof preset.keepAlive === "boolean") setKeepAlive(preset.keepAlive);
      if (typeof preset.followRedirects === "boolean") setFollowRedirects(preset.followRedirects);
      if (typeof preset.warmupSec === "number") setWarmupSec(Math.max(0, preset.warmupSec));
      if (typeof preset.sampleErrorsTopK === "number") {
        setSampleErrorsTopK(Math.max(1, preset.sampleErrorsTopK));
      }
    } catch {
      // Ignore malformed presets.
    }
  }, []);

  const refreshHistory = async (requestId?: string) => {
    if (!requestId) {
      setRunHistory([]);
      return;
    }
    try {
      const runs = await listBenchmarkRuns(requestId, 50);
      setRunHistory(runs);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load benchmark history");
    }
  };

  useEffect(() => {
    void refreshHistory(selectedTarget?.requestId);
  }, [selectedTarget?.requestId]);

  useEffect(() => {
    if (!compareLeftId) {
      setCompareLeftRun(null);
      return;
    }
    void getBenchmarkRun(compareLeftId).then(setCompareLeftRun).catch(() => setCompareLeftRun(null));
  }, [compareLeftId]);

  useEffect(() => {
    if (!compareRightId) {
      setCompareRightRun(null);
      return;
    }
    void getBenchmarkRun(compareRightId).then(setCompareRightRun).catch(() => setCompareRightRun(null));
  }, [compareRightId]);

  const handleSavePreset = () => {
    if (typeof window === "undefined") return;
    const preset: BenchmarkPreset = {
      mode,
      concurrency,
      iterations,
      durationSec,
      timeoutMs,
      keepAlive,
      followRedirects,
      warmupSec,
      sampleErrorsTopK,
    };
    window.localStorage.setItem(PRESET_KEY, JSON.stringify(preset));
  };

  const buildSpec = (): BenchmarkSpecPayload | null => {
    if (!selectedTarget) return null;
    const variablesSnapshot: Record<string, string> = {};
    const requestSettings = selectedTarget.tab.settings || defaultSettings();

    for (const variable of store.globalVariables) {
      if (variable.enabled && variable.key) {
        variablesSnapshot[variable.key] = variable.value;
      }
    }
    if (store.activeEnvironmentId) {
      const activeEnv = store.environments.find((env) => env.id === store.activeEnvironmentId);
      if (activeEnv) {
        for (const variable of activeEnv.variables) {
          if (variable.enabled && variable.key) {
            variablesSnapshot[variable.key] = variable.value;
          }
        }
      }
    }

    return {
      target: {
        requestId: selectedTarget.requestId,
        requestSnapshot: buildRequestSnapshot(selectedTarget.tab),
      },
      load: {
        mode,
        concurrency: Math.max(1, concurrency),
        iterations: mode === "fixed_iterations" ? Math.max(1, iterations) : undefined,
        durationMs: mode === "fixed_duration" ? Math.max(1, durationSec) * 1000 : undefined,
      },
      transport: {
        keepAlive,
        followRedirects,
        proxyUrl: requestSettings.proxyUrl || undefined,
        verifySsl: requestSettings.verifySsl,
      },
      timing: {
        timeoutMs: Math.max(100, timeoutMs),
        warmupDurationMs: warmupSec > 0 ? warmupSec * 1000 : undefined,
      },
      logging: {
        sampleErrorsTopK: Math.max(1, sampleErrorsTopK),
        saveBodies: "errors",
      },
      env: {
        variablesSnapshot,
      },
    };
  };

  const pollRun = async (runId: string, requestId?: string) => {
    pollTokenRef.current = runId;
    setIsRunning(true);
    setRunningRunId(runId);

    while (pollTokenRef.current === runId) {
      try {
        const detail = await getBenchmarkRun(runId);
        if (detail) {
          setActiveRun(detail);
          if (["completed", "failed", "cancelled"].includes(detail.run.status)) {
            setIsRunning(false);
            setRunningRunId(null);
            pollTokenRef.current = null;
            await refreshHistory(requestId);
            return;
          }
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Failed to fetch benchmark run");
        setIsRunning(false);
        setRunningRunId(null);
        pollTokenRef.current = null;
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  };

  const handleRun = async () => {
    const spec = buildSpec();
    if (!spec) return;
    setErrorMessage("");
    setActiveRun(null);
    setCompareLeftId("");
    setCompareRightId("");

    try {
      const started = await startBenchmark(spec);
      void pollRun(started.runId, spec.target.requestId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to start benchmark");
      setIsRunning(false);
      setRunningRunId(null);
      pollTokenRef.current = null;
    }
  };

  const handleStop = async () => {
    if (!runningRunId) return;
    try {
      await cancelBenchmarkRun(runningRunId);
    } finally {
      pollTokenRef.current = null;
      setIsRunning(false);
      setRunningRunId(null);
    }
  };

  const handleRunClick = async (runId: string) => {
    setErrorMessage("");
    try {
      const detail = await getBenchmarkRun(runId);
      if (detail) setActiveRun(detail);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load benchmark run detail");
    }
  };

  const handleExport = async (format: "json" | "csv") => {
    if (!activeRun) return;
    try {
      const exported = await exportBenchmarkRun(activeRun.run.runId, format);
      const blob = new Blob([exported.content], { type: exported.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exported.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to export benchmark run");
    }
  };

  const summary = activeRun?.metrics?.summary;
  const compareRows = buildCompareRows(compareLeftRun, compareRightRun);
  const maxHistogramCount = Math.max(
    1,
    ...(activeRun?.metrics?.histogram.map((bucket) => bucket.count) || [1]),
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
        >
          <BarChart3 className="h-3 w-3" />
          Benchmark
        </button>
      </DialogTrigger>
      <DialogContent className="bg-[hsl(var(--surface-1))] border-border sm:max-w-[920px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-foreground text-sm">Request Benchmark</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">Target Request</label>
            <Select value={selectedTargetId} onValueChange={setSelectedTargetId}>
              <SelectTrigger className="h-8 border-border bg-[hsl(var(--surface-2))] text-xs">
                <SelectValue placeholder="Select request to benchmark" />
              </SelectTrigger>
              <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                {targetOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id} className="text-xs">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">Mode</label>
            <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
              <SelectTrigger className="h-8 border-border bg-[hsl(var(--surface-2))] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                <SelectItem value="fixed_duration" className="text-xs">Fixed Duration</SelectItem>
                <SelectItem value="fixed_iterations" className="text-xs">Fixed Iterations</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">Concurrency</label>
            <input
              type="number"
              min={1}
              value={concurrency}
              onChange={(event) => setConcurrency(Math.max(1, Number(event.target.value) || 1))}
              className="h-8 rounded border border-border bg-[hsl(var(--surface-2))] px-2 font-mono text-xs text-foreground outline-none focus:border-primary/50"
            />
          </div>

          {mode === "fixed_duration" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Duration (sec)</label>
              <input
                type="number"
                min={1}
                value={durationSec}
                onChange={(event) => setDurationSec(Math.max(1, Number(event.target.value) || 1))}
                className="h-8 rounded border border-border bg-[hsl(var(--surface-2))] px-2 font-mono text-xs text-foreground outline-none focus:border-primary/50"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Iterations</label>
              <input
                type="number"
                min={1}
                value={iterations}
                onChange={(event) => setIterations(Math.max(1, Number(event.target.value) || 1))}
                className="h-8 rounded border border-border bg-[hsl(var(--surface-2))] px-2 font-mono text-xs text-foreground outline-none focus:border-primary/50"
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">Timeout (ms)</label>
            <input
              type="number"
              min={100}
              value={timeoutMs}
              onChange={(event) => setTimeoutMs(Math.max(100, Number(event.target.value) || 100))}
              className="h-8 rounded border border-border bg-[hsl(var(--surface-2))] px-2 font-mono text-xs text-foreground outline-none focus:border-primary/50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">Warm-up (sec)</label>
            <input
              type="number"
              min={0}
              value={warmupSec}
              onChange={(event) => setWarmupSec(Math.max(0, Number(event.target.value) || 0))}
              className="h-8 rounded border border-border bg-[hsl(var(--surface-2))] px-2 font-mono text-xs text-foreground outline-none focus:border-primary/50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">Top Errors</label>
            <input
              type="number"
              min={1}
              value={sampleErrorsTopK}
              onChange={(event) =>
                setSampleErrorsTopK(Math.max(1, Number(event.target.value) || 1))
              }
              className="h-8 rounded border border-border bg-[hsl(var(--surface-2))] px-2 font-mono text-xs text-foreground outline-none focus:border-primary/50"
            />
          </div>

          <div className="col-span-2 rounded border border-border/70 bg-[hsl(var(--surface-2))] px-3 py-2">
            <div className="flex items-center gap-4 text-[11px]">
              <label className="flex items-center gap-2 text-foreground">
                <input
                  type="checkbox"
                  checked={keepAlive}
                  onChange={(event) => setKeepAlive(event.target.checked)}
                />
                Keep-Alive
              </label>
              <label className="flex items-center gap-2 text-foreground">
                <input
                  type="checkbox"
                  checked={followRedirects}
                  onChange={(event) => setFollowRedirects(event.target.checked)}
                />
                Follow Redirects
              </label>
              <button
                type="button"
                onClick={handleSavePreset}
                className="ml-auto inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Save className="h-3 w-3" />
                Save Preset
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          {isRunning ? (
            <button
              type="button"
              onClick={handleStop}
              className="flex items-center gap-1.5 bg-destructive text-destructive-foreground text-xs font-medium px-4 py-2 rounded hover:bg-destructive/90 transition-colors"
            >
              <Square className="h-3 w-3" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRun}
              disabled={!selectedTarget}
              className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-medium px-4 py-2 rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Play className="h-3 w-3" />
              Run Benchmark
            </button>
          )}

          {runningRunId && (
            <span className="text-xs text-muted-foreground font-mono">Running: {shortRunId(runningRunId)}</span>
          )}

          {activeRun && (
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleExport("json")}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Download className="h-3 w-3" />
                JSON
              </button>
              <button
                type="button"
                onClick={() => handleExport("csv")}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Download className="h-3 w-3" />
                CSV
              </button>
            </div>
          )}
        </div>

        {errorMessage && <div className="text-[11px] text-red-500">{errorMessage}</div>}

        <div className="grid grid-cols-3 gap-3 min-h-0 flex-1 overflow-hidden">
          <div className="col-span-2 flex flex-col gap-3 min-h-0 overflow-hidden">
            {summary && (
              <div className="grid grid-cols-4 gap-2">
                <div className="rounded-lg border border-border/70 p-2 text-center">
                  <div className="text-base font-semibold">{summary.totalRequests}</div>
                  <div className="text-[10px] text-muted-foreground">Total</div>
                </div>
                <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-2 text-center">
                  <div className="text-base font-semibold text-green-600">{summary.successCount}</div>
                  <div className="text-[10px] text-muted-foreground">Success</div>
                </div>
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-center">
                  <div className="text-base font-semibold text-red-600">{summary.errorCount}</div>
                  <div className="text-[10px] text-muted-foreground">Errors</div>
                </div>
                <div className="rounded-lg border border-border/70 p-2 text-center">
                  <div className="text-base font-semibold">{formatNumber(summary.errorRate)}%</div>
                  <div className="text-[10px] text-muted-foreground">Error Rate</div>
                </div>
                <div className="rounded-lg border border-border/70 p-2 text-center">
                  <div className="text-base font-semibold">{formatNumber(summary.rpsAvg)}</div>
                  <div className="text-[10px] text-muted-foreground">RPS</div>
                </div>
                <div className="rounded-lg border border-border/70 p-2 text-center">
                  <div className="text-base font-semibold">{formatNumber(summary.latency.p95Ms)}</div>
                  <div className="text-[10px] text-muted-foreground">p95 (ms)</div>
                </div>
                <div className="rounded-lg border border-border/70 p-2 text-center">
                  <div className="text-base font-semibold">{formatNumber(summary.latency.p99Ms)}</div>
                  <div className="text-[10px] text-muted-foreground">p99 (ms)</div>
                </div>
                <div className="rounded-lg border border-border/70 p-2 text-center">
                  <div className="text-base font-semibold">{summary.bytesIn + summary.bytesOut}</div>
                  <div className="text-[10px] text-muted-foreground">Bytes I/O</div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 min-h-0 overflow-hidden">
              <div className="rounded border border-border/70 bg-[hsl(var(--surface-2))] p-2 min-h-0 overflow-hidden">
                <div className="text-[11px] font-medium text-muted-foreground mb-2">Top Errors</div>
                <ScrollArea className="h-[170px]">
                  <div className="space-y-1">
                    {(activeRun?.metrics?.topErrors || []).map((item, index) => (
                      <div key={`${item.errorType}-${index}`} className="rounded border border-border/60 px-2 py-1">
                        <div className="text-[11px] font-mono text-red-500">{item.errorType} · {item.count}</div>
                        <div className="text-[10px] text-muted-foreground break-words">{item.message}</div>
                      </div>
                    ))}
                    {(activeRun?.metrics?.topErrors || []).length === 0 && (
                      <div className="text-[10px] text-muted-foreground">No errors sampled.</div>
                    )}
                  </div>
                </ScrollArea>
              </div>

              <div className="rounded border border-border/70 bg-[hsl(var(--surface-2))] p-2 min-h-0 overflow-hidden">
                <div className="text-[11px] font-medium text-muted-foreground mb-2">Latency Histogram</div>
                <ScrollArea className="h-[170px]">
                  <div className="space-y-1">
                    {(activeRun?.metrics?.histogram || []).map((bucket) => (
                      <div key={`${bucket.lowerBoundMs}-${bucket.upperBoundMs}`} className="space-y-0.5">
                        <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                          <span>{bucket.lowerBoundMs}-{bucket.upperBoundMs}ms</span>
                          <span>{bucket.count}</span>
                        </div>
                        <div className="h-1.5 rounded bg-border/50 overflow-hidden">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${Math.max(2, (bucket.count / maxHistogramCount) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    {(activeRun?.metrics?.histogram || []).length === 0 && (
                      <div className="text-[10px] text-muted-foreground">No histogram data.</div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>

            <div className="rounded border border-border/70 bg-[hsl(var(--surface-2))] p-2">
              <div className="text-[11px] font-medium text-muted-foreground mb-2">Compare Runs</div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <Select value={compareLeftId} onValueChange={setCompareLeftId}>
                  <SelectTrigger className="h-8 border-border bg-[hsl(var(--surface-1))] text-xs">
                    <SelectValue placeholder="Select baseline run" />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                    {runHistory.map((run) => (
                      <SelectItem key={`left-${run.runId}`} value={run.runId} className="text-xs">
                        {shortRunId(run.runId)} · {run.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={compareRightId} onValueChange={setCompareRightId}>
                  <SelectTrigger className="h-8 border-border bg-[hsl(var(--surface-1))] text-xs">
                    <SelectValue placeholder="Select comparison run" />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                    {runHistory.map((run) => (
                      <SelectItem key={`right-${run.runId}`} value={run.runId} className="text-xs">
                        {shortRunId(run.runId)} · {run.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {compareLeftRun && compareRightRun && (
                <div className="space-y-1">
                  {compareRows.map((row) => {
                    const delta = row.right - row.left;
                    const deltaClass =
                      row.label.includes("Latency") || row.label.includes("Error")
                        ? delta <= 0
                          ? "text-green-600"
                          : "text-red-600"
                        : delta >= 0
                          ? "text-green-600"
                          : "text-red-600";
                    return (
                      <div key={row.label} className="grid grid-cols-4 gap-2 text-[11px] font-mono">
                        <span className="text-muted-foreground">{row.label}</span>
                        <span>{formatNumber(row.left)}{row.unit || ""}</span>
                        <span>{formatNumber(row.right)}{row.unit || ""}</span>
                        <span className={deltaClass}>
                          {delta >= 0 ? "+" : ""}{formatNumber(delta)}{row.unit || ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="rounded border border-border/70 bg-[hsl(var(--surface-2))] p-2 min-h-0 overflow-hidden">
            <div className="text-[11px] font-medium text-muted-foreground mb-2">Run History</div>
            <ScrollArea className="h-full">
              <div className="space-y-1">
                {runHistory.map((run) => (
                  <button
                    key={run.runId}
                    type="button"
                    onClick={() => void handleRunClick(run.runId)}
                    className={`w-full rounded border px-2 py-1.5 text-left text-[11px] transition-colors ${
                      activeRun?.run.runId === run.runId
                        ? "border-primary/50 bg-primary/5"
                        : "border-border/60 hover:bg-[hsl(var(--surface-1))]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono">{shortRunId(run.runId)}</span>
                      <span className="text-[10px] text-muted-foreground">{run.status}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(run.createdAt).toLocaleString()}
                    </div>
                  </button>
                ))}
                {runHistory.length === 0 && (
                  <div className="text-[10px] text-muted-foreground">No benchmark runs yet.</div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
