use crate::domain::{
    BenchmarkAggregatedMetrics, BenchmarkEnvironmentFingerprint, BenchmarkErrorSample,
    BenchmarkErrorType, BenchmarkHistogramBucket, BenchmarkLatencyMetrics, BenchmarkLoadMode,
    BenchmarkSaveBodies, BenchmarkSpecPayload, BenchmarkSummaryMetrics, BenchmarkTimeseriesPoint,
};
use crate::engine::http::build_headers;
use hdrhistogram::Histogram;
use reqwest::header::{HeaderMap, HeaderValue, CONNECTION};
use reqwest::{Client, Method, Proxy, Response};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{broadcast, mpsc};

const MAX_ERROR_BODY_BYTES: usize = 8 * 1024;
const HISTOGRAM_EDGES_MS: [f64; 18] = [
    0.0, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0, 500.0, 1000.0, 2000.0, 5000.0, 10000.0,
    20000.0, 30000.0, 45000.0, 60000.0,
];

#[derive(Clone)]
pub struct BenchmarkRegistry {
    senders: Arc<Mutex<HashMap<String, broadcast::Sender<()>>>>,
}

impl BenchmarkRegistry {
    pub fn new() -> Self {
        Self {
            senders: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn register(&self, id: &str) -> broadcast::Receiver<()> {
        let (tx, rx) = broadcast::channel(1);
        self.senders.lock().unwrap().insert(id.to_string(), tx);
        rx
    }

    pub fn cancel(&self, id: &str) -> bool {
        if let Some(tx) = self.senders.lock().unwrap().remove(id) {
            let _ = tx.send(());
            return true;
        }
        false
    }

    pub fn remove(&self, id: &str) {
        self.senders.lock().unwrap().remove(id);
    }
}

#[derive(Debug, Clone)]
pub struct BenchmarkExecutionResult {
    pub metrics: BenchmarkAggregatedMetrics,
    pub cancelled: bool,
}

#[derive(Debug, Clone)]
struct RequestTemplate {
    method: Method,
    url: String,
    headers: HeaderMap,
    body: Option<String>,
    keep_alive: bool,
    bytes_out: u64,
}

#[derive(Debug, Clone)]
struct SampleResult {
    timestamp_ms: u64,
    latency_ms: f64,
    status_code: Option<u16>,
    success: bool,
    error_type: Option<String>,
    error_message: Option<String>,
    bytes_in: u64,
    bytes_out: u64,
    sample_body: Option<String>,
    cancelled: bool,
}

#[derive(Debug, Clone, Copy)]
enum PhaseWorkload {
    Iterations(u64),
    DurationMs(u64),
}

#[derive(Debug)]
struct PhaseResult {
    samples: Vec<SampleResult>,
    cancelled: bool,
    started_at_ms: u64,
    finished_at_ms: u64,
}

#[derive(Default)]
struct RunningStats {
    count: u64,
    mean: f64,
    m2: f64,
    min: f64,
    max: f64,
}

impl RunningStats {
    fn add(&mut self, value: f64) {
        if self.count == 0 {
            self.min = value;
            self.max = value;
        } else {
            self.min = self.min.min(value);
            self.max = self.max.max(value);
        }

        self.count += 1;
        let delta = value - self.mean;
        self.mean += delta / self.count as f64;
        let delta2 = value - self.mean;
        self.m2 += delta * delta2;
    }

    fn stddev(&self) -> f64 {
        if self.count < 2 {
            return 0.0;
        }
        (self.m2 / (self.count as f64 - 1.0)).sqrt()
    }
}

#[derive(Default)]
struct SeriesBucket {
    success: u64,
    error: u64,
    latencies: Vec<f64>,
    bytes_in: u64,
    bytes_out: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

pub fn collect_environment_fingerprint() -> BenchmarkEnvironmentFingerprint {
    BenchmarkEnvironmentFingerprint {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cpu_count: std::thread::available_parallelism()
            .map(|value| value.get() as u32)
            .unwrap_or(1),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

pub async fn execute_benchmark(
    spec: BenchmarkSpecPayload,
    cancel_rx: &mut broadcast::Receiver<()>,
) -> Result<BenchmarkExecutionResult, String> {
    validate_spec(&spec)?;
    let client = Arc::new(build_client(&spec)?);
    let template = Arc::new(build_request_template(&spec)?);

    if let Some(workload) = warmup_workload(&spec) {
        let warmup = run_phase(
            client.clone(),
            template.clone(),
            workload,
            spec.load.concurrency,
            false,
            &spec.logging.save_bodies,
            cancel_rx,
        )
        .await?;

        if warmup.cancelled {
            return Ok(BenchmarkExecutionResult {
                metrics: BenchmarkAggregatedMetrics::default(),
                cancelled: true,
            });
        }
    }

    let measurement = run_phase(
        client,
        template,
        measurement_workload(&spec)?,
        spec.load.concurrency,
        true,
        &spec.logging.save_bodies,
        cancel_rx,
    )
    .await?;

    let metrics = aggregate_samples(
        measurement.samples,
        measurement.started_at_ms,
        measurement.finished_at_ms,
        spec.logging.sample_errors_top_k.max(1) as usize,
    )?;

    Ok(BenchmarkExecutionResult {
        metrics,
        cancelled: measurement.cancelled,
    })
}

fn validate_spec(spec: &BenchmarkSpecPayload) -> Result<(), String> {
    if spec.load.concurrency == 0 {
        return Err("Benchmark concurrency must be greater than 0".to_string());
    }
    if spec.timing.timeout_ms == 0 {
        return Err("Benchmark timeoutMs must be greater than 0".to_string());
    }
    measurement_workload(spec)?;
    Ok(())
}

fn warmup_workload(spec: &BenchmarkSpecPayload) -> Option<PhaseWorkload> {
    let warmup_iterations = spec.timing.warmup_iterations.unwrap_or(0);
    if warmup_iterations > 0 {
        return Some(PhaseWorkload::Iterations(warmup_iterations));
    }

    let warmup_duration = spec.timing.warmup_duration_ms.unwrap_or(0);
    if warmup_duration > 0 {
        return Some(PhaseWorkload::DurationMs(warmup_duration));
    }

    None
}

fn measurement_workload(spec: &BenchmarkSpecPayload) -> Result<PhaseWorkload, String> {
    match spec.load.mode {
        BenchmarkLoadMode::FixedIterations => {
            let iterations = spec.load.iterations.unwrap_or(0);
            if iterations == 0 {
                return Err("Benchmark fixed_iterations mode requires iterations > 0".to_string());
            }
            Ok(PhaseWorkload::Iterations(iterations))
        }
        BenchmarkLoadMode::FixedDuration => {
            let duration_ms = spec.load.duration_ms.unwrap_or(0);
            if duration_ms == 0 {
                return Err("Benchmark fixed_duration mode requires durationMs > 0".to_string());
            }
            Ok(PhaseWorkload::DurationMs(duration_ms))
        }
    }
}

fn build_client(spec: &BenchmarkSpecPayload) -> Result<Client, String> {
    let mut builder = Client::builder();
    builder = if spec.transport.follow_redirects {
        builder.redirect(reqwest::redirect::Policy::limited(10))
    } else {
        builder.redirect(reqwest::redirect::Policy::none())
    };
    builder = builder.timeout(Duration::from_millis(spec.timing.timeout_ms));

    if let Some(proxy_url) = spec
        .transport
        .proxy_url
        .as_ref()
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let proxy = Proxy::all(proxy_url).map_err(|err| format!("Invalid proxy URL: {err}"))?;
        builder = builder.proxy(proxy);
    }

    if !spec.transport.verify_ssl {
        builder = builder.danger_accept_invalid_certs(true);
    }

    if !spec.transport.keep_alive {
        builder = builder.pool_max_idle_per_host(0);
    }

    builder
        .build()
        .map_err(|err| format!("Failed to build benchmark HTTP client: {err}"))
}

fn build_request_template(spec: &BenchmarkSpecPayload) -> Result<RequestTemplate, String> {
    let method = Method::from_bytes(spec.target.request_snapshot.method.as_bytes())
        .map_err(|err| format!("Invalid benchmark method: {err}"))?;
    let headers = build_headers(&spec.target.request_snapshot.headers)?;
    let body = if should_send_body(&method) {
        spec.target.request_snapshot.body.clone()
    } else {
        None
    };

    let bytes_out = estimate_request_bytes(&headers, body.as_deref());

    Ok(RequestTemplate {
        method,
        url: spec.target.request_snapshot.url.clone(),
        headers,
        body,
        keep_alive: spec.transport.keep_alive,
        bytes_out,
    })
}

fn should_send_body(method: &Method) -> bool {
    !matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
}

fn estimate_request_bytes(headers: &HeaderMap, body: Option<&str>) -> u64 {
    let mut bytes = 0u64;
    for (name, value) in headers {
        bytes += name.as_str().len() as u64;
        bytes += value.as_bytes().len() as u64;
        bytes += 4;
    }
    if let Some(body) = body {
        bytes += body.as_bytes().len() as u64;
    }
    bytes
}

fn estimate_response_headers_bytes(headers: &HeaderMap) -> u64 {
    let mut bytes = 0u64;
    for (name, value) in headers {
        bytes += name.as_str().len() as u64;
        bytes += value.as_bytes().len() as u64;
        bytes += 4;
    }
    bytes
}

fn classify_reqwest_error(err: &reqwest::Error) -> BenchmarkErrorType {
    if err.is_timeout() {
        return BenchmarkErrorType::Timeout;
    }

    let message = err.to_string().to_ascii_lowercase();
    if message.contains("dns") || message.contains("failed to lookup address") {
        return BenchmarkErrorType::DnsError;
    }
    if message.contains("tls") || message.contains("ssl") || message.contains("certificate") {
        return BenchmarkErrorType::TlsError;
    }
    if err.is_connect() {
        return BenchmarkErrorType::ConnectError;
    }

    BenchmarkErrorType::ReadError
}

fn error_type_name(value: BenchmarkErrorType) -> &'static str {
    match value {
        BenchmarkErrorType::DnsError => "DNS_ERROR",
        BenchmarkErrorType::ConnectError => "CONNECT_ERROR",
        BenchmarkErrorType::TlsError => "TLS_ERROR",
        BenchmarkErrorType::Timeout => "TIMEOUT",
        BenchmarkErrorType::ReadError => "READ_ERROR",
        BenchmarkErrorType::HttpStatus4xx => "HTTP_STATUS_4XX",
        BenchmarkErrorType::HttpStatus5xx => "HTTP_STATUS_5XX",
        BenchmarkErrorType::Canceled => "CANCELED",
    }
}

async fn execute_single_request(
    client: &Client,
    template: &RequestTemplate,
    save_bodies: &BenchmarkSaveBodies,
    cancel_rx: &mut broadcast::Receiver<()>,
) -> SampleResult {
    let started_at = Instant::now();
    let mut request = client
        .request(template.method.clone(), &template.url)
        .headers(template.headers.clone());

    if !template.keep_alive {
        request = request.header(CONNECTION, HeaderValue::from_static("close"));
    }

    if let Some(body) = &template.body {
        request = request.body(body.clone());
    }

    let response_result = tokio::select! {
        response = request.send() => Some(response),
        _ = cancel_rx.recv() => None,
    };

    let completed_at = now_ms();
    let elapsed_ms = started_at.elapsed().as_secs_f64() * 1000.0;

    let Some(response_result) = response_result else {
        return SampleResult {
            timestamp_ms: completed_at,
            latency_ms: elapsed_ms,
            status_code: None,
            success: false,
            error_type: Some("CANCELED".to_string()),
            error_message: Some("Benchmark cancelled".to_string()),
            bytes_in: 0,
            bytes_out: template.bytes_out,
            sample_body: None,
            cancelled: true,
        };
    };

    match response_result {
        Ok(response) => {
            handle_response(
                response,
                elapsed_ms,
                completed_at,
                template.bytes_out,
                save_bodies,
                cancel_rx,
            )
            .await
        }
        Err(err) => {
            let error_type = classify_reqwest_error(&err);
            SampleResult {
                timestamp_ms: completed_at,
                latency_ms: elapsed_ms,
                status_code: None,
                success: false,
                error_type: Some(error_type_name(error_type).to_string()),
                error_message: Some(err.to_string()),
                bytes_in: 0,
                bytes_out: template.bytes_out,
                sample_body: None,
                cancelled: false,
            }
        }
    }
}

async fn handle_response(
    response: Response,
    elapsed_ms: f64,
    completed_at: u64,
    bytes_out: u64,
    save_bodies: &BenchmarkSaveBodies,
    cancel_rx: &mut broadcast::Receiver<()>,
) -> SampleResult {
    let status = response.status().as_u16();
    let status_family_error = if (400..500).contains(&status) {
        Some("HTTP_STATUS_4XX")
    } else if status >= 500 {
        Some("HTTP_STATUS_5XX")
    } else {
        None
    };

    let response_headers_bytes = estimate_response_headers_bytes(response.headers());
    let bytes_result = tokio::select! {
        body = response.bytes() => Some(body),
        _ = cancel_rx.recv() => None,
    };

    let Some(bytes_result) = bytes_result else {
        return SampleResult {
            timestamp_ms: completed_at,
            latency_ms: elapsed_ms,
            status_code: Some(status),
            success: false,
            error_type: Some("CANCELED".to_string()),
            error_message: Some("Benchmark cancelled".to_string()),
            bytes_in: response_headers_bytes,
            bytes_out,
            sample_body: None,
            cancelled: true,
        };
    };

    match bytes_result {
        Ok(body_bytes) => {
            let response_body_len = body_bytes.len() as u64;
            let sample_body = if status_family_error.is_some()
                && matches!(save_bodies, BenchmarkSaveBodies::Errors)
            {
                let capped = &body_bytes[..body_bytes.len().min(MAX_ERROR_BODY_BYTES)];
                Some(String::from_utf8_lossy(capped).to_string())
            } else {
                None
            };

            SampleResult {
                timestamp_ms: completed_at,
                latency_ms: elapsed_ms,
                status_code: Some(status),
                success: status < 400,
                error_type: status_family_error.map(str::to_string),
                error_message: status_family_error.map(|_| format!("HTTP {status}")),
                bytes_in: response_headers_bytes + response_body_len,
                bytes_out,
                sample_body,
                cancelled: false,
            }
        }
        Err(err) => SampleResult {
            timestamp_ms: completed_at,
            latency_ms: elapsed_ms,
            status_code: Some(status),
            success: false,
            error_type: Some("READ_ERROR".to_string()),
            error_message: Some(err.to_string()),
            bytes_in: response_headers_bytes,
            bytes_out,
            sample_body: None,
            cancelled: false,
        },
    }
}

fn cancel_requested(cancel_rx: &mut broadcast::Receiver<()>) -> bool {
    use tokio::sync::broadcast::error::TryRecvError;

    match cancel_rx.try_recv() {
        Ok(_) => true,
        Err(TryRecvError::Lagged(_)) => true,
        Err(TryRecvError::Closed) => true,
        Err(TryRecvError::Empty) => false,
    }
}

async fn run_phase(
    client: Arc<Client>,
    template: Arc<RequestTemplate>,
    workload: PhaseWorkload,
    concurrency: u32,
    collect_samples: bool,
    save_bodies: &BenchmarkSaveBodies,
    cancel_rx: &mut broadcast::Receiver<()>,
) -> Result<PhaseResult, String> {
    let worker_count = concurrency.max(1) as usize;
    let started_at_ms = now_ms();
    let cancelled = Arc::new(AtomicBool::new(false));
    let iteration_counter = Arc::new(AtomicU64::new(0));
    let deadline = match workload {
        PhaseWorkload::DurationMs(duration_ms) => {
            Some(Instant::now() + Duration::from_millis(duration_ms))
        }
        PhaseWorkload::Iterations(_) => None,
    };

    let (sample_tx, mut sample_rx) = if collect_samples {
        let (tx, rx) = mpsc::unbounded_channel();
        (Some(tx), Some(rx))
    } else {
        (None, None)
    };

    let mut handles = Vec::with_capacity(worker_count);
    for _ in 0..worker_count {
        let client = client.clone();
        let template = template.clone();
        let cancelled = cancelled.clone();
        let mut worker_cancel_rx = cancel_rx.resubscribe();
        let workload = workload;
        let iteration_counter = iteration_counter.clone();
        let deadline = deadline;
        let save_bodies = save_bodies.clone();
        let sample_tx = sample_tx.clone();

        let handle = tokio::spawn(async move {
            loop {
                if cancelled.load(Ordering::Relaxed) || cancel_requested(&mut worker_cancel_rx) {
                    cancelled.store(true, Ordering::Relaxed);
                    break;
                }

                match workload {
                    PhaseWorkload::Iterations(iterations) => {
                        let idx = iteration_counter.fetch_add(1, Ordering::Relaxed);
                        if idx >= iterations {
                            break;
                        }
                    }
                    PhaseWorkload::DurationMs(_) => {
                        if let Some(deadline) = deadline {
                            if Instant::now() >= deadline {
                                break;
                            }
                        }
                    }
                }

                let sample =
                    execute_single_request(&client, &template, &save_bodies, &mut worker_cancel_rx)
                        .await;

                if sample.cancelled {
                    cancelled.store(true, Ordering::Relaxed);
                    break;
                }

                if let Some(sample_tx) = &sample_tx {
                    let _ = sample_tx.send(sample);
                }
            }
        });
        handles.push(handle);
    }
    drop(sample_tx);

    for handle in handles {
        handle
            .await
            .map_err(|err| format!("Benchmark worker crashed: {err}"))?;
    }

    let mut samples = Vec::new();
    if let Some(sample_rx) = sample_rx.as_mut() {
        while let Some(sample) = sample_rx.recv().await {
            samples.push(sample);
        }
    }

    Ok(PhaseResult {
        samples,
        cancelled: cancelled.load(Ordering::Relaxed),
        started_at_ms,
        finished_at_ms: now_ms(),
    })
}

fn percentile(sorted_values: &[f64], pct: f64) -> f64 {
    if sorted_values.is_empty() {
        return 0.0;
    }
    let index = (((pct / 100.0) * sorted_values.len() as f64).ceil() as usize)
        .saturating_sub(1)
        .min(sorted_values.len() - 1);
    sorted_values[index]
}

fn round_to_3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn histogram_bucket_index(latency_ms: f64) -> usize {
    for idx in 0..HISTOGRAM_EDGES_MS.len() - 1 {
        if latency_ms >= HISTOGRAM_EDGES_MS[idx] && latency_ms < HISTOGRAM_EDGES_MS[idx + 1] {
            return idx;
        }
    }
    HISTOGRAM_EDGES_MS.len() - 2
}

fn aggregate_samples(
    samples: Vec<SampleResult>,
    started_at_ms: u64,
    finished_at_ms: u64,
    top_k_errors: usize,
) -> Result<BenchmarkAggregatedMetrics, String> {
    let mut summary = BenchmarkSummaryMetrics::default();
    let mut stats = RunningStats::default();
    let mut latency_histogram = Histogram::<u64>::new_with_bounds(1, 60_000_000, 3)
        .map_err(|err| format!("Failed to initialize latency histogram: {err}"))?;
    let mut histogram_counts = vec![0u64; HISTOGRAM_EDGES_MS.len() - 1];
    let mut series = BTreeMap::<u64, SeriesBucket>::new();
    let mut top_error_map = HashMap::<String, BenchmarkErrorSample>::new();

    for sample in samples {
        if sample.cancelled {
            continue;
        }

        summary.total_requests += 1;
        summary.bytes_in += sample.bytes_in;
        summary.bytes_out += sample.bytes_out;

        if sample.success {
            summary.success_count += 1;
        } else {
            summary.error_count += 1;
        }

        if let Some(status) = sample.status_code {
            *summary
                .status_code_counts
                .entry(status.to_string())
                .or_insert(0) += 1;
        }

        if let Some(error_type) = sample.error_type.clone() {
            *summary
                .error_type_counts
                .entry(error_type.clone())
                .or_insert(0) += 1;
            let key = format!(
                "{error_type}|{}|{}",
                sample.status_code.unwrap_or_default(),
                sample.error_message.clone().unwrap_or_default()
            );
            let entry = top_error_map
                .entry(key)
                .or_insert_with(|| BenchmarkErrorSample {
                    error_type,
                    status_code: sample.status_code,
                    message: sample
                        .error_message
                        .clone()
                        .unwrap_or_else(|| "Unknown benchmark error".to_string()),
                    count: 0,
                    sample_body: sample.sample_body.clone(),
                });
            entry.count += 1;
            if entry.sample_body.is_none() {
                entry.sample_body = sample.sample_body.clone();
            }
        }

        stats.add(sample.latency_ms);
        let latency_us = (sample.latency_ms * 1000.0).round().max(1.0) as u64;
        let latency_us = latency_us.min(60_000_000);
        let _ = latency_histogram.record(latency_us);
        histogram_counts[histogram_bucket_index(sample.latency_ms)] += 1;

        let bucket_ts = (sample.timestamp_ms / 1000) * 1000;
        let bucket = series.entry(bucket_ts).or_default();
        if sample.success {
            bucket.success += 1;
        } else {
            bucket.error += 1;
        }
        bucket.bytes_in += sample.bytes_in;
        bucket.bytes_out += sample.bytes_out;
        bucket.latencies.push(sample.latency_ms);
    }

    if summary.total_requests > 0 {
        summary.error_rate =
            round_to_3((summary.error_count as f64 / summary.total_requests as f64) * 100.0);

        let elapsed_secs =
            ((finished_at_ms.saturating_sub(started_at_ms)) as f64 / 1000.0).max(0.001);
        summary.rps_avg = round_to_3(summary.total_requests as f64 / elapsed_secs);

        let mut peak_rps = 0u64;
        for bucket in series.values() {
            peak_rps = peak_rps.max(bucket.success + bucket.error);
        }
        summary.rps_peak = round_to_3(peak_rps as f64);

        summary.latency = BenchmarkLatencyMetrics {
            min_ms: round_to_3(stats.min),
            avg_ms: round_to_3(stats.mean),
            max_ms: round_to_3(stats.max),
            stddev_ms: round_to_3(stats.stddev()),
            p50_ms: round_to_3(latency_histogram.value_at_quantile(0.50) as f64 / 1000.0),
            p90_ms: round_to_3(latency_histogram.value_at_quantile(0.90) as f64 / 1000.0),
            p95_ms: round_to_3(latency_histogram.value_at_quantile(0.95) as f64 / 1000.0),
            p99_ms: round_to_3(latency_histogram.value_at_quantile(0.99) as f64 / 1000.0),
        };
    }

    let mut timeseries = Vec::with_capacity(series.len());
    for (bucket_ts, bucket) in series {
        let mut sorted = bucket.latencies;
        sorted.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
        let latency_avg = if sorted.is_empty() {
            0.0
        } else {
            sorted.iter().sum::<f64>() / sorted.len() as f64
        };
        timeseries.push(BenchmarkTimeseriesPoint {
            bucket_ts_ms: bucket_ts,
            rps_success: bucket.success,
            rps_error: bucket.error,
            latency_p95_ms: round_to_3(percentile(&sorted, 95.0)),
            latency_avg_ms: round_to_3(latency_avg),
            bytes_in: bucket.bytes_in,
            bytes_out: bucket.bytes_out,
        });
    }

    let mut histogram = Vec::new();
    for idx in 0..histogram_counts.len() {
        let count = histogram_counts[idx];
        if count == 0 {
            continue;
        }
        histogram.push(BenchmarkHistogramBucket {
            lower_bound_ms: HISTOGRAM_EDGES_MS[idx],
            upper_bound_ms: HISTOGRAM_EDGES_MS[idx + 1],
            count,
        });
    }

    let mut top_errors: Vec<BenchmarkErrorSample> = top_error_map.into_values().collect();
    top_errors.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.error_type.cmp(&right.error_type))
    });
    top_errors.truncate(top_k_errors.max(1));

    Ok(BenchmarkAggregatedMetrics {
        summary,
        timeseries,
        histogram,
        top_errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{
        BenchmarkEnvConfig, BenchmarkLoadConfig, BenchmarkLoggingConfig, BenchmarkRequestSnapshot,
        BenchmarkTarget, BenchmarkTimingConfig, BenchmarkTransportConfig,
    };

    fn base_spec() -> BenchmarkSpecPayload {
        BenchmarkSpecPayload {
            id: None,
            name: None,
            target: BenchmarkTarget {
                request_id: Some("req-1".to_string()),
                request_snapshot: BenchmarkRequestSnapshot {
                    method: "GET".to_string(),
                    url: "https://example.com".to_string(),
                    headers: HashMap::new(),
                    body: None,
                },
            },
            load: BenchmarkLoadConfig {
                mode: BenchmarkLoadMode::FixedDuration,
                iterations: None,
                duration_ms: Some(1000),
                concurrency: 1,
            },
            transport: BenchmarkTransportConfig {
                keep_alive: true,
                follow_redirects: true,
                proxy_url: None,
                verify_ssl: true,
            },
            timing: BenchmarkTimingConfig {
                timeout_ms: 1000,
                warmup_duration_ms: None,
                warmup_iterations: None,
            },
            logging: BenchmarkLoggingConfig {
                sample_errors_top_k: 10,
                save_bodies: BenchmarkSaveBodies::None,
            },
            env: BenchmarkEnvConfig {
                variables_snapshot: HashMap::new(),
                random_seed: None,
            },
        }
    }

    fn sample(latency_ms: f64, status_code: u16, success: bool) -> SampleResult {
        SampleResult {
            timestamp_ms: 1000,
            latency_ms,
            status_code: Some(status_code),
            success,
            error_type: if success {
                None
            } else if status_code >= 500 {
                Some("HTTP_STATUS_5XX".to_string())
            } else {
                Some("HTTP_STATUS_4XX".to_string())
            },
            error_message: if success {
                None
            } else {
                Some(format!("HTTP {status_code}"))
            },
            bytes_in: 100,
            bytes_out: 50,
            sample_body: None,
            cancelled: false,
        }
    }

    #[test]
    fn aggregate_samples_computes_latency_percentiles() {
        let result = aggregate_samples(
            vec![
                sample(10.0, 200, true),
                sample(20.0, 200, true),
                sample(30.0, 200, true),
                sample(40.0, 200, true),
            ],
            0,
            1000,
            10,
        )
        .expect("aggregate metrics");

        assert_eq!(result.summary.total_requests, 4);
        assert_eq!(result.summary.success_count, 4);
        assert_eq!(result.summary.error_count, 0);
        assert!((result.summary.latency.p50_ms - 20.0).abs() < 0.1);
        assert!((result.summary.latency.p95_ms - 40.0).abs() < 0.1);
        assert!((result.summary.latency.p99_ms - 40.0).abs() < 0.1);
        assert_eq!(result.summary.rps_avg, 4.0);
    }

    #[test]
    fn aggregate_samples_tracks_errors_and_top_samples() {
        let mut timeout_sample = sample(15.0, 0, false);
        timeout_sample.status_code = None;
        timeout_sample.error_type = Some("TIMEOUT".to_string());
        timeout_sample.error_message = Some("timed out".to_string());

        let mut timeout_sample_2 = timeout_sample.clone();
        timeout_sample_2.timestamp_ms = 2000;

        let result = aggregate_samples(
            vec![
                sample(20.0, 503, false),
                timeout_sample,
                timeout_sample_2,
                sample(25.0, 200, true),
            ],
            0,
            2000,
            10,
        )
        .expect("aggregate metrics");

        assert_eq!(result.summary.total_requests, 4);
        assert_eq!(result.summary.error_count, 3);
        assert_eq!(result.summary.error_type_counts.get("TIMEOUT"), Some(&2));
        assert_eq!(
            result.summary.error_type_counts.get("HTTP_STATUS_5XX"),
            Some(&1)
        );
        assert_eq!(result.top_errors.first().map(|item| item.count), Some(2));
    }

    #[test]
    fn measurement_workload_requires_positive_duration_or_iterations() {
        let mut spec = base_spec();
        spec.load.mode = BenchmarkLoadMode::FixedDuration;
        spec.load.duration_ms = Some(0);
        assert!(measurement_workload(&spec).is_err());

        spec.load.mode = BenchmarkLoadMode::FixedIterations;
        spec.load.iterations = Some(0);
        assert!(measurement_workload(&spec).is_err());
    }
}
