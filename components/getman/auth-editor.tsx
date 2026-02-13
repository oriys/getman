"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import {
  useActiveTab,
  updateActiveTab,
  type RequestTab,
  type OAuth2GrantType,
} from "@/lib/getman-store";
import { maskToken } from "@/lib/crypto";
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
  { value: "oauth2", label: "OAuth 2.0" },
];

function SensitiveInputField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-medium text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          className="w-full rounded border border-border bg-[hsl(var(--surface-1))] px-3 py-2 pr-8 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary/50"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          title={visible ? "Hide" : "Show"}
        >
          {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </button>
      </div>
    </div>
  );
}

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
        <SensitiveInputField
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
          <SensitiveInputField
            label="Password"
            value={tab.authPassword}
            onChange={(v) => updateActiveTab({ authPassword: v })}
            placeholder="Password"
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
          <SensitiveInputField
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

      {tab.authType === "oauth2" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">
              Grant Type
            </label>
            <Select
              value={tab.oauth2GrantType || "authorization_code"}
              onValueChange={(v) =>
                updateActiveTab({ oauth2GrantType: v as OAuth2GrantType })
              }
            >
              <SelectTrigger className="h-8 w-[250px] border-border bg-[hsl(var(--surface-1))] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                <SelectItem value="authorization_code" className="text-xs">
                  Authorization Code
                </SelectItem>
                <SelectItem value="client_credentials" className="text-xs">
                  Client Credentials
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {tab.oauth2GrantType === "authorization_code" && (
            <InputField
              label="Auth URL"
              value={tab.oauth2AuthUrl || ""}
              onChange={(v) => updateActiveTab({ oauth2AuthUrl: v })}
              placeholder="https://provider.com/oauth/authorize"
            />
          )}

          <InputField
            label="Token URL"
            value={tab.oauth2TokenUrl || ""}
            onChange={(v) => updateActiveTab({ oauth2TokenUrl: v })}
            placeholder="https://provider.com/oauth/token"
          />

          <InputField
            label="Client ID"
            value={tab.oauth2ClientId || ""}
            onChange={(v) => updateActiveTab({ oauth2ClientId: v })}
            placeholder="Your client ID"
          />

          <SensitiveInputField
            label="Client Secret"
            value={tab.oauth2ClientSecret || ""}
            onChange={(v) => updateActiveTab({ oauth2ClientSecret: v })}
            placeholder="Your client secret"
          />

          <InputField
            label="Scope"
            value={tab.oauth2Scope || ""}
            onChange={(v) => updateActiveTab({ oauth2Scope: v })}
            placeholder="read write (space-separated)"
          />

          {tab.oauth2GrantType === "authorization_code" && (
            <InputField
              label="Callback URL"
              value={tab.oauth2CallbackUrl || "http://localhost/callback"}
              onChange={(v) => updateActiveTab({ oauth2CallbackUrl: v })}
              placeholder="http://localhost/callback"
            />
          )}

          <div className="border-t border-border/50 pt-3">
            <SensitiveInputField
              label="Access Token"
              value={tab.oauth2AccessToken || ""}
              onChange={(v) => updateActiveTab({ oauth2AccessToken: v })}
              placeholder="Paste access token or use Get Token button"
            />
            <p className="mt-2 text-[10px] text-muted-foreground">
              For Authorization Code flow: copy the token from your OAuth provider.
              For Client Credentials: the token will be sent automatically with the Token URL.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
