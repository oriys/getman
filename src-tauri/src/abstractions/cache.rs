use super::tenant::TenantContext;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

/// Options for cache set operations.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CacheOptions {
    /// Time-to-live in seconds. None means no expiration.
    #[serde(default)]
    pub ttl_secs: Option<u64>,
}

/// Abstract cache trait for pluggable caching backends.
///
/// All operations are scoped to a tenant context for isolation.
pub trait Cache: Send + Sync {
    /// Get a value by key.
    fn get(
        &self,
        tenant: &TenantContext,
        key: &str,
    ) -> Pin<Box<dyn Future<Output = Result<Option<String>, String>> + Send + '_>>;

    /// Set a value with optional TTL.
    fn set(
        &self,
        tenant: &TenantContext,
        key: &str,
        value: &str,
        options: CacheOptions,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>>;

    /// Delete a value by key.
    fn delete(
        &self,
        tenant: &TenantContext,
        key: &str,
    ) -> Pin<Box<dyn Future<Output = Result<bool, String>> + Send + '_>>;

    /// Check if a key exists.
    fn exists(
        &self,
        tenant: &TenantContext,
        key: &str,
    ) -> Pin<Box<dyn Future<Output = Result<bool, String>> + Send + '_>>;

    /// Clear all keys for a tenant.
    fn clear(
        &self,
        tenant: &TenantContext,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>>;
}

/// Internal cache entry with optional expiration.
struct CacheEntry {
    value: String,
    expires_at: Option<u64>,
}

impl CacheEntry {
    fn is_expired(&self) -> bool {
        match self.expires_at {
            Some(exp) => now_secs() >= exp,
            None => false,
        }
    }
}

/// In-memory cache implementation for local desktop use.
pub struct InMemoryCache {
    data: tokio::sync::RwLock<HashMap<String, CacheEntry>>,
}

impl InMemoryCache {
    pub fn new() -> Self {
        Self {
            data: tokio::sync::RwLock::new(HashMap::new()),
        }
    }

    fn scoped_key(tenant: &TenantContext, key: &str) -> String {
        tenant.scoped_key(key)
    }
}

impl Default for InMemoryCache {
    fn default() -> Self {
        Self::new()
    }
}

impl Cache for InMemoryCache {
    fn get(
        &self,
        tenant: &TenantContext,
        key: &str,
    ) -> Pin<Box<dyn Future<Output = Result<Option<String>, String>> + Send + '_>> {
        let scoped = Self::scoped_key(tenant, key);
        Box::pin(async move {
            let store = self.data.read().await;
            match store.get(&scoped) {
                Some(entry) if !entry.is_expired() => Ok(Some(entry.value.clone())),
                _ => Ok(None),
            }
        })
    }

    fn set(
        &self,
        tenant: &TenantContext,
        key: &str,
        value: &str,
        options: CacheOptions,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>> {
        let scoped = Self::scoped_key(tenant, key);
        let value = value.to_string();
        Box::pin(async move {
            let expires_at = options.ttl_secs.map(|ttl| now_secs() + ttl);
            let entry = CacheEntry { value, expires_at };
            let mut store = self.data.write().await;
            store.insert(scoped, entry);
            Ok(())
        })
    }

    fn delete(
        &self,
        tenant: &TenantContext,
        key: &str,
    ) -> Pin<Box<dyn Future<Output = Result<bool, String>> + Send + '_>> {
        let scoped = Self::scoped_key(tenant, key);
        Box::pin(async move {
            let mut store = self.data.write().await;
            Ok(store.remove(&scoped).is_some())
        })
    }

    fn exists(
        &self,
        tenant: &TenantContext,
        key: &str,
    ) -> Pin<Box<dyn Future<Output = Result<bool, String>> + Send + '_>> {
        let scoped = Self::scoped_key(tenant, key);
        Box::pin(async move {
            let store = self.data.read().await;
            Ok(matches!(store.get(&scoped), Some(e) if !e.is_expired()))
        })
    }

    fn clear(
        &self,
        tenant: &TenantContext,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>> {
        let prefix = format!("{}:", tenant.tenant_id);
        Box::pin(async move {
            let mut store = self.data.write().await;
            store.retain(|k, _| !k.starts_with(&prefix));
            Ok(())
        })
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abstractions::tenant::TenantContext;

    #[tokio::test]
    async fn test_set_and_get() {
        let cache = InMemoryCache::new();
        let tenant = TenantContext::new("t1", "T1");

        cache.set(&tenant, "key1", "value1", CacheOptions::default()).await.unwrap();
        let val = cache.get(&tenant, "key1").await.unwrap();
        assert_eq!(val, Some("value1".to_string()));
    }

    #[tokio::test]
    async fn test_tenant_isolation() {
        let cache = InMemoryCache::new();
        let t1 = TenantContext::new("t1", "T1");
        let t2 = TenantContext::new("t2", "T2");

        cache.set(&t1, "key", "val-t1", CacheOptions::default()).await.unwrap();
        cache.set(&t2, "key", "val-t2", CacheOptions::default()).await.unwrap();

        assert_eq!(cache.get(&t1, "key").await.unwrap(), Some("val-t1".to_string()));
        assert_eq!(cache.get(&t2, "key").await.unwrap(), Some("val-t2".to_string()));
    }

    #[tokio::test]
    async fn test_delete() {
        let cache = InMemoryCache::new();
        let tenant = TenantContext::new("t1", "T1");

        cache.set(&tenant, "key1", "v", CacheOptions::default()).await.unwrap();
        assert!(cache.delete(&tenant, "key1").await.unwrap());
        assert_eq!(cache.get(&tenant, "key1").await.unwrap(), None);
    }

    #[tokio::test]
    async fn test_exists() {
        let cache = InMemoryCache::new();
        let tenant = TenantContext::new("t1", "T1");

        assert!(!cache.exists(&tenant, "key1").await.unwrap());
        cache.set(&tenant, "key1", "v", CacheOptions::default()).await.unwrap();
        assert!(cache.exists(&tenant, "key1").await.unwrap());
    }

    #[tokio::test]
    async fn test_clear() {
        let cache = InMemoryCache::new();
        let t1 = TenantContext::new("t1", "T1");
        let t2 = TenantContext::new("t2", "T2");

        cache.set(&t1, "a", "1", CacheOptions::default()).await.unwrap();
        cache.set(&t1, "b", "2", CacheOptions::default()).await.unwrap();
        cache.set(&t2, "a", "3", CacheOptions::default()).await.unwrap();

        cache.clear(&t1).await.unwrap();

        assert_eq!(cache.get(&t1, "a").await.unwrap(), None);
        assert_eq!(cache.get(&t1, "b").await.unwrap(), None);
        // t2 data should remain
        assert_eq!(cache.get(&t2, "a").await.unwrap(), Some("3".to_string()));
    }
}
