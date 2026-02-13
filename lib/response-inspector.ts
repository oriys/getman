/**
 * Layer 2: Response Inspector
 * 
 * Handles parsing, formatting, and analyzing HTTP responses:
 * - Content type detection
 * - JSON/XML formatting
 * - Response validation
 * - Data extraction
 */

import type { ResponseData, ResponseFormat } from './capability-types';

/**
 * Detect response format from content type and body
 */
export function detectResponseFormat(response: ResponseData): ResponseFormat {
  const contentType = response.contentType.toLowerCase();
  
  // Check content type first
  if (contentType.includes('application/json') || contentType.includes('application/vnd.api+json')) {
    return 'json';
  }
  if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
    return 'xml';
  }
  if (contentType.includes('text/html')) {
    return 'html';
  }
  if (contentType.includes('text/javascript') || contentType.includes('application/javascript')) {
    return 'javascript';
  }
  if (contentType.includes('text/css')) {
    return 'css';
  }
  if (contentType.includes('image/')) {
    return 'image';
  }
  if (contentType.includes('application/pdf')) {
    return 'pdf';
  }
  if (contentType.includes('text/')) {
    return 'text';
  }
  
  // Try to detect from body content
  const body = response.body.trim();
  if (body.startsWith('{') || body.startsWith('[')) {
    try {
      JSON.parse(body);
      return 'json';
    } catch {
      // Not valid JSON
    }
  }
  
  if (body.startsWith('<?xml') || body.startsWith('<')) {
    return 'xml';
  }
  
  // Default to binary if content type is application/octet-stream or unknown
  if (contentType.includes('application/octet-stream') || !contentType.includes('text')) {
    return 'binary';
  }
  
  return 'text';
}

/**
 * Format JSON with proper indentation
 */
export function formatJSON(text: string, indent: number = 2): { 
  formatted: string; 
  error?: string 
} {
  try {
    const parsed = JSON.parse(text);
    const formatted = JSON.stringify(parsed, null, indent);
    return { formatted };
  } catch (error) {
    return { 
      formatted: text, 
      error: error instanceof Error ? error.message : 'Invalid JSON' 
    };
  }
}

/**
 * Validate JSON and get parse tree
 */
export function parseJSON(text: string): {
  valid: boolean;
  parsed?: unknown;
  error?: string;
} {
  try {
    const parsed = JSON.parse(text);
    return { valid: true, parsed };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid JSON'
    };
  }
}

/**
 * Extract value from JSON using JSONPath-like syntax
 * Supports simple paths like: $.user.name, $.items[0].id
 */
export function extractJSONPath(data: unknown, path: string): {
  value?: unknown;
  found: boolean;
  error?: string;
} {
  try {
    // Remove leading $. or $[
    let cleanPath = path.trim();
    if (cleanPath.startsWith('$.')) {
      cleanPath = cleanPath.substring(2);
    } else if (cleanPath.startsWith('$[')) {
      cleanPath = cleanPath.substring(1);
    } else if (cleanPath === '$') {
      return { value: data, found: true };
    }
    
    // Split path into segments
    const segments = cleanPath.split(/\.|\[/).map(s => s.replace(/\]/g, ''));
    
    let current: any = data;
    for (const segment of segments) {
      if (segment === '') continue;
      
      if (current === null || current === undefined) {
        return { found: false, error: 'Path not found' };
      }
      
      // Handle array index
      if (/^\d+$/.test(segment)) {
        const index = parseInt(segment, 10);
        if (Array.isArray(current) && index < current.length) {
          current = current[index];
        } else {
          return { found: false, error: `Array index ${index} out of bounds` };
        }
      } else {
        // Handle object property
        if (typeof current === 'object' && segment in current) {
          current = current[segment];
        } else {
          return { found: false, error: `Property '${segment}' not found` };
        }
      }
    }
    
    return { value: current, found: true };
  } catch (error) {
    return {
      found: false,
      error: error instanceof Error ? error.message : 'Failed to extract path'
    };
  }
}

/**
 * Search for text in response body (case-insensitive)
 */
export function searchInResponse(
  response: ResponseData,
  searchText: string
): {
  found: boolean;
  matches: Array<{ line: number; column: number; text: string }>;
} {
  if (!searchText) {
    return { found: false, matches: [] };
  }
  
  const lines = response.body.split('\n');
  const matches: Array<{ line: number; column: number; text: string }> = [];
  const searchLower = searchText.toLowerCase();
  
  lines.forEach((line, lineIndex) => {
    const lineLower = line.toLowerCase();
    let columnIndex = 0;
    
    while (true) {
      const index = lineLower.indexOf(searchLower, columnIndex);
      if (index === -1) break;
      
      // Extract context around match (30 chars before and after)
      const start = Math.max(0, index - 30);
      const end = Math.min(line.length, index + searchText.length + 30);
      let context = line.substring(start, end);
      
      if (start > 0) context = '...' + context;
      if (end < line.length) context = context + '...';
      
      matches.push({
        line: lineIndex + 1,
        column: index + 1,
        text: context
      });
      
      columnIndex = index + searchText.length;
    }
  });
  
  return {
    found: matches.length > 0,
    matches
  };
}

/**
 * Get response size in human-readable format
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

/**
 * Get response time in human-readable format
 */
export function formatTime(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
}

/**
 * Check if response is successful (2xx status)
 */
export function isSuccessResponse(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Get status category
 */
export function getStatusCategory(status: number): {
  category: 'info' | 'success' | 'redirect' | 'client-error' | 'server-error';
  description: string;
} {
  if (status >= 100 && status < 200) {
    return { category: 'info', description: 'Informational' };
  }
  if (status >= 200 && status < 300) {
    return { category: 'success', description: 'Success' };
  }
  if (status >= 300 && status < 400) {
    return { category: 'redirect', description: 'Redirection' };
  }
  if (status >= 400 && status < 500) {
    return { category: 'client-error', description: 'Client Error' };
  }
  if (status >= 500 && status < 600) {
    return { category: 'server-error', description: 'Server Error' };
  }
  return { category: 'info', description: 'Unknown' };
}

/**
 * Parse response headers into structured format
 */
export function parseHeaders(headers: Record<string, string>): Array<{
  key: string;
  value: string;
  description?: string;
}> {
  return Object.entries(headers).map(([key, value]) => ({
    key,
    value,
    description: getHeaderDescription(key)
  }));
}

/**
 * Get common header descriptions
 */
function getHeaderDescription(header: string): string | undefined {
  const descriptions: Record<string, string> = {
    'content-type': 'The MIME type of the response body',
    'content-length': 'The size of the response body in bytes',
    'cache-control': 'Directives for caching mechanisms',
    'etag': 'Identifier for a specific version of a resource',
    'last-modified': 'The date and time the resource was last modified',
    'server': 'Information about the server software',
    'set-cookie': 'Send cookies from server to user agent',
    'access-control-allow-origin': 'Which origins can access the resource (CORS)',
    'content-encoding': 'The type of encoding used on the data',
    'transfer-encoding': 'The form of encoding used to transfer the payload',
    'authorization': 'Credentials for authenticating the client',
    'www-authenticate': 'Authentication method that should be used',
    'location': 'URL to redirect a page to',
    'x-ratelimit-limit': 'Request limit per time period',
    'x-ratelimit-remaining': 'Remaining requests in current period',
    'x-ratelimit-reset': 'Time when the rate limit resets',
  };
  
  return descriptions[header.toLowerCase()];
}

/**
 * Extract cookies from Set-Cookie headers
 */
export function parseCookies(headers: Record<string, string>): Array<{
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}> {
  const cookies: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
  }> = [];
  
  // Get all Set-Cookie headers (there can be multiple)
  Object.entries(headers).forEach(([key, value]) => {
    if (key.toLowerCase() === 'set-cookie') {
      const parts = value.split(';').map(p => p.trim());
      if (parts.length === 0) return;
      
      // First part is name=value
      const [nameValue] = parts;
      const equalIndex = nameValue.indexOf('=');
      if (equalIndex === -1) return;
      
      const cookie: any = {
        name: nameValue.substring(0, equalIndex),
        value: nameValue.substring(equalIndex + 1)
      };
      
      // Parse attributes
      parts.slice(1).forEach(attr => {
        const attrParts = attr.split('=');
        const attrName = attrParts[0].toLowerCase();
        const attrValue = attrParts[1];
        
        if (attrName === 'domain') cookie.domain = attrValue;
        else if (attrName === 'path') cookie.path = attrValue;
        else if (attrName === 'expires') cookie.expires = attrValue;
        else if (attrName === 'httponly') cookie.httpOnly = true;
        else if (attrName === 'secure') cookie.secure = true;
        else if (attrName === 'samesite') cookie.sameSite = attrValue;
      });
      
      cookies.push(cookie);
    }
  });
  
  return cookies;
}

/**
 * Validate response against expected values
 */
export function validateResponse(
  response: ResponseData,
  expectations: {
    status?: number;
    statusRange?: [number, number];
    hasHeader?: string;
    headerValue?: { key: string; value: string };
    bodyContains?: string;
    maxTime?: number;
  }
): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  // Check status code
  if (expectations.status !== undefined && response.status !== expectations.status) {
    errors.push(`Expected status ${expectations.status}, got ${response.status}`);
  }
  
  // Check status range
  if (expectations.statusRange) {
    const [min, max] = expectations.statusRange;
    if (response.status < min || response.status > max) {
      errors.push(`Status ${response.status} not in range [${min}, ${max}]`);
    }
  }
  
  // Check header exists
  if (expectations.hasHeader) {
    const headerExists = Object.keys(response.headers).some(
      k => k.toLowerCase() === expectations.hasHeader!.toLowerCase()
    );
    if (!headerExists) {
      errors.push(`Header '${expectations.hasHeader}' not found`);
    }
  }
  
  // Check header value
  if (expectations.headerValue) {
    const actualValue = Object.entries(response.headers).find(
      ([k]) => k.toLowerCase() === expectations.headerValue!.key.toLowerCase()
    )?.[1];
    
    if (actualValue !== expectations.headerValue.value) {
      errors.push(
        `Header '${expectations.headerValue.key}' expected '${expectations.headerValue.value}', got '${actualValue}'`
      );
    }
  }
  
  // Check body contains
  if (expectations.bodyContains) {
    if (!response.body.includes(expectations.bodyContains)) {
      errors.push(`Body does not contain '${expectations.bodyContains}'`);
    }
  }
  
  // Check response time
  if (expectations.maxTime !== undefined && response.time > expectations.maxTime) {
    errors.push(`Response time ${response.time}ms exceeds maximum ${expectations.maxTime}ms`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
