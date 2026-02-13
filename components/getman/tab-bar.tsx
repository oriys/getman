"use client";

import { Plus, X, Copy } from "lucide-react";
import {
  useGetmanStore,
  setActiveTabId,
  addTab,
  closeTab,
  duplicateTab,
} from "@/lib/getman-store";
import { MethodBadge } from "./method-badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

export function TabBar() {
  const { tabs, activeTabId } = useGetmanStore();

  return (
    <div className="flex shrink-0 items-center border-b border-border bg-[hsl(var(--surface-2))] px-2 py-1">
      <ScrollArea className="flex-1">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const isGrpc = (tab.requestType ?? "http") === "grpc";
            const displayText = isGrpc
              ? (tab.grpcMethodName || tab.url?.replace(/^https?:\/\//, "").slice(0, 30) || tab.name)
              : (tab.url ? tab.url.replace(/^https?:\/\//, "").slice(0, 30) : tab.name);

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTabId(tab.id)}
                className={`group flex min-w-[150px] max-w-[240px] items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors ${
                  isActive
                    ? "border-border bg-[hsl(var(--surface-1))] text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-[hsl(var(--surface-1))] hover:text-foreground"
                }`}
              >
                {isGrpc ? (
                  <span className="font-mono font-bold text-purple-400 bg-purple-400/10 rounded px-1.5 text-[10px] py-0">
                    gRPC
                  </span>
                ) : (
                  <MethodBadge method={tab.method} size="sm" />
                )}
                <span className="truncate flex-1 text-left font-mono">
                  {displayText}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    duplicateTab(tab.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation();
                      duplicateTab(tab.id);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:text-primary transition-opacity"
                  title="Duplicate Tab"
                >
                  <Copy className="h-3 w-3" />
                </span>
                {tabs.length > 1 && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      <button
        type="button"
        onClick={addTab}
        className="ml-2 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-[hsl(var(--surface-1))] text-muted-foreground transition-colors hover:text-foreground"
        title="New Tab"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
