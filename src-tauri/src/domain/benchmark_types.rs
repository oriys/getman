use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkRequestSnapshot {
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkTarget {
    #[serde(default)]
    pub request_id: Option<String>,
    pub request_snapshot: BenchmarkRequestSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BenchmarkLoadMode {
    FixedIterations,
    FixedDuration,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkLoadConfig {
    pub mode: BenchmarkLoadMode,
    #[serde(default)]
    pub iterations: Option<u64>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    pub concurrency: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkTransportConfig {
    pub keep_alive: bool,
    pub follow_redirects: bool,
    #[serde(default)]
    pub proxy_url: Option<String>,
    #[serde(default = "default_verify_ssl")]
    pub verify_ssl: bool,
}

fn default_verify_ssl() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkTimingConfig {
    pub timeout_ms: u64,
    #[serde(default)]
    pub warmup_duration_ms: Option<u64>,
    #[serde(default)]
    pub warmup_iterations: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BenchmarkSaveBodies {
    None,
    Errors,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkLoggingConfig {
    pub sample_errors_top_k: u32,
    pub save_bodies: BenchmarkSaveBodies,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkEnvConfig {
    #[serde(default)]
    pub variables_snapshot: HashMap<String, String>,
    #[serde(default)]
    pub random_seed: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkSpecPayload {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    pub target: BenchmarkTarget,
    pub load: BenchmarkLoadConfig,
    pub transport: BenchmarkTransportConfig,
    pub timing: BenchmarkTimingConfig,
    pub logging: BenchmarkLoggingConfig,
    pub env: BenchmarkEnvConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BenchmarkRunStatus {
    Queued,
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BenchmarkErrorType {
    DnsError,
    ConnectError,
    TlsError,
    Timeout,
    ReadError,
    HttpStatus4xx,
    HttpStatus5xx,
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkLatencyMetrics {
    pub min_ms: f64,
    pub avg_ms: f64,
    pub max_ms: f64,
    pub stddev_ms: f64,
    pub p50_ms: f64,
    pub p90_ms: f64,
    pub p95_ms: f64,
    pub p99_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkSummaryMetrics {
    pub total_requests: u64,
    pub success_count: u64,
    pub error_count: u64,
    pub error_rate: f64,
    pub rps_avg: f64,
    pub rps_peak: f64,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub latency: BenchmarkLatencyMetrics,
    #[serde(default)]
    pub status_code_counts: HashMap<String, u64>,
    #[serde(default)]
    pub error_type_counts: HashMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkTimeseriesPoint {
    pub bucket_ts_ms: u64,
    pub rps_success: u64,
    pub rps_error: u64,
    pub latency_p95_ms: f64,
    pub latency_avg_ms: f64,
    pub bytes_in: u64,
    pub bytes_out: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkHistogramBucket {
    pub lower_bound_ms: f64,
    pub upper_bound_ms: f64,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkErrorSample {
    pub error_type: String,
    #[serde(default)]
    pub status_code: Option<u16>,
    pub message: String,
    pub count: u64,
    #[serde(default)]
    pub sample_body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkAggregatedMetrics {
    pub summary: BenchmarkSummaryMetrics,
    #[serde(default)]
    pub timeseries: Vec<BenchmarkTimeseriesPoint>,
    #[serde(default)]
    pub histogram: Vec<BenchmarkHistogramBucket>,
    #[serde(default)]
    pub top_errors: Vec<BenchmarkErrorSample>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkEnvironmentFingerprint {
    pub os: String,
    pub arch: String,
    pub cpu_count: u32,
    pub app_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkRunSummary {
    pub run_id: String,
    pub spec_id: String,
    #[serde(default)]
    pub request_id: Option<String>,
    pub status: BenchmarkRunStatus,
    pub created_at: u64,
    #[serde(default)]
    pub started_at: Option<u64>,
    #[serde(default)]
    pub finished_at: Option<u64>,
    #[serde(default)]
    pub spec_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkRunDetail {
    pub run: BenchmarkRunSummary,
    pub spec: BenchmarkSpecPayload,
    pub environment_fingerprint: BenchmarkEnvironmentFingerprint,
    #[serde(default)]
    pub metrics: Option<BenchmarkAggregatedMetrics>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkStartResponse {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkExportPayload {
    pub file_name: String,
    pub mime_type: String,
    pub content: String,
}
