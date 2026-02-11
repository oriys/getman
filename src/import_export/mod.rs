#![allow(dead_code)]
//! # Import / Export (Phase 2)
//!
//! Provides import and export capabilities for interoperability with other
//! API tools and for sharing Getman projects.
//!
//! ## Planned Features
//! - Postman Collection v2.1 import
//! - Getman Project export / import

/// Supported import source formats.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportFormat {
    PostmanV2_1,
    Getman,
}

/// Supported export target formats.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExportFormat {
    Getman,
}
