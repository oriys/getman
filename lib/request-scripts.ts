'use client';

import type { AssertionResult, ResponseData } from "./getman-store";
import type { SendRequestPayload } from "./tauri";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toMatch(expected: string | RegExp): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
}

interface ScriptResponseContext {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  time: number;
  size: number;
  contentType: string;
  json: () => unknown;
}

export interface ScriptExecutionLog {
  phase: "pre-request" | "post-response";
  level: "info" | "error";
  scriptName: string;
  message: string;
  timestamp: number;
}

export interface ScriptRuntimeContext {
  scriptName?: string;
  requestName?: string;
  globalVariables?: Record<string, string>;
  environmentVariables?: Record<string, string>;
  collectionVariables?: Record<string, string>;
  requestVariables?: Record<string, string>;
  runtimeVariables?: Record<string, string>;
  iterationData?: Record<string, string>;
  logs?: ScriptExecutionLog[];
}

interface RuntimeVariableSources {
  global: Record<string, string>;
  environment: Record<string, string>;
  collection: Record<string, string>;
  request: Record<string, string>;
  runtime: Record<string, string>;
}

function scriptAssertionId(): string {
  return `script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

function makeExpect(actual: unknown): Expectation {
  const fail = (message: string): never => {
    throw new Error(message);
  };

  return {
    toBe(expected: unknown) {
      if (actual !== expected) {
        fail(`Expected ${asString(expected)} but got ${asString(actual)}`);
      }
    },
    toEqual(expected: unknown) {
      const actualText = JSON.stringify(actual);
      const expectedText = JSON.stringify(expected);
      if (actualText !== expectedText) {
        fail(`Expected ${expectedText} but got ${actualText}`);
      }
    },
    toContain(expected: unknown) {
      if (typeof actual === "string") {
        if (!actual.includes(String(expected))) {
          fail(`Expected string to contain ${asString(expected)}, got ${actual}`);
        }
        return;
      }
      if (Array.isArray(actual)) {
        if (!actual.includes(expected)) {
          fail(`Expected array to contain ${asString(expected)}`);
        }
        return;
      }
      fail("toContain only supports string or array values");
    },
    toMatch(expected: string | RegExp) {
      const pattern = expected instanceof RegExp ? expected : new RegExp(expected);
      if (!pattern.test(String(actual ?? ""))) {
        fail(`Expected ${asString(actual)} to match ${pattern.toString()}`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        fail(`Expected truthy value but got ${asString(actual)}`);
      }
    },
    toBeFalsy() {
      if (actual) {
        fail(`Expected falsy value but got ${asString(actual)}`);
      }
    },
  };
}

function createRuntimeSources(context?: ScriptRuntimeContext): RuntimeVariableSources {
  const global = context?.globalVariables ?? {};
  const environment = context?.environmentVariables ?? {};
  const collection = context?.collectionVariables ?? {};
  const request = context?.requestVariables ?? {};
  const runtime = context?.runtimeVariables ?? {};
  if (context) {
    context.globalVariables = global;
    context.environmentVariables = environment;
    context.collectionVariables = collection;
    context.requestVariables = request;
    context.runtimeVariables = runtime;
  }
  return { global, environment, collection, request, runtime };
}

function replaceTemplateVariables(input: string, values: Record<string, string>): string {
  let result = input;
  for (const [key, value] of Object.entries(values)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\{\\{${escaped}\\}\\}`, "g"), value);
  }
  return result;
}

function getMergedVariables(sources: RuntimeVariableSources): Record<string, string> {
  return {
    ...sources.global,
    ...sources.environment,
    ...sources.collection,
    ...sources.request,
    ...sources.runtime,
  };
}

function resolveVariable(
  sources: RuntimeVariableSources,
  key: string
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(sources.runtime, key)) return sources.runtime[key];
  if (Object.prototype.hasOwnProperty.call(sources.request, key)) return sources.request[key];
  if (Object.prototype.hasOwnProperty.call(sources.collection, key)) return sources.collection[key];
  if (Object.prototype.hasOwnProperty.call(sources.environment, key)) return sources.environment[key];
  if (Object.prototype.hasOwnProperty.call(sources.global, key)) return sources.global[key];
  return undefined;
}

function makeVariableApi(
  sources: RuntimeVariableSources,
  target: keyof RuntimeVariableSources | "merged"
) {
  return {
    get(key: string) {
      return target === "merged" ? resolveVariable(sources, key) : sources[target][key];
    },
    set(key: string, value: unknown) {
      const next = asString(value);
      if (target === "merged") {
        sources.runtime[key] = next;
      } else {
        sources[target][key] = next;
      }
    },
    unset(key: string) {
      if (target === "merged") {
        delete sources.runtime[key];
      } else {
        delete sources[target][key];
      }
    },
    toObject() {
      return target === "merged"
        ? { ...getMergedVariables(sources) }
        : { ...sources[target] };
    },
    replaceIn(value: string) {
      return replaceTemplateVariables(asString(value), getMergedVariables(sources));
    },
  };
}

function createPmCompat(
  phase: "pre-request" | "post-response",
  scriptName: string,
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
    setHeader: (key: string, value: string) => void;
    removeHeader: (key: string) => void;
    setMethod: (method: string) => void;
    setUrl: (url: string) => void;
    setBody: (value: unknown) => void;
  },
  response: ScriptResponseContext | null,
  testRunner: ((name: string, fn: () => void) => void) | null,
  context?: ScriptRuntimeContext
) {
  const sources = createRuntimeSources(context);
  const logs = context?.logs;
  const log = (level: "info" | "error", message: string) => {
    logs?.push({
      phase,
      level,
      scriptName,
      message,
      timestamp: Date.now(),
    });
  };

  const pm = {
    info: {
      requestName: context?.requestName || "",
    },
    variables: makeVariableApi(sources, "merged"),
    environment: makeVariableApi(sources, "environment"),
    collectionVariables: makeVariableApi(sources, "collection"),
    globals: makeVariableApi(sources, "global"),
    iterationData: {
      get(key: string) {
        return context?.iterationData?.[key];
      },
      toObject() {
        return { ...(context?.iterationData || {}) };
      },
    },
    request: {
      get method() {
        return request.method;
      },
      set method(value: string) {
        request.setMethod(value);
      },
      get url() {
        return request.url;
      },
      set url(value: string) {
        request.setUrl(value);
      },
      get body() {
        return request.body;
      },
      set body(value: string) {
        request.setBody(value);
      },
      headers: {
        get(key: string) {
          return request.headers[key];
        },
        set(key: string, value: unknown) {
          request.setHeader(key, asString(value));
        },
        upsert(key: string, value: unknown) {
          request.setHeader(key, asString(value));
        },
        add(key: string, value: unknown) {
          request.setHeader(key, asString(value));
        },
        remove(key: string) {
          request.removeHeader(key);
        },
        toObject() {
          return { ...request.headers };
        },
      },
    },
    response: response
      ? {
          ...response,
          code: response.status,
          text: () => response.body,
        }
      : null,
    test(name: string, fn: () => void) {
      if (testRunner) {
        testRunner(name, fn);
      } else {
        try {
          fn();
          log("info", `pm.test(${name}) passed`);
        } catch (error) {
          log("error", `pm.test(${name}) failed: ${error instanceof Error ? error.message : "failed"}`);
          throw error;
        }
      }
    },
    expect: makeExpect,
    execution: {
      log(message: unknown) {
        log("info", asString(message));
      },
    },
  };

  return pm;
}

export function executePreRequestScript(
  script: string,
  request: SendRequestPayload,
  context?: ScriptRuntimeContext
): SendRequestPayload {
  if (!script.trim()) {
    return request;
  }

  const mutable = {
    method: request.method,
    url: request.url,
    headers: { ...request.headers },
    body: request.body ?? "",
  };

  const api = {
    setHeader(key: string, value: string) {
      mutable.headers[String(key)] = String(value);
    },
    removeHeader(key: string) {
      delete mutable.headers[String(key)];
    },
    setQueryParam(key: string, value: string) {
      const parsedUrl = new URL(mutable.url);
      parsedUrl.searchParams.set(String(key), String(value));
      mutable.url = parsedUrl.toString();
    },
    removeQueryParam(key: string) {
      const parsedUrl = new URL(mutable.url);
      parsedUrl.searchParams.delete(String(key));
      mutable.url = parsedUrl.toString();
    },
    setBody(value: unknown) {
      mutable.body = asString(value);
    },
    setMethod(method: string) {
      mutable.method = String(method).toUpperCase();
    },
    setUrl(url: string) {
      mutable.url = String(url);
    },
  };

  const scriptName = context?.scriptName || "pre-request";
  const pm = createPmCompat(
    "pre-request",
    scriptName,
    {
      get method() {
        return mutable.method;
      },
      get url() {
        return mutable.url;
      },
      get headers() {
        return mutable.headers;
      },
      get body() {
        return mutable.body;
      },
      setHeader: api.setHeader,
      removeHeader: api.removeHeader,
      setMethod: api.setMethod,
      setUrl: api.setUrl,
      setBody: api.setBody,
    },
    null,
    null,
    context
  );

  try {
    const runner = new Function("req", "api", "pm", "expect", `"use strict";\n${script}`);
    runner(mutable, api, pm, makeExpect);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown pre-request script error";
    context?.logs?.push({
      phase: "pre-request",
      level: "error",
      scriptName,
      message,
      timestamp: Date.now(),
    });
    throw new Error(`Pre-request script error: ${message}`);
  }

  return {
    ...request,
    method: asString(mutable.method).toUpperCase() || request.method,
    url: asString(mutable.url) || request.url,
    headers: mutable.headers,
    body: mutable.body ? asString(mutable.body) : undefined,
  };
}

export function executePostResponseScript(
  script: string,
  request: Pick<SendRequestPayload, "method" | "url" | "headers" | "body">,
  response: ResponseData,
  context?: ScriptRuntimeContext
): AssertionResult[] {
  if (!script.trim()) {
    return [];
  }

  const results: AssertionResult[] = [];
  const record = (name: string, passed: boolean, actual: string, message: string) => {
    results.push({
      assertionId: scriptAssertionId(),
      passed,
      actual,
      message: `[Script] ${name}: ${message}`,
    });
  };

  const test = (name: string, fn: () => void) => {
    try {
      fn();
      record(name, true, "", "passed");
    } catch (error) {
      record(
        name,
        false,
        "",
        error instanceof Error ? error.message : "failed"
      );
    }
  };

  const req = {
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: request.body ?? "",
  };

  const res: ScriptResponseContext = {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body: response.body,
    time: response.time,
    size: response.size,
    contentType: response.contentType,
    json: () => JSON.parse(response.body),
  };

  const scriptName = context?.scriptName || "post-response";
  const pm = createPmCompat(
    "post-response",
    scriptName,
    {
      get method() {
        return req.method;
      },
      get url() {
        return req.url;
      },
      get headers() {
        return req.headers;
      },
      get body() {
        return req.body;
      },
      setHeader: (key, value) => {
        req.headers[String(key)] = String(value);
      },
      removeHeader: (key) => {
        delete req.headers[String(key)];
      },
      setMethod: (method) => {
        req.method = String(method).toUpperCase();
      },
      setUrl: (url) => {
        req.url = String(url);
      },
      setBody: (value) => {
        req.body = asString(value);
      },
    },
    res,
    test,
    context
  );

  try {
    const runner = new Function(
      "req",
      "res",
      "test",
      "expect",
      "pm",
      `"use strict";\n${script}`
    );
    runner(req, res, test, makeExpect, pm);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown post-response script error";
    record("runtime", false, "", message);
    context?.logs?.push({
      phase: "post-response",
      level: "error",
      scriptName,
      message,
      timestamp: Date.now(),
    });
  }

  return results;
}

