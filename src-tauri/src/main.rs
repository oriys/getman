mod commands;
mod domain;
mod engine;
mod store;

use commands::benchmark_commands::{
    cancel_benchmark_run, export_benchmark_run, get_benchmark_run, list_benchmark_runs,
    start_benchmark,
};
use commands::env_commands::resolve_request;
use commands::grpc_commands::{fetch_grpc_reflection, parse_proto_content, send_grpc_request};
use commands::http_commands::{cancel_http_request, send_http_request};
use commands::state_commands::{load_app_state, save_app_state};
use engine::benchmark::BenchmarkRegistry;
use engine::cancel::CancelRegistry;

fn main() {
    tauri::Builder::default()
        .manage(CancelRegistry::new())
        .manage(BenchmarkRegistry::new())
        .invoke_handler(tauri::generate_handler![
            send_http_request,
            cancel_http_request,
            load_app_state,
            save_app_state,
            parse_proto_content,
            send_grpc_request,
            fetch_grpc_reflection,
            resolve_request,
            start_benchmark,
            list_benchmark_runs,
            get_benchmark_run,
            cancel_benchmark_run,
            export_benchmark_run
        ])
        .run(tauri::generate_context!())
        .expect("failed to run getman");
}
