use crate::domain::{GrpcReflectionResponse, GrpcRequestPayload, GrpcResponsePayload, ProtoServiceInfo};
use crate::engine::cancel::CancelRegistry;
use crate::engine::grpc::{grpc_error_response, fetch_grpc_reflection_impl, parse_proto_content_impl, send_grpc_request_impl};
use tauri::State;

#[tauri::command]
pub fn parse_proto_content(
    proto_content: String,
) -> Result<Vec<ProtoServiceInfo>, String> {
    parse_proto_content_impl(&proto_content)
}

#[tauri::command]
pub async fn fetch_grpc_reflection(
    endpoint: String,
) -> Result<GrpcReflectionResponse, String> {
    fetch_grpc_reflection_impl(&endpoint).await
}

#[tauri::command]
pub async fn send_grpc_request(
    payload: GrpcRequestPayload,
    registry: State<'_, CancelRegistry>,
) -> Result<GrpcResponsePayload, String> {
    let request_id = payload.request_id.clone().unwrap_or_default();
    let mut cancel_rx = registry.register(&request_id);

    let result = send_grpc_request_impl(payload, &mut cancel_rx).await;

    registry.remove(&request_id);

    match result {
        Ok(response) => Ok(response),
        Err(message) => Ok(grpc_error_response(message)),
    }
}
