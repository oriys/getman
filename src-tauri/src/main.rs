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

// gRPC imports
use bytes::{Buf, BufMut, Bytes};
use prost::Message as ProstMessage;
use prost_reflect::{DescriptorPool, DynamicMessage, MessageDescriptor};
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};

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

// ─── gRPC Support ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProtoServiceInfo {
    name: String,
    full_name: String,
    methods: Vec<ProtoMethodInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProtoMethodInfo {
    name: String,
    full_name: String,
    input_type: String,
    output_type: String,
    client_streaming: bool,
    server_streaming: bool,
    input_fields: Vec<ProtoFieldInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProtoFieldInfo {
    name: String,
    number: u32,
    type_name: String,
    is_repeated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GrpcRequestPayload {
    endpoint: String,
    proto_content: String,
    service_name: String,
    method_name: String,
    request_json: String,
    metadata: HashMap<String, String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    request_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GrpcResponsePayload {
    status_code: i32,
    status_message: String,
    response_json: String,
    response_metadata: HashMap<String, String>,
    time: u64,
    size: u64,
}

// ─── Raw bytes codec for tonic dynamic gRPC calls ────────────────────────────

struct RawBytesCodec;

impl Codec for RawBytesCodec {
    type Encode = Bytes;
    type Decode = Bytes;
    type Encoder = RawBytesEncoder;
    type Decoder = RawBytesDecoder;

    fn encoder(&mut self) -> Self::Encoder {
        RawBytesEncoder
    }

    fn decoder(&mut self) -> Self::Decoder {
        RawBytesDecoder
    }
}

struct RawBytesEncoder;

impl Encoder for RawBytesEncoder {
    type Item = Bytes;
    type Error = tonic::Status;

    fn encode(&mut self, item: Self::Item, dst: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        dst.put(item);
        Ok(())
    }
}

struct RawBytesDecoder;

impl Decoder for RawBytesDecoder {
    type Item = Bytes;
    type Error = tonic::Status;

    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        if src.remaining() == 0 {
            return Ok(None);
        }
        Ok(Some(src.copy_to_bytes(src.remaining())))
    }
}

fn compile_proto(proto_content: &str) -> Result<DescriptorPool, String> {
    let temp_dir = std::env::temp_dir().join("getman-proto");
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {e}"))?;

    let proto_path = temp_dir.join("service.proto");
    fs::write(&proto_path, proto_content)
        .map_err(|e| format!("Failed to write proto file: {e}"))?;

    let fds = protox::compile(&["service.proto"], &[&temp_dir])
        .map_err(|e| format!("Failed to compile proto: {e}"))?;

    let pool = DescriptorPool::decode(fds.encode_to_vec().as_ref())
        .map_err(|e| format!("Failed to create descriptor pool: {e}"))?;

    let _ = fs::remove_file(&proto_path);

    Ok(pool)
}

fn describe_field_type(field: &prost_reflect::FieldDescriptor) -> String {
    use prost_reflect::Kind;
    match field.kind() {
        Kind::Double => "double".into(),
        Kind::Float => "float".into(),
        Kind::Int32 => "int32".into(),
        Kind::Int64 => "int64".into(),
        Kind::Uint32 => "uint32".into(),
        Kind::Uint64 => "uint64".into(),
        Kind::Sint32 => "sint32".into(),
        Kind::Sint64 => "sint64".into(),
        Kind::Fixed32 => "fixed32".into(),
        Kind::Fixed64 => "fixed64".into(),
        Kind::Sfixed32 => "sfixed32".into(),
        Kind::Sfixed64 => "sfixed64".into(),
        Kind::Bool => "bool".into(),
        Kind::String => "string".into(),
        Kind::Bytes => "bytes".into(),
        Kind::Message(msg) => msg.full_name().to_string(),
        Kind::Enum(e) => e.full_name().to_string(),
    }
}

#[tauri::command]
fn parse_proto_content(proto_content: String) -> Result<Vec<ProtoServiceInfo>, String> {
    let pool = compile_proto(&proto_content)?;

    let mut services = Vec::new();
    for service in pool.services() {
        let methods: Vec<ProtoMethodInfo> = service
            .methods()
            .map(|method| {
                let input_fields = method
                    .input()
                    .fields()
                    .map(|field| ProtoFieldInfo {
                        name: field.name().to_string(),
                        number: field.number(),
                        type_name: describe_field_type(&field),
                        is_repeated: field.is_list(),
                    })
                    .collect();

                ProtoMethodInfo {
                    name: method.name().to_string(),
                    full_name: method.full_name().to_string(),
                    input_type: method.input().full_name().to_string(),
                    output_type: method.output().full_name().to_string(),
                    client_streaming: method.is_client_streaming(),
                    server_streaming: method.is_server_streaming(),
                    input_fields,
                }
            })
            .collect();

        services.push(ProtoServiceInfo {
            name: service.name().to_string(),
            full_name: service.full_name().to_string(),
            methods,
        });
    }

    Ok(services)
}

fn grpc_error_response(message: impl Into<String>) -> GrpcResponsePayload {
    GrpcResponsePayload {
        status_code: 2, // UNKNOWN
        status_message: message.into(),
        response_json: String::new(),
        response_metadata: HashMap::new(),
        time: 0,
        size: 0,
    }
}

async fn send_grpc_request_impl(
    payload: GrpcRequestPayload,
    cancel_rx: &mut broadcast::Receiver<()>,
) -> Result<GrpcResponsePayload, String> {
    // 1. Compile proto and find service/method
    let pool = compile_proto(&payload.proto_content)?;

    let service = pool
        .get_service_by_name(&payload.service_name)
        .ok_or_else(|| format!("Service '{}' not found", payload.service_name))?;

    let method = service
        .methods()
        .find(|m| m.name() == payload.method_name)
        .ok_or_else(|| format!("Method '{}' not found in service", payload.method_name))?;

    // 2. Encode request JSON to protobuf bytes
    let input_desc: MessageDescriptor = method.input();
    let mut deserializer = serde_json::Deserializer::from_str(&payload.request_json);
    let request_msg = DynamicMessage::deserialize(input_desc, &mut deserializer)
        .map_err(|e| format!("Failed to encode request message: {e}"))?;

    let request_bytes = Bytes::from(request_msg.encode_to_vec());

    // 3. Connect to endpoint
    let endpoint = tonic::transport::Endpoint::from_shared(payload.endpoint.clone())
        .map_err(|e| format!("Invalid endpoint: {e}"))?;

    let endpoint = if let Some(ms) = payload.timeout_ms {
        if ms > 0 {
            endpoint.timeout(Duration::from_millis(ms))
        } else {
            endpoint
        }
    } else {
        endpoint
    };

    let channel = tokio::select! {
        res = endpoint.connect() => res.map_err(|e| format!("Failed to connect: {e}"))?,
        _ = cancel_rx.recv() => return Err("Request cancelled".into()),
    };

    // 4. Build gRPC path and request
    let path: http::uri::PathAndQuery = format!("/{}/{}", service.full_name(), method.name())
        .parse()
        .map_err(|e: http::uri::InvalidUri| format!("Invalid gRPC path: {e}"))?;

    let mut request = tonic::Request::new(request_bytes);
    for (key, value) in &payload.metadata {
        if key.is_empty() {
            continue;
        }
        if let (Ok(name), Ok(val)) = (
            tonic::metadata::MetadataKey::from_bytes(key.as_bytes()),
            tonic::metadata::MetadataValue::try_from(value.as_str()),
        ) {
            request.metadata_mut().insert(name, val);
        }
    }

    // 5. Send gRPC request
    let mut grpc_client = tonic::client::Grpc::new(channel);
    grpc_client.ready().await.map_err(|e| format!("Service not ready: {e}"))?;

    let start = Instant::now();

    let response = tokio::select! {
        res = grpc_client.unary(request, path, RawBytesCodec) => {
            res.map_err(|status| format!("gRPC error ({}): {}", status.code(), status.message()))?
        },
        _ = cancel_rx.recv() => return Err("Request cancelled".into()),
    };

    let elapsed = start.elapsed().as_millis() as u64;

    // 6. Extract response metadata
    let response_metadata: HashMap<String, String> = response
        .metadata()
        .iter()
        .filter_map(|kv| match kv {
            tonic::metadata::KeyAndValueRef::Ascii(key, value) => Some((
                key.as_str().to_string(),
                value.to_str().unwrap_or_default().to_string(),
            )),
            _ => None,
        })
        .collect();

    // 7. Decode response protobuf to JSON
    let response_bytes = response.into_inner();
    let size = response_bytes.len() as u64;

    let output_desc: MessageDescriptor = method.output();
    let response_msg = DynamicMessage::decode(output_desc, &response_bytes[..])
        .map_err(|e| format!("Failed to decode response: {e}"))?;

    let response_json = serde_json::to_string_pretty(&response_msg)
        .map_err(|e| format!("Failed to serialize response: {e}"))?;

    Ok(GrpcResponsePayload {
        status_code: 0,
        status_message: "OK".to_string(),
        response_json,
        response_metadata,
        time: elapsed,
        size,
    })
}

#[tauri::command]
async fn send_grpc_request(
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

fn main() {
    tauri::Builder::default()
        .manage(CancelRegistry::new())
        .invoke_handler(tauri::generate_handler![
            send_http_request,
            cancel_http_request,
            load_app_state,
            save_app_state,
            parse_proto_content,
            send_grpc_request
        ])
        .run(tauri::generate_context!())
        .expect("failed to run getman");
}
