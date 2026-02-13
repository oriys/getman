/**
 * Layer 5: Collaboration Layer
 * 
 * Handles import/export, documentation generation, and sharing:
 * - Postman Collection v2.1 import/export
 * - OpenAPI 3.0 export
 * - API documentation generation
 * - Collection sharing utilities
 */

import type {
  Collection,
  SavedRequest,
  Environment,
  ExportFormat,
  ImportOptions,
  ExportOptions,
  DocumentationConfig,
  GeneratedDocumentation
} from './capability-types';
import type { CollectionFolder } from './getman-store';

/**
 * Export collection to Postman v2.1 format
 */
export function exportToPostmanV21(
  collection: Collection,
  options: ExportOptions = {}
): string {
  const postmanCollection: any = {
    info: {
      _postman_id: collection.id,
      name: collection.name,
      description: collection.description || '',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: [],
    variable: [],
    event: []
  };
  
  // Add collection variables
  if (options.includeEnvironments && collection.variables) {
    postmanCollection.variable = collection.variables
      .filter(v => v.enabled)
      .map(v => ({
        key: v.key,
        value: v.value,
        type: 'string'
      }));
  }
  
  // Add collection scripts
  if (options.includeScripts) {
    if (collection.preRequestScript?.enabled) {
      postmanCollection.event.push({
        listen: 'prerequest',
        script: {
          type: 'text/javascript',
          exec: collection.preRequestScript.code.split('\n')
        }
      });
    }
    
    if (collection.testScript?.enabled) {
      postmanCollection.event.push({
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: collection.testScript.code.split('\n')
        }
      });
    }
  }
  
  // Convert folders
  function convertFolder(folder: CollectionFolder): any {
    const item: any = {
      name: folder.name,
      description: folder.description || '',
      item: []
    };
    
    // Add folder requests
    folder.requests.forEach(req => {
      item.item.push(convertRequest(req));
    });
    
    // Add subfolders
    folder.folders.forEach(subfolder => {
      item.item.push(convertFolder(subfolder));
    });
    
    return item;
  }
  
  // Convert request to Postman format
  function convertRequest(request: SavedRequest): any {
    const item: any = {
      name: request.name,
      request: {
        method: request.method,
        header: [],
        url: {
          raw: request.url,
          protocol: request.url.startsWith('https') ? 'https' : 'http',
          host: [],
          path: []
        }
      },
      response: []
    };
    
    if (request.description) {
      item.request.description = request.description;
    }
    
    // Add headers
    request.tab.headers
      .filter(h => h.enabled && h.key)
      .forEach(h => {
        item.request.header.push({
          key: h.key,
          value: h.value,
          type: 'text'
        });
      });
    
    // Add query params
    if (request.tab.params.some(p => p.enabled && p.key)) {
      item.request.url.query = request.tab.params
        .filter(p => p.enabled && p.key)
        .map(p => ({
          key: p.key,
          value: p.value
        }));
    }
    
    // Add body
    if (request.tab.bodyType !== 'none') {
      item.request.body = {
        mode: request.tab.bodyType === 'x-www-form-urlencoded' ? 'urlencoded' : request.tab.bodyType,
        raw: request.tab.bodyContent
      };
      
      if (request.tab.bodyType === 'json') {
        item.request.body.options = {
          raw: { language: 'json' }
        };
      }
    }
    
    // Add scripts
    if (options.includeScripts) {
      item.event = [];
      
      if (request.preRequestScript?.enabled) {
        item.event.push({
          listen: 'prerequest',
          script: {
            type: 'text/javascript',
            exec: request.preRequestScript.code.split('\n')
          }
        });
      }
      
      if (request.testScript?.enabled) {
        item.event.push({
          listen: 'test',
          script: {
            type: 'text/javascript',
            exec: request.testScript.code.split('\n')
          }
        });
      }
    }
    
    // Add example responses
    if (options.includeExamples && request.examples) {
      item.response = request.examples.map(ex => ({
        name: ex.name,
        status: `${ex.status}`,
        code: ex.status,
        header: Object.entries(ex.headers).map(([k, v]) => ({
          key: k,
          value: v
        })),
        body: ex.body
      }));
    }
    
    return item;
  }
  
  // Add all folders
  collection.folders.forEach(folder => {
    postmanCollection.item.push(convertFolder(folder));
  });
  
  // Add root-level requests
  collection.requests.forEach(request => {
    postmanCollection.item.push(convertRequest(request));
  });
  
  return options.prettify !== false
    ? JSON.stringify(postmanCollection, null, 2)
    : JSON.stringify(postmanCollection);
}

/**
 * Import from Postman v2.1 format
 */
export function importFromPostmanV21(
  jsonContent: string,
  options: ImportOptions = {}
): { collection: Collection; environments: Environment[] } {
  const postmanCollection = JSON.parse(jsonContent);
  
  const collection: Collection = {
    id: postmanCollection.info._postman_id || crypto.randomUUID(),
    name: postmanCollection.info.name || 'Imported Collection',
    description: postmanCollection.info.description || '',
    version: postmanCollection.info.version,
    folders: [],
    requests: [],
    variables: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  // Import collection variables
  if (postmanCollection.variable) {
    collection.variables = postmanCollection.variable.map((v: any) => ({
      id: crypto.randomUUID(),
      key: v.key,
      value: v.value,
      enabled: true
    }));
  }
  
  // Import collection scripts
  if (postmanCollection.event) {
    postmanCollection.event.forEach((event: any) => {
      if (event.listen === 'prerequest' && event.script?.exec) {
        collection.preRequestScript = {
          id: crypto.randomUUID(),
          type: 'pre-request',
          code: Array.isArray(event.script.exec) 
            ? event.script.exec.join('\n')
            : event.script.exec,
          enabled: true,
          language: 'javascript'
        };
      } else if (event.listen === 'test' && event.script?.exec) {
        collection.testScript = {
          id: crypto.randomUUID(),
          type: 'test',
          code: Array.isArray(event.script.exec)
            ? event.script.exec.join('\n')
            : event.script.exec,
          enabled: true,
          language: 'javascript'
        };
      }
    });
  }
  
  // Convert Postman items
  function convertItem(item: any): CollectionFolder | SavedRequest | null {
    // Check if it's a folder (has items) or a request
    if (item.item && Array.isArray(item.item)) {
      // It's a folder
      const folder: CollectionFolder = {
        id: crypto.randomUUID(),
        name: item.name,
        description: item.description || '',
        requests: [],
        folders: []
      };
      
      item.item.forEach((subItem: any) => {
        const converted = convertItem(subItem);
        if (converted) {
          if ('method' in converted) {
            folder.requests.push(converted as SavedRequest);
          } else {
            folder.folders.push(converted as CollectionFolder);
          }
        }
      });
      
      return folder;
    } else if (item.request) {
      // It's a request
      const url = typeof item.request.url === 'string' 
        ? item.request.url 
        : item.request.url?.raw || '';
      
      const request: SavedRequest = {
        id: crypto.randomUUID(),
        name: item.name,
        description: item.request.description || '',
        method: item.request.method,
        url,
        config: {} as any, // Simplified for now
        createdAt: Date.now(),
        updatedAt: Date.now()
      } as any;
      
      // Build request tab
      const tab: any = {
        id: crypto.randomUUID(),
        name: item.name,
        method: item.request.method,
        url,
        params: [],
        headers: [],
        bodyType: 'none',
        bodyContent: '',
        bodyFormData: [],
        authType: 'none',
        authToken: '',
        authUsername: '',
        authPassword: '',
        authApiKey: '',
        authApiValue: '',
        authApiAddTo: 'header'
      };
      
      // Import headers
      if (item.request.header) {
        tab.headers = item.request.header.map((h: any) => ({
          id: crypto.randomUUID(),
          key: h.key,
          value: h.value,
          enabled: !h.disabled
        }));
      }
      
      // Import query params
      if (item.request.url?.query) {
        tab.params = item.request.url.query.map((q: any) => ({
          id: crypto.randomUUID(),
          key: q.key,
          value: q.value,
          enabled: !q.disabled
        }));
      }
      
      // Import body
      if (item.request.body) {
        const mode = item.request.body.mode;
        if (mode === 'raw') {
          tab.bodyType = item.request.body.options?.raw?.language === 'json' ? 'json' : 'raw';
          tab.bodyContent = item.request.body.raw;
        } else if (mode === 'urlencoded') {
          tab.bodyType = 'x-www-form-urlencoded';
          tab.bodyFormData = (item.request.body.urlencoded || []).map((f: any) => ({
            id: crypto.randomUUID(),
            key: f.key,
            value: f.value,
            enabled: !f.disabled
          }));
        } else if (mode === 'formdata') {
          tab.bodyType = 'form-data';
          tab.bodyFormData = (item.request.body.formdata || []).map((f: any) => ({
            id: crypto.randomUUID(),
            key: f.key,
            value: f.value,
            enabled: !f.disabled
          }));
        }
      }
      
      // Import scripts
      if (item.event) {
        item.event.forEach((event: any) => {
          if (event.listen === 'prerequest' && event.script?.exec) {
            request.preRequestScript = {
              id: crypto.randomUUID(),
              type: 'pre-request',
              code: Array.isArray(event.script.exec)
                ? event.script.exec.join('\n')
                : event.script.exec,
              enabled: true,
              language: 'javascript'
            };
          } else if (event.listen === 'test' && event.script?.exec) {
            request.testScript = {
              id: crypto.randomUUID(),
              type: 'test',
              code: Array.isArray(event.script.exec)
                ? event.script.exec.join('\n')
                : event.script.exec,
              enabled: true,
              language: 'javascript'
            };
          }
        });
      }
      
      request.tab = tab;
      return request;
    }
    
    return null;
  }
  
  // Convert all items
  if (postmanCollection.item) {
    postmanCollection.item.forEach((item: any) => {
      const converted = convertItem(item);
      if (converted) {
        if ('method' in converted) {
          collection.requests.push(converted as SavedRequest);
        } else {
          collection.folders.push(converted as CollectionFolder);
        }
      }
    });
  }
  
  return { collection, environments: [] };
}

/**
 * Generate API documentation from collection
 */
export function generateDocumentation(
  collection: Collection,
  config: DocumentationConfig
): GeneratedDocumentation {
  const html = generateHTMLDocumentation(collection, config);
  const markdown = generateMarkdownDocumentation(collection, config);
  const openapi = generateOpenAPISpec(collection, config);
  
  return { html, markdown, openapi };
}

/**
 * Generate HTML documentation
 */
function generateHTMLDocumentation(
  collection: Collection,
  config: DocumentationConfig
): string {
  let html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
  html += `<title>${config.title}</title>`;
  html += '<style>';
  html += 'body{font-family:Arial,sans-serif;margin:0;padding:20px;line-height:1.6}';
  html += 'h1{color:#333;border-bottom:2px solid #007bff;padding-bottom:10px}';
  html += 'h2{color:#555;margin-top:30px}';
  html += 'h3{color:#777}';
  html += '.request{background:#f9f9f9;padding:15px;border-radius:5px;margin:20px 0}';
  html += '.method{font-weight:bold;padding:5px 10px;border-radius:3px;display:inline-block}';
  html += '.get{background:#61affe;color:white}';
  html += '.post{background:#49cc90;color:white}';
  html += '.put{background:#fca130;color:white}';
  html += '.delete{background:#f93e3e;color:white}';
  html += '.url{margin:10px 0;font-family:monospace;background:#eee;padding:5px;border-radius:3px}';
  html += 'pre{background:#282c34;color:#abb2bf;padding:15px;border-radius:5px;overflow-x:auto}';
  html += '</style>';
  html += '</head><body>';
  
  html += `<h1>${config.title}</h1>`;
  if (config.description) {
    html += `<p>${config.description}</p>`;
  }
  if (config.version) {
    html += `<p><strong>Version:</strong> ${config.version}</p>`;
  }
  if (config.baseUrl) {
    html += `<p><strong>Base URL:</strong> <code>${config.baseUrl}</code></p>`;
  }
  
  // Document folders
  function documentFolder(folder: CollectionFolder, level: number = 2) {
    html += `<h${level}>${folder.name}</h${level}>`;
    if (folder.description) {
      html += `<p>${folder.description}</p>`;
    }
    
    folder.requests.forEach(req => documentRequest(req));
    folder.folders.forEach(subfolder => documentFolder(subfolder, level + 1));
  }
  
  // Document request
  function documentRequest(request: SavedRequest) {
    html += '<div class="request">';
    html += `<h3>${request.name}</h3>`;
    
    if (request.description) {
      html += `<p>${request.description}</p>`;
    }
    
    const methodClass = request.method.toLowerCase();
    html += `<div><span class="method ${methodClass}">${request.method}</span> `;
    html += `<span class="url">${request.url}</span></div>`;
    
    // Headers
    const headers = request.tab.headers.filter(h => h.enabled && h.key);
    if (headers.length > 0) {
      html += '<h4>Headers</h4><ul>';
      headers.forEach(h => {
        html += `<li><code>${h.key}</code>: <code>${h.value}</code></li>`;
      });
      html += '</ul>';
    }
    
    // Query parameters
    const params = request.tab.params.filter(p => p.enabled && p.key);
    if (params.length > 0) {
      html += '<h4>Query Parameters</h4><ul>';
      params.forEach(p => {
        html += `<li><code>${p.key}</code>: <code>${p.value}</code></li>`;
      });
      html += '</ul>';
    }
    
    // Body
    if (request.tab.bodyType !== 'none' && request.tab.bodyContent) {
      html += '<h4>Request Body</h4>';
      html += `<pre>${escapeHtml(request.tab.bodyContent)}</pre>`;
    }
    
    // Examples
    if (config.includeExamples && request.examples && request.examples.length > 0) {
      html += '<h4>Example Responses</h4>';
      request.examples.forEach(ex => {
        html += `<h5>${ex.name} (${ex.status})</h5>`;
        html += `<pre>${escapeHtml(ex.body)}</pre>`;
      });
    }
    
    html += '</div>';
  }
  
  // Document all content
  collection.folders.forEach(folder => documentFolder(folder));
  collection.requests.forEach(req => documentRequest(req));
  
  html += '</body></html>';
  return html;
}

/**
 * Generate Markdown documentation
 */
function generateMarkdownDocumentation(
  collection: Collection,
  config: DocumentationConfig
): string {
  let md = `# ${config.title}\n\n`;
  
  if (config.description) {
    md += `${config.description}\n\n`;
  }
  
  if (config.version) {
    md += `**Version:** ${config.version}\n\n`;
  }
  
  if (config.baseUrl) {
    md += `**Base URL:** \`${config.baseUrl}\`\n\n`;
  }
  
  md += '## Requests\n\n';
  
  // Document folders
  function documentFolder(folder: CollectionFolder, level: number = 3) {
    md += `${'#'.repeat(level)} ${folder.name}\n\n`;
    if (folder.description) {
      md += `${folder.description}\n\n`;
    }
    
    folder.requests.forEach(req => documentRequest(req));
    folder.folders.forEach(subfolder => documentFolder(subfolder, level + 1));
  }
  
  // Document request
  function documentRequest(request: SavedRequest) {
    md += `### ${request.name}\n\n`;
    
    if (request.description) {
      md += `${request.description}\n\n`;
    }
    
    md += `**${request.method}** \`${request.url}\`\n\n`;
    
    // Headers
    const headers = request.tab.headers.filter(h => h.enabled && h.key);
    if (headers.length > 0) {
      md += '**Headers:**\n\n';
      headers.forEach(h => {
        md += `- \`${h.key}\`: \`${h.value}\`\n`;
      });
      md += '\n';
    }
    
    // Query parameters
    const params = request.tab.params.filter(p => p.enabled && p.key);
    if (params.length > 0) {
      md += '**Query Parameters:**\n\n';
      params.forEach(p => {
        md += `- \`${p.key}\`: \`${p.value}\`\n`;
      });
      md += '\n';
    }
    
    // Body
    if (request.tab.bodyType !== 'none' && request.tab.bodyContent) {
      md += '**Request Body:**\n\n';
      md += '```json\n';
      md += request.tab.bodyContent;
      md += '\n```\n\n';
    }
  }
  
  collection.folders.forEach(folder => documentFolder(folder));
  collection.requests.forEach(req => documentRequest(req));
  
  return md;
}

/**
 * Generate OpenAPI 3.0 specification
 */
function generateOpenAPISpec(
  collection: Collection,
  config: DocumentationConfig
): string {
  const spec: any = {
    openapi: '3.0.0',
    info: {
      title: config.title,
      description: config.description || '',
      version: config.version || '1.0.0'
    },
    servers: [],
    paths: {}
  };
  
  if (config.baseUrl) {
    spec.servers.push({ url: config.baseUrl });
  }
  
  // Convert requests to OpenAPI paths
  function addRequest(request: SavedRequest) {
    const url = new URL(request.url.startsWith('http') ? request.url : `http://example.com${request.url}`);
    const path = url.pathname;
    
    if (!spec.paths[path]) {
      spec.paths[path] = {};
    }
    
    const operation: any = {
      summary: request.name,
      description: request.description || '',
      parameters: [],
      responses: {}
    };
    
    // Add query parameters
    request.tab.params
      .filter(p => p.enabled && p.key)
      .forEach(p => {
        operation.parameters.push({
          name: p.key,
          in: 'query',
          schema: { type: 'string' },
          example: p.value
        });
      });
    
    // Add headers
    request.tab.headers
      .filter(h => h.enabled && h.key)
      .forEach(h => {
        operation.parameters.push({
          name: h.key,
          in: 'header',
          schema: { type: 'string' },
          example: h.value
        });
      });
    
    // Add request body
    if (request.tab.bodyType !== 'none' && request.tab.bodyContent) {
      operation.requestBody = {
        content: {
          'application/json': {
            schema: { type: 'object' },
            example: request.tab.bodyType === 'json' 
              ? JSON.parse(request.tab.bodyContent)
              : request.tab.bodyContent
          }
        }
      };
    }
    
    // Add example responses
    if (request.examples && request.examples.length > 0) {
      request.examples.forEach(ex => {
        operation.responses[ex.status] = {
          description: ex.name,
          content: {
            'application/json': {
              example: JSON.parse(ex.body)
            }
          }
        };
      });
    } else {
      operation.responses['200'] = {
        description: 'Successful response'
      };
    }
    
    spec.paths[path][request.method.toLowerCase()] = operation;
  }
  
  // Add all requests
  function processFolder(folder: CollectionFolder) {
    folder.requests.forEach(req => addRequest(req));
    folder.folders.forEach(subfolder => processFolder(subfolder));
  }
  
  collection.folders.forEach(folder => processFolder(folder));
  collection.requests.forEach(req => addRequest(req));
  
  return JSON.stringify(spec, null, 2);
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
