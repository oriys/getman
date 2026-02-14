"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveTab, updateActiveTab, updateActiveTabParams } from "@/lib/getman-store";
import { parseProtoContent } from "@/lib/tauri";
import { KVEditor } from "./kv-editor";
import { AuthEditor } from "./auth-editor";
import { BodyEditor } from "./body-editor";
import { AssertionEditor } from "./assertion-editor";

function GrpcProtoEditor() {
  const tab = useActiveTab();
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  if (!tab) return null;

  const handleParseProto = async () => {
    if (!tab.grpcProtoContent?.trim()) return;

    setParsing(true);
    setParseError(null);

    try {
      const services = await parseProtoContent(tab.grpcProtoContent);
      updateActiveTab({
        grpcServices: services,
        grpcServiceName: services[0]?.fullName ?? "",
        grpcMethodName: services[0]?.methods[0]?.name ?? "",
      });
    } catch (error) {
      setParseError(
        error instanceof Error ? error.message : "Failed to parse proto"
      );
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        <span className="text-[11px] font-medium text-muted-foreground">
          Paste your .proto file content below
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleParseProto}
          disabled={!tab.grpcProtoContent?.trim() || parsing}
          className="text-[11px] font-medium bg-primary/10 text-primary hover:bg-primary/20 px-3 py-1 rounded transition-colors disabled:opacity-50"
        >
          {parsing ? "Parsing..." : "Parse Proto"}
        </button>
      </div>
      {parseError && (
        <div className="px-3 py-1.5 text-[11px] text-red-500 bg-red-500/5 border-b border-red-500/20">
          {parseError}
        </div>
      )}
      {(tab.grpcServices ?? []).length > 0 && (
        <div className="px-3 py-1.5 text-[11px] text-green-500 bg-green-500/5 border-b border-green-500/20">
          Found {tab.grpcServices.length} service(s) with{" "}
          {tab.grpcServices.reduce((acc, s) => acc + s.methods.length, 0)} method(s)
        </div>
      )}
      <textarea
        className="flex-1 w-full bg-transparent px-3 py-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/40 resize-none"
        placeholder={`syntax = "proto3";\n\npackage helloworld;\n\nservice Greeter {\n  rpc SayHello (HelloRequest) returns (HelloReply);\n}\n\nmessage HelloRequest {\n  string name = 1;\n}\n\nmessage HelloReply {\n  string message = 1;\n}`}
        value={tab.grpcProtoContent ?? ""}
        onChange={(e) => updateActiveTab({ grpcProtoContent: e.target.value })}
        spellCheck={false}
      />
    </div>
  );
}

function GrpcMessageEditor() {
  const tab = useActiveTab();
  if (!tab) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        <span className="text-[11px] font-medium text-muted-foreground">
          Request message (JSON)
        </span>
      </div>
      <textarea
        className="flex-1 w-full bg-transparent px-3 py-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/40 resize-none"
        placeholder='{ "name": "world" }'
        value={tab.grpcRequestBody ?? "{}"}
        onChange={(e) => updateActiveTab({ grpcRequestBody: e.target.value })}
        spellCheck={false}
      />
    </div>
  );
}

export function RequestEditor() {
  const tab = useActiveTab();
  if (!tab) return null;

  const isGrpc = (tab.requestType ?? "http") === "grpc";

  const enabledParams = tab.params.filter((p) => p.enabled && p.key).length;
  const enabledHeaders = tab.headers.filter((h) => h.enabled && h.key).length;
  const enabledCookies = (tab.cookies ?? []).filter((c) => c.enabled && c.key).length;
  const assertionCount = (tab.assertions ?? []).length;
  const enabledMetadata = (tab.grpcMetadata ?? []).filter((m) => m.enabled && m.key).length;

  if (isGrpc) {
    return (
      <Tabs defaultValue="proto" className="flex flex-col h-full">
        <TabsList className="h-auto shrink-0 gap-1 border-b border-border bg-[hsl(var(--surface-2))] p-1.5">
          {[
            { value: "proto", label: "Proto" },
            { value: "message", label: "Message" },
            { value: "metadata", label: "Metadata", count: enabledMetadata },
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
          <TabsContent value="proto" className="m-0 h-full">
            <GrpcProtoEditor />
          </TabsContent>

          <TabsContent value="message" className="m-0 h-full">
            <GrpcMessageEditor />
          </TabsContent>

          <TabsContent value="metadata" className="m-0 h-full">
            <KVEditor
              items={tab.grpcMetadata ?? []}
              onChange={(grpcMetadata) => updateActiveTab({ grpcMetadata })}
              keyPlaceholder="Metadata Key"
              valuePlaceholder="Metadata Value"
            />
          </TabsContent>
        </div>
      </Tabs>
    );
  }

  return (
    <Tabs defaultValue="params" className="flex flex-col h-full">
      <TabsList className="h-auto shrink-0 gap-1 border-b border-border bg-[hsl(var(--surface-2))] p-1.5">
        {[
          { value: "params", label: "Params", count: enabledParams },
          { value: "headers", label: "Headers", count: enabledHeaders },
          { value: "body", label: "Body" },
          { value: "auth", label: "Auth" },
          { value: "cookies", label: "Cookies", count: enabledCookies },
          { value: "tests", label: "Tests", count: assertionCount },
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
            onChange={(params) => updateActiveTabParams(params)}
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

        <TabsContent value="tests" className="m-0 h-full">
          <AssertionEditor />
        </TabsContent>
      </div>
    </Tabs>
  );
}
