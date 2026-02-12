use std::fs;
use std::path::PathBuf;

use crate::collections::SavedRequest;
use crate::history::History;

const DATA_DIR: &str = ".getman";
const SAVED_REQUESTS_FILE: &str = "saved_requests.json";
const HISTORY_FILE: &str = "history.json";

pub fn load_saved_requests() -> Result<Vec<SavedRequest>, String> {
    let file = data_dir().join(SAVED_REQUESTS_FILE);
    if !file.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&file)
        .map_err(|e| format!("Failed to read saved requests file `{}`: {e}", file.display()))?;
    serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse saved requests file `{}`: {e}", file.display()))
}

pub fn save_saved_requests(requests: &[SavedRequest]) -> Result<(), String> {
    ensure_data_dir()?;
    let file = data_dir().join(SAVED_REQUESTS_FILE);
    let raw = serde_json::to_string_pretty(requests)
        .map_err(|e| format!("Failed to serialize saved requests: {e}"))?;
    fs::write(&file, raw)
        .map_err(|e| format!("Failed to write saved requests file `{}`: {e}", file.display()))
}

pub fn load_history() -> Result<History, String> {
    let file = data_dir().join(HISTORY_FILE);
    if !file.exists() {
        return Ok(History::new());
    }

    let raw = fs::read_to_string(&file)
        .map_err(|e| format!("Failed to read history file `{}`: {e}", file.display()))?;
    serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse history file `{}`: {e}", file.display()))
}

pub fn save_history(history: &History) -> Result<(), String> {
    ensure_data_dir()?;
    let file = data_dir().join(HISTORY_FILE);
    let raw =
        serde_json::to_string_pretty(history).map_err(|e| format!("Failed to serialize history: {e}"))?;
    fs::write(&file, raw)
        .map_err(|e| format!("Failed to write history file `{}`: {e}", file.display()))
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
