use iced::widget::{button, checkbox, column, container, horizontal_rule, row, scrollable, text};
use iced::{Color, Element, Length};

use crate::http::response::HttpResponse;
use crate::{Message, ResponseTab};

use super::style;

const RESPONSE_FONT_SIZE: u16 = 13;

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

    let mut section = column![
        container(tabs)
            .style(|_| style::flat_surface_style(style::SURFACE_0)),
        horizontal_rule(1).style(|_| iced::widget::rule::Style {
            color: style::BORDER,
            width: 1,
            radius: 0.0.into(),
            fill_mode: iced::widget::rule::FillMode::Full,
        }),
    ]
    .spacing(0)
    .height(Length::Fill);

    if let Some(response) = response {
        let status_color = status_code_color(&response.status);
        let summary = row![
            container(
                text(&response.status).size(12).color(status_color)
            )
            .padding([3, 8])
            .style(move |_| container::Style::default()
                .background(iced::Background::Color(Color {
                    a: 0.15,
                    ..status_color
                }))
                .border(iced::Border {
                    radius: 4.0.into(),
                    width: 0.0,
                    color: Color::TRANSPARENT,
                })),
            text(format!("{}ms", response.duration_ms))
                .size(12)
                .color(style::TEXT_MUTED),
            text(format!("{} B", response.size_bytes))
                .size(12)
                .color(style::TEXT_MUTED),
            iced::widget::horizontal_space(),
            checkbox("Pretty", pretty_json)
                .on_toggle(Message::PrettyJsonToggled)
                .size(14)
                .text_size(12)
        ]
        .align_y(iced::alignment::Alignment::Center)
        .padding([6, 12])
        .spacing(12);

        let content: Element<'a, Message> = match active_tab {
            ResponseTab::Body => {
                let body_content = if pretty_json {
                    pretty_json_body(&response.body)
                } else {
                    response.body.clone()
                };
                scrollable(
                    container(text(body_content).size(RESPONSE_FONT_SIZE).font(iced::Font::MONOSPACE))
                        .padding(12)
                        .width(Length::Fill)
                        .style(|_| style::flat_surface_style(style::SURFACE_0)),
                )
                .height(Length::Fill)
                .into()
            }
            ResponseTab::Headers => scrollable(
                container(text(&response.headers).size(RESPONSE_FONT_SIZE).font(iced::Font::MONOSPACE))
                    .padding(12)
                    .width(Length::Fill)
                    .style(|_| style::flat_surface_style(style::SURFACE_0)),
            )
            .height(Length::Fill)
            .into(),
        };

        section = section.push(summary).push(
            horizontal_rule(1).style(|_| iced::widget::rule::Style {
                color: style::BORDER,
                width: 1,
                radius: 0.0.into(),
                fill_mode: iced::widget::rule::FillMode::Full,
            }),
        ).push(container(content).padding(4).height(Length::Fill));
    } else {
        let mut empty = column![text("No response yet").size(14).color(style::TEXT_MUTED)]
            .height(Length::Fill)
            .width(Length::Fill)
            .align_x(iced::alignment::Horizontal::Center)
            .spacing(8);

        if let Some(err) = error {
            empty = empty.push(text(format!("Error: {err}")).size(12).color(style::DANGER));
        }

        section = section.push(container(empty).height(Length::Fill).padding(20));
    }

    section.into()
}

fn tab_button<'a>(
    label: &'a str,
    tab: ResponseTab,
    active: ResponseTab,
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
    .on_press(Message::ResponseTabSelected(tab))
    .padding(0)
    .style(move |theme, status| style::section_tab_button(is_active, theme, status))
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
