/**
 * Core Capability Types for Getman
 * 
 * This file defines TypeScript types for the 5 atomic capability layers:
 * 1. Request Construction Engine
 * 2. Response Inspector
 * 3. Test & Script Engine
 * 4. Collection System
 * 5. Collaboration Layer
 */

// ============================================================================
// 1️⃣ REQUEST CONSTRUCTION ENGINE
// ============================================================================

/**
 * Supported protocols
 */
export type Protocol = 
  | 'http'
  | 'https'
  | 'graphql'
  | 'grpc'
  | 'websocket'
  | 'sse';

/**
 * HTTP methods
 */
export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | 'CONNECT'
  | 'TRACE';

/**
 * Request body types
 */
export type BodyType =
  | 'none'
  | 'json'
  | 'xml'
  | 'form-data'        // multipart/form-data
  | 'x-www-form-urlencoded'
  | 'raw'
  | 'binary'
  | 'graphql'
  | 'grpc';

/**
 * Authentication types
 */
export type AuthType =
  | 'none'
  | 'bearer'           // Bearer Token
  | 'basic'            // Basic Auth
  | 'api-key'          // API Key (header or query)
  | 'oauth2'           // OAuth 2.0
  | 'digest'           // Digest Auth
  | 'hawk'             // Hawk Authentication
  | 'aws-signature';   // AWS Signature

/**
 * OAuth2 grant types
 */
export type OAuth2GrantType =
  | 'authorization_code'
  | 'client_credentials'
  | 'password'
  | 'implicit';

/**
 * Key-value pair with enable toggle
 */
export interface KeyValuePair {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

/**
 * File for upload
 */
export interface FileUpload {
  id: string;
  key: string;
  file: File;
  enabled: boolean;
}

/**
 * Request configuration for HTTP/HTTPS
 */
export interface HttpRequestConfig {
  protocol: 'http' | 'https';
  method: HttpMethod;
  url: string;
  pathParams: KeyValuePair[];
  queryParams: KeyValuePair[];
  headers: KeyValuePair[];
  cookies: KeyValuePair[];
  
  // Body
  bodyType: BodyType;
  bodyContent: string;
  bodyFormData: KeyValuePair[];
  bodyFiles: FileUpload[];
  
  // Authentication
  auth: AuthConfig;
  
  // Advanced settings
  followRedirects: boolean;
  maxRedirects: number;
  timeout: number;            // milliseconds
  validateSSL: boolean;
  proxy?: ProxyConfig;
  clientCertificate?: ClientCertificateConfig;
}

/**
 * GraphQL request configuration
 */
export interface GraphQLRequestConfig {
  protocol: 'graphql';
  url: string;
  query: string;
  variables: Record<string, unknown>;
  operationName?: string;
  headers: KeyValuePair[];
  auth: AuthConfig;
}

/**
 * WebSocket request configuration
 */
export interface WebSocketRequestConfig {
  protocol: 'websocket';
  url: string;
  headers: KeyValuePair[];
  messages: WebSocketMessage[];
}

export interface WebSocketMessage {
  id: string;
  type: 'text' | 'binary';
  content: string;
  timestamp?: number;
  direction: 'send' | 'receive';
}

/**
 * Authentication configuration
 */
export interface AuthConfig {
  type: AuthType;
  
  // Bearer token
  bearerToken?: string;
  
  // Basic auth
  basicUsername?: string;
  basicPassword?: string;
  
  // API Key
  apiKeyKey?: string;
  apiKeyValue?: string;
  apiKeyAddTo?: 'header' | 'query';
  
  // OAuth2
  oauth2?: OAuth2Config;
  
  // Digest
  digestUsername?: string;
  digestPassword?: string;
  
  // AWS Signature
  awsAccessKey?: string;
  awsSecretKey?: string;
  awsRegion?: string;
  awsService?: string;
}

export interface OAuth2Config {
  grantType: OAuth2GrantType;
  authUrl?: string;
  accessTokenUrl?: string;
  clientId: string;
  clientSecret?: string;
  scope?: string;
  state?: string;
  redirectUrl?: string;
  username?: string;
  password?: string;
}

/**
 * Proxy configuration
 */
export interface ProxyConfig {
  enabled: boolean;
  protocol: 'http' | 'https' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
  bypassHosts?: string[];
}

/**
 * Client certificate configuration
 */
export interface ClientCertificateConfig {
  certFile: string;
  keyFile: string;
  passphrase?: string;
}

/**
 * Dynamic variables
 */
export type DynamicVariable =
  | '{{$guid}}'           // UUID v4
  | '{{$timestamp}}'      // Unix timestamp
  | '{{$isoTimestamp}}'   // ISO 8601 timestamp
  | '{{$randomInt}}'      // Random integer
  | '{{$randomAlpha}}'    // Random alphabetic string
  | '{{$randomEmail}}'    // Random email
  | '{{$randomIP}}'       // Random IP address
  | '{{$randomUUID}}';    // Random UUID

// ============================================================================
// 2️⃣ RESPONSE INSPECTOR
// ============================================================================

/**
 * Response data
 */
export interface ResponseData {
  // Status
  status: number;
  statusText: string;
  
  // Headers
  headers: Record<string, string>;
  
  // Body
  body: string;
  bodyBytes?: Uint8Array;
  contentType: string;
  
  // Metadata
  time: number;               // Response time in ms
  size: number;               // Response size in bytes
  protocol?: string;          // HTTP version (HTTP/1.1, HTTP/2, etc.)
  
  // Additional info
  cookies?: ResponseCookie[];
  redirectChain?: RedirectInfo[];
}

export interface ResponseCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface RedirectInfo {
  url: string;
  status: number;
  statusText: string;
}

/**
 * Response view modes
 */
export type ResponseViewMode =
  | 'pretty'      // Formatted JSON/XML with syntax highlighting
  | 'raw'         // Raw text
  | 'preview'     // HTML/image preview
  | 'headers'     // Headers view
  | 'cookies';    // Cookies view

/**
 * Response format detection
 */
export type ResponseFormat =
  | 'json'
  | 'xml'
  | 'html'
  | 'text'
  | 'javascript'
  | 'css'
  | 'image'
  | 'pdf'
  | 'binary';

// ============================================================================
// 3️⃣ TEST & SCRIPT ENGINE
// ============================================================================

/**
 * Script types
 */
export type ScriptType = 'pre-request' | 'test';

/**
 * Script configuration
 */
export interface Script {
  id: string;
  type: ScriptType;
  name: string;
  code: string;
  enabled: boolean;
  language: 'javascript' | 'typescript';
}

/**
 * Test assertion types
 */
export type AssertionType =
  | 'status'              // Status code check
  | 'header'              // Header check
  | 'body-equals'         // Body exact match
  | 'body-contains'       // Body contains string
  | 'body-matches'        // Body matches regex
  | 'json-path'           // JSONPath query
  | 'json-schema'         // JSON schema validation
  | 'response-time'       // Response time check
  | 'custom';             // Custom JavaScript

/**
 * Test assertion
 */
export interface TestAssertion {
  id: string;
  type: AssertionType;
  name: string;
  enabled: boolean;
  
  // For different assertion types
  expectedStatus?: number;
  headerKey?: string;
  headerValue?: string;
  bodyValue?: string;
  jsonPath?: string;
  jsonSchema?: object;
  maxResponseTime?: number;
  customCode?: string;
}

/**
 * Test result
 */
export interface TestResult {
  id: string;
  assertionId: string;
  name: string;
  passed: boolean;
  message: string;
  actualValue?: unknown;
  expectedValue?: unknown;
  duration?: number;
}

/**
 * Test execution summary
 */
export interface TestExecutionSummary {
  requestId: string;
  requestName: string;
  timestamp: number;
  duration: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  results: TestResult[];
}

/**
 * Pre-request script execution result
 */
export interface PreRequestScriptResult {
  success: boolean;
  error?: string;
  modifiedRequest?: Partial<HttpRequestConfig>;
  extractedVariables?: Record<string, string>;
}

/**
 * Test script execution result
 */
export interface TestScriptResult {
  success: boolean;
  error?: string;
  tests: TestResult[];
  extractedVariables?: Record<string, string>;
}

/**
 * Script API context (pm object)
 */
export interface ScriptContext {
  environment: {
    get: (key: string) => string | undefined;
    set: (key: string, value: string) => void;
    unset: (key: string) => void;
  };
  variables: {
    get: (key: string) => string | undefined;
    set: (key: string, value: string) => void;
  };
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
  };
  response?: {
    code: number;
    status: string;
    headers: Record<string, string>;
    body: string;
    json: () => unknown;
    text: () => string;
    responseTime: number;
  };
  test: (name: string, fn: () => void | Promise<void>) => void;
  expect: (value: unknown) => ChaiAssertion;
}

/**
 * Simplified Chai assertion interface
 */
export interface ChaiAssertion {
  to: {
    equal: (expected: unknown) => void;
    be: {
      a: (type: string) => void;
      an: (type: string) => void;
      true: boolean;
      false: boolean;
      null: boolean;
      undefined: boolean;
    };
    have: {
      property: (key: string, value?: unknown) => void;
      length: (length: number) => void;
      status: (code: number) => void;
      header: (key: string, value?: string) => void;
      jsonBody: (path: string, value?: unknown) => void;
    };
    include: (value: unknown) => void;
    match: (pattern: RegExp) => void;
  };
  not: ChaiAssertion;
}

// ============================================================================
// 4️⃣ COLLECTION SYSTEM
// ============================================================================

/**
 * Collection folder (for organizing requests)
 */
export interface CollectionFolder {
  id: string;
  name: string;
  description?: string;
  requests: SavedRequest[];
  folders: CollectionFolder[];
  
  // Scripts that run for all requests in folder
  preRequestScript?: Script;
  testScript?: Script;
  
  // Variables specific to this folder
  variables?: KeyValuePair[];
}

/**
 * Collection
 */
export interface Collection {
  id: string;
  name: string;
  description?: string;
  version?: string;
  
  // Root folders and requests
  folders: CollectionFolder[];
  requests: SavedRequest[];
  
  // Collection-level scripts
  preRequestScript?: Script;
  testScript?: Script;
  
  // Collection-level variables
  variables: KeyValuePair[];
  
  // Metadata
  createdAt: number;
  updatedAt: number;
  author?: string;
  tags?: string[];
}

/**
 * Saved request
 */
export interface SavedRequest {
  id: string;
  name: string;
  description?: string;
  
  // Request configuration (can be any protocol)
  method: HttpMethod;
  url: string;
  config: HttpRequestConfig | GraphQLRequestConfig | WebSocketRequestConfig;
  
  // Scripts
  preRequestScript?: Script;
  testScript?: Script;
  
  // Metadata
  createdAt?: number;
  updatedAt?: number;
  
  // Example responses
  examples?: ResponseExample[];
}

export interface ResponseExample {
  id: string;
  name: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  createdAt: number;
}

/**
 * Environment
 */
export interface Environment {
  id: string;
  name: string;
  variables: KeyValuePair[];
  
  // Metadata
  createdAt?: number;
  updatedAt?: number;
  
  // For cloud sync
  isRemote?: boolean;
  syncedAt?: number;
}

/**
 * Variable scopes and resolution
 */
export type VariableScope = 'global' | 'environment' | 'collection' | 'local';

export interface VariableResolution {
  key: string;
  value: string;
  scope: VariableScope;
  source: string;  // Name of environment/collection
}

/**
 * Data file for data-driven testing
 */
export interface DataFile {
  id: string;
  name: string;
  type: 'csv' | 'json';
  content: string;
  rows: Record<string, string>[];
}

/**
 * Collection runner configuration
 */
export interface RunnerConfig {
  collectionId: string;
  environmentId?: string;
  dataFile?: DataFile;
  
  // Execution options
  iterations?: number;
  delay?: number;              // Delay between requests in ms
  stopOnFailure?: boolean;
  
  // Request selection
  folderPath?: string[];       // Run specific folder
  requestIds?: string[];       // Run specific requests
  
  // Output options
  verbose?: boolean;
  saveResponses?: boolean;
}

/**
 * Collection run result
 */
export interface CollectionRunResult {
  runId: string;
  collectionId: string;
  collectionName: string;
  startTime: number;
  endTime: number;
  duration: number;
  
  // Statistics
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  
  // Detailed results
  iterations: IterationResult[];
}

export interface IterationResult {
  iteration: number;
  results: RequestExecutionResult[];
}

export interface RequestExecutionResult {
  requestId: string;
  requestName: string;
  timestamp: number;
  duration: number;
  
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  
  response: ResponseData;
  
  preRequestScriptResult?: PreRequestScriptResult;
  testScriptResult?: TestScriptResult;
  
  error?: string;
}

// ============================================================================
// 5️⃣ COLLABORATION LAYER
// ============================================================================

/**
 * API documentation configuration
 */
export interface DocumentationConfig {
  title: string;
  description?: string;
  version?: string;
  baseUrl?: string;
  collections: string[];       // Collection IDs to include
  
  // Styling
  theme?: 'light' | 'dark' | 'auto';
  logo?: string;
  primaryColor?: string;
  
  // Content
  includeExamples?: boolean;
  includeSchemas?: boolean;
  showInternalRequests?: boolean;
}

/**
 * Generated documentation
 */
export interface GeneratedDocumentation {
  html: string;
  markdown?: string;
  openapi?: string;            // OpenAPI 3.0 spec
}

/**
 * Mock server configuration
 */
export interface MockServerConfig {
  id: string;
  name: string;
  port: number;
  enabled: boolean;
  
  // Mock endpoints
  endpoints: MockEndpoint[];
  
  // Global settings
  defaultDelay?: number;
  cors?: boolean;
}

export interface MockEndpoint {
  id: string;
  method: HttpMethod;
  path: string;
  
  // Response
  status: number;
  headers: Record<string, string>;
  body: string;
  
  // Behavior
  delay?: number;
  probability?: number;        // Random failure simulation
}

/**
 * Sharing configuration
 */
export interface SharingConfig {
  type: 'public' | 'team' | 'private';
  url?: string;
  password?: string;
  expiresAt?: number;
  allowedUsers?: string[];
}

/**
 * Team workspace
 */
export interface TeamWorkspace {
  id: string;
  name: string;
  description?: string;
  
  // Members
  members: WorkspaceMember[];
  
  // Content
  collections: Collection[];
  environments: Environment[];
  
  // Settings
  settings: WorkspaceSettings;
}

export interface WorkspaceMember {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  joinedAt: number;
}

export interface WorkspaceSettings {
  allowPublicSharing: boolean;
  requireApproval: boolean;
  enableVersionControl: boolean;
}

/**
 * Version history
 */
export interface VersionHistoryEntry {
  id: string;
  collectionId: string;
  version: string;
  timestamp: number;
  author: string;
  message: string;
  
  // Changes
  changes: ChangeRecord[];
}

export interface ChangeRecord {
  type: 'add' | 'modify' | 'delete';
  path: string;                // JSON path to changed item
  before?: unknown;
  after?: unknown;
}

/**
 * Export formats
 */
export type ExportFormat =
  | 'postman-v2.1'              // Postman Collection v2.1
  | 'openapi-3.0'               // OpenAPI 3.0
  | 'getman-v1'                 // Getman native format
  | 'har'                       // HTTP Archive format
  | 'curl';                     // cURL commands

/**
 * Import/Export options
 */
export interface ImportOptions {
  format: ExportFormat;
  mergeStrategy?: 'replace' | 'merge' | 'skip';
  importEnvironments?: boolean;
}

export interface ExportOptions {
  format: ExportFormat;
  includeEnvironments?: boolean;
  includeScripts?: boolean;
  includeExamples?: boolean;
  prettify?: boolean;
}

// ============================================================================
// CROSS-CUTTING CONCERNS
// ============================================================================

/**
 * Error types
 */
export interface RequestError {
  type: 'network' | 'timeout' | 'ssl' | 'dns' | 'parse' | 'script' | 'validation';
  message: string;
  details?: string;
  code?: string;
}

/**
 * Execution context (combines all runtime information)
 */
export interface ExecutionContext {
  // Variables from all scopes
  variables: Map<string, VariableResolution>;
  
  // Current environment
  environment?: Environment;
  
  // Current collection (if running as part of collection)
  collection?: Collection;
  
  // Iteration data (for data-driven tests)
  iterationData?: Record<string, string>;
  
  // Execution metadata
  startTime: number;
  requestCount: number;
}

/**
 * Plugin interface (for future extensibility)
 */
export interface Plugin {
  id: string;
  name: string;
  version: string;
  
  // Hooks
  onBeforeRequest?: (config: HttpRequestConfig) => Promise<HttpRequestConfig>;
  onAfterResponse?: (response: ResponseData) => Promise<ResponseData>;
  onTestComplete?: (result: TestExecutionSummary) => Promise<void>;
}
