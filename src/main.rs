mod auth;
mod cli;
mod collections;
mod environment;
mod history;
mod http;
mod import_export;
mod plugins;
mod testing;
mod ui;

use iced::widget::{column, container, text_editor};
use iced::{Element, Length, Task};

use http::client::send_request;
use http::method::HttpMethod;
use http::request::RequestInput;
use http::response::HttpResponse;

fn main() -> iced::Result {
    iced::application("Getman", update, view)
        .window_size((980.0, 760.0))
        .run_with(|| (App::default(), Task::none()))
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
    let request_line = ui::request_bar::view(app.method, &app.url, app.loading);
    let headers_section = ui::headers_editor::view(&app.headers_editor);
    let body_section = ui::body_editor::view(&app.body_editor);
    let response_section =
        ui::response_panel::view(app.error.as_deref(), app.response.as_ref());

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
