mod auth;
mod cli;
mod collections;
mod environment;
mod history;
mod http;
mod import_export;
mod plugins;
mod storage;
mod testing;
mod ui;

use std::fmt::{self, Display};
use std::time::{SystemTime, UNIX_EPOCH};

use auth::{AuthInput, AuthType};
use collections::SavedRequest;
use history::{History, HistoryEntry};
use iced::widget::{column, container, row, text, text_editor};
use iced::{Element, Length, Task};
use ui::style;

use http::client::send_request;
use http::method::HttpMethod;
use http::request::RequestInput;
use http::response::HttpResponse;

fn main() -> iced::Result {
    iced::application("Getman", update, view)
        .theme(|_| style::app_theme())
        .window_size((1220.0, 840.0))
        .run_with(|| (App::default(), Task::none()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnvironmentOption {
    None,
    Dev,
    Staging,
    Prod,
}

impl EnvironmentOption {
    pub const ALL: [EnvironmentOption; 4] = [
        EnvironmentOption::None,
        EnvironmentOption::Dev,
        EnvironmentOption::Staging,
        EnvironmentOption::Prod,
    ];
}

impl Display for EnvironmentOption {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let label = match self {
            EnvironmentOption::None => "No Environment",
            EnvironmentOption::Dev => "Dev",
            EnvironmentOption::Staging => "Staging",
            EnvironmentOption::Prod => "Prod",
        };
        write!(f, "{label}")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SidebarView {
    Collections,
    History,
    Environments,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestEditorTab {
    Params,
    Headers,
    Body,
    Auth,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResponseTab {
    Body,
    Headers,
}

struct App {
    sidebar_open: bool,
    sidebar_view: SidebarView,
    request_tab: RequestEditorTab,
    response_tab: ResponseTab,
    active_environment: EnvironmentOption,
    method: HttpMethod,
    url: String,
    params_editor: text_editor::Content,
    auth: AuthInput,
    headers_editor: text_editor::Content,
    body_editor: text_editor::Content,
    pretty_json: bool,
    saved_requests: Vec<SavedRequest>,
    next_saved_request_id: u64,
    history: History,
    loading: bool,
    error: Option<String>,
    response: Option<HttpResponse>,
}

impl Default for App {
    fn default() -> Self {
        let (saved_requests, mut load_error) = match storage::load_saved_requests() {
            Ok(saved_requests) => (saved_requests, None),
            Err(err) => (Vec::new(), Some(err)),
        };
        let history = match storage::load_history() {
            Ok(history) => history,
            Err(err) => {
                if load_error.is_none() {
                    load_error = Some(err);
                }
                History::new()
            }
        };
        let next_saved_request_id = saved_requests.iter().map(|request| request.id).max().unwrap_or(0) + 1;

        Self {
            sidebar_open: true,
            sidebar_view: SidebarView::Collections,
            request_tab: RequestEditorTab::Params,
            response_tab: ResponseTab::Body,
            active_environment: EnvironmentOption::None,
            method: HttpMethod::Get,
            url: String::new(),
            params_editor: text_editor::Content::new(),
            auth: AuthInput::default(),
            headers_editor: text_editor::Content::with_text("Accept: application/json"),
            body_editor: text_editor::Content::new(),
            pretty_json: true,
            saved_requests,
            next_saved_request_id,
            history,
            loading: false,
            error: load_error,
            response: None,
        }
    }
}

#[derive(Debug, Clone)]
pub enum Message {
    SidebarTogglePressed,
    SidebarViewSelected(SidebarView),
    RequestTabSelected(RequestEditorTab),
    ResponseTabSelected(ResponseTab),
    EnvironmentSelected(EnvironmentOption),
    MethodSelected(HttpMethod),
    UrlChanged(String),
    ParamsEdited(text_editor::Action),
    AuthTypeSelected(AuthType),
    AuthBearerTokenChanged(String),
    AuthBasicUsernameChanged(String),
    AuthBasicPasswordChanged(String),
    AuthApiKeyChanged(String),
    AuthApiValueChanged(String),
    HeadersEdited(text_editor::Action),
    BodyEdited(text_editor::Action),
    PrettyJsonToggled(bool),
    SendPressed,
    SaveRequestPressed,
    SavedRequestSelected(usize),
    HistoryEntrySelected(usize),
    HistoryCleared,
    RequestFinished {
        method: HttpMethod,
        url: String,
        result: Result<HttpResponse, String>,
    },
}

fn update(app: &mut App, message: Message) -> Task<Message> {
    match message {
        Message::SidebarTogglePressed => {
            app.sidebar_open = !app.sidebar_open;
            Task::none()
        }
        Message::SidebarViewSelected(view) => {
            app.sidebar_view = view;
            Task::none()
        }
        Message::RequestTabSelected(tab) => {
            app.request_tab = tab;
            Task::none()
        }
        Message::ResponseTabSelected(tab) => {
            app.response_tab = tab;
            Task::none()
        }
        Message::EnvironmentSelected(environment) => {
            app.active_environment = environment;
            Task::none()
        }
        Message::MethodSelected(method) => {
            app.method = method;
            Task::none()
        }
        Message::UrlChanged(url) => {
            app.url = url;
            Task::none()
        }
        Message::ParamsEdited(action) => {
            app.params_editor.perform(action);
            Task::none()
        }
        Message::AuthTypeSelected(auth_type) => {
            app.auth.auth_type = auth_type;
            Task::none()
        }
        Message::AuthBearerTokenChanged(value) => {
            app.auth.bearer_token = value;
            Task::none()
        }
        Message::AuthBasicUsernameChanged(value) => {
            app.auth.basic_username = value;
            Task::none()
        }
        Message::AuthBasicPasswordChanged(value) => {
            app.auth.basic_password = value;
            Task::none()
        }
        Message::AuthApiKeyChanged(value) => {
            app.auth.api_key = value;
            Task::none()
        }
        Message::AuthApiValueChanged(value) => {
            app.auth.api_value = value;
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
        Message::PrettyJsonToggled(enabled) => {
            app.pretty_json = enabled;
            Task::none()
        }
        Message::SendPressed => {
            if app.loading {
                return Task::none();
            }
            if app.url.trim().is_empty() {
                app.error = Some("URL cannot be empty".to_string());
                return Task::none();
            }

            app.loading = true;
            app.error = None;
            app.response = None;

            let request = RequestInput {
                method: app.method,
                url: app.url.trim().to_string(),
                params: app.params_editor.text(),
                headers: app.headers_editor.text(),
                body: app.body_editor.text(),
                auth: app.auth.clone(),
            };
            let history_method = app.method;
            let history_url = request.url.clone();

            Task::perform(send_request(request), move |result| Message::RequestFinished {
                method: history_method,
                url: history_url.clone(),
                result,
            })
        }
        Message::SaveRequestPressed => {
            if app.url.trim().is_empty() {
                app.error = Some("URL cannot be empty".to_string());
                return Task::none();
            }

            let saved_request = SavedRequest {
                id: app.next_saved_request_id,
                name: format!("{} {}", app.method, app.url.trim()),
                method: app.method,
                url: app.url.trim().to_string(),
                params: app.params_editor.text(),
                headers: app.headers_editor.text(),
                body: app.body_editor.text(),
                auth_type: app.auth.auth_type,
                auth_bearer_token: app.auth.bearer_token.clone(),
                auth_basic_username: app.auth.basic_username.clone(),
                auth_basic_password: app.auth.basic_password.clone(),
                auth_api_key: app.auth.api_key.clone(),
                auth_api_value: app.auth.api_value.clone(),
            };

            app.next_saved_request_id += 1;
            app.saved_requests.insert(0, saved_request);
            if let Err(err) = storage::save_saved_requests(&app.saved_requests) {
                app.error = Some(err);
            } else {
                app.error = None;
            }

            Task::none()
        }
        Message::SavedRequestSelected(index) => {
            if let Some(saved_request) = app.saved_requests.get(index).cloned() {
                apply_saved_request(app, &saved_request);
                app.error = None;
            }
            Task::none()
        }
        Message::HistoryEntrySelected(index) => {
            if let Some(entry) = app.history.entries().iter().nth(index).cloned() {
                app.method = entry.method;
                app.url = entry.url;
                app.error = None;
            }
            Task::none()
        }
        Message::HistoryCleared => {
            app.history.clear();
            if let Err(err) = storage::save_history(&app.history) {
                app.error = Some(err);
            } else {
                app.error = None;
            }
            Task::none()
        }
        Message::RequestFinished {
            method,
            url,
            result,
        } => {
            app.loading = false;

            let history_status = result.as_ref().ok().map(|response| response.status.clone());
            let history_duration = result.as_ref().ok().map(|response| response.duration_ms);
            app.history.push(HistoryEntry {
                timestamp: current_unix_timestamp(),
                method,
                url,
                status: history_status,
                duration_ms: history_duration,
            });
            let history_save_error = storage::save_history(&app.history).err();

            match result {
                Ok(response) => {
                    app.response = Some(response);
                    app.error = history_save_error;
                }
                Err(err) => app.error = Some(err),
            }

            Task::none()
        }
    }
}

fn view(app: &App) -> Element<'_, Message> {
    let header = ui::header::view(app.sidebar_open, app.active_environment);

    let sidebar = if app.sidebar_open {
        Some(
            container(ui::sidebar::view(
                app.sidebar_view,
                &app.saved_requests,
                &app.history,
                app.active_environment,
            ))
            .width(280)
            .height(Length::Fill),
        )
    } else {
        None
    };

    let request_bar = container(ui::request_bar::view(app.method, &app.url, app.loading))
        .padding(12)
        .style(|_| style::surface_style(style::SURFACE_1, 0.0));

    let request_editor = ui::request_editor::view(ui::request_editor::RequestEditorState {
        active_tab: app.request_tab,
        params_editor: &app.params_editor,
        headers_editor: &app.headers_editor,
        body_editor: &app.body_editor,
        auth_type: app.auth.auth_type,
        auth_bearer_token: &app.auth.bearer_token,
        auth_basic_username: &app.auth.basic_username,
        auth_basic_password: &app.auth.basic_password,
        auth_api_key: &app.auth.api_key,
        auth_api_value: &app.auth.api_value,
    });

    let request_section = container(column![request_bar, request_editor].spacing(0).height(Length::Fill))
        .height(Length::FillPortion(45))
        .style(|_| style::surface_style(style::SURFACE_0, 0.0));

    let response_section = container(ui::response_panel::view(
        app.error.as_deref(),
        app.response.as_ref(),
        app.pretty_json,
        app.response_tab,
    ))
    .height(Length::FillPortion(55))
    .style(|_| style::surface_style(style::SURFACE_0, 0.0));

    let tab_bar = container(row![text("Request 1").size(12).color(style::TEXT_MUTED)].padding([8, 12]))
        .style(|_| style::surface_style(style::SURFACE_1, 0.0));

    let main_content = column![tab_bar, request_section, response_section]
        .spacing(1)
        .height(Length::Fill)
        .width(Length::Fill);

    let body: Element<'_, Message> = if let Some(sidebar) = sidebar {
        row![sidebar, container(main_content).width(Length::Fill).height(Length::Fill)]
            .height(Length::Fill)
            .into()
    } else {
        row![container(main_content).width(Length::Fill).height(Length::Fill)]
            .height(Length::Fill)
            .into()
    };

    let layout = column![header, body]
        .spacing(1)
        .height(Length::Fill)
        .width(Length::Fill);

    container(layout)
        .width(Length::Fill)
        .height(Length::Fill)
        .style(|_| style::flat_surface_style(style::BG))
        .into()
}

fn apply_saved_request(app: &mut App, saved_request: &SavedRequest) {
    app.method = saved_request.method;
    app.url = saved_request.url.clone();
    app.params_editor = text_editor::Content::with_text(&saved_request.params);
    app.headers_editor = text_editor::Content::with_text(&saved_request.headers);
    app.body_editor = text_editor::Content::with_text(&saved_request.body);

    app.auth.auth_type = saved_request.auth_type;
    app.auth.bearer_token = saved_request.auth_bearer_token.clone();
    app.auth.basic_username = saved_request.auth_basic_username.clone();
    app.auth.basic_password = saved_request.auth_basic_password.clone();
    app.auth.api_key = saved_request.auth_api_key.clone();
    app.auth.api_value = saved_request.auth_api_value.clone();
}

fn current_unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}
