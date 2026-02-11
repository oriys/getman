#![allow(dead_code)]
//! # Testing & Assertions (Phase 3)
//!
//! Provides assertion capabilities for HTTP responses and a collection runner
//! for batch execution of requests.
//!
//! ## Planned Features
//! - Response status / header / body JSONPath assertions
//! - Test result visualization (pass / fail / duration)
//! - Collection Runner (serial / parallel)
//! - Variable dataset-driven runs (CSV / JSON)
//! - Summary reports (success rate, failure reason distribution)

/// Target of an assertion within the HTTP response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssertionTarget {
    StatusCode,
    Header(String),
    JsonPath(String),
    BodyContains,
}

/// Comparison operator for an assertion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssertionOperator {
    Equals,
    NotEquals,
    Contains,
    GreaterThan,
    LessThan,
    Exists,
}

/// A single assertion that can be evaluated against a response.
#[derive(Debug, Clone)]
pub struct Assertion {
    pub target: AssertionTarget,
    pub operator: AssertionOperator,
    pub expected: String,
}

/// Result of evaluating an assertion.
#[derive(Debug, Clone)]
pub struct AssertionResult {
    pub assertion: Assertion,
    pub passed: bool,
    pub actual: String,
    pub message: String,
}

/// Execution mode for the collection runner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunMode {
    Serial,
    Parallel,
}

/// Summary report for a batch run.
#[derive(Debug, Clone, Default)]
pub struct RunReport {
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
    pub duration_ms: u128,
    pub results: Vec<AssertionResult>,
}
