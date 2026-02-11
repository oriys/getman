use iced::widget::{pick_list, row, text_input};
use iced::{Element, Length};

use crate::http::method::HttpMethod;
use crate::Message;

pub fn view<'a>(method: HttpMethod, url: &str, loading: bool) -> Element<'a, Message> {
    let method_picklist = pick_list(
        &HttpMethod::ALL[..],
        Some(method),
        Message::MethodSelected,
    )
    .width(120);

    let url_input = text_input("https://httpbin.org/get", url)
        .on_input(Message::UrlChanged)
        .padding(10)
        .size(16)
        .width(Length::Fill);

    let send_button = if loading {
        iced::widget::button("发送中...").padding(10)
    } else {
        iced::widget::button("发送")
            .on_press(Message::SendPressed)
            .padding(10)
    };

    row![method_picklist, url_input, send_button]
        .spacing(10)
        .into()
}
