const SUPPORTED_LANGUAGE_IDS = new Set(["en", "zh-CN", "zh-TW", "ko"]);

/** Map an OS / browser locale tag to a supported app language id. */
export function resolveAppLanguage(locale: string | null | undefined): string {
  const normalized = (locale ?? "").trim().replace(/_/g, "-").toLowerCase();
  if (!normalized) {
    return "en";
  }

  if (normalized.startsWith("ko")) {
    return "ko";
  }

  if (normalized.startsWith("zh")) {
    if (
      normalized.includes("tw") ||
      normalized.includes("hk") ||
      normalized.includes("mo") ||
      normalized.includes("hant")
    ) {
      return "zh-TW";
    }
    return "zh-CN";
  }

  if (normalized.startsWith("en")) {
    return "en";
  }

  return "en";
}

/** Resolve the best supported language from the current runtime locale list. */
export function detectSystemLanguage(): string {
  const candidates = [...navigator.languages, navigator.language].filter(Boolean);
  for (const locale of candidates) {
    const resolved = resolveAppLanguage(locale);
    if (SUPPORTED_LANGUAGE_IDS.has(resolved)) {
      return resolved;
    }
  }
  return "en";
}
