"use client";

import React from "react"

import { Send, Loader2 } from "lucide-react";
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

export function RequestBar() {
  const store = useGetmanStore();
  const tab = useActiveTab();
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
      />

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
