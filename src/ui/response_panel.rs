use iced::widget::{column, container, scrollable, text};
use iced::{Element, Length};

use crate::http::response::HttpResponse;
use crate::Message;

pub fn view<'a>(
    error: Option<&str>,
    response: Option<&'a HttpResponse>,
) -> Element<'a, Message> {
    let mut section = column![text("响应").size(20)].spacing(8);

    if let Some(err) = error {
        section = section.push(text(format!("错误: {err}")));
    }

    if let Some(response) = response {
        let summary = text(format!(
            "{} | {} ms | {} bytes",
            response.status, response.duration_ms, response.size_bytes
        ));

        let headers =
            scrollable(container(text(&response.headers).size(14)).padding(10)).height(150);

        let body = scrollable(container(text(&response.body).size(14)).padding(10))
            .height(Length::Fill);

        section = section
            .push(summary)
            .push(text("Response Headers").size(14))
            .push(headers)
            .push(text("Response Body").size(14))
            .push(body);
    } else {
        section = section.push(text("暂无响应"));
    }

    section.into()
}
