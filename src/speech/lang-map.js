// FILE: src/speech/lang-map.js
// Single source of truth for mapping the fixed 28 UI languages to STT locales and Whisper language codes.
// Base UI strings remain English; this mapping only affects voice-to-text and downstream generation.

import { getLangList } from "../utils/i18n.js";

function normalizeLangCode(code) {
  return String(code || "en").toLowerCase();
}

/**
 * Best-effort STT locale mapping.
 * Why explicit? Many platform STT engines behave better with locales (xx-XX) than raw language codes (xx).
 * Keep this minimal to reduce update risk; default falls back to `code`.
 */
const DEFAULT_LOCALE_BY_CODE = {
  ar: "ar-SA",
  bg: "bg-BG",
  cs: "cs-CZ",
  da: "da-DK",
  de: "de-DE",
  el: "el-GR",
  en: "en-US",
  es: "es-ES",
  et: "et-EE",
  fa: "fa-IR",
  fi: "fi-FI",
  fr: "fr-FR",
  hi: "hi-IN",
  hu: "hu-HU",
  id: "id-ID",
  it: "it-IT",
  ja: "ja-JP",
  ko: "ko-KR",
  nl: "nl-NL",
  no: "nb-NO",   // Norwegian (Bokmål) is commonly used for STT
  pl: "pl-PL",
  pt: "pt-PT",   // You can switch to pt-BR later if your audience is Brazil-heavy
  ro: "ro-RO",
  ru: "ru-RU",
  sv: "sv-SE",
  th: "th-TH",
  tr: "tr-TR",
  zh: "zh-CN"    // Simplified default; can be made user-selectable later
};

/**
 * Whisper language codes are generally the short ISO-639-1 codes used in your 28-language list.
 * For Whisper auto mode, pass null.
 */
function toWhisperLang(code) {
  const c = normalizeLangCode(code);
  if (c === "zh") return "zh";
  return c;
}

export function buildLangMap() {
  const list = getLangList();
  const map = {};
  for (const { code } of list) {
    const c = normalizeLangCode(code);
    map[c] = {
      ui: c,
      sttLocale: DEFAULT_LOCALE_BY_CODE[c] || c,
      whisper: toWhisperLang(c)
    };
  }
  return map;
}

/**
 * Resolve the active UI language code given deviceLang and optional manual override.
 * - Base UI: English
 * - Auto: deviceLang (if supported by fixed 28 list)
 * - Manual: always wins if supported
 */
export function resolveUiLang({ deviceLang, manualLang } = {}) {
  const supported = new Set(getLangList().map(x => normalizeLangCode(x.code)));

  const pick = (v) => {
    const raw = normalizeLangCode(v);
    const base = raw.split("-")[0];
    if (supported.has(raw)) return raw;
    if (supported.has(base)) return base;
    return null;
  };

  return pick(manualLang) || pick(deviceLang) || "en";
}

export function resolveSttConfig({ deviceLang, manualLang } = {}) {
  const uiLang = resolveUiLang({ deviceLang, manualLang });
  const map = buildLangMap();
  const conf = map[uiLang] || map.en;

  return {
    uiLang,
    sttLocale: conf.sttLocale || "en-US",
    whisperLang: conf.whisper || "en"
  };
}
