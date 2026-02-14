use crate::domain::{EnvVariable, Environment, ResolvedRequest, ResolveRequestPayload};
use std::collections::HashMap;

/// Interpolate `{{key}}` placeholders in a string using the provided variable map.
fn interpolate(input: &str, variables: &HashMap<String, String>) -> String {
    let mut result = input.to_string();
    for (key, value) in variables {
        result = result.replace(&format!("{{{{{key}}}}}"), value);
    }
    result
}

/// Build a merged variable map from global variables and environment variables.
/// Priority: environment variables override global variables.
pub fn build_variable_map(
    global_variables: &[EnvVariable],
    environment: Option<&Environment>,
) -> HashMap<String, String> {
    let mut variables = HashMap::new();

    // 1. Global variables (lowest priority)
    for v in global_variables {
        if v.enabled && !v.key.is_empty() {
            variables.insert(v.key.clone(), v.value.clone());
        }
    }

    // 2. Environment variables (override globals)
    if let Some(env) = environment {
        for v in &env.variables {
            if v.enabled && !v.key.is_empty() {
                variables.insert(v.key.clone(), v.value.clone());
            }
        }
    }

    variables
}

/// Resolve all `{{var}}` placeholders in a request payload.
pub fn resolve_request(
    payload: &ResolveRequestPayload,
    global_variables: &[EnvVariable],
    environments: &[Environment],
) -> ResolvedRequest {
    let env = payload
        .environment_id
        .as_ref()
        .and_then(|id| environments.iter().find(|e| e.id == *id));

    let variables = build_variable_map(global_variables, env);

    let url = interpolate(&payload.url, &variables);
    let method = payload.method.clone();

    let headers: HashMap<String, String> = payload
        .headers
        .iter()
        .map(|(k, v)| (interpolate(k, &variables), interpolate(v, &variables)))
        .collect();

    let body = payload
        .body
        .as_ref()
        .map(|b| interpolate(b, &variables));

    ResolvedRequest {
        url,
        method,
        headers,
        body,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_var(key: &str, value: &str) -> EnvVariable {
        EnvVariable {
            id: key.to_string(),
            key: key.to_string(),
            value: value.to_string(),
            enabled: true,
        }
    }

    #[test]
    fn test_interpolate_basic() {
        let mut vars = HashMap::new();
        vars.insert("host".to_string(), "example.com".to_string());
        vars.insert("port".to_string(), "8080".to_string());

        let result = interpolate("https://{{host}}:{{port}}/api", &vars);
        assert_eq!(result, "https://example.com:8080/api");
    }

    #[test]
    fn test_interpolate_no_match() {
        let vars = HashMap::new();
        let result = interpolate("https://example.com/api", &vars);
        assert_eq!(result, "https://example.com/api");
    }

    #[test]
    fn test_interpolate_unresolved_vars() {
        let vars = HashMap::new();
        let result = interpolate("https://{{host}}/api", &vars);
        assert_eq!(result, "https://{{host}}/api");
    }

    #[test]
    fn test_build_variable_map_global_only() {
        let globals = vec![
            make_var("host", "global.example.com"),
            make_var("token", "abc123"),
        ];
        let map = build_variable_map(&globals, None);
        assert_eq!(map.get("host").unwrap(), "global.example.com");
        assert_eq!(map.get("token").unwrap(), "abc123");
    }

    #[test]
    fn test_build_variable_map_env_overrides_global() {
        let globals = vec![
            make_var("host", "global.example.com"),
            make_var("token", "global-token"),
        ];
        let env = Environment {
            id: "env1".to_string(),
            name: "dev".to_string(),
            variables: vec![make_var("host", "dev.example.com")],
        };
        let map = build_variable_map(&globals, Some(&env));
        assert_eq!(map.get("host").unwrap(), "dev.example.com");
        assert_eq!(map.get("token").unwrap(), "global-token");
    }

    #[test]
    fn test_build_variable_map_disabled_vars_excluded() {
        let globals = vec![EnvVariable {
            id: "1".to_string(),
            key: "host".to_string(),
            value: "example.com".to_string(),
            enabled: false,
        }];
        let map = build_variable_map(&globals, None);
        assert!(map.get("host").is_none());
    }

    #[test]
    fn test_resolve_request_full() {
        let globals = vec![
            make_var("base_url", "https://api.example.com"),
            make_var("auth_token", "global-token"),
        ];
        let envs = vec![Environment {
            id: "env1".to_string(),
            name: "staging".to_string(),
            variables: vec![make_var("auth_token", "staging-token")],
        }];

        let mut headers = HashMap::new();
        headers.insert(
            "Authorization".to_string(),
            "Bearer {{auth_token}}".to_string(),
        );

        let payload = ResolveRequestPayload {
            url: "{{base_url}}/users".to_string(),
            method: "GET".to_string(),
            headers,
            body: Some("{\"key\": \"{{auth_token}}\"}".to_string()),
            environment_id: Some("env1".to_string()),
        };

        let resolved = resolve_request(&payload, &globals, &envs);
        assert_eq!(resolved.url, "https://api.example.com/users");
        assert_eq!(
            resolved.headers.get("Authorization").unwrap(),
            "Bearer staging-token"
        );
        assert_eq!(
            resolved.body.unwrap(),
            "{\"key\": \"staging-token\"}"
        );
    }
}
