"use client";

import { useState } from "react";
import {
  FolderOpen,
  FolderPlus,
  History,
  Globe,
  Cookie,
  ChevronRight,
  Trash2,
  Plus,
  Clock,
  ChevronDown,
  Search,
  Pencil,
  X,
} from "lucide-react";
import {
  useGetmanStore,
  setSidebarView,
  loadSavedRequest,
  loadHistoryItem,
  clearHistory,
  addCollection,
  deleteCollection,
  renameCollection,
  deleteRequestFromCollection,
  renameRequestInCollection,
  addFolderToCollection,
  deleteFolderFromCollection,
  renameFolderInCollection,
  setActiveEnvironment,
  addEnvironment,
  deleteEnvironment,
  updateEnvironment,
  updateGlobalVariables,
  upsertVaultSecret,
  removeVaultSecret,
  clearExpiredVaultSecrets,
  removeCookieEntry,
  clearCookieJar,
  createEmptyKV,
  type GetmanState,
  type CollectionFolder,
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
    { id: "cookies", icon: Cookie, label: "Cookies" },
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
  const [searchQuery, setSearchQuery] = useState("");
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [editingCollectionName, setEditingCollectionName] = useState("");
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [editingRequestName, setEditingRequestName] = useState("");

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

  const filteredCollections = searchQuery.trim()
    ? collections
        .map((col) => ({
          ...col,
          requests: col.requests.filter(
            (req) =>
              req.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              req.url.toLowerCase().includes(searchQuery.toLowerCase())
          ),
        }))
        .filter(
          (col) =>
            col.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            col.requests.length > 0
        )
    : collections;

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

      {/* Search bar */}
      <div className="px-2 py-1.5 border-b border-border/40">
        <div className="flex items-center gap-1.5 bg-[hsl(var(--surface-2))] rounded px-2 py-1">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
            placeholder="Search collections..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-1">
          {filteredCollections.map((col) => {
            const isExpanded = expandedIds.has(col.id);
            const isEditingCol = editingCollectionId === col.id;
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
                  {isEditingCol ? (
                    <input
                      className="flex-1 bg-[hsl(var(--surface-2))] border border-primary/50 rounded text-xs text-foreground px-1.5 py-0.5 outline-none"
                      value={editingCollectionName}
                      onChange={(e) => setEditingCollectionName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editingCollectionName.trim()) {
                          renameCollection(col.id, editingCollectionName.trim());
                          setEditingCollectionId(null);
                        } else if (e.key === "Escape") {
                          setEditingCollectionId(null);
                        }
                      }}
                      onBlur={() => {
                        if (editingCollectionName.trim()) {
                          renameCollection(col.id, editingCollectionName.trim());
                        }
                        setEditingCollectionId(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <span
                      className="text-xs text-foreground flex-1 truncate"
                      onDoubleClick={() => {
                        setEditingCollectionId(col.id);
                        setEditingCollectionName(col.name);
                      }}
                    >
                      {col.name}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {col.requests.length}
                  </span>
                  {!isEditingCol && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCollectionId(col.id);
                        setEditingCollectionName(col.name);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                      title="Rename collection"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteCollection(col.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const name = prompt("Folder name:");
                      if (name?.trim()) addFolderToCollection(col.id, name.trim());
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                    title="Add folder"
                  >
                    <FolderPlus className="h-3 w-3" />
                  </button>
                </div>
                {isExpanded && (
                  <>
                    {/* Folders */}
                    {(col.folders || []).map((folder) => {
                      const isFolderExpanded = expandedIds.has(folder.id);
                      return (
                        <div key={folder.id}>
                          <div className="group flex items-center gap-1.5 pl-6 pr-2 py-1.5 hover:bg-[hsl(var(--surface-2))] cursor-pointer">
                            <button
                              type="button"
                              onClick={() => toggleExpand(folder.id)}
                              className="text-muted-foreground"
                            >
                              {isFolderExpanded ? (
                                <ChevronDown className="h-3 w-3" />
                              ) : (
                                <ChevronRight className="h-3 w-3" />
                              )}
                            </button>
                            <FolderOpen className="h-3 w-3 text-amber-500/70 shrink-0" />
                            <span className="text-[11px] text-foreground/80 flex-1 truncate">
                              {folder.name}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {folder.requests.length}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const newName = prompt("Rename folder:", folder.name);
                                if (newName?.trim()) renameFolderInCollection(col.id, folder.id, newName.trim());
                              }}
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                            >
                              <Pencil className="h-2.5 w-2.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteFolderFromCollection(col.id, folder.id);
                              }}
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                            </button>
                          </div>
                          {isFolderExpanded &&
                            folder.requests.map((req) => (
                              <div
                                key={req.id}
                                className="group flex items-center gap-2 pl-12 pr-2 py-1.5 hover:bg-[hsl(var(--surface-2))] cursor-pointer"
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

                    {/* Root-level requests */}
                    {col.requests.map((req) => {
                    const isEditingReq = editingRequestId === req.id;
                    return (
                      <div
                        key={req.id}
                        className="group flex items-center gap-2 pl-8 pr-2 py-1.5 hover:bg-[hsl(var(--surface-2))] cursor-pointer"
                        onClick={() => !isEditingReq && loadSavedRequest(req)}
                        onKeyDown={(e) => e.key === "Enter" && !isEditingReq && loadSavedRequest(req)}
                        role="button"
                        tabIndex={0}
                      >
                        <MethodBadge method={req.method} size="sm" />
                        {isEditingReq ? (
                          <input
                            className="flex-1 bg-[hsl(var(--surface-2))] border border-primary/50 rounded text-xs text-foreground/80 font-mono px-1.5 py-0.5 outline-none"
                            value={editingRequestName}
                            onChange={(e) => setEditingRequestName(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter" && editingRequestName.trim()) {
                                renameRequestInCollection(col.id, req.id, editingRequestName.trim());
                                setEditingRequestId(null);
                              } else if (e.key === "Escape") {
                                setEditingRequestId(null);
                              }
                            }}
                            onBlur={() => {
                              if (editingRequestName.trim()) {
                                renameRequestInCollection(col.id, req.id, editingRequestName.trim());
                              }
                              setEditingRequestId(null);
                            }}
                            autoFocus
                          />
                        ) : (
                          <span
                            className="text-xs text-foreground/80 flex-1 truncate font-mono"
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setEditingRequestId(req.id);
                              setEditingRequestName(req.name);
                            }}
                          >
                            {req.name}
                          </span>
                        )}
                        {!isEditingReq && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingRequestId(req.id);
                              setEditingRequestName(req.name);
                            }}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                            title="Rename request"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
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
                    );
                  })}
                  </>
                )}
              </div>
            );
          })}
          {filteredCollections.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-muted-foreground">
                {searchQuery ? "No matching results" : "No collections yet"}
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
              <MethodBadge method={item.method} size="sm" requestType={item.requestType} />
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
  const { environments, activeEnvironmentId, globalVariables, vaultSecrets } = useGetmanStore();
  const [newEnvName, setNewEnvName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [globalsExpanded, setGlobalsExpanded] = useState(false);
  const [vaultExpanded, setVaultExpanded] = useState(false);
  const [vaultKey, setVaultKey] = useState("");
  const [vaultValue, setVaultValue] = useState("");
  const [vaultTtlSeconds, setVaultTtlSeconds] = useState(900);
  const now = Date.now();
  const activeVaultSecrets = vaultSecrets
    .filter((secret) => secret.expiresAt > now)
    .sort((a, b) => a.expiresAt - b.expiresAt);

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

  const handleSaveVaultSecret = () => {
    if (!vaultKey.trim()) return;
    upsertVaultSecret(vaultKey.trim(), vaultValue, vaultTtlSeconds);
    setVaultKey("");
    setVaultValue("");
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
          {/* Global Variables */}
          <div>
            <div
              className="group flex items-center gap-2 px-3 py-2 hover:bg-[hsl(var(--surface-2))] cursor-pointer transition-colors bg-[hsl(var(--surface-2)/.5)]"
            >
              <button
                type="button"
                onClick={() => setGlobalsExpanded(!globalsExpanded)}
                className="text-muted-foreground"
              >
                {globalsExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
              <Globe className="h-3.5 w-3.5 text-amber-500/70 shrink-0" />
              <span className="text-xs text-foreground flex-1 truncate font-medium">
                Globals
              </span>
              <span className="text-[10px] text-muted-foreground">
                {globalVariables.filter((v) => v.key).length}
              </span>
            </div>

            {globalsExpanded && (
              <div className="pl-8 pr-3 py-2 space-y-1.5">
                {globalVariables.map((v, i) => (
                  <div key={v.id} className="flex items-center gap-2">
                    <input
                      className="flex-1 bg-[hsl(var(--surface-2))] border border-border/50 rounded text-[11px] font-mono text-foreground px-2 py-1 outline-none focus:border-primary/50"
                      placeholder="KEY"
                      value={v.key}
                      onChange={(e) => {
                        const vars = [...globalVariables];
                        vars[i] = { ...v, key: e.target.value };
                        updateGlobalVariables(vars);
                      }}
                    />
                    <input
                      className="flex-1 bg-[hsl(var(--surface-2))] border border-border/50 rounded text-[11px] font-mono text-foreground px-2 py-1 outline-none focus:border-primary/50"
                      placeholder="value"
                      value={v.value}
                      onChange={(e) => {
                        const vars = [...globalVariables];
                        vars[i] = { ...v, value: e.target.value };
                        updateGlobalVariables(vars);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        updateGlobalVariables(
                          globalVariables.filter((_, idx) => idx !== i)
                        );
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
                    updateGlobalVariables([
                      ...globalVariables,
                      { ...createEmptyKV() },
                    ]);
                  }}
                  className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Add Variable
                </button>
              </div>
            )}
          </div>

          {/* Ephemeral Vault */}
          <div>
            <div
              className="group flex items-center gap-2 px-3 py-2 hover:bg-[hsl(var(--surface-2))] cursor-pointer transition-colors"
            >
              <button
                type="button"
                onClick={() => setVaultExpanded(!vaultExpanded)}
                className="text-muted-foreground"
              >
                {vaultExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
              <span className="h-3.5 w-3.5 rounded bg-emerald-500/20 text-emerald-500 text-[9px] font-bold flex items-center justify-center shrink-0">
                V
              </span>
              <span className="text-xs text-foreground flex-1 truncate font-medium">
                Vault (ephemeral)
              </span>
              <span className="text-[10px] text-muted-foreground">
                {activeVaultSecrets.length}
              </span>
            </div>

            {vaultExpanded && (
              <div className="pl-8 pr-3 py-2 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    className="flex-1 bg-[hsl(var(--surface-2))] border border-border/50 rounded text-[11px] font-mono text-foreground px-2 py-1 outline-none focus:border-primary/50"
                    placeholder="secret-key"
                    value={vaultKey}
                    onChange={(e) => setVaultKey(e.target.value)}
                  />
                  <input
                    className="flex-1 bg-[hsl(var(--surface-2))] border border-border/50 rounded text-[11px] font-mono text-foreground px-2 py-1 outline-none focus:border-primary/50"
                    placeholder="secret-value"
                    value={vaultValue}
                    onChange={(e) => setVaultValue(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className="w-24 bg-[hsl(var(--surface-2))] border border-border/50 rounded text-[11px] font-mono text-foreground px-2 py-1 outline-none focus:border-primary/50"
                    value={vaultTtlSeconds}
                    onChange={(e) => setVaultTtlSeconds(Math.max(1, Number(e.target.value) || 900))}
                    min={1}
                  />
                  <span className="text-[10px] text-muted-foreground">seconds TTL</span>
                  <button
                    type="button"
                    onClick={handleSaveVaultSecret}
                    className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => clearExpiredVaultSecrets()}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear Expired
                  </button>
                </div>

                {activeVaultSecrets.length > 0 && (
                  <div className="space-y-1.5">
                    {activeVaultSecrets.map((secret) => {
                      const ttlLeft = Math.max(0, Math.floor((secret.expiresAt - now) / 1000));
                      return (
                        <div key={secret.id} className="flex items-center gap-2 rounded border border-border/50 px-2 py-1">
                          <span className="font-mono text-[11px] text-foreground flex-1 truncate">
                            {secret.key}
                          </span>
                          <span className="text-[10px] text-amber-500">{ttlLeft}s</span>
                          <button
                            type="button"
                            onClick={() => removeVaultSecret(secret.key)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground">
                  Use in requests: {"{{$vault:your_key}}"}
                </div>
              </div>
            )}
          </div>

          {/* Environment-specific variables */}
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
          {environments.length === 0 && globalVariables.length === 0 && activeVaultSecrets.length === 0 && (
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

function CookiesView() {
  const { cookieJar } = useGetmanStore();
  const [searchQuery, setSearchQuery] = useState("");

  const formatExpires = (expires: string) => {
    if (!expires || expires === "Infinity") {
      return "Session";
    }
    const expiresAt = Date.parse(expires);
    if (Number.isNaN(expiresAt)) {
      return expires;
    }
    return new Date(expiresAt).toLocaleString();
  };

  const filteredCookies = cookieJar
    .filter((cookie) => {
      if (!searchQuery.trim()) {
        return true;
      }
      const query = searchQuery.toLowerCase();
      return (
        cookie.name.toLowerCase().includes(query) ||
        cookie.domain.toLowerCase().includes(query) ||
        cookie.value.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      const domainCompare = a.domain.localeCompare(b.domain);
      if (domainCompare !== 0) {
        return domainCompare;
      }
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border/60 bg-[hsl(var(--surface-1))] px-3 py-2">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Cookies
        </span>
        {cookieJar.length > 0 && (
          <button
            type="button"
            onClick={() => clearCookieJar()}
            className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      <div className="px-2 py-1.5 border-b border-border/40">
        <div className="flex items-center gap-1.5 bg-[hsl(var(--surface-2))] rounded px-2 py-1">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
            placeholder="Search cookies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-1">
          {filteredCookies.map((cookie) => (
            <div
              key={cookie.id}
              className="group border-b border-border/40 px-3 py-2 hover:bg-[hsl(var(--surface-2))] transition-colors"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-[hsl(var(--chart-2))] truncate">
                      {cookie.name}
                    </span>
                    <span className="text-xs font-mono text-foreground/80 truncate">
                      = {cookie.value}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground font-mono">
                    <span>
                      {cookie.domain}
                      {cookie.path || "/"}
                    </span>
                    <span>Expires: {formatExpires(cookie.expires)}</span>
                    {cookie.secure && <span className="text-green-500">Secure</span>}
                    {cookie.httpOnly && <span className="text-amber-500">HttpOnly</span>}
                    {cookie.sameSite && <span>SameSite: {cookie.sameSite}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeCookieEntry(cookie.id)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  title="Delete cookie"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
          {filteredCookies.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-muted-foreground">
                {cookieJar.length === 0
                  ? "No cookies captured yet"
                  : "No matching cookies"}
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
          {sidebarView === "cookies" && <CookiesView />}
        </div>
      </div>
    </div>
  );
}
