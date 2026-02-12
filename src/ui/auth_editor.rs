use iced::widget::{column, pick_list, row, text, text_input};
use iced::{Element, Length};

use crate::auth::AuthType;
use crate::Message;

use super::style;

pub fn view<'a>(
    auth_type: AuthType,
    bearer_token: &str,
    basic_username: &str,
    basic_password: &str,
    api_key: &str,
    api_value: &str,
) -> Element<'a, Message> {
    let auth_type_selector = pick_list(&AuthType::ALL[..], Some(auth_type), Message::AuthTypeSelected)
        .width(240)
        .style(style::pick_list_style)
        .padding([6, 8]);

    let mut section = column![text("Auth").size(14), auth_type_selector]
        .spacing(8)
        .height(Length::Fill);

    section = match auth_type {
        AuthType::None => section.push(text("No authorization").size(12).color(style::TEXT_MUTED)),
        AuthType::BearerToken => section.push(
            text_input("Bearer token", bearer_token)
                .on_input(Message::AuthBearerTokenChanged)
                .padding(10)
                .style(style::input_style)
                .width(Length::Fill),
        ),
        AuthType::BasicAuth => {
            let username = text_input("Username", basic_username)
                .on_input(Message::AuthBasicUsernameChanged)
                .padding(10)
                .style(style::input_style)
                .width(Length::FillPortion(1));
            let password = text_input("Password", basic_password)
                .on_input(Message::AuthBasicPasswordChanged)
                .padding(10)
                .style(style::input_style)
                .width(Length::FillPortion(1));
            section.push(row![username, password].spacing(10))
        }
        AuthType::ApiKeyHeader | AuthType::ApiKeyQuery => {
            let key = text_input("Key", api_key)
                .on_input(Message::AuthApiKeyChanged)
                .padding(10)
                .style(style::input_style)
                .width(Length::FillPortion(1));
            let value = text_input("Value", api_value)
                .on_input(Message::AuthApiValueChanged)
                .padding(10)
                .style(style::input_style)
                .width(Length::FillPortion(1));
            section.push(row![key, value].spacing(10))
        }
    };

    section.into()
}
