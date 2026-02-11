#![allow(dead_code)]
//! # Collection Management (Phase 2)
//!
//! Manages collections of saved HTTP requests, organized in a directory tree
//! structure with support for grouping, rename, copy, and drag-and-drop.
//!
//! ## Planned Features
//! - Directory tree with request grouping
//! - Local persistence and fast search
//! - Rename / copy / drag-and-drop reordering

use std::collections::HashMap;

/// A unique identifier for a collection item.
pub type CollectionId = u64;

/// Represents a saved HTTP request within a collection.
#[derive(Debug, Clone)]
pub struct SavedRequest {
    pub id: CollectionId,
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: String,
    pub body: String,
}

/// Represents a folder that can contain requests or sub-folders.
#[derive(Debug, Clone)]
pub struct Folder {
    pub id: CollectionId,
    pub name: String,
    pub items: Vec<CollectionItem>,
}

/// A collection item is either a request or a nested folder.
#[derive(Debug, Clone)]
pub enum CollectionItem {
    Request(SavedRequest),
    Folder(Folder),
}

/// Root collection containing all folders and requests.
#[derive(Debug, Clone, Default)]
pub struct Collection {
    pub name: String,
    pub items: Vec<CollectionItem>,
    pub variables: HashMap<String, String>,
}
