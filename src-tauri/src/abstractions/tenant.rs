use serde::{Deserialize, Serialize};

/// Represents a tenant in the system.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct TenantId(pub String);

impl TenantId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for TenantId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Tenant context carried through operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantContext {
    pub tenant_id: TenantId,
    pub tenant_name: String,
    pub metadata: std::collections::HashMap<String, String>,
}

impl TenantContext {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            tenant_id: TenantId::new(id),
            tenant_name: name.into(),
            metadata: std::collections::HashMap::new(),
        }
    }

    pub fn with_metadata(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.metadata.insert(key.into(), value.into());
        self
    }

    /// Build a namespaced key for tenant-scoped storage.
    pub fn scoped_key(&self, key: &str) -> String {
        format!("{}:{}", self.tenant_id, key)
    }
}

/// Default tenant for single-user / local desktop mode.
pub fn default_tenant() -> TenantContext {
    TenantContext::new("default", "Default Tenant")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tenant_id_display() {
        let id = TenantId::new("org-123");
        assert_eq!(id.to_string(), "org-123");
        assert_eq!(id.as_str(), "org-123");
    }

    #[test]
    fn test_scoped_key() {
        let ctx = TenantContext::new("tenant-1", "Tenant One");
        assert_eq!(ctx.scoped_key("app_state"), "tenant-1:app_state");
    }

    #[test]
    fn test_default_tenant() {
        let t = default_tenant();
        assert_eq!(t.tenant_id.as_str(), "default");
    }

    #[test]
    fn test_with_metadata() {
        let ctx = TenantContext::new("t1", "T1")
            .with_metadata("plan", "enterprise");
        assert_eq!(ctx.metadata.get("plan").unwrap(), "enterprise");
    }
}
