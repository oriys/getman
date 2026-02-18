use crate::domain::{SendRequestPayload, SendResponsePayload};
use base64::prelude::{Engine as _, BASE64_STANDARD};
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE, WWW_AUTHENTICATE,
};
use reqwest::{Client, Method, Proxy, Response, StatusCode};
use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
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

fn split_challenge_pairs(value: &str) -> Vec<String> {
    let mut pairs = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut escaped = false;

    for ch in value.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }

        match ch {
            '\\' if in_quotes => {
                current.push(ch);
                escaped = true;
            }
            '"' => {
                in_quotes = !in_quotes;
                current.push(ch);
            }
            ',' if !in_quotes => {
                let segment = current.trim();
                if !segment.is_empty() {
                    pairs.push(segment.to_string());
                }
                current.clear();
            }
            _ => current.push(ch),
        }
    }

    let segment = current.trim();
    if !segment.is_empty() {
        pairs.push(segment.to_string());
    }

    pairs
}

fn parse_digest_challenge(value: &str) -> Option<HashMap<String, String>> {
    let trimmed = value.trim();
    if !trimmed.to_ascii_lowercase().starts_with("digest ") {
        return None;
    }

    let payload = trimmed
        .split_once(' ')
        .map(|(_, rest)| rest.trim())
        .unwrap_or_default();
    if payload.is_empty() {
        return None;
    }

    let mut challenge = HashMap::new();
    for segment in split_challenge_pairs(payload) {
        let Some((key, raw_value)) = segment.split_once('=') else {
            continue;
        };

        let key = key.trim().to_ascii_lowercase();
        if key.is_empty() {
            continue;
        }

        let mut parsed_value = raw_value.trim().to_string();
        if parsed_value.starts_with('"') && parsed_value.ends_with('"') && parsed_value.len() >= 2
        {
            parsed_value = parsed_value[1..parsed_value.len() - 1].to_string();
        }
        challenge.insert(key, parsed_value);
    }

    if challenge.is_empty() {
        None
    } else {
        Some(challenge)
    }
}

fn extract_digest_challenge(headers: &HeaderMap) -> Option<HashMap<String, String>> {
    for value in headers.get_all(WWW_AUTHENTICATE).iter() {
        let Ok(text) = value.to_str() else {
            continue;
        };

        for line in text.split('\n') {
            if let Some(challenge) = parse_digest_challenge(line) {
                return Some(challenge);
            }
        }
    }

    None
}

fn md5_hex(value: &str) -> String {
    format!("{:x}", md5::compute(value.as_bytes()))
}

fn escape_digest_value(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn build_digest_authorization(
    method: &Method,
    url: &str,
    username: &str,
    password: &str,
    challenge: &HashMap<String, String>,
) -> Result<String, String> {
    let realm = challenge
        .get("realm")
        .cloned()
        .ok_or_else(|| "Digest challenge missing realm".to_string())?;
    let nonce = challenge
        .get("nonce")
        .cloned()
        .ok_or_else(|| "Digest challenge missing nonce".to_string())?;

    let algorithm = challenge
        .get("algorithm")
        .map(|value| value.trim().to_ascii_uppercase())
        .unwrap_or_else(|| "MD5".to_string());
    if algorithm != "MD5" {
        return Err(format!("Unsupported Digest algorithm: {algorithm}"));
    }

    let parsed_url = reqwest::Url::parse(url)
        .map_err(|err| format!("Invalid URL for Digest auth: {err}"))?;
    let mut uri = parsed_url.path().to_string();
    if uri.is_empty() {
        uri.push('/');
    }
    if let Some(query) = parsed_url.query() {
        uri.push('?');
        uri.push_str(query);
    }

    let method_upper = method.as_str().to_uppercase();
    let ha1 = md5_hex(&format!("{username}:{realm}:{password}"));
    let ha2 = md5_hex(&format!("{method_upper}:{uri}"));

    let qop_auth = challenge
        .get("qop")
        .map(|qop| {
            qop.split(',')
                .any(|entry| entry.trim().eq_ignore_ascii_case("auth"))
        })
        .unwrap_or(false);

    let nonce_count = "00000001";
    let cnonce_seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let cnonce = md5_hex(&format!("{username}:{nonce}:{cnonce_seed}"));

    let digest_response = if qop_auth {
        md5_hex(&format!("{ha1}:{nonce}:{nonce_count}:{cnonce}:auth:{ha2}"))
    } else {
        md5_hex(&format!("{ha1}:{nonce}:{ha2}"))
    };

    let mut fields = vec![
        format!("username=\"{}\"", escape_digest_value(username)),
        format!("realm=\"{}\"", escape_digest_value(&realm)),
        format!("nonce=\"{}\"", escape_digest_value(&nonce)),
        format!("uri=\"{}\"", escape_digest_value(&uri)),
        format!("response=\"{}\"", digest_response),
        "algorithm=MD5".to_string(),
    ];

    if qop_auth {
        fields.push("qop=\"auth\"".to_string());
        fields.push(format!("nc={nonce_count}"));
        fields.push(format!("cnonce=\"{}\"", escape_digest_value(&cnonce)));
    }

    if let Some(opaque) = challenge.get("opaque").filter(|value| !value.is_empty()) {
        fields.push(format!("opaque=\"{}\"", escape_digest_value(opaque)));
    }

    Ok(format!("Digest {}", fields.join(", ")))
}

fn contains_ntlm_challenge(headers: &HeaderMap) -> bool {
    for value in headers.get_all(WWW_AUTHENTICATE).iter() {
        let Ok(text) = value.to_str() else {
            continue;
        };
        for line in text.split('\n') {
            for segment in line.split(',') {
                let segment = segment.trim();
                if segment.len() >= 4 && segment[..4].eq_ignore_ascii_case("ntlm") {
                    return true;
                }
            }
        }
    }
    false
}

fn extract_ntlm_challenge_token(headers: &HeaderMap) -> Option<String> {
    for value in headers.get_all(WWW_AUTHENTICATE).iter() {
        let Ok(text) = value.to_str() else {
            continue;
        };

        for line in text.split('\n') {
            for segment in line.split(',') {
                let segment = segment.trim();
                if segment.len() < 4 || !segment[..4].eq_ignore_ascii_case("ntlm") {
                    continue;
                }
                let token = segment[4..].trim();
                if !token.is_empty() {
                    return Some(token.to_string());
                }
            }
        }
    }

    None
}

fn normalize_ntlm_identity(username: &str, domain: &str) -> (String, String) {
    let normalized_username = username.trim().to_string();
    let normalized_domain = domain.trim().to_string();
    if !normalized_domain.is_empty() {
        return (normalized_username, normalized_domain);
    }

    if let Some(idx) = normalized_username.find('\\') {
        let domain_part = normalized_username[..idx].trim().to_string();
        let user_part = normalized_username[idx + 1..].trim().to_string();
        if !domain_part.is_empty() && !user_part.is_empty() {
            return (user_part, domain_part);
        }
    }

    (normalized_username, String::new())
}

fn build_ntlm_negotiate_header(domain: &str) -> Result<String, String> {
    let flags = ntlmclient::Flags::NEGOTIATE_UNICODE
        | ntlmclient::Flags::REQUEST_TARGET
        | ntlmclient::Flags::NEGOTIATE_NTLM
        | ntlmclient::Flags::NEGOTIATE_WORKSTATION_SUPPLIED;
    let message = ntlmclient::Message::Negotiate(ntlmclient::NegotiateMessage {
        flags,
        supplied_domain: domain.to_string(),
        supplied_workstation: "GETMAN".to_string(),
        os_version: Default::default(),
    });

    let bytes = message
        .to_bytes()
        .map_err(|err| format!("Failed to encode NTLM negotiate message: {err:?}"))?;
    Ok(format!("NTLM {}", BASE64_STANDARD.encode(bytes)))
}

fn build_ntlm_authenticate_header(
    challenge_b64: &str,
    username: &str,
    password: &str,
    domain: &str,
) -> Result<String, String> {
    let challenge_bytes = BASE64_STANDARD
        .decode(challenge_b64)
        .map_err(|err| format!("Invalid NTLM challenge token: {err}"))?;
    let challenge_message = ntlmclient::Message::try_from(challenge_bytes.as_slice())
        .map_err(|err| format!("Failed to parse NTLM challenge: {err:?}"))?;
    let challenge = match challenge_message {
        ntlmclient::Message::Challenge(value) => value,
        _ => {
            return Err("Server NTLM challenge payload is invalid".to_string());
        }
    };

    let target_info_bytes: Vec<u8> = challenge
        .target_information
        .iter()
        .flat_map(|entry| entry.to_bytes())
        .collect();

    let credentials = ntlmclient::Credentials {
        username: username.to_string(),
        password: password.to_string(),
        domain: domain.to_string(),
    };

    let response = ntlmclient::respond_challenge_ntlm_v2(
        challenge.challenge,
        &target_info_bytes,
        ntlmclient::get_ntlm_time(),
        &credentials,
    );
    let flags =
        ntlmclient::Flags::NEGOTIATE_UNICODE | ntlmclient::Flags::NEGOTIATE_NTLM;
    let auth_message = response.to_message(&credentials, "GETMAN", flags);
    let auth_bytes = auth_message
        .to_bytes()
        .map_err(|err| format!("Failed to encode NTLM auth message: {err:?}"))?;

    Ok(format!("NTLM {}", BASE64_STANDARD.encode(auth_bytes)))
}

async fn response_to_payload(
    response: Response,
    elapsed: u64,
) -> Result<SendResponsePayload, String> {
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("Unknown").to_string();

    let mut response_headers = HashMap::new();
    for (key, value) in response.headers() {
        let key = key.to_string();
        let value = value.to_str().unwrap_or_default().to_string();

        response_headers
            .entry(key)
            .and_modify(|existing: &mut String| {
                if !existing.is_empty() {
                    existing.push('\n');
                }
                existing.push_str(&value);
            })
            .or_insert(value);
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

    Ok(SendResponsePayload {
        status: status.as_u16(),
        status_text,
        headers: response_headers,
        body,
        time: elapsed,
        size: bytes.len() as u64,
        content_type,
    })
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
    let digest_username = payload.digest_username.clone().unwrap_or_default();
    let digest_password = payload.digest_password.clone().unwrap_or_default();
    let should_try_digest =
        !digest_username.trim().is_empty() && !digest_password.is_empty();
    let ntlm_username = payload.ntlm_username.clone().unwrap_or_default();
    let ntlm_password = payload.ntlm_password.clone().unwrap_or_default();
    let ntlm_domain = payload.ntlm_domain.clone().unwrap_or_default();
    let should_try_ntlm = !ntlm_username.trim().is_empty() && !ntlm_password.is_empty();
    let (ntlm_username, ntlm_domain) =
        normalize_ntlm_identity(&ntlm_username, &ntlm_domain);

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

        let mut attempt_headers = headers.clone();
        let mut digest_retried = false;
        let mut ntlm_stage = if should_try_ntlm { 0u8 } else { 3u8 };
        let start = Instant::now();

        loop {
            let mut request = client
                .request(method.clone(), &payload.url)
                .headers(attempt_headers.clone());

            if payload.body.is_some()
                && !matches!(method, Method::GET | Method::HEAD | Method::OPTIONS)
            {
                if let Some(ref body) = payload.body {
                    request = request.body(body.clone());
                }
            }

            let result = tokio::select! {
                res = request.send() => res,
                _ = cancel_rx.recv() => {
                    return Err("Request cancelled".into());
                }
            };

            match result {
                Ok(response) => {
                    if should_try_ntlm
                        && response.status() == StatusCode::UNAUTHORIZED
                    {
                        if ntlm_stage == 0 {
                            if let Some(challenge_token) =
                                extract_ntlm_challenge_token(response.headers())
                            {
                                let authorization = build_ntlm_authenticate_header(
                                    &challenge_token,
                                    &ntlm_username,
                                    &ntlm_password,
                                    &ntlm_domain,
                                )?;
                                let auth_header = HeaderValue::from_str(&authorization)
                                    .map_err(|err| {
                                        format!("Invalid NTLM authorization header: {err}")
                                    })?;
                                attempt_headers.insert(AUTHORIZATION, auth_header);
                                ntlm_stage = 2;
                                continue;
                            }

                            if contains_ntlm_challenge(response.headers()) {
                                let negotiate =
                                    build_ntlm_negotiate_header(&ntlm_domain)?;
                                let auth_header = HeaderValue::from_str(&negotiate)
                                    .map_err(|err| {
                                        format!("Invalid NTLM negotiate header: {err}")
                                    })?;
                                attempt_headers.insert(AUTHORIZATION, auth_header);
                                ntlm_stage = 1;
                                continue;
                            }
                        } else if ntlm_stage == 1 {
                            if let Some(challenge_token) =
                                extract_ntlm_challenge_token(response.headers())
                            {
                                let authorization = build_ntlm_authenticate_header(
                                    &challenge_token,
                                    &ntlm_username,
                                    &ntlm_password,
                                    &ntlm_domain,
                                )?;
                                let auth_header = HeaderValue::from_str(&authorization)
                                    .map_err(|err| {
                                        format!("Invalid NTLM authorization header: {err}")
                                    })?;
                                attempt_headers.insert(AUTHORIZATION, auth_header);
                                ntlm_stage = 2;
                                continue;
                            }
                        }
                    }

                    if should_try_digest
                        && !digest_retried
                        && response.status() == StatusCode::UNAUTHORIZED
                    {
                        if let Some(challenge) =
                            extract_digest_challenge(response.headers())
                        {
                            let authorization = build_digest_authorization(
                                &method,
                                &payload.url,
                                digest_username.trim(),
                                &digest_password,
                                &challenge,
                            )?;
                            let auth_header =
                                HeaderValue::from_str(&authorization).map_err(
                                    |err| {
                                        format!(
                                            "Invalid digest authorization header: {err}"
                                        )
                                    },
                                )?;
                            attempt_headers.insert(AUTHORIZATION, auth_header);
                            digest_retried = true;
                            continue;
                        }
                    }

                    let elapsed = start.elapsed().as_millis() as u64;
                    return response_to_payload(response, elapsed).await;
                }
                Err(err) => {
                    last_error = Some(format!("Request failed: {err}"));
                    break;
                }
            }
        }

        // Retry on connection errors or timeouts
        if attempt < max_retries {
            continue;
        } else {
            break;
        }
    }

    if let Some(message) = last_error {
        Err(message)
    } else {
        Err("Request failed".into())
    }
}
