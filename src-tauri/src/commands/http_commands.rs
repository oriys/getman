use crate::domain::SendRequestPayload;
use crate::engine::cancel::CancelRegistry;
use crate::engine::http::{error_response, send_http_request_impl};
use crate::domain::SendResponsePayload;
use tauri::State;

#[tauri::command]
pub async fn send_http_request(
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
pub fn cancel_http_request(
    request_id: String,
    registry: State<'_, CancelRegistry>,
) -> bool {
    registry.cancel(&request_id)
}
