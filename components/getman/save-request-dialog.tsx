"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import {
  useGetmanStore,
  useActiveTab,
  saveRequestToCollection,
  uid,
} from "@/lib/getman-store";
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

export function SaveRequestDialog() {
  const { collections } = useGetmanStore();
  const tab = useActiveTab();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [collectionId, setCollectionId] = useState(collections[0]?.id || "");

  if (!tab) return null;

  const handleSave = () => {
    if (!name.trim() || !collectionId) return;
    saveRequestToCollection(collectionId, {
      id: uid(),
      name: name.trim(),
      method: tab.method,
      url: tab.url,
      tab: { ...tab },
    });
    setName("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md border border-border bg-[hsl(var(--surface-1))] px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          title="Save Request"
        >
          <Save className="h-3.5 w-3.5" />
          Save
        </button>
      </DialogTrigger>
      <DialogContent className="border-border bg-[hsl(var(--surface-1))] sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-foreground text-sm">
            Save Request
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">
              Name
            </label>
            <input
              className="rounded border border-border bg-[hsl(var(--surface-1))] px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
              placeholder="Request name..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">
              Collection
            </label>
            <Select value={collectionId} onValueChange={setCollectionId}>
              <SelectTrigger className="h-9 border-border bg-[hsl(var(--surface-1))] text-sm">
                <SelectValue placeholder="Select collection..." />
              </SelectTrigger>
              <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                {collections.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-sm">
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={!name.trim() || !collectionId}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save Request
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
