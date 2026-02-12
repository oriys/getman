use std::time::{SystemTime, UNIX_EPOCH};

use iced::widget::{button, column, container, row, scrollable, text};
use iced::{Element, Length};

use crate::collections::SavedRequest;
use crate::history::History;
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

    container(column![nav, body].spacing(10).padding(10))
        .height(Length::Fill)
        .style(|_| style::surface_style(style::SURFACE_0, 0.0))
        .into()
}

fn nav_button<'a>(label: &'a str, view: SidebarView, active: SidebarView) -> iced::widget::Button<'a, Message> {
    button(text(label).size(12))
        .on_press(Message::SidebarViewSelected(view))
        .width(Length::Fill)
        .padding([8, 10])
        .style(move |theme, status| style::section_tab_button(active == view, theme, status))
}

fn collections_view<'a>(saved_requests: &'a [SavedRequest]) -> Element<'a, Message> {
    let mut list = column![text("Collections").size(12)].spacing(6);
    if saved_requests.is_empty() {
        list = list.push(text("No saved requests").size(12).color(style::TEXT_MUTED));
    } else {
        for (index, request) in saved_requests.iter().enumerate() {
            let label = format!("{} {}", request.method, request.url);
            list = list.push(
                button(text(label).size(12))
                    .on_press(Message::SavedRequestSelected(index))
                    .width(Length::Fill)
                    .padding([8, 10])
                    .style(move |theme, status| style::list_item_button(false, theme, status)),
            );
        }
    }

    scrollable(list.spacing(8)).height(Length::Fill).into()
}

fn history_view<'a>(history: &'a History) -> Element<'a, Message> {
    let mut list = column![
        row![
            text("History").size(12),
            iced::widget::horizontal_space(),
            button("Clear")
                .on_press(Message::HistoryCleared)
                .padding([4, 8])
                .style(style::ghost_button)
        ]
        .align_y(iced::alignment::Alignment::Center)
    ]
    .spacing(6);

    if history.entries().is_empty() {
        list = list.push(text("No history").size(12).color(style::TEXT_MUTED));
    } else {
        for (index, entry) in history.entries().iter().enumerate() {
            let mut label = format!(
                "{}  {}  {}",
                relative_time(entry.timestamp),
                entry.method,
                entry.url
            );
            if let Some(status) = &entry.status {
                label.push_str(&format!("  ({status})"));
            }
            list = list.push(
                button(text(label).size(12))
                    .on_press(Message::HistoryEntrySelected(index))
                    .width(Length::Fill)
                    .padding([8, 10])
                    .style(move |theme, status| style::list_item_button(false, theme, status)),
            );
        }
    }

    scrollable(list.spacing(8)).height(Length::Fill).into()
}

fn environments_view(active_environment: EnvironmentOption) -> Element<'static, Message> {
    let mut list = column![text("Environments").size(12)].spacing(8);

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
