'use client';

/**
 * Postman Collection v2.1 Import/Export
 *
 * Format spec: https://schema.postman.com/json/collection/v2.1.0/collection.json
 */

import {
  type Collection,
  type CollectionFolder,
  type SavedRequest,
  type RequestTab,
  type KeyValue,
  type HttpMethod,
  uid,
  createEmptyKV,
  createDefaultTab,
  defaultSettings,
} from "./getman-store";

// ─── Postman v2.1 Types ──────────────────────────────────────────────────────

interface PostmanCollection {
  info: {
    name: string;
    description?: string;
    schema: string;
    _postman_id?: string;
  };
  item: PostmanItem[];
  variable?: PostmanVariable[];
}

interface PostmanItem {
  name: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
  response?: unknown[];
}

interface PostmanRequest {
  method: string;
  header?: PostmanHeader[];
  url: PostmanUrl | string;
  body?: PostmanBody;
  auth?: PostmanAuth;
  description?: string;
}

interface PostmanHeader {
  key: string;
  value: string;
  disabled?: boolean;
}

interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[];
  path?: string[];
  query?: PostmanQuery[];
}

interface PostmanQuery {
  key: string;
  value: string;
  disabled?: boolean;
}

interface PostmanBody {
  mode: string;
  raw?: string;
  urlencoded?: PostmanFormField[];
  formdata?: PostmanFormField[];
  options?: {
    raw?: { language?: string };
  };
}

interface PostmanFormField {
  key: string;
  value: string;
  disabled?: boolean;
  type?: string;
}

interface PostmanAuth {
  type: string;
  bearer?: { key: string; value: string }[];
  basic?: { key: string; value: string }[];
  digest?: { key: string; value: string }[];
  ntlm?: { key: string; value: string }[];
  apikey?: { key: string; value: string }[];
  oauth2?: { key: string; value: string }[];
}

interface PostmanVariable {
  key: string;
  value: string;
}

// ─── Import ──────────────────────────────────────────────────────────────────

function parsePostmanUrl(url: PostmanUrl | string): { raw: string; query: KeyValue[] } {
  if (typeof url === "string") {
    return { raw: url, query: [createEmptyKV()] };
  }

  const raw = url.raw || "";
  const query: KeyValue[] = (url.query || []).map((q) => ({
    id: uid(),
    key: q.key || "",
    value: q.value || "",
    enabled: !q.disabled,
  }));

  if (query.length === 0) query.push(createEmptyKV());
  return { raw, query };
}

function parsePostmanHeaders(headers?: PostmanHeader[]): KeyValue[] {
  if (!headers || headers.length === 0) return [createEmptyKV()];
  const kvs: KeyValue[] = headers.map((h) => ({
    id: uid(),
    key: h.key || "",
    value: h.value || "",
    enabled: !h.disabled,
  }));
  return kvs;
}

function parsePostmanBody(body?: PostmanBody): Pick<RequestTab, "bodyType" | "bodyContent" | "bodyFormData"> {
  if (!body) {
    return { bodyType: "none", bodyContent: "", bodyFormData: [createEmptyKV()] };
  }

  switch (body.mode) {
    case "raw": {
      const lang = body.options?.raw?.language;
      if (lang === "json") {
        return { bodyType: "json", bodyContent: body.raw || "", bodyFormData: [createEmptyKV()] };
      }
      return { bodyType: "raw", bodyContent: body.raw || "", bodyFormData: [createEmptyKV()] };
    }
    case "urlencoded": {
      const formData = (body.urlencoded || []).map((f) => ({
        id: uid(),
        key: f.key || "",
        value: f.value || "",
        enabled: !f.disabled,
      }));
      if (formData.length === 0) formData.push(createEmptyKV());
      return { bodyType: "x-www-form-urlencoded", bodyContent: "", bodyFormData: formData };
    }
    case "formdata": {
      const formData = (body.formdata || []).map((f) => ({
        id: uid(),
        key: f.key || "",
        value: f.value || "",
        enabled: !f.disabled,
      }));
      if (formData.length === 0) formData.push(createEmptyKV());
      return { bodyType: "form-data", bodyContent: "", bodyFormData: formData };
    }
    default:
      return { bodyType: "none", bodyContent: "", bodyFormData: [createEmptyKV()] };
  }
}

function parsePostmanAuth(auth?: PostmanAuth): Pick<RequestTab, "authType" | "authToken" | "authUsername" | "authPassword" | "ntlmDomain" | "authApiKey" | "authApiValue" | "authApiAddTo"> {
  const defaults = {
    authType: "none" as RequestTab["authType"],
    authToken: "",
    authUsername: "",
    authPassword: "",
    ntlmDomain: "",
    authApiKey: "",
    authApiValue: "",
    authApiAddTo: "header" as const,
  };

  if (!auth) return defaults;

  switch (auth.type) {
    case "bearer": {
      const token = auth.bearer?.find((v) => v.key === "token")?.value || "";
      return { ...defaults, authType: "bearer", authToken: token };
    }
    case "basic": {
      const username = auth.basic?.find((v) => v.key === "username")?.value || "";
      const password = auth.basic?.find((v) => v.key === "password")?.value || "";
      return { ...defaults, authType: "basic", authUsername: username, authPassword: password };
    }
    case "digest": {
      const username = auth.digest?.find((v) => v.key === "username")?.value || "";
      const password = auth.digest?.find((v) => v.key === "password")?.value || "";
      return { ...defaults, authType: "digest", authUsername: username, authPassword: password };
    }
    case "ntlm": {
      const username = auth.ntlm?.find((v) => v.key === "username")?.value || "";
      const password = auth.ntlm?.find((v) => v.key === "password")?.value || "";
      const domain = auth.ntlm?.find((v) => v.key === "domain")?.value || "";
      return {
        ...defaults,
        authType: "ntlm",
        authUsername: username,
        authPassword: password,
        ntlmDomain: domain,
      };
    }
    case "apikey": {
      const key = auth.apikey?.find((v) => v.key === "key")?.value || "";
      const value = auth.apikey?.find((v) => v.key === "value")?.value || "";
      const addTo = auth.apikey?.find((v) => v.key === "in")?.value === "query" ? "query" : "header";
      return { ...defaults, authType: "api-key", authApiKey: key, authApiValue: value, authApiAddTo: addTo };
    }
    case "oauth2": {
      const accessToken = auth.oauth2?.find((v) => v.key === "accessToken")?.value || "";
      return { ...defaults, authType: "oauth2", authToken: accessToken };
    }
    default:
      return defaults;
  }
}

function postmanItemToRequest(item: PostmanItem): SavedRequest | null {
  if (!item.request) return null;

  const req = item.request;
  const method = (req.method || "GET").toUpperCase() as HttpMethod;
  const { raw: url, query } = parsePostmanUrl(req.url);
  const headers = parsePostmanHeaders(req.header);
  const bodyParts = parsePostmanBody(req.body);
  const authParts = parsePostmanAuth(req.auth);

  const tab: RequestTab = {
    ...createDefaultTab(),
    name: item.name,
    method,
    url,
    params: query,
    headers,
    ...bodyParts,
    ...authParts,
  };

  return {
    id: uid(),
    name: item.name,
    method,
    url,
    tab,
  };
}

function postmanItemsToFolder(items: PostmanItem[]): { requests: SavedRequest[]; folders: CollectionFolder[] } {
  const requests: SavedRequest[] = [];
  const folders: CollectionFolder[] = [];

  for (const item of items) {
    if (item.item) {
      // This is a folder
      const sub = postmanItemsToFolder(item.item);
      folders.push({
        id: uid(),
        name: item.name,
        requests: sub.requests,
        folders: sub.folders,
      });
    } else {
      const req = postmanItemToRequest(item);
      if (req) requests.push(req);
    }
  }

  return { requests, folders };
}

export function importPostmanCollection(json: string): Collection {
  const data: PostmanCollection = JSON.parse(json);

  if (!data.info || !data.item) {
    throw new Error("Invalid Postman Collection format");
  }

  const { requests, folders } = postmanItemsToFolder(data.item);

  return {
    id: uid(),
    name: data.info.name || "Imported Collection",
    requests,
    folders,
  };
}

// ─── Export ──────────────────────────────────────────────────────────────────

function tabToPostmanRequest(tab: RequestTab): PostmanRequest {
  const headers: PostmanHeader[] = tab.headers
    .filter((h) => h.key)
    .map((h) => ({ key: h.key, value: h.value, disabled: !h.enabled }));

  const query: PostmanQuery[] = tab.params
    .filter((p) => p.key)
    .map((p) => ({ key: p.key, value: p.value, disabled: !p.enabled }));

  let body: PostmanBody | undefined;
  if (tab.bodyType === "json") {
    body = {
      mode: "raw",
      raw: tab.bodyContent,
      options: { raw: { language: "json" } },
    };
  } else if (tab.bodyType === "raw") {
    body = { mode: "raw", raw: tab.bodyContent };
  } else if (tab.bodyType === "x-www-form-urlencoded") {
    body = {
      mode: "urlencoded",
      urlencoded: tab.bodyFormData.filter((f) => f.key).map((f) => ({
        key: f.key,
        value: f.value,
        disabled: !f.enabled,
      })),
    };
  } else if (tab.bodyType === "form-data") {
    body = {
      mode: "formdata",
      formdata: tab.bodyFormData.filter((f) => f.key).map((f) => ({
        key: f.key,
        value: f.value,
        disabled: !f.enabled,
        type: "text",
      })),
    };
  }

  let auth: PostmanAuth | undefined;
  if (tab.authType === "bearer") {
    auth = { type: "bearer", bearer: [{ key: "token", value: tab.authToken }] };
  } else if (tab.authType === "basic") {
    auth = {
      type: "basic",
      basic: [
        { key: "username", value: tab.authUsername },
        { key: "password", value: tab.authPassword },
      ],
    };
  } else if (tab.authType === "api-key") {
    auth = {
      type: "apikey",
      apikey: [
        { key: "key", value: tab.authApiKey },
        { key: "value", value: tab.authApiValue },
        { key: "in", value: tab.authApiAddTo },
      ],
    };
  }

  return {
    method: tab.method,
    header: headers,
    url: {
      raw: tab.url,
      query: query.length > 0 ? query : undefined,
    },
    body,
    auth,
  };
}

function savedRequestToPostmanItem(req: SavedRequest): PostmanItem {
  return {
    name: req.name,
    request: tabToPostmanRequest(req.tab),
  };
}

function folderToPostmanItems(folder: CollectionFolder): PostmanItem {
  return {
    name: folder.name,
    item: [
      ...folder.folders.map(folderToPostmanItems),
      ...folder.requests.map(savedRequestToPostmanItem),
    ],
  };
}

export function exportPostmanCollection(collection: Collection): string {
  const postman: PostmanCollection = {
    info: {
      name: collection.name,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      _postman_id: collection.id,
    },
    item: [
      ...collection.folders.map(folderToPostmanItems),
      ...collection.requests.map(savedRequestToPostmanItem),
    ],
  };

  return JSON.stringify(postman, null, 2);
}
