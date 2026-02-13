use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use reqwest::{Client, Method, Proxy};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tokio::sync::broadcast;

// ─── Cancel Token Registry ──────────────────────────────────────────────────

struct CancelRegistry {
    senders: Mutex<HashMap<String, broadcast::Sender<()>>>,
}

impl CancelRegistry {
    fn new() -> Self {
        Self {
            senders: Mutex::new(HashMap::new()),
        }
    }

    fn register(&self, id: &str) -> broadcast::Receiver<()> {
        let (tx, rx) = broadcast::channel(1);
        self.senders
            .lock()
            .unwrap()
            .insert(id.to_string(), tx);
        rx
    }

    fn cancel(&self, id: &str) -> bool {
        if let Some(tx) = self.senders.lock().unwrap().remove(id) {
            let _ = tx.send(());
            return true;
        }
        false
    }

    fn remove(&self, id: &str) {
        self.senders.lock().unwrap().remove(id);
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendRequestPayload {
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    retry_count: Option<u32>,
    #[serde(default)]
    retry_delay_ms: Option<u64>,
    #[serde(default)]
    proxy_url: Option<String>,
    #[serde(default = "default_verify_ssl")]
    verify_ssl: bool,
}

fn default_verify_ssl() -> bool {
    true
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SendResponsePayload {
    status: u16,
    status_text: String,
    headers: HashMap<String, String>,
    body: String,
    time: u64,
    size: u64,
    content_type: String,
}

const APP_STATE_KEY: &str = "root";

fn error_response(message: impl Into<String>) -> SendResponsePayload {
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

fn build_headers(input: &HashMap<String, String>) -> Result<HeaderMap, String> {
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

async fn send_http_request_impl(
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

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Failed to resolve app data dir: {err}"))?;

    fs::create_dir_all(&app_dir).map_err(|err| format!("Failed to create app data dir: {err}"))?;
    Ok(app_dir)
}

fn sqlite_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("getman.db"))
}

fn legacy_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("state.json"))
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let path = sqlite_path(app)?;
    let conn = Connection::open(path).map_err(|err| format!("Failed to open SQLite: {err}"))?;

    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|err| format!("Failed to set SQLite journal mode: {err}"))?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_state (
         state_key TEXT PRIMARY KEY,
         state_json TEXT NOT NULL,
         updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
       );",
    )
    .map_err(|err| format!("Failed to initialize SQLite schema: {err}"))?;

    Ok(conn)
}

fn upsert_state(conn: &Connection, state_json: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_state (state_key, state_json, updated_at)
       VALUES (?1, ?2, strftime('%s','now'))
       ON CONFLICT(state_key)
       DO UPDATE SET
         state_json = excluded.state_json,
         updated_at = excluded.updated_at;",
        params![APP_STATE_KEY, state_json],
    )
    .map_err(|err| format!("Failed to save app state to SQLite: {err}"))?;

    Ok(())
}

#[tauri::command]
async fn send_http_request(
    payload: SendRequestPayload,
    registry: State<'_, CancelRegistry>,
) -> Result<SendResponsePayload, String> {
    let request_id = payload.request_id.clone().unwrap_or_default();
    let mut cancel_rx = registry.register(&request_id);

    let result = send_http_request_impl(payload, &mut cancel_rx).await;

    registry.remove(&request_id);

    match result {
        Ok(response) => Ok(response),
        Err(message) => Ok(error_response(message)),
    }
}

#[tauri::command]
fn cancel_http_request(
    request_id: String,
    registry: State<'_, CancelRegistry>,
) -> bool {
    registry.cancel(&request_id)
}

#[tauri::command]
fn load_app_state(app: AppHandle) -> Result<Option<String>, String> {
    let conn = open_db(&app)?;
    let state_from_db: Option<String> = conn
        .query_row(
            "SELECT state_json FROM app_state WHERE state_key = ?1 LIMIT 1;",
            params![APP_STATE_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| format!("Failed to load app state from SQLite: {err}"))?;

    if state_from_db.is_some() {
        return Ok(state_from_db);
    }

    // One-time migration from old JSON file storage.
    let old_path = legacy_state_path(&app)?;
    if !old_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&old_path)
        .map_err(|err| format!("Failed to read legacy state file: {err}"))?;
    upsert_state(&conn, &content)?;

    let _ = fs::remove_file(old_path);
    Ok(Some(content))
}

#[tauri::command]
fn save_app_state(app: AppHandle, state_json: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    upsert_state(&conn, &state_json)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(CancelRegistry::new())
        .invoke_handler(tauri::generate_handler![
            send_http_request,
            cancel_http_request,
            load_app_state,
            save_app_state
        ])
        .run(tauri::generate_context!())
        .expect("failed to run getman");
}
