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

use serde::{Deserialize, Serialize};
use std::fmt::{self, Display};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuthType {
    None,
    BearerToken,
    BasicAuth,
    ApiKeyHeader,
    ApiKeyQuery,
}

impl AuthType {
    pub const ALL: [AuthType; 5] = [
        AuthType::None,
        AuthType::BearerToken,
        AuthType::BasicAuth,
        AuthType::ApiKeyHeader,
        AuthType::ApiKeyQuery,
    ];
}

impl Default for AuthType {
    fn default() -> Self {
        Self::None
    }
}

impl Display for AuthType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let label = match self {
            AuthType::None => "None",
            AuthType::BearerToken => "Bearer Token",
            AuthType::BasicAuth => "Basic Auth",
            AuthType::ApiKeyHeader => "API Key (Header)",
            AuthType::ApiKeyQuery => "API Key (Query)",
        };
        write!(f, "{label}")
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuthInput {
    pub auth_type: AuthType,
    pub bearer_token: String,
    pub basic_username: String,
    pub basic_password: String,
    pub api_key: String,
    pub api_value: String,
}
