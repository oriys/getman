#![allow(dead_code)]
//! # CLI Support (Phase 3)
//!
//! Provides command-line interface for running collections in CI/CD pipelines.
//!
//! ## Planned Features
//! - `getman run collection.json --env prod`
//! - Exit codes and report file output for CI scenarios
//! - Machine-readable output formats (JSON, JUnit XML)

/// CLI configuration parsed from command-line arguments.
#[derive(Debug, Clone)]
pub struct CliConfig {
    pub collection_path: String,
    pub environment: Option<String>,
    pub output_format: OutputFormat,
    pub report_path: Option<String>,
}

/// Output format for CLI reports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutputFormat {
    Text,
    Json,
}

impl Default for OutputFormat {
    fn default() -> Self {
        OutputFormat::Text
    }
}
