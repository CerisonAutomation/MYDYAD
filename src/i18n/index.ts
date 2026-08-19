import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enChat from "./locales/en/chat.json";
// Import all English locale bundles (bundled with the app)
import enCommon from "./locales/en/common.json";
import enErrors from "./locales/en/errors.json";
import enHome from "./locales/en/home.json";
import enSettings from "./locales/en/settings.json";

import zhCNChat from "./locales/zh-CN/chat.json";
// Chinese Simplified
import zhCNCommon from "./locales/zh-CN/common.json";
import zhCNErrors from "./locales/zh-CN/errors.json";
import zhCNHome from "./locales/zh-CN/home.json";
import zhCNSettings from "./locales/zh-CN/settings.json";

import ptBRChat from "./locales/pt-BR/chat.json";
// Brazilian Portuguese
import ptBRCommon from "./locales/pt-BR/common.json";
import ptBRErrors from "./locales/pt-BR/errors.json";
import ptBRHome from "./locales/pt-BR/home.json";
import ptBRSettings from "./locales/pt-BR/settings.json";

import esChat from "./locales/es/chat.json";
// Spanish
import esCommon from "./locales/es/common.json";
import esErrors from "./locales/es/errors.json";
import esHome from "./locales/es/home.json";
import esSettings from "./locales/es/settings.json";

import koChat from "./locales/ko/chat.json";
// Korean
import koCommon from "./locales/ko/common.json";
import koErrors from "./locales/ko/errors.json";
import koHome from "./locales/ko/home.json";
import koSettings from "./locales/ko/settings.json";

const resources = {
  en: {
    common: enCommon,
    settings: enSettings,
    chat: enChat,
    home: enHome,
    errors: enErrors,
  },
  "zh-CN": {
    common: zhCNCommon,
    settings: zhCNSettings,
    chat: zhCNChat,
    home: zhCNHome,
    errors: zhCNErrors,
  },
  "pt-BR": {
    common: ptBRCommon,
    settings: ptBRSettings,
    chat: ptBRChat,
    home: ptBRHome,
    errors: ptBRErrors,
  },
  es: {
    common: esCommon,
    settings: esSettings,
    chat: esChat,
    home: esHome,
    errors: esErrors,
  },
  ko: {
    common: koCommon,
    settings: koSettings,
    chat: koChat,
    home: koHome,
    errors: koErrors,
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: "en", // Default; overridden by user setting on startup
  fallbackLng: "en",
  defaultNS: "common",
  ns: ["common", "settings", "chat", "home", "errors"],
  interpolation: {
    escapeValue: false, // React already escapes rendered output
  },
});

export default i18n;
