use crate::domain::{
    BenchmarkAggregatedMetrics, BenchmarkExportPayload, BenchmarkRunDetail, BenchmarkRunStatus,
    BenchmarkRunSummary, BenchmarkSpecPayload, BenchmarkStartResponse,
};
use crate::engine::benchmark::{
    collect_environment_fingerprint, execute_benchmark, BenchmarkRegistry,
};
use crate::store::sqlite::{self, StoredBenchmarkRunRow};
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

static BENCHMARK_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn generate_id(prefix: &str) -> String {
    let counter = BENCHMARK_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{}-{counter}", now_ms())
}

fn status_to_str(status: BenchmarkRunStatus) -> &'static str {
    match status {
        BenchmarkRunStatus::Queued => "queued",
        BenchmarkRunStatus::Running => "running",
        BenchmarkRunStatus::Completed => "completed",
        BenchmarkRunStatus::Cancelled => "cancelled",
        BenchmarkRunStatus::Failed => "failed",
    }
}

fn status_from_str(value: &str) -> BenchmarkRunStatus {
    match value {
        "queued" => BenchmarkRunStatus::Queued,
        "running" => BenchmarkRunStatus::Running,
        "completed" => BenchmarkRunStatus::Completed,
        "cancelled" => BenchmarkRunStatus::Cancelled,
        "failed" => BenchmarkRunStatus::Failed,
        _ => BenchmarkRunStatus::Failed,
    }
}

fn run_summary_from_row(row: &StoredBenchmarkRunRow) -> BenchmarkRunSummary {
    BenchmarkRunSummary {
        run_id: row.run_id.clone(),
        spec_id: row.spec_id.clone(),
        request_id: row.request_id.clone(),
        status: status_from_str(&row.status),
        created_at: row.created_at,
        started_at: row.started_at,
        finished_at: row.finished_at,
        spec_hash: Some(row.spec_hash.clone()),
    }
}

fn run_detail_from_row(
    conn: &rusqlite::Connection,
    row: StoredBenchmarkRunRow,
) -> Result<BenchmarkRunDetail, String> {
    let spec: BenchmarkSpecPayload = serde_json::from_str(&row.spec_json)
        .map_err(|err| format!("Failed to parse benchmark spec: {err}"))?;
    let environment_fingerprint = serde_json::from_str(&row.env_fingerprint_json)
        .map_err(|err| format!("Failed to parse benchmark environment fingerprint: {err}"))?;
    let metrics = if let Some(aggregated_json) = row.aggregated_json.clone() {
        let mut metrics: BenchmarkAggregatedMetrics = serde_json::from_str(&aggregated_json)
            .map_err(|err| format!("Failed to parse benchmark metrics: {err}"))?;
        metrics.timeseries = sqlite::load_benchmark_timeseries(conn, &row.run_id)?;
        metrics.histogram = sqlite::load_benchmark_histogram(conn, &row.run_id)?;
        metrics.top_errors = sqlite::load_benchmark_error_samples(conn, &row.run_id)?;
        Some(metrics)
    } else {
        None
    };

    Ok(BenchmarkRunDetail {
        run: run_summary_from_row(&row),
        spec,
        environment_fingerprint,
        metrics,
    })
}

#[tauri::command]
pub async fn start_benchmark(
    spec: BenchmarkSpecPayload,
    app: AppHandle,
    registry: State<'_, BenchmarkRegistry>,
) -> Result<BenchmarkStartResponse, String> {
    let run_id = generate_id("run");
    let spec_id = spec.id.clone().unwrap_or_else(|| generate_id("spec"));
    let created_at = now_ms();

    let spec_json =
        serde_json::to_string(&spec).map_err(|err| format!("Failed to serialize spec: {err}"))?;
    let spec_hash = format!("{:x}", md5::compute(spec_json.as_bytes()));
    let env_fingerprint = collect_environment_fingerprint();
    let env_fingerprint_json = serde_json::to_string(&env_fingerprint)
        .map_err(|err| format!("Failed to serialize benchmark environment: {err}"))?;

    {
        let conn = sqlite::open_db(&app)?;
        sqlite::upsert_benchmark_spec(&conn, &spec_id, &spec_hash, &spec_json, created_at)?;
        sqlite::insert_benchmark_run(
            &conn,
            &run_id,
            &spec_id,
            spec.target.request_id.as_deref(),
            status_to_str(BenchmarkRunStatus::Queued),
            created_at,
            &spec_hash,
            &env_fingerprint_json,
        )?;
    }

    let mut cancel_rx = registry.register(&run_id);
    let run_id_for_task = run_id.clone();
    let spec_for_task = spec.clone();
    let app_for_task = app.clone();
    let registry_for_task = registry.inner().clone();

    tauri::async_runtime::spawn(async move {
        let started_at = now_ms();
        if let Ok(conn) = sqlite::open_db(&app_for_task) {
            let _ = sqlite::update_benchmark_run(
                &conn,
                &run_id_for_task,
                status_to_str(BenchmarkRunStatus::Running),
                Some(started_at),
                None,
                None,
            );
        }

        let outcome = execute_benchmark(spec_for_task, &mut cancel_rx).await;
        let finished_at = now_ms();
        let update_result = match outcome {
            Ok(result) => {
                let status = if result.cancelled {
                    BenchmarkRunStatus::Cancelled
                } else {
                    BenchmarkRunStatus::Completed
                };
                let aggregated_json = serde_json::to_string(&result.metrics).ok();

                if let Ok(conn) = sqlite::open_db(&app_for_task) {
                    let _ = sqlite::update_benchmark_run(
                        &conn,
                        &run_id_for_task,
                        status_to_str(status),
                        Some(started_at),
                        Some(finished_at),
                        aggregated_json.as_deref(),
                    );
                    let _ = sqlite::replace_benchmark_timeseries(
                        &conn,
                        &run_id_for_task,
                        &result.metrics.timeseries,
                    );
                    let _ = sqlite::replace_benchmark_histogram(
                        &conn,
                        &run_id_for_task,
                        &result.metrics.histogram,
                    );
                    let _ = sqlite::replace_benchmark_error_samples(
                        &conn,
                        &run_id_for_task,
                        &result.metrics.top_errors,
                    );
                }
                Ok(())
            }
            Err(message) => {
                let status = if message.to_ascii_lowercase().contains("cancel") {
                    BenchmarkRunStatus::Cancelled
                } else {
                    BenchmarkRunStatus::Failed
                };
                if let Ok(conn) = sqlite::open_db(&app_for_task) {
                    let _ = sqlite::update_benchmark_run(
                        &conn,
                        &run_id_for_task,
                        status_to_str(status),
                        Some(started_at),
                        Some(finished_at),
                        None,
                    );
                }
                Err(message)
            }
        };

        if update_result.is_err() {
            let _ = update_result;
        }
        registry_for_task.remove(&run_id_for_task);
    });

    Ok(BenchmarkStartResponse { run_id })
}

#[tauri::command]
pub fn list_benchmark_runs(
    app: AppHandle,
    request_id: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<BenchmarkRunSummary>, String> {
    let conn = sqlite::open_db(&app)?;
    let rows = sqlite::list_benchmark_runs(&conn, request_id.as_deref(), limit.unwrap_or(50))?;
    Ok(rows.iter().map(run_summary_from_row).collect())
}

#[tauri::command]
pub fn get_benchmark_run(
    app: AppHandle,
    run_id: String,
) -> Result<Option<BenchmarkRunDetail>, String> {
    let conn = sqlite::open_db(&app)?;
    let Some(row) = sqlite::load_benchmark_run(&conn, &run_id)? else {
        return Ok(None);
    };
    let detail = run_detail_from_row(&conn, row)?;
    Ok(Some(detail))
}

#[tauri::command]
pub fn cancel_benchmark_run(run_id: String, registry: State<'_, BenchmarkRegistry>) -> bool {
    registry.cancel(&run_id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BenchmarkJsonExport {
    run: BenchmarkRunDetail,
}

#[tauri::command]
pub fn export_benchmark_run(
    app: AppHandle,
    run_id: String,
    format: Option<String>,
) -> Result<BenchmarkExportPayload, String> {
    let conn = sqlite::open_db(&app)?;
    let row = sqlite::load_benchmark_run(&conn, &run_id)?
        .ok_or_else(|| "Benchmark run not found".to_string())?;
    let detail = run_detail_from_row(&conn, row)?;

    match format
        .as_deref()
        .unwrap_or("json")
        .to_ascii_lowercase()
        .as_str()
    {
        "csv" => {
            let metrics = detail
                .metrics
                .as_ref()
                .ok_or_else(|| "Benchmark run has no metrics yet".to_string())?;

            let mut csv = String::from(
                "bucket_ts_ms,rps_success,rps_error,latency_p95_ms,latency_avg_ms,bytes_in,bytes_out\n",
            );
            for point in &metrics.timeseries {
                csv.push_str(&format!(
                    "{},{},{},{:.3},{:.3},{},{}\n",
                    point.bucket_ts_ms,
                    point.rps_success,
                    point.rps_error,
                    point.latency_p95_ms,
                    point.latency_avg_ms,
                    point.bytes_in,
                    point.bytes_out
                ));
            }

            Ok(BenchmarkExportPayload {
                file_name: format!("benchmark-{run_id}.csv"),
                mime_type: "text/csv".to_string(),
                content: csv,
            })
        }
        _ => {
            let json = serde_json::to_string_pretty(&BenchmarkJsonExport { run: detail })
                .map_err(|err| format!("Failed to serialize benchmark export: {err}"))?;
            Ok(BenchmarkExportPayload {
                file_name: format!("benchmark-{run_id}.json"),
                mime_type: "application/json".to_string(),
                content: json,
            })
        }
    }
}
