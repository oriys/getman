#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: String,
    pub duration_ms: u128,
    pub size_bytes: usize,
    pub headers: String,
    pub body: String,
}
