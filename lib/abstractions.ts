'use client';

// ─── Tenant Isolation ─────────────────────────────────────────────────────────

export interface TenantId {
  id: string;
}

export interface TenantContext {
  tenantId: TenantId;
  tenantName: string;
  metadata: Record<string, string>;
}

export function createTenantContext(
  id: string,
  name: string,
  metadata: Record<string, string> = {}
): TenantContext {
  return { tenantId: { id }, tenantName: name, metadata };
}

export function defaultTenant(): TenantContext {
  return createTenantContext("default", "Default Tenant");
}

export function scopedKey(tenant: TenantContext, key: string): string {
  return `${tenant.tenantId.id}:${key}`;
}

// ─── Database Abstraction ─────────────────────────────────────────────────────

export interface DbRecord {
  id: string;
  collection: string;
  data: unknown;
  createdAt: number;
  updatedAt: number;
}

export type FilterOp =
  | { type: "eq"; value: unknown }
  | { type: "neq"; value: unknown }
  | { type: "gt"; value: unknown }
  | { type: "lt"; value: unknown }
  | { type: "contains"; value: string }
  | { type: "in"; value: unknown[] };

export interface Filter {
  field: string;
  op: FilterOp;
}

export interface Query {
  filters?: Filter[];
  orderBy?: string;
  ascending?: boolean;
  limit?: number;
  offset?: number;
}

export interface QueryResult {
  records: DbRecord[];
  total: number;
}

export interface Database {
  insert(tenant: TenantContext, collection: string, id: string, data: unknown): Promise<DbRecord>;
  get(tenant: TenantContext, collection: string, id: string): Promise<DbRecord | null>;
  update(tenant: TenantContext, collection: string, id: string, data: unknown): Promise<DbRecord>;
  delete(tenant: TenantContext, collection: string, id: string): Promise<boolean>;
  list(tenant: TenantContext, collection: string, query?: Query): Promise<QueryResult>;
}

// ─── Cache Abstraction ────────────────────────────────────────────────────────

export interface CacheOptions {
  ttlSecs?: number;
}

export interface Cache {
  get(tenant: TenantContext, key: string): Promise<string | null>;
  set(tenant: TenantContext, key: string, value: string, options?: CacheOptions): Promise<void>;
  delete(tenant: TenantContext, key: string): Promise<boolean>;
  exists(tenant: TenantContext, key: string): Promise<boolean>;
  clear(tenant: TenantContext): Promise<void>;
}

// ─── Message Queue Abstraction ────────────────────────────────────────────────

export interface QueueMessage {
  id: string;
  topic: string;
  payload: unknown;
  metadata: Record<string, string>;
  timestamp: number;
}

export interface PublishOptions {
  delaySecs?: number;
  priority?: number;
}

export interface SubscriptionId {
  id: string;
}

export interface MessageQueue {
  publish(tenant: TenantContext, topic: string, payload: unknown, options?: PublishOptions): Promise<string>;
  subscribe(tenant: TenantContext, topic: string): Promise<SubscriptionId>;
  poll(tenant: TenantContext, subscriptionId: SubscriptionId): Promise<QueueMessage | null>;
  acknowledge(tenant: TenantContext, messageId: string): Promise<void>;
  unsubscribe(tenant: TenantContext, subscriptionId: SubscriptionId): Promise<void>;
}

// ─── Stateful Function Abstraction ────────────────────────────────────────────

export interface FunctionState {
  functionId: string;
  data: Record<string, unknown>;
  version: number;
  updatedAt: number;
}

export interface FunctionContext {
  tenant: TenantContext;
  invocationId: string;
  functionId: string;
}

export interface StateStore {
  loadState(tenant: TenantContext, functionId: string): Promise<FunctionState>;
  saveState(tenant: TenantContext, state: FunctionState): Promise<void>;
  clearState(tenant: TenantContext, functionId: string): Promise<void>;
  listFunctions(tenant: TenantContext): Promise<string[]>;
}

// ─── In-Memory Implementations ───────────────────────────────────────────────

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** In-memory Database for local/browser use. */
export class InMemoryDatabase implements Database {
  private store = new Map<string, Map<string, DbRecord>>();

  private bucketKey(tenant: TenantContext, collection: string): string {
    return scopedKey(tenant, collection);
  }

  async insert(tenant: TenantContext, collection: string, id: string, data: unknown): Promise<DbRecord> {
    const now = nowSecs();
    const record: DbRecord = { id, collection, data, createdAt: now, updatedAt: now };
    const key = this.bucketKey(tenant, collection);
    if (!this.store.has(key)) this.store.set(key, new Map());
    this.store.get(key)!.set(id, record);
    return record;
  }

  async get(tenant: TenantContext, collection: string, id: string): Promise<DbRecord | null> {
    const key = this.bucketKey(tenant, collection);
    return this.store.get(key)?.get(id) ?? null;
  }

  async update(tenant: TenantContext, collection: string, id: string, data: unknown): Promise<DbRecord> {
    const key = this.bucketKey(tenant, collection);
    const existing = this.store.get(key)?.get(id);
    if (!existing) throw new Error(`Record not found: ${id}`);
    const updated = { ...existing, data, updatedAt: nowSecs() };
    this.store.get(key)!.set(id, updated);
    return updated;
  }

  async delete(tenant: TenantContext, collection: string, id: string): Promise<boolean> {
    const key = this.bucketKey(tenant, collection);
    return this.store.get(key)?.delete(id) ?? false;
  }

  async list(tenant: TenantContext, collection: string, query?: Query): Promise<QueryResult> {
    const key = this.bucketKey(tenant, collection);
    const bucket = this.store.get(key);
    const all = bucket ? Array.from(bucket.values()) : [];
    const total = all.length;
    const offset = query?.offset ?? 0;
    const limit = query?.limit ?? total;
    const records = all.slice(offset, offset + limit);
    return { records, total };
  }
}

/** In-memory Cache for local/browser use. */
export class InMemoryCache implements Cache {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  async get(tenant: TenantContext, key: string): Promise<string | null> {
    const sk = scopedKey(tenant, key);
    const entry = this.store.get(sk);
    if (!entry) return null;
    if (entry.expiresAt !== null && nowSecs() >= entry.expiresAt) {
      this.store.delete(sk);
      return null;
    }
    return entry.value;
  }

  async set(tenant: TenantContext, key: string, value: string, options?: CacheOptions): Promise<void> {
    const sk = scopedKey(tenant, key);
    const expiresAt = options?.ttlSecs ? nowSecs() + options.ttlSecs : null;
    this.store.set(sk, { value, expiresAt });
  }

  async delete(tenant: TenantContext, key: string): Promise<boolean> {
    return this.store.delete(scopedKey(tenant, key));
  }

  async exists(tenant: TenantContext, key: string): Promise<boolean> {
    const val = await this.get(tenant, key);
    return val !== null;
  }

  async clear(tenant: TenantContext): Promise<void> {
    const prefix = `${tenant.tenantId.id}:`;
    for (const k of Array.from(this.store.keys())) {
      if (k.startsWith(prefix)) this.store.delete(k);
    }
  }
}

/** In-memory Message Queue for local/browser use. */
export class InMemoryMessageQueue implements MessageQueue {
  private messages = new Map<string, QueueMessage[]>();
  private subscriptions = new Map<string, string[]>();

  async publish(tenant: TenantContext, topic: string, payload: unknown, _options?: PublishOptions): Promise<string> {
    const st = scopedKey(tenant, topic);
    const msg: QueueMessage = {
      id: generateId("msg"),
      topic,
      payload,
      metadata: {},
      timestamp: nowSecs(),
    };
    if (!this.messages.has(st)) this.messages.set(st, []);
    this.messages.get(st)!.push(msg);
    return msg.id;
  }

  async subscribe(tenant: TenantContext, topic: string): Promise<SubscriptionId> {
    const st = scopedKey(tenant, topic);
    const subId = generateId("sub");
    this.subscriptions.set(subId, [st]);
    return { id: subId };
  }

  async poll(_tenant: TenantContext, subscriptionId: SubscriptionId): Promise<QueueMessage | null> {
    const topics = this.subscriptions.get(subscriptionId.id);
    if (!topics) throw new Error(`Subscription not found: ${subscriptionId.id}`);
    for (const topic of topics) {
      const queue = this.messages.get(topic);
      if (queue && queue.length > 0) {
        return queue.shift()!;
      }
    }
    return null;
  }

  async acknowledge(_tenant: TenantContext, _messageId: string): Promise<void> {
    // In-memory: no-op, messages removed on poll.
  }

  async unsubscribe(_tenant: TenantContext, subscriptionId: SubscriptionId): Promise<void> {
    this.subscriptions.delete(subscriptionId.id);
  }
}

/** In-memory State Store for local/browser use. */
export class InMemoryStateStore implements StateStore {
  private states = new Map<string, FunctionState>();

  private storageKey(tenant: TenantContext, functionId: string): string {
    return scopedKey(tenant, `fn:${functionId}`);
  }

  async loadState(tenant: TenantContext, functionId: string): Promise<FunctionState> {
    const key = this.storageKey(tenant, functionId);
    return this.states.get(key) ?? { functionId, data: {}, version: 0, updatedAt: nowSecs() };
  }

  async saveState(tenant: TenantContext, state: FunctionState): Promise<void> {
    const key = this.storageKey(tenant, state.functionId);
    this.states.set(key, { ...state });
  }

  async clearState(tenant: TenantContext, functionId: string): Promise<void> {
    const key = this.storageKey(tenant, functionId);
    this.states.delete(key);
  }

  async listFunctions(tenant: TenantContext): Promise<string[]> {
    const prefix = `${tenant.tenantId.id}:fn:`;
    const result: string[] = [];
    for (const k of this.states.keys()) {
      if (k.startsWith(prefix)) {
        result.push(k.slice(prefix.length));
      }
    }
    return result;
  }
}
