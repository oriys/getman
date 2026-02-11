use iced::widget::{column, text, text_editor};
use iced::Element;

use crate::Message;

pub fn view<'a>(editor: &'a text_editor::Content) -> Element<'a, Message> {
    column![
        text("Headers (每行一个，格式: Key: Value)").size(14),
        text_editor(editor)
            .on_action(Message::HeadersEdited)
            .height(130),
    ]
    .spacing(6)
    .into()
}
