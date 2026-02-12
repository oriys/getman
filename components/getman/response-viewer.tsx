"use client";

import { useState, useMemo } from "react";
import { Copy, Check } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGetmanStore, type ResponseData } from "@/lib/getman-store";

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

function ResponseBody({ response }: { response: ResponseData }) {
  const isJSON = response.contentType.includes("json") || (() => {
    try { JSON.parse(response.body); return true; } catch { return false; }
  })();

  const isHTML = response.contentType.includes("html");
  const isImage = response.contentType.includes("image");

  if (isImage) {
    return (
      <div className="flex items-center justify-center p-4">
        <p className="text-muted-foreground text-sm">Image preview not supported in proxy mode</p>
      </div>
    );
  }

  if (isJSON) {
    return <SyntaxHighlightedJSON json={response.body} />;
  }

  if (isHTML) {
    return (
      <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-all text-foreground">
        {response.body}
      </pre>
    );
  }

  return (
    <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-all text-foreground">
      {response.body}
    </pre>
  );
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

export function ResponseViewer() {
  const { response, isLoading } = useGetmanStore();

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

  if (!response) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-[hsl(var(--surface-2))]">
          <Send className="h-5 w-5" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground/70">No response yet</p>
          <p className="text-xs mt-1">Enter a URL and click Send to get started</p>
        </div>
      </div>
    );
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
      </div>

      {/* Tabs */}
      <Tabs defaultValue="body" className="flex flex-col flex-1 min-h-0">
        <TabsList className="h-auto shrink-0 gap-0 rounded-none border-b border-border/70 bg-transparent p-0">
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
        </TabsList>

        <TabsContent value="body" className="m-0 min-h-0 flex-1 overflow-auto p-4">
          <ResponseBody response={response} />
        </TabsContent>

        <TabsContent value="headers" className="m-0 flex-1 overflow-auto min-h-0">
          <ResponseHeaders headers={response.headers} />
        </TabsContent>

        <TabsContent value="cookies" className="m-0 flex-1 overflow-auto min-h-0">
          <ResponseCookies headers={response.headers} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Send({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
      <path d="m21.854 2.147-10.94 10.939" />
    </svg>
  );
}
