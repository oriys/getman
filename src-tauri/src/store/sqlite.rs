use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub const APP_STATE_KEY: &str = "root";

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Failed to resolve app data dir: {err}"))?;

    fs::create_dir_all(&app_dir)
        .map_err(|err| format!("Failed to create app data dir: {err}"))?;
    Ok(app_dir)
}

pub fn sqlite_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("getman.db"))
}

pub fn legacy_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("state.json"))
}

pub fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let path = sqlite_path(app)?;
    let conn =
        Connection::open(path).map_err(|err| format!("Failed to open SQLite: {err}"))?;

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

pub fn upsert_state(conn: &Connection, state_json: &str) -> Result<(), String> {
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

pub fn load_state(conn: &Connection) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT state_json FROM app_state WHERE state_key = ?1 LIMIT 1;",
        params![APP_STATE_KEY],
        |row| row.get(0),
    )
    .optional()
    .map_err(|err| format!("Failed to load app state from SQLite: {err}"))
}
