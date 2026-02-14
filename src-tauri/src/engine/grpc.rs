use crate::domain::{
    GrpcRequestPayload, GrpcResponsePayload, ProtoFieldInfo, ProtoMethodInfo, ProtoServiceInfo,
};
use bytes::{Buf, BufMut, Bytes};
use prost::Message as ProstMessage;
use prost_reflect::{DescriptorPool, DynamicMessage, MessageDescriptor};
use std::collections::HashMap;
use std::fs;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};

pub const GRPC_STATUS_UNKNOWN: i32 = 2;

pub fn grpc_error_response(message: impl Into<String>) -> GrpcResponsePayload {
    GrpcResponsePayload {
        status_code: GRPC_STATUS_UNKNOWN,
        status_message: message.into(),
        response_json: String::new(),
        response_metadata: HashMap::new(),
        time: 0,
        size: 0,
    }
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

pub fn compile_proto(proto_content: &str) -> Result<DescriptorPool, String> {
    let unique_id = format!(
        "{}-{}",
        std::process::id(),
        Instant::now().elapsed().as_nanos()
    );
    let temp_dir = std::env::temp_dir().join(format!("getman-proto-{unique_id}"));
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {e}"))?;

    let proto_path = temp_dir.join("service.proto");
    fs::write(&proto_path, proto_content)
        .map_err(|e| format!("Failed to write proto file: {e}"))?;

    let fds = protox::compile(&["service.proto"], &[&temp_dir])
        .map_err(|e| format!("Failed to compile proto: {e}"))?;

    let pool = DescriptorPool::decode(fds.encode_to_vec().as_ref())
        .map_err(|e| format!("Failed to create descriptor pool: {e}"))?;

    let _ = fs::remove_dir_all(&temp_dir);

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

pub fn parse_proto_content_impl(
    proto_content: &str,
) -> Result<Vec<ProtoServiceInfo>, String> {
    let pool = compile_proto(proto_content)?;

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

pub async fn send_grpc_request_impl(
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
    grpc_client
        .ready()
        .await
        .map_err(|e| format!("Service not ready: {e}"))?;

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
