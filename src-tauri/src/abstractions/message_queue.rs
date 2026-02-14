use super::tenant::TenantContext;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

/// A message in the queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub topic: String,
    pub payload: serde_json::Value,
    pub metadata: HashMap<String, String>,
    pub timestamp: i64,
}

/// Options for publishing a message.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PublishOptions {
    /// Optional delay in seconds before the message is delivered.
    #[serde(default)]
    pub delay_secs: Option<u64>,
    /// Optional message priority (higher = more urgent).
    #[serde(default)]
    pub priority: Option<u32>,
}

/// Subscription handle identifier.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct SubscriptionId(pub String);

/// Abstract message queue trait for pluggable messaging backends.
///
/// All operations are scoped to a tenant context for isolation.
pub trait MessageQueue: Send + Sync {
    /// Publish a message to a topic.
    fn publish(
        &self,
        tenant: &TenantContext,
        topic: &str,
        payload: serde_json::Value,
        options: PublishOptions,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + '_>>;

    /// Subscribe to a topic. Returns a subscription ID.
    fn subscribe(
        &self,
        tenant: &TenantContext,
        topic: &str,
    ) -> Pin<Box<dyn Future<Output = Result<SubscriptionId, String>> + Send + '_>>;

    /// Poll for the next message on a subscription.
    fn poll(
        &self,
        tenant: &TenantContext,
        subscription_id: &SubscriptionId,
    ) -> Pin<Box<dyn Future<Output = Result<Option<Message>, String>> + Send + '_>>;

    /// Acknowledge a message has been processed.
    fn acknowledge(
        &self,
        tenant: &TenantContext,
        message_id: &str,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>>;

    /// Unsubscribe from a topic.
    fn unsubscribe(
        &self,
        tenant: &TenantContext,
        subscription_id: &SubscriptionId,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>>;
}

/// In-memory message queue implementation for local desktop use.
pub struct InMemoryQueue {
    messages: tokio::sync::RwLock<HashMap<String, Vec<Message>>>,
    subscriptions: tokio::sync::RwLock<HashMap<String, Vec<String>>>,
    next_id: std::sync::atomic::AtomicU64,
}

impl InMemoryQueue {
    pub fn new() -> Self {
        Self {
            messages: tokio::sync::RwLock::new(HashMap::new()),
            subscriptions: tokio::sync::RwLock::new(HashMap::new()),
            next_id: std::sync::atomic::AtomicU64::new(1),
        }
    }

    fn scoped_topic(tenant: &TenantContext, topic: &str) -> String {
        tenant.scoped_key(topic)
    }

    fn next_id(&self) -> String {
        let id = self
            .next_id
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        format!("msg-{id}")
    }
}

impl Default for InMemoryQueue {
    fn default() -> Self {
        Self::new()
    }
}

impl MessageQueue for InMemoryQueue {
    fn publish(
        &self,
        tenant: &TenantContext,
        topic: &str,
        payload: serde_json::Value,
        _options: PublishOptions,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + '_>> {
        let scoped_topic = Self::scoped_topic(tenant, topic);
        let topic_name = topic.to_string();
        let msg_id = self.next_id();
        Box::pin(async move {
            let message = Message {
                id: msg_id.clone(),
                topic: topic_name,
                payload,
                metadata: HashMap::new(),
                timestamp: chrono_now(),
            };
            let mut store = self.messages.write().await;
            store.entry(scoped_topic).or_default().push(message);
            Ok(msg_id)
        })
    }

    fn subscribe(
        &self,
        tenant: &TenantContext,
        topic: &str,
    ) -> Pin<Box<dyn Future<Output = Result<SubscriptionId, String>> + Send + '_>> {
        let scoped_topic = Self::scoped_topic(tenant, topic);
        let sub_id = self.next_id();
        Box::pin(async move {
            let mut subs = self.subscriptions.write().await;
            subs.entry(sub_id.clone())
                .or_default()
                .push(scoped_topic);
            Ok(SubscriptionId(sub_id))
        })
    }

    fn poll(
        &self,
        _tenant: &TenantContext,
        subscription_id: &SubscriptionId,
    ) -> Pin<Box<dyn Future<Output = Result<Option<Message>, String>> + Send + '_>> {
        let sub_id = subscription_id.0.clone();
        Box::pin(async move {
            let subs = self.subscriptions.read().await;
            let topics = match subs.get(&sub_id) {
                Some(t) => t.clone(),
                None => return Err(format!("Subscription not found: {sub_id}")),
            };
            drop(subs);

            let mut store = self.messages.write().await;
            for topic in &topics {
                if let Some(queue) = store.get_mut(topic) {
                    if !queue.is_empty() {
                        return Ok(Some(queue.remove(0)));
                    }
                }
            }
            Ok(None)
        })
    }

    fn acknowledge(
        &self,
        _tenant: &TenantContext,
        _message_id: &str,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>> {
        // In-memory implementation: no-op since messages are removed on poll.
        Box::pin(async { Ok(()) })
    }

    fn unsubscribe(
        &self,
        _tenant: &TenantContext,
        subscription_id: &SubscriptionId,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>> {
        let sub_id = subscription_id.0.clone();
        Box::pin(async move {
            let mut subs = self.subscriptions.write().await;
            subs.remove(&sub_id);
            Ok(())
        })
    }
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abstractions::tenant::TenantContext;

    #[tokio::test]
    async fn test_publish_and_poll() {
        let queue = InMemoryQueue::new();
        let tenant = TenantContext::new("t1", "T1");

        let sub = queue.subscribe(&tenant, "events").await.unwrap();

        let msg_id = queue
            .publish(&tenant, "events", serde_json::json!({"action": "click"}), PublishOptions::default())
            .await
            .unwrap();
        assert!(!msg_id.is_empty());

        let msg = queue.poll(&tenant, &sub).await.unwrap();
        assert!(msg.is_some());
        assert_eq!(msg.unwrap().payload["action"], "click");

        // Queue should now be empty.
        let empty = queue.poll(&tenant, &sub).await.unwrap();
        assert!(empty.is_none());
    }

    #[tokio::test]
    async fn test_tenant_isolation() {
        let queue = InMemoryQueue::new();
        let t1 = TenantContext::new("t1", "T1");
        let t2 = TenantContext::new("t2", "T2");

        let sub1 = queue.subscribe(&t1, "events").await.unwrap();
        let sub2 = queue.subscribe(&t2, "events").await.unwrap();

        queue.publish(&t1, "events", serde_json::json!({"from": "t1"}), PublishOptions::default()).await.unwrap();

        // t2 should not see t1's message.
        let msg = queue.poll(&t2, &sub2).await.unwrap();
        assert!(msg.is_none());

        // t1 should see its own message.
        let msg = queue.poll(&t1, &sub1).await.unwrap();
        assert!(msg.is_some());
        assert_eq!(msg.unwrap().payload["from"], "t1");
    }

    #[tokio::test]
    async fn test_unsubscribe() {
        let queue = InMemoryQueue::new();
        let tenant = TenantContext::new("t1", "T1");

        let sub = queue.subscribe(&tenant, "events").await.unwrap();
        queue.unsubscribe(&tenant, &sub).await.unwrap();

        let result = queue.poll(&tenant, &sub).await;
        assert!(result.is_err());
    }
}
