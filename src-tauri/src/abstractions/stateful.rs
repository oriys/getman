use super::tenant::TenantContext;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

/// State container for a stateful function invocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionState {
    pub function_id: String,
    pub data: HashMap<String, serde_json::Value>,
    pub version: u64,
    pub updated_at: i64,
}

impl FunctionState {
    pub fn new(function_id: impl Into<String>) -> Self {
        Self {
            function_id: function_id.into(),
            data: HashMap::new(),
            version: 0,
            updated_at: chrono_now(),
        }
    }

    /// Get a value from the state.
    pub fn get(&self, key: &str) -> Option<&serde_json::Value> {
        self.data.get(key)
    }

    /// Set a value in the state and increment version.
    pub fn set(&mut self, key: impl Into<String>, value: serde_json::Value) {
        self.data.insert(key.into(), value);
        self.version += 1;
        self.updated_at = chrono_now();
    }

    /// Remove a value from the state.
    pub fn remove(&mut self, key: &str) -> Option<serde_json::Value> {
        let result = self.data.remove(key);
        if result.is_some() {
            self.version += 1;
            self.updated_at = chrono_now();
        }
        result
    }
}

/// Execution context for a stateful function.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionContext {
    pub tenant: TenantContext,
    pub invocation_id: String,
    pub function_id: String,
}

/// Abstract state store for stateful functions.
///
/// Provides persistent state that survives across function invocations.
pub trait StateStore: Send + Sync {
    /// Load the state for a function. Creates empty state if none exists.
    fn load_state(
        &self,
        tenant: &TenantContext,
        function_id: &str,
    ) -> Pin<Box<dyn Future<Output = Result<FunctionState, String>> + Send + '_>>;

    /// Save the state for a function.
    fn save_state(
        &self,
        tenant: &TenantContext,
        state: &FunctionState,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>>;

    /// Clear the state for a function.
    fn clear_state(
        &self,
        tenant: &TenantContext,
        function_id: &str,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>>;

    /// List all function IDs that have persisted state for a tenant.
    fn list_functions(
        &self,
        tenant: &TenantContext,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<String>, String>> + Send + '_>>;
}

/// In-memory state store implementation for local desktop use.
pub struct InMemoryStateStore {
    states: tokio::sync::RwLock<HashMap<String, FunctionState>>,
}

impl InMemoryStateStore {
    pub fn new() -> Self {
        Self {
            states: tokio::sync::RwLock::new(HashMap::new()),
        }
    }

    fn storage_key(tenant: &TenantContext, function_id: &str) -> String {
        tenant.scoped_key(&format!("fn:{function_id}"))
    }
}

impl Default for InMemoryStateStore {
    fn default() -> Self {
        Self::new()
    }
}

impl StateStore for InMemoryStateStore {
    fn load_state(
        &self,
        tenant: &TenantContext,
        function_id: &str,
    ) -> Pin<Box<dyn Future<Output = Result<FunctionState, String>> + Send + '_>> {
        let key = Self::storage_key(tenant, function_id);
        let function_id = function_id.to_string();
        Box::pin(async move {
            let store = self.states.read().await;
            Ok(store
                .get(&key)
                .cloned()
                .unwrap_or_else(|| FunctionState::new(function_id)))
        })
    }

    fn save_state(
        &self,
        tenant: &TenantContext,
        state: &FunctionState,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>> {
        let key = Self::storage_key(tenant, &state.function_id);
        let state = state.clone();
        Box::pin(async move {
            let mut store = self.states.write().await;
            store.insert(key, state);
            Ok(())
        })
    }

    fn clear_state(
        &self,
        tenant: &TenantContext,
        function_id: &str,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>> {
        let key = Self::storage_key(tenant, function_id);
        Box::pin(async move {
            let mut store = self.states.write().await;
            store.remove(&key);
            Ok(())
        })
    }

    fn list_functions(
        &self,
        tenant: &TenantContext,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<String>, String>> + Send + '_>> {
        let prefix = format!("{}:fn:", tenant.tenant_id);
        Box::pin(async move {
            let store = self.states.read().await;
            let ids: Vec<String> = store
                .keys()
                .filter(|k| k.starts_with(&prefix))
                .map(|k| k[prefix.len()..].to_string())
                .collect();
            Ok(ids)
        })
    }
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abstractions::tenant::TenantContext;

    #[test]
    fn test_function_state_get_set() {
        let mut state = FunctionState::new("my-fn");
        assert_eq!(state.version, 0);

        state.set("counter", serde_json::json!(1));
        assert_eq!(state.version, 1);
        assert_eq!(state.get("counter"), Some(&serde_json::json!(1)));

        state.set("counter", serde_json::json!(2));
        assert_eq!(state.version, 2);
    }

    #[test]
    fn test_function_state_remove() {
        let mut state = FunctionState::new("my-fn");
        state.set("key", serde_json::json!("value"));
        assert_eq!(state.version, 1);

        let removed = state.remove("key");
        assert!(removed.is_some());
        assert_eq!(state.version, 2);
        assert!(state.get("key").is_none());
    }

    #[tokio::test]
    async fn test_load_and_save_state() {
        let store = InMemoryStateStore::new();
        let tenant = TenantContext::new("t1", "T1");

        let mut state = store.load_state(&tenant, "fn-1").await.unwrap();
        assert_eq!(state.function_id, "fn-1");
        assert!(state.data.is_empty());

        state.set("runs", serde_json::json!(1));
        store.save_state(&tenant, &state).await.unwrap();

        let loaded = store.load_state(&tenant, "fn-1").await.unwrap();
        assert_eq!(loaded.get("runs"), Some(&serde_json::json!(1)));
    }

    #[tokio::test]
    async fn test_tenant_isolation() {
        let store = InMemoryStateStore::new();
        let t1 = TenantContext::new("t1", "T1");
        let t2 = TenantContext::new("t2", "T2");

        let mut s1 = FunctionState::new("fn-1");
        s1.set("owner", serde_json::json!("t1"));
        store.save_state(&t1, &s1).await.unwrap();

        let loaded = store.load_state(&t2, "fn-1").await.unwrap();
        assert!(loaded.data.is_empty()); // t2 should not see t1's state
    }

    #[tokio::test]
    async fn test_clear_state() {
        let store = InMemoryStateStore::new();
        let tenant = TenantContext::new("t1", "T1");

        let mut state = FunctionState::new("fn-1");
        state.set("data", serde_json::json!("value"));
        store.save_state(&tenant, &state).await.unwrap();

        store.clear_state(&tenant, "fn-1").await.unwrap();

        let loaded = store.load_state(&tenant, "fn-1").await.unwrap();
        assert!(loaded.data.is_empty());
    }

    #[tokio::test]
    async fn test_list_functions() {
        let store = InMemoryStateStore::new();
        let tenant = TenantContext::new("t1", "T1");

        for name in &["fn-a", "fn-b", "fn-c"] {
            let mut s = FunctionState::new(*name);
            s.set("active", serde_json::json!(true));
            store.save_state(&tenant, &s).await.unwrap();
        }

        let mut fns = store.list_functions(&tenant).await.unwrap();
        fns.sort();
        assert_eq!(fns, vec!["fn-a", "fn-b", "fn-c"]);
    }
}
