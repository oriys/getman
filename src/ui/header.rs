use iced::alignment::Alignment;
use iced::widget::{button, container, horizontal_space, pick_list, row, text};
use iced::{Element, Length};

use crate::EnvironmentOption;
use crate::Message;

use super::style;

pub fn view<'a>(
    sidebar_open: bool,
    active_environment: EnvironmentOption,
) -> Element<'a, Message> {
    let sidebar_toggle = button(text(if sidebar_open { "◀" } else { "▶" }).size(14))
        .on_press(Message::SidebarTogglePressed)
        .padding([6, 10])
        .style(style::ghost_button);

    let env_select = pick_list(
        &EnvironmentOption::ALL[..],
        Some(active_environment),
        Message::EnvironmentSelected,
    )
    .width(160)
    .style(style::pick_list_style)
    .padding([5, 8]);

    container(
        row![
            sidebar_toggle,
            text("Getman").size(16),
            text(format!("v{}", env!("CARGO_PKG_VERSION"))).size(10).color(style::TEXT_MUTED),
            horizontal_space(),
            env_select
        ]
        .spacing(8)
        .padding([5, 12])
        .align_y(Alignment::Center),
    )
    .width(Length::Fill)
    .style(|_| style::surface_style(style::SURFACE_1, 0.0))
    .into()
}
