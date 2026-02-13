"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveTab, updateActiveTab } from "@/lib/getman-store";
import { KVEditor } from "./kv-editor";
import { AuthEditor } from "./auth-editor";
import { BodyEditor } from "./body-editor";

export function RequestEditor() {
  const tab = useActiveTab();
  if (!tab) return null;

  const enabledParams = tab.params.filter((p) => p.enabled && p.key).length;
  const enabledHeaders = tab.headers.filter((h) => h.enabled && h.key).length;
  const enabledCookies = (tab.cookies ?? []).filter((c) => c.enabled && c.key).length;

  return (
    <Tabs defaultValue="params" className="flex flex-col h-full">
      <TabsList className="h-auto shrink-0 gap-1 border-b border-border bg-[hsl(var(--surface-2))] p-1.5">
        {[
          { value: "params", label: "Params", count: enabledParams },
          { value: "headers", label: "Headers", count: enabledHeaders },
          { value: "body", label: "Body" },
          { value: "auth", label: "Auth" },
          { value: "cookies", label: "Cookies", count: enabledCookies },
        ].map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            className="rounded-lg border border-transparent px-3 py-2 text-xs font-medium text-muted-foreground data-[state=active]:border-border/80 data-[state=active]:bg-[hsl(var(--surface-1))] data-[state=active]:text-foreground"
          >
            {t.label}
            {"count" in t && t.count ? (
              <span className="ml-1.5 bg-primary/20 text-primary text-[10px] font-bold rounded-full px-1.5 py-0">
                {t.count}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="flex-1 min-h-0 overflow-auto bg-[hsl(var(--surface-1))]">
        <TabsContent value="params" className="m-0 h-full">
          <KVEditor
            items={tab.params}
            onChange={(params) => updateActiveTab({ params })}
            keyPlaceholder="Parameter"
            valuePlaceholder="Value"
          />
        </TabsContent>

        <TabsContent value="headers" className="m-0 h-full">
          <KVEditor
            items={tab.headers}
            onChange={(headers) => updateActiveTab({ headers })}
            keyPlaceholder="Header"
            valuePlaceholder="Value"
          />
        </TabsContent>

        <TabsContent value="body" className="m-0 h-full">
          <BodyEditor />
        </TabsContent>

        <TabsContent value="auth" className="m-0 h-full">
          <AuthEditor />
        </TabsContent>

        <TabsContent value="cookies" className="m-0 h-full">
          <KVEditor
            items={tab.cookies ?? []}
            onChange={(cookies) => updateActiveTab({ cookies })}
            keyPlaceholder="Cookie Name"
            valuePlaceholder="Cookie Value"
          />
        </TabsContent>
      </div>
    </Tabs>
  );
}
