use iced::widget::{button, column, container, horizontal_rule, row, text, text_editor};
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
        container(tabs)
            .style(|_| style::flat_surface_style(style::SURFACE_0)),
        horizontal_rule(1).style(|_| iced::widget::rule::Style {
            color: style::BORDER,
            width: 1,
            radius: 0.0.into(),
            fill_mode: iced::widget::rule::FillMode::Full,
        }),
        container(body)
            .padding(12)
            .height(Length::Fill)
            .style(|_| style::flat_surface_style(style::SURFACE_0))
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
    let is_active = tab == active;
    button(
        column![
            container(text(label).size(12).color(if is_active { style::TEXT } else { style::TEXT_MUTED }))
                .padding([8, 14])
                .center_y(Length::Fill),
            container(text("").size(2))
                .height(2)
                .width(Length::Fill)
                .style(move |_| style::flat_surface_style(if is_active { style::PRIMARY } else { style::SURFACE_0 })),
        ]
        .height(Length::Fill)
    )
    .on_press(Message::RequestTabSelected(tab))
    .padding(0)
    .style(move |theme, status| style::section_tab_button(is_active, theme, status))
}
