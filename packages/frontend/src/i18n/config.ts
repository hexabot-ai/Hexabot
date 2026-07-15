/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

// Core i18next library.
import i18n from "i18next";
import Backend from "i18next-http-backend";
import { initReactI18next } from "react-i18next";

import { runtimeConfig } from "@/config/runtime";

i18n
  .use(initReactI18next)
  .use(Backend)
  .init({
    lng: runtimeConfig.lang.default,
    fallbackLng: "en",
    debug: process.env.NODE_ENV === "development",
    backend: {
      loadPath: "/locales/{{lng}}/{{ns}}.json",
    },
    ns: ["translation"],
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
