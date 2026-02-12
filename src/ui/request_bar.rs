use iced::widget::{pick_list, row, text_input};
use iced::{Element, Length};

use crate::http::method::HttpMethod;
use crate::Message;

use super::style;

pub fn view<'a>(method: HttpMethod, url: &str, loading: bool) -> Element<'a, Message> {
    let method_picklist = pick_list(
        &HttpMethod::ALL[..],
        Some(method),
        Message::MethodSelected,
    )
    .width(124)
    .style(style::pick_list_style)
    .padding([6, 8]);

    let url_input = text_input("https://httpbin.org/get", url)
        .on_input(Message::UrlChanged)
        .on_submit(Message::SendPressed)
        .padding(10)
        .size(14)
        .style(style::input_style)
        .width(Length::Fill);

    let send_button = if loading {
        iced::widget::button("Sending...")
            .padding([9, 14])
            .style(style::primary_button)
    } else {
        iced::widget::button("Send")
            .on_press(Message::SendPressed)
            .padding([9, 14])
            .style(style::primary_button)
    };

    let save_button = iced::widget::button("Save")
        .on_press(Message::SaveRequestPressed)
        .padding([9, 14])
        .style(style::subtle_button);

    row![method_picklist, url_input, send_button, save_button]
        .spacing(8)
        .into()
}
