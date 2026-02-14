use crate::domain::{EnvVariable, Environment, ResolvedRequest, ResolveRequestPayload};
use crate::engine::env;

#[tauri::command]
pub fn resolve_request(
    payload: ResolveRequestPayload,
    global_variables: Vec<EnvVariable>,
    environments: Vec<Environment>,
) -> Result<ResolvedRequest, String> {
    Ok(env::resolve_request(
        &payload,
        &global_variables,
        &environments,
    ))
}
