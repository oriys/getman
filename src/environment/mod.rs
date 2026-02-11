#![allow(dead_code)]
//! # Environment & Variables System (Phase 2)
//!
//! Provides a variable system with support for global, environment, and
//! collection-scoped variables. Supports `{{variable}}` interpolation and
//! multi-environment switching (dev / staging / prod).
//!
//! ## Planned Features
//! - Global variables, environment variables, collection variables
//! - `{{variable}}` interpolation and preview
//! - Multi-environment switching (dev / staging / prod)

use std::collections::HashMap;

/// Scope at which a variable is defined.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VariableScope {
    Global,
    Environment,
    Collection,
}

/// A single variable entry.
#[derive(Debug, Clone)]
pub struct Variable {
    pub key: String,
    pub value: String,
    pub scope: VariableScope,
    pub enabled: bool,
}

/// An environment is a named set of variables (e.g. dev, staging, prod).
#[derive(Debug, Clone)]
pub struct Environment {
    pub name: String,
    pub variables: Vec<Variable>,
}

/// Manages all environments and resolves variables.
#[derive(Debug, Clone, Default)]
pub struct EnvironmentManager {
    pub globals: Vec<Variable>,
    pub environments: Vec<Environment>,
    pub active_environment: Option<String>,
}

impl EnvironmentManager {
    /// Resolve all variables into a flat map, respecting scope precedence:
    /// collection < environment < global (higher scope overrides lower).
    pub fn resolve(&self, collection_vars: &HashMap<String, String>) -> HashMap<String, String> {
        let mut resolved: HashMap<String, String> = collection_vars.clone();

        if let Some(active_name) = &self.active_environment {
            if let Some(env) = self.environments.iter().find(|e| &e.name == active_name) {
                for var in &env.variables {
                    if var.enabled {
                        resolved.insert(var.key.clone(), var.value.clone());
                    }
                }
            }
        }

        for var in &self.globals {
            if var.enabled {
                resolved.insert(var.key.clone(), var.value.clone());
            }
        }

        resolved
    }

    /// Interpolate `{{variable}}` placeholders in the given text.
    pub fn interpolate(&self, text: &str, variables: &HashMap<String, String>) -> String {
        let mut result = text.to_string();
        for (key, value) in variables {
            let placeholder = format!("{{{{{}}}}}", key);
            result = result.replace(&placeholder, value);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_collection_vars_only() {
        let mgr = EnvironmentManager::default();
        let mut collection = HashMap::new();
        collection.insert("host".into(), "localhost".into());

        let resolved = mgr.resolve(&collection);
        assert_eq!(resolved.get("host").unwrap(), "localhost");
    }

    #[test]
    fn resolve_env_overrides_collection() {
        let mgr = EnvironmentManager {
            globals: vec![],
            environments: vec![Environment {
                name: "dev".into(),
                variables: vec![Variable {
                    key: "host".into(),
                    value: "dev.example.com".into(),
                    scope: VariableScope::Environment,
                    enabled: true,
                }],
            }],
            active_environment: Some("dev".into()),
        };

        let mut collection = HashMap::new();
        collection.insert("host".into(), "localhost".into());

        let resolved = mgr.resolve(&collection);
        assert_eq!(resolved.get("host").unwrap(), "dev.example.com");
    }

    #[test]
    fn resolve_global_overrides_env() {
        let mgr = EnvironmentManager {
            globals: vec![Variable {
                key: "host".into(),
                value: "global.example.com".into(),
                scope: VariableScope::Global,
                enabled: true,
            }],
            environments: vec![Environment {
                name: "dev".into(),
                variables: vec![Variable {
                    key: "host".into(),
                    value: "dev.example.com".into(),
                    scope: VariableScope::Environment,
                    enabled: true,
                }],
            }],
            active_environment: Some("dev".into()),
        };

        let resolved = mgr.resolve(&HashMap::new());
        assert_eq!(resolved.get("host").unwrap(), "global.example.com");
    }

    #[test]
    fn resolve_disabled_vars_ignored() {
        let mgr = EnvironmentManager {
            globals: vec![Variable {
                key: "secret".into(),
                value: "hidden".into(),
                scope: VariableScope::Global,
                enabled: false,
            }],
            ..Default::default()
        };

        let resolved = mgr.resolve(&HashMap::new());
        assert!(resolved.get("secret").is_none());
    }

    #[test]
    fn interpolate_replaces_placeholders() {
        let mgr = EnvironmentManager::default();
        let mut vars = HashMap::new();
        vars.insert("host".into(), "api.example.com".into());
        vars.insert("port".into(), "8080".into());

        let result = mgr.interpolate("https://{{host}}:{{port}}/api", &vars);
        assert_eq!(result, "https://api.example.com:8080/api");
    }

    #[test]
    fn interpolate_leaves_unknown_placeholders() {
        let mgr = EnvironmentManager::default();
        let vars = HashMap::new();

        let result = mgr.interpolate("{{unknown}}", &vars);
        assert_eq!(result, "{{unknown}}");
    }
}
