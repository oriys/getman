"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Copy, Check, Search, X, Download, AlertTriangle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGetmanStore, type ResponseData, type GrpcResponseData } from "@/lib/getman-store";

function StatusBadge({ status }: { status: number }) {
  let color = "text-muted-foreground bg-muted";
  if (status >= 200 && status < 300) color = "text-[hsl(var(--method-get))] bg-[hsl(var(--method-get)/.12)]";
  else if (status >= 300 && status < 400) color = "text-[hsl(var(--method-put))] bg-[hsl(var(--method-put)/.12)]";
  else if (status >= 400 && status < 500) color = "text-[hsl(var(--method-post))] bg-[hsl(var(--method-post)/.12)]";
  else if (status >= 500) color = "text-[hsl(var(--method-delete))] bg-[hsl(var(--method-delete)/.12)]";

  return (
    <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${color}`}>
      {status}
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function SyntaxHighlightedJSON({ json }: { json: string }) {
  const highlighted = useMemo(() => {
    try {
      const parsed = JSON.parse(json);
      const pretty = JSON.stringify(parsed, null, 2);
      return pretty
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(
          /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?)/g,
          (match) => {
            if (match.endsWith(":")) {
              return `<span class="json-key">${match}</span>`;
            }
            return `<span class="json-string">${match}</span>`;
          }
        )
        .replace(/\b(-?\d+\.?\d*([eE][+-]?\d+)?)\b/g, '<span class="json-number">$1</span>')
        .replace(/\b(true|false)\b/g, '<span class="json-boolean">$1</span>')
        .replace(/\bnull\b/g, '<span class="json-null">null</span>');
    } catch {
      return json;
    }
  }, [json]);

  return (
    <pre
      className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-all"
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="text-muted-foreground hover:text-foreground transition-colors p-1"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function ResponseBodySearch({ body, onSearch }: { body: string; onSearch: (query: string) => void }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const matchCount = useMemo(() => {
    if (!searchQuery) return 0;
    return body.toLowerCase().split(searchQuery.toLowerCase()).length - 1;
  }, [body, searchQuery]);

  if (!searchOpen) {
    return (
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="text-muted-foreground hover:text-foreground transition-colors p-1"
        title="Search response body"
      >
        <Search className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 bg-[hsl(var(--surface-2))] rounded px-2 py-0.5">
      <Search className="h-3 w-3 text-muted-foreground shrink-0" />
      <input
        className="w-28 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
        placeholder="Search..."
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
          onSearch(e.target.value);
        }}
        autoFocus
      />
      {searchQuery && (
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {matchCount} found
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          setSearchOpen(false);
          setSearchQuery("");
          onSearch("");
        }}
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function HighlightedText({ text, search }: { text: string; search: string }) {
  if (!search) {
    return (
      <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-all text-foreground">
        {text}
      </pre>
    );
  }

  const parts: { text: string; highlight: boolean }[] = [];
  const lower = text.toLowerCase();
  const searchLower = search.toLowerCase();
  let lastIndex = 0;

  let idx = lower.indexOf(searchLower, lastIndex);
  while (idx !== -1) {
    if (idx > lastIndex) {
      parts.push({ text: text.slice(lastIndex, idx), highlight: false });
    }
    parts.push({ text: text.slice(idx, idx + search.length), highlight: true });
    lastIndex = idx + search.length;
    idx = lower.indexOf(searchLower, lastIndex);
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), highlight: false });
  }

  return (
    <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-all text-foreground">
      {parts.map((part, i) =>
        part.highlight ? (
          <mark key={i} className="bg-primary/30 text-foreground rounded-sm px-0.5">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </pre>
  );
}

// ─── Large Response Virtual Rendering ────────────────────────────────────────

const LARGE_RESPONSE_THRESHOLD_BYTES = 500_000; // 500KB
const VIRTUAL_LINE_HEIGHT = 18;
const VIRTUAL_OVERSCAN = 20;

function VirtualizedText({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  const lines = useMemo(() => text.split("\n"), [text]);
  const totalHeight = lines.length * VIRTUAL_LINE_HEIGHT;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const startIdx = Math.max(0, Math.floor(scrollTop / VIRTUAL_LINE_HEIGHT) - VIRTUAL_OVERSCAN);
  const endIdx = Math.min(
    lines.length,
    Math.ceil((scrollTop + containerHeight) / VIRTUAL_LINE_HEIGHT) + VIRTUAL_OVERSCAN
  );

  const visibleLines = lines.slice(startIdx, endIdx);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto"
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <pre
          className="text-xs font-mono leading-[18px] whitespace-pre-wrap break-all text-foreground absolute left-0 right-0"
          style={{ top: startIdx * VIRTUAL_LINE_HEIGHT }}
        >
          {visibleLines.join("\n")}
        </pre>
      </div>
    </div>
  );
}

function LargeResponseWarning({ size, onShow }: { size: number; onShow: () => void }) {
  const sizeStr = size < 1048576
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / 1048576).toFixed(1)} MB`;

  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8">
      <AlertTriangle className="h-8 w-8 text-amber-500" />
      <p className="text-sm text-foreground font-medium">Large Response ({sizeStr})</p>
      <p className="text-xs text-muted-foreground text-center max-w-sm">
        This response is larger than 500KB. Rendering may be slow.
        Virtual scrolling is used for optimal performance.
      </p>
      <button
        type="button"
        onClick={onShow}
        className="text-xs bg-primary text-primary-foreground px-4 py-2 rounded hover:bg-primary/90 transition-colors"
      >
        Show Response (Virtual Scroll)
      </button>
    </div>
  );
}

function ResponseBody({ response, viewMode, searchQuery }: { response: ResponseData; viewMode: "pretty" | "raw"; searchQuery: string }) {
  const [showLarge, setShowLarge] = useState(false);
  const isLarge = response.size > LARGE_RESPONSE_THRESHOLD_BYTES;

  const isJSON = response.contentType.includes("json") || (() => {
    try { JSON.parse(response.body); return true; } catch { return false; }
  })();

  const isHTML = response.contentType.includes("html");
  const isXML = response.contentType.includes("xml") && !isHTML;
  const isImage = response.contentType.includes("image");

  if (viewMode === "raw") {
    if (isLarge && !showLarge) {
      return <LargeResponseWarning size={response.size} onShow={() => setShowLarge(true)} />;
    }
    if (isLarge) {
      return <VirtualizedText text={response.body} />;
    }
    return <HighlightedText text={response.body} search={searchQuery} />;
  }

  if (isImage) {
    let src: string;
    try {
      const isBase64 = !response.body.startsWith("http");
      src = isBase64
        ? `data:${response.contentType};base64,${btoa(unescape(encodeURIComponent(response.body)))}`
        : response.body;
    } catch {
      return (
        <div className="flex items-center justify-center p-4">
          <p className="text-muted-foreground text-sm">Image preview not available</p>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center gap-3 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Response image"
          className="max-w-full max-h-[400px] rounded border border-border"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
            (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
          }}
        />
        <p className="text-muted-foreground text-sm hidden">Image preview not available</p>
      </div>
    );
  }

  if (isJSON) {
    if (isLarge && !showLarge) {
      return <LargeResponseWarning size={response.size} onShow={() => setShowLarge(true)} />;
    }
    if (isLarge && !searchQuery) {
      try {
        const pretty = JSON.stringify(JSON.parse(response.body), null, 2);
        return <VirtualizedText text={pretty} />;
      } catch {
        return <VirtualizedText text={response.body} />;
      }
    }
    if (searchQuery) {
      try {
        const pretty = JSON.stringify(JSON.parse(response.body), null, 2);
        return <HighlightedText text={pretty} search={searchQuery} />;
      } catch {
        return <HighlightedText text={response.body} search={searchQuery} />;
      }
    }
    return <SyntaxHighlightedJSON json={response.body} />;
  }

  if (isHTML) {
    return (
      <div className="flex flex-col h-full">
        <iframe
          srcDoc={response.body}
          title="HTML Preview"
          className="w-full flex-1 min-h-[300px] rounded border border-border bg-white"
          sandbox=""
        />
      </div>
    );
  }

  if (isXML) {
    return <HighlightedText text={response.body} search={searchQuery} />;
  }

  return <HighlightedText text={response.body} search={searchQuery} />;
}

function ResponseHeaders({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm p-4">No headers returned</p>
    );
  }

  return (
    <div className="flex flex-col">
      {entries.map(([key, value]) => (
        <div key={key} className="grid grid-cols-[200px_1fr] gap-3 border-b border-border/35 px-4 py-1.5 text-xs font-mono hover:bg-[hsl(var(--surface-2)/.55)]">
          <span className="truncate text-[hsl(var(--chart-2))]">{key}</span>
          <span className="text-foreground break-all">{value}</span>
        </div>
      ))}
    </div>
  );
}

interface ParsedCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
}

function parseCookies(headers: Record<string, string>): ParsedCookie[] {
  const cookies: ParsedCookie[] = [];
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== "set-cookie") continue;
    for (const raw of value.split(/,(?=\s*\w+=)/)) {
      const parts = raw.split(";").map((s) => s.trim());
      const [first, ...attrs] = parts;
      if (!first) continue;
      const eqIdx = first.indexOf("=");
      const cookie: ParsedCookie = {
        name: eqIdx > -1 ? first.slice(0, eqIdx) : first,
        value: eqIdx > -1 ? first.slice(eqIdx + 1) : "",
        httpOnly: false,
        secure: false,
      };
      for (const attr of attrs) {
        const lower = attr.toLowerCase();
        if (lower.startsWith("domain=")) cookie.domain = attr.slice(7);
        else if (lower.startsWith("path=")) cookie.path = attr.slice(5);
        else if (lower.startsWith("expires=")) cookie.expires = attr.slice(8);
        else if (lower.startsWith("samesite=")) cookie.sameSite = attr.slice(9);
        else if (lower === "httponly") cookie.httpOnly = true;
        else if (lower === "secure") cookie.secure = true;
      }
      cookies.push(cookie);
    }
  }
  return cookies;
}

function ResponseCookies({ headers }: { headers: Record<string, string> }) {
  const cookies = useMemo(() => parseCookies(headers), [headers]);

  if (cookies.length === 0) {
    return (
      <p className="text-muted-foreground text-sm p-4">No cookies returned</p>
    );
  }

  return (
    <div className="flex flex-col">
      {cookies.map((cookie, i) => (
        <div key={`${cookie.name}-${i}`} className="border-b border-border/35 px-4 py-2 hover:bg-[hsl(var(--surface-2)/.55)]">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-bold text-[hsl(var(--chart-2))]">{cookie.name}</span>
            <span className="text-xs font-mono text-foreground break-all">= {cookie.value}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-muted-foreground font-mono">
            {cookie.domain && <span>Domain: {cookie.domain}</span>}
            {cookie.path && <span>Path: {cookie.path}</span>}
            {cookie.expires && <span>Expires: {cookie.expires}</span>}
            {cookie.sameSite && <span>SameSite: {cookie.sameSite}</span>}
            {cookie.httpOnly && <span className="text-amber-500">HttpOnly</span>}
            {cookie.secure && <span className="text-green-500">Secure</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── gRPC Status Codes ───────────────────────────────────────────────────────

const grpcStatusNames: Record<number, string> = {
  0: "OK",
  1: "CANCELLED",
  2: "UNKNOWN",
  3: "INVALID_ARGUMENT",
  4: "DEADLINE_EXCEEDED",
  5: "NOT_FOUND",
  6: "ALREADY_EXISTS",
  7: "PERMISSION_DENIED",
  8: "RESOURCE_EXHAUSTED",
  9: "FAILED_PRECONDITION",
  10: "ABORTED",
  11: "OUT_OF_RANGE",
  12: "UNIMPLEMENTED",
  13: "INTERNAL",
  14: "UNAVAILABLE",
  15: "DATA_LOSS",
  16: "UNAUTHENTICATED",
};

function GrpcStatusBadge({ code }: { code: number }) {
  const color = code === 0
    ? "text-[hsl(var(--method-get))] bg-[hsl(var(--method-get)/.12)]"
    : "text-[hsl(var(--method-delete))] bg-[hsl(var(--method-delete)/.12)]";

  return (
    <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${color}`}>
      {grpcStatusNames[code] ?? `CODE_${code}`}
    </span>
  );
}

function GrpcResponseView({ grpcResponse }: { grpcResponse: GrpcResponseData }) {
  const hasResponse = grpcResponse.responseJson.length > 0;

  return (
    <div className="flex h-full flex-col bg-[hsl(var(--surface-1))]">
      {/* Status bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border/70 px-4 py-2.5">
        <GrpcStatusBadge code={grpcResponse.statusCode} />
        <span className="text-xs text-muted-foreground">{grpcResponse.statusMessage}</span>
        <div className="flex-1" />
        <span className="text-[11px] text-muted-foreground font-mono">
          {grpcResponse.time}ms
        </span>
        <span className="text-[11px] text-muted-foreground font-mono">
          {formatBytes(grpcResponse.size)}
        </span>
        {hasResponse && <CopyButton text={grpcResponse.responseJson} />}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="body" className="flex flex-col flex-1 min-h-0">
        <TabsList className="h-auto flex-1 gap-0 rounded-none bg-transparent p-0 border-b border-border/70">
          <TabsTrigger
            value="body"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground text-muted-foreground text-xs px-4 py-2 font-medium"
          >
            Response
          </TabsTrigger>
          <TabsTrigger
            value="metadata"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground text-muted-foreground text-xs px-4 py-2 font-medium"
          >
            Metadata
            <span className="ml-1.5 text-[10px] text-muted-foreground">
              ({Object.keys(grpcResponse.responseMetadata).length})
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="body" className="m-0 min-h-0 flex-1 overflow-auto p-4">
          {hasResponse ? (
            <SyntaxHighlightedJSON json={grpcResponse.responseJson} />
          ) : (
            <p className="text-muted-foreground text-sm">No response body</p>
          )}
        </TabsContent>

        <TabsContent value="metadata" className="m-0 flex-1 overflow-auto min-h-0">
          <ResponseHeaders headers={grpcResponse.responseMetadata} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function ResponseViewer() {
  const { response, grpcResponse, isLoading, assertionResults } = useGetmanStore();
  const [viewMode, setViewMode] = useState<"pretty" | "raw">("pretty");
  const [searchQuery, setSearchQuery] = useState("");

  const exportDiagnosticLog = () => {
    if (!response) return;
    const log = {
      timestamp: new Date().toISOString(),
      status: response.status,
      statusText: response.statusText,
      time: response.time,
      size: response.size,
      contentType: response.contentType,
      headers: response.headers,
      bodyPreview: response.body.length > 10000
        ? response.body.slice(0, 10000) + "\n... (truncated)"
        : response.body,
      assertions: assertionResults,
    };

    const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `diagnostic-${log.timestamp.replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="relative h-8 w-8">
          <div className="absolute inset-0 rounded-full border-2 border-border" />
          <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
        <p className="text-sm text-muted-foreground">Sending request...</p>
      </div>
    );
  }

  if (!response && !grpcResponse) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-[hsl(var(--surface-2))]">
          <SendIcon className="h-5 w-5" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground/70">No response yet</p>
          <p className="text-xs mt-1">Enter a URL and click Send to get started</p>
        </div>
      </div>
    );
  }

  if (grpcResponse) {
    return <GrpcResponseView grpcResponse={grpcResponse} />;
  }

  if (!response) {
    return null;
  }

  return (
    <div className="flex h-full flex-col bg-[hsl(var(--surface-1))]">
      {/* Status bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border/70 px-4 py-2.5">
        <StatusBadge status={response.status} />
        <span className="text-xs text-muted-foreground">{response.statusText}</span>
        <div className="flex-1" />
        <span className="text-[11px] text-muted-foreground font-mono">
          {response.time}ms
        </span>
        <span className="text-[11px] text-muted-foreground font-mono">
          {formatBytes(response.size)}
        </span>
        <CopyButton text={response.body} />
        <button
          type="button"
          onClick={exportDiagnosticLog}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
          title="Export diagnostic log"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="body" className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center border-b border-border/70">
          <TabsList className="h-auto flex-1 gap-0 rounded-none bg-transparent p-0">
            <TabsTrigger
              value="body"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground text-muted-foreground text-xs px-4 py-2 font-medium"
            >
              Body
            </TabsTrigger>
            <TabsTrigger
              value="headers"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground text-muted-foreground text-xs px-4 py-2 font-medium"
            >
              Headers
              <span className="ml-1.5 text-[10px] text-muted-foreground">
                ({Object.keys(response.headers).length})
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="cookies"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground text-muted-foreground text-xs px-4 py-2 font-medium"
            >
              Cookies
              <span className="ml-1.5 text-[10px] text-muted-foreground">
                ({parseCookies(response.headers).length})
              </span>
            </TabsTrigger>
            {assertionResults.length > 0 && (
              <TabsTrigger
                value="test-results"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground text-muted-foreground text-xs px-4 py-2 font-medium"
              >
                Tests
                <span className={`ml-1.5 text-[10px] ${
                  assertionResults.every((r) => r.passed)
                    ? "text-green-500"
                    : "text-red-500"
                }`}>
                  ({assertionResults.filter((r) => r.passed).length}/{assertionResults.length})
                </span>
              </TabsTrigger>
            )}
          </TabsList>

          {/* View mode toggle + search */}
          <div className="flex items-center gap-1.5 pr-3 shrink-0">
            <ResponseBodySearch body={response.body} onSearch={setSearchQuery} />
            <div className="flex items-center rounded-md border border-border/60 overflow-hidden">
              <button
                type="button"
                onClick={() => setViewMode("pretty")}
                className={`px-2 py-1 text-[10px] font-medium transition-colors ${
                  viewMode === "pretty"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Pretty
              </button>
              <button
                type="button"
                onClick={() => setViewMode("raw")}
                className={`px-2 py-1 text-[10px] font-medium transition-colors ${
                  viewMode === "raw"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Raw
              </button>
            </div>
          </div>
        </div>

        <TabsContent value="body" className="m-0 min-h-0 flex-1 overflow-auto p-4">
          <ResponseBody response={response} viewMode={viewMode} searchQuery={searchQuery} />
        </TabsContent>

        <TabsContent value="headers" className="m-0 flex-1 overflow-auto min-h-0">
          <ResponseHeaders headers={response.headers} />
        </TabsContent>

        <TabsContent value="cookies" className="m-0 flex-1 overflow-auto min-h-0">
          <ResponseCookies headers={response.headers} />
        </TabsContent>

        {assertionResults.length > 0 && (
          <TabsContent value="test-results" className="m-0 flex-1 overflow-auto min-h-0 p-4">
            <div className="flex flex-col gap-2">
              {assertionResults.map((r, i) => (
                <div
                  key={r.assertionId || i}
                  className={`flex items-center gap-2 rounded px-3 py-2 text-xs font-mono ${
                    r.passed
                      ? "bg-green-500/5 border border-green-500/20"
                      : "bg-red-500/5 border border-red-500/20"
                  }`}
                >
                  <span className={r.passed ? "text-green-500" : "text-red-500"}>
                    {r.passed ? "✓" : "✗"}
                  </span>
                  <span className="text-foreground">{r.message}</span>
                  {!r.passed && r.actual && (
                    <span className="ml-auto text-muted-foreground">got: {r.actual}</span>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
      <path d="m21.854 2.147-10.94 10.939" />
    </svg>
  );
}
