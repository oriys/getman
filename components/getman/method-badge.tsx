"use client";

import type { HttpMethod, RequestType } from "@/lib/getman-store";

const methodColors: Record<HttpMethod, string> = {
  GET: "text-[hsl(var(--method-get))]",
  POST: "text-[hsl(var(--method-post))]",
  PUT: "text-[hsl(var(--method-put))]",
  PATCH: "text-[hsl(var(--method-patch))]",
  DELETE: "text-[hsl(var(--method-delete))]",
  HEAD: "text-[hsl(var(--method-head))]",
  OPTIONS: "text-[hsl(var(--method-options))]",
};

const methodBg: Record<HttpMethod, string> = {
  GET: "bg-[hsl(var(--method-get)/.1)]",
  POST: "bg-[hsl(var(--method-post)/.1)]",
  PUT: "bg-[hsl(var(--method-put)/.1)]",
  PATCH: "bg-[hsl(var(--method-patch)/.1)]",
  DELETE: "bg-[hsl(var(--method-delete)/.1)]",
  HEAD: "bg-[hsl(var(--method-head)/.1)]",
  OPTIONS: "bg-[hsl(var(--method-options)/.1)]",
};

export function MethodBadge({
  method,
  size = "sm",
  requestType,
}: {
  method: HttpMethod;
  size?: "sm" | "md";
  requestType?: RequestType;
}) {
  if (requestType === "grpc") {
    return (
      <span className={`font-mono font-bold text-purple-400 bg-purple-400/10 rounded px-1.5 ${size === "sm" ? "text-[10px] py-0" : "text-xs py-0.5"}`}>
        gRPC
      </span>
    );
  }
  if (requestType === "graphql") {
    return (
      <span className={`font-mono font-bold text-pink-400 bg-pink-400/10 rounded px-1.5 ${size === "sm" ? "text-[10px] py-0" : "text-xs py-0.5"}`}>
        GQL
      </span>
    );
  }
  if (requestType === "websocket") {
    return (
      <span className={`font-mono font-bold text-emerald-400 bg-emerald-400/10 rounded px-1.5 ${size === "sm" ? "text-[10px] py-0" : "text-xs py-0.5"}`}>
        WS
      </span>
    );
  }
  return (
    <span
      className={`font-mono font-bold ${methodColors[method]} ${methodBg[method]} rounded px-1.5 ${
        size === "sm" ? "text-[10px] py-0" : "text-xs py-0.5"
      }`}
    >
      {method}
    </span>
  );
}
