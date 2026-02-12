use iced::widget::{container, pick_list, row, text, text_input};
use iced::{Element, Length};

use crate::http::method::HttpMethod;
use crate::Message;

use super::style;

pub fn view<'a>(method: HttpMethod, url: &str, loading: bool) -> Element<'a, Message> {
    let method_color = style::method_color(method);

    let method_picklist = pick_list(
        &HttpMethod::ALL[..],
        Some(method),
        Message::MethodSelected,
    )
    .width(124)
    .style(move |theme: &iced::Theme, status| {
        let base = style::pick_list_style(theme, status);
        iced::widget::pick_list::Style {
            text_color: method_color,
            ..base
        }
    })
    .padding([8, 10]);

    let url_input = text_input("Enter request URL, e.g. https://httpbin.org/get", url)
        .on_input(Message::UrlChanged)
        .on_submit(Message::SendPressed)
        .padding(10)
        .size(14)
        .style(style::input_style)
        .width(Length::Fill);

    let send_button = if loading {
        iced::widget::button(
            container(text("Sending...").size(13))
                .center_x(Length::Shrink)
                .center_y(Length::Shrink),
        )
        .padding([8, 24])
        .style(style::primary_button)
    } else {
        iced::widget::button(
            container(text("Send").size(13))
                .center_x(Length::Shrink)
                .center_y(Length::Shrink),
        )
        .on_press(Message::SendPressed)
        .padding([8, 24])
        .style(style::primary_button)
    };

    let save_button = iced::widget::button(
        container(text("Save").size(13))
            .center_x(Length::Shrink)
            .center_y(Length::Shrink),
    )
    .on_press(Message::SaveRequestPressed)
    .padding([8, 16])
    .style(style::subtle_button);

    row![method_picklist, url_input, send_button, save_button]
        .spacing(8)
        .align_y(iced::alignment::Alignment::Center)
        .into()
}
