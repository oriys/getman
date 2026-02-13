"use client";

import { useState, useMemo } from "react";
import { Code, Check, Copy } from "lucide-react";
import { useActiveTab } from "@/lib/getman-store";
import {
  generateCode,
  CODE_LANGUAGES,
  type CodeLanguage,
} from "@/lib/code-generator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

export function CodeGeneratorDialog() {
  const tab = useActiveTab();
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<CodeLanguage>("curl");
  const [copied, setCopied] = useState(false);

  const code = useMemo(() => {
    if (!tab || !open) return "";
    return generateCode(tab, language);
  }, [tab, language, open]);

  if (!tab) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={!tab.url.trim()}
          className="flex h-11 items-center gap-1.5 border-l border-border/80 px-3 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          title="Generate Code"
        >
          <Code className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="border-border bg-[hsl(var(--surface-1))] sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="text-foreground text-sm">
            Generate Code
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Generate code snippets for the current request
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Select
              value={language}
              onValueChange={(v) => setLanguage(v as CodeLanguage)}
            >
              <SelectTrigger className="h-9 w-[220px] border-border bg-[hsl(var(--surface-1))] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-border bg-[hsl(var(--surface-1))]">
                {CODE_LANGUAGES.map((lang) => (
                  <SelectItem
                    key={lang.id}
                    value={lang.id}
                    className="text-sm"
                  >
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <div className="max-h-[400px] overflow-auto rounded-lg border border-border bg-[hsl(var(--surface-2))] p-4">
            <pre className="font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap break-all">
              {code}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
