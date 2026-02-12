use reqwest::header::{HeaderName, HeaderValue};
use std::time::Instant;

use crate::auth::AuthType;

use super::request::RequestInput;
use super::response::HttpResponse;

pub async fn send_request(request: RequestInput) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    let method: reqwest::Method = request.method.into();
    let mut url = reqwest::Url::parse(&request.url).map_err(|e| format!("Invalid URL: {e}"))?;

    {
        let mut query_pairs = url.query_pairs_mut();
        for (key, value) in parse_key_value_lines(&request.params, '=')? {
            query_pairs.append_pair(&key, &value);
        }

        if matches!(request.auth.auth_type, AuthType::ApiKeyQuery) {
            let key = request.auth.api_key.trim();
            if key.is_empty() {
                return Err("API key name cannot be empty".to_string());
            }
            query_pairs.append_pair(key, request.auth.api_value.trim());
        }
    }

    let mut req_builder = client.request(method, url);
    req_builder = apply_headers(req_builder, &request.headers)?;
    req_builder = apply_auth(req_builder, &request)?;

    let body = request.body.trim();
    if !body.is_empty() {
        req_builder = req_builder.body(body.to_string());
    }

    let started = Instant::now();
    let response = req_builder
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;
    let elapsed = started.elapsed().as_millis();

    let status = response.status();
    let headers = format_headers(response.headers());
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;
    let size_bytes = bytes.len();
    let body = String::from_utf8_lossy(&bytes).into_owned();

    Ok(HttpResponse {
        status: format!(
            "{} {}",
            status.as_u16(),
            status.canonical_reason().unwrap_or("Unknown")
        ),
        duration_ms: elapsed,
        size_bytes,
        headers,
        body,
    })
}

fn format_headers(headers: &reqwest::header::HeaderMap) -> String {
    let mut lines = Vec::new();
    for (name, value) in headers {
        let value = value.to_str().unwrap_or("<binary>");
        lines.push(format!("{name}: {value}"));
    }
    lines.join("\n")
}

fn parse_key_value_lines(input: &str, separator: char) -> Result<Vec<(String, String)>, String> {
    let mut pairs = Vec::new();

    for line in input.lines() {
        let raw = line.trim();
        if raw.is_empty() {
            continue;
        }

        let (key, value) = raw
            .split_once(separator)
            .ok_or_else(|| format!("Invalid key/value format: `{raw}`"))?;
        let key = key.trim();
        let value = value.trim();
        if key.is_empty() {
            return Err(format!("Key cannot be empty: `{raw}`"));
        }
        pairs.push((key.to_string(), value.to_string()));
    }

    Ok(pairs)
}

fn apply_headers(
    mut req_builder: reqwest::RequestBuilder,
    headers: &str,
) -> Result<reqwest::RequestBuilder, String> {
    for line in headers.lines() {
        let raw = line.trim();
        if raw.is_empty() {
            continue;
        }

        let (key, value) = raw
            .split_once(':')
            .ok_or_else(|| format!("Invalid header format: {raw}"))?;
        let key = key.trim();
        let value = value.trim();
        if key.is_empty() {
            return Err(format!("Header key is empty: {raw}"));
        }

        let header_name =
            HeaderName::from_bytes(key.as_bytes()).map_err(|e| format!("Invalid header key `{key}`: {e}"))?;
        let header_value =
            HeaderValue::from_str(value).map_err(|e| format!("Invalid header value `{value}`: {e}"))?;
        req_builder = req_builder.header(header_name, header_value);
    }

    Ok(req_builder)
}

fn apply_auth(
    mut req_builder: reqwest::RequestBuilder,
    request: &RequestInput,
) -> Result<reqwest::RequestBuilder, String> {
    match request.auth.auth_type {
        AuthType::None | AuthType::ApiKeyQuery => {}
        AuthType::BearerToken => {
            let token = request.auth.bearer_token.trim();
            if token.is_empty() {
                return Err("Bearer token cannot be empty".to_string());
            }
            req_builder = req_builder.bearer_auth(token);
        }
        AuthType::BasicAuth => {
            let username = request.auth.basic_username.trim();
            if username.is_empty() {
                return Err("Basic auth username cannot be empty".to_string());
            }
            req_builder = req_builder.basic_auth(username, Some(request.auth.basic_password.trim()));
        }
        AuthType::ApiKeyHeader => {
            let key = request.auth.api_key.trim();
            if key.is_empty() {
                return Err("API key name cannot be empty".to_string());
            }

            let header_name =
                HeaderName::from_bytes(key.as_bytes()).map_err(|e| format!("Invalid API key header `{key}`: {e}"))?;
            let header_value = HeaderValue::from_str(request.auth.api_value.trim())
                .map_err(|e| format!("Invalid API key header value: {e}"))?;
            req_builder = req_builder.header(header_name, header_value);
        }
    }

    Ok(req_builder)
}
