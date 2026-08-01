use tauri::WebviewWindow;

const APPLICATION_NAME: &str = "SiaoVPlay";
const MAX_MEDIA_TITLE_CHARS: usize = 160;

pub fn apply(window: &WebviewWindow) {
    #[cfg(windows)]
    {
        apply_windows_frame(window);
        let event_window = window.clone();
        window.on_window_event(move |event| {
            if matches!(
                event,
                tauri::WindowEvent::Focused(true) | tauri::WindowEvent::ThemeChanged(_)
            ) {
                apply_windows_frame(&event_window);
            }
        });
    }
    #[cfg(not(windows))]
    let _ = window;
}

pub fn set_media_title(window: &WebviewWindow, media_title: Option<&str>) -> tauri::Result<()> {
    window.set_title(&window_title(media_title))
}

fn window_title(media_title: Option<&str>) -> String {
    let title = media_title
        .unwrap_or_default()
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(MAX_MEDIA_TITLE_CHARS)
        .collect::<String>();
    if title.is_empty() {
        APPLICATION_NAME.to_owned()
    } else {
        format!("{title} — {APPLICATION_NAME}")
    }
}

#[cfg(windows)]
fn apply_windows_frame(window: &WebviewWindow) {
    use std::{ffi::c_void, mem::size_of};

    use windows_sys::Win32::{
        Foundation::HWND,
        Graphics::Dwm::{
            DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_COLOR_DEFAULT, DWMWA_TEXT_COLOR,
            DWMWA_USE_IMMERSIVE_DARK_MODE, DwmSetWindowAttribute,
        },
        UI::{
            Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW},
            WindowsAndMessaging::{SPI_GETHIGHCONTRAST, SystemParametersInfoW},
        },
    };

    let high_contrast = unsafe {
        let mut settings = HIGHCONTRASTW {
            cbSize: size_of::<HIGHCONTRASTW>() as u32,
            ..Default::default()
        };
        let detected = SystemParametersInfoW(
            SPI_GETHIGHCONTRAST,
            settings.cbSize,
            (&mut settings as *mut HIGHCONTRASTW).cast::<c_void>(),
            0,
        );
        (detected != 0).then_some(settings.dwFlags & HCF_HIGHCONTRASTON != 0)
    };

    let use_dark_frame = match high_contrast {
        Some(enabled) => !enabled,
        None => {
            eprintln!(
                "SiaoVPlay: unable to detect Windows high-contrast mode; preserving the system frame"
            );
            return;
        }
    };

    let preferred_theme = use_dark_frame.then_some(tauri::Theme::Dark);
    if let Err(error) = window.set_theme(preferred_theme) {
        eprintln!("SiaoVPlay: unable to update the native window theme: {error}");
    }

    let hwnd: HWND = match window.hwnd() {
        Ok(handle) => handle.0,
        Err(error) => {
            eprintln!("SiaoVPlay: unable to obtain the main window handle: {error}");
            return;
        }
    };
    let dark_mode_enabled: i32 = i32::from(use_dark_frame);
    let (caption_color, text_color, border_color) = if use_dark_frame {
        (
            color_ref(28, 29, 31),
            color_ref(240, 242, 244),
            color_ref(49, 51, 55),
        )
    } else {
        (
            DWMWA_COLOR_DEFAULT,
            DWMWA_COLOR_DEFAULT,
            DWMWA_COLOR_DEFAULT,
        )
    };

    let dark_mode_result = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE as u32,
            (&dark_mode_enabled as *const i32).cast::<c_void>(),
            size_of::<i32>() as u32,
        )
    };
    if dark_mode_result < 0 {
        // Windows 10 builds before the public attribute stabilized used value 19.
        const LEGACY_IMMERSIVE_DARK_MODE: u32 = 19;
        let legacy_result = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                LEGACY_IMMERSIVE_DARK_MODE,
                (&dark_mode_enabled as *const i32).cast::<c_void>(),
                size_of::<i32>() as u32,
            )
        };
        if legacy_result < 0 {
            eprintln!(
                "SiaoVPlay: unable to apply native immersive dark mode (HRESULT {dark_mode_result:#x}; legacy HRESULT {legacy_result:#x})"
            );
        }
    }

    for (attribute, value, name) in [
        (DWMWA_CAPTION_COLOR, caption_color, "caption color"),
        (DWMWA_TEXT_COLOR, text_color, "caption text color"),
        (DWMWA_BORDER_COLOR, border_color, "window border color"),
    ] {
        let result = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                attribute as u32,
                (&value as *const u32).cast::<c_void>(),
                size_of::<u32>() as u32,
            )
        };
        if result < 0 {
            eprintln!("SiaoVPlay: unable to apply native {name} (HRESULT {result:#x})");
        }
    }
}

#[cfg(windows)]
const fn color_ref(red: u8, green: u8, blue: u8) -> u32 {
    red as u32 | ((green as u32) << 8) | ((blue as u32) << 16)
}

#[cfg(test)]
mod tests {
    use super::window_title;

    #[test]
    fn native_title_uses_the_application_name_for_the_library() {
        assert_eq!(window_title(None), "SiaoVPlay");
        assert_eq!(window_title(Some("   \n\t")), "SiaoVPlay");
    }

    #[test]
    fn native_title_sanitizes_and_bounds_media_text() {
        assert_eq!(window_title(Some("  雨\n站台  ")), "雨站台 — SiaoVPlay");
        let long_title = "a".repeat(200);
        assert_eq!(window_title(Some(&long_title)).chars().count(), 172);
    }
}
