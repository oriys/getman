use super::method::HttpMethod;

#[derive(Debug, Clone)]
pub struct RequestInput {
    pub method: HttpMethod,
    pub url: String,
    pub headers: String,
    pub body: String,
}
