"use client";

import { useState } from "react";
import {
  FolderOpen,
  History,
  Globe,
  ChevronRight,
  Trash2,
  Plus,
  Clock,
  ChevronDown,
} from "lucide-react";
import {
  useGetmanStore,
  setSidebarView,
  loadSavedRequest,
  loadHistoryItem,
  clearHistory,
  addCollection,
  deleteCollection,
  deleteRequestFromCollection,
  setActiveEnvironment,
  addEnvironment,
  deleteEnvironment,
  updateEnvironment,
  createEmptyKV,
  type GetmanState,
} from "@/lib/getman-store";
import { MethodBadge } from "./method-badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function SidebarNav() {
  const { sidebarView } = useGetmanStore();

  const navItems: { id: GetmanState["sidebarView"]; icon: typeof FolderOpen; label: string }[] = [
    { id: "collections", icon: FolderOpen, label: "Collections" },
    { id: "environments", icon: Globe, label: "Environments" },
    { id: "history", icon: History, label: "History" },
  ];

  return (
    <div className="w-[72px] shrink-0 border-r border-border bg-[hsl(var(--surface-1))] p-0">
      {navItems.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => setSidebarView(id)}
          title={label}
          className={`mb-1 flex w-full flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[10px] transition-colors ${
            sidebarView === id
              ? "border-border bg-[hsl(var(--surface-1))] text-foreground"
              : "border-transparent text-muted-foreground hover:border-border hover:bg-[hsl(var(--surface-2))] hover:text-foreground"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="leading-tight text-center">
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}

function CollectionsView() {
  const { collections } = useGetmanStore();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    new Set(collections.map((c) => c.id))
  );
  const [newCollectionName, setNewCollectionName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateCollection = () => {
    if (newCollectionName.trim()) {
      addCollection(newCollectionName.trim());
      setNewCollectionName("");
      setDialogOpen(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border/60 bg-[hsl(var(--surface-1))] px-3 py-2">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Collections
        </span>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </DialogTrigger>
          <DialogContent className="bg-[hsl(var(--surface-1))] border-border sm:max-w-[350px]">
            <DialogHeader>
              <DialogTitle className="text-foreground text-sm">New Collection</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <input
                className="bg-[hsl(var(--surface-2))] border border-border rounded text-foreground text-sm px-3 py-2 outline-none focus:border-primary/50"
                placeholder="Collection name..."
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateCollection()}
                autoFocus
              />
              <button
                type="button"
                onClick={handleCreateCollection}
                className="bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded hover:bg-primary/90 transition-colors"
              >
                Create
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-1">
          {collections.map((col) => {
            const isExpanded = expandedIds.has(col.id);
            return (
              <div key={col.id}>
                <div className="group flex items-center gap-1.5 px-2 py-1.5 hover:bg-[hsl(var(--surface-2))] cursor-pointer">
                  <button
                    type="button"
                    onClick={() => toggleExpand(col.id)}
                    className="text-muted-foreground"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <FolderOpen className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                  <span className="text-xs text-foreground flex-1 truncate">
                    {col.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {col.requests.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteCollection(col.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                {isExpanded &&
                  col.requests.map((req) => (
                    <div
                      key={req.id}
                      className="group flex items-center gap-2 pl-8 pr-2 py-1.5 hover:bg-[hsl(var(--surface-2))] cursor-pointer"
                      onClick={() => loadSavedRequest(req)}
                      onKeyDown={(e) => e.key === "Enter" && loadSavedRequest(req)}
                      role="button"
                      tabIndex={0}
                    >
                      <MethodBadge method={req.method} size="sm" />
                      <span className="text-xs text-foreground/80 flex-1 truncate font-mono">
                        {req.name}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteRequestFromCollection(col.id, req.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
              </div>
            );
          })}
          {collections.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-muted-foreground">
                No collections yet
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function HistoryView() {
  const { history } = useGetmanStore();

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border/60 bg-[hsl(var(--surface-1))] px-3 py-2">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          History
        </span>
        {history.length > 0 && (
          <button
            type="button"
            onClick={clearHistory}
            className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className="py-1">
          {history.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 px-3 py-2 hover:bg-[hsl(var(--surface-2))] cursor-pointer transition-colors"
              onClick={() => loadHistoryItem(item)}
              onKeyDown={(e) => e.key === "Enter" && loadHistoryItem(item)}
              role="button"
              tabIndex={0}
            >
              <MethodBadge method={item.method} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-foreground/80 font-mono truncate">
                  {item.url.replace(/^https?:\/\//, "")}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`text-[10px] font-mono font-bold ${
                    item.status >= 200 && item.status < 300
                      ? "text-[hsl(var(--method-get))]"
                      : item.status >= 400
                        ? "text-[hsl(var(--method-delete))]"
                        : "text-muted-foreground"
                  }`}
                >
                  {item.status}
                </span>
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" />
                  {formatTime(item.timestamp)}
                </span>
              </div>
            </div>
          ))}
          {history.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-muted-foreground">
                No history yet. Send a request to get started.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function EnvironmentsView() {
  const { environments, activeEnvironmentId } = useGetmanStore();
  const [newEnvName, setNewEnvName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    if (newEnvName.trim()) {
      addEnvironment(newEnvName.trim());
      setNewEnvName("");
      setDialogOpen(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border/60 bg-[hsl(var(--surface-1))] px-3 py-2">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Environments
        </span>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </DialogTrigger>
          <DialogContent className="bg-[hsl(var(--surface-1))] border-border sm:max-w-[350px]">
            <DialogHeader>
              <DialogTitle className="text-foreground text-sm">New Environment</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <input
                className="bg-[hsl(var(--surface-2))] border border-border rounded text-foreground text-sm px-3 py-2 outline-none focus:border-primary/50"
                placeholder="Environment name..."
                value={newEnvName}
                onChange={(e) => setNewEnvName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
              <button
                type="button"
                onClick={handleCreate}
                className="bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded hover:bg-primary/90 transition-colors"
              >
                Create
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-1">
          {environments.map((env) => {
            const isActive = env.id === activeEnvironmentId;
            const isExpanded = expandedIds.has(env.id);

            return (
              <div key={env.id}>
                <div
                  className={`group flex items-center gap-2 px-3 py-2 hover:bg-[hsl(var(--surface-2))] cursor-pointer transition-colors ${
                    isActive ? "bg-[hsl(var(--surface-2))]" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleExpand(env.id)}
                    className="text-muted-foreground"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveEnvironment(isActive ? null : env.id)
                    }
                    className="flex-1 flex items-center gap-2 text-left"
                  >
                    <div
                      className={`h-2 w-2 rounded-full shrink-0 ${
                        isActive ? "bg-primary" : "bg-muted-foreground/30"
                      }`}
                    />
                    <span className="text-xs text-foreground truncate">
                      {env.name}
                    </span>
                    {isActive && (
                      <span className="text-[9px] bg-primary/20 text-primary px-1.5 rounded font-medium">
                        ACTIVE
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteEnvironment(env.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>

                {isExpanded && (
                  <div className="pl-8 pr-3 py-2 space-y-1.5">
                    {env.variables.map((v, i) => (
                      <div key={v.id} className="flex items-center gap-2">
                        <input
                          className="flex-1 bg-[hsl(var(--surface-2))] border border-border/50 rounded text-[11px] font-mono text-foreground px-2 py-1 outline-none focus:border-primary/50"
                          placeholder="KEY"
                          value={v.key}
                          onChange={(e) => {
                            const variables = [...env.variables];
                            variables[i] = { ...v, key: e.target.value };
                            updateEnvironment(env.id, { variables });
                          }}
                        />
                        <input
                          className="flex-1 bg-[hsl(var(--surface-2))] border border-border/50 rounded text-[11px] font-mono text-foreground px-2 py-1 outline-none focus:border-primary/50"
                          placeholder="value"
                          value={v.value}
                          onChange={(e) => {
                            const variables = [...env.variables];
                            variables[i] = { ...v, value: e.target.value };
                            updateEnvironment(env.id, { variables });
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const variables = env.variables.filter(
                              (_, idx) => idx !== i
                            );
                            updateEnvironment(env.id, { variables });
                          }}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        updateEnvironment(env.id, {
                          variables: [...env.variables, { ...createEmptyKV() }],
                        });
                      }}
                      className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                      Add Variable
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {environments.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-muted-foreground">
                No environments configured
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export function GetmanSidebar() {
  const { sidebarView } = useGetmanStore();

  return (
    <div className="flex h-full bg-[hsl(var(--surface-2))]">
      <SidebarNav />
      <div className="min-w-0 flex-1">
        <div className="h-full overflow-hidden bg-[hsl(var(--surface-1))]">
          {sidebarView === "collections" && <CollectionsView />}
          {sidebarView === "history" && <HistoryView />}
          {sidebarView === "environments" && <EnvironmentsView />}
        </div>
      </div>
    </div>
  );
}
