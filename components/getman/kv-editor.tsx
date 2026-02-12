"use client";

import { Plus, Trash2 } from "lucide-react";
import { type KeyValue, createEmptyKV } from "@/lib/getman-store";
import { Checkbox } from "@/components/ui/checkbox";

interface KVEditorProps {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export function KVEditor({
  items,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
}: KVEditorProps) {
  const update = (id: string, partial: Partial<KeyValue>) => {
    onChange(items.map((i) => (i.id === id ? { ...i, ...partial } : i)));
  };

  const remove = (id: string) => {
    if (items.length <= 1) return;
    onChange(items.filter((i) => i.id !== id));
  };

  const add = () => {
    onChange([...items, createEmptyKV()]);
  };

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[28px_1fr_1fr_28px] gap-0 border-b border-border/60 bg-[hsl(var(--surface-1))] px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
        <span />
        <span className="px-2">{keyPlaceholder}</span>
        <span className="px-2">{valuePlaceholder}</span>
        <span />
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          className="group grid grid-cols-[28px_1fr_1fr_28px] items-center gap-0 border-b border-border/45 hover:bg-[hsl(var(--surface-2))]"
        >
          <div className="flex items-center justify-center">
            <Checkbox
              checked={item.enabled}
              onCheckedChange={(v) => update(item.id, { enabled: !!v })}
              className="h-3.5 w-3.5"
            />
          </div>
          <input
            className="border-r border-border/50 bg-transparent px-2 py-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/40"
            placeholder={keyPlaceholder}
            value={item.key}
            onChange={(e) => update(item.id, { key: e.target.value })}
          />
          <input
            className="bg-transparent px-2 py-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/40"
            placeholder={valuePlaceholder}
            value={item.value}
            onChange={(e) => update(item.id, { value: e.target.value })}
          />
          <button
            type="button"
            onClick={() => remove(item.id)}
            className="flex items-center justify-center opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Plus className="h-3 w-3" />
        Add
      </button>
    </div>
  );
}
