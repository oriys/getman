"use client";

import React, { useEffect, useRef } from "react"

import { Send, X, Settings2, Copy, Check, Eye } from "lucide-react";
import {
  useActiveTab,
  useGetmanStore,
  updateActiveTab,
  updateActiveTabUrl,
  setResponse,
  setGrpcResponse,
  setIsLoading,
  setActiveRequestId,
  setAssertionResults,
  addHistoryItem,
  addWsConnection,
  updateWsConnection,
  addWsMessage,
  removeWsConnection,
  resolveEnvVariables,
  getVariableScopeSnapshot,
  findSavedRequestScopeByTab,
  addCookieEntry,
  uid,
  type AssertionResult,
  type HttpMethod,
  type KeyValue,
  type CookieEntry,
  type RequestSettings,
  type RequestTab,
  type RequestType,
  type ResponseData,
  defaultSettings,
} from "@/lib/getman-store";
import {
  sendHttpRequest,
  cancelHttpRequest,
  sendGrpcRequest,
  type SendRequestPayload,
} from "@/lib/tauri";
import { runAssertions } from "@/lib/assertions";
import { isCurlCommand, parseCurlCommand } from "@/lib/curl-parser";
import { generateCode } from "@/lib/code-generator";
import {
  executePreRequestScript,
  executePostResponseScript,
  type ScriptExecutionLog,
} from "@/lib/request-scripts";
import { applyAdvancedAuth } from "@/lib/advanced-auth";
import { CodeGeneratorDialog } from "./code-generator-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const methods: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

const methodTextColors: Record<HttpMethod, string> = {
  GET: "text-[hsl(var(--method-get))]",
  POST: "text-[hsl(var(--method-post))]",
  PUT: "text-[hsl(var(--method-put))]",
  PATCH: "text-[hsl(var(--method-patch))]",
  DELETE: "text-[hsl(var(--method-delete))]",
  HEAD: "text-[hsl(var(--method-head))]",
  OPTIONS: "text-[hsl(var(--method-options))]",
};

const activeWebSocketRequests = new Map<string, WebSocket>();

function normalizeCookieDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\./, "");
}

function isCookieExpired(expires: string): boolean {
  if (!expires || expires === "Infinity") {
    return false;
  }
  const expiresAt = Date.parse(expires);
  if (Number.isNaN(expiresAt)) {
    return false;
  }
  return expiresAt <= Date.now();
}

function cookieDomainMatches(hostname: string, cookieDomain: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  const normalizedCookieDomain = normalizeCookieDomain(cookieDomain);
  return (
    normalizedHost === normalizedCookieDomain ||
    normalizedHost.endsWith(`.${normalizedCookieDomain}`)
  );
}

function cookiePathMatches(pathname: string, cookiePath: string): boolean {
  const normalizedPathname = pathname || "/";
  const normalizedCookiePath = cookiePath.startsWith("/") ? cookiePath : `/${cookiePath}`;
  if (normalizedCookiePath === "/") {
    return true;
  }
  return (
    normalizedPathname === normalizedCookiePath ||
    normalizedPathname.startsWith(
      normalizedCookiePath.endsWith("/")
        ? normalizedCookiePath
        : `${normalizedCookiePath}/`
    )
  );
}

function splitSetCookieHeader(value: string): string[] {
  return value
    .split(/\r?\n/)
    .flatMap((line) => line.split(/,(?=\s*[^;=,\s]+=)/))
    .map((part) => part.trim())
    .filter(Boolean);
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

function parseSetCookieHeaders(headers: Record<string, string>): ParsedCookie[] {
  const parsed: ParsedCookie[] = [];

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== "set-cookie") {
      continue;
    }

    const rawCookies = splitSetCookieHeader(value);
    for (const rawCookie of rawCookies) {
      const parts = rawCookie
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean);

      const [nameValue, ...attrs] = parts;
      if (!nameValue) {
        continue;
      }

      const eqIdx = nameValue.indexOf("=");
      if (eqIdx <= 0) {
        continue;
      }

      const cookie: ParsedCookie = {
        name: nameValue.slice(0, eqIdx).trim(),
        value: nameValue.slice(eqIdx + 1).trim(),
        httpOnly: false,
        secure: false,
      };

      for (const attr of attrs) {
        const lower = attr.toLowerCase();
        if (lower.startsWith("domain=")) {
          cookie.domain = attr.slice(7).trim();
        } else if (lower.startsWith("path=")) {
          cookie.path = attr.slice(5).trim();
        } else if (lower.startsWith("expires=")) {
          cookie.expires = attr.slice(8).trim();
        } else if (lower.startsWith("max-age=")) {
          const seconds = Number(attr.slice(8).trim());
          if (!Number.isNaN(seconds)) {
            cookie.expires = new Date(Date.now() + seconds * 1000).toUTCString();
          }
        } else if (lower.startsWith("samesite=")) {
          cookie.sameSite = attr.slice(9).trim();
        } else if (lower === "httponly") {
          cookie.httpOnly = true;
        } else if (lower === "secure") {
          cookie.secure = true;
        }
      }

      parsed.push(cookie);
    }
  }

  return parsed;
}

function buildCookieHeaderValue(
  requestUrl: URL,
  cookieJar: CookieEntry[],
  manualCookies: KeyValue[]
): string | null {
  const cookieMap = new Map<string, string>();

  for (const cookie of cookieJar) {
    if (!cookie.name || !cookie.domain) {
      continue;
    }
    if (isCookieExpired(cookie.expires)) {
      continue;
    }
    if (cookie.secure && requestUrl.protocol !== "https:") {
      continue;
    }
    if (!cookieDomainMatches(requestUrl.hostname, cookie.domain)) {
      continue;
    }
    if (!cookiePathMatches(requestUrl.pathname, cookie.path || "/")) {
      continue;
    }

    cookieMap.set(cookie.name, cookie.value);
  }

  for (const cookie of manualCookies) {
    if (!cookie.enabled || !cookie.key) {
      continue;
    }
    cookieMap.set(resolveEnvVariables(cookie.key), resolveEnvVariables(cookie.value));
  }

  if (cookieMap.size === 0) {
    return null;
  }

  return Array.from(cookieMap.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function persistCookiesFromResponse(
  headers: Record<string, string>,
  requestUrl: URL
): void {
  const responseCookies = parseSetCookieHeaders(headers);
  for (const cookie of responseCookies) {
    if (!cookie.name) {
      continue;
    }

    addCookieEntry({
      id: uid(),
      name: cookie.name,
      value: cookie.value,
      domain: normalizeCookieDomain(cookie.domain || requestUrl.hostname),
      path: cookie.path || "/",
      expires: cookie.expires || "Infinity",
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite || "",
    });
  }
}

function formatWebSocketMessage(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof Blob) {
    return `[binary ${data.size} bytes]`;
  }
  if (data instanceof ArrayBuffer) {
    return `[binary ${data.byteLength} bytes]`;
  }
  if (ArrayBuffer.isView(data)) {
    return `[binary ${data.byteLength} bytes]`;
  }
  return String(data);
}

function variablesToMap(variables: Array<{ key: string; value: string; enabled: boolean }> = []): Record<string, string> {
  const map: Record<string, string> = {};
  for (const variable of variables) {
    if (variable.enabled && variable.key) {
      map[variable.key] = variable.value;
    }
  }
  return map;
}

function buildScopedResolver(
  tab: RequestTab,
  runtimeVariables: Record<string, string>
): {
  resolve: (value: string) => string;
  preScripts: string[];
  postScripts: string[];
  context: {
    requestName: string;
    globalVariables: Record<string, string>;
    environmentVariables: Record<string, string>;
    collectionVariables: Record<string, string>;
    requestVariables: Record<string, string>;
    runtimeVariables: Record<string, string>;
  };
} {
  const scope = findSavedRequestScopeByTab(tab);
  const variableScope = getVariableScopeSnapshot();
  const collectionVariables = variablesToMap(scope?.collection.variables);
  const requestVariables = variablesToMap(tab.variables || []);
  const folderVariables = scope?.folderChain.map((folder) => folder.variables || []) || [];
  const mergedFolderVariables = folderVariables.reduce<Record<string, string>>((acc, items) => {
    for (const item of items) {
      if (item.enabled && item.key) {
        acc[item.key] = item.value;
      }
    }
    return acc;
  }, {});

  const resolve = (value: string) =>
    resolveEnvVariables(value, {
      collectionVariables: scope?.collection.variables,
      folderVariables,
      requestVariables: tab.variables,
      runtimeVariables,
    });

  const preScripts = [
    scope?.collection.preRequestScript || "",
    ...(scope?.folderChain.map((folder) => folder.preRequestScript || "") || []),
    tab.preRequestScript || "",
  ].filter((script) => script.trim());

  const postScripts = [
    scope?.collection.testScript || "",
    ...(scope?.folderChain.map((folder) => folder.testScript || "") || []),
    tab.testScript || "",
  ].filter((script) => script.trim());

  return {
    resolve,
    preScripts,
    postScripts,
    context: {
      requestName: tab.name,
      globalVariables: variableScope.globalVariables,
      environmentVariables: variableScope.environmentVariables,
      collectionVariables: {
        ...collectionVariables,
        ...mergedFolderVariables,
      },
      requestVariables,
      runtimeVariables,
    },
  };
}

function exampleMatchesMockRequest(
  tags: string[],
  request: { method: string; url: string; headers: Record<string, string>; body?: string }
): boolean {
  if (tags.length === 0) return true;
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(request.url);
  } catch {
    parsedUrl = null;
  }

  for (const tag of tags) {
    if (tag.startsWith("method:")) {
      const expected = tag.slice("method:".length).trim().toUpperCase();
      if (expected && request.method.toUpperCase() !== expected) return false;
      continue;
    }
    if (tag.startsWith("path:")) {
      const expected = tag.slice("path:".length).trim();
      if (expected && (!parsedUrl || parsedUrl.pathname !== expected)) return false;
      continue;
    }
    if (tag.startsWith("query:")) {
      const segment = tag.slice("query:".length).trim();
      const [key, value] = segment.split("=");
      if (!key || !parsedUrl) return false;
      if ((parsedUrl.searchParams.get(key) || "") !== (value || "")) return false;
      continue;
    }
    if (tag.startsWith("header:")) {
      const segment = tag.slice("header:".length).trim();
      const [key, value] = segment.split("=");
      if (!key) return false;
      const found = Object.entries(request.headers).find(
        ([headerName]) => headerName.toLowerCase() === key.toLowerCase()
      );
      if (!found) return false;
      if (value !== undefined && found[1] !== value) return false;
      continue;
    }
    if (tag.startsWith("body~")) {
      const keyword = tag.slice("body~".length).trim();
      if (keyword && !(request.body || "").includes(keyword)) return false;
      continue;
    }
  }

  return true;
}

function getActiveMockExample(
  tab: RequestTab,
  request: { method: string; url: string; headers: Record<string, string>; body?: string }
) {
  const examples = tab.examples || [];
  if (examples.length === 0) return null;
  const matched = examples.filter((example) => exampleMatchesMockRequest(example.tags, request));
  if (matched.length === 0) return null;
  return (
    matched.find((example) => example.id === tab.selectedExampleId) ||
    matched.find((example) => example.isDefault) ||
    matched[0]
  );
}

function buildMockResponse(
  tab: RequestTab,
  request: { method: string; url: string; headers: Record<string, string>; body?: string }
): ResponseData | null {
  const example = getActiveMockExample(tab, request);
  if (!tab.useMockExamples || !example) return null;
  const contentType = example.contentType || example.headers["Content-Type"] || "application/json";
  return {
    status: example.statusCode,
    statusText: "Mock Example",
    headers: {
      "x-getman-mock-source": "example",
      "x-getman-mock-name": example.name,
      "content-type": contentType,
      ...example.headers,
    },
    body: example.body,
    time: Math.max(0, example.delayMs || 0),
    size: new TextEncoder().encode(example.body || "").length,
    contentType,
  };
}

function RequestSettingsDialog() {
  const tab = useActiveTab();
  if (!tab) return null;

  const settings = tab.settings || defaultSettings();

  const updateSettings = (partial: Partial<RequestSettings>) => {
    updateActiveTab({ settings: { ...settings, ...partial } });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex h-11 items-center px-2.5 text-muted-foreground hover:text-foreground transition-colors border-r border-border/80"
          title="Request Settings"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-[hsl(var(--surface-1))] border-border sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-foreground text-sm">Request Settings</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {/* Timeout */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">
              Timeout (ms) — 0 = no timeout
            </label>
            <input
              type="number"
              className="rounded border border-border bg-[hsl(var(--surface-2))] px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary/50"
              value={settings.timeoutMs}
              onChange={(e) => updateSettings({ timeoutMs: Math.max(0, Number(e.target.value)) })}
              min={0}
              step={1000}
            />
          </div>

          {/* Retry */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">
                Retry Count
              </label>
              <input
                type="number"
                className="rounded border border-border bg-[hsl(var(--surface-2))] px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary/50"
                value={settings.retryCount}
                onChange={(e) => updateSettings({ retryCount: Math.max(0, Math.min(10, Number(e.target.value))) })}
                min={0}
                max={10}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">
                Retry Delay (ms)
              </label>
              <input
                type="number"
                className="rounded border border-border bg-[hsl(var(--surface-2))] px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary/50"
                value={settings.retryDelayMs}
                onChange={(e) => updateSettings({ retryDelayMs: Math.max(0, Number(e.target.value)) })}
                min={0}
                step={500}
              />
            </div>
          </div>

          {/* Proxy */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">
              Proxy URL (e.g., http://proxy:8080 or socks5://proxy:1080)
            </label>
            <input
              type="text"
              className="rounded border border-border bg-[hsl(var(--surface-2))] px-3 py-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary/50"
              placeholder="Leave empty for direct connection"
              value={settings.proxyUrl}
              onChange={(e) => updateSettings({ proxyUrl: e.target.value })}
            />
          </div>

          {/* SSL Verification */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="verify-ssl"
              checked={settings.verifySsl}
              onChange={(e) => updateSettings({ verifySsl: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-border accent-primary"
            />
            <label htmlFor="verify-ssl" className="text-xs text-foreground">
              Verify SSL/TLS Certificates
            </label>
          </div>
          {!settings.verifySsl && (
            <p className="text-[10px] text-amber-500">
              ⚠ SSL verification is disabled. This is insecure and should only be used for local development.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviewResolvedDialog() {
  const tab = useActiveTab();
  if (!tab) return null;

  const resolvedUrl = resolveEnvVariables(tab.url);
  const resolvedHeaders: { key: string; value: string }[] = [];
  for (const h of tab.headers) {
    if (h.enabled && h.key) {
      resolvedHeaders.push({
        key: h.key,
        value: resolveEnvVariables(h.value),
      });
    }
  }
  const resolvedParams: { key: string; value: string }[] = [];
  for (const p of tab.params) {
    if (p.enabled && p.key) {
      resolvedParams.push({
        key: p.key,
        value: resolveEnvVariables(p.value),
      });
    }
  }
  const resolvedBody = tab.bodyContent
    ? resolveEnvVariables(tab.bodyContent)
    : undefined;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={!tab.url.trim()}
          className="flex h-11 items-center px-2.5 text-muted-foreground hover:text-foreground transition-colors border-r border-border/80 disabled:cursor-not-allowed disabled:opacity-50"
          title="Preview Resolved Request"
        >
          <Eye className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-[hsl(var(--surface-1))] border-border sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-foreground text-sm">Resolved Request Preview</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 max-h-[400px] overflow-y-auto">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Method & URL</span>
            <div className="rounded-md bg-[hsl(var(--surface-2))] px-3 py-2 font-mono text-xs text-foreground break-all">
              <span className="font-bold">{tab.method}</span>{" "}
              {resolvedUrl}
            </div>
          </div>

          {resolvedParams.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Query Parameters</span>
              <div className="rounded-md bg-[hsl(var(--surface-2))] px-3 py-2 font-mono text-xs space-y-0.5">
                {resolvedParams.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-primary font-medium">{p.key}:</span>
                    <span className="text-foreground break-all">{p.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {resolvedHeaders.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Headers</span>
              <div className="rounded-md bg-[hsl(var(--surface-2))] px-3 py-2 font-mono text-xs space-y-0.5">
                {resolvedHeaders.map((h, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-primary font-medium">{h.key}:</span>
                    <span className="text-foreground break-all">{h.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {resolvedBody && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Body</span>
              <pre className="rounded-md bg-[hsl(var(--surface-2))] px-3 py-2 font-mono text-xs text-foreground whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto">
                {resolvedBody}
              </pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RequestBar() {
  const store = useGetmanStore();
  const tab = useActiveTab();
  const sendRef = useRef<(() => void) | null>(null);
  const [curlCopied, setCurlCopied] = React.useState(false);

  // Global Cmd/Ctrl+Enter shortcut to send request
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only trigger on Cmd/Ctrl+Enter (modifier required)
      if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
      e.preventDefault();
      sendRef.current?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    return () => {
      for (const [id, socket] of activeWebSocketRequests.entries()) {
        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          socket.close(1000, "Unmount");
        }
        activeWebSocketRequests.delete(id);
      }
    };
  }, []);

  if (!tab) return null;

  const isGrpc = (tab.requestType ?? "http") === "grpc";
  const isGraphql = (tab.requestType ?? "http") === "graphql";
  const isWebsocket = (tab.requestType ?? "http") === "websocket";

  const handleCopyAsCurl = () => {
    const curl = generateCode(tab, "curl");
    navigator.clipboard.writeText(curl);
    setCurlCopied(true);
    setTimeout(() => setCurlCopied(false), 2000);
  };

  const handleCancel = async () => {
    if (store.activeRequestId) {
      const ws = activeWebSocketRequests.get(store.activeRequestId);
      if (ws) {
        ws.close(1000, "Cancelled by user");
        return;
      }

      await cancelHttpRequest(store.activeRequestId);
      setIsLoading(false);
      setActiveRequestId(null);
    }
  };

  const sendWebsocketRequest = async () => {
    if (!tab.url.trim()) return;

    const requestId = uid();
    const resolvedUrl = resolveEnvVariables(tab.url);
    const protocols = (tab.wsProtocols || "")
      .split(",")
      .map((p) => resolveEnvVariables(p.trim()))
      .filter(Boolean);
    const settings = tab.settings || defaultSettings();
    const timeoutMs = settings.timeoutMs > 0 ? settings.timeoutMs : 10000;
    const connectionId = addWsConnection(resolvedUrl, protocols.join(","));

    setIsLoading(true);
    setActiveRequestId(requestId);
    setResponse(null);
    setAssertionResults([]);

    const startedAt = performance.now();
    const transcript: string[] = [];
    const requestMessage = resolveEnvVariables(tab.wsMessage ?? "");

    let socket: WebSocket;
    try {
      socket = protocols.length > 0
        ? new WebSocket(resolvedUrl, protocols)
        : new WebSocket(resolvedUrl);
    } catch (error) {
      updateWsConnection(connectionId, { status: "error" });
      removeWsConnection(connectionId);
      setResponse({
        status: 0,
        statusText: "WebSocket Error",
        headers: {},
        body: error instanceof Error ? error.message : "Failed to create WebSocket connection",
        time: 0,
        size: 0,
        contentType: "text/plain",
      });
      setIsLoading(false);
      setActiveRequestId(null);
      return;
    }

    activeWebSocketRequests.set(requestId, socket);

    await new Promise<void>((resolve) => {
      let done = false;

      const finalize = (
        status: number,
        statusText: string,
        extraHeaders: Record<string, string> = {}
      ) => {
        if (done) return;
        done = true;

        activeWebSocketRequests.delete(requestId);
        removeWsConnection(connectionId);

        const body = transcript.length > 0 ? transcript.join("\n") : "No messages received.";
        const elapsed = Math.round(performance.now() - startedAt);
        const size = new TextEncoder().encode(body).length;

        setResponse({
          status,
          statusText,
          headers: {
            "x-getman-transport": "websocket",
            ...extraHeaders,
          },
          body,
          time: elapsed,
          size,
          contentType: "text/plain",
        });

        addHistoryItem({
          id: uid(),
          method: "GET",
          url: tab.url,
          status,
          time: elapsed,
          timestamp: Date.now(),
          requestType: "websocket",
        });

        setIsLoading(false);
        setActiveRequestId(null);
        resolve();
      };

      const timeoutId = window.setTimeout(() => {
        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          socket.close(1000, "Timeout");
        }
      }, timeoutMs);

      socket.onopen = () => {
        updateWsConnection(connectionId, { status: "connected" });

        if (requestMessage.trim()) {
          socket.send(requestMessage);
          addWsMessage(connectionId, {
            id: uid(),
            direction: "sent",
            data: requestMessage,
            timestamp: Date.now(),
          });
          transcript.push(`>>> ${requestMessage}`);
        }
      };

      socket.onmessage = (event) => {
        const message = formatWebSocketMessage(event.data);
        addWsMessage(connectionId, {
          id: uid(),
          direction: "received",
          data: message,
          timestamp: Date.now(),
        });
        transcript.push(`<<< ${message}`);

        if (requestMessage.trim()) {
          socket.close(1000, "Message received");
        }
      };

      socket.onerror = () => {
        updateWsConnection(connectionId, { status: "error" });
      };

      socket.onclose = (event) => {
        window.clearTimeout(timeoutId);
        updateWsConnection(connectionId, {
          status: event.wasClean ? "disconnected" : "error",
        });

        const timedOut = event.reason === "Timeout";
        const cancelled = event.reason === "Cancelled by user";
        const received = event.reason === "Message received";
        const status = event.wasClean && !timedOut ? 101 : 0;
        const statusText = timedOut
          ? "WebSocket Timeout"
          : cancelled
            ? "WebSocket Cancelled"
            : received
              ? "WebSocket Message Received"
              : event.wasClean
                ? "WebSocket Closed"
                : "WebSocket Error";

        finalize(status, statusText, {
          "x-websocket-close-code": String(event.code),
          ...(event.reason ? { "x-websocket-close-reason": event.reason } : {}),
        });
      };
    });
  };

  const sendGrpc = async () => {
    if (!tab.url.trim() || !tab.grpcServiceName || !tab.grpcMethodName) return;

    const requestId = uid();
    setIsLoading(true);
    setActiveRequestId(requestId);
    setResponse(null);
    setGrpcResponse(null);

    try {
      const metadata: Record<string, string> = {};
      for (const m of (tab.grpcMetadata ?? [])) {
        if (m.enabled && m.key) {
          metadata[m.key] = resolveEnvVariables(m.value);
        }
      }

      const settings = tab.settings || defaultSettings();

      const data = await sendGrpcRequest({
        endpoint: resolveEnvVariables(tab.url),
        protoContent: tab.grpcProtoContent,
        serviceName: tab.grpcServiceName,
        methodName: tab.grpcMethodName,
        requestJson: resolveEnvVariables(tab.grpcRequestBody || "{}"),
        metadata,
        timeoutMs: settings.timeoutMs > 0 ? settings.timeoutMs : undefined,
        requestId,
        descriptorBytes: tab.grpcDescriptorBytes || undefined,
      });

      setGrpcResponse(data);

      addHistoryItem({
        id: uid(),
        method: "POST",
        url: `${tab.url}/${tab.grpcServiceName}/${tab.grpcMethodName}`,
        status: data.statusCode === 0 ? 200 : 500,
        time: data.time,
        timestamp: Date.now(),
        requestType: "grpc",
      });
    } catch {
      setGrpcResponse({
        statusCode: 2,
        statusMessage: "Failed to send gRPC request",
        responseJson: "",
        responseMetadata: {},
        time: 0,
        size: 0,
      });
    } finally {
      setIsLoading(false);
      setActiveRequestId(null);
    }
  };

  const sendRequest = async () => {
    if (!tab.url.trim()) return;

    const requestId = uid();
    setIsLoading(true);
    setActiveRequestId(requestId);
    setResponse(null);
    setAssertionResults([]);

    try {
      const runtimeVariables: Record<string, string> = {};
      const scoped = buildScopedResolver(tab, runtimeVariables);
      const resolve = scoped.resolve;
      const scriptLogs: ScriptExecutionLog[] = [];
      const resolvedUrl = resolve(tab.url);

      // Build query params
      const url = new URL(resolvedUrl);
      for (const p of tab.params) {
        if (p.enabled && p.key) {
          url.searchParams.set(resolve(p.key), resolve(p.value));
        }
      }

      // Auth query params
      if (tab.authType === "api-key" && tab.authApiAddTo === "query") {
        url.searchParams.set(
          resolve(tab.authApiKey),
          resolve(tab.authApiValue)
        );
      }

      // Build headers
      const headers: Record<string, string> = {};
      for (const h of tab.headers) {
        if (h.enabled && h.key) {
          headers[resolve(h.key)] = resolve(h.value);
        }
      }

      // Cookie jar + manual cookies
      const cookieHeader = buildCookieHeaderValue(
        url,
        store.cookieJar,
        tab.cookies ?? []
      );
      if (cookieHeader) {
        headers["Cookie"] = cookieHeader;
      }

      // Auth headers
      if (tab.authType === "bearer" && tab.authToken) {
        headers["Authorization"] = `Bearer ${resolve(tab.authToken)}`;
      } else if (tab.authType === "basic" && tab.authUsername) {
        const encoded = btoa(
          `${resolve(tab.authUsername)}:${resolve(tab.authPassword)}`
        );
        headers["Authorization"] = `Basic ${encoded}`;
      } else if (
        tab.authType === "api-key" &&
        tab.authApiAddTo === "header"
      ) {
        headers[resolve(tab.authApiKey)] = resolve(
          tab.authApiValue
        );
      } else if (tab.authType === "oauth2" && tab.oauth2AccessToken) {
        headers["Authorization"] = `Bearer ${resolve(tab.oauth2AccessToken)}`;
      }

      // Build body
      let body: string | undefined;
      if (!["GET", "HEAD", "OPTIONS"].includes(tab.method)) {
        if (tab.bodyType === "json") {
          headers["Content-Type"] = headers["Content-Type"] || "application/json";
          body = resolve(tab.bodyContent);
        } else if (tab.bodyType === "raw") {
          body = resolve(tab.bodyContent);
        } else if (tab.bodyType === "x-www-form-urlencoded") {
          headers["Content-Type"] =
            headers["Content-Type"] || "application/x-www-form-urlencoded";
          const params = new URLSearchParams();
          for (const f of tab.bodyFormData) {
            if (f.enabled && f.key)
              params.set(resolve(f.key), resolve(f.value));
          }
          body = params.toString();
        } else if (tab.bodyType === "form-data") {
          // form-data sent as JSON key-values for proxy
          const obj: Record<string, string> = {};
          for (const f of tab.bodyFormData) {
            if (f.enabled && f.key) obj[resolve(f.key)] = resolve(f.value);
          }
          headers["Content-Type"] = headers["Content-Type"] || "application/json";
          body = JSON.stringify(obj);
        } else if (tab.bodyType === "graphql") {
          headers["Content-Type"] = headers["Content-Type"] || "application/json";
          let variables = {};
          try {
            variables = JSON.parse(resolve(tab.graphqlVariables || "{}"));
          } catch {
            // Keep empty variables on parse error
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

      const settings = tab.settings || defaultSettings();

      let payload: SendRequestPayload = {
        url: url.toString(),
        method: tab.method,
        headers,
        body,
        requestId,
        timeoutMs: settings.timeoutMs > 0 ? settings.timeoutMs : undefined,
        retryCount: settings.retryCount > 0 ? settings.retryCount : undefined,
        retryDelayMs: settings.retryDelayMs,
        proxyUrl: settings.proxyUrl || undefined,
        verifySsl: settings.verifySsl,
      };

      for (const [index, script] of scoped.preScripts.entries()) {
        payload = executePreRequestScript(script, payload, {
          ...scoped.context,
          runtimeVariables,
          logs: scriptLogs,
          scriptName: `pre-request-${index + 1}`,
        });
      }
      payload = await applyAdvancedAuth(payload, tab);

      let data = buildMockResponse(tab, {
        method: payload.method,
        url: payload.url,
        headers: payload.headers,
        body: payload.body,
      });
      if (data && data.time > 0) {
        const delayMs = data.time;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
      }
      if (!data) {
        data = await sendHttpRequest(payload);
      }
      setResponse(data);
      persistCookiesFromResponse(data.headers, new URL(payload.url));

      const results: AssertionResult[] = [];
      if (tab.assertions && tab.assertions.length > 0) {
        results.push(...runAssertions(tab.assertions, data));
      }
      for (const [index, script] of scoped.postScripts.entries()) {
        results.push(
          ...executePostResponseScript(
            script,
            {
              method: payload.method,
              url: payload.url,
              headers: payload.headers,
              body: payload.body,
            },
            data,
            {
              ...scoped.context,
              runtimeVariables,
              logs: scriptLogs,
              scriptName: `post-response-${index + 1}`,
            }
          )
        );
      }
      setAssertionResults(results);

      addHistoryItem({
        id: uid(),
        method: tab.method,
        url: tab.url,
        status: data.status,
        time: data.time,
        timestamp: Date.now(),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to connect. Check the URL and try again.";
      setResponse({
        status: 0,
        statusText: "Error",
        headers: {},
        body: message,
        time: 0,
        size: 0,
        contentType: "text/plain",
      });
    } finally {
      setIsLoading(false);
      setActiveRequestId(null);
    }
  };

  const sendGraphqlRequest = async () => {
    if (!tab.url.trim()) return;

    const requestId = uid();
    setIsLoading(true);
    setActiveRequestId(requestId);
    setResponse(null);
    setAssertionResults([]);

    try {
      const runtimeVariables: Record<string, string> = {};
      const scoped = buildScopedResolver(tab, runtimeVariables);
      const resolve = scoped.resolve;
      const scriptLogs: ScriptExecutionLog[] = [];
      const resolvedUrl = resolve(tab.url);
      const url = new URL(resolvedUrl);

      // Build headers
      const headers: Record<string, string> = {};
      for (const h of tab.headers) {
        if (h.enabled && h.key) {
          headers[resolve(h.key)] = resolve(h.value);
        }
      }

      // Auth headers
      if (tab.authType === "bearer" && tab.authToken) {
        headers["Authorization"] = `Bearer ${resolve(tab.authToken)}`;
      } else if (tab.authType === "basic" && tab.authUsername) {
        const encoded = btoa(
          `${resolve(tab.authUsername)}:${resolve(tab.authPassword)}`
        );
        headers["Authorization"] = `Basic ${encoded}`;
      } else if (tab.authType === "oauth2" && tab.oauth2AccessToken) {
        headers["Authorization"] = `Bearer ${resolve(tab.oauth2AccessToken)}`;
      }

      const cookieHeader = buildCookieHeaderValue(
        url,
        store.cookieJar,
        tab.cookies ?? []
      );
      if (cookieHeader) {
        headers["Cookie"] = cookieHeader;
      }

      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      let variables = {};
      try {
        variables = JSON.parse(resolve(tab.graphqlVariables || "{}"));
      } catch {
        // Keep empty variables on parse error
      }
      const body = JSON.stringify({
        query: resolve(tab.graphqlQuery),
        variables,
      });

      const settings = tab.settings || defaultSettings();

      let payload: SendRequestPayload = {
        url: url.toString(),
        method: "POST",
        headers,
        body,
        requestId,
        timeoutMs: settings.timeoutMs > 0 ? settings.timeoutMs : undefined,
        retryCount: settings.retryCount > 0 ? settings.retryCount : undefined,
        retryDelayMs: settings.retryDelayMs,
        proxyUrl: settings.proxyUrl || undefined,
        verifySsl: settings.verifySsl,
      };

      for (const [index, script] of scoped.preScripts.entries()) {
        payload = executePreRequestScript(script, payload, {
          ...scoped.context,
          runtimeVariables,
          logs: scriptLogs,
          scriptName: `pre-request-${index + 1}`,
        });
      }
      payload = await applyAdvancedAuth(payload, tab);

      let data = buildMockResponse(tab, {
        method: payload.method,
        url: payload.url,
        headers: payload.headers,
        body: payload.body,
      });
      if (data && data.time > 0) {
        const delayMs = data.time;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
      }
      if (!data) {
        data = await sendHttpRequest(payload);
      }
      setResponse(data);
      persistCookiesFromResponse(data.headers, new URL(payload.url));

      const results: AssertionResult[] = [];
      for (const [index, script] of scoped.postScripts.entries()) {
        results.push(
          ...executePostResponseScript(
            script,
            {
              method: payload.method,
              url: payload.url,
              headers: payload.headers,
              body: payload.body,
            },
            data,
            {
              ...scoped.context,
              runtimeVariables,
              logs: scriptLogs,
              scriptName: `post-response-${index + 1}`,
            }
          )
        );
      }
      setAssertionResults(results);

      addHistoryItem({
        id: uid(),
        method: "POST",
        url: tab.url,
        status: data.status,
        time: data.time,
        timestamp: Date.now(),
        requestType: "graphql",
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to connect. Check the URL and try again.";
      setResponse({
        status: 0,
        statusText: "Error",
        headers: {},
        body: message,
        time: 0,
        size: 0,
        contentType: "text/plain",
      });
    } finally {
      setIsLoading(false);
      setActiveRequestId(null);
    }
  };

  const handleSend = isGrpc
    ? sendGrpc
    : isGraphql
      ? sendGraphqlRequest
      : isWebsocket
        ? sendWebsocketRequest
        : sendRequest;
  sendRef.current = handleSend;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (isGrpc || isGraphql || isWebsocket) return;
    const text = e.clipboardData.getData("text");
    if (isCurlCommand(text)) {
      e.preventDefault();
      const parsed = parseCurlCommand(text);
      updateActiveTab({
        url: parsed.url,
        method: parsed.method,
        headers: parsed.headers,
        params: parsed.params,
        bodyType: parsed.bodyType,
        bodyContent: parsed.bodyContent,
        bodyFormData: parsed.bodyFormData,
        cookies: parsed.cookies,
        authType: parsed.authType,
        authToken: parsed.authToken,
        authUsername: parsed.authUsername,
        authPassword: parsed.authPassword,
        name: parsed.name,
      });
    }
  };

  const canSend = isGrpc
    ? tab.url.trim() && tab.grpcServiceName && tab.grpcMethodName
    : isWebsocket
    ? tab.url.trim()
    : tab.url.trim();

  const grpcServices = tab.grpcServices ?? [];
  const selectedService = grpcServices.find((s) => s.fullName === tab.grpcServiceName);
  const grpcMethods = selectedService?.methods ?? [];

  return (
    <div className="flex flex-col gap-2">
      {/* Protocol toggle */}
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-border/60 overflow-hidden">
          {(["http", "grpc", "graphql", "websocket"] as RequestType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => updateActiveTab({ requestType: type })}
              className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                (tab.requestType ?? "http") === type
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {type}
            </button>
          ))}
        </div>

        {/* gRPC service/method selectors */}
        {isGrpc && grpcServices.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Select
              value={tab.grpcServiceName || ""}
              onValueChange={(v) => {
                const svc = grpcServices.find((s) => s.fullName === v);
                updateActiveTab({
                  grpcServiceName: v,
                  grpcMethodName: svc?.methods[0]?.name ?? "",
                });
              }}
            >
              <SelectTrigger className="h-8 w-auto min-w-[140px] rounded-md border-border/60 bg-transparent font-mono text-[11px] text-foreground focus:ring-0 focus:ring-offset-0">
                <SelectValue placeholder="Service" />
              </SelectTrigger>
              <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                {grpcServices.map((s) => (
                  <SelectItem key={s.fullName} value={s.fullName} className="font-mono text-xs">
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground text-xs">/</span>
            <Select
              value={tab.grpcMethodName || ""}
              onValueChange={(v) => updateActiveTab({ grpcMethodName: v })}
            >
              <SelectTrigger className="h-8 w-auto min-w-[140px] rounded-md border-border/60 bg-transparent font-mono text-[11px] text-foreground focus:ring-0 focus:ring-offset-0">
                <SelectValue placeholder="Method" />
              </SelectTrigger>
              <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                {grpcMethods.map((m) => {
                  let streamLabel = "";
                  if (m.clientStreaming && m.serverStreaming) streamLabel = "bidi";
                  else if (m.serverStreaming) streamLabel = "server-stream";
                  else if (m.clientStreaming) streamLabel = "client-stream";

                  return (
                    <SelectItem key={m.name} value={m.name} className="font-mono text-xs">
                      {m.name}
                      {streamLabel && (
                        <span className="ml-1 text-[9px] text-muted-foreground">
                          {streamLabel}
                        </span>
                      )}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* URL bar */}
      <div className="panel-inset flex items-center gap-0 overflow-hidden rounded-xl">
        {!isGrpc && !isGraphql && !isWebsocket && (
          <Select
            value={tab.method}
            onValueChange={(v) => updateActiveTab({ method: v as HttpMethod })}
          >
            <SelectTrigger className={`h-11 w-[118px] rounded-none border-0 border-r border-border/80 bg-transparent font-mono text-sm font-bold ${methodTextColors[tab.method]} focus:ring-0 focus:ring-offset-0`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
              {methods.map((m) => (
                <SelectItem
                  key={m}
                  value={m}
                  className={`font-mono font-bold ${methodTextColors[m]}`}
                >
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {isGrpc && (
          <div className="flex h-11 items-center px-3 border-r border-border/80">
            <span className="font-mono text-sm font-bold text-purple-400">gRPC</span>
          </div>
        )}

        {isGraphql && (
          <div className="flex h-11 items-center px-3 border-r border-border/80">
            <span className="font-mono text-sm font-bold text-pink-400">GQL</span>
          </div>
        )}

        {isWebsocket && (
          <div className="flex h-11 items-center px-3 border-r border-border/80">
            <span className="font-mono text-sm font-bold text-emerald-400">WS</span>
          </div>
        )}

        <input
          className="h-11 flex-1 bg-transparent px-3 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
          placeholder={
            isGrpc ? "Enter gRPC server address (e.g., http://localhost:50051)"
            : isGraphql ? "Enter GraphQL endpoint URL (e.g., https://api.example.com/graphql)"
            : isWebsocket ? "Enter WebSocket URL (e.g., ws://localhost:8080)"
            : "Enter request URL or paste cURL..."
          }
          value={tab.url}
          onChange={(e) => {
            if (isGrpc || isGraphql || isWebsocket) {
              updateActiveTab({ url: e.target.value });
            } else {
              updateActiveTabUrl(e.target.value);
            }
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />

        {!isGrpc && !isGraphql && !isWebsocket && <RequestSettingsDialog />}
        {!isGrpc && !isGraphql && !isWebsocket && <PreviewResolvedDialog />}
        {!isGrpc && !isGraphql && !isWebsocket && (
          <button
            type="button"
            onClick={handleCopyAsCurl}
            disabled={!tab.url.trim()}
            className="flex h-11 items-center px-2.5 text-muted-foreground hover:text-foreground transition-colors border-r border-border/80 disabled:cursor-not-allowed disabled:opacity-50"
            title="Copy as cURL"
          >
            {curlCopied ? (
              <Check className="h-4 w-4 text-primary" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        )}
        {!isGrpc && !isGraphql && !isWebsocket && <CodeGeneratorDialog />}

        {store.isLoading ? (
          <button
            type="button"
            onClick={handleCancel}
            className="flex h-11 items-center gap-2 bg-destructive px-5 text-sm font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90"
          >
            <X className="h-4 w-4" />
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="flex h-11 items-center gap-2 bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {isWebsocket ? "Connect" : "Send"}
          </button>
        )}
      </div>
    </div>
  );
}
