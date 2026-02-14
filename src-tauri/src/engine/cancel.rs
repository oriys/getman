use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::broadcast;

pub struct CancelRegistry {
    senders: Mutex<HashMap<String, broadcast::Sender<()>>>,
}

impl CancelRegistry {
    pub fn new() -> Self {
        Self {
            senders: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&self, id: &str) -> broadcast::Receiver<()> {
        let (tx, rx) = broadcast::channel(1);
        self.senders
            .lock()
            .unwrap()
            .insert(id.to_string(), tx);
        rx
    }

    pub fn cancel(&self, id: &str) -> bool {
        if let Some(tx) = self.senders.lock().unwrap().remove(id) {
            let _ = tx.send(());
            return true;
        }
        false
    }

    pub fn remove(&self, id: &str) {
        self.senders.lock().unwrap().remove(id);
    }
}
