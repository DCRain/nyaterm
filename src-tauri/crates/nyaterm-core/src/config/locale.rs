pub fn map_locale_to_app_language(locale: &str) -> String {
    let normalized = locale.trim().replace('_', "-").to_ascii_lowercase();
    if normalized.is_empty() {
        return "en".to_string();
    }

    if normalized.starts_with("ko") {
        return "ko".to_string();
    }

    if normalized.starts_with("zh") {
        if normalized.contains("tw")
            || normalized.contains("hk")
            || normalized.contains("mo")
            || normalized.contains("hant")
        {
            return "zh-TW".to_string();
        }
        return "zh-CN".to_string();
    }

    "en".to_string()
}

pub fn detect_system_language() -> String {
    detect_system_locale()
        .map(|locale| map_locale_to_app_language(&locale))
        .unwrap_or_else(|| "en".to_string())
}

pub fn resolve_ui_language(language: Option<&str>) -> String {
    language
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(map_locale_to_app_language)
        .unwrap_or_else(detect_system_language)
}

#[cfg(windows)]
fn detect_system_locale() -> Option<String> {
    use windows_sys::Win32::Globalization::GetUserDefaultLocaleName;

    let mut buffer = [0u16; 85];
    let len = unsafe { GetUserDefaultLocaleName(buffer.as_mut_ptr(), buffer.len() as i32) };
    if len <= 1 {
        return None;
    }

    Some(String::from_utf16_lossy(&buffer[..len as usize - 1]))
}

#[cfg(not(windows))]
fn detect_system_locale() -> Option<String> {
    for key in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(value) = std::env::var(key) {
            let locale = value.split('.').next()?.trim().to_string();
            if !locale.is_empty() && locale != "C" && locale != "POSIX" {
                return Some(locale);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{detect_system_language, map_locale_to_app_language, resolve_ui_language};

    #[test]
    fn maps_chinese_locale_variants() {
        assert_eq!(map_locale_to_app_language("zh-CN"), "zh-CN");
        assert_eq!(map_locale_to_app_language("zh_SG"), "zh-CN");
        assert_eq!(map_locale_to_app_language("zh-TW"), "zh-TW");
        assert_eq!(map_locale_to_app_language("zh-HK"), "zh-TW");
        assert_eq!(map_locale_to_app_language("ko-KR"), "ko");
        assert_eq!(map_locale_to_app_language("en-US"), "en");
        assert_eq!(map_locale_to_app_language("fr-FR"), "en");
    }

    #[test]
    fn resolve_ui_language_uses_explicit_value_or_system_default() {
        assert_eq!(resolve_ui_language(Some("zh-TW")), "zh-TW");
        assert_eq!(resolve_ui_language(Some("")), detect_system_language());
        assert_eq!(resolve_ui_language(None), detect_system_language());
    }
}
