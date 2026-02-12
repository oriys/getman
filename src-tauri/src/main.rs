use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use reqwest::{Client, Method};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Instant;
use tauri::{AppHandle, Manager};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendRequestPayload {
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
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
) -> Result<SendResponsePayload, String> {
    let method = Method::from_bytes(payload.method.as_bytes())
        .map_err(|err| format!("Invalid HTTP method: {err}"))?;

    let headers = build_headers(&payload.headers)?;

    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|err| format!("Failed to build HTTP client: {err}"))?;

    let mut request = client
        .request(method.clone(), &payload.url)
        .headers(headers);

    if payload.body.is_some() && !matches!(method, Method::GET | Method::HEAD | Method::OPTIONS) {
        if let Some(body) = payload.body {
            request = request.body(body);
        }
    }

    let start = Instant::now();
    let response = request
        .send()
        .await
        .map_err(|err| format!("Request failed: {err}"))?;
    let elapsed = start.elapsed().as_millis() as u64;

    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("Unknown").to_string();

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
async fn send_http_request(payload: SendRequestPayload) -> SendResponsePayload {
    match send_http_request_impl(payload).await {
        Ok(response) => response,
        Err(message) => error_response(message),
    }
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
        .invoke_handler(tauri::generate_handler![
            send_http_request,
            load_app_state,
            save_app_state
        ])
        .run(tauri::generate_context!())
        .expect("failed to run getman");
}
