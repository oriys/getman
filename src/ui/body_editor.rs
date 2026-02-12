use iced::widget::{column, text, text_editor};
use iced::{Element, Length};

use crate::Message;

use super::style;

pub fn view<'a>(editor: &'a text_editor::Content) -> Element<'a, Message> {
    column![
        text("Body").size(14),
        text_editor(editor)
            .on_action(Message::BodyEdited)
            .height(Length::Fill)
            .style(style::editor_style),
    ]
    .spacing(6)
    .height(Length::Fill)
    .into()
}
