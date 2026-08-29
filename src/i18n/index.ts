import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { detectSystemLanguage } from "@/lib/systemLanguage";
import en from "./locales/en.json";
import ko from "./locales/ko.json";
import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
    "zh-TW": { translation: zhTW },
    ko: { translation: ko },
  },
  lng: detectSystemLanguage(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export const AVAILABLE_LANGUAGES = [
  { id: "en", name: "English" },
  { id: "zh-CN", name: "中文 (简体)" },
  { id: "zh-TW", name: "繁體中文" },
  { id: "ko", name: "한국어" },
];

export default i18n;
