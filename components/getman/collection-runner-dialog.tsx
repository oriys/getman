"use client";

import { useState, useRef } from "react";
import { Play, Square, Download, CheckCircle2, XCircle } from "lucide-react";
import { useGetmanStore, type Collection } from "@/lib/getman-store";
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
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<RunnerResult | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const abortRef = useRef<AbortController | null>(null);

  const selectedCollection = collections.find((c) => c.id === selectedCollectionId);

  const handleRun = async () => {
    if (!selectedCollection) return;

    setIsRunning(true);
    setResult(null);
    abortRef.current = new AbortController();

    const options: RunnerOptions = {
      mode,
      delayMs,
      iterations,
      dataSource: dataType !== "none" ? { type: dataType, content: dataContent } : undefined,
    };

    try {
      const runResult = await runCollection(
        selectedCollection,
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

          {/* Results */}
          {result && (
            <div className="flex flex-col gap-3 overflow-hidden flex-1 min-h-0">
              {/* Summary */}
              <div className="grid grid-cols-4 gap-2 text-center">
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
                <div className="rounded-lg border border-border/60 p-2">
                  <div className="text-lg font-bold text-foreground">{result.totalDuration}ms</div>
                  <div className="text-[10px] text-muted-foreground">Duration</div>
                </div>
              </div>

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
                      {r.response.status >= 200 && r.response.status < 400 ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                      )}
                      <MethodBadge method={r.method as Parameters<typeof MethodBadge>[0]["method"]} size="sm" />
                      <span className="font-mono text-foreground/80 flex-1 truncate">{r.requestName}</span>
                      <span className={`font-mono font-bold ${
                        r.response.status >= 200 && r.response.status < 400
                          ? "text-green-600"
                          : "text-red-600"
                      }`}>
                        {r.response.status || "ERR"}
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
