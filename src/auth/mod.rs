#![allow(dead_code)]
//! # Authentication (Phase 2)
//!
//! Provides authentication methods for HTTP requests including Bearer Token,
//! Basic Auth, API Key, and OAuth2 flows.
//!
//! ## Planned Features
//! - Bearer Token
//! - Basic Auth
//! - API Key (Header / Query)
//! - OAuth2 (Authorization Code flow)

/// Supported authentication methods.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthMethod {
    None,
    BearerToken {
        token: String,
    },
    BasicAuth {
        username: String,
        password: String,
    },
    ApiKey {
        key: String,
        value: String,
        location: ApiKeyLocation,
    },
    OAuth2 {
        client_id: String,
        client_secret: String,
        auth_url: String,
        token_url: String,
        scope: String,
    },
}

/// Where to place the API key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApiKeyLocation {
    Header,
    Query,
}

impl Default for AuthMethod {
    fn default() -> Self {
        AuthMethod::None
    }
}
