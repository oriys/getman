use reqwest::header::{HeaderName, HeaderValue};
use std::time::Instant;

use super::request::RequestInput;
use super::response::HttpResponse;

pub async fn send_request(request: RequestInput) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    let method: reqwest::Method = request.method.into();

    let mut req_builder = client.request(method, &request.url);
    for line in request.headers.lines() {
        let raw = line.trim();
        if raw.is_empty() {
            continue;
        }

        let (key, value) = raw
            .split_once(':')
            .ok_or_else(|| format!("Header 格式错误: {raw}"))?;
        let key = key.trim();
        let value = value.trim();
        if key.is_empty() {
            return Err(format!("Header key 为空: {raw}"));
        }

        let header_name = HeaderName::from_bytes(key.as_bytes())
            .map_err(|e| format!("无效 Header key `{key}`: {e}"))?;
        let header_value = HeaderValue::from_str(value)
            .map_err(|e| format!("无效 Header value `{value}`: {e}"))?;
        req_builder = req_builder.header(header_name, header_value);
    }

    let body = request.body.trim();
    if !body.is_empty() {
        req_builder = req_builder.body(body.to_string());
    }

    let started = Instant::now();
    let response = req_builder
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    let elapsed = started.elapsed().as_millis();

    let status = response.status();
    let headers = format_headers(response.headers());
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;
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
