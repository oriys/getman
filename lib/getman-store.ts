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

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

// Script types for Layer 3: Test & Script Engine
export interface Script {
  id: string;
  type: "pre-request" | "test";
  name?: string;
  code: string;
  enabled: boolean;
}

export interface TestAssertion {
  id: string;
  type: "status" | "header" | "body-contains" | "json-path" | "response-time";
  name: string;
  enabled: boolean;
  expectedStatus?: number;
  headerKey?: string;
  headerValue?: string;
  bodyValue?: string;
  jsonPath?: string;
  maxResponseTime?: number;
}

export interface RequestTab {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  bodyType: "none" | "json" | "form-data" | "x-www-form-urlencoded" | "raw";
  bodyContent: string;
  bodyFormData: KeyValue[];
  authType: "none" | "bearer" | "basic" | "api-key";
  authToken: string;
  authUsername: string;
  authPassword: string;
  authApiKey: string;
  authApiValue: string;
  authApiAddTo: "header" | "query";
  
  // Layer 3: Scripts and tests
  preRequestScript?: Script;
  testScript?: Script;
  assertions?: TestAssertion[];
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

export interface HistoryItem {
  id: string;
  method: HttpMethod;
  url: string;
  status: number;
  time: number;
  timestamp: number;
}

export interface CollectionFolder {
  id: string;
  name: string;
  description?: string;
  requests: SavedRequest[];
  folders: CollectionFolder[];  // Nested folders
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  version?: string;
  requests: SavedRequest[];
  folders: CollectionFolder[];
  
  // Collection-level scripts (Layer 3)
  preRequestScript?: Script;
  testScript?: Script;
  
  // Collection-level variables (Layer 4)
  variables?: KeyValue[];
}

export interface SavedRequest {
  id: string;
  name: string;
  description?: string;
  method: HttpMethod;
  url: string;
  tab: RequestTab;
  
  // Layer 3: Scripts and tests
  preRequestScript?: Script;
  testScript?: Script;
  assertions?: TestAssertion[];
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

// Layer 3: Test Results
export interface TestResult {
  id: string;
  assertionId: string;
  name: string;
  passed: boolean;
  message: string;
  actualValue?: unknown;
  expectedValue?: unknown;
}

// Layer 4: Collection Runner
export interface CollectionRunResult {
  runId: string;
  collectionId: string;
  collectionName: string;
  startTime: number;
  endTime: number;
  duration: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
}

export interface GetmanState {
  tabs: RequestTab[];
  activeTabId: string;
  response: ResponseData | null;
  isLoading: boolean;
  history: HistoryItem[];
  collections: Collection[];
  environments: Environment[];
  activeEnvironmentId: string | null;
  sidebarView: "collections" | "history" | "environments";
  sidebarOpen: boolean;
  
  // Layer 3: Test results for active request
  testResults?: TestResult[];
  
  // Layer 4: Collection runner state
  collectionRunResults: CollectionRunResult[];
  isRunningCollection: boolean;
}

interface PersistedState {
  version: number;
  tabs: RequestTab[];
  activeTabId: string;
  history: HistoryItem[];
  collections: Collection[];
  environments: Environment[];
  activeEnvironmentId: string | null;
  sidebarView: GetmanState["sidebarView"];
  sidebarOpen: boolean;
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

export function createDefaultTab(): RequestTab {
  return {
    id: uid(),
    name: "New Request",
    method: "GET",
    url: "",
    params: [createEmptyKV()],
    headers: [createEmptyKV()],
    bodyType: "none",
    bodyContent: "",
    bodyFormData: [createEmptyKV()],
    authType: "none",
    authToken: "",
    authUsername: "",
    authPassword: "",
    authApiKey: "",
    authApiValue: "",
    authApiAddTo: "header",
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

type Listener = () => void;

const PERSISTED_STATE_VERSION = 1;

function createInitialState(): GetmanState {
  const defaultTab = createDefaultTab();
  return {
    tabs: [defaultTab],
    activeTabId: defaultTab.id,
    response: null,
    isLoading: false,
    history: [],
    collections: [],
    environments: [],
    activeEnvironmentId: null,
    sidebarView: "collections",
    sidebarOpen: true,
    testResults: undefined,
    collectionRunResults: [],
    isRunningCollection: false,
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
    parsed.sidebarView === "collections" ||
    parsed.sidebarView === "history" ||
    parsed.sidebarView === "environments"
      ? parsed.sidebarView
      : "collections";

  return {
    tabs,
    activeTabId,
    history: Array.isArray(parsed.history) ? parsed.history.slice(0, 100) : [],
    collections: Array.isArray(parsed.collections) ? parsed.collections : [],
    environments: Array.isArray(parsed.environments) ? parsed.environments : [],
    activeEnvironmentId:
      typeof parsed.activeEnvironmentId === "string" ? parsed.activeEnvironmentId : null,
    sidebarView,
    sidebarOpen: typeof parsed.sidebarOpen === "boolean" ? parsed.sidebarOpen : true,
    response: null,
    isLoading: false,
    testResults: undefined,
    collectionRunResults: [],
    isRunningCollection: false,
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
    sidebarView: current.sidebarView,
    sidebarOpen: current.sidebarOpen,
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
  setState({ activeTabId: id, response: null });
}

export function addTab() {
  const tab = createDefaultTab();
  setState({
    tabs: [...state.tabs, tab],
    activeTabId: tab.id,
    response: null,
  });
}

export function duplicateTab(id: string) {
  const source = state.tabs.find((t) => t.id === id);
  if (!source) return;
  const newTab: RequestTab = { ...source, id: uid(), name: `${source.name} (Copy)` };
  const idx = state.tabs.findIndex((t) => t.id === id);
  const tabs = [...state.tabs];
  tabs.splice(idx + 1, 0, newTab);
  setState({ tabs, activeTabId: newTab.id, response: null });
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
  const col: Collection = { 
    id: uid(), 
    name, 
    requests: [],
    folders: [],
    variables: []
  };
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

export function resolveEnvVariables(input: string): string {
  if (!state.activeEnvironmentId) return input;
  const env = state.environments.find((e) => e.id === state.activeEnvironmentId);
  if (!env) return input;
  let result = input;
  for (const v of env.variables) {
    if (v.enabled && v.key) {
      result = result.replace(new RegExp(`\\{\\{${v.key}\\}\\}`, "g"), v.value);
    }
  }
  return result;
}

// ─── Layer 3: Test & Script Actions ───────────────────────────────────────────

export function setTestResults(results: TestResult[]) {
  setState({ testResults: results }, { persist: false });
}

export function clearTestResults() {
  setState({ testResults: undefined }, { persist: false });
}

export function addFolderToCollection(collectionId: string, folderName: string) {
  const collections = state.collections.map((c) => {
    if (c.id === collectionId) {
      const folder: CollectionFolder = {
        id: uid(),
        name: folderName,
        requests: [],
        folders: []
      };
      return { ...c, folders: [...c.folders, folder] };
    }
    return c;
  });
  setState({ collections });
}

export function deleteFolderFromCollection(collectionId: string, folderId: string) {
  const collections = state.collections.map((c) => {
    if (c.id === collectionId) {
      return { ...c, folders: c.folders.filter((f) => f.id !== folderId) };
    }
    return c;
  });
  setState({ collections });
}

// ─── Layer 4: Collection Runner Actions ───────────────────────────────────────

export function setIsRunningCollection(isRunning: boolean) {
  setState({ isRunningCollection: isRunning }, { persist: false });
}

export function addCollectionRunResult(result: CollectionRunResult) {
  setState({ 
    collectionRunResults: [result, ...state.collectionRunResults].slice(0, 50)
  });
}

export function clearCollectionRunResults() {
  setState({ collectionRunResults: [] });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGetmanStore(): GetmanState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useActiveTab(): RequestTab | undefined {
  const store = useGetmanStore();
  return store.tabs.find((t) => t.id === store.activeTabId);
}
