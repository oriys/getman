'use client';

import { useSyncExternalStore } from "react";
import { loadPersistedState, savePersistedState } from "./tauri";

// ─── Types ────────────────────────────────────────────────────────────────────

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type RequestType = "http" | "grpc" | "graphql" | "websocket";

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

// ─── Test Assertions ──────────────────────────────────────────────────────────

export type AssertionType = "status" | "header" | "jsonpath" | "body-contains";

export interface TestAssertion {
  id: string;
  enabled: boolean;
  type: AssertionType;
  property: string;     // header name, jsonpath expression, etc.
  comparison: "eq" | "neq" | "contains" | "gt" | "lt" | "exists" | "matches";
  expected: string;
}

export interface AssertionResult {
  assertionId: string;
  passed: boolean;
  actual: string;
  message: string;
}

// ─── Request Settings ─────────────────────────────────────────────────────────

export interface RequestSettings {
  timeoutMs: number;
  retryCount: number;
  retryDelayMs: number;
  proxyUrl: string;
  verifySsl: boolean;
}

// ─── Collection Folders ───────────────────────────────────────────────────────

export interface CollectionFolder {
  id: string;
  name: string;
  folders: CollectionFolder[];
  requests: SavedRequest[];
}

// ─── OAuth2 ───────────────────────────────────────────────────────────────────

export type OAuth2GrantType = "authorization_code" | "client_credentials";

// ─── gRPC Proto Types ─────────────────────────────────────────────────────────

export interface ProtoFieldInfo {
  name: string;
  number: number;
  typeName: string;
  isRepeated: boolean;
}

export interface ProtoMethodInfo {
  name: string;
  fullName: string;
  inputType: string;
  outputType: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
  inputFields: ProtoFieldInfo[];
}

export interface ProtoServiceInfo {
  name: string;
  fullName: string;
  methods: ProtoMethodInfo[];
}

export interface RequestTab {
  id: string;
  name: string;
  requestType: RequestType;
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  bodyType: "none" | "json" | "form-data" | "x-www-form-urlencoded" | "raw" | "graphql" | "binary";
  bodyContent: string;
  bodyFormData: KeyValue[];
  graphqlQuery: string;
  graphqlVariables: string;
  cookies: KeyValue[];
  authType:
    | "none"
    | "bearer"
    | "basic"
    | "api-key"
    | "oauth2"
    | "digest"
    | "ntlm"
    | "awsv4"
    | "wsse";
  authToken: string;
  authUsername: string;
  authPassword: string;
  authApiKey: string;
  authApiValue: string;
  authApiAddTo: "header" | "query";
  // OAuth2 fields
  oauth2GrantType: OAuth2GrantType;
  oauth2AuthUrl: string;
  oauth2TokenUrl: string;
  oauth2ClientId: string;
  oauth2ClientSecret: string;
  oauth2Scope: string;
  oauth2CallbackUrl: string;
  oauth2AccessToken: string;
  // NTLM fields
  ntlmDomain: string;
  // AWS SigV4 fields
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsSessionToken: string;
  awsRegion: string;
  awsService: string;
  // WSSE fields
  wsseUsername: string;
  wssePassword: string;
  // Request settings
  settings: RequestSettings;
  // Test assertions
  assertions: TestAssertion[];
  // Scripts
  preRequestScript: string;
  testScript: string;
  // Flow orchestrator fields
  flowDependsOn: string;
  flowCondition: string;
  // gRPC fields
  grpcProtoContent: string;
  grpcServiceName: string;
  grpcMethodName: string;
  grpcRequestBody: string;
  grpcMetadata: KeyValue[];
  grpcServices: ProtoServiceInfo[];
  grpcDescriptorBytes: string;
  // WebSocket fields
  wsProtocols: string;
  wsMessage: string;
}

export interface ResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  time: number;
  size: number;
  contentType: string;
}

export interface GrpcResponseData {
  statusCode: number;
  statusMessage: string;
  responseJson: string;
  responseMetadata: Record<string, string>;
  time: number;
  size: number;
}

export interface HistoryItem {
  id: string;
  method: HttpMethod;
  url: string;
  status: number;
  time: number;
  timestamp: number;
  requestType?: RequestType;
}

export interface Collection {
  id: string;
  name: string;
  requests: SavedRequest[];
  folders: CollectionFolder[];
}

export interface SavedRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  tab: RequestTab;
}

export interface EnvVariable {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface Environment {
  id: string;
  name: string;
  variables: EnvVariable[];
}

export interface VaultSecret {
  id: string;
  key: string;
  value: string;
  expiresAt: number;
}

// ─── Cookie Jar ───────────────────────────────────────────────────────────────
export interface CookieEntry {
  id: string;
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

// ─── Header/Param Presets ─────────────────────────────────────────────────────
export interface Preset {
  id: string;
  name: string;
  headers: KeyValue[];
  params: KeyValue[];
}

// ─── History Filter ───────────────────────────────────────────────────────────
export interface HistoryFilter {
  method: HttpMethod | "ALL";
  statusMin: number;
  statusMax: number;
  search: string;
  dateFrom: string;
  dateTo: string;
}

// ─── Workspace ────────────────────────────────────────────────────────────────
export interface Workspace {
  id: string;
  name: string;
  collections: Collection[];
  environments: Environment[];
  activeEnvironmentId: string | null;
}

// ─── Templates ────────────────────────────────────────────────────────────────
export interface RequestTemplate {
  id: string;
  name: string;
  description: string;
  tab: Partial<RequestTab>;
}

export interface AssertionTemplate {
  id: string;
  name: string;
  description: string;
  assertions: TestAssertion[];
}

// ─── Plugin ───────────────────────────────────────────────────────────────────
export type PluginHookType = "pre-request" | "post-response" | "on-error";

export interface Plugin {
  id: string;
  name: string;
  enabled: boolean;
  hookType: PluginHookType;
  script: string;
}

// ─── Response Snapshot for Diff ───────────────────────────────────────────────
export interface ResponseSnapshot {
  id: string;
  label: string;
  timestamp: number;
  response: ResponseData;
  method: HttpMethod;
  url: string;
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
export type WsMessageDirection = "sent" | "received";

export interface WsMessage {
  id: string;
  direction: WsMessageDirection;
  data: string;
  timestamp: number;
}

export interface WsConnection {
  id: string;
  url: string;
  status: "connecting" | "connected" | "disconnected" | "error";
  messages: WsMessage[];
  protocols: string;
}

// ─── SSE ──────────────────────────────────────────────────────────────────────
export interface SseEvent {
  id: string;
  eventType: string;
  data: string;
  lastEventId: string;
  timestamp: number;
}

export interface SseConnection {
  id: string;
  url: string;
  status: "connecting" | "connected" | "disconnected" | "error";
  events: SseEvent[];
  headers: KeyValue[];
}

// ─── Mock Server ──────────────────────────────────────────────────────────────
export interface MockRoute {
  id: string;
  method: HttpMethod;
  path: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  delay: number;
}

export interface MockServer {
  id: string;
  name: string;
  port: number;
  routes: MockRoute[];
  running: boolean;
}

export interface GetmanState {
  tabs: RequestTab[];
  activeTabId: string;
  response: ResponseData | null;
  grpcResponse: GrpcResponseData | null;
  isLoading: boolean;
  activeRequestId: string | null;
  history: HistoryItem[];
  collections: Collection[];
  environments: Environment[];
  activeEnvironmentId: string | null;
  globalVariables: EnvVariable[];
  vaultSecrets: VaultSecret[];
  sidebarView: "requests" | "collections" | "history" | "environments" | "websocket" | "sse" | "cookies" | "plugins";
  sidebarOpen: boolean;
  assertionResults: AssertionResult[];
  cookieJar: CookieEntry[];
  presets: Preset[];
  historyFilter: HistoryFilter;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  requestTemplates: RequestTemplate[];
  assertionTemplates: AssertionTemplate[];
  plugins: Plugin[];
  responseSnapshots: ResponseSnapshot[];
  wsConnections: WsConnection[];
  sseConnections: SseConnection[];
  mockServers: MockServer[];
  commandPaletteOpen: boolean;
  previousResponse: ResponseData | null;
}

interface PersistedState {
  version: number;
  tabs: RequestTab[];
  activeTabId: string;
  history: HistoryItem[];
  collections: Collection[];
  environments: Environment[];
  activeEnvironmentId: string | null;
  globalVariables: EnvVariable[];
  sidebarView: GetmanState["sidebarView"];
  sidebarOpen: boolean;
  cookieJar: CookieEntry[];
  presets: Preset[];
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  requestTemplates: RequestTemplate[];
  assertionTemplates: AssertionTemplate[];
  plugins: Plugin[];
  responseSnapshots: ResponseSnapshot[];
  mockServers: MockServer[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let globalId = 0;
export function uid(): string {
  globalId++;
  return `${Date.now()}-${globalId}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createEmptyKV(): KeyValue {
  return { id: uid(), key: "", value: "", enabled: true };
}

export function defaultSettings(): RequestSettings {
  return {
    timeoutMs: 0,
    retryCount: 0,
    retryDelayMs: 1000,
    proxyUrl: "",
    verifySsl: true,
  };
}

// ─── URL ↔ Params Sync ───────────────────────────────────────────────────────

/**
 * Extract query parameters from a URL string and return as KeyValue[].
 * Always appends an empty KV row at the end for user input.
 */
export function extractParamsFromUrl(url: string): KeyValue[] {
  const params: KeyValue[] = [];
  try {
    const qIdx = url.indexOf("?");
    if (qIdx === -1) return [createEmptyKV()];
    const queryString = url.slice(qIdx + 1);
    const searchParams = new URLSearchParams(queryString);
    searchParams.forEach((value, key) => {
      params.push({ id: uid(), key, value, enabled: true });
    });
  } catch {
    // If URL parsing fails, return current empty state
  }
  if (params.length === 0) return [createEmptyKV()];
  params.push(createEmptyKV());
  return params;
}

/**
 * Build a URL string by replacing the query portion with params from the table.
 * Preserves the base URL (everything before '?').
 */
export function buildUrlFromParams(currentUrl: string, params: KeyValue[]): string {
  const qIdx = currentUrl.indexOf("?");
  const baseUrl = qIdx === -1 ? currentUrl : currentUrl.slice(0, qIdx);

  const enabledParams = params.filter((p) => p.enabled && p.key);
  if (enabledParams.length === 0) return baseUrl;

  const searchParams = new URLSearchParams();
  for (const p of enabledParams) {
    searchParams.append(p.key, p.value);
  }
  return `${baseUrl}?${searchParams.toString()}`;
}

/**
 * Update the active tab URL when params change, and sync params → URL.
 */
export function updateActiveTabParams(params: KeyValue[]) {
  const tab = getActiveTab();
  if (!tab) return;
  const newUrl = buildUrlFromParams(tab.url, params);
  const tabs = state.tabs.map((t) =>
    t.id === state.activeTabId ? { ...t, params, url: newUrl } : t
  );
  setState({ tabs });
}

/**
 * Update the active tab URL and sync URL → params.
 */
export function updateActiveTabUrl(url: string) {
  const tab = getActiveTab();
  if (!tab) return;
  const newParams = extractParamsFromUrl(url);
  const tabs = state.tabs.map((t) =>
    t.id === state.activeTabId ? { ...t, url, params: newParams } : t
  );
  setState({ tabs });
}

export function createDefaultTab(): RequestTab {
  return {
    id: uid(),
    name: "New Request",
    requestType: "http",
    method: "GET",
    url: "",
    params: [createEmptyKV()],
    headers: [createEmptyKV()],
    bodyType: "none",
    bodyContent: "",
    bodyFormData: [createEmptyKV()],
    graphqlQuery: "",
    graphqlVariables: "{}",
    cookies: [createEmptyKV()],
    authType: "none",
    authToken: "",
    authUsername: "",
    authPassword: "",
    authApiKey: "",
    authApiValue: "",
    authApiAddTo: "header",
    oauth2GrantType: "authorization_code",
    oauth2AuthUrl: "",
    oauth2TokenUrl: "",
    oauth2ClientId: "",
    oauth2ClientSecret: "",
    oauth2Scope: "",
    oauth2CallbackUrl: "http://localhost/callback",
    oauth2AccessToken: "",
    ntlmDomain: "",
    awsAccessKeyId: "",
    awsSecretAccessKey: "",
    awsSessionToken: "",
    awsRegion: "us-east-1",
    awsService: "execute-api",
    wsseUsername: "",
    wssePassword: "",
    settings: defaultSettings(),
    assertions: [],
    preRequestScript: "",
    testScript: "",
    flowDependsOn: "",
    flowCondition: "",
    grpcProtoContent: "",
    grpcServiceName: "",
    grpcMethodName: "",
    grpcRequestBody: "{}",
    grpcMetadata: [createEmptyKV()],
    grpcServices: [],
    grpcDescriptorBytes: "",
    wsProtocols: "",
    wsMessage: "",
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

type Listener = () => void;

const PERSISTED_STATE_VERSION = 1;
const MAX_RESPONSE_SNAPSHOTS = 50;
const MAX_WS_MESSAGES = 500;
const MAX_SSE_EVENTS = 500;

function createInitialState(): GetmanState {
  const defaultTab = createDefaultTab();
  return {
    tabs: [defaultTab],
    activeTabId: defaultTab.id,
    response: null,
    grpcResponse: null,
    isLoading: false,
    activeRequestId: null,
    history: [],
    collections: [],
    environments: [],
    activeEnvironmentId: null,
    globalVariables: [],
    vaultSecrets: [],
    sidebarView: "requests",
    sidebarOpen: true,
    assertionResults: [],
    cookieJar: [],
    presets: [],
    historyFilter: { method: "ALL", statusMin: 0, statusMax: 999, search: "", dateFrom: "", dateTo: "" },
    workspaces: [],
    activeWorkspaceId: null,
    requestTemplates: [],
    assertionTemplates: [],
    plugins: [],
    responseSnapshots: [],
    wsConnections: [],
    sseConnections: [],
    mockServers: [],
    commandPaletteOpen: false,
    previousResponse: null,
  };
}

function normalizeState(data: unknown): Partial<GetmanState> | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const parsed = data as Partial<PersistedState>;
  const tabs =
    Array.isArray(parsed.tabs) && parsed.tabs.length > 0
      ? parsed.tabs
      : [createDefaultTab()];

  const activeTabId =
    typeof parsed.activeTabId === "string" &&
    tabs.some((tab) => tab.id === parsed.activeTabId)
      ? parsed.activeTabId
      : tabs[0].id;

  const sidebarView =
    parsed.sidebarView === "requests" ||
    parsed.sidebarView === "collections" ||
    parsed.sidebarView === "history" ||
    parsed.sidebarView === "environments" ||
    parsed.sidebarView === "websocket" ||
    parsed.sidebarView === "sse" ||
    parsed.sidebarView === "cookies" ||
    parsed.sidebarView === "plugins"
      ? parsed.sidebarView
      : "requests";

  return {
    tabs,
    activeTabId,
    history: Array.isArray(parsed.history) ? parsed.history.slice(0, 100) : [],
    collections: Array.isArray(parsed.collections)
      ? parsed.collections.map((c: Collection) => ({
          ...c,
          folders: Array.isArray(c.folders) ? c.folders : [],
        }))
      : [],
    environments: Array.isArray(parsed.environments) ? parsed.environments : [],
    activeEnvironmentId:
      typeof parsed.activeEnvironmentId === "string" ? parsed.activeEnvironmentId : null,
    globalVariables: Array.isArray((parsed as Partial<GetmanState>).globalVariables)
      ? (parsed as Partial<GetmanState>).globalVariables ?? []
      : [],
    vaultSecrets: [],
    sidebarView,
    sidebarOpen: typeof parsed.sidebarOpen === "boolean" ? parsed.sidebarOpen : true,
    response: null,
    grpcResponse: null,
    isLoading: false,
    activeRequestId: null,
    assertionResults: [],
    cookieJar: Array.isArray(parsed.cookieJar) ? parsed.cookieJar : [],
    presets: Array.isArray(parsed.presets) ? parsed.presets : [],
    historyFilter: { method: "ALL", statusMin: 0, statusMax: 999, search: "", dateFrom: "", dateTo: "" },
    workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
    activeWorkspaceId:
      typeof parsed.activeWorkspaceId === "string" &&
      Array.isArray(parsed.workspaces) &&
      parsed.workspaces.some((w: Workspace) => w.id === parsed.activeWorkspaceId)
        ? parsed.activeWorkspaceId
        : null,
    requestTemplates: Array.isArray(parsed.requestTemplates) ? parsed.requestTemplates : [],
    assertionTemplates: Array.isArray(parsed.assertionTemplates) ? parsed.assertionTemplates : [],
    plugins: Array.isArray(parsed.plugins) ? parsed.plugins : [],
    responseSnapshots: Array.isArray(parsed.responseSnapshots) ? parsed.responseSnapshots : [],
    wsConnections: [],
    sseConnections: [],
    mockServers: Array.isArray(parsed.mockServers) ? parsed.mockServers : [],
    commandPaletteOpen: false,
    previousResponse: null,
  };
}

function serializeState(current: GetmanState): string {
  const payload: PersistedState = {
    version: PERSISTED_STATE_VERSION,
    tabs: current.tabs,
    activeTabId: current.activeTabId,
    history: current.history,
    collections: current.collections,
    environments: current.environments,
    activeEnvironmentId: current.activeEnvironmentId,
    globalVariables: current.globalVariables,
    sidebarView: current.sidebarView,
    sidebarOpen: current.sidebarOpen,
    cookieJar: current.cookieJar,
    presets: current.presets,
    workspaces: current.workspaces,
    activeWorkspaceId: current.activeWorkspaceId,
    requestTemplates: current.requestTemplates,
    assertionTemplates: current.assertionTemplates,
    plugins: current.plugins,
    responseSnapshots: current.responseSnapshots,
    mockServers: current.mockServers,
  };

  return JSON.stringify(payload);
}

let state: GetmanState = createInitialState();
let hydrateStarted = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

function schedulePersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(() => {
    void savePersistedState(serializeState(state));
  }, 180);
}

function setState(partial: Partial<GetmanState>, options?: { persist?: boolean }) {
  state = { ...state, ...partial };
  emit();

  if (options?.persist !== false) {
    schedulePersist();
  }
}

export async function hydrateStore(): Promise<void> {
  if (hydrateStarted) {
    return;
  }

  hydrateStarted = true;
  try {
    const raw = await loadPersistedState();
    if (!raw) {
      return;
    }

    const restored = normalizeState(JSON.parse(raw));
    if (!restored) {
      return;
    }

    setState(restored, { persist: false });
  } catch {
    // Ignore invalid persisted payloads and continue with default state.
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export function getActiveTab(): RequestTab | undefined {
  return state.tabs.find((t) => t.id === state.activeTabId);
}

export function updateActiveTab(partial: Partial<RequestTab>) {
  const tabs = state.tabs.map((t) =>
    t.id === state.activeTabId ? { ...t, ...partial } : t
  );
  setState({ tabs });
}

export function setActiveTabId(id: string) {
  setState({ activeTabId: id, response: null, grpcResponse: null });
}

export function renameTab(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const tabs = state.tabs.map((tab) =>
    tab.id === id ? { ...tab, name: trimmed } : tab
  );
  setState({ tabs });
}

export function addTab() {
  const tab = createDefaultTab();
  setState({
    tabs: [...state.tabs, tab],
    activeTabId: tab.id,
    response: null,
    grpcResponse: null,
  });
}

export function duplicateTab(id: string) {
  const source = state.tabs.find((t) => t.id === id);
  if (!source) return;
  const newTab: RequestTab = { ...source, id: uid(), name: `${source.name} (Copy)` };
  const idx = state.tabs.findIndex((t) => t.id === id);
  const tabs = [...state.tabs];
  tabs.splice(idx + 1, 0, newTab);
  setState({ tabs, activeTabId: newTab.id, response: null, grpcResponse: null });
}

export function closeTab(id: string) {
  if (state.tabs.length <= 1) return;
  const idx = state.tabs.findIndex((t) => t.id === id);
  const newTabs = state.tabs.filter((t) => t.id !== id);
  const newActiveId =
    state.activeTabId === id
      ? newTabs[Math.min(idx, newTabs.length - 1)].id
      : state.activeTabId;
  setState({ tabs: newTabs, activeTabId: newActiveId });
}

export function setResponse(response: ResponseData | null) {
  setState({ response }, { persist: false });
}

export function setGrpcResponse(grpcResponse: GrpcResponseData | null) {
  setState({ grpcResponse }, { persist: false });
}

export function setIsLoading(isLoading: boolean) {
  setState({ isLoading }, { persist: false });
}

export function addHistoryItem(item: HistoryItem) {
  setState({ history: [item, ...state.history].slice(0, 100) });
}

export function clearHistory() {
  setState({ history: [] });
}

export function setSidebarView(view: GetmanState["sidebarView"]) {
  setState({ sidebarView: view });
}

export function setSidebarOpen(open: boolean) {
  setState({ sidebarOpen: open });
}

export function setActiveEnvironment(id: string | null) {
  setState({ activeEnvironmentId: id });
}

export function addCollection(name: string) {
  const col: Collection = { id: uid(), name, requests: [], folders: [] };
  setState({ collections: [...state.collections, col] });
}

export function deleteCollection(id: string) {
  setState({ collections: state.collections.filter((c) => c.id !== id) });
}

export function renameCollection(id: string, name: string) {
  const collections = state.collections.map((c) =>
    c.id === id ? { ...c, name } : c
  );
  setState({ collections });
}

export function saveRequestToCollection(collectionId: string, request: SavedRequest) {
  const collections = state.collections.map((c) =>
    c.id === collectionId ? { ...c, requests: [...c.requests, request] } : c
  );
  setState({ collections });
}

export function deleteRequestFromCollection(collectionId: string, requestId: string) {
  const collections = state.collections.map((c) =>
    c.id === collectionId
      ? { ...c, requests: c.requests.filter((r) => r.id !== requestId) }
      : c
  );
  setState({ collections });
}

export function renameRequestInCollection(collectionId: string, requestId: string, name: string) {
  const collections = state.collections.map((c) =>
    c.id === collectionId
      ? { ...c, requests: c.requests.map((r) => (r.id === requestId ? { ...r, name } : r)) }
      : c
  );
  setState({ collections });
}

export function loadSavedRequest(savedReq: SavedRequest) {
  const existingTab = state.tabs.find((t) => t.url === savedReq.url && t.method === savedReq.method);
  if (existingTab) {
    setState({ activeTabId: existingTab.id, response: null });
  } else {
    const tab: RequestTab = { ...savedReq.tab, id: uid() };
    setState({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
      response: null,
    });
  }
}

export function loadHistoryItem(item: HistoryItem) {
  const tab = createDefaultTab();
  tab.method = item.method;
  tab.url = item.url;
  tab.name = item.url.split("/").pop() || "Request";
  if (item.requestType) {
    tab.requestType = item.requestType;
  }
  setState({
    tabs: [...state.tabs, tab],
    activeTabId: tab.id,
    response: null,
  });
}

export function addEnvironment(name: string) {
  const env: Environment = { id: uid(), name, variables: [{ id: uid(), key: "", value: "", enabled: true }] };
  setState({ environments: [...state.environments, env] });
}

export function deleteEnvironment(id: string) {
  setState({
    environments: state.environments.filter((e) => e.id !== id),
    activeEnvironmentId: state.activeEnvironmentId === id ? null : state.activeEnvironmentId,
  });
}

export function updateEnvironment(id: string, partial: Partial<Environment>) {
  const environments = state.environments.map((e) =>
    e.id === id ? { ...e, ...partial } : e
  );
  setState({ environments });
}

function resolveDynamicVariables(input: string): string {
  return input
    .replace(/\{\{\$timestamp\}\}/g, () => String(Date.now()))
    .replace(/\{\{\$isoTimestamp\}\}/g, () => new Date().toISOString())
    .replace(/\{\{\$uuid\}\}/g, () => {
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    })
    .replace(/\{\{\$randomInt\}\}/g, () => String(Math.floor(Math.random() * 10000)));
}

export function resolveEnvVariables(input: string): string {
  let result = input;
  const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // 1. Global variables (lowest priority)
  for (const v of state.globalVariables) {
    if (v.enabled && v.key) {
      result = result.replace(new RegExp(`\\{\\{${escapeRegex(v.key)}\\}\\}`, "g"), v.value);
    }
  }

  // 2. Environment variables (override globals)
  if (state.activeEnvironmentId) {
    const env = state.environments.find((e) => e.id === state.activeEnvironmentId);
    if (env) {
      for (const v of env.variables) {
        if (v.enabled && v.key) {
          result = result.replace(new RegExp(`\\{\\{${escapeRegex(v.key)}\\}\\}`, "g"), v.value);
        }
      }
    }
  }

  // 3. Ephemeral vault variables: {{$vault:key}}
  const now = Date.now();
  for (const secret of state.vaultSecrets) {
    if (!secret.key || secret.expiresAt <= now) continue;
    const escapedKey = escapeRegex(secret.key);
    result = result.replace(new RegExp(`\\{\\{\\$vault:${escapedKey}\\}\\}`, "g"), secret.value);
    result = result.replace(new RegExp(`\\{\\{vault\\.${escapedKey}\\}\\}`, "g"), secret.value);
  }

  // 4. Dynamic variables (always resolved last)
  result = resolveDynamicVariables(result);

  return result;
}

export function updateGlobalVariables(variables: EnvVariable[]) {
  setState({ globalVariables: variables });
}

export function upsertVaultSecret(key: string, value: string, ttlSeconds: number) {
  const normalizedKey = key.trim();
  if (!normalizedKey) return;
  const now = Date.now();
  const expiresAt = now + Math.max(1, ttlSeconds) * 1000;
  const activeSecrets = state.vaultSecrets.filter((s) => s.expiresAt > now && s.key !== normalizedKey);
  const nextSecrets = [
    ...activeSecrets,
    {
      id: uid(),
      key: normalizedKey,
      value,
      expiresAt,
    },
  ];
  setState({ vaultSecrets: nextSecrets }, { persist: false });
}

export function removeVaultSecret(key: string) {
  setState(
    { vaultSecrets: state.vaultSecrets.filter((s) => s.key !== key) },
    { persist: false }
  );
}

export function clearExpiredVaultSecrets() {
  const now = Date.now();
  setState(
    { vaultSecrets: state.vaultSecrets.filter((s) => s.expiresAt > now) },
    { persist: false }
  );
}

// ─── Request Lifecycle ────────────────────────────────────────────────────────

export function setActiveRequestId(id: string | null) {
  setState({ activeRequestId: id }, { persist: false });
}

export function setAssertionResults(results: AssertionResult[]) {
  setState({ assertionResults: results }, { persist: false });
}

// ─── Collection Folder Actions ────────────────────────────────────────────────

export function addFolderToCollection(collectionId: string, folderName: string) {
  const folder: CollectionFolder = { id: uid(), name: folderName, folders: [], requests: [] };
  const collections = state.collections.map((c) =>
    c.id === collectionId ? { ...c, folders: [...c.folders, folder] } : c
  );
  setState({ collections });
}

export function deleteFolderFromCollection(collectionId: string, folderId: string) {
  const collections = state.collections.map((c) =>
    c.id === collectionId
      ? { ...c, folders: c.folders.filter((f) => f.id !== folderId) }
      : c
  );
  setState({ collections });
}

export function renameFolderInCollection(collectionId: string, folderId: string, name: string) {
  const collections = state.collections.map((c) =>
    c.id === collectionId
      ? { ...c, folders: c.folders.map((f) => (f.id === folderId ? { ...f, name } : f)) }
      : c
  );
  setState({ collections });
}

export function moveRequestToFolder(collectionId: string, requestId: string, targetFolderId: string | null) {
  const collections = state.collections.map((c) => {
    if (c.id !== collectionId) return c;

    // Find the request in root or in folders
    let request: SavedRequest | undefined;
    let newRequests = c.requests.filter((r) => {
      if (r.id === requestId) {
        request = r;
        return false;
      }
      return true;
    });

    const newFolders = c.folders.map((f) => {
      const filtered = f.requests.filter((r) => {
        if (r.id === requestId) {
          request = r;
          return false;
        }
        return true;
      });
      return { ...f, requests: filtered };
    });

    if (!request) return c;

    if (targetFolderId === null) {
      // Move to root
      newRequests = [...newRequests, request];
      return { ...c, requests: newRequests, folders: newFolders };
    }

    // Move to target folder
    const updatedFolders = newFolders.map((f) =>
      f.id === targetFolderId
        ? { ...f, requests: [...f.requests, request!] }
        : f
    );
    return { ...c, requests: newRequests, folders: updatedFolders };
  });
  setState({ collections });
}

export function saveRequestToFolder(collectionId: string, folderId: string, request: SavedRequest) {
  const collections = state.collections.map((c) =>
    c.id === collectionId
      ? {
          ...c,
          folders: c.folders.map((f) =>
            f.id === folderId
              ? { ...f, requests: [...f.requests, request] }
              : f
          ),
        }
      : c
  );
  setState({ collections });
}

// ─── Import/Export ────────────────────────────────────────────────────────────

export function importCollections(collections: Collection[]) {
  setState({ collections: [...state.collections, ...collections] });
}

export function getCollections(): Collection[] {
  return state.collections;
}

export function getEnvironments(): Environment[] {
  return state.environments;
}

// ─── Cookie Jar Actions ───────────────────────────────────────────────────────

export function addCookieEntry(entry: CookieEntry) {
  const normalizedEntry: CookieEntry = {
    ...entry,
    domain: entry.domain.trim().toLowerCase().replace(/^\./, ""),
    path: entry.path || "/",
  };

  // Replace existing cookie with same name+domain, or add new
  const existing = state.cookieJar.findIndex(
    (c) =>
      c.name === normalizedEntry.name &&
      c.domain === normalizedEntry.domain &&
      (c.path || "/") === normalizedEntry.path
  );
  if (existing >= 0) {
    const jar = [...state.cookieJar];
    jar[existing] = normalizedEntry;
    setState({ cookieJar: jar });
  } else {
    setState({ cookieJar: [...state.cookieJar, normalizedEntry] });
  }
}

export function removeCookieEntry(id: string) {
  setState({ cookieJar: state.cookieJar.filter((c) => c.id !== id) });
}

export function clearCookieJar(domain?: string) {
  if (domain) {
    setState({ cookieJar: state.cookieJar.filter((c) => c.domain !== domain) });
  } else {
    setState({ cookieJar: [] });
  }
}

// ─── Preset Actions ───────────────────────────────────────────────────────────

export function addPreset(preset: Preset) {
  setState({ presets: [...state.presets, preset] });
}

export function deletePreset(id: string) {
  setState({ presets: state.presets.filter((p) => p.id !== id) });
}

export function updatePreset(id: string, partial: Partial<Preset>) {
  setState({ presets: state.presets.map((p) => p.id === id ? { ...p, ...partial } : p) });
}

// ─── History Filter Actions ───────────────────────────────────────────────────

export function setHistoryFilter(filter: Partial<HistoryFilter>) {
  setState({ historyFilter: { ...state.historyFilter, ...filter } });
}

export function resetHistoryFilter() {
  setState({ historyFilter: { method: "ALL", statusMin: 0, statusMax: 999, search: "", dateFrom: "", dateTo: "" } });
}

export function getFilteredHistory(): HistoryItem[] {
  const f = state.historyFilter;
  return state.history.filter((item) => {
    if (f.method !== "ALL" && item.method !== f.method) return false;
    if (item.status < f.statusMin || item.status > f.statusMax) return false;
    if (f.search && !item.url.toLowerCase().includes(f.search.toLowerCase())) return false;
    if (f.dateFrom && item.timestamp < new Date(f.dateFrom).getTime()) return false;
    if (f.dateTo && item.timestamp > new Date(f.dateTo).getTime() + 86400000) return false;
    return true;
  });
}

// ─── Workspace Actions ────────────────────────────────────────────────────────

export function addWorkspace(name: string) {
  const ws: Workspace = { id: uid(), name, collections: [], environments: [], activeEnvironmentId: null };
  setState({ workspaces: [...state.workspaces, ws] });
}

export function deleteWorkspace(id: string) {
  setState({
    workspaces: state.workspaces.filter((w) => w.id !== id),
    activeWorkspaceId: state.activeWorkspaceId === id ? null : state.activeWorkspaceId,
  });
}

export function setActiveWorkspace(id: string | null) {
  setState({ activeWorkspaceId: id });
}

// ─── Template Actions ─────────────────────────────────────────────────────────

export function addRequestTemplate(template: RequestTemplate) {
  setState({ requestTemplates: [...state.requestTemplates, template] });
}

export function deleteRequestTemplate(id: string) {
  setState({ requestTemplates: state.requestTemplates.filter((t) => t.id !== id) });
}

export function addAssertionTemplate(template: AssertionTemplate) {
  setState({ assertionTemplates: [...state.assertionTemplates, template] });
}

export function deleteAssertionTemplate(id: string) {
  setState({ assertionTemplates: state.assertionTemplates.filter((t) => t.id !== id) });
}

// ─── Plugin Actions ───────────────────────────────────────────────────────────

export function addPlugin(plugin: Plugin) {
  setState({ plugins: [...state.plugins, plugin] });
}

export function deletePlugin(id: string) {
  setState({ plugins: state.plugins.filter((p) => p.id !== id) });
}

export function updatePlugin(id: string, partial: Partial<Plugin>) {
  setState({ plugins: state.plugins.map((p) => p.id === id ? { ...p, ...partial } : p) });
}

export function togglePlugin(id: string) {
  setState({ plugins: state.plugins.map((p) => p.id === id ? { ...p, enabled: !p.enabled } : p) });
}

// ─── Response Snapshot & Diff Actions ─────────────────────────────────────────

export function saveResponseSnapshot(label: string) {
  if (!state.response) return;
  const tab = getActiveTab();
  const snapshot: ResponseSnapshot = {
    id: uid(),
    label,
    timestamp: Date.now(),
    response: state.response,
    method: tab?.method ?? "GET",
    url: tab?.url ?? "",
  };
  setState({ responseSnapshots: [...state.responseSnapshots, snapshot].slice(-MAX_RESPONSE_SNAPSHOTS) });
}

export function deleteResponseSnapshot(id: string) {
  setState({ responseSnapshots: state.responseSnapshots.filter((s) => s.id !== id) });
}

export function clearResponseSnapshots() {
  setState({ responseSnapshots: [] });
}

// ─── WebSocket Actions ────────────────────────────────────────────────────────

export function addWsConnection(url: string, protocols: string) {
  const conn: WsConnection = { id: uid(), url, status: "connecting", messages: [], protocols };
  setState({ wsConnections: [...state.wsConnections, conn] });
  return conn.id;
}

export function updateWsConnection(id: string, partial: Partial<WsConnection>) {
  setState({ wsConnections: state.wsConnections.map((c) => c.id === id ? { ...c, ...partial } : c) });
}

export function addWsMessage(connectionId: string, message: WsMessage) {
  setState({
    wsConnections: state.wsConnections.map((c) =>
      c.id === connectionId ? { ...c, messages: [...c.messages, message].slice(-MAX_WS_MESSAGES) } : c
    ),
  });
}

export function removeWsConnection(id: string) {
  setState({ wsConnections: state.wsConnections.filter((c) => c.id !== id) });
}

// ─── SSE Actions ──────────────────────────────────────────────────────────────

export function addSseConnection(url: string, headers: KeyValue[]) {
  const conn: SseConnection = { id: uid(), url, status: "connecting", events: [], headers };
  setState({ sseConnections: [...state.sseConnections, conn] });
  return conn.id;
}

export function updateSseConnection(id: string, partial: Partial<SseConnection>) {
  setState({ sseConnections: state.sseConnections.map((c) => c.id === id ? { ...c, ...partial } : c) });
}

export function addSseEvent(connectionId: string, event: SseEvent) {
  setState({
    sseConnections: state.sseConnections.map((c) =>
      c.id === connectionId ? { ...c, events: [...c.events, event].slice(-MAX_SSE_EVENTS) } : c
    ),
  });
}

export function removeSseConnection(id: string) {
  setState({ sseConnections: state.sseConnections.filter((c) => c.id !== id) });
}

// ─── Mock Server Actions ──────────────────────────────────────────────────────

export function addMockServer(name: string, port: number) {
  const server: MockServer = { id: uid(), name, port, routes: [], running: false };
  setState({ mockServers: [...state.mockServers, server] });
}

export function deleteMockServer(id: string) {
  setState({ mockServers: state.mockServers.filter((s) => s.id !== id) });
}

export function updateMockServer(id: string, partial: Partial<MockServer>) {
  setState({ mockServers: state.mockServers.map((s) => s.id === id ? { ...s, ...partial } : s) });
}

export function addMockRoute(serverId: string, route: MockRoute) {
  setState({
    mockServers: state.mockServers.map((s) =>
      s.id === serverId ? { ...s, routes: [...s.routes, route] } : s
    ),
  });
}

export function deleteMockRoute(serverId: string, routeId: string) {
  setState({
    mockServers: state.mockServers.map((s) =>
      s.id === serverId ? { ...s, routes: s.routes.filter((r) => r.id !== routeId) } : s
    ),
  });
}

export function createMockFromResponse(name: string, port: number) {
  const tab = getActiveTab();
  const response = state.response;
  if (!tab || !response) return;

  const resolvedUrl = resolveEnvVariables(tab.url);
  let pathname = "/";
  try { pathname = new URL(resolvedUrl).pathname; } catch { /* use default */ }

  const route: MockRoute = {
    id: uid(),
    method: tab.method,
    path: pathname,
    statusCode: response.status,
    headers: response.headers,
    body: response.body,
    delay: 0,
  };

  const server: MockServer = { id: uid(), name, port, routes: [route], running: false };
  setState({ mockServers: [...state.mockServers, server] });
}

// ─── Command Palette ──────────────────────────────────────────────────────────

export function setCommandPaletteOpen(open: boolean) {
  setState({ commandPaletteOpen: open }, { persist: false });
}

// ─── Previous Response (for diff) ─────────────────────────────────────────────

export function setPreviousResponse(response: ResponseData | null) {
  setState({ previousResponse: response }, { persist: false });
}

// ─── Request Deduplication Detection ──────────────────────────────────────────

export function findDuplicateRequests(): { url: string; method: HttpMethod; count: number; tabIds: string[] }[] {
  const map = new Map<string, { method: HttpMethod; url: string; tabIds: string[] }>();
  for (const tab of state.tabs) {
    if (!tab.url.trim()) continue;
    const key = `${tab.method}::${tab.url.trim().toLowerCase()}`;
    const existing = map.get(key);
    if (existing) {
      existing.tabIds.push(tab.id);
    } else {
      map.set(key, { method: tab.method, url: tab.url, tabIds: [tab.id] });
    }
  }
  return Array.from(map.values())
    .filter((entry) => entry.tabIds.length > 1)
    .map((entry) => ({ ...entry, count: entry.tabIds.length }));
}

// ─── Batch Environment Switch & Replay ────────────────────────────────────────

export function getRecentRequests(count: number = 10): HistoryItem[] {
  return state.history.slice(0, count);
}

export function switchEnvironmentAndGetReplayData(envId: string | null): HistoryItem[] {
  setActiveEnvironment(envId);
  return getRecentRequests();
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGetmanStore(): GetmanState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useActiveTab(): RequestTab | undefined {
  const store = useGetmanStore();
  return store.tabs.find((t) => t.id === store.activeTabId);
}
