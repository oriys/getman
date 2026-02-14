use crate::store::sqlite;
use std::fs;
use tauri::AppHandle;

#[tauri::command]
pub fn load_app_state(app: AppHandle) -> Result<Option<String>, String> {
    let conn = sqlite::open_db(&app)?;
    let state_from_db = sqlite::load_state(&conn)?;

    if state_from_db.is_some() {
        return Ok(state_from_db);
    }

    // One-time migration from old JSON file storage.
    let old_path = sqlite::legacy_state_path(&app)?;
    if !old_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&old_path)
        .map_err(|err| format!("Failed to read legacy state file: {err}"))?;
    sqlite::upsert_state(&conn, &content)?;

    let _ = fs::remove_file(old_path);
    Ok(Some(content))
}

#[tauri::command]
pub fn save_app_state(app: AppHandle, state_json: String) -> Result<(), String> {
    let conn = sqlite::open_db(&app)?;
    sqlite::upsert_state(&conn, &state_json)?;
    Ok(())
}
