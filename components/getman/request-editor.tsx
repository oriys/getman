"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  uid,
  useActiveTab,
  updateActiveTab,
  updateActiveTabParams,
} from "@/lib/getman-store";
import { parseProtoContent, fetchGrpcReflection } from "@/lib/tauri";
import { KVEditor } from "./kv-editor";
import { AuthEditor } from "./auth-editor";
import { BodyEditor } from "./body-editor";
import { AssertionEditor } from "./assertion-editor";

function GrpcProtoEditor() {
  const tab = useActiveTab();
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [reflecting, setReflecting] = useState(false);

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
        grpcDescriptorBytes: "",
      });
    } catch (error) {
      setParseError(
        error instanceof Error ? error.message : "Failed to parse proto"
      );
    } finally {
      setParsing(false);
    }
  };

  const handleServerReflection = async () => {
    if (!tab.url?.trim()) {
      setParseError("Enter a server address first");
      return;
    }

    setReflecting(true);
    setParseError(null);

    try {
      const result = await fetchGrpcReflection(tab.url);
      updateActiveTab({
        grpcServices: result.services,
        grpcServiceName: result.services[0]?.fullName ?? "",
        grpcMethodName: result.services[0]?.methods[0]?.name ?? "",
        grpcDescriptorBytes: result.descriptorBytes,
      });
    } catch (error) {
      setParseError(
        error instanceof Error ? error.message : "Failed to fetch server reflection"
      );
    } finally {
      setReflecting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        <span className="text-[11px] font-medium text-muted-foreground">
          Paste your .proto file content below or use Server Reflection
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleServerReflection}
          disabled={!tab.url?.trim() || reflecting}
          className="text-[11px] font-medium bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 px-3 py-1 rounded transition-colors disabled:opacity-50"
        >
          {reflecting ? "Reflecting..." : "Server Reflection"}
        </button>
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
          {tab.grpcDescriptorBytes ? " (via reflection)" : ""}
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

function ScriptEditor() {
  const tab = useActiveTab();
  if (!tab) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 border-b border-border/60">
        <div className="px-3 py-1.5 border-b border-border/40">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Pre-request Script (req, api)
          </span>
        </div>
        <textarea
          className="h-[calc(100%-28px)] w-full resize-none bg-transparent p-3 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/40"
          placeholder={"api.setHeader(\"X-Trace\", \"getman\");\napi.setQueryParam(\"ts\", Date.now().toString());"}
          value={tab.preRequestScript ?? ""}
          onChange={(e) => updateActiveTab({ preRequestScript: e.target.value })}
          spellCheck={false}
        />
      </div>
      <div className="h-[45%] shrink-0">
        <div className="px-3 py-1.5 border-b border-border/40">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Post-response Script (req, res, test, expect)
          </span>
        </div>
        <textarea
          className="h-[calc(100%-28px)] w-full resize-none bg-transparent p-3 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/40"
          placeholder={"test(\"status is 200\", () => {\n  expect(res.status).toBe(200);\n});"}
          value={tab.testScript ?? ""}
          onChange={(e) => updateActiveTab({ testScript: e.target.value })}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function VariablesEditor() {
  const tab = useActiveTab();
  if (!tab) return null;

  return (
    <KVEditor
      items={tab.variables ?? []}
      onChange={(variables) => updateActiveTab({ variables })}
      keyPlaceholder="Variable"
      valuePlaceholder="Value"
    />
  );
}

function ExamplesEditor() {
  const tab = useActiveTab();
  if (!tab) return null;

  const examples = tab.examples ?? [];
  const selectedExampleId =
    tab.selectedExampleId || examples.find((item) => item.isDefault)?.id || examples[0]?.id || "";
  const selectedExample = examples.find((item) => item.id === selectedExampleId) || null;

  const updateExample = (id: string, partial: Partial<(typeof examples)[number]>) => {
    const nextExamples = examples.map((item) => (item.id === id ? { ...item, ...partial } : item));
    updateActiveTab({ examples: nextExamples });
  };

  const handleCreateExample = () => {
    const exampleId = uid();
    const nextExamples = [
      ...examples.map((item) => ({ ...item, isDefault: false })),
      {
        id: exampleId,
        name: `Example ${examples.length + 1}`,
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: "{}",
        delayMs: 0,
        tags: [],
        isDefault: examples.length === 0,
        contentType: "application/json",
      },
    ];
    updateActiveTab({
      examples: nextExamples,
      selectedExampleId: exampleId,
    });
  };

  const handleDeleteExample = (id: string) => {
    const remaining = examples.filter((item) => item.id !== id);
    const fallbackId = remaining.find((item) => item.isDefault)?.id || remaining[0]?.id || null;
    updateActiveTab({
      examples: remaining,
      selectedExampleId: fallbackId,
    });
  };

  return (
    <div className="flex h-full">
      <div className="w-[220px] shrink-0 border-r border-border/60">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Examples
          </span>
          <button
            type="button"
            onClick={handleCreateExample}
            className="text-[10px] font-medium text-primary hover:underline"
          >
            + Add
          </button>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40">
          <input
            type="checkbox"
            id="use-mock-examples"
            checked={Boolean(tab.useMockExamples)}
            onChange={(e) => updateActiveTab({ useMockExamples: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-border accent-primary"
          />
          <label htmlFor="use-mock-examples" className="text-[11px] text-foreground">
            Use mock examples
          </label>
        </div>
        <div className="max-h-full overflow-auto">
          {examples.map((example) => (
            <button
              key={example.id}
              type="button"
              onClick={() => updateActiveTab({ selectedExampleId: example.id })}
              className={`w-full border-b border-border/30 px-3 py-2 text-left hover:bg-[hsl(var(--surface-2))] ${
                selectedExampleId === example.id ? "bg-[hsl(var(--surface-2))]" : ""
              }`}
            >
              <div className="text-xs text-foreground truncate">{example.name}</div>
              <div className="text-[10px] text-muted-foreground">
                {example.statusCode} · {example.contentType}
              </div>
            </button>
          ))}
          {examples.length === 0 && (
            <div className="px-3 py-6 text-[11px] text-muted-foreground">
              No examples yet.
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        {!selectedExample ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Select or create an example.
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="grid grid-cols-4 gap-2 border-b border-border/60 px-3 py-2">
              <input
                className="col-span-2 rounded border border-border bg-[hsl(var(--surface-1))] px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50"
                value={selectedExample.name}
                onChange={(e) => updateExample(selectedExample.id, { name: e.target.value })}
                placeholder="Example name"
              />
              <input
                type="number"
                className="rounded border border-border bg-[hsl(var(--surface-1))] px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50"
                value={selectedExample.statusCode}
                onChange={(e) =>
                  updateExample(selectedExample.id, { statusCode: Math.max(100, Number(e.target.value) || 200) })
                }
                min={100}
                max={599}
              />
              <input
                className="rounded border border-border bg-[hsl(var(--surface-1))] px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50"
                value={selectedExample.contentType}
                onChange={(e) => updateExample(selectedExample.id, { contentType: e.target.value })}
                placeholder="Content-Type"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 border-b border-border/60 px-3 py-2 text-xs">
              <label className="flex items-center gap-2 text-muted-foreground">
                Delay (ms)
                <input
                  type="number"
                  className="h-7 w-24 rounded border border-border bg-[hsl(var(--surface-1))] px-2 font-mono text-xs text-foreground outline-none focus:border-primary/50"
                  value={selectedExample.delayMs}
                  onChange={(e) => updateExample(selectedExample.id, { delayMs: Math.max(0, Number(e.target.value) || 0) })}
                  min={0}
                />
              </label>
              <label className="flex items-center gap-2 text-muted-foreground">
                <input
                  type="checkbox"
                  checked={selectedExample.isDefault}
                  onChange={(e) => {
                    if (!e.target.checked) return;
                    updateActiveTab({
                      selectedExampleId: selectedExample.id,
                      examples: examples.map((item) => ({
                        ...item,
                        isDefault: item.id === selectedExample.id,
                      })),
                    });
                  }}
                />
                Default example
              </label>
            </div>
            <textarea
              className="flex-1 w-full resize-none bg-transparent p-3 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/40"
              placeholder="Example response body"
              value={selectedExample.body}
              onChange={(e) => updateExample(selectedExample.id, { body: e.target.value })}
              spellCheck={false}
            />
            <div className="border-t border-border/60 px-3 py-2">
              <button
                type="button"
                onClick={() => handleDeleteExample(selectedExample.id)}
                className="text-xs text-destructive hover:underline"
              >
                Delete Example
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FlowEditor() {
  const tab = useActiveTab();
  if (!tab) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-1.5 border-b border-border/40">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Flow Orchestrator
        </span>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">
            Depends On (request IDs or names)
          </label>
          <textarea
            className="h-24 rounded border border-border bg-[hsl(var(--surface-1))] px-3 py-2 font-mono text-xs text-foreground outline-none resize-none placeholder:text-muted-foreground/40 focus:border-primary/50"
            placeholder={"login\nget-profile, refresh-token"}
            value={tab.flowDependsOn ?? ""}
            onChange={(e) => updateActiveTab({ flowDependsOn: e.target.value })}
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">
            Run Condition (JavaScript expression, optional)
          </label>
          <textarea
            className="h-28 rounded border border-border bg-[hsl(var(--surface-1))] px-3 py-2 font-mono text-xs text-foreground outline-none resize-none placeholder:text-muted-foreground/40 focus:border-primary/50"
            placeholder={"data.role === 'admin' && deps.login?.response.status === 200"}
            value={tab.flowCondition ?? ""}
            onChange={(e) => updateActiveTab({ flowCondition: e.target.value })}
            spellCheck={false}
          />
        </div>

        <p className="text-[10px] text-muted-foreground">
          Context: <span className="font-mono">data</span>,{" "}
          <span className="font-mono">iteration</span>,{" "}
          <span className="font-mono">deps</span>,{" "}
          <span className="font-mono">results</span>.
        </p>
      </div>
    </div>
  );
}

export function RequestEditor() {
  const tab = useActiveTab();
  if (!tab) return null;

  const isGrpc = (tab.requestType ?? "http") === "grpc";
  const isGraphql = (tab.requestType ?? "http") === "graphql";
  const isWebsocket = (tab.requestType ?? "http") === "websocket";

  const enabledParams = tab.params.filter((p) => p.enabled && p.key).length;
  const enabledHeaders = tab.headers.filter((h) => h.enabled && h.key).length;
  const enabledCookies = (tab.cookies ?? []).filter((c) => c.enabled && c.key).length;
  const assertionCount = (tab.assertions ?? []).length;
  const scriptCount =
    (tab.preRequestScript?.trim() ? 1 : 0) +
    (tab.testScript?.trim() ? 1 : 0);
  const flowCount =
    (tab.flowDependsOn?.trim() ? 1 : 0) +
    (tab.flowCondition?.trim() ? 1 : 0);
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

  if (isGraphql) {
    return (
      <Tabs defaultValue="query" className="flex flex-col h-full">
        <TabsList className="h-auto shrink-0 gap-1 border-b border-border bg-[hsl(var(--surface-2))] p-1.5">
            {[
              { value: "query", label: "Query" },
              { value: "headers", label: "Headers", count: enabledHeaders },
              { value: "auth", label: "Auth" },
              { value: "variables", label: "Variables", count: (tab.variables ?? []).filter((v) => v.enabled && v.key).length },
              { value: "examples", label: "Examples", count: (tab.examples ?? []).length },
              { value: "scripts", label: "Scripts", count: scriptCount },
              { value: "flow", label: "Flow", count: flowCount },
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
          <TabsContent value="query" className="m-0 h-full">
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
          </TabsContent>

          <TabsContent value="headers" className="m-0 h-full">
            <KVEditor
              items={tab.headers}
              onChange={(headers) => updateActiveTab({ headers })}
              keyPlaceholder="Header"
              valuePlaceholder="Value"
            />
          </TabsContent>

          <TabsContent value="auth" className="m-0 h-full">
            <AuthEditor />
          </TabsContent>

          <TabsContent value="variables" className="m-0 h-full">
            <VariablesEditor />
          </TabsContent>

          <TabsContent value="examples" className="m-0 h-full">
            <ExamplesEditor />
          </TabsContent>

          <TabsContent value="scripts" className="m-0 h-full">
            <ScriptEditor />
          </TabsContent>

          <TabsContent value="flow" className="m-0 h-full">
            <FlowEditor />
          </TabsContent>
        </div>
      </Tabs>
    );
  }

  if (isWebsocket) {
    return (
      <Tabs defaultValue="message" className="flex flex-col h-full">
        <TabsList className="h-auto shrink-0 gap-1 border-b border-border bg-[hsl(var(--surface-2))] p-1.5">
          {[
            { value: "message", label: "Message" },
            { value: "headers", label: "Headers", count: enabledHeaders },
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
          <TabsContent value="message" className="m-0 h-full">
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Message to send
                </span>
              </div>
              <textarea
                className="flex-1 w-full bg-transparent px-3 py-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/40 resize-none"
                placeholder='{"type": "hello", "data": "world"}'
                value={tab.wsMessage ?? ""}
                onChange={(e) => updateActiveTab({ wsMessage: e.target.value })}
                spellCheck={false}
              />
              <div className="px-3 py-2 border-t border-border/50">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Protocols
                  </span>
                  <input
                    className="flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/40"
                    placeholder="Optional sub-protocols (comma-separated)"
                    value={tab.wsProtocols ?? ""}
                    onChange={(e) => updateActiveTab({ wsProtocols: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="headers" className="m-0 h-full">
            <KVEditor
              items={tab.headers}
              onChange={(headers) => updateActiveTab({ headers })}
              keyPlaceholder="Header"
              valuePlaceholder="Value"
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
          { value: "variables", label: "Variables", count: (tab.variables ?? []).filter((v) => v.enabled && v.key).length },
          { value: "examples", label: "Examples", count: (tab.examples ?? []).length },
          { value: "tests", label: "Tests", count: assertionCount },
          { value: "scripts", label: "Scripts", count: scriptCount },
          { value: "flow", label: "Flow", count: flowCount },
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

        <TabsContent value="variables" className="m-0 h-full">
          <VariablesEditor />
        </TabsContent>

        <TabsContent value="examples" className="m-0 h-full">
          <ExamplesEditor />
        </TabsContent>

        <TabsContent value="tests" className="m-0 h-full">
          <AssertionEditor />
        </TabsContent>

        <TabsContent value="scripts" className="m-0 h-full">
          <ScriptEditor />
        </TabsContent>

        <TabsContent value="flow" className="m-0 h-full">
          <FlowEditor />
        </TabsContent>
      </div>
    </Tabs>
  );
}
