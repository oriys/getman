"use client";

import React from "react"

import { Send, Loader2, X, Settings2 } from "lucide-react";
import {
  useActiveTab,
  useGetmanStore,
  updateActiveTab,
  setResponse,
  setGrpcResponse,
  setIsLoading,
  setActiveRequestId,
  setAssertionResults,
  addHistoryItem,
  resolveEnvVariables,
  uid,
  type HttpMethod,
  type RequestSettings,
  type RequestType,
  defaultSettings,
} from "@/lib/getman-store";
import { sendHttpRequest, cancelHttpRequest, sendGrpcRequest, parseProtoContent } from "@/lib/tauri";
import { runAssertions } from "@/lib/assertions";
import { isCurlCommand, parseCurlCommand } from "@/lib/curl-parser";
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

export function RequestBar() {
  const store = useGetmanStore();
  const tab = useActiveTab();
  if (!tab) return null;

  const isGrpc = (tab.requestType ?? "http") === "grpc";

  const handleCancel = async () => {
    if (store.activeRequestId) {
      await cancelHttpRequest(store.activeRequestId);
      setIsLoading(false);
      setActiveRequestId(null);
    }
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
      const resolvedUrl = resolveEnvVariables(tab.url);

      // Build query params
      const url = new URL(resolvedUrl);
      for (const p of tab.params) {
        if (p.enabled && p.key) {
          url.searchParams.set(p.key, resolveEnvVariables(p.value));
        }
      }

      // Auth query params
      if (tab.authType === "api-key" && tab.authApiAddTo === "query") {
        url.searchParams.set(
          resolveEnvVariables(tab.authApiKey),
          resolveEnvVariables(tab.authApiValue)
        );
      }

      // Build headers
      const headers: Record<string, string> = {};
      for (const h of tab.headers) {
        if (h.enabled && h.key) {
          headers[h.key] = resolveEnvVariables(h.value);
        }
      }

      // Cookies
      const cookies = tab.cookies ?? [];
      const cookieParts: string[] = [];
      for (const c of cookies) {
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
        const encoded = btoa(
          `${resolveEnvVariables(tab.authUsername)}:${resolveEnvVariables(tab.authPassword)}`
        );
        headers["Authorization"] = `Basic ${encoded}`;
      } else if (
        tab.authType === "api-key" &&
        tab.authApiAddTo === "header"
      ) {
        headers[resolveEnvVariables(tab.authApiKey)] = resolveEnvVariables(
          tab.authApiValue
        );
      } else if (tab.authType === "oauth2" && tab.oauth2AccessToken) {
        headers["Authorization"] = `Bearer ${resolveEnvVariables(tab.oauth2AccessToken)}`;
      }

      // Build body
      let body: string | undefined;
      if (!["GET", "HEAD", "OPTIONS"].includes(tab.method)) {
        if (tab.bodyType === "json") {
          headers["Content-Type"] = headers["Content-Type"] || "application/json";
          body = resolveEnvVariables(tab.bodyContent);
        } else if (tab.bodyType === "raw") {
          body = resolveEnvVariables(tab.bodyContent);
        } else if (tab.bodyType === "x-www-form-urlencoded") {
          headers["Content-Type"] =
            headers["Content-Type"] || "application/x-www-form-urlencoded";
          const params = new URLSearchParams();
          for (const f of tab.bodyFormData) {
            if (f.enabled && f.key)
              params.set(f.key, resolveEnvVariables(f.value));
          }
          body = params.toString();
        } else if (tab.bodyType === "form-data") {
          // form-data sent as JSON key-values for proxy
          const obj: Record<string, string> = {};
          for (const f of tab.bodyFormData) {
            if (f.enabled && f.key) obj[f.key] = resolveEnvVariables(f.value);
          }
          headers["Content-Type"] = headers["Content-Type"] || "application/json";
          body = JSON.stringify(obj);
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
        } else if (tab.bodyType === "binary") {
          headers["Content-Type"] = headers["Content-Type"] || "application/octet-stream";
          body = tab.bodyContent;
        }
      }

      const settings = tab.settings || defaultSettings();

      const data = await sendHttpRequest({
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
      });
      setResponse(data);

      // Run assertions
      if (tab.assertions && tab.assertions.length > 0) {
        const results = runAssertions(tab.assertions, data);
        setAssertionResults(results);
      }

      addHistoryItem({
        id: uid(),
        method: tab.method,
        url: tab.url,
        status: data.status,
        time: data.time,
        timestamp: Date.now(),
      });
    } catch {
      setResponse({
        status: 0,
        statusText: "Network Error",
        headers: {},
        body: "Failed to connect. Check the URL and try again.",
        time: 0,
        size: 0,
        contentType: "text/plain",
      });
    } finally {
      setIsLoading(false);
      setActiveRequestId(null);
    }
  };

  const handleSend = isGrpc ? sendGrpc : sendRequest;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (isGrpc) return;
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
    : tab.url.trim();

  const grpcServices = tab.grpcServices ?? [];
  const selectedService = grpcServices.find((s) => s.fullName === tab.grpcServiceName);
  const grpcMethods = selectedService?.methods ?? [];

  return (
    <div className="flex flex-col gap-2">
      {/* Protocol toggle */}
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-border/60 overflow-hidden">
          {(["http", "grpc"] as RequestType[]).map((type) => (
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
        {!isGrpc && (
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

        <input
          className="h-11 flex-1 bg-transparent px-3 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
          placeholder={isGrpc ? "Enter gRPC server address (e.g., http://localhost:50051)" : "Enter request URL or paste cURL..."}
          value={tab.url}
          onChange={(e) => updateActiveTab({ url: e.target.value })}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />

        {!isGrpc && <RequestSettingsDialog />}
        {!isGrpc && <CodeGeneratorDialog />}

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
            Send
          </button>
        )}
      </div>
    </div>
  );
}
