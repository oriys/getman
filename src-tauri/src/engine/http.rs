use crate::domain::{SendRequestPayload, SendResponsePayload};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use reqwest::{Client, Method, Proxy};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

pub fn error_response(message: impl Into<String>) -> SendResponsePayload {
    SendResponsePayload {
        status: 0,
        status_text: "Error".into(),
        headers: HashMap::new(),
        body: message.into(),
        time: 0,
        size: 0,
        content_type: "text/plain".into(),
    }
}

pub fn build_headers(input: &HashMap<String, String>) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();

    for (key, value) in input {
        if key.is_empty() {
            continue;
        }

        let header_name = HeaderName::from_bytes(key.as_bytes())
            .map_err(|err| format!("Invalid header name `{key}`: {err}"))?;
        let header_value = HeaderValue::from_str(value)
            .map_err(|err| format!("Invalid header value for `{key}`: {err}"))?;
        headers.insert(header_name, header_value);
    }

    Ok(headers)
}

pub async fn send_http_request_impl(
    payload: SendRequestPayload,
    cancel_rx: &mut broadcast::Receiver<()>,
) -> Result<SendResponsePayload, String> {
    let method = Method::from_bytes(payload.method.as_bytes())
        .map_err(|err| format!("Invalid HTTP method: {err}"))?;

    let headers = build_headers(&payload.headers)?;

    let mut builder = Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10));

    // Timeout
    if let Some(ms) = payload.timeout_ms {
        if ms > 0 {
            builder = builder.timeout(Duration::from_millis(ms));
        }
    }

    // Proxy
    if let Some(ref proxy_url) = payload.proxy_url {
        if !proxy_url.is_empty() {
            let proxy = Proxy::all(proxy_url)
                .map_err(|err| format!("Invalid proxy URL: {err}"))?;
            builder = builder.proxy(proxy);
        }
    }

    // SSL verification
    if !payload.verify_ssl {
        builder = builder.danger_accept_invalid_certs(true);
    }

    let client = builder
        .build()
        .map_err(|err| format!("Failed to build HTTP client: {err}"))?;

    let max_retries = payload.retry_count.unwrap_or(0);
    let retry_delay = payload.retry_delay_ms.unwrap_or(1000);

    let mut last_error: Option<String> = None;

    for attempt in 0..=max_retries {
        if attempt > 0 {
            // Check cancellation before retry delay
            let delay = tokio::time::sleep(Duration::from_millis(retry_delay));
            tokio::select! {
                _ = delay => {},
                _ = cancel_rx.recv() => {
                    return Err("Request cancelled".into());
                }
            }
        }

        let mut request = client
            .request(method.clone(), &payload.url)
            .headers(headers.clone());

        if payload.body.is_some()
            && !matches!(method, Method::GET | Method::HEAD | Method::OPTIONS)
        {
            if let Some(ref body) = payload.body {
                request = request.body(body.clone());
            }
        }

        let start = Instant::now();

        let result = tokio::select! {
            res = request.send() => res,
            _ = cancel_rx.recv() => {
                return Err("Request cancelled".into());
            }
        };

        match result {
            Ok(response) => {
                let elapsed = start.elapsed().as_millis() as u64;
                let status = response.status();
                let status_text =
                    status.canonical_reason().unwrap_or("Unknown").to_string();

                let mut response_headers = HashMap::new();
                for (key, value) in response.headers() {
                    response_headers.insert(
                        key.to_string(),
                        value.to_str().unwrap_or_default().to_string(),
                    );
                }

                let content_type = response
                    .headers()
                    .get(CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("text/plain")
                    .to_string();

                let bytes = response
                    .bytes()
                    .await
                    .map_err(|err| format!("Failed to read response: {err}"))?;

                let body = String::from_utf8_lossy(&bytes).to_string();

                return Ok(SendResponsePayload {
                    status: status.as_u16(),
                    status_text,
                    headers: response_headers,
                    body,
                    time: elapsed,
                    size: bytes.len() as u64,
                    content_type,
                });
            }
            Err(err) => {
                last_error = Some(format!("Request failed: {err}"));
                // Retry on connection errors or timeouts
                if attempt < max_retries {
                    continue;
                }
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "Request failed".into()))
}
