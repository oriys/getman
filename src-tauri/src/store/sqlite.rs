use crate::domain::{BenchmarkErrorSample, BenchmarkHistogramBucket, BenchmarkTimeseriesPoint};
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub const APP_STATE_KEY: &str = "root";

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Failed to resolve app data dir: {err}"))?;

    fs::create_dir_all(&app_dir).map_err(|err| format!("Failed to create app data dir: {err}"))?;
    Ok(app_dir)
}

pub fn sqlite_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("getman.db"))
}

pub fn legacy_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("state.json"))
}

pub fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let path = sqlite_path(app)?;
    let conn = Connection::open(path).map_err(|err| format!("Failed to open SQLite: {err}"))?;

    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|err| format!("Failed to set SQLite journal mode: {err}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|err| format!("Failed to enable SQLite foreign keys: {err}"))?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_state (
         state_key TEXT PRIMARY KEY,
         state_json TEXT NOT NULL,
         updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
       );
       CREATE TABLE IF NOT EXISTS benchmark_specs (
         id TEXT PRIMARY KEY,
         spec_hash TEXT NOT NULL,
         spec_json TEXT NOT NULL,
         created_at INTEGER NOT NULL
       );
       CREATE TABLE IF NOT EXISTS benchmark_runs (
         run_id TEXT PRIMARY KEY,
         spec_id TEXT NOT NULL,
         request_id TEXT,
         status TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         started_at INTEGER,
         finished_at INTEGER,
         spec_hash TEXT NOT NULL,
         env_fingerprint_json TEXT NOT NULL,
         aggregated_json TEXT,
         FOREIGN KEY(spec_id) REFERENCES benchmark_specs(id)
       );
       CREATE INDEX IF NOT EXISTS idx_benchmark_runs_request_created
         ON benchmark_runs(request_id, created_at DESC);
       CREATE TABLE IF NOT EXISTS benchmark_timeseries (
         run_id TEXT NOT NULL,
         bucket_ts_ms INTEGER NOT NULL,
         rps_success INTEGER NOT NULL,
         rps_error INTEGER NOT NULL,
         latency_p95_ms REAL NOT NULL,
         latency_avg_ms REAL NOT NULL,
         bytes_in INTEGER NOT NULL,
         bytes_out INTEGER NOT NULL,
         PRIMARY KEY(run_id, bucket_ts_ms),
         FOREIGN KEY(run_id) REFERENCES benchmark_runs(run_id) ON DELETE CASCADE
       );
       CREATE TABLE IF NOT EXISTS benchmark_histogram (
         run_id TEXT NOT NULL,
         lower_bound_ms REAL NOT NULL,
         upper_bound_ms REAL NOT NULL,
         count INTEGER NOT NULL,
         PRIMARY KEY(run_id, lower_bound_ms, upper_bound_ms),
         FOREIGN KEY(run_id) REFERENCES benchmark_runs(run_id) ON DELETE CASCADE
       );
       CREATE TABLE IF NOT EXISTS benchmark_error_samples (
         run_id TEXT NOT NULL,
         error_type TEXT NOT NULL,
         status_code INTEGER,
         message TEXT NOT NULL,
         count INTEGER NOT NULL,
         sample_body TEXT,
         PRIMARY KEY(run_id, error_type, status_code, message),
         FOREIGN KEY(run_id) REFERENCES benchmark_runs(run_id) ON DELETE CASCADE
       );",
    )
    .map_err(|err| format!("Failed to initialize SQLite schema: {err}"))?;

    Ok(conn)
}

pub fn upsert_state(conn: &Connection, state_json: &str) -> Result<(), String> {
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

pub fn load_state(conn: &Connection) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT state_json FROM app_state WHERE state_key = ?1 LIMIT 1;",
        params![APP_STATE_KEY],
        |row| row.get(0),
    )
    .optional()
    .map_err(|err| format!("Failed to load app state from SQLite: {err}"))
}

#[derive(Debug, Clone)]
pub struct StoredBenchmarkRunRow {
    pub run_id: String,
    pub spec_id: String,
    pub request_id: Option<String>,
    pub status: String,
    pub created_at: u64,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub spec_hash: String,
    pub spec_json: String,
    pub env_fingerprint_json: String,
    pub aggregated_json: Option<String>,
}

pub fn upsert_benchmark_spec(
    conn: &Connection,
    spec_id: &str,
    spec_hash: &str,
    spec_json: &str,
    created_at: u64,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO benchmark_specs (id, spec_hash, spec_json, created_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
           spec_hash = excluded.spec_hash,
           spec_json = excluded.spec_json;",
        params![spec_id, spec_hash, spec_json, created_at as i64],
    )
    .map_err(|err| format!("Failed to upsert benchmark spec: {err}"))?;
    Ok(())
}

pub fn insert_benchmark_run(
    conn: &Connection,
    run_id: &str,
    spec_id: &str,
    request_id: Option<&str>,
    status: &str,
    created_at: u64,
    spec_hash: &str,
    env_fingerprint_json: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO benchmark_runs (
           run_id, spec_id, request_id, status, created_at, spec_hash, env_fingerprint_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
        params![
            run_id,
            spec_id,
            request_id,
            status,
            created_at as i64,
            spec_hash,
            env_fingerprint_json
        ],
    )
    .map_err(|err| format!("Failed to insert benchmark run: {err}"))?;
    Ok(())
}

pub fn update_benchmark_run(
    conn: &Connection,
    run_id: &str,
    status: &str,
    started_at: Option<u64>,
    finished_at: Option<u64>,
    aggregated_json: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE benchmark_runs
         SET status = ?2,
             started_at = COALESCE(?3, started_at),
             finished_at = ?4,
             aggregated_json = ?5
         WHERE run_id = ?1;",
        params![
            run_id,
            status,
            started_at.map(|value| value as i64),
            finished_at.map(|value| value as i64),
            aggregated_json
        ],
    )
    .map_err(|err| format!("Failed to update benchmark run: {err}"))?;
    Ok(())
}

pub fn load_benchmark_run(
    conn: &Connection,
    run_id: &str,
) -> Result<Option<StoredBenchmarkRunRow>, String> {
    conn.query_row(
        "SELECT r.run_id, r.spec_id, r.request_id, r.status, r.created_at, r.started_at, r.finished_at,
                r.spec_hash, s.spec_json, r.env_fingerprint_json, r.aggregated_json
         FROM benchmark_runs r
         JOIN benchmark_specs s ON s.id = r.spec_id
         WHERE r.run_id = ?1
         LIMIT 1;",
        params![run_id],
        |row| {
            Ok(StoredBenchmarkRunRow {
                run_id: row.get(0)?,
                spec_id: row.get(1)?,
                request_id: row.get(2)?,
                status: row.get(3)?,
                created_at: row.get::<_, i64>(4)? as u64,
                started_at: row.get::<_, Option<i64>>(5)?.map(|value| value as u64),
                finished_at: row.get::<_, Option<i64>>(6)?.map(|value| value as u64),
                spec_hash: row.get(7)?,
                spec_json: row.get(8)?,
                env_fingerprint_json: row.get(9)?,
                aggregated_json: row.get(10)?,
            })
        },
    )
    .optional()
    .map_err(|err| format!("Failed to load benchmark run: {err}"))
}

pub fn list_benchmark_runs(
    conn: &Connection,
    request_id: Option<&str>,
    limit: u32,
) -> Result<Vec<StoredBenchmarkRunRow>, String> {
    let limit = (limit.max(1).min(200)) as i64;
    let mut items = Vec::new();

    if let Some(request_id) = request_id {
        let mut stmt = conn
            .prepare(
                "SELECT r.run_id, r.spec_id, r.request_id, r.status, r.created_at, r.started_at, r.finished_at,
                        r.spec_hash, s.spec_json, r.env_fingerprint_json, r.aggregated_json
                 FROM benchmark_runs r
                 JOIN benchmark_specs s ON s.id = r.spec_id
                 WHERE r.request_id = ?1
                 ORDER BY r.created_at DESC
                 LIMIT ?2;",
            )
            .map_err(|err| format!("Failed to query benchmark runs: {err}"))?;

        let rows = stmt
            .query_map(params![request_id, limit], |row| {
                Ok(StoredBenchmarkRunRow {
                    run_id: row.get(0)?,
                    spec_id: row.get(1)?,
                    request_id: row.get(2)?,
                    status: row.get(3)?,
                    created_at: row.get::<_, i64>(4)? as u64,
                    started_at: row.get::<_, Option<i64>>(5)?.map(|value| value as u64),
                    finished_at: row.get::<_, Option<i64>>(6)?.map(|value| value as u64),
                    spec_hash: row.get(7)?,
                    spec_json: row.get(8)?,
                    env_fingerprint_json: row.get(9)?,
                    aggregated_json: row.get(10)?,
                })
            })
            .map_err(|err| format!("Failed to map benchmark runs: {err}"))?;

        for row in rows {
            items.push(row.map_err(|err| format!("Failed to read benchmark run: {err}"))?);
        }
        return Ok(items);
    }

    let mut stmt = conn
        .prepare(
            "SELECT r.run_id, r.spec_id, r.request_id, r.status, r.created_at, r.started_at, r.finished_at,
                    r.spec_hash, s.spec_json, r.env_fingerprint_json, r.aggregated_json
             FROM benchmark_runs r
             JOIN benchmark_specs s ON s.id = r.spec_id
             ORDER BY r.created_at DESC
             LIMIT ?1;",
        )
        .map_err(|err| format!("Failed to query benchmark runs: {err}"))?;

    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(StoredBenchmarkRunRow {
                run_id: row.get(0)?,
                spec_id: row.get(1)?,
                request_id: row.get(2)?,
                status: row.get(3)?,
                created_at: row.get::<_, i64>(4)? as u64,
                started_at: row.get::<_, Option<i64>>(5)?.map(|value| value as u64),
                finished_at: row.get::<_, Option<i64>>(6)?.map(|value| value as u64),
                spec_hash: row.get(7)?,
                spec_json: row.get(8)?,
                env_fingerprint_json: row.get(9)?,
                aggregated_json: row.get(10)?,
            })
        })
        .map_err(|err| format!("Failed to map benchmark runs: {err}"))?;

    for row in rows {
        items.push(row.map_err(|err| format!("Failed to read benchmark run: {err}"))?);
    }

    Ok(items)
}

pub fn replace_benchmark_timeseries(
    conn: &Connection,
    run_id: &str,
    points: &[BenchmarkTimeseriesPoint],
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM benchmark_timeseries WHERE run_id = ?1;",
        params![run_id],
    )
    .map_err(|err| format!("Failed to clear benchmark timeseries: {err}"))?;

    for point in points {
        conn.execute(
            "INSERT INTO benchmark_timeseries (
               run_id, bucket_ts_ms, rps_success, rps_error, latency_p95_ms, latency_avg_ms, bytes_in, bytes_out
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8);",
            params![
                run_id,
                point.bucket_ts_ms as i64,
                point.rps_success as i64,
                point.rps_error as i64,
                point.latency_p95_ms,
                point.latency_avg_ms,
                point.bytes_in as i64,
                point.bytes_out as i64
            ],
        )
        .map_err(|err| format!("Failed to insert benchmark timeseries: {err}"))?;
    }

    Ok(())
}

pub fn replace_benchmark_histogram(
    conn: &Connection,
    run_id: &str,
    buckets: &[BenchmarkHistogramBucket],
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM benchmark_histogram WHERE run_id = ?1;",
        params![run_id],
    )
    .map_err(|err| format!("Failed to clear benchmark histogram: {err}"))?;

    for bucket in buckets {
        conn.execute(
            "INSERT INTO benchmark_histogram (run_id, lower_bound_ms, upper_bound_ms, count)
             VALUES (?1, ?2, ?3, ?4);",
            params![
                run_id,
                bucket.lower_bound_ms,
                bucket.upper_bound_ms,
                bucket.count as i64
            ],
        )
        .map_err(|err| format!("Failed to insert benchmark histogram: {err}"))?;
    }

    Ok(())
}

pub fn replace_benchmark_error_samples(
    conn: &Connection,
    run_id: &str,
    samples: &[BenchmarkErrorSample],
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM benchmark_error_samples WHERE run_id = ?1;",
        params![run_id],
    )
    .map_err(|err| format!("Failed to clear benchmark error samples: {err}"))?;

    for sample in samples {
        conn.execute(
            "INSERT INTO benchmark_error_samples (
               run_id, error_type, status_code, message, count, sample_body
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
            params![
                run_id,
                &sample.error_type,
                sample.status_code.map(|value| value as i64),
                &sample.message,
                sample.count as i64,
                sample.sample_body.as_deref()
            ],
        )
        .map_err(|err| format!("Failed to insert benchmark error sample: {err}"))?;
    }

    Ok(())
}

pub fn load_benchmark_timeseries(
    conn: &Connection,
    run_id: &str,
) -> Result<Vec<BenchmarkTimeseriesPoint>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT bucket_ts_ms, rps_success, rps_error, latency_p95_ms, latency_avg_ms, bytes_in, bytes_out
             FROM benchmark_timeseries
             WHERE run_id = ?1
             ORDER BY bucket_ts_ms ASC;",
        )
        .map_err(|err| format!("Failed to query benchmark timeseries: {err}"))?;

    let rows = stmt
        .query_map(params![run_id], |row| {
            Ok(BenchmarkTimeseriesPoint {
                bucket_ts_ms: row.get::<_, i64>(0)? as u64,
                rps_success: row.get::<_, i64>(1)? as u64,
                rps_error: row.get::<_, i64>(2)? as u64,
                latency_p95_ms: row.get(3)?,
                latency_avg_ms: row.get(4)?,
                bytes_in: row.get::<_, i64>(5)? as u64,
                bytes_out: row.get::<_, i64>(6)? as u64,
            })
        })
        .map_err(|err| format!("Failed to map benchmark timeseries: {err}"))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|err| format!("Failed to read benchmark timeseries: {err}"))?);
    }
    Ok(items)
}

pub fn load_benchmark_histogram(
    conn: &Connection,
    run_id: &str,
) -> Result<Vec<BenchmarkHistogramBucket>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT lower_bound_ms, upper_bound_ms, count
             FROM benchmark_histogram
             WHERE run_id = ?1
             ORDER BY lower_bound_ms ASC;",
        )
        .map_err(|err| format!("Failed to query benchmark histogram: {err}"))?;

    let rows = stmt
        .query_map(params![run_id], |row| {
            Ok(BenchmarkHistogramBucket {
                lower_bound_ms: row.get(0)?,
                upper_bound_ms: row.get(1)?,
                count: row.get::<_, i64>(2)? as u64,
            })
        })
        .map_err(|err| format!("Failed to map benchmark histogram: {err}"))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|err| format!("Failed to read benchmark histogram: {err}"))?);
    }
    Ok(items)
}

pub fn load_benchmark_error_samples(
    conn: &Connection,
    run_id: &str,
) -> Result<Vec<BenchmarkErrorSample>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT error_type, status_code, message, count, sample_body
             FROM benchmark_error_samples
             WHERE run_id = ?1
             ORDER BY count DESC, error_type ASC;",
        )
        .map_err(|err| format!("Failed to query benchmark error samples: {err}"))?;

    let rows = stmt
        .query_map(params![run_id], |row| {
            Ok(BenchmarkErrorSample {
                error_type: row.get(0)?,
                status_code: row.get::<_, Option<i64>>(1)?.map(|value| value as u16),
                message: row.get(2)?,
                count: row.get::<_, i64>(3)? as u64,
                sample_body: row.get(4)?,
            })
        })
        .map_err(|err| format!("Failed to map benchmark error samples: {err}"))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|err| format!("Failed to read benchmark error sample: {err}"))?);
    }
    Ok(items)
}
