import "i18next";
import type enChat from "./locales/en/chat.json";
import type enCommon from "./locales/en/common.json";
import type enErrors from "./locales/en/errors.json";
import type enHome from "./locales/en/home.json";
import type enSettings from "./locales/en/settings.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof enCommon;
      settings: typeof enSettings;
      chat: typeof enChat;
      home: typeof enHome;
      errors: typeof enErrors;
    };
  }
}
