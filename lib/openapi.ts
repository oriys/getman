"use client";

import {
  type Collection,
  type CollectionFolder,
  type HttpMethod,
  type KeyValue,
  type RequestExample,
  type RequestTab,
  type SavedRequest,
  createDefaultTab,
  createEmptyKV,
  uid,
} from "./getman-store";

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const satisfies readonly HttpMethod[];

type JsonLike = Record<string, unknown>;

interface OpenApiDocument {
  openapi?: string;
  swagger?: string;
  info?: { title?: string };
  servers?: Array<{ url?: string }>;
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
}

interface OpenApiParameter {
  name?: string;
  in?: "query" | "header" | "path" | "cookie";
  required?: boolean;
  schema?: OpenApiSchema;
  example?: unknown;
}

interface OpenApiRequestBody {
  required?: boolean;
  content?: Record<string, OpenApiMediaType>;
}

interface OpenApiResponse {
  description?: string;
  headers?: Record<string, { schema?: OpenApiSchema; example?: unknown }>;
  content?: Record<string, OpenApiMediaType>;
}

interface OpenApiMediaType {
  example?: unknown;
  examples?: Record<string, { value?: unknown }>;
  schema?: OpenApiSchema;
}

interface OpenApiSchema {
  type?: string;
  format?: string;
  example?: unknown;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
}

interface ContractSignature {
  method: HttpMethod;
  path: string;
  responseCodes: string[];
  requiredPathParams: string[];
  requiredQueryParams: string[];
  requestContentTypes: string[];
}

export interface OpenApiSyncSummary {
  added: string[];
  removed: string[];
  changed: string[];
  breakingChanges: string[];
  affectedRequests: string[];
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(16);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizePath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, "{{$1}}");
}

function buildUrl(serverUrl: string, path: string): string {
  if (!serverUrl) return normalizePath(path);
  const trimmedServer = serverUrl.endsWith("/") ? serverUrl.slice(0, -1) : serverUrl;
  const normalizedPath = normalizePath(path.startsWith("/") ? path : `/${path}`);
  return `${trimmedServer}${normalizedPath}`;
}

function sampleFromSchema(schema?: OpenApiSchema): unknown {
  if (!schema) return "";
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (schema.type === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedSchema] of Object.entries(schema.properties || {})) {
      output[key] = sampleFromSchema(nestedSchema);
    }
    return output;
  }
  if (schema.type === "array") {
    return [sampleFromSchema(schema.items)];
  }
  if (schema.type === "integer" || schema.type === "number") return 0;
  if (schema.type === "boolean") return false;
  return "";
}

function stringifyExample(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "";
  }
}

function buildExamples(responses: Record<string, OpenApiResponse> | undefined): RequestExample[] {
  if (!responses) return [];
  const entries = Object.entries(responses);
  const examples: RequestExample[] = [];

  for (const [statusCode, response] of entries) {
    const contentEntries = Object.entries(response.content || {});
    if (contentEntries.length === 0) {
      examples.push({
        id: uid(),
        name: `${statusCode} ${response.description || "response"}`.trim(),
        statusCode: Number(statusCode) || (statusCode === "default" ? 200 : 200),
        headers: {},
        body: "",
        delayMs: 0,
        tags: [],
        isDefault: examples.length === 0,
        contentType: "application/json",
      });
      continue;
    }

    const [contentType, content] = contentEntries[0];
    const exampleBody =
      content.example ??
      Object.values(content.examples || {}).find((item) => item?.value !== undefined)?.value ??
      sampleFromSchema(content.schema);

    const headers: Record<string, string> = {};
    for (const [name, header] of Object.entries(response.headers || {})) {
      headers[name] = stringifyExample(header.example ?? sampleFromSchema(header.schema));
    }

    examples.push({
      id: uid(),
      name: `${statusCode} ${response.description || contentType}`.trim(),
      statusCode: Number(statusCode) || (statusCode === "default" ? 200 : 200),
      headers,
      body: stringifyExample(exampleBody),
      delayMs: 0,
      tags: [],
      isDefault: examples.length === 0,
      contentType,
    });
  }

  return examples;
}

function parseParameters(
  parameters: OpenApiParameter[] | undefined
): { params: KeyValue[]; headers: KeyValue[]; requiredPathParams: string[]; requiredQueryParams: string[] } {
  const params: KeyValue[] = [];
  const headers: KeyValue[] = [];
  const requiredPathParams: string[] = [];
  const requiredQueryParams: string[] = [];

  for (const parameter of parameters || []) {
    const name = asString(parameter.name);
    const location = parameter.in;
    if (!name || !location) continue;
    const fallback = sampleFromSchema(parameter.schema);
    const value = stringifyExample(parameter.example ?? fallback);
    const item: KeyValue = {
      id: uid(),
      key: name,
      value,
      enabled: true,
    };

    if (location === "query") {
      params.push(item);
      if (parameter.required) requiredQueryParams.push(name);
    } else if (location === "header") {
      headers.push(item);
    } else if (location === "path" && parameter.required) {
      requiredPathParams.push(name);
    }
  }

  if (params.length === 0) params.push(createEmptyKV());
  if (headers.length === 0) headers.push(createEmptyKV());
  return { params, headers, requiredPathParams, requiredQueryParams };
}

function buildRequestBody(
  requestBody: OpenApiRequestBody | undefined
): Pick<RequestTab, "bodyType" | "bodyContent" | "bodyFormData"> & {
  requestContentTypes: string[];
} {
  if (!requestBody?.content) {
    return {
      bodyType: "none",
      bodyContent: "",
      bodyFormData: [createEmptyKV()],
      requestContentTypes: [],
    };
  }

  const contentEntries = Object.entries(requestBody.content);
  const [contentType, media] = contentEntries[0];
  const requestContentTypes = contentEntries.map(([type]) => type).sort();
  const sample =
    media.example ??
    Object.values(media.examples || {}).find((item) => item?.value !== undefined)?.value ??
    sampleFromSchema(media.schema);

  if (contentType.includes("application/json")) {
    return {
      bodyType: "json",
      bodyContent: stringifyExample(sample),
      bodyFormData: [createEmptyKV()],
      requestContentTypes,
    };
  }

  if (contentType.includes("x-www-form-urlencoded") && sample && typeof sample === "object") {
    const bodyFormData = Object.entries(sample as JsonLike).map(([key, value]) => ({
      id: uid(),
      key,
      value: stringifyExample(value),
      enabled: true,
    }));
    return {
      bodyType: "x-www-form-urlencoded",
      bodyContent: "",
      bodyFormData: bodyFormData.length > 0 ? bodyFormData : [createEmptyKV()],
      requestContentTypes,
    };
  }

  return {
    bodyType: "raw",
    bodyContent: stringifyExample(sample),
    bodyFormData: [createEmptyKV()],
    requestContentTypes,
  };
}

function makeOperationKey(method: HttpMethod, path: string): string {
  return `${method} ${path}`;
}

function flattenRequestsFromFolders(folders: CollectionFolder[], bucket: SavedRequest[]) {
  for (const folder of folders) {
    bucket.push(...folder.requests);
    flattenRequestsFromFolders(folder.folders, bucket);
  }
}

function flattenCollectionRequests(collection: Collection): SavedRequest[] {
  const requests: SavedRequest[] = [...collection.requests];
  flattenRequestsFromFolders(collection.folders, requests);
  return requests;
}

function parseContractSignature(value?: string): ContractSignature | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as ContractSignature;
  } catch {
    return null;
  }
}

function isBreakingContractChange(prev: ContractSignature | null, next: ContractSignature | null): boolean {
  if (!prev || !next) return true;
  const nextResponses = new Set(next.responseCodes);
  for (const code of prev.responseCodes) {
    if (!nextResponses.has(code)) return true;
  }
  const prevRequiredPath = new Set(prev.requiredPathParams);
  for (const param of next.requiredPathParams) {
    if (!prevRequiredPath.has(param)) return true;
  }
  const prevRequiredQuery = new Set(prev.requiredQueryParams);
  for (const param of next.requiredQueryParams) {
    if (!prevRequiredQuery.has(param)) return true;
  }
  return false;
}

export function importOpenApiCollection(raw: string): Collection {
  const doc = JSON.parse(raw) as OpenApiDocument;
  if (!doc.paths || (!doc.openapi && !doc.swagger)) {
    throw new Error("Invalid OpenAPI document (JSON only)");
  }

  const name = asString(doc.info?.title, "OpenAPI Imported Collection");
  const baseUrl = asString(doc.servers?.[0]?.url, "");

  const foldersByTag = new Map<string, SavedRequest[]>();
  const rootRequests: SavedRequest[] = [];
  const contractFingerprint: Record<string, string> = {};

  for (const [path, pathOperations] of Object.entries(doc.paths)) {
    for (const methodKey of Object.keys(pathOperations)) {
      const method = methodKey.toUpperCase() as HttpMethod;
      if (!HTTP_METHODS.includes(method)) continue;
      const operation = pathOperations[methodKey];
      if (!operation) continue;

      const operationKey = makeOperationKey(method, path);
      const requestName =
        asString(operation.summary).trim() ||
        asString(operation.operationId).trim() ||
        `${method} ${path}`;
      const { params, headers, requiredPathParams, requiredQueryParams } = parseParameters(
        operation.parameters
      );
      const requestBody = buildRequestBody(operation.requestBody);
      const examples = buildExamples(operation.responses);
      const url = buildUrl(baseUrl, path);

      const tab: RequestTab = {
        ...createDefaultTab(),
        name: requestName,
        method,
        url,
        params,
        headers,
        bodyType: requestBody.bodyType,
        bodyContent: requestBody.bodyContent,
        bodyFormData: requestBody.bodyFormData,
        examples,
        selectedExampleId: examples.find((item) => item.isDefault)?.id || null,
        useMockExamples: false,
        sourceRequestId: operationKey,
      };

      const savedRequest: SavedRequest = {
        id: uid(),
        name: requestName,
        method,
        url,
        tab,
      };

      const tag = operation.tags?.[0]?.trim();
      if (tag) {
        if (!foldersByTag.has(tag)) foldersByTag.set(tag, []);
        foldersByTag.get(tag)?.push(savedRequest);
      } else {
        rootRequests.push(savedRequest);
      }

      const signature: ContractSignature = {
        method,
        path,
        responseCodes: Object.keys(operation.responses || {}).sort(),
        requiredPathParams: requiredPathParams.sort(),
        requiredQueryParams: requiredQueryParams.sort(),
        requestContentTypes: requestBody.requestContentTypes,
      };
      contractFingerprint[operationKey] = JSON.stringify(signature);
    }
  }

  const folders: CollectionFolder[] = Array.from(foldersByTag.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tag, requests]) => ({
      id: uid(),
      name: tag,
      requests,
      folders: [],
      variables: [],
      preRequestScript: "",
      testScript: "",
    }));

  return {
    id: uid(),
    name,
    requests: rootRequests,
    folders,
    variables: [],
    preRequestScript: "",
    testScript: "",
    sourceType: "openapi",
    sourceHash: hashString(raw),
    contractFingerprint,
  };
}

export function diffOpenApiCollections(existing: Collection, incoming: Collection): OpenApiSyncSummary {
  const previousFingerprint = existing.contractFingerprint || {};
  const nextFingerprint = incoming.contractFingerprint || {};
  const previousKeys = new Set(Object.keys(previousFingerprint));
  const nextKeys = new Set(Object.keys(nextFingerprint));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const breakingChanges: string[] = [];

  for (const key of nextKeys) {
    if (!previousKeys.has(key)) {
      added.push(key);
    }
  }
  for (const key of previousKeys) {
    if (!nextKeys.has(key)) {
      removed.push(key);
      breakingChanges.push(`Removed operation: ${key}`);
    } else if (previousFingerprint[key] !== nextFingerprint[key]) {
      changed.push(key);
      const prev = parseContractSignature(previousFingerprint[key]);
      const next = parseContractSignature(nextFingerprint[key]);
      if (isBreakingContractChange(prev, next)) {
        breakingChanges.push(`Breaking contract change: ${key}`);
      }
    }
  }

  const impactedKeys = new Set([...removed, ...changed]);
  const affectedRequests = flattenCollectionRequests(existing)
    .filter((request) => {
      const key = request.tab.sourceRequestId || `${request.method} ${request.url}`;
      return impactedKeys.has(key);
    })
    .map((request) => request.name);

  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
    breakingChanges,
    affectedRequests,
  };
}
