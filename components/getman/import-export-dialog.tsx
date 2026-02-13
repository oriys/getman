"use client";

import { useState, useRef } from "react";
import { Upload, Download, FileJson } from "lucide-react";
import {
  useGetmanStore,
  importCollections,
  getCollections,
  type Collection,
} from "@/lib/getman-store";
import { importPostmanCollection, exportPostmanCollection } from "@/lib/postman";
import { exportCliFormat, exportShellScript } from "@/lib/cli-export";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ImportExportDialog() {
  const { collections } = useGetmanStore();
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [exportCollectionId, setExportCollectionId] = useState<string>("");
  const [exportFormat, setExportFormat] = useState<"postman" | "cli-json" | "shell">("postman");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportError(null);
    setImportSuccess(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const content = ev.target?.result as string;
        const collection = importPostmanCollection(content);
        importCollections([collection]);
        setImportSuccess(`Imported "${collection.name}" with ${collection.requests.length} requests`);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : "Failed to import collection");
      }
    };
    reader.readAsText(file);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleExport = () => {
    const collection = collections.find((c) => c.id === exportCollectionId);
    if (!collection) return;

    let content: string;
    let filename: string;

    switch (exportFormat) {
      case "postman":
        content = exportPostmanCollection(collection);
        filename = `${collection.name}.postman_collection.json`;
        break;
      case "cli-json":
        content = exportCliFormat(collection);
        filename = `${collection.name}.getman.json`;
        break;
      case "shell":
        content = exportShellScript(collection);
        filename = `${collection.name}.sh`;
        break;
    }

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
          title="Import/Export Collections"
        >
          <FileJson className="h-3 w-3" />
          Import/Export
        </button>
      </DialogTrigger>
      <DialogContent className="bg-[hsl(var(--surface-1))] border-border sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="text-foreground text-sm">Import / Export</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {/* Import Section */}
          <div className="flex flex-col gap-3">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Import
            </span>
            <p className="text-xs text-muted-foreground">
              Import a Postman Collection v2.1 JSON file
            </p>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
                id="import-file"
              />
              <label
                htmlFor="import-file"
                className="inline-flex items-center gap-1.5 bg-[hsl(var(--surface-2))] border border-border text-foreground text-xs font-medium px-4 py-2 rounded cursor-pointer hover:bg-[hsl(var(--surface-2))]/80 transition-colors"
              >
                <Upload className="h-3 w-3" />
                Choose File
              </label>
            </div>
            {importError && (
              <p className="text-xs text-red-500">{importError}</p>
            )}
            {importSuccess && (
              <p className="text-xs text-green-500">{importSuccess}</p>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-border/50" />

          {/* Export Section */}
          <div className="flex flex-col gap-3">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Export
            </span>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Collection</label>
              <Select value={exportCollectionId} onValueChange={setExportCollectionId}>
                <SelectTrigger className="h-8 border-border bg-[hsl(var(--surface-2))] text-xs">
                  <SelectValue placeholder="Select a collection" />
                </SelectTrigger>
                <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                  {collections.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Format</label>
              <Select value={exportFormat} onValueChange={(v) => setExportFormat(v as typeof exportFormat)}>
                <SelectTrigger className="h-8 border-border bg-[hsl(var(--surface-2))] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                  <SelectItem value="postman" className="text-xs">Postman Collection v2.1</SelectItem>
                  <SelectItem value="cli-json" className="text-xs">Getman CLI (JSON)</SelectItem>
                  <SelectItem value="shell" className="text-xs">Shell Script (bash)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <button
              type="button"
              onClick={handleExport}
              disabled={!exportCollectionId}
              className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-medium px-4 py-2 rounded hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-fit"
            >
              <Download className="h-3 w-3" />
              Export
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
