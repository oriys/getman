use iced::widget::{button, checkbox, column, container, row, scrollable, text};
use iced::{Color, Element, Length};

use crate::http::response::HttpResponse;
use crate::{Message, ResponseTab};

use super::style;

pub fn view<'a>(
    error: Option<&str>,
    response: Option<&'a HttpResponse>,
    pretty_json: bool,
    active_tab: ResponseTab,
) -> Element<'a, Message> {
    let tabs = row![
        tab_button("Body", ResponseTab::Body, active_tab),
        tab_button("Headers", ResponseTab::Headers, active_tab),
    ]
    .spacing(0)
    .height(36);

    let mut section = column![tabs].spacing(0).height(Length::Fill);

    if let Some(response) = response {
        let status_color = status_code_color(&response.status);
        let summary = row![
            text(&response.status).size(13).color(status_color),
            text(format!(
                " | {} ms | {} bytes",
                response.duration_ms, response.size_bytes
            ))
            .size(12)
            .color(style::TEXT_MUTED),
            iced::widget::horizontal_space(),
            checkbox("Pretty JSON", pretty_json).on_toggle(Message::PrettyJsonToggled)
        ]
        .align_y(iced::alignment::Alignment::Center)
        .padding([8, 10])
        .spacing(10);

        let content: Element<'a, Message> = match active_tab {
            ResponseTab::Body => {
                let body_content = if pretty_json {
                    pretty_json_body(&response.body)
                } else {
                    response.body.clone()
                };
                scrollable(
                    container(text(body_content).size(13))
                        .padding(10)
                        .style(|_| style::surface_style(style::SURFACE_1, 8.0)),
                )
                .height(Length::Fill)
                .into()
            }
            ResponseTab::Headers => scrollable(
                container(text(&response.headers).size(13))
                    .padding(10)
                    .style(|_| style::surface_style(style::SURFACE_1, 8.0)),
            )
            .height(Length::Fill)
            .into(),
        };

        section = section.push(summary).push(container(content).padding(10).height(Length::Fill));
    } else {
        let mut empty = column![text("No response yet").size(14).color(style::TEXT_MUTED)]
            .height(Length::Fill)
            .width(Length::Fill)
            .align_x(iced::alignment::Horizontal::Center)
            .spacing(8);

        if let Some(err) = error {
            empty = empty.push(text(format!("Error: {err}")).size(12).color(style::DANGER));
        }

        section = section.push(container(empty).height(Length::Fill).padding(16));
    }

    section.into()
}

fn tab_button<'a>(
    label: &'a str,
    tab: ResponseTab,
    active: ResponseTab,
) -> iced::widget::Button<'a, Message> {
    button(text(label).size(12))
        .on_press(Message::ResponseTabSelected(tab))
        .width(Length::Fill)
        .padding([8, 10])
        .style(move |theme, status| style::section_tab_button(tab == active, theme, status))
}

fn pretty_json_body(raw: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(raw) {
        Ok(value) => serde_json::to_string_pretty(&value).unwrap_or_else(|_| raw.to_string()),
        Err(_) => raw.to_string(),
    }
}

/// Returns a color based on the HTTP status code prefix.
fn status_code_color(status: &str) -> Color {
    if status.starts_with('2') {
        style::PRIMARY // green for success
    } else if status.starts_with('3') {
        Color::from_rgb(0.95, 0.77, 0.06) // yellow for redirects
    } else if status.starts_with('4') || status.starts_with('5') {
        style::DANGER // red for errors
    } else {
        style::TEXT
    }
}
