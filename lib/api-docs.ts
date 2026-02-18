"use client";

import { type Collection, type CollectionFolder, type SavedRequest } from "./getman-store";

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function buildCurlSnippet(request: SavedRequest): string {
  const tab = request.tab;
  const parts = [`curl -X ${tab.method}`, `'${tab.url}'`];
  for (const header of tab.headers) {
    if (header.enabled && header.key) {
      parts.push(`-H '${header.key}: ${header.value}'`);
    }
  }
  if (tab.bodyType !== "none" && tab.bodyContent) {
    parts.push(`--data '${tab.bodyContent.replace(/'/g, "\\'")}'`);
  }
  return parts.join(" \\\n  ");
}

function flattenFolderRequests(
  folders: CollectionFolder[],
  parentPath: string[],
  entries: Array<{ path: string[]; request: SavedRequest }>
) {
  for (const folder of folders) {
    const path = [...parentPath, folder.name];
    for (const request of folder.requests) {
      entries.push({ path, request });
    }
    flattenFolderRequests(folder.folders, path, entries);
  }
}

function collectRequests(collection: Collection): Array<{ path: string[]; request: SavedRequest }> {
  const items: Array<{ path: string[]; request: SavedRequest }> = collection.requests.map((request) => ({
    path: [],
    request,
  }));
  flattenFolderRequests(collection.folders, [], items);
  return items;
}

function renderRequestDocs(path: string[], savedRequest: SavedRequest): string {
  const tab = savedRequest.tab;
  const title = path.length > 0 ? `${path.join(" / ")} / ${savedRequest.name}` : savedRequest.name;
  const lines: string[] = [];

  lines.push(`## ${title}`);
  lines.push("");
  lines.push(`- **Method:** \`${tab.method}\``);
  lines.push(`- **URL:** \`${tab.url}\``);
  lines.push("");

  const enabledParams = tab.params.filter((item) => item.enabled && item.key);
  if (enabledParams.length > 0) {
    lines.push("### Query Parameters");
    lines.push("");
    lines.push("| Name | Value |");
    lines.push("| --- | --- |");
    for (const param of enabledParams) {
      lines.push(`| ${escapeMarkdown(param.key)} | ${escapeMarkdown(param.value)} |`);
    }
    lines.push("");
  }

  const enabledHeaders = tab.headers.filter((item) => item.enabled && item.key);
  if (enabledHeaders.length > 0) {
    lines.push("### Headers");
    lines.push("");
    lines.push("| Name | Value |");
    lines.push("| --- | --- |");
    for (const header of enabledHeaders) {
      lines.push(`| ${escapeMarkdown(header.key)} | ${escapeMarkdown(header.value)} |`);
    }
    lines.push("");
  }

  if (tab.bodyType !== "none" && tab.bodyContent) {
    lines.push("### Request Body");
    lines.push("");
    lines.push("```json");
    lines.push(tab.bodyContent);
    lines.push("```");
    lines.push("");
  }

  lines.push("### Code Snippet");
  lines.push("");
  lines.push("```bash");
  lines.push(buildCurlSnippet(savedRequest));
  lines.push("```");
  lines.push("");

  const examples = tab.examples || [];
  if (examples.length > 0) {
    lines.push("### Examples");
    lines.push("");
    for (const example of examples) {
      lines.push(`#### ${example.name} (\`${example.statusCode}\`)`);
      lines.push("");
      lines.push(`- Content-Type: \`${example.contentType}\``);
      if (example.delayMs > 0) {
        lines.push(`- Delay: \`${example.delayMs}ms\``);
      }
      if (example.tags.length > 0) {
        lines.push(`- Tags: ${example.tags.map((tag) => `\`${tag}\``).join(", ")}`);
      }
      lines.push("");
      lines.push("```json");
      lines.push(example.body || "");
      lines.push("```");
      lines.push("");
    }

    const errorExamples = examples.filter((example) => example.statusCode >= 400);
    if (errorExamples.length > 0) {
      lines.push("### Error Examples");
      lines.push("");
      for (const example of errorExamples) {
        lines.push(`- \`${example.statusCode}\` ${example.name}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function exportCollectionDocsMarkdown(collection: Collection): string {
  const lines: string[] = [];
  lines.push(`# ${collection.name} API Docs`);
  lines.push("");
  lines.push("> Generated from Getman request examples.");
  lines.push("");
  lines.push("## Endpoints");
  lines.push("");

  const requests = collectRequests(collection);
  if (requests.length === 0) {
    lines.push("No endpoints available.");
    lines.push("");
    return lines.join("\n");
  }

  for (const entry of requests) {
    lines.push(renderRequestDocs(entry.path, entry.request));
  }

  return lines.join("\n");
}
