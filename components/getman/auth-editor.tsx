"use client";

import {
  useActiveTab,
  updateActiveTab,
  type RequestTab,
} from "@/lib/getman-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const authTypes: { value: RequestTab["authType"]; label: string }[] = [
  { value: "none", label: "No Auth" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth" },
  { value: "api-key", label: "API Key" },
];

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-medium text-muted-foreground">
        {label}
      </label>
      <input
        type={type}
        className="rounded border border-border bg-[hsl(var(--surface-1))] px-3 py-2 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary/50"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function AuthEditor() {
  const tab = useActiveTab();
  if (!tab) return null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-muted-foreground">
          Auth Type
        </label>
        <Select
          value={tab.authType}
          onValueChange={(v) =>
            updateActiveTab({ authType: v as RequestTab["authType"] })
          }
        >
          <SelectTrigger className="h-8 w-[200px] border-border bg-[hsl(var(--surface-1))] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
            {authTypes.map((a) => (
              <SelectItem key={a.value} value={a.value} className="text-xs">
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {tab.authType === "none" && (
        <p className="text-sm text-muted-foreground">
          This request does not use any authorization.
        </p>
      )}

      {tab.authType === "bearer" && (
        <InputField
          label="Token"
          value={tab.authToken}
          onChange={(v) => updateActiveTab({ authToken: v })}
          placeholder="Enter your bearer token..."
        />
      )}

      {tab.authType === "basic" && (
        <div className="flex flex-col gap-3">
          <InputField
            label="Username"
            value={tab.authUsername}
            onChange={(v) => updateActiveTab({ authUsername: v })}
            placeholder="Username"
          />
          <InputField
            label="Password"
            value={tab.authPassword}
            onChange={(v) => updateActiveTab({ authPassword: v })}
            placeholder="Password"
            type="password"
          />
        </div>
      )}

      {tab.authType === "api-key" && (
        <div className="flex flex-col gap-3">
          <InputField
            label="Key"
            value={tab.authApiKey}
            onChange={(v) => updateActiveTab({ authApiKey: v })}
            placeholder="X-API-Key"
          />
          <InputField
            label="Value"
            value={tab.authApiValue}
            onChange={(v) => updateActiveTab({ authApiValue: v })}
            placeholder="Your API key..."
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">
              Add To
            </label>
            <Select
              value={tab.authApiAddTo}
              onValueChange={(v) =>
                updateActiveTab({
                  authApiAddTo: v as "header" | "query",
                })
              }
            >
              <SelectTrigger className="h-8 w-[200px] border-border bg-[hsl(var(--surface-1))] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                <SelectItem value="header" className="text-xs">
                  Header
                </SelectItem>
                <SelectItem value="query" className="text-xs">
                  Query Parameter
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
