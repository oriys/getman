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

export interface RequestTab {
  id: string;
  name: string;
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
  authType: "none" | "bearer" | "basic" | "api-key" | "oauth2";
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
  // Request settings
  settings: RequestSettings;
  // Test assertions
  assertions: TestAssertion[];
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

export interface GetmanState {
  tabs: RequestTab[];
  activeTabId: string;
  response: ResponseData | null;
  isLoading: boolean;
  activeRequestId: string | null;
  history: HistoryItem[];
  collections: Collection[];
  environments: Environment[];
  activeEnvironmentId: string | null;
  globalVariables: EnvVariable[];
  sidebarView: "collections" | "history" | "environments";
  sidebarOpen: boolean;
  assertionResults: AssertionResult[];
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
    settings: defaultSettings(),
    assertions: [],
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
    activeRequestId: null,
    history: [],
    collections: [],
    environments: [],
    activeEnvironmentId: null,
    globalVariables: [],
    sidebarView: "collections",
    sidebarOpen: true,
    assertionResults: [],
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
    sidebarView,
    sidebarOpen: typeof parsed.sidebarOpen === "boolean" ? parsed.sidebarOpen : true,
    response: null,
    isLoading: false,
    activeRequestId: null,
    assertionResults: [],
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

  // 1. Global variables (lowest priority)
  for (const v of state.globalVariables) {
    if (v.enabled && v.key) {
      result = result.replace(new RegExp(`\\{\\{${v.key}\\}\\}`, "g"), v.value);
    }
  }

  // 2. Environment variables (override globals)
  if (state.activeEnvironmentId) {
    const env = state.environments.find((e) => e.id === state.activeEnvironmentId);
    if (env) {
      for (const v of env.variables) {
        if (v.enabled && v.key) {
          result = result.replace(new RegExp(`\\{\\{${v.key}\\}\\}`, "g"), v.value);
        }
      }
    }
  }

  // 3. Dynamic variables (always resolved last)
  result = resolveDynamicVariables(result);

  return result;
}

export function updateGlobalVariables(variables: EnvVariable[]) {
  setState({ globalVariables: variables });
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

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGetmanStore(): GetmanState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useActiveTab(): RequestTab | undefined {
  const store = useGetmanStore();
  return store.tabs.find((t) => t.id === store.activeTabId);
}
