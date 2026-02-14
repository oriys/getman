use super::tenant::TenantContext;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

/// A single record in the abstract database.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub collection: String,
    pub data: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Filter operators for querying.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterOp {
    Eq(serde_json::Value),
    Neq(serde_json::Value),
    Gt(serde_json::Value),
    Lt(serde_json::Value),
    Contains(String),
    In(Vec<serde_json::Value>),
}

/// A single filter condition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub field: String,
    pub op: FilterOp,
}

/// Query parameters for listing records.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    #[serde(default)]
    pub filters: Vec<Filter>,
    #[serde(default)]
    pub order_by: Option<String>,
    #[serde(default)]
    pub ascending: bool,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub offset: Option<usize>,
}

/// Result of a list query.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub records: Vec<Record>,
    pub total: usize,
}

/// Abstract database trait for pluggable storage backends.
///
/// All operations are scoped to a tenant context for isolation.
pub trait Database: Send + Sync {
    /// Insert a new record into a collection.
    fn insert(
        &self,
        tenant: &TenantContext,
        collection: &str,
        id: &str,
        data: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<Record, String>> + Send + '_>>;

    /// Get a record by ID from a collection.
    fn get(
        &self,
        tenant: &TenantContext,
        collection: &str,
        id: &str,
    ) -> Pin<Box<dyn Future<Output = Result<Option<Record>, String>> + Send + '_>>;

    /// Update an existing record.
    fn update(
        &self,
        tenant: &TenantContext,
        collection: &str,
        id: &str,
        data: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<Record, String>> + Send + '_>>;

    /// Delete a record by ID.
    fn delete(
        &self,
        tenant: &TenantContext,
        collection: &str,
        id: &str,
    ) -> Pin<Box<dyn Future<Output = Result<bool, String>> + Send + '_>>;

    /// List records with optional filtering, sorting, and pagination.
    fn list(
        &self,
        tenant: &TenantContext,
        collection: &str,
        query: Query,
    ) -> Pin<Box<dyn Future<Output = Result<QueryResult, String>> + Send + '_>>;
}

/// In-memory database implementation for testing and local desktop use.
pub struct InMemoryDatabase {
    data: tokio::sync::RwLock<HashMap<String, HashMap<String, Record>>>,
}

impl InMemoryDatabase {
    pub fn new() -> Self {
        Self {
            data: tokio::sync::RwLock::new(HashMap::new()),
        }
    }

    fn storage_key(tenant: &TenantContext, collection: &str) -> String {
        tenant.scoped_key(collection)
    }
}

impl Default for InMemoryDatabase {
    fn default() -> Self {
        Self::new()
    }
}

impl Database for InMemoryDatabase {
    fn insert(
        &self,
        tenant: &TenantContext,
        collection: &str,
        id: &str,
        data: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<Record, String>> + Send + '_>> {
        let key = Self::storage_key(tenant, collection);
        let collection = collection.to_string();
        let id = id.to_string();
        Box::pin(async move {
            let now = chrono_now();
            let record = Record {
                id: id.clone(),
                collection: collection.clone(),
                data,
                created_at: now,
                updated_at: now,
            };
            let mut store = self.data.write().await;
            let bucket = store.entry(key).or_default();
            bucket.insert(id, record.clone());
            Ok(record)
        })
    }

    fn get(
        &self,
        tenant: &TenantContext,
        collection: &str,
        id: &str,
    ) -> Pin<Box<dyn Future<Output = Result<Option<Record>, String>> + Send + '_>> {
        let key = Self::storage_key(tenant, collection);
        let id = id.to_string();
        Box::pin(async move {
            let store = self.data.read().await;
            Ok(store.get(&key).and_then(|b| b.get(&id)).cloned())
        })
    }

    fn update(
        &self,
        tenant: &TenantContext,
        collection: &str,
        id: &str,
        data: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<Record, String>> + Send + '_>> {
        let key = Self::storage_key(tenant, collection);
        let id = id.to_string();
        Box::pin(async move {
            let mut store = self.data.write().await;
            let bucket = store.entry(key).or_default();
            match bucket.get_mut(&id) {
                Some(record) => {
                    record.data = data;
                    record.updated_at = chrono_now();
                    Ok(record.clone())
                }
                None => Err(format!("Record not found: {id}")),
            }
        })
    }

    fn delete(
        &self,
        tenant: &TenantContext,
        collection: &str,
        id: &str,
    ) -> Pin<Box<dyn Future<Output = Result<bool, String>> + Send + '_>> {
        let key = Self::storage_key(tenant, collection);
        let id = id.to_string();
        Box::pin(async move {
            let mut store = self.data.write().await;
            Ok(store
                .get_mut(&key)
                .map(|b| b.remove(&id).is_some())
                .unwrap_or(false))
        })
    }

    fn list(
        &self,
        tenant: &TenantContext,
        collection: &str,
        query: Query,
    ) -> Pin<Box<dyn Future<Output = Result<QueryResult, String>> + Send + '_>> {
        let key = Self::storage_key(tenant, collection);
        Box::pin(async move {
            let store = self.data.read().await;
            let records: Vec<Record> = store
                .get(&key)
                .map(|b| b.values().cloned().collect())
                .unwrap_or_default();

            let total = records.len();
            let offset = query.offset.unwrap_or(0);
            let limit = query.limit.unwrap_or(total);
            let page: Vec<Record> = records.into_iter().skip(offset).take(limit).collect();

            Ok(QueryResult {
                records: page,
                total,
            })
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

    #[tokio::test]
    async fn test_insert_and_get() {
        let db = InMemoryDatabase::new();
        let tenant = TenantContext::new("t1", "Tenant 1");
        let data = serde_json::json!({"name": "test"});

        let record = db.insert(&tenant, "items", "1", data.clone()).await.unwrap();
        assert_eq!(record.id, "1");
        assert_eq!(record.data, data);

        let fetched = db.get(&tenant, "items", "1").await.unwrap();
        assert!(fetched.is_some());
        assert_eq!(fetched.unwrap().data, data);
    }

    #[tokio::test]
    async fn test_tenant_isolation() {
        let db = InMemoryDatabase::new();
        let t1 = TenantContext::new("t1", "Tenant 1");
        let t2 = TenantContext::new("t2", "Tenant 2");

        db.insert(&t1, "items", "1", serde_json::json!({"owner": "t1"})).await.unwrap();
        db.insert(&t2, "items", "1", serde_json::json!({"owner": "t2"})).await.unwrap();

        let r1 = db.get(&t1, "items", "1").await.unwrap().unwrap();
        let r2 = db.get(&t2, "items", "1").await.unwrap().unwrap();

        assert_eq!(r1.data["owner"], "t1");
        assert_eq!(r2.data["owner"], "t2");
    }

    #[tokio::test]
    async fn test_update_and_delete() {
        let db = InMemoryDatabase::new();
        let tenant = TenantContext::new("t1", "T1");

        db.insert(&tenant, "items", "1", serde_json::json!({"v": 1})).await.unwrap();

        let updated = db.update(&tenant, "items", "1", serde_json::json!({"v": 2})).await.unwrap();
        assert_eq!(updated.data["v"], 2);

        let deleted = db.delete(&tenant, "items", "1").await.unwrap();
        assert!(deleted);

        let fetched = db.get(&tenant, "items", "1").await.unwrap();
        assert!(fetched.is_none());
    }

    #[tokio::test]
    async fn test_list_with_pagination() {
        let db = InMemoryDatabase::new();
        let tenant = TenantContext::new("t1", "T1");

        for i in 0..5 {
            db.insert(&tenant, "items", &i.to_string(), serde_json::json!({"i": i})).await.unwrap();
        }

        let result = db.list(&tenant, "items", Query {
            limit: Some(2),
            offset: Some(1),
            ..Default::default()
        }).await.unwrap();

        assert_eq!(result.total, 5);
        assert_eq!(result.records.len(), 2);
    }
}
