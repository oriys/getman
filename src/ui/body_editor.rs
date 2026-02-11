use iced::widget::{column, text, text_editor};
use iced::Element;

use crate::Message;

pub fn view<'a>(editor: &'a text_editor::Content) -> Element<'a, Message> {
    column![
        text("Body").size(14),
        text_editor(editor)
            .on_action(Message::BodyEdited)
            .height(170),
    ]
    .spacing(6)
    .into()
}
