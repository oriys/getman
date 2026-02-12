'use client';

export interface SendRequestPayload {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
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

async function fetchResponse(payload: SendRequestPayload): Promise<HttpResponseData> {
  const requestInit: RequestInit = {
    method: payload.method,
    headers: payload.headers,
  };

  if (payload.body && isBodyAllowed(payload.method)) {
    requestInit.body = payload.body;
  }

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
  }
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
