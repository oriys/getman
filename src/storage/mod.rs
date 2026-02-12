use std::collections::VecDeque;
use std::fs;
use std::path::PathBuf;

use rusqlite::{params, Connection};

use crate::auth::AuthType;
use crate::collections::SavedRequest;
use crate::history::{History, HistoryEntry};
use crate::http::method::HttpMethod;

const DATA_DIR: &str = ".getman";
const DB_FILE: &str = "getman.db";

pub fn load_saved_requests() -> Result<Vec<SavedRequest>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, method, url, params, headers, body,
                    auth_type, auth_bearer_token, auth_basic_username,
                    auth_basic_password, auth_api_key, auth_api_value
             FROM saved_requests ORDER BY id DESC",
        )
        .map_err(|e| format!("Failed to prepare query: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(SavedRequest {
                id: row.get::<_, i64>(0)? as u64,
                name: row.get(1)?,
                method: parse_method(&row.get::<_, String>(2)?),
                url: row.get(3)?,
                params: row.get(4)?,
                headers: row.get(5)?,
                body: row.get(6)?,
                auth_type: parse_auth_type(&row.get::<_, String>(7)?),
                auth_bearer_token: row.get(8)?,
                auth_basic_username: row.get(9)?,
                auth_basic_password: row.get(10)?,
                auth_api_key: row.get(11)?,
                auth_api_value: row.get(12)?,
            })
        })
        .map_err(|e| format!("Failed to query saved requests: {e}"))?;

    let mut requests = Vec::new();
    for row in rows {
        requests.push(row.map_err(|e| format!("Failed to read saved request row: {e}"))?);
    }
    Ok(requests)
}

pub fn save_saved_requests(requests: &[SavedRequest]) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM saved_requests", [])
        .map_err(|e| format!("Failed to clear saved requests: {e}"))?;

    let mut stmt = conn
        .prepare(
            "INSERT INTO saved_requests
             (id, name, method, url, params, headers, body,
              auth_type, auth_bearer_token, auth_basic_username,
              auth_basic_password, auth_api_key, auth_api_value)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        )
        .map_err(|e| format!("Failed to prepare insert: {e}"))?;

    for r in requests {
        stmt.execute(params![
            r.id as i64,
            r.name,
            r.method.to_string(),
            r.url,
            r.params,
            r.headers,
            r.body,
            auth_type_to_str(r.auth_type),
            r.auth_bearer_token,
            r.auth_basic_username,
            r.auth_basic_password,
            r.auth_api_key,
            r.auth_api_value,
        ])
        .map_err(|e| format!("Failed to insert saved request: {e}"))?;
    }

    Ok(())
}

pub fn load_history() -> Result<History, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT timestamp, method, url, status, duration_ms
             FROM history ORDER BY timestamp DESC LIMIT 100",
        )
        .map_err(|e| format!("Failed to prepare history query: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(HistoryEntry {
                timestamp: row.get::<_, i64>(0)? as u64,
                method: parse_method(&row.get::<_, String>(1)?),
                url: row.get(2)?,
                status: row.get(3)?,
                duration_ms: row
                    .get::<_, Option<i64>>(4)?
                    .map(|v| v as u128),
            })
        })
        .map_err(|e| format!("Failed to query history: {e}"))?;

    let mut entries = VecDeque::new();
    for row in rows {
        entries.push_back(row.map_err(|e| format!("Failed to read history row: {e}"))?);
    }
    Ok(History::from_entries(entries))
}

pub fn save_history(history: &History) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM history", [])
        .map_err(|e| format!("Failed to clear history: {e}"))?;

    let mut stmt = conn
        .prepare(
            "INSERT INTO history (timestamp, method, url, status, duration_ms)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .map_err(|e| format!("Failed to prepare history insert: {e}"))?;

    for entry in history.entries() {
        stmt.execute(params![
            entry.timestamp as i64,
            entry.method.to_string(),
            entry.url,
            entry.status,
            entry.duration_ms.map(|v| v as i64),
        ])
        .map_err(|e| format!("Failed to insert history entry: {e}"))?;
    }

    Ok(())
}

fn open_db() -> Result<Connection, String> {
    ensure_data_dir()?;
    let db_path = data_dir().join(DB_FILE);
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database `{}`: {e}", db_path.display()))?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS saved_requests (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            method TEXT NOT NULL,
            url TEXT NOT NULL,
            params TEXT NOT NULL DEFAULT '',
            headers TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL DEFAULT '',
            auth_type TEXT NOT NULL DEFAULT 'None',
            auth_bearer_token TEXT NOT NULL DEFAULT '',
            auth_basic_username TEXT NOT NULL DEFAULT '',
            auth_basic_password TEXT NOT NULL DEFAULT '',
            auth_api_key TEXT NOT NULL DEFAULT '',
            auth_api_value TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            method TEXT NOT NULL,
            url TEXT NOT NULL,
            status TEXT,
            duration_ms INTEGER
        );",
    )
    .map_err(|e| format!("Failed to initialize database tables: {e}"))?;

    Ok(conn)
}

fn parse_method(s: &str) -> HttpMethod {
    match s {
        "GET" => HttpMethod::Get,
        "POST" => HttpMethod::Post,
        "PUT" => HttpMethod::Put,
        "PATCH" => HttpMethod::Patch,
        "DELETE" => HttpMethod::Delete,
        "HEAD" => HttpMethod::Head,
        "OPTIONS" => HttpMethod::Options,
        _ => HttpMethod::Get,
    }
}

fn parse_auth_type(s: &str) -> AuthType {
    match s {
        "BearerToken" => AuthType::BearerToken,
        "BasicAuth" => AuthType::BasicAuth,
        "ApiKeyHeader" => AuthType::ApiKeyHeader,
        "ApiKeyQuery" => AuthType::ApiKeyQuery,
        _ => AuthType::None,
    }
}

fn auth_type_to_str(auth_type: AuthType) -> &'static str {
    match auth_type {
        AuthType::None => "None",
        AuthType::BearerToken => "BearerToken",
        AuthType::BasicAuth => "BasicAuth",
        AuthType::ApiKeyHeader => "ApiKeyHeader",
        AuthType::ApiKeyQuery => "ApiKeyQuery",
    }
}

fn data_dir() -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(DATA_DIR)
}

fn ensure_data_dir() -> Result<(), String> {
    let path = data_dir();
    fs::create_dir_all(&path)
        .map_err(|e| format!("Failed to create data directory `{}`: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::sync::Mutex;

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn setup_test_db() -> (PathBuf, PathBuf) {
        let dir = env::temp_dir().join(format!(
            "getman_test_{}_{}",
            std::process::id(),
            std::thread::current().name().unwrap_or("unknown")
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let prev = env::current_dir().unwrap();
        env::set_current_dir(&dir).unwrap();
        (dir, prev)
    }

    fn cleanup(dir: PathBuf, prev: PathBuf) {
        env::set_current_dir(&prev).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_sqlite_saved_requests_roundtrip() {
        let _lock = TEST_LOCK.lock().unwrap();
        let (dir, prev) = setup_test_db();

        let requests = vec![SavedRequest {
            id: 1,
            name: "Test GET".to_string(),
            method: HttpMethod::Get,
            url: "https://example.com".to_string(),
            params: "key=value".to_string(),
            headers: "Accept: application/json".to_string(),
            body: String::new(),
            auth_type: AuthType::None,
            auth_bearer_token: String::new(),
            auth_basic_username: String::new(),
            auth_basic_password: String::new(),
            auth_api_key: String::new(),
            auth_api_value: String::new(),
        }];

        save_saved_requests(&requests).unwrap();
        let loaded = load_saved_requests().unwrap();

        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, 1);
        assert_eq!(loaded[0].name, "Test GET");
        assert_eq!(loaded[0].url, "https://example.com");

        cleanup(dir, prev);
    }

    #[test]
    fn test_sqlite_history_roundtrip() {
        let _lock = TEST_LOCK.lock().unwrap();
        let (dir, prev) = setup_test_db();

        let mut history = History::new();
        history.push(HistoryEntry {
            timestamp: 1000,
            method: HttpMethod::Post,
            url: "https://api.example.com/data".to_string(),
            status: Some("200 OK".to_string()),
            duration_ms: Some(150),
        });

        save_history(&history).unwrap();
        let loaded = load_history().unwrap();

        assert_eq!(loaded.entries().len(), 1);
        assert_eq!(loaded.entries()[0].url, "https://api.example.com/data");
        assert_eq!(loaded.entries()[0].status, Some("200 OK".to_string()));

        cleanup(dir, prev);
    }

    #[test]
    fn test_sqlite_empty_load() {
        let _lock = TEST_LOCK.lock().unwrap();
        let (dir, prev) = setup_test_db();

        let requests = load_saved_requests().unwrap();
        assert!(requests.is_empty());

        let history = load_history().unwrap();
        assert!(history.entries().is_empty());

        cleanup(dir, prev);
    }
}
