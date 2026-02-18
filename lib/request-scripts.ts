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

export function executePreRequestScript(
  script: string,
  request: SendRequestPayload
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

  try {
    const runner = new Function("req", "api", `"use strict";\n${script}`);
    runner(mutable, api);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown pre-request script error";
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
  response: ResponseData
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

  try {
    const runner = new Function(
      "req",
      "res",
      "test",
      "expect",
      `"use strict";\n${script}`
    );
    runner(req, res, test, makeExpect);
  } catch (error) {
    record(
      "runtime",
      false,
      "",
      error instanceof Error ? error.message : "Unknown post-response script error"
    );
  }

  return results;
}
