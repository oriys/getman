"use client";

import { useState, useRef } from "react";
import { Play, Square, Download, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { useGetmanStore, importCollections, type Collection } from "@/lib/getman-store";
import { runCollection, generateTextReport, generateJsonReport, type RunnerOptions, type RunnerResult, type RunnerRequestResult } from "@/lib/runner";
import { MethodBadge } from "./method-badge";
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

export function CollectionRunnerDialog() {
  const { collections } = useGetmanStore();
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [mode, setMode] = useState<"serial" | "parallel">("serial");
  const [delayMs, setDelayMs] = useState(0);
  const [iterations, setIterations] = useState(1);
  const [dataType, setDataType] = useState<"none" | "csv" | "json">("none");
  const [dataContent, setDataContent] = useState("");
  const [contractGuardEnabled, setContractGuardEnabled] = useState(false);
  const [contractBreakOnDrift, setContractBreakOnDrift] = useState(false);
  const [contractAutoUpdateBaseline, setContractAutoUpdateBaseline] = useState(false);
  const [trafficRecorderEnabled, setTrafficRecorderEnabled] = useState(false);
  const [chaosLevel, setChaosLevel] = useState<"none" | "light" | "aggressive">("none");
  const [performanceLabEnabled, setPerformanceLabEnabled] = useState(false);
  const [performanceThresholdPct, setPerformanceThresholdPct] = useState(20);
  const [performanceAutoUpdateBaseline, setPerformanceAutoUpdateBaseline] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<RunnerResult | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [actionMessage, setActionMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const selectedCollection = collections.find((c) => c.id === selectedCollectionId);

  const buildOptions = (): RunnerOptions => ({
    mode,
    delayMs,
    iterations,
    dataSource: dataType !== "none" ? { type: dataType, content: dataContent } : undefined,
    contractGuard: {
      enabled: contractGuardEnabled,
      breakOnDrift: contractBreakOnDrift,
      autoUpdateBaseline: contractAutoUpdateBaseline,
    },
    trafficRecorder: {
      enabled: trafficRecorderEnabled,
    },
    chaos: chaosLevel === "none"
      ? { enabled: false, level: "light" }
      : { enabled: true, level: chaosLevel },
    performanceLab: {
      enabled: performanceLabEnabled,
      regressionThresholdPct: performanceThresholdPct,
      autoUpdateBaseline: performanceAutoUpdateBaseline,
    },
  });

  const runWithCollection = async (collectionToRun: Collection) => {
    setIsRunning(true);
    setResult(null);
    setActionMessage("");
    setProgress({ current: 0, total: 0 });
    abortRef.current = new AbortController();
    const options = buildOptions();

    try {
      const runResult = await runCollection(
        collectionToRun,
        options,
        (current, total) => {
          setProgress({ current, total });
        },
        abortRef.current.signal
      );
      setResult(runResult);
    } catch {
      // cancelled or error
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  const handleRun = async () => {
    if (!selectedCollection) return;
    await runWithCollection(selectedCollection);
  };

  const handleReplay = async () => {
    if (isRunning) return;
    if (result?.recordedCollection) {
      await runWithCollection(result.recordedCollection);
      return;
    }
    if (selectedCollection) {
      await runWithCollection(selectedCollection);
    }
  };

  const handleSaveRecordedCollection = () => {
    if (!result?.recordedCollection) return;
    importCollections([result.recordedCollection]);
    setActionMessage(`Saved "${result.recordedCollection.name}" to Collections`);
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleExport = (format: "text" | "json") => {
    if (!result) return;
    const content = format === "json" ? generateJsonReport(result) : generateTextReport(result);
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `runner-report-${result.collectionName}.${format === "json" ? "json" : "txt"}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
        >
          <Play className="h-3 w-3" />
          Runner
        </button>
      </DialogTrigger>
      <DialogContent className="bg-[hsl(var(--surface-1))] border-border sm:max-w-[700px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-foreground text-sm">Collection Runner</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-hidden flex-1">
          {/* Configuration */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-[11px] font-medium text-muted-foreground">Collection</label>
              <Select value={selectedCollectionId} onValueChange={setSelectedCollectionId}>
                <SelectTrigger className="h-8 border-border bg-[hsl(var(--surface-2))] text-xs">
                  <SelectValue placeholder="Select a collection" />
                </SelectTrigger>
                <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                  {collections.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.name} ({c.requests.length + c.folders.reduce((s, f) => s + f.requests.length, 0)} requests)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Mode</label>
              <Select value={mode} onValueChange={(v) => setMode(v as "serial" | "parallel")}>
                <SelectTrigger className="h-8 border-border bg-[hsl(var(--surface-2))] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                  <SelectItem value="serial" className="text-xs">Serial</SelectItem>
                  <SelectItem value="parallel" className="text-xs">Parallel</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Delay (ms)</label>
              <input
                type="number"
                className="h-8 rounded border border-border bg-[hsl(var(--surface-2))] px-2 font-mono text-xs text-foreground outline-none focus:border-primary/50"
                value={delayMs}
                onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value)))}
                min={0}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Iterations</label>
              <input
                type="number"
                className="h-8 rounded border border-border bg-[hsl(var(--surface-2))] px-2 font-mono text-xs text-foreground outline-none focus:border-primary/50"
                value={iterations}
                onChange={(e) => setIterations(Math.max(1, Number(e.target.value)))}
                min={1}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Data Source</label>
              <Select value={dataType} onValueChange={(v) => setDataType(v as "none" | "csv" | "json")}>
                <SelectTrigger className="h-8 border-border bg-[hsl(var(--surface-2))] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                  <SelectItem value="none" className="text-xs">None</SelectItem>
                  <SelectItem value="csv" className="text-xs">CSV</SelectItem>
                  <SelectItem value="json" className="text-xs">JSON</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 rounded border border-border/60 bg-[hsl(var(--surface-2))] p-3">
              <div className="text-[11px] font-medium text-muted-foreground mb-2">vNext Engines</div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <label className="flex items-center gap-2 text-foreground">
                  <input
                    type="checkbox"
                    checked={contractGuardEnabled}
                    onChange={(e) => setContractGuardEnabled(e.target.checked)}
                  />
                  Contract Drift Guard
                </label>
                <label className="flex items-center gap-2 text-foreground">
                  <input
                    type="checkbox"
                    checked={trafficRecorderEnabled}
                    onChange={(e) => setTrafficRecorderEnabled(e.target.checked)}
                  />
                  Traffic Recorder
                </label>
                <label className="flex items-center gap-2 text-foreground">
                  <input
                    type="checkbox"
                    checked={performanceLabEnabled}
                    onChange={(e) => setPerformanceLabEnabled(e.target.checked)}
                  />
                  Performance Lab
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Chaos</span>
                  <Select value={chaosLevel} onValueChange={(v) => setChaosLevel(v as "none" | "light" | "aggressive")}>
                    <SelectTrigger className="h-7 border-border bg-[hsl(var(--surface-1))] text-[11px] w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                      <SelectItem value="none" className="text-xs">Off</SelectItem>
                      <SelectItem value="light" className="text-xs">Light</SelectItem>
                      <SelectItem value="aggressive" className="text-xs">Aggressive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {contractGuardEnabled && (
                <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={contractBreakOnDrift}
                      onChange={(e) => setContractBreakOnDrift(e.target.checked)}
                    />
                    break on drift
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={contractAutoUpdateBaseline}
                      onChange={(e) => setContractAutoUpdateBaseline(e.target.checked)}
                    />
                    update baseline after run
                  </label>
                </div>
              )}

              {performanceLabEnabled && (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                  <label className="flex items-center gap-1.5">
                    regression threshold %
                    <input
                      type="number"
                      className="h-7 w-16 rounded border border-border bg-[hsl(var(--surface-1))] px-2 font-mono text-[11px] text-foreground outline-none focus:border-primary/50"
                      value={performanceThresholdPct}
                      onChange={(e) => setPerformanceThresholdPct(Math.max(1, Number(e.target.value) || 20))}
                      min={1}
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={performanceAutoUpdateBaseline}
                      onChange={(e) => setPerformanceAutoUpdateBaseline(e.target.checked)}
                    />
                    update baseline after run
                  </label>
                </div>
              )}
            </div>
          </div>

          {dataType !== "none" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">
                Data ({dataType.toUpperCase()})
              </label>
              <textarea
                className="h-20 rounded border border-border bg-[hsl(var(--surface-2))] px-3 py-2 font-mono text-[11px] text-foreground outline-none resize-none placeholder:text-muted-foreground/40 focus:border-primary/50"
                placeholder={
                  dataType === "csv"
                    ? "name,email\nJohn,john@example.com\nJane,jane@example.com"
                    : '[{"name":"John","email":"john@example.com"}]'
                }
                value={dataContent}
                onChange={(e) => setDataContent(e.target.value)}
              />
            </div>
          )}

          {/* Run/Stop buttons */}
          <div className="flex items-center gap-2">
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
                disabled={!selectedCollection}
                className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-medium px-4 py-2 rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Play className="h-3 w-3" />
                Run Collection
              </button>
            )}

            {isRunning && (
              <span className="text-xs text-muted-foreground">
                {progress.current}/{progress.total} requests...
              </span>
            )}

            {result && !isRunning && (
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={handleReplay}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Play className="h-3 w-3" />
                  Replay
                </button>
                {result.recordedCollection && (
                  <button
                    type="button"
                    onClick={handleSaveRecordedCollection}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Download className="h-3 w-3" />
                    Save Recorded
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleExport("text")}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Download className="h-3 w-3" />
                  Text Report
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("json")}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Download className="h-3 w-3" />
                  JSON Report
                </button>
              </div>
            )}
          </div>

          {actionMessage && (
            <div className="text-[11px] text-emerald-500">{actionMessage}</div>
          )}

          {/* Results */}
          {result && (
            <div className="flex flex-col gap-3 overflow-hidden flex-1 min-h-0">
              {/* Summary */}
               <div className="grid grid-cols-5 gap-2 text-center">
                 <div className="rounded-lg border border-border/60 p-2">
                   <div className="text-lg font-bold text-foreground">{result.totalRequests}</div>
                   <div className="text-[10px] text-muted-foreground">Total</div>
                </div>
                <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-2">
                  <div className="text-lg font-bold text-green-600">{result.passedRequests}</div>
                  <div className="text-[10px] text-muted-foreground">Passed</div>
                </div>
                 <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2">
                   <div className="text-lg font-bold text-red-600">{result.failedRequests}</div>
                   <div className="text-[10px] text-muted-foreground">Failed</div>
                 </div>
                 <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
                   <div className="text-lg font-bold text-amber-600">{result.skippedRequests}</div>
                   <div className="text-[10px] text-muted-foreground">Skipped</div>
                 </div>
                 <div className="rounded-lg border border-border/60 p-2">
                   <div className="text-lg font-bold text-foreground">{result.totalDuration}ms</div>
                   <div className="text-[10px] text-muted-foreground">Duration</div>
                 </div>
               </div>

               {result.flowOrchestratorUsed && (
                 <div className="text-[10px] text-center text-muted-foreground">
                   Flow orchestrator active • mode: {result.effectiveMode}
                 </div>
               )}

               {result.contractGuardUsed && (
                 <div className={`text-[10px] text-center ${result.contractGateFailed ? "text-red-500" : "text-muted-foreground"}`}>
                   Contract drift: {result.contractDrifts.length}
                   {result.contractBaselineUpdated ? " • baseline updated" : ""}
                   {result.contractGateFailed ? " • gate failed" : ""}
                 </div>
               )}

               {result.chaosUsed && (
                 <div className="text-[10px] text-center text-muted-foreground">
                   Chaos profile: {result.chaosLevel} ({result.chaosCaseCount} cases/request)
                 </div>
               )}

               {result.performanceLabUsed && (
                 <div className={`text-[10px] text-center ${result.performanceGateFailed ? "text-red-500" : "text-muted-foreground"}`}>
                   Perf p50/p95/p99: {result.performanceMetrics?.p50 ?? "-"} / {result.performanceMetrics?.p95 ?? "-"} / {result.performanceMetrics?.p99 ?? "-"} ms
                   {typeof result.performanceRegressionPct === "number" ? ` • regression ${result.performanceRegressionPct}%` : ""}
                   {result.performanceBaselineUpdated ? " • baseline updated" : ""}
                 </div>
               )}

               {result.trafficRecorderUsed && result.recordedCollection && (
                 <div className="text-[10px] text-center text-muted-foreground">
                   Traffic recorded: {result.recordedCollection.requests.length} requests
                 </div>
               )}

              {result.totalAssertions > 0 && (
                <div className="text-xs text-muted-foreground text-center">
                  Assertions: {result.passedAssertions}/{result.totalAssertions} passed
                </div>
              )}

              {/* Request list */}
              <ScrollArea className="flex-1 min-h-0">
                <div className="flex flex-col gap-1">
                  {result.results.map((r, i) => (
                    <div
                      key={`${r.requestId}-${i}`}
                      className="flex items-center gap-2 rounded px-3 py-2 hover:bg-[hsl(var(--surface-2))] text-xs"
                    >
                       {r.skipped ? (
                         <MinusCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                       ) : r.response.status >= 200 && r.response.status < 400 ? (
                         <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                       ) : (
                         <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                       )}
                       <MethodBadge method={r.method as Parameters<typeof MethodBadge>[0]["method"]} size="sm" />
                       <span className="font-mono text-foreground/80 flex-1 truncate">{r.requestName}</span>
                       {r.chaosCase && (
                         <span className="text-[10px] text-purple-400 bg-purple-400/10 rounded px-1 py-0.5">
                           {r.chaosCase}
                         </span>
                       )}
                        <span className={`font-mono font-bold ${
                          r.skipped
                            ? "text-amber-600"
                            : r.response.status >= 200 && r.response.status < 400
                             ? "text-green-600"
                             : "text-red-600"
                       }`}>
                         {r.skipped ? "SKIP" : r.response.status || "ERR"}
                       </span>
                      <span className="text-muted-foreground font-mono">{r.duration}ms</span>
                      {r.assertionResults.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          {r.assertionResults.filter((a) => a.passed).length}/{r.assertionResults.length}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
