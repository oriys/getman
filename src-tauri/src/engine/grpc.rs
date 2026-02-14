use crate::domain::{
    GrpcReflectionResponse, GrpcRequestPayload, GrpcResponsePayload, ProtoFieldInfo,
    ProtoMethodInfo, ProtoServiceInfo,
};
use bytes::{Buf, BufMut, Bytes};
use prost::Message as ProstMessage;
use prost_reflect::{DescriptorPool, DynamicMessage, MessageDescriptor};
use std::collections::HashMap;
use std::fs;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use tokio_stream::StreamExt;
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
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let unique_id = format!(
        "{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
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
    // 1. Build descriptor pool from proto content or reflection descriptor bytes
    let pool = if let Some(ref desc_b64) = payload.descriptor_bytes {
        use base64::Engine;
        let desc_bytes = base64::engine::general_purpose::STANDARD
            .decode(desc_b64)
            .map_err(|e| format!("Failed to decode descriptor bytes: {e}"))?;
        DescriptorPool::decode(desc_bytes.as_slice())
            .map_err(|e| format!("Failed to create descriptor pool: {e}"))?
    } else {
        compile_proto(&payload.proto_content)?
    };

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

// ─── gRPC Server Reflection ──────────────────────────────────────────────────

mod reflection_proto {
    use bytes::{BufMut, Bytes, BytesMut};

    fn encode_varint(mut value: u64, buf: &mut BytesMut) {
        while value >= 0x80 {
            buf.put_u8((value as u8) | 0x80);
            value >>= 7;
        }
        buf.put_u8(value as u8);
    }

    fn encode_tag(field_number: u32, wire_type: u32, buf: &mut BytesMut) {
        encode_varint(((field_number as u64) << 3) | wire_type as u64, buf);
    }

    fn encode_string_field(field_number: u32, value: &str, buf: &mut BytesMut) {
        if value.is_empty() {
            return;
        }
        encode_tag(field_number, 2, buf); // wire type 2 = length-delimited
        encode_varint(value.len() as u64, buf);
        buf.put_slice(value.as_bytes());
    }

    /// Encode a ServerReflectionRequest with list_services = ""
    pub fn encode_list_services_request() -> Bytes {
        let mut buf = BytesMut::new();
        // field 7: string list_services = ""
        // Even for empty string, we must encode the field to set the oneof
        encode_tag(7, 2, &mut buf); // wire type 2
        encode_varint(0, &mut buf); // length 0
        buf.freeze()
    }

    /// Encode a ServerReflectionRequest with file_containing_symbol
    pub fn encode_file_containing_symbol_request(symbol: &str) -> Bytes {
        let mut buf = BytesMut::new();
        // field 4: string file_containing_symbol
        encode_string_field(4, symbol, &mut buf);
        buf.freeze()
    }

    struct ProtoReader<'a> {
        data: &'a [u8],
        pos: usize,
    }

    impl<'a> ProtoReader<'a> {
        fn new(data: &'a [u8]) -> Self {
            Self { data, pos: 0 }
        }

        fn remaining(&self) -> bool {
            self.pos < self.data.len()
        }

        fn read_varint(&mut self) -> Result<u64, String> {
            let mut result: u64 = 0;
            let mut shift = 0;
            loop {
                if self.pos >= self.data.len() {
                    return Err("Unexpected end of data reading varint".into());
                }
                let byte = self.data[self.pos];
                self.pos += 1;
                result |= ((byte & 0x7F) as u64) << shift;
                if byte & 0x80 == 0 {
                    return Ok(result);
                }
                shift += 7;
                if shift >= 64 {
                    return Err("Varint too long".into());
                }
            }
        }

        fn read_tag(&mut self) -> Result<(u32, u32), String> {
            let v = self.read_varint()?;
            Ok(((v >> 3) as u32, (v & 0x07) as u32))
        }

        fn read_bytes(&mut self) -> Result<&'a [u8], String> {
            let len = self.read_varint()? as usize;
            if self.pos + len > self.data.len() {
                return Err("Unexpected end of data reading bytes".into());
            }
            let slice = &self.data[self.pos..self.pos + len];
            self.pos += len;
            Ok(slice)
        }

        fn read_string(&mut self) -> Result<String, String> {
            let bytes = self.read_bytes()?;
            String::from_utf8(bytes.to_vec()).map_err(|e| format!("Invalid UTF-8: {e}"))
        }

        fn skip_field(&mut self, wire_type: u32) -> Result<(), String> {
            match wire_type {
                0 => { self.read_varint()?; }
                1 => self.pos += 8,
                2 => { self.read_bytes()?; }
                5 => self.pos += 4,
                _ => return Err(format!("Unknown wire type: {wire_type}")),
            }
            Ok(())
        }
    }

    /// Parse a ListServiceResponse from the response, returning service names.
    fn parse_list_service_response(data: &[u8]) -> Result<Vec<String>, String> {
        let mut reader = ProtoReader::new(data);
        let mut names = Vec::new();
        while reader.remaining() {
            let (field, wire_type) = reader.read_tag()?;
            if field == 1 && wire_type == 2 {
                // ServiceResponse message
                let msg_bytes = reader.read_bytes()?;
                let mut inner = ProtoReader::new(msg_bytes);
                while inner.remaining() {
                    let (f, wt) = inner.read_tag()?;
                    if f == 1 && wt == 2 {
                        names.push(inner.read_string()?);
                    } else {
                        inner.skip_field(wt)?;
                    }
                }
            } else {
                reader.skip_field(wire_type)?;
            }
        }
        Ok(names)
    }

    /// Parse a FileDescriptorResponse, returning raw FileDescriptorProto bytes.
    fn parse_file_descriptor_response(data: &[u8]) -> Result<Vec<Vec<u8>>, String> {
        let mut reader = ProtoReader::new(data);
        let mut descriptors = Vec::new();
        while reader.remaining() {
            let (field, wire_type) = reader.read_tag()?;
            if field == 1 && wire_type == 2 {
                descriptors.push(reader.read_bytes()?.to_vec());
            } else {
                reader.skip_field(wire_type)?;
            }
        }
        Ok(descriptors)
    }

    /// Parse service names from a ServerReflectionResponse.
    pub fn parse_list_services_response(data: &[u8]) -> Result<Vec<String>, String> {
        let mut reader = ProtoReader::new(data);
        while reader.remaining() {
            let (field, wire_type) = reader.read_tag()?;
            match (field, wire_type) {
                (6, 2) => {
                    // list_services_response
                    let msg_bytes = reader.read_bytes()?;
                    return parse_list_service_response(msg_bytes);
                }
                (7, 2) => {
                    // error_response
                    let msg_bytes = reader.read_bytes()?;
                    let mut inner = ProtoReader::new(msg_bytes);
                    let mut error_msg = String::new();
                    while inner.remaining() {
                        let (f, wt) = inner.read_tag()?;
                        if f == 2 && wt == 2 {
                            error_msg = inner.read_string()?;
                        } else {
                            inner.skip_field(wt)?;
                        }
                    }
                    return Err(format!("Reflection error: {error_msg}"));
                }
                _ => reader.skip_field(wire_type)?,
            }
        }
        Err("No list_services_response found in reflection response".into())
    }

    /// Parse file descriptors from a ServerReflectionResponse.
    pub fn parse_file_descriptor_response_msg(data: &[u8]) -> Result<Vec<Vec<u8>>, String> {
        let mut reader = ProtoReader::new(data);
        while reader.remaining() {
            let (field, wire_type) = reader.read_tag()?;
            match (field, wire_type) {
                (4, 2) => {
                    // file_descriptor_response
                    let msg_bytes = reader.read_bytes()?;
                    return parse_file_descriptor_response(msg_bytes);
                }
                (7, 2) => {
                    // error_response
                    let msg_bytes = reader.read_bytes()?;
                    let mut inner = ProtoReader::new(msg_bytes);
                    let mut error_msg = String::new();
                    while inner.remaining() {
                        let (f, wt) = inner.read_tag()?;
                        if f == 2 && wt == 2 {
                            error_msg = inner.read_string()?;
                        } else {
                            inner.skip_field(wt)?;
                        }
                    }
                    return Err(format!("Reflection error: {error_msg}"));
                }
                _ => reader.skip_field(wire_type)?,
            }
        }
        Err("No file_descriptor_response found in reflection response".into())
    }
}

pub async fn fetch_grpc_reflection_impl(
    endpoint_url: &str,
) -> Result<GrpcReflectionResponse, String> {
    // 1. Connect to endpoint
    let endpoint = tonic::transport::Endpoint::from_shared(endpoint_url.to_string())
        .map_err(|e| format!("Invalid endpoint: {e}"))?;

    let channel = endpoint
        .connect()
        .await
        .map_err(|e| format!("Failed to connect: {e}"))?;

    let mut grpc_client = tonic::client::Grpc::new(channel);
    grpc_client
        .ready()
        .await
        .map_err(|e| format!("Service not ready: {e}"))?;

    // 2. List services via reflection (try v1 first, then v1alpha)
    let list_req = reflection_proto::encode_list_services_request();

    let service_names = {
        let v1_path: http::uri::PathAndQuery =
            "/grpc.reflection.v1.ServerReflection/ServerReflectionInfo"
                .parse()
                .unwrap();
        let v1alpha_path: http::uri::PathAndQuery =
            "/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo"
                .parse()
                .unwrap();

        let request = tonic::Request::new(tokio_stream::once(list_req.clone()));
        let result = grpc_client
            .streaming(request, v1_path, RawBytesCodec)
            .await;

        match result {
            Ok(response) => {
                let mut stream = response.into_inner();
                if let Some(Ok(msg)) = stream.next().await {
                    reflection_proto::parse_list_services_response(&msg)?
                } else {
                    return Err("No response from reflection service".into());
                }
            }
            Err(_) => {
                // Retry with v1alpha
                grpc_client
                    .ready()
                    .await
                    .map_err(|e| format!("Service not ready: {e}"))?;
                let request = tonic::Request::new(tokio_stream::once(list_req));
                let response = grpc_client
                    .streaming(request, v1alpha_path, RawBytesCodec)
                    .await
                    .map_err(|e| {
                        format!(
                            "Server does not support gRPC reflection: {}",
                            e.message()
                        )
                    })?;
                let mut stream = response.into_inner();
                if let Some(Ok(msg)) = stream.next().await {
                    reflection_proto::parse_list_services_response(&msg)?
                } else {
                    return Err("No response from reflection service".into());
                }
            }
        }
    };

    // Filter out reflection services themselves
    let service_names: Vec<String> = service_names
        .into_iter()
        .filter(|name| !name.starts_with("grpc.reflection.") && !name.starts_with("grpc.health."))
        .collect();

    if service_names.is_empty() {
        return Err("No user services found via reflection".into());
    }

    // 3. For each service, fetch file descriptors
    let mut all_fd_bytes: Vec<Vec<u8>> = Vec::new();
    let mut seen_files = std::collections::HashSet::new();

    for service_name in &service_names {
        let req = reflection_proto::encode_file_containing_symbol_request(service_name);

        grpc_client
            .ready()
            .await
            .map_err(|e| format!("Service not ready: {e}"))?;

        // Try v1 first, then v1alpha
        let v1_path: http::uri::PathAndQuery =
            "/grpc.reflection.v1.ServerReflection/ServerReflectionInfo"
                .parse()
                .unwrap();
        let v1alpha_path: http::uri::PathAndQuery =
            "/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo"
                .parse()
                .unwrap();

        let request = tonic::Request::new(tokio_stream::once(req.clone()));
        let fd_bytes_list = match grpc_client
            .streaming(request, v1_path, RawBytesCodec)
            .await
        {
            Ok(response) => {
                let mut stream = response.into_inner();
                if let Some(Ok(msg)) = stream.next().await {
                    reflection_proto::parse_file_descriptor_response_msg(&msg)?
                } else {
                    continue;
                }
            }
            Err(_) => {
                grpc_client
                    .ready()
                    .await
                    .map_err(|e| format!("Service not ready: {e}"))?;
                let request = tonic::Request::new(tokio_stream::once(req));
                let response = grpc_client
                    .streaming(request, v1alpha_path, RawBytesCodec)
                    .await
                    .map_err(|e| {
                        format!("Failed to fetch file descriptor for {}: {}", service_name, e.message())
                    })?;
                let mut stream = response.into_inner();
                if let Some(Ok(msg)) = stream.next().await {
                    reflection_proto::parse_file_descriptor_response_msg(&msg)?
                } else {
                    continue;
                }
            }
        };

        for fd in fd_bytes_list {
            // Deduplicate by content hash
            let hash = {
                use std::hash::{Hash, Hasher};
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                fd.hash(&mut hasher);
                hasher.finish()
            };
            if seen_files.insert(hash) {
                all_fd_bytes.push(fd);
            }
        }
    }

    // 4. Build a FileDescriptorSet from collected descriptors
    let fds = prost_types::FileDescriptorSet {
        file: all_fd_bytes
            .iter()
            .map(|b| {
                prost_types::FileDescriptorProto::decode(b.as_slice())
                    .map_err(|e| format!("Failed to decode file descriptor: {e}"))
            })
            .collect::<Result<Vec<_>, _>>()?,
    };

    let fds_bytes = fds.encode_to_vec();

    // Encode descriptor bytes as base64 for frontend storage
    use base64::Engine;
    let descriptor_bytes_b64 = base64::engine::general_purpose::STANDARD.encode(&fds_bytes);

    let pool = DescriptorPool::decode(fds_bytes.as_ref())
        .map_err(|e| format!("Failed to create descriptor pool: {e}"))?;

    // 5. Extract services (reusing existing logic)
    let mut services = Vec::new();
    for service in pool.services() {
        // Only include services that were discovered (skip internal ones)
        if !service_names.contains(&service.full_name().to_string()) {
            continue;
        }

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

    Ok(GrpcReflectionResponse {
        services,
        descriptor_bytes: descriptor_bytes_b64,
    })
}
