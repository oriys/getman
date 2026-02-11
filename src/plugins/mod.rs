#![allow(dead_code)]
//! # Plugin System (Phase 4)
//!
//! Provides an extension mechanism with pre/post request hooks and
//! custom script extension points in a restricted sandbox.
//!
//! ## Planned Features
//! - Plugin mechanism (pre/post request hooks)
//! - Custom script extension points (restricted sandbox)

/// Lifecycle event at which a plugin hook can execute.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HookEvent {
    BeforeRequest,
    AfterResponse,
}

/// A registered plugin hook.
#[derive(Debug, Clone)]
pub struct PluginHook {
    pub name: String,
    pub event: HookEvent,
    pub script: String,
    pub enabled: bool,
}
