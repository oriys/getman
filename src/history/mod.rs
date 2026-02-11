#![allow(dead_code)]
//! # Request History (Phase 1)
//!
//! Tracks the most recent HTTP requests for quick re-use.
//!
//! ## Planned Features
//! - Store last 100 requests
//! - Timestamp, method, URL, status code per entry
//! - Quick re-send from history

use std::collections::VecDeque;

use crate::http::method::HttpMethod;

/// Maximum number of history entries to retain.
const MAX_HISTORY_ENTRIES: usize = 100;

/// A single history entry recording a past request and its outcome.
#[derive(Debug, Clone)]
pub struct HistoryEntry {
    pub timestamp: u64,
    pub method: HttpMethod,
    pub url: String,
    pub status: Option<String>,
    pub duration_ms: Option<u128>,
}

/// Manages the request history list.
#[derive(Debug, Clone, Default)]
pub struct History {
    entries: VecDeque<HistoryEntry>,
}

impl History {
    pub fn new() -> Self {
        Self {
            entries: VecDeque::new(),
        }
    }

    /// Add an entry to the front of the history list, evicting the oldest
    /// entry if the list exceeds the maximum size.
    pub fn push(&mut self, entry: HistoryEntry) {
        if self.entries.len() >= MAX_HISTORY_ENTRIES {
            self.entries.pop_back();
        }
        self.entries.push_front(entry);
    }

    /// Return all history entries (most recent first).
    pub fn entries(&self) -> &VecDeque<HistoryEntry> {
        &self.entries
    }

    /// Clear all history entries.
    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_entry(url: &str) -> HistoryEntry {
        HistoryEntry {
            timestamp: 0,
            method: HttpMethod::Get,
            url: url.to_string(),
            status: None,
            duration_ms: None,
        }
    }

    #[test]
    fn push_and_retrieve() {
        let mut history = History::new();
        history.push(make_entry("https://a.com"));
        history.push(make_entry("https://b.com"));

        assert_eq!(history.entries().len(), 2);
        assert_eq!(history.entries()[0].url, "https://b.com");
        assert_eq!(history.entries()[1].url, "https://a.com");
    }

    #[test]
    fn evicts_oldest_when_full() {
        let mut history = History::new();
        for i in 0..MAX_HISTORY_ENTRIES + 5 {
            history.push(make_entry(&format!("https://example.com/{i}")));
        }
        assert_eq!(history.entries().len(), MAX_HISTORY_ENTRIES);
        // Most recent is first
        assert_eq!(
            history.entries()[0].url,
            format!("https://example.com/{}", MAX_HISTORY_ENTRIES + 4)
        );
    }

    #[test]
    fn clear_empties_entries() {
        let mut history = History::new();
        history.push(make_entry("https://a.com"));
        history.clear();
        assert!(history.entries().is_empty());
    }
}
