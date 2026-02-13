/**
 * Layer 4: Collection System
 * 
 * Handles collection management, running, and data-driven testing:
 * - Collection organization and execution
 * - Environment variable resolution
 * - Data-driven testing with CSV/JSON
 * - Collection runner with iteration support
 */

import type {
  Collection,
  CollectionFolder,
  SavedRequest,
  Environment,
  CollectionRunResult,
  IterationResult,
  RequestExecutionResult,
  DataFile,
  RunnerConfig
} from './capability-types';
import type { ResponseData, RequestTab } from './getman-store';
import { executePreRequestScript, executeTestScript, executeAssertions } from './script-engine';
import { prepareRequest } from './request-builder';

/**
 * Flatten collection into list of requests for execution
 */
export function flattenCollection(collection: Collection): SavedRequest[] {
  const requests: SavedRequest[] = [];
  
  // Add root-level requests
  requests.push(...collection.requests);
  
  // Recursively add requests from folders
  function addFromFolder(folder: CollectionFolder) {
    requests.push(...folder.requests);
    folder.folders.forEach(subfolder => addFromFolder(subfolder));
  }
  
  collection.folders.forEach(folder => addFromFolder(folder));
  
  return requests;
}

/**
 * Get requests from a specific folder path
 */
export function getRequestsFromFolderPath(
  collection: Collection,
  folderPath: string[]
): SavedRequest[] {
  if (folderPath.length === 0) {
    return flattenCollection(collection);
  }
  
  let currentFolders = collection.folders;
  let folder: CollectionFolder | undefined;
  
  // Navigate to the target folder
  for (const folderName of folderPath) {
    folder = currentFolders.find(f => f.name === folderName);
    if (!folder) {
      return [];
    }
    currentFolders = folder.folders;
  }
  
  if (!folder) {
    return [];
  }
  
  // Flatten the folder and its subfolders
  const requests: SavedRequest[] = [...folder.requests];
  
  function addFromSubfolder(f: CollectionFolder) {
    requests.push(...f.requests);
    f.folders.forEach(subfolder => addFromSubfolder(subfolder));
  }
  
  folder.folders.forEach(subfolder => addFromSubfolder(subfolder));
  
  return requests;
}

/**
 * Resolve variables from multiple scopes
 * Priority: local > environment > collection > global
 */
export function resolveVariables(
  input: string,
  scopes: {
    local?: Record<string, string>;
    environment?: Environment;
    collection?: Collection;
    global?: Record<string, string>;
  }
): string {
  let result = input;
  
  // Build variable map with priority
  const variables = new Map<string, string>();
  
  // Global variables (lowest priority)
  if (scopes.global) {
    Object.entries(scopes.global).forEach(([key, value]) => variables.set(key, value));
  }
  
  // Collection variables
  if (scopes.collection?.variables) {
    scopes.collection.variables
      .filter(variable => variable.enabled && variable.key)
      .forEach(variable => variables.set(variable.key, variable.value));
  }
  
  // Environment variables
  if (scopes.environment?.variables) {
    scopes.environment.variables
      .filter(variable => variable.enabled && variable.key)
      .forEach(variable => variables.set(variable.key, variable.value));
  }
  
  // Local variables (highest priority)
  if (scopes.local) {
    Object.entries(scopes.local).forEach(([key, value]) => variables.set(key, value));
  }
  
  // Replace all variables
  variables.forEach((value, key) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value);
  });
  
  return result;
}

/**
 * Parse CSV data file
 */
export function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split('\n');
  if (lines.length === 0) {
    return [];
  }
  
  // First line is headers
  const headers = lines[0].split(',').map(h => h.trim());
  
  // Parse data rows
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const row: Record<string, string> = {};
    
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    
    rows.push(row);
  }
  
  return rows;
}

/**
 * Parse JSON data file
 */
export function parseJSONData(content: string): Record<string, string>[] {
  try {
    const parsed = JSON.parse(content);
    
    if (Array.isArray(parsed)) {
      // Convert each object to string values
      return parsed.map(item => {
        const row: Record<string, string> = {};
        Object.entries(item).forEach(([key, value]) => {
          row[key] = String(value);
        });
        return row;
      });
    } else if (typeof parsed === 'object' && parsed !== null) {
      // Single object - wrap in array
      const row: Record<string, string> = {};
      Object.entries(parsed).forEach(([key, value]) => {
        row[key] = String(value);
      });
      return [row];
    }
    
    return [];
  } catch {
    return [];
  }
}

/**
 * Load data file
 */
export function loadDataFile(dataFile: DataFile): Record<string, string>[] {
  if (dataFile.type === 'csv') {
    return parseCSV(dataFile.content);
  } else if (dataFile.type === 'json') {
    return parseJSONData(dataFile.content);
  }
  return [];
}

/**
 * Run a single request with scripts and assertions
 */
export async function runRequest(
  request: SavedRequest,
  environment: Environment | undefined,
  collection: Collection | undefined,
  iterationData?: Record<string, string>,
  sendHttpRequest?: (config: any) => Promise<ResponseData>
): Promise<RequestExecutionResult> {
  const startTime = Date.now();
  
  try {
    // Build variable context
    const envMap = new Map<string, string>();
    if (environment?.variables) {
      environment.variables
        .filter(v => v.enabled && v.key)
        .forEach(v => envMap.set(v.key, v.value));
    }
    
    // Add iteration data to variables
    if (iterationData) {
      Object.entries(iterationData).forEach(([k, v]) => envMap.set(k, v));
    }
    
    // Execute pre-request script
    let preRequestScriptResult;
    let modifiedRequest = { ...request.tab };
    
    if (request.preRequestScript || collection?.preRequestScript) {
      const script = request.preRequestScript || collection!.preRequestScript!;
      preRequestScriptResult = await executePreRequestScript(
        script,
        modifiedRequest,
        envMap
      );
      
      if (!preRequestScriptResult.success) {
        throw new Error(`Pre-request script failed: ${preRequestScriptResult.error}`);
      }
      
      // Apply modifications
      if (preRequestScriptResult.modifiedRequest) {
        modifiedRequest = { ...modifiedRequest, ...preRequestScriptResult.modifiedRequest };
      }
      
      // Update environment with extracted variables
      if (preRequestScriptResult.extractedVariables) {
        Object.entries(preRequestScriptResult.extractedVariables).forEach(([k, v]) => {
          envMap.set(k, v);
        });
      }
    }
    
    // Prepare and send request
    const preparedRequest = prepareRequest(
      modifiedRequest,
      (input) => resolveVariables(input, { environment, collection, local: iterationData })
    );
    
    // Send request (would use actual HTTP client in real implementation)
    const response: ResponseData = sendHttpRequest 
      ? await sendHttpRequest(preparedRequest)
      : {
          status: 200,
          statusText: 'OK',
          headers: {},
          body: '{}',
          time: 0,
          size: 0,
          contentType: 'application/json'
        };
    
    // Execute test script
    let testScriptResult;
    if (request.testScript || collection?.testScript) {
      const script = request.testScript || collection!.testScript!;
      testScriptResult = await executeTestScript(
        script,
        modifiedRequest,
        response,
        envMap
      );
      
      // Update environment with extracted variables
      if (testScriptResult.extractedVariables) {
        Object.entries(testScriptResult.extractedVariables).forEach(([k, v]) => {
          envMap.set(k, v);
        });
      }
    }
    
    // Execute assertions
    if (request.assertions && request.assertions.length > 0) {
      const assertionResults = executeAssertions(request.assertions, response);
      
      if (testScriptResult) {
        testScriptResult.tests.push(...assertionResults);
      } else {
        testScriptResult = {
          success: true,
          tests: assertionResults
        };
      }
    }
    
    const duration = Date.now() - startTime;
    
    return {
      requestId: request.id,
      requestName: request.name,
      timestamp: startTime,
      duration,
      request: {
        method: preparedRequest.method,
        url: preparedRequest.url,
        headers: preparedRequest.headers,
        body: preparedRequest.body || undefined
      },
      response,
      preRequestScriptResult,
      testScriptResult
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    
    // Return error result
    return {
      requestId: request.id,
      requestName: request.name,
      timestamp: startTime,
      duration,
      request: {
        method: request.method,
        url: request.url,
        headers: {},
      },
      response: {
        status: 0,
        statusText: 'Error',
        headers: {},
        body: '',
        time: 0,
        size: 0,
        contentType: 'text/plain'
      },
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Run collection with configuration
 */
export async function runCollection(
  collection: Collection,
  config: RunnerConfig,
  environment: Environment | undefined,
  sendHttpRequest?: (config: any) => Promise<ResponseData>,
  onProgress?: (progress: { current: number; total: number; request: string }) => void
): Promise<CollectionRunResult> {
  const runId = crypto.randomUUID();
  const startTime = Date.now();
  
  // Get requests to run
  let requests: SavedRequest[];
  if (config.requestIds && config.requestIds.length > 0) {
    // Run specific requests
    const allRequests = flattenCollection(collection);
    requests = allRequests.filter(r => config.requestIds!.includes(r.id));
  } else if (config.folderPath && config.folderPath.length > 0) {
    // Run specific folder
    requests = getRequestsFromFolderPath(collection, config.folderPath);
  } else {
    // Run entire collection
    requests = flattenCollection(collection);
  }
  
  // Load data file if provided
  const dataRows = config.dataFile ? loadDataFile(config.dataFile) : [{}];
  const iterations = config.iterations || 1;
  
  // Run iterations
  const iterationResults: IterationResult[] = [];
  let totalRequests = 0;
  let successfulRequests = 0;
  let failedRequests = 0;
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  
  for (let i = 0; i < iterations; i++) {
    const iterationData = dataRows[i % dataRows.length];
    const results: RequestExecutionResult[] = [];
    
    for (let j = 0; j < requests.length; j++) {
      const request = requests[j];
      
      // Report progress
      if (onProgress) {
        onProgress({
          current: i * requests.length + j + 1,
          total: iterations * requests.length,
          request: request.name
        });
      }
      
      // Run request
      const result = await runRequest(
        request,
        environment,
        collection,
        iterationData,
        sendHttpRequest
      );
      
      results.push(result);
      totalRequests++;
      
      if (result.error) {
        failedRequests++;
      } else {
        successfulRequests++;
      }
      
      // Count tests
      if (result.testScriptResult) {
        result.testScriptResult.tests.forEach(test => {
          totalTests++;
          if (test.passed) {
            passedTests++;
          } else {
            failedTests++;
          }
        });
      }
      
      // Stop on failure if configured
      if (config.stopOnFailure && result.error) {
        break;
      }
      
      // Apply delay between requests
      if (config.delay && j < requests.length - 1) {
        await new Promise(resolve => setTimeout(resolve, config.delay));
      }
    }
    
    iterationResults.push({
      iteration: i + 1,
      results
    });
    
    // Stop on failure if configured
    if (config.stopOnFailure && results.some(r => r.error)) {
      break;
    }
  }
  
  const endTime = Date.now();
  
  return {
    runId,
    collectionId: collection.id,
    collectionName: collection.name,
    startTime,
    endTime,
    duration: endTime - startTime,
    totalRequests,
    successfulRequests,
    failedRequests,
    totalTests,
    passedTests,
    failedTests,
    iterations: iterationResults
  };
}

/**
 * Export collection run results to various formats
 */
export function exportRunResults(
  result: CollectionRunResult,
  format: 'json' | 'html' | 'junit'
): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }
  
  if (format === 'junit') {
    // Convert to JUnit XML format
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += `<testsuites name="${result.collectionName}" tests="${result.totalTests}" failures="${result.failedTests}" time="${result.duration / 1000}">\n`;
    
    result.iterations.forEach((iteration, idx) => {
      xml += `  <testsuite name="Iteration ${iteration.iteration}" tests="${iteration.results.length}">\n`;
      
      iteration.results.forEach(req => {
        xml += `    <testcase name="${req.requestName}" time="${req.duration / 1000}">\n`;
        
        if (req.error) {
          xml += `      <error message="${escapeXml(req.error)}" />\n`;
        }
        
        if (req.testScriptResult) {
          req.testScriptResult.tests.forEach(test => {
            if (!test.passed) {
              xml += `      <failure message="${escapeXml(test.message)}">${escapeXml(test.name)}</failure>\n`;
            }
          });
        }
        
        xml += `    </testcase>\n`;
      });
      
      xml += `  </testsuite>\n`;
    });
    
    xml += `</testsuites>`;
    return xml;
  }
  
  if (format === 'html') {
    // Generate HTML report
    let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
    html += '<title>Collection Run Report</title>';
    html += '<style>body{font-family:Arial,sans-serif;margin:20px}';
    html += '.summary{background:#f5f5f5;padding:20px;border-radius:5px;margin-bottom:20px}';
    html += '.request{margin:10px 0;padding:10px;border:1px solid #ddd;border-radius:5px}';
    html += '.success{color:green}.failure{color:red}</style>';
    html += '</head><body>';
    html += `<h1>${result.collectionName}</h1>`;
    html += '<div class="summary">';
    html += `<p>Total Requests: ${result.totalRequests}</p>`;
    html += `<p>Successful: <span class="success">${result.successfulRequests}</span></p>`;
    html += `<p>Failed: <span class="failure">${result.failedRequests}</span></p>`;
    html += `<p>Total Tests: ${result.totalTests}</p>`;
    html += `<p>Passed: <span class="success">${result.passedTests}</span></p>`;
    html += `<p>Failed: <span class="failure">${result.failedTests}</span></p>`;
    html += `<p>Duration: ${result.duration}ms</p>`;
    html += '</div>';
    
    result.iterations.forEach(iteration => {
      html += `<h2>Iteration ${iteration.iteration}</h2>`;
      iteration.results.forEach(req => {
        const statusClass = req.error ? 'failure' : 'success';
        html += `<div class="request">`;
        html += `<h3 class="${statusClass}">${req.requestName}</h3>`;
        html += `<p>${req.request.method} ${req.request.url}</p>`;
        html += `<p>Status: ${req.response.status} ${req.response.statusText}</p>`;
        html += `<p>Time: ${req.duration}ms</p>`;
        if (req.error) {
          html += `<p class="failure">Error: ${escapeHtml(req.error)}</p>`;
        }
        html += '</div>';
      });
    });
    
    html += '</body></html>';
    return html;
  }
  
  return '';
}

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
