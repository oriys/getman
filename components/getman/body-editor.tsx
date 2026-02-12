"use client";

import {
  useActiveTab,
  updateActiveTab,
  type RequestTab,
} from "@/lib/getman-store";
import { KVEditor } from "./kv-editor";

const bodyTypes: { value: RequestTab["bodyType"]; label: string }[] = [
  { value: "none", label: "None" },
  { value: "json", label: "JSON" },
  { value: "form-data", label: "Form Data" },
  { value: "x-www-form-urlencoded", label: "x-www-form-urlencoded" },
  { value: "raw", label: "Raw" },
];

export function BodyEditor() {
  const tab = useActiveTab();
  if (!tab) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 border-b border-border/60 bg-[hsl(var(--surface-1))] px-3 py-2">
        {bodyTypes.map((bt) => (
          <button
            key={bt.value}
            type="button"
            onClick={() => updateActiveTab({ bodyType: bt.value })}
            className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
              tab.bodyType === bt.value
                ? "border-primary/25 bg-primary/10 text-primary font-medium"
                : "border-transparent text-muted-foreground hover:border-border/70 hover:text-foreground"
            }`}
          >
            {bt.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {tab.bodyType === "none" && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            This request does not have a body
          </div>
        )}

        {(tab.bodyType === "json" || tab.bodyType === "raw") && (
          <textarea
            className="h-full w-full resize-none bg-transparent p-3 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/40"
            placeholder={
              tab.bodyType === "json"
                ? '{\n  "key": "value"\n}'
                : "Enter raw body content..."
            }
            value={tab.bodyContent}
            onChange={(e) => updateActiveTab({ bodyContent: e.target.value })}
            spellCheck={false}
          />
        )}

        {(tab.bodyType === "form-data" ||
          tab.bodyType === "x-www-form-urlencoded") && (
          <KVEditor
            items={tab.bodyFormData}
            onChange={(bodyFormData) => updateActiveTab({ bodyFormData })}
            keyPlaceholder="Key"
            valuePlaceholder="Value"
          />
        )}
      </div>
    </div>
  );
}
