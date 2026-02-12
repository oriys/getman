use iced::widget::{button, column, container, row, text, text_editor};
use iced::{Element, Length};

use crate::auth::AuthType;
use crate::{Message, RequestEditorTab};

use super::style;

pub struct RequestEditorState<'a> {
    pub active_tab: RequestEditorTab,
    pub params_editor: &'a text_editor::Content,
    pub headers_editor: &'a text_editor::Content,
    pub body_editor: &'a text_editor::Content,
    pub auth_type: AuthType,
    pub auth_bearer_token: &'a str,
    pub auth_basic_username: &'a str,
    pub auth_basic_password: &'a str,
    pub auth_api_key: &'a str,
    pub auth_api_value: &'a str,
}

pub fn view<'a>(state: RequestEditorState<'a>) -> Element<'a, Message> {
    let tabs = row![
        tab_button("Params", RequestEditorTab::Params, state.active_tab),
        tab_button("Headers", RequestEditorTab::Headers, state.active_tab),
        tab_button("Body", RequestEditorTab::Body, state.active_tab),
        tab_button("Auth", RequestEditorTab::Auth, state.active_tab),
    ]
    .height(36)
    .spacing(0);

    let body: Element<'a, Message> = match state.active_tab {
        RequestEditorTab::Params => super::params_editor::view(state.params_editor),
        RequestEditorTab::Headers => super::headers_editor::view(state.headers_editor),
        RequestEditorTab::Body => super::body_editor::view(state.body_editor),
        RequestEditorTab::Auth => super::auth_editor::view(
            state.auth_type,
            state.auth_bearer_token,
            state.auth_basic_username,
            state.auth_basic_password,
            state.auth_api_key,
            state.auth_api_value,
        ),
    };

    column![
        tabs,
        container(body)
            .padding(12)
            .height(Length::Fill)
            .style(|_| style::surface_style(style::SURFACE_1, 0.0))
    ]
    .height(Length::Fill)
    .spacing(0)
    .into()
}

fn tab_button<'a>(
    label: &'a str,
    tab: RequestEditorTab,
    active: RequestEditorTab,
) -> iced::widget::Button<'a, Message> {
    button(text(label).size(12))
        .on_press(Message::RequestTabSelected(tab))
        .width(Length::Fill)
        .padding([8, 10])
        .style(move |theme, status| style::section_tab_button(tab == active, theme, status))
}
