use std::time::{SystemTime, UNIX_EPOCH};

use iced::widget::{button, column, container, horizontal_rule, row, scrollable, text};
use iced::{Element, Length};

use crate::collections::SavedRequest;
use crate::history::History;
use crate::http::method::HttpMethod;
use crate::{EnvironmentOption, Message, SidebarView};

use super::style;

pub fn view<'a>(
    sidebar_view: SidebarView,
    saved_requests: &'a [SavedRequest],
    history: &'a History,
    active_environment: EnvironmentOption,
) -> Element<'a, Message> {
    let nav = row![
        nav_button("Collections", SidebarView::Collections, sidebar_view),
        nav_button("History", SidebarView::History, sidebar_view),
        nav_button("Envs", SidebarView::Environments, sidebar_view),
    ]
    .spacing(0)
    .height(36);

    let body = match sidebar_view {
        SidebarView::Collections => collections_view(saved_requests),
        SidebarView::History => history_view(history),
        SidebarView::Environments => environments_view(active_environment),
    };

    container(
        column![
            container(nav).style(|_| style::flat_surface_style(style::SURFACE_0)),
            horizontal_rule(1).style(|_| iced::widget::rule::Style {
                color: style::BORDER,
                width: 1,
                radius: 0.0.into(),
                fill_mode: iced::widget::rule::FillMode::Full,
            }),
            container(body).padding([8, 10]).height(Length::Fill),
        ]
        .spacing(0),
    )
    .height(Length::Fill)
    .style(|_| style::surface_style(style::SURFACE_0, 0.0))
    .into()
}

fn nav_button<'a>(label: &'a str, view: SidebarView, active: SidebarView) -> iced::widget::Button<'a, Message> {
    let is_active = active == view;
    button(
        column![
            container(text(label).size(12).color(if is_active { style::TEXT } else { style::TEXT_MUTED }))
                .padding([8, 10])
                .center_y(Length::Fill),
            container(text("").size(2))
                .height(2)
                .width(Length::Fill)
                .style(move |_| style::flat_surface_style(if is_active { style::PRIMARY } else { style::SURFACE_0 })),
        ]
        .height(Length::Fill)
    )
    .on_press(Message::SidebarViewSelected(view))
    .width(Length::Fill)
    .padding(0)
    .style(move |theme, status| style::section_tab_button(is_active, theme, status))
}

fn method_badge<'a>(method: HttpMethod) -> Element<'a, Message> {
    let color = style::method_color(method);
    let label = match method {
        HttpMethod::Get => "GET",
        HttpMethod::Post => "POST",
        HttpMethod::Put => "PUT",
        HttpMethod::Patch => "PTCH",
        HttpMethod::Delete => "DEL",
        HttpMethod::Head => "HEAD",
        HttpMethod::Options => "OPT",
    };
    container(text(label).size(10).color(color))
        .padding([2, 4])
        .width(38)
        .center_x(Length::Shrink)
        .style(move |_| iced::widget::container::Style::default()
            .background(iced::Background::Color(iced::Color {
                a: 0.12,
                ..color
            }))
            .border(iced::Border {
                radius: 3.0.into(),
                width: 0.0,
                color: iced::Color::TRANSPARENT,
            }))
        .into()
}

fn collections_view<'a>(saved_requests: &'a [SavedRequest]) -> Element<'a, Message> {
    let mut list = column![
        text("Collections").size(11).color(style::TEXT_MUTED),
    ].spacing(6);
    if saved_requests.is_empty() {
        list = list.push(text("No saved requests").size(12).color(style::TEXT_MUTED));
    } else {
        for (index, request) in saved_requests.iter().enumerate() {
            let url_text = truncate_url(&request.url, 28);
            let item_btn = button(
                row![
                    method_badge(request.method),
                    text(url_text).size(12),
                ]
                .spacing(6)
                .align_y(iced::alignment::Alignment::Center),
            )
            .on_press(Message::SavedRequestSelected(index))
            .width(Length::Fill)
            .padding([6, 8])
            .style(move |theme, status| style::list_item_button(false, theme, status));
            let del_btn = button(text("✕").size(11))
                .on_press(Message::DeleteSavedRequest(index))
                .padding([4, 6])
                .style(style::ghost_button);
            list = list.push(
                row![item_btn, del_btn]
                    .spacing(2)
                    .align_y(iced::alignment::Alignment::Center),
            );
        }
    }

    scrollable(list.spacing(4)).height(Length::Fill).into()
}

fn history_view<'a>(history: &'a History) -> Element<'a, Message> {
    let mut list = column![
        row![
            text("History").size(11).color(style::TEXT_MUTED),
            iced::widget::horizontal_space(),
            button(text("Clear").size(11))
                .on_press(Message::HistoryCleared)
                .padding([3, 8])
                .style(style::ghost_button)
        ]
        .align_y(iced::alignment::Alignment::Center)
    ]
    .spacing(6);

    if history.entries().is_empty() {
        list = list.push(text("No history").size(12).color(style::TEXT_MUTED));
    } else {
        for (index, entry) in history.entries().iter().enumerate() {
            let url_text = truncate_url(&entry.url, 22);
            let time_text = relative_time(entry.timestamp);
            let status_info = entry
                .status
                .as_ref()
                .map(|s| format!(" {s}"))
                .unwrap_or_default();
            list = list.push(
                button(
                    row![
                        method_badge(entry.method),
                        column![
                            text(url_text).size(12),
                            text(format!("{time_text}{status_info}")).size(10).color(style::TEXT_MUTED),
                        ]
                        .spacing(2),
                    ]
                    .spacing(6)
                    .align_y(iced::alignment::Alignment::Center),
                )
                .on_press(Message::HistoryEntrySelected(index))
                .width(Length::Fill)
                .padding([6, 8])
                .style(move |theme, status| style::list_item_button(false, theme, status)),
            );
        }
    }

    scrollable(list.spacing(4)).height(Length::Fill).into()
}

fn environments_view(active_environment: EnvironmentOption) -> Element<'static, Message> {
    let mut list = column![
        text("Environments").size(11).color(style::TEXT_MUTED),
    ].spacing(6);

    for option in EnvironmentOption::ALL {
        let is_active = option == active_environment;
        list = list.push(
            button(text(option.to_string()).size(12))
                .on_press(Message::EnvironmentSelected(option))
                .width(Length::Fill)
                .padding([8, 10])
                .style(move |theme, status| style::list_item_button(is_active, theme, status)),
        );
    }

    scrollable(list).height(Length::Fill).into()
}

fn truncate_url(url: &str, max_len: usize) -> String {
    if url.len() <= max_len {
        url.to_string()
    } else {
        format!("{}…", &url[..max_len])
    }
}

fn relative_time(timestamp: u64) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(timestamp);
    let diff = now.saturating_sub(timestamp);

    if diff < 60 {
        format!("{diff}s ago")
    } else if diff < 3600 {
        format!("{}m ago", diff / 60)
    } else if diff < 86400 {
        format!("{}h ago", diff / 3600)
    } else {
        format!("{}d ago", diff / 86400)
    }
}
