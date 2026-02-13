/**
 * Layer 1: Request Construction Engine
 * 
 * Handles building and configuring HTTP requests with support for:
 * - Multiple HTTP methods
 * - URL construction with path/query parameters
 * - Headers and cookies
 * - Request body (JSON, form data, raw, etc.)
 * - Authentication mechanisms
 * - Variable substitution
 */

import type { HttpRequestConfig, KeyValuePair, DynamicVariable } from './capability-types';
import type { HttpMethod, RequestTab } from './getman-store';

/**
 * Build final URL with resolved path and query parameters
 */
export function buildRequestUrl(
  baseUrl: string,
  params: KeyValuePair[],
  resolveVariables: (input: string) => string
): string {
  let url = resolveVariables(baseUrl);
  
  // Extract enabled query parameters
  const enabledParams = params.filter(p => p.enabled && p.key);
  
  if (enabledParams.length === 0) {
    return url;
  }
  
  // Build query string
  const queryParts = enabledParams.map(p => {
    const key = encodeURIComponent(resolveVariables(p.key));
    const value = encodeURIComponent(resolveVariables(p.value));
    return `${key}=${value}`;
  });
  
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${queryParts.join('&')}`;
}

/**
 * Build headers object with variable resolution
 */
export function buildRequestHeaders(
  headers: KeyValuePair[],
  authHeaders: Record<string, string>,
  resolveVariables: (input: string) => string
): Record<string, string> {
  const result: Record<string, string> = {};
  
  // Add custom headers
  headers
    .filter(h => h.enabled && h.key)
    .forEach(h => {
      const key = resolveVariables(h.key);
      const value = resolveVariables(h.value);
      result[key] = value;
    });
  
  // Add auth headers (these override custom headers)
  Object.entries(authHeaders).forEach(([key, value]) => {
    result[key] = resolveVariables(value);
  });
  
  return result;
}

/**
 * Get authentication headers based on auth configuration
 */
export function getAuthHeaders(tab: RequestTab): Record<string, string> {
  const headers: Record<string, string> = {};
  
  switch (tab.authType) {
    case 'bearer':
      if (tab.authToken) {
        headers['Authorization'] = `Bearer ${tab.authToken}`;
      }
      break;
      
    case 'basic':
      if (tab.authUsername || tab.authPassword) {
        const credentials = btoa(`${tab.authUsername}:${tab.authPassword}`);
        headers['Authorization'] = `Basic ${credentials}`;
      }
      break;
      
    case 'api-key':
      if (tab.authApiKey && tab.authApiValue) {
        if (tab.authApiAddTo === 'header') {
          headers[tab.authApiKey] = tab.authApiValue;
        }
        // Query param handling is done in buildRequestUrl
      }
      break;
  }
  
  return headers;
}

/**
 * Get API key query parameters
 */
export function getAuthQueryParams(tab: RequestTab): KeyValuePair[] {
  if (tab.authType === 'api-key' && 
      tab.authApiAddTo === 'query' && 
      tab.authApiKey && 
      tab.authApiValue) {
    return [{
      id: 'auth-api-key',
      key: tab.authApiKey,
      value: tab.authApiValue,
      enabled: true
    }];
  }
  return [];
}

/**
 * Build request body based on body type
 */
export function buildRequestBody(
  tab: RequestTab,
  resolveVariables: (input: string) => string
): { body: string | null; contentType?: string } {
  switch (tab.bodyType) {
    case 'none':
      return { body: null };
      
    case 'json':
      if (!tab.bodyContent) {
        return { body: null };
      }
      return {
        body: resolveVariables(tab.bodyContent),
        contentType: 'application/json'
      };
      
    case 'raw':
      return {
        body: resolveVariables(tab.bodyContent),
        contentType: 'text/plain'
      };
      
    case 'x-www-form-urlencoded': {
      const enabledFields = tab.bodyFormData.filter(f => f.enabled && f.key);
      if (enabledFields.length === 0) {
        return { body: null };
      }
      const formParts = enabledFields.map(f => {
        const key = encodeURIComponent(resolveVariables(f.key));
        const value = encodeURIComponent(resolveVariables(f.value));
        return `${key}=${value}`;
      });
      return {
        body: formParts.join('&'),
        contentType: 'application/x-www-form-urlencoded'
      };
    }
      
    case 'form-data': {
      // For multipart/form-data, we'd need FormData which is handled by the HTTP client
      // Return a marker that the client should build FormData
      const enabledFields = tab.bodyFormData.filter(f => f.enabled && f.key);
      if (enabledFields.length === 0) {
        return { body: null };
      }
      // Return JSON representation that the client will convert to FormData
      const formData: Record<string, string> = {};
      enabledFields.forEach(f => {
        formData[resolveVariables(f.key)] = resolveVariables(f.value);
      });
      return {
        body: JSON.stringify(formData),
        contentType: 'multipart/form-data'
      };
    }
      
    default:
      return { body: null };
  }
}

/**
 * Generate dynamic variable values
 */
export function resolveDynamicVariables(input: string): string {
  let result = input;
  
  // UUID v4
  result = result.replace(/\{\{\$guid\}\}/g, () => crypto.randomUUID());
  result = result.replace(/\{\{\$randomUUID\}\}/g, () => crypto.randomUUID());
  
  // Timestamps
  result = result.replace(/\{\{\$timestamp\}\}/g, () => Date.now().toString());
  result = result.replace(/\{\{\$isoTimestamp\}\}/g, () => new Date().toISOString());
  
  // Random values
  result = result.replace(/\{\{\$randomInt\}\}/g, () => 
    Math.floor(Math.random() * 1000).toString()
  );
  
  result = result.replace(/\{\{\$randomAlpha\}\}/g, () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return Array.from({ length: 8 }, () => 
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  });
  
  result = result.replace(/\{\{\$randomEmail\}\}/g, () => {
    const user = Math.random().toString(36).substring(7);
    return `${user}@example.com`;
  });
  
  result = result.replace(/\{\{\$randomIP\}\}/g, () => {
    return Array.from({ length: 4 }, () => 
      Math.floor(Math.random() * 256)
    ).join('.');
  });
  
  return result;
}

/**
 * Validate URL format
 */
export function validateUrl(url: string): { valid: boolean; error?: string } {
  if (!url || url.trim() === '') {
    return { valid: false, error: 'URL cannot be empty' };
  }
  
  try {
    // Try to parse as URL
    const parsed = new URL(url);
    
    // Check for supported protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { 
        valid: false, 
        error: `Unsupported protocol: ${parsed.protocol}` 
      };
    }
    
    return { valid: true };
  } catch (error) {
    // If it doesn't have a protocol, it might still be valid with http://
    if (!url.includes('://')) {
      try {
        new URL(`http://${url}`);
        return { valid: true };
      } catch {
        return { valid: false, error: 'Invalid URL format' };
      }
    }
    return { valid: false, error: 'Invalid URL format' };
  }
}

/**
 * Prepare request for sending
 * Combines all request building functions
 */
export function prepareRequest(
  tab: RequestTab,
  resolveVariables: (input: string) => string
): {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body: string | null;
} {
  // Resolve dynamic variables first
  const resolveAll = (input: string) => {
    return resolveDynamicVariables(resolveVariables(input));
  };
  
  // Build auth headers and query params
  const authHeaders = getAuthHeaders(tab);
  const authParams = getAuthQueryParams(tab);
  
  // Build URL with query parameters
  const allParams = [...tab.params, ...authParams];
  const url = buildRequestUrl(tab.url, allParams, resolveAll);
  
  // Build headers
  const headers = buildRequestHeaders(tab.headers, authHeaders, resolveAll);
  
  // Build body
  const { body, contentType } = buildRequestBody(tab, resolveAll);
  
  // Add content-type header if body exists and not already set
  if (body && contentType && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = contentType;
  }
  
  return {
    method: tab.method,
    url,
    headers,
    body
  };
}
