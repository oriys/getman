use iced::widget::{button, container, pick_list, text_editor, text_input};
use iced::{Background, Border, Color, Theme};

use crate::http::method::HttpMethod;

pub const BG: Color = Color {
    r: 18.0 / 255.0,
    g: 21.0 / 255.0,
    b: 27.0 / 255.0,
    a: 1.0,
};
pub const SURFACE_0: Color = Color {
    r: 20.0 / 255.0,
    g: 24.0 / 255.0,
    b: 32.0 / 255.0,
    a: 1.0,
};
pub const SURFACE_1: Color = Color {
    r: 25.0 / 255.0,
    g: 30.0 / 255.0,
    b: 38.0 / 255.0,
    a: 1.0,
};
pub const SURFACE_2: Color = Color {
    r: 31.0 / 255.0,
    g: 37.0 / 255.0,
    b: 46.0 / 255.0,
    a: 1.0,
};
pub const SURFACE_3: Color = Color {
    r: 37.0 / 255.0,
    g: 45.0 / 255.0,
    b: 56.0 / 255.0,
    a: 1.0,
};
pub const BORDER: Color = Color {
    r: 48.0 / 255.0,
    g: 58.0 / 255.0,
    b: 70.0 / 255.0,
    a: 1.0,
};
pub const TEXT: Color = Color {
    r: 230.0 / 255.0,
    g: 236.0 / 255.0,
    b: 244.0 / 255.0,
    a: 1.0,
};
pub const TEXT_MUTED: Color = Color {
    r: 132.0 / 255.0,
    g: 145.0 / 255.0,
    b: 160.0 / 255.0,
    a: 1.0,
};
pub const PRIMARY: Color = Color {
    r: 58.0 / 255.0,
    g: 201.0 / 255.0,
    b: 111.0 / 255.0,
    a: 1.0,
};
pub const PRIMARY_HOVER: Color = Color {
    r: 71.0 / 255.0,
    g: 214.0 / 255.0,
    b: 124.0 / 255.0,
    a: 1.0,
};
pub const DANGER: Color = Color {
    r: 226.0 / 255.0,
    g: 92.0 / 255.0,
    b: 92.0 / 255.0,
    a: 1.0,
};

pub const METHOD_GET: Color = Color {
    r: 73.0 / 255.0,
    g: 204.0 / 255.0,
    b: 144.0 / 255.0,
    a: 1.0,
};
pub const METHOD_POST: Color = Color {
    r: 1.0,
    g: 176.0 / 255.0,
    b: 59.0 / 255.0,
    a: 1.0,
};
pub const METHOD_PUT: Color = Color {
    r: 82.0 / 255.0,
    g: 167.0 / 255.0,
    b: 244.0 / 255.0,
    a: 1.0,
};
pub const METHOD_PATCH: Color = Color {
    r: 180.0 / 255.0,
    g: 130.0 / 255.0,
    b: 240.0 / 255.0,
    a: 1.0,
};
pub const METHOD_DELETE: Color = Color {
    r: 240.0 / 255.0,
    g: 92.0 / 255.0,
    b: 92.0 / 255.0,
    a: 1.0,
};
pub const METHOD_HEAD: Color = Color {
    r: 73.0 / 255.0,
    g: 204.0 / 255.0,
    b: 144.0 / 255.0,
    a: 1.0,
};
pub const METHOD_OPTIONS: Color = Color {
    r: 233.0 / 255.0,
    g: 120.0 / 255.0,
    b: 180.0 / 255.0,
    a: 1.0,
};

pub fn method_color(method: HttpMethod) -> Color {
    match method {
        HttpMethod::Get => METHOD_GET,
        HttpMethod::Post => METHOD_POST,
        HttpMethod::Put => METHOD_PUT,
        HttpMethod::Patch => METHOD_PATCH,
        HttpMethod::Delete => METHOD_DELETE,
        HttpMethod::Head => METHOD_HEAD,
        HttpMethod::Options => METHOD_OPTIONS,
    }
}

pub fn app_theme() -> Theme {
    Theme::custom(
        "Getman".to_string(),
        iced::theme::Palette {
            background: BG,
            text: TEXT,
            primary: PRIMARY,
            success: PRIMARY,
            danger: DANGER,
        },
    )
}

pub fn surface_style(color: Color, border_radius: f32) -> container::Style {
    container::Style::default()
        .background(Background::Color(color))
        .color(TEXT)
        .border(Border {
            radius: border_radius.into(),
            width: 1.0,
            color: BORDER,
        })
}

pub fn flat_surface_style(color: Color) -> container::Style {
    container::Style::default()
        .background(Background::Color(color))
        .color(TEXT)
}

pub fn section_tab_button(active: bool, _theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Active => {
            if active {
                SURFACE_1
            } else {
                SURFACE_0
            }
        }
        button::Status::Hovered => SURFACE_1,
        button::Status::Pressed => SURFACE_2,
        button::Status::Disabled => SURFACE_0,
    };

    button::Style {
        background: Some(Background::Color(bg)),
        text_color: if active { TEXT } else { TEXT_MUTED },
        border: Border {
            radius: 0.0.into(),
            width: 0.0,
            color: Color::TRANSPARENT,
        },
        shadow: Default::default(),
    }
}

pub fn primary_button(_theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Active => PRIMARY,
        button::Status::Hovered => PRIMARY_HOVER,
        button::Status::Pressed => PRIMARY,
        button::Status::Disabled => SURFACE_3,
    };

    button::Style {
        background: Some(Background::Color(bg)),
        text_color: if matches!(status, button::Status::Disabled) {
            TEXT_MUTED
        } else {
            BG
        },
        border: Border {
            radius: 8.0.into(),
            width: 1.0,
            color: bg,
        },
        shadow: Default::default(),
    }
}

pub fn subtle_button(_theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Active => SURFACE_2,
        button::Status::Hovered => SURFACE_3,
        button::Status::Pressed => SURFACE_3,
        button::Status::Disabled => SURFACE_1,
    };

    button::Style {
        background: Some(Background::Color(bg)),
        text_color: if matches!(status, button::Status::Disabled) {
            TEXT_MUTED
        } else {
            TEXT
        },
        border: Border {
            radius: 8.0.into(),
            width: 1.0,
            color: BORDER,
        },
        shadow: Default::default(),
    }
}

pub fn ghost_button(_theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Active => SURFACE_1,
        button::Status::Hovered => SURFACE_2,
        button::Status::Pressed => SURFACE_2,
        button::Status::Disabled => SURFACE_1,
    };

    button::Style {
        background: Some(Background::Color(bg)),
        text_color: if matches!(status, button::Status::Disabled) {
            TEXT_MUTED
        } else {
            TEXT_MUTED
        },
        border: Border {
            radius: 6.0.into(),
            width: 1.0,
            color: BORDER,
        },
        shadow: Default::default(),
    }
}

pub fn list_item_button(active: bool, _theme: &Theme, status: button::Status) -> button::Style {
    let active_bg = Color::from_rgba(0.23, 0.79, 0.44, 0.15);
    let bg = match status {
        button::Status::Active => {
            if active {
                active_bg
            } else {
                SURFACE_1
            }
        }
        button::Status::Hovered => SURFACE_2,
        button::Status::Pressed => SURFACE_3,
        button::Status::Disabled => SURFACE_1,
    };

    button::Style {
        background: Some(Background::Color(bg)),
        text_color: if active { TEXT } else { TEXT_MUTED },
        border: Border {
            radius: 6.0.into(),
            width: if active { 1.0 } else { 0.0 },
            color: if active { PRIMARY } else { BORDER },
        },
        shadow: Default::default(),
    }
}

pub fn input_style(_theme: &Theme, status: text_input::Status) -> text_input::Style {
    let base = text_input::Style {
        background: Background::Color(SURFACE_1),
        border: Border {
            radius: 8.0.into(),
            width: 1.0,
            color: BORDER,
        },
        icon: TEXT_MUTED,
        placeholder: TEXT_MUTED,
        value: TEXT,
        selection: Color::from_rgba(0.23, 0.79, 0.44, 0.35),
    };

    match status {
        text_input::Status::Active => base,
        text_input::Status::Hovered => text_input::Style {
            border: Border {
                color: SURFACE_3,
                ..base.border
            },
            ..base
        },
        text_input::Status::Focused => text_input::Style {
            border: Border {
                color: PRIMARY,
                ..base.border
            },
            ..base
        },
        text_input::Status::Disabled => text_input::Style {
            value: TEXT_MUTED,
            ..base
        },
    }
}

pub fn editor_style(_theme: &Theme, status: text_editor::Status) -> text_editor::Style {
    let base = text_editor::Style {
        background: Background::Color(SURFACE_1),
        border: Border {
            radius: 8.0.into(),
            width: 1.0,
            color: BORDER,
        },
        icon: TEXT_MUTED,
        placeholder: TEXT_MUTED,
        value: TEXT,
        selection: Color::from_rgba(0.23, 0.79, 0.44, 0.35),
    };

    match status {
        text_editor::Status::Active => base,
        text_editor::Status::Hovered => text_editor::Style {
            border: Border {
                color: SURFACE_3,
                ..base.border
            },
            ..base
        },
        text_editor::Status::Focused => text_editor::Style {
            border: Border {
                color: PRIMARY,
                ..base.border
            },
            ..base
        },
        text_editor::Status::Disabled => text_editor::Style {
            value: TEXT_MUTED,
            ..base
        },
    }
}

pub fn pick_list_style(_theme: &Theme, status: pick_list::Status) -> pick_list::Style {
    let base = pick_list::Style {
        text_color: TEXT,
        background: Background::Color(SURFACE_1),
        placeholder_color: TEXT_MUTED,
        handle_color: TEXT_MUTED,
        border: Border {
            radius: 8.0.into(),
            width: 1.0,
            color: BORDER,
        },
    };

    match status {
        pick_list::Status::Active => base,
        pick_list::Status::Hovered | pick_list::Status::Opened => pick_list::Style {
            border: Border {
                color: PRIMARY,
                ..base.border
            },
            ..base
        },
    }
}
