"use client";

import React, { useState } from "react"

import { Send, Loader2, Code, Check } from "lucide-react";
import {
  useActiveTab,
  useGetmanStore,
  updateActiveTab,
  setResponse,
  setIsLoading,
  addHistoryItem,
  resolveEnvVariables,
  uid,
  type HttpMethod,
} from "@/lib/getman-store";
import { sendHttpRequest } from "@/lib/tauri";
import { isCurlCommand, parseCurlCommand } from "@/lib/curl-parser";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

function buildCurlCommand(tab: NonNullable<ReturnType<typeof useActiveTab>>): string {
  const parts: string[] = ["curl"];

  if (tab.method !== "GET") {
    parts.push(`-X ${tab.method}`);
  }

  const resolvedUrl = resolveEnvVariables(tab.url);
  try {
    const url = new URL(resolvedUrl);
    for (const p of tab.params) {
      if (p.enabled && p.key) {
        url.searchParams.set(p.key, resolveEnvVariables(p.value));
      }
    }
    if (tab.authType === "api-key" && tab.authApiAddTo === "query") {
      url.searchParams.set(resolveEnvVariables(tab.authApiKey), resolveEnvVariables(tab.authApiValue));
    }
    parts.push(`'${url.toString()}'`);
  } catch {
    parts.push(`'${resolvedUrl}'`);
  }

  const headers: Record<string, string> = {};
  for (const h of tab.headers) {
    if (h.enabled && h.key) {
      headers[h.key] = resolveEnvVariables(h.value);
    }
  }
  if (tab.authType === "bearer" && tab.authToken) {
    headers["Authorization"] = `Bearer ${resolveEnvVariables(tab.authToken)}`;
  } else if (tab.authType === "basic" && tab.authUsername) {
    headers["Authorization"] = `Basic ${btoa(`${resolveEnvVariables(tab.authUsername)}:${resolveEnvVariables(tab.authPassword)}`)}`;
  } else if (tab.authType === "api-key" && tab.authApiAddTo === "header") {
    headers[resolveEnvVariables(tab.authApiKey)] = resolveEnvVariables(tab.authApiValue);
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(tab.method)) {
    if (tab.bodyType === "json") {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
    } else if (tab.bodyType === "x-www-form-urlencoded") {
      headers["Content-Type"] = headers["Content-Type"] || "application/x-www-form-urlencoded";
    }
  }

  for (const [key, value] of Object.entries(headers)) {
    parts.push(`-H '${key}: ${value}'`);
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(tab.method)) {
    if (tab.bodyType === "json" || tab.bodyType === "raw") {
      const body = resolveEnvVariables(tab.bodyContent);
      if (body) parts.push(`-d '${body.replace(/'/g, "'\\''")}'`);
    } else if (tab.bodyType === "x-www-form-urlencoded") {
      const params = new URLSearchParams();
      for (const f of tab.bodyFormData) {
        if (f.enabled && f.key) params.set(f.key, resolveEnvVariables(f.value));
      }
      const body = params.toString();
      if (body) parts.push(`-d '${body}'`);
    } else if (tab.bodyType === "form-data") {
      for (const f of tab.bodyFormData) {
        if (f.enabled && f.key) parts.push(`-F '${f.key}=${resolveEnvVariables(f.value)}'`);
      }
    }
  }

  return parts.join(" \\\n  ");
}

export function RequestBar() {
  const store = useGetmanStore();
  const tab = useActiveTab();
  const [curlCopied, setCurlCopied] = useState(false);
  if (!tab) return null;

  const sendRequest = async () => {
    if (!tab.url.trim()) return;

    setIsLoading(true);
    setResponse(null);

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

      const data = await sendHttpRequest({
        url: url.toString(),
        method: tab.method,
        headers,
        body,
      });
      setResponse(data);

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
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendRequest();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
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

  return (
    <div className="panel-inset flex items-center gap-0 overflow-hidden rounded-xl">
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

      <input
        className="h-11 flex-1 bg-transparent px-3 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
        placeholder="Enter request URL or paste cURL..."
        value={tab.url}
        onChange={(e) => updateActiveTab({ url: e.target.value })}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
      />

      <button
        type="button"
        onClick={() => {
          const curl = buildCurlCommand(tab);
          navigator.clipboard.writeText(curl);
          setCurlCopied(true);
          setTimeout(() => setCurlCopied(false), 2000);
        }}
        disabled={!tab.url.trim()}
        className="flex h-11 items-center gap-1.5 border-l border-border/80 px-3 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        title="Copy as cURL"
      >
        {curlCopied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Code className="h-3.5 w-3.5" />}
      </button>

      <button
        type="button"
        onClick={sendRequest}
        disabled={store.isLoading || !tab.url.trim()}
        className="flex h-11 items-center gap-2 bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {store.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        Send
      </button>
    </div>
  );
}
