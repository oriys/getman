/**
 * Layer 3: Test & Script Engine
 * 
 * Handles execution of pre-request and test scripts:
 * - Script execution in a sandboxed environment
 * - Assertion API similar to Postman's pm object
 * - Variable extraction and manipulation
 * - JSONPath querying
 */

import type { 
  Script, 
  TestResult, 
  TestAssertion, 
  PreRequestScriptResult,
  TestScriptResult,
  ScriptContext 
} from './capability-types';
import type { ResponseData, RequestTab, KeyValue } from './getman-store';
import { extractJSONPath, parseJSON } from './response-inspector';

/**
 * Execute pre-request script
 */
export async function executePreRequestScript(
  script: Script,
  request: RequestTab,
  environment: Map<string, string>
): Promise<PreRequestScriptResult> {
  if (!script.enabled || !script.code.trim()) {
    return { success: true };
  }
  
  try {
    const context = createScriptContext(request, undefined, environment);
    
    // Execute the script
    await executeScript(script.code, context);
    
    // Extract any modified request properties
    const modifiedRequest: Partial<RequestTab> = {};
    
    // Check if URL was modified
    if (context.request.url !== request.url) {
      modifiedRequest.url = context.request.url;
    }
    
    // Check if method was modified
    if (context.request.method !== request.method) {
      modifiedRequest.method = context.request.method as any;
    }
    
    // Extract variables that were set
    const extractedVariables: Record<string, string> = {};
    context.variables.forEach((value, key) => {
      extractedVariables[key] = value;
    });
    
    return {
      success: true,
      modifiedRequest: Object.keys(modifiedRequest).length > 0 ? modifiedRequest : undefined,
      extractedVariables: Object.keys(extractedVariables).length > 0 ? extractedVariables : undefined
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Script execution failed'
    };
  }
}

/**
 * Execute test script
 */
export async function executeTestScript(
  script: Script,
  request: RequestTab,
  response: ResponseData,
  environment: Map<string, string>
): Promise<TestScriptResult> {
  if (!script.enabled || !script.code.trim()) {
    return { success: true, tests: [] };
  }
  
  try {
    const context = createScriptContext(request, response, environment);
    const tests: TestResult[] = [];
    
    // Override pm.test to collect test results
    (context as any).test = (name: string, fn: () => void | Promise<void>) => {
      try {
        const testResult: TestResult = {
          id: crypto.randomUUID(),
          assertionId: '',
          name,
          passed: true,
          message: 'Test passed'
        };
        
        // Execute test function
        fn();
        
        tests.push(testResult);
      } catch (error) {
        tests.push({
          id: crypto.randomUUID(),
          assertionId: '',
          name,
          passed: false,
          message: error instanceof Error ? error.message : 'Test failed'
        });
      }
    };
    
    // Execute the script
    await executeScript(script.code, context);
    
    // Extract variables that were set
    const extractedVariables: Record<string, string> = {};
    context.variables.forEach((value, key) => {
      extractedVariables[key] = value;
    });
    
    return {
      success: true,
      tests,
      extractedVariables: Object.keys(extractedVariables).length > 0 ? extractedVariables : undefined
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Script execution failed',
      tests: []
    };
  }
}

/**
 * Execute assertions (non-script based testing)
 */
export function executeAssertions(
  assertions: TestAssertion[],
  response: ResponseData
): TestResult[] {
  const results: TestResult[] = [];
  
  for (const assertion of assertions) {
    if (!assertion.enabled) continue;
    
    const result: TestResult = {
      id: crypto.randomUUID(),
      assertionId: assertion.id,
      name: assertion.name,
      passed: false,
      message: ''
    };
    
    try {
      switch (assertion.type) {
        case 'status':
          if (assertion.expectedStatus !== undefined) {
            result.passed = response.status === assertion.expectedStatus;
            result.message = result.passed
              ? `Status is ${response.status}`
              : `Expected status ${assertion.expectedStatus}, got ${response.status}`;
            result.actualValue = response.status;
            result.expectedValue = assertion.expectedStatus;
          }
          break;
          
        case 'header':
          if (assertion.headerKey) {
            const actualValue = Object.entries(response.headers).find(
              ([k]) => k.toLowerCase() === assertion.headerKey!.toLowerCase()
            )?.[1];
            
            if (assertion.headerValue) {
              result.passed = actualValue === assertion.headerValue;
              result.message = result.passed
                ? `Header '${assertion.headerKey}' is '${actualValue}'`
                : `Expected header '${assertion.headerKey}' to be '${assertion.headerValue}', got '${actualValue}'`;
              result.actualValue = actualValue;
              result.expectedValue = assertion.headerValue;
            } else {
              result.passed = actualValue !== undefined;
              result.message = result.passed
                ? `Header '${assertion.headerKey}' exists`
                : `Header '${assertion.headerKey}' not found`;
            }
          }
          break;
          
        case 'body-contains':
          if (assertion.bodyValue) {
            result.passed = response.body.includes(assertion.bodyValue);
            result.message = result.passed
              ? `Body contains '${assertion.bodyValue}'`
              : `Body does not contain '${assertion.bodyValue}'`;
            result.expectedValue = assertion.bodyValue;
          }
          break;
          
        case 'json-path':
          if (assertion.jsonPath) {
            const { parsed } = parseJSON(response.body);
            if (parsed) {
              const { found, value, error } = extractJSONPath(parsed, assertion.jsonPath);
              result.passed = found;
              result.message = found
                ? `JSONPath '${assertion.jsonPath}' found with value: ${JSON.stringify(value)}`
                : error || `JSONPath '${assertion.jsonPath}' not found`;
              result.actualValue = value;
            } else {
              result.passed = false;
              result.message = 'Response body is not valid JSON';
            }
          }
          break;
          
        case 'response-time':
          if (assertion.maxResponseTime !== undefined) {
            result.passed = response.time <= assertion.maxResponseTime;
            result.message = result.passed
              ? `Response time ${response.time}ms is within limit`
              : `Response time ${response.time}ms exceeds maximum ${assertion.maxResponseTime}ms`;
            result.actualValue = response.time;
            result.expectedValue = assertion.maxResponseTime;
          }
          break;
      }
    } catch (error) {
      result.passed = false;
      result.message = error instanceof Error ? error.message : 'Assertion failed';
    }
    
    results.push(result);
  }
  
  return results;
}

/**
 * Create script execution context (pm object)
 */
function createScriptContext(
  request: RequestTab,
  response: ResponseData | undefined,
  environment: Map<string, string>
): ScriptContext {
  // Create mutable variables map
  const variables = new Map<string, string>(environment);
  
  const context: ScriptContext = {
    environment: {
      get: (key: string) => environment.get(key),
      set: (key: string, value: string) => {
        environment.set(key, value);
      },
      unset: (key: string) => {
        environment.delete(key);
      }
    },
    variables: {
      get: (key: string) => variables.get(key),
      set: (key: string, value: string) => {
        variables.set(key, value);
      }
    },
    request: {
      url: request.url,
      method: request.method,
      headers: buildHeadersObject(request.headers),
      body: request.bodyContent
    },
    test: (name: string, fn: () => void | Promise<void>) => {
      // This will be overridden by the test script executor
      fn();
    },
    expect: (value: unknown) => createChaiAssertion(value)
  };
  
  // Add response context if available
  if (response) {
    context.response = {
      code: response.status,
      status: response.statusText,
      headers: response.headers,
      body: response.body,
      json: () => {
        try {
          return JSON.parse(response.body);
        } catch {
          throw new Error('Response body is not valid JSON');
        }
      },
      text: () => response.body,
      responseTime: response.time
    };
  }
  
  return context;
}

/**
 * Build headers object from KeyValue array
 */
function buildHeadersObject(headers: KeyValue[]): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach(h => {
    if (h.enabled && h.key) {
      result[h.key] = h.value;
    }
  });
  return result;
}

/**
 * Execute script code in a controlled environment
 * 
 * SECURITY WARNING: This uses Function constructor which is not secure.
 * In production, this MUST be replaced with a proper sandboxed environment
 * such as QuickJS, Deno core, or isolated-vm.
 * 
 * Current implementation is for demonstration purposes only.
 */
async function executeScript(code: string, context: ScriptContext): Promise<void> {
  // TODO: Replace with proper sandboxed execution
  // Options:
  // 1. QuickJS (lightweight JavaScript engine)
  // 2. Deno core (V8 isolate with limited APIs)
  // 3. isolated-vm (V8 isolates in Node.js)
  
  const pm = context;
  
  // Create function and execute
  const scriptFn = new Function('pm', code);
  const result = scriptFn(pm);
  
  // Handle async scripts
  if (result instanceof Promise) {
    await result;
  }
}

/**
 * Create Chai-like assertion object
 */
function createChaiAssertion(value: unknown): any {
  const assertion = {
    to: {
      equal: (expected: unknown) => {
        if (value !== expected) {
          throw new Error(`Expected ${JSON.stringify(value)} to equal ${JSON.stringify(expected)}`);
        }
      },
      be: {
        a: (type: string) => {
          const actualType = Array.isArray(value) ? 'array' : typeof value;
          if (actualType !== type.toLowerCase()) {
            throw new Error(`Expected ${JSON.stringify(value)} to be a ${type}`);
          }
        },
        an: (type: string) => {
          const actualType = Array.isArray(value) ? 'array' : typeof value;
          if (actualType !== type.toLowerCase()) {
            throw new Error(`Expected ${JSON.stringify(value)} to be an ${type}`);
          }
        },
        get true() {
          if (value !== true) {
            throw new Error(`Expected ${JSON.stringify(value)} to be true`);
          }
          return true;
        },
        get false() {
          if (value !== false) {
            throw new Error(`Expected ${JSON.stringify(value)} to be false`);
          }
          return true;
        },
        get null() {
          if (value !== null) {
            throw new Error(`Expected ${JSON.stringify(value)} to be null`);
          }
          return true;
        },
        get undefined() {
          if (value !== undefined) {
            throw new Error(`Expected ${JSON.stringify(value)} to be undefined`);
          }
          return true;
        }
      },
      have: {
        property: (key: string, expectedValue?: unknown) => {
          if (typeof value !== 'object' || value === null) {
            throw new Error(`Expected ${JSON.stringify(value)} to be an object`);
          }
          if (!(key in (value as any))) {
            throw new Error(`Expected object to have property '${key}'`);
          }
          if (expectedValue !== undefined && (value as any)[key] !== expectedValue) {
            throw new Error(
              `Expected property '${key}' to be ${JSON.stringify(expectedValue)}, got ${JSON.stringify((value as any)[key])}`
            );
          }
        },
        length: (length: number) => {
          const actualLength = Array.isArray(value) ? value.length : 
                              typeof value === 'string' ? value.length : 
                              undefined;
          if (actualLength !== length) {
            throw new Error(`Expected length ${length}, got ${actualLength}`);
          }
        },
        status: (code: number) => {
          // This is a special case for response status
          if (typeof value === 'object' && value !== null && 'status' in value) {
            if ((value as any).status !== code) {
              throw new Error(`Expected status ${code}, got ${(value as any).status}`);
            }
          } else {
            throw new Error('Expected response object with status property');
          }
        },
        header: (key: string, expectedValue?: string) => {
          if (typeof value !== 'object' || value === null || !('headers' in value)) {
            throw new Error('Expected response object with headers');
          }
          const headers = (value as any).headers;
          const actualValue = Object.entries(headers).find(
            ([k]) => k.toLowerCase() === key.toLowerCase()
          )?.[1];
          
          if (actualValue === undefined) {
            throw new Error(`Expected header '${key}' to exist`);
          }
          if (expectedValue !== undefined && actualValue !== expectedValue) {
            throw new Error(
              `Expected header '${key}' to be '${expectedValue}', got '${actualValue}'`
            );
          }
        },
        jsonBody: (path: string, expectedValue?: unknown) => {
          if (typeof value !== 'object' || value === null || !('body' in value)) {
            throw new Error('Expected response object with body');
          }
          
          const body = (value as any).body;
          let parsed: unknown;
          try {
            parsed = typeof body === 'string' ? JSON.parse(body) : body;
          } catch {
            throw new Error('Response body is not valid JSON');
          }
          
          const { found, value: actualValue, error } = extractJSONPath(parsed, path);
          if (!found) {
            throw new Error(error || `JSONPath '${path}' not found`);
          }
          
          if (expectedValue !== undefined && actualValue !== expectedValue) {
            throw new Error(
              `Expected JSONPath '${path}' to be ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`
            );
          }
        }
      },
      include: (expectedValue: unknown) => {
        if (Array.isArray(value)) {
          if (!value.includes(expectedValue)) {
            throw new Error(`Expected array to include ${JSON.stringify(expectedValue)}`);
          }
        } else if (typeof value === 'string') {
          if (!value.includes(String(expectedValue))) {
            throw new Error(`Expected string to include ${JSON.stringify(expectedValue)}`);
          }
        } else {
          throw new Error('Expected array or string');
        }
      },
      match: (pattern: RegExp) => {
        if (typeof value !== 'string') {
          throw new Error('Expected string value');
        }
        if (!pattern.test(value)) {
          throw new Error(`Expected ${JSON.stringify(value)} to match ${pattern}`);
        }
      }
    },
    get not() {
      // Return a negated version of the assertion
      return createNegatedAssertion(value);
    }
  };
  
  return assertion;
}

/**
 * Create negated assertion
 */
function createNegatedAssertion(value: unknown): any {
  // Similar to createChaiAssertion but with negated logic
  // For brevity, implementing a simple version
  return {
    to: {
      equal: (expected: unknown) => {
        if (value === expected) {
          throw new Error(`Expected ${JSON.stringify(value)} not to equal ${JSON.stringify(expected)}`);
        }
      },
      include: (expectedValue: unknown) => {
        if (Array.isArray(value) && value.includes(expectedValue)) {
          throw new Error(`Expected array not to include ${JSON.stringify(expectedValue)}`);
        } else if (typeof value === 'string' && value.includes(String(expectedValue))) {
          throw new Error(`Expected string not to include ${JSON.stringify(expectedValue)}`);
        }
      }
    }
  };
}

/**
 * Validate script syntax
 */
export function validateScriptSyntax(code: string): {
  valid: boolean;
  error?: string;
} {
  try {
    // Try to create a function with the code
    new Function('pm', code);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid syntax'
    };
  }
}
