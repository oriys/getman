"use client";

import { Plus, Trash2, CheckCircle2, XCircle, Sparkles } from "lucide-react";
import {
  useActiveTab,
  useGetmanStore,
  updateActiveTab,
  uid,
  type TestAssertion,
  type AssertionType,
  type ResponseData,
} from "@/lib/getman-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const assertionTypes: { value: AssertionType; label: string }[] = [
  { value: "status", label: "Status Code" },
  { value: "header", label: "Header" },
  { value: "jsonpath", label: "JSONPath" },
  { value: "body-contains", label: "Body Contains" },
];

const comparisonTypes: { value: TestAssertion["comparison"]; label: string }[] = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "exists", label: "exists" },
  { value: "matches", label: "matches regex" },
];

function createEmptyAssertion(): TestAssertion {
  return {
    id: uid(),
    enabled: true,
    type: "status",
    property: "",
    comparison: "eq",
    expected: "200",
  };
}

function createSuggestedAssertion(partial: Partial<TestAssertion>): TestAssertion {
  return {
    id: uid(),
    enabled: true,
    type: "status",
    property: "",
    comparison: "eq",
    expected: "",
    ...partial,
  };
}

function buildSuggestedAssertions(response: ResponseData): TestAssertion[] {
  const suggestions: TestAssertion[] = [
    createSuggestedAssertion({
      type: "status",
      comparison: "eq",
      expected: String(response.status),
    }),
  ];

  const contentType = response.contentType || "";
  if (contentType) {
    suggestions.push(
      createSuggestedAssertion({
        type: "header",
        property: "content-type",
        comparison: "contains",
        expected: contentType.split(";")[0].trim(),
      })
    );
  }

  if (contentType.toLowerCase().includes("json")) {
    try {
      const parsed = JSON.parse(response.body || "null");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed).slice(0, 3);
        for (const key of keys) {
          suggestions.push(
            createSuggestedAssertion({
              type: "jsonpath",
              property: `$.${key}`,
              comparison: "exists",
              expected: "",
            })
          );
        }
      }
    } catch {
      // ignore invalid json
    }
  } else {
    const snippet = response.body.trim().slice(0, 40);
    if (snippet) {
      suggestions.push(
        createSuggestedAssertion({
          type: "body-contains",
          comparison: "contains",
          expected: snippet,
        })
      );
    }
  }

  return suggestions;
}

export function AssertionEditor() {
  const tab = useActiveTab();
  const { assertionResults, response } = useGetmanStore();
  if (!tab) return null;

  const assertions = tab.assertions || [];

  const updateAssertions = (updated: TestAssertion[]) => {
    updateActiveTab({ assertions: updated });
  };

  const addAssertion = () => {
    updateAssertions([...assertions, createEmptyAssertion()]);
  };

  const suggestAssertions = () => {
    if (!response) return;
    const suggestions = buildSuggestedAssertions(response);
    const existingSignatures = new Set(
      assertions.map((a) => `${a.type}|${a.property}|${a.comparison}|${a.expected}`)
    );
    const merged = [
      ...assertions,
      ...suggestions.filter(
        (suggestion) =>
          !existingSignatures.has(
            `${suggestion.type}|${suggestion.property}|${suggestion.comparison}|${suggestion.expected}`
          )
      ),
    ];
    updateAssertions(merged);
  };

  const removeAssertion = (id: string) => {
    updateAssertions(assertions.filter((a) => a.id !== id));
  };

  const updateAssertion = (id: string, partial: Partial<TestAssertion>) => {
    updateAssertions(
      assertions.map((a) => (a.id === id ? { ...a, ...partial } : a))
    );
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Test Assertions
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={suggestAssertions}
            disabled={!response}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            <Sparkles className="h-3 w-3" />
            AI Suggest
          </button>
          <button
            type="button"
            onClick={addAssertion}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        </div>
      </div>

      {assertions.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">
          No assertions configured. Add assertions to validate response data.
        </p>
      )}

      {assertions.map((assertion) => {
        const result = assertionResults.find((r) => r.assertionId === assertion.id);

        return (
          <div
            key={assertion.id}
            className={`flex flex-col gap-2 rounded-lg border p-3 ${
              result
                ? result.passed
                  ? "border-green-500/30 bg-green-500/5"
                  : "border-red-500/30 bg-red-500/5"
                : "border-border/60"
            }`}
          >
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={assertion.enabled}
                onChange={(e) =>
                  updateAssertion(assertion.id, { enabled: e.target.checked })
                }
                className="h-3 w-3 rounded border-border accent-primary"
              />

              <Select
                value={assertion.type}
                onValueChange={(v) =>
                  updateAssertion(assertion.id, { type: v as AssertionType })
                }
              >
                <SelectTrigger className="h-7 w-[130px] border-border bg-[hsl(var(--surface-1))] text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                  {assertionTypes.map((t) => (
                    <SelectItem key={t.value} value={t.value} className="text-[11px]">
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {(assertion.type === "header" || assertion.type === "jsonpath") && (
                <input
                  className="h-7 flex-1 min-w-0 rounded border border-border bg-[hsl(var(--surface-1))] px-2 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary/50"
                  placeholder={
                    assertion.type === "header"
                      ? "Header name"
                      : "$.path.to.value"
                  }
                  value={assertion.property}
                  onChange={(e) =>
                    updateAssertion(assertion.id, { property: e.target.value })
                  }
                />
              )}

              <Select
                value={assertion.comparison}
                onValueChange={(v) =>
                  updateAssertion(assertion.id, {
                    comparison: v as TestAssertion["comparison"],
                  })
                }
              >
                <SelectTrigger className="h-7 w-[120px] border-border bg-[hsl(var(--surface-1))] text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                  {comparisonTypes.map((c) => (
                    <SelectItem key={c.value} value={c.value} className="text-[11px]">
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {assertion.comparison !== "exists" && (
                <input
                  className="h-7 flex-1 min-w-0 rounded border border-border bg-[hsl(var(--surface-1))] px-2 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary/50"
                  placeholder="Expected value"
                  value={assertion.expected}
                  onChange={(e) =>
                    updateAssertion(assertion.id, { expected: e.target.value })
                  }
                />
              )}

              <button
                type="button"
                onClick={() => removeAssertion(assertion.id)}
                className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>

            {/* Assertion result */}
            {result && (
              <div className="flex items-center gap-1.5 text-[10px] font-mono">
                {result.passed ? (
                  <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                ) : (
                  <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                )}
                <span
                  className={
                    result.passed ? "text-green-600" : "text-red-600"
                  }
                >
                  {result.message}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
