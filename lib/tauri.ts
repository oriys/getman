'use client';

export interface SendRequestPayload {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  requestId?: string;
  timeoutMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  proxyUrl?: string;
  verifySsl?: boolean;
}

export interface HttpResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  time: number;
  size: number;
  contentType: string;
}

// ─── gRPC Types ──────────────────────────────────────────────────────────────

export interface GrpcRequestPayload {
  endpoint: string;
  protoContent: string;
  serviceName: string;
  methodName: string;
  requestJson: string;
  metadata: Record<string, string>;
  timeoutMs?: number;
  requestId?: string;
}

export interface GrpcResponseData {
  statusCode: number;
  statusMessage: string;
  responseJson: string;
  responseMetadata: Record<string, string>;
  time: number;
  size: number;
}

export interface ProtoServiceInfo {
  name: string;
  fullName: string;
  methods: ProtoMethodInfo[];
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

export interface ProtoFieldInfo {
  name: string;
  number: number;
  typeName: string;
  isRepeated: boolean;
}

const LOCAL_STATE_KEY = "getman.state.v1";

function isBodyAllowed(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    Object.prototype.hasOwnProperty.call(window, "__TAURI_INTERNALS__")
  );
}

// ─── Cancel support for browser-based requests ──────────────────────────────

const abortControllers = new Map<string, AbortController>();

async function fetchResponse(payload: SendRequestPayload): Promise<HttpResponseData> {
  const controller = new AbortController();
  if (payload.requestId) {
    abortControllers.set(payload.requestId, controller);
  }

  const requestInit: RequestInit = {
    method: payload.method,
    headers: payload.headers,
    signal: controller.signal,
  };

  if (payload.body && isBodyAllowed(payload.method)) {
    requestInit.body = payload.body;
  }

  const maxRetries = payload.retryCount ?? 0;
  const retryDelay = payload.retryDelayMs ?? 1000;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }

    try {
      const start = performance.now();
      const response = await fetch(payload.url, requestInit);
      const elapsed = Math.round(performance.now() - start);
      const text = await response.text();

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        status: response.status,
        statusText: response.statusText,
        headers,
        body: text,
        time: elapsed,
        size: new TextEncoder().encode(text).length,
        contentType: response.headers.get("content-type") || "text/plain",
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Request cancelled");
      }
      lastError = error instanceof Error ? error : new Error("Unknown error");
      if (attempt < maxRetries) continue;
    }
  }

  throw lastError ?? new Error("Request failed");
}

function toErrorResponse(error: unknown): HttpResponseData {
  const message =
    error instanceof Error ? error.message : "Unknown request error";

  return {
    status: 0,
    statusText: "Error",
    headers: {},
    body: message,
    time: 0,
    size: 0,
    contentType: "text/plain",
  };
}

export async function sendHttpRequest(
  payload: SendRequestPayload
): Promise<HttpResponseData> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<HttpResponseData>("send_http_request", { payload });
    } catch (error) {
      try {
        return await fetchResponse(payload);
      } catch (fallbackError) {
        return toErrorResponse(fallbackError ?? error);
      }
    }
  }

  try {
    return await fetchResponse(payload);
  } catch (error) {
    return toErrorResponse(error);
  } finally {
    if (payload.requestId) {
      abortControllers.delete(payload.requestId);
    }
  }
}

export async function cancelHttpRequest(requestId: string): Promise<boolean> {
  // Try Tauri first
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("cancel_http_request", { requestId });
    } catch {
      // fallback to browser abort
    }
  }

  // Browser fallback
  const controller = abortControllers.get(requestId);
  if (controller) {
    controller.abort();
    abortControllers.delete(requestId);
    return true;
  }
  return false;
}

export async function loadPersistedState(): Promise<string | null> {
  if (typeof window === "undefined") {
    return null;
  }

  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const state = await invoke<string | null>("load_app_state");
      if (state !== null) {
        return state;
      }
    } catch {
      // Local storage fallback is used when Tauri invocation fails.
    }
  }

  return window.localStorage.getItem(LOCAL_STATE_KEY);
}

export async function savePersistedState(stateJson: string): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_app_state", { stateJson });
      return;
    } catch {
      // Local storage fallback is used when Tauri invocation fails.
    }
  }

  window.localStorage.setItem(LOCAL_STATE_KEY, stateJson);
}

// ─── gRPC Functions ──────────────────────────────────────────────────────────

export async function parseProtoContent(
  protoContent: string
): Promise<ProtoServiceInfo[]> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<ProtoServiceInfo[]>("parse_proto_content", {
        protoContent,
      });
    } catch (error) {
      throw error instanceof Error ? error : new Error("Failed to parse proto");
    }
  }

  throw new Error("gRPC is only supported in the desktop app");
}

export async function sendGrpcRequest(
  payload: GrpcRequestPayload
): Promise<GrpcResponseData> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<GrpcResponseData>("send_grpc_request", { payload });
    } catch (error) {
      return {
        statusCode: 2,
        statusMessage:
          error instanceof Error ? error.message : "Unknown gRPC error",
        responseJson: "",
        responseMetadata: {},
        time: 0,
        size: 0,
      };
    }
  }

  return {
    statusCode: 2,
    statusMessage: "gRPC is only supported in the desktop app",
    responseJson: "",
    responseMetadata: {},
    time: 0,
    size: 0,
  };
}
