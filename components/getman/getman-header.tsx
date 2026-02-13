"use client";

import dynamic from "next/dynamic";
import { PanelLeftClose, PanelLeft, Zap } from "lucide-react";
import {
  useGetmanStore,
  setSidebarOpen,
  setActiveEnvironment,
} from "@/lib/getman-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ImportExportDialog = dynamic(
  () => import("./import-export-dialog").then((mod) => mod.ImportExportDialog),
  { ssr: false }
);
const CollectionRunnerDialog = dynamic(
  () => import("./collection-runner-dialog").then((mod) => mod.CollectionRunnerDialog),
  { ssr: false }
);

export function GetmanHeader() {
  const { sidebarOpen, environments, activeEnvironmentId } = useGetmanStore();

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-[hsl(var(--surface-1))] px-3">
      <button
        type="button"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-[hsl(var(--surface-1))] text-muted-foreground transition-colors hover:text-foreground"
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
      >
        {sidebarOpen ? (
          <PanelLeftClose className="h-4 w-4" />
        ) : (
          <PanelLeft className="h-4 w-4" />
        )}
      </button>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Getman
          </span>
        </div>
        <span className="rounded-full border border-border bg-[hsl(var(--surface-2))] px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
          v1.0
        </span>
      </div>

      <div className="flex items-center gap-1 ml-2">
        <ImportExportDialog />
        <CollectionRunnerDialog />
      </div>

      <div className="flex-1" />

      <Select
        value={activeEnvironmentId || "none"}
        onValueChange={(v) =>
          setActiveEnvironment(v === "none" ? null : v)
        }
      >
        <SelectTrigger className="h-8 w-[176px] rounded-md border-border bg-[hsl(var(--surface-1))] text-[11px] focus:ring-2 focus:ring-[hsl(var(--ring)/0.25)] focus:ring-offset-0">
          <SelectValue placeholder="No Environment" />
        </SelectTrigger>
        <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
          <SelectItem value="none" className="text-xs">
            No Environment
          </SelectItem>
          {environments.map((env) => (
            <SelectItem key={env.id} value={env.id} className="text-xs">
              {env.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </header>
  );
}
