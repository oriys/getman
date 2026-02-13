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
  { value: "graphql", label: "GraphQL" },
  { value: "binary", label: "Binary" },
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

        {tab.bodyType === "graphql" && (
          <div className="flex flex-col h-full">
            <div className="flex-1 min-h-0 border-b border-border/60">
              <div className="px-3 py-1.5 border-b border-border/40">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Query
                </span>
              </div>
              <textarea
                className="h-[calc(100%-28px)] w-full resize-none bg-transparent p-3 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/40"
                placeholder={"query {\n  users {\n    id\n    name\n  }\n}"}
                value={tab.graphqlQuery}
                onChange={(e) => updateActiveTab({ graphqlQuery: e.target.value })}
                spellCheck={false}
              />
            </div>
            <div className="h-[35%] shrink-0">
              <div className="px-3 py-1.5 border-b border-border/40">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Variables
                </span>
              </div>
              <textarea
                className="h-[calc(100%-28px)] w-full resize-none bg-transparent p-3 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/40"
                placeholder={'{\n  "id": 1\n}'}
                value={tab.graphqlVariables}
                onChange={(e) => updateActiveTab({ graphqlVariables: e.target.value })}
                spellCheck={false}
              />
            </div>
          </div>
        )}

        {tab.bodyType === "binary" && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <p className="text-sm">Binary body content</p>
            <textarea
              className="w-[90%] max-w-xl h-32 resize-none bg-[hsl(var(--surface-2))] border border-border rounded p-3 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary/50"
              placeholder="Paste base64-encoded binary content..."
              value={tab.bodyContent}
              onChange={(e) => updateActiveTab({ bodyContent: e.target.value })}
              spellCheck={false}
            />
            <p className="text-[10px] text-muted-foreground/60">
              Paste base64-encoded data or raw binary string
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
