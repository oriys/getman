use iced::widget::{
    button, column, container, pick_list, row, scrollable, text, text_editor, text_input,
};
use iced::{Element, Length, Task};
use reqwest::header::{HeaderName, HeaderValue};
use std::fmt::{self, Display};
use std::time::Instant;

fn main() -> iced::Result {
    iced::application("Getman", update, view)
        .window_size((980.0, 760.0))
        .run_with(|| (App::default(), Task::none()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HttpMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Head,
    Options,
}

impl HttpMethod {
    const ALL: [HttpMethod; 7] = [
        HttpMethod::Get,
        HttpMethod::Post,
        HttpMethod::Put,
        HttpMethod::Patch,
        HttpMethod::Delete,
        HttpMethod::Head,
        HttpMethod::Options,
    ];
}

impl Display for HttpMethod {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let label = match self {
            HttpMethod::Get => "GET",
            HttpMethod::Post => "POST",
            HttpMethod::Put => "PUT",
            HttpMethod::Patch => "PATCH",
            HttpMethod::Delete => "DELETE",
            HttpMethod::Head => "HEAD",
            HttpMethod::Options => "OPTIONS",
        };
        write!(f, "{label}")
    }
}

impl From<HttpMethod> for reqwest::Method {
    fn from(method: HttpMethod) -> Self {
        match method {
            HttpMethod::Get => reqwest::Method::GET,
            HttpMethod::Post => reqwest::Method::POST,
            HttpMethod::Put => reqwest::Method::PUT,
            HttpMethod::Patch => reqwest::Method::PATCH,
            HttpMethod::Delete => reqwest::Method::DELETE,
            HttpMethod::Head => reqwest::Method::HEAD,
            HttpMethod::Options => reqwest::Method::OPTIONS,
        }
    }
}

#[derive(Debug, Clone)]
struct HttpResponse {
    status: String,
    duration_ms: u128,
    size_bytes: usize,
    headers: String,
    body: String,
}

#[derive(Debug, Clone)]
struct RequestInput {
    method: HttpMethod,
    url: String,
    headers: String,
    body: String,
}

struct App {
    method: HttpMethod,
    url: String,
    headers_editor: text_editor::Content,
    body_editor: text_editor::Content,
    loading: bool,
    error: Option<String>,
    response: Option<HttpResponse>,
}

impl Default for App {
    fn default() -> Self {
        Self {
            method: HttpMethod::Get,
            url: String::new(),
            headers_editor: text_editor::Content::with_text("Accept: application/json"),
            body_editor: text_editor::Content::new(),
            loading: false,
            error: None,
            response: None,
        }
    }
}

#[derive(Debug, Clone)]
enum Message {
    MethodSelected(HttpMethod),
    UrlChanged(String),
    HeadersEdited(text_editor::Action),
    BodyEdited(text_editor::Action),
    SendPressed,
    RequestFinished(Result<HttpResponse, String>),
}

fn update(app: &mut App, message: Message) -> Task<Message> {
    match message {
        Message::MethodSelected(method) => {
            app.method = method;
            Task::none()
        }
        Message::UrlChanged(url) => {
            app.url = url;
            Task::none()
        }
        Message::HeadersEdited(action) => {
            app.headers_editor.perform(action);
            Task::none()
        }
        Message::BodyEdited(action) => {
            app.body_editor.perform(action);
            Task::none()
        }
        Message::SendPressed => {
            if app.loading {
                return Task::none();
            }
            if app.url.trim().is_empty() {
                app.error = Some("URL 不能为空".to_string());
                return Task::none();
            }

            app.loading = true;
            app.error = None;
            app.response = None;

            let request = RequestInput {
                method: app.method,
                url: app.url.trim().to_string(),
                headers: app.headers_editor.text(),
                body: app.body_editor.text(),
            };

            Task::perform(send_request(request), Message::RequestFinished)
        }
        Message::RequestFinished(result) => {
            app.loading = false;
            match result {
                Ok(response) => app.response = Some(response),
                Err(err) => app.error = Some(err),
            }
            Task::none()
        }
    }
}

fn view(app: &App) -> Element<'_, Message> {
    let method_picklist = pick_list(
        &HttpMethod::ALL[..],
        Some(app.method),
        Message::MethodSelected,
    )
    .width(120);

    let url_input = text_input("https://httpbin.org/get", &app.url)
        .on_input(Message::UrlChanged)
        .padding(10)
        .size(16)
        .width(Length::Fill);

    let send_button = if app.loading {
        button("发送中...").padding(10)
    } else {
        button("发送").on_press(Message::SendPressed).padding(10)
    };

    let request_line = row![method_picklist, url_input, send_button].spacing(10);

    let headers_section = column![
        text("Headers (每行一个，格式: Key: Value)").size(14),
        text_editor(&app.headers_editor)
            .on_action(Message::HeadersEdited)
            .height(130),
    ]
    .spacing(6);

    let body_section = column![
        text("Body").size(14),
        text_editor(&app.body_editor)
            .on_action(Message::BodyEdited)
            .height(170),
    ]
    .spacing(6);

    let mut response_section = column![text("响应").size(20)].spacing(8);

    if let Some(err) = &app.error {
        response_section = response_section.push(text(format!("错误: {err}")));
    }

    if let Some(response) = &app.response {
        let summary = text(format!(
            "{} | {} ms | {} bytes",
            response.status, response.duration_ms, response.size_bytes
        ));

        let headers = scrollable(container(text(&response.headers)).padding(10)).height(150);

        let body = scrollable(container(text(&response.body)).padding(10)).height(Length::Fill);

        response_section = response_section
            .push(summary)
            .push(text("Response Headers").size(14))
            .push(headers)
            .push(text("Response Body").size(14))
            .push(body);
    } else {
        response_section = response_section.push(text("暂无响应"));
    }

    let content = column![
        request_line,
        headers_section,
        body_section,
        response_section
    ]
    .spacing(14)
    .padding(16)
    .height(Length::Fill);

    container(content)
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}

async fn send_request(request: RequestInput) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    let method: reqwest::Method = request.method.into();

    let mut req_builder = client.request(method, &request.url);
    for line in request.headers.lines() {
        let raw = line.trim();
        if raw.is_empty() {
            continue;
        }

        let (key, value) = raw
            .split_once(':')
            .ok_or_else(|| format!("Header 格式错误: {raw}"))?;
        let key = key.trim();
        let value = value.trim();
        if key.is_empty() {
            return Err(format!("Header key 为空: {raw}"));
        }

        let header_name = HeaderName::from_bytes(key.as_bytes())
            .map_err(|e| format!("无效 Header key `{key}`: {e}"))?;
        let header_value = HeaderValue::from_str(value)
            .map_err(|e| format!("无效 Header value `{value}`: {e}"))?;
        req_builder = req_builder.header(header_name, header_value);
    }

    let body = request.body.trim();
    if !body.is_empty() {
        req_builder = req_builder.body(body.to_string());
    }

    let started = Instant::now();
    let response = req_builder
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    let elapsed = started.elapsed().as_millis();

    let status = response.status();
    let headers = format_headers(response.headers());
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;
    let size_bytes = bytes.len();
    let body = String::from_utf8_lossy(&bytes).into_owned();

    Ok(HttpResponse {
        status: format!(
            "{} {}",
            status.as_u16(),
            status.canonical_reason().unwrap_or("Unknown")
        ),
        duration_ms: elapsed,
        size_bytes,
        headers,
        body,
    })
}

fn format_headers(headers: &reqwest::header::HeaderMap) -> String {
    let mut lines = Vec::new();
    for (name, value) in headers {
        let value = value.to_str().unwrap_or("<binary>");
        lines.push(format!("{name}: {value}"));
    }
    lines.join("\n")
}
