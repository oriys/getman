'use client';

/**
 * Test Assertion Engine
 *
 * Evaluates assertions against HTTP response data (status code, headers, body JSONPath).
 */

import type { TestAssertion, AssertionResult, ResponseData } from "./getman-store";

// ─── JSONPath (simple implementation) ─────────────────────────────────────────

function evaluateJsonPath(obj: unknown, path: string): unknown {
  if (!path.startsWith("$.") && !path.startsWith("$[")) {
    path = "$." + path;
  }

  const segments: string[] = [];
  let current = "";
  let inBracket = false;

  for (let i = 2; i < path.length; i++) {
    const ch = path[i];
    if (ch === "[") {
      if (current) segments.push(current);
      current = "";
      inBracket = true;
    } else if (ch === "]") {
      segments.push(current);
      current = "";
      inBracket = false;
    } else if (ch === "." && !inBracket) {
      if (current) segments.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) segments.push(current);

  let value: unknown = obj;
  for (const seg of segments) {
    if (value === null || value === undefined) return undefined;

    // Array index
    const idx = Number(seg);
    if (!isNaN(idx) && Array.isArray(value)) {
      value = value[idx];
    } else if (typeof value === "object" && value !== null) {
      value = (value as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return value;
}

// ─── Comparison ──────────────────────────────────────────────────────────────

function compareValues(
  actual: string,
  expected: string,
  comparison: TestAssertion["comparison"]
): boolean {
  switch (comparison) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "contains":
      return actual.includes(expected);
    case "gt":
      return parseFloat(actual) > parseFloat(expected);
    case "lt":
      return parseFloat(actual) < parseFloat(expected);
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "matches":
      try {
        return new RegExp(expected).test(actual);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

// ─── Assertion Runner ─────────────────────────────────────────────────────────

export function runAssertions(
  assertions: TestAssertion[],
  response: ResponseData
): AssertionResult[] {
  return assertions
    .filter((a) => a.enabled)
    .map((assertion): AssertionResult => {
      try {
        let actual: string;

        switch (assertion.type) {
          case "status": {
            actual = String(response.status);
            const passed = compareValues(actual, assertion.expected, assertion.comparison);
            return {
              assertionId: assertion.id,
              passed,
              actual,
              message: passed
                ? `Status ${assertion.comparison} ${assertion.expected}`
                : `Expected status ${assertion.comparison} ${assertion.expected}, got ${actual}`,
            };
          }

          case "header": {
            const headerKey = assertion.property.toLowerCase();
            actual = "";
            for (const [k, v] of Object.entries(response.headers)) {
              if (k.toLowerCase() === headerKey) {
                actual = v;
                break;
              }
            }
            const passed = compareValues(actual, assertion.expected, assertion.comparison);
            return {
              assertionId: assertion.id,
              passed,
              actual,
              message: passed
                ? `Header "${assertion.property}" ${assertion.comparison} ${assertion.expected}`
                : `Expected header "${assertion.property}" ${assertion.comparison} "${assertion.expected}", got "${actual}"`,
            };
          }

          case "jsonpath": {
            let parsed: unknown;
            try {
              parsed = JSON.parse(response.body);
            } catch {
              return {
                assertionId: assertion.id,
                passed: false,
                actual: "",
                message: "Response body is not valid JSON",
              };
            }

            const result = evaluateJsonPath(parsed, assertion.property);
            actual = result === undefined ? "" : JSON.stringify(result);
            // Strip quotes from simple strings for comparison
            if (actual.startsWith('"') && actual.endsWith('"')) {
              actual = actual.slice(1, -1);
            }
            const passed = compareValues(actual, assertion.expected, assertion.comparison);
            return {
              assertionId: assertion.id,
              passed,
              actual,
              message: passed
                ? `JSONPath "${assertion.property}" ${assertion.comparison} ${assertion.expected}`
                : `Expected JSONPath "${assertion.property}" ${assertion.comparison} "${assertion.expected}", got "${actual}"`,
            };
          }

          case "body-contains": {
            actual = response.body;
            const passed = actual.includes(assertion.expected);
            return {
              assertionId: assertion.id,
              passed,
              actual: actual.length > 100 ? actual.slice(0, 100) + "..." : actual,
              message: passed
                ? `Body contains "${assertion.expected}"`
                : `Body does not contain "${assertion.expected}"`,
            };
          }

          default:
            return {
              assertionId: assertion.id,
              passed: false,
              actual: "",
              message: `Unknown assertion type: ${assertion.type}`,
            };
        }
      } catch (err) {
        return {
          assertionId: assertion.id,
          passed: false,
          actual: "",
          message: `Assertion error: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    });
}
