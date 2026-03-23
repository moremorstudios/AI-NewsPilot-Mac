// FILE: src/utils/i18n.js
// Purpose:
// - Provide language list (28 + en/en-US/en-GB)
// - Load UI dictionaries from: src/assets/i18n/<lang>.json
// - Provide safe fallback translator: lang -> en -> key
//
// IMPORTANT RULES (project):
// - No embedded translations in this file.
// - No new paths. Do not move files.
// - No UI/term/menu changes here.

const LANGS = [
  // English group (always at top)
  { code: "en",    name: "English (Global)" },
  { code: "en-US", name: "English (US)" },
  { code: "en-GB", name: "English (UK)" },

  // Others (alphabetical by English name)
  { code: "ar", name: "Arabic" },
  { code: "bg", name: "Bulgarian" },
  { code: "zh", name: "Chinese" },
  { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
  { code: "es", name: "Spanish" },
  { code: "fa", name: "Persian" },
  { code: "fi", name: "Finnish" },
  { code: "fr", name: "French" },
  { code: "hi", name: "Hindi" },
  { code: "hu", name: "Hungarian" },
  { code: "id", name: "Indonesian" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "nl", name: "Dutch" },
  { code: "no", name: "Norwegian" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "ro", name: "Romanian" },
  { code: "ru", name: "Russian" },
  { code: "sv", name: "Swedish" },
  { code: "th", name: "Thai" },
  { code: "tr", name: "Turkish" },
  { code: "uk", name: "Ukrainian" }
];

const SUPPORTED = new Set(LANGS.map(x => x.code));

export function getLangList() {
  const top = LANGS.filter(x =>
    x.code === "en" || x.code === "en-US" || x.code === "en-GB"
  );
  const rest = LANGS
    .filter(x => x.code !== "en" && x.code !== "en-US" && x.code !== "en-GB")
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...top, ...rest];
}

function normalizeLangCode(lang) {
  const raw = String(lang || "").trim();
  if (!raw) return "en";

  const low = raw.toLowerCase();
  if (low === "en-us") return "en-US";
  if (low === "en-gb") return "en-GB";

  if (SUPPORTED.has(raw)) return raw;
  if (SUPPORTED.has(low)) return low;

  const base = raw.includes("-") ? raw.split("-")[0] : raw;
  const baseLow = base.toLowerCase();
  if (SUPPORTED.has(base)) return base;
  if (SUPPORTED.has(baseLow)) return baseLow;

  return "en";
}

function buildDictUrl(langCode) {
  // This module lives in: src/utils/i18n.js
  // Dictionaries live in: src/assets/i18n/<lang>.json
  // Relative path: ../assets/i18n/
  return new URL(`../assets/i18n/${langCode}.json`, import.meta.url);
}

async function fetchJsonOrNull(urlObj) {
  try {
    const res = await fetch(String(urlObj), { cache: "no-store" });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function makeT(dict, fallbackDict) {
  return function t(key, vars = null) {
    const k = String(key || "").trim();
    if (!k) return "";

    let s = "";
    if (dict && Object.prototype.hasOwnProperty.call(dict, k)) {
      s = String(dict[k] ?? "");
    }
    if (!s && fallbackDict && Object.prototype.hasOwnProperty.call(fallbackDict, k)) {
      s = String(fallbackDict[k] ?? "");
    }
    if (!s) s = k;

    if (vars && typeof vars === "object") {
      for (const [vk, vv] of Object.entries(vars)) {
        const token = `{${vk}}`;
        s = s.split(token).join(String(vv));
      }
    }
    return s;
  };
}

// ---- DOM integration (optional; safe in Node/Electron) --------------------

let currentI18n = {
  ok: true,
  lang: "en",
  dict: {},
  fallbackLang: "en",
  fallbackDict: {},
  t: (k) => (k == null ? "" : String(k))
};

export function getCurrentI18n() {
  return currentI18n;
}

// Orijinal metinleri hatırlamak için (dil değiştirmede bozulmasın)
const textNodeBaseMap = new WeakMap();
const attrNodeBaseMap = new WeakMap();

/**
 * applyDomTranslations(i18n)
 * - Kısa statik text node'ları tarar (örneğin buton, menü label'ları)
 * - İngilizce metni JSON key'i olarak kullanır
 * - Yeni dile çevirir
 */
function applyDomTranslations(i18n) {
  if (typeof document === "undefined") return;
  if (!i18n || typeof i18n.t !== "function") return;
  const t = i18n.t;

  // FIX #1: en, en-US, en-GB hepsi "English family" sayılmalı
  const isEnglish = String(i18n.lang || "").toLowerCase().startsWith("en");

  try {
    // Text node'lar
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    let node;
    while ((node = walker.nextNode())) {
      const raw = node.nodeValue;
      if (!raw) continue;

      const trimmed = raw.trim();
      if (!trimmed) continue;

      // Çok uzun bloklara dokunma (haber gövdeleri vs.)
      if (trimmed.length > 160) continue;

      let baseKey = textNodeBaseMap.get(node);
      if (!baseKey) {
        // İlk çalıştırmada orijinal İngilizce metni kaydediyoruz
        baseKey = trimmed;
        textNodeBaseMap.set(node, baseKey);
      }

      const translated = t(baseKey);

      const leading = raw.match(/^\s*/)?.[0] || "";
      const trailing = raw.match(/\s*$/)?.[0] || "";

      // FIX #2: English'e dönünce baseKey'i geri yaz (önceden çevrilmiş metinler EN'e dönmez bug'ı)
      if (isEnglish) {
        node.nodeValue = leading + baseKey + trailing;
        continue;
      }

      if (!translated || translated === baseKey) continue;

      node.nodeValue = leading + translated + trailing;
    }

    // title / placeholder / aria-label gibi attribute'lar
    const ATTRS = ["title", "placeholder", "aria-label"];
    for (const attr of ATTRS) {
      const elements = document.querySelectorAll("[" + attr + "]");
      elements.forEach((el) => {
        const rawAttr = el.getAttribute(attr);
        if (!rawAttr) return;

        const trimmed = rawAttr.trim();
        if (!trimmed) return;
        if (trimmed.length > 160) return;

        let baseMap = attrNodeBaseMap.get(el);
        if (!baseMap) {
          baseMap = {};
          attrNodeBaseMap.set(el, baseMap);
        }

        let baseKey = baseMap[attr];
        if (!baseKey) {
          baseKey = trimmed;
          baseMap[attr] = baseKey;
        }

        const translated = t(baseKey);

        // FIX #3: English'e dönünce attribute'u baseKey'e geri yaz
        if (isEnglish) {
          el.setAttribute(attr, baseKey);
          return;
        }

        if (!translated || translated === baseKey) return;

        el.setAttribute(attr, translated);
      });
    }
  } catch (err) {
    try {
      console.warn("applyDomTranslations failed:", err);
    } catch (_) {
      // sessiz geç
    }
  }
}

// ---- Public API -----------------------------------------------------------

/**
 * loadI18n(lang)
 * Loads dictionaries from src/assets/i18n/<lang>.json
 * Returns snapshot:
 *  {
 *    ok: boolean,
 *    lang: string,
 *    dict: object,
 *    fallbackLang: "en",
 *    fallbackDict: object,
 *    t: (key, vars?) => string
 *  }
 */
export async function loadI18n(lang = "en") {
  const code = normalizeLangCode(lang);

  const enUrl = buildDictUrl("en");
  const langUrl = buildDictUrl(code);

  // EN fallback
  let fallbackDict = await fetchJsonOrNull(enUrl);
  if (fallbackDict == null) fallbackDict = {};

  // Seçilen dil
  let dict;
  if (code === "en") {
    dict = fallbackDict;
  } else {
    dict = await fetchJsonOrNull(langUrl);
    if (dict == null) dict = fallbackDict;
  }

  const snap = {
    ok: true,
    lang: code,
    dict,
    fallbackLang: "en",
    fallbackDict,
    t: makeT(dict, fallbackDict)
  };

  // Global snapshot güncelle
  currentI18n = snap;

  // DOM çevirisini tetikle (renderer ortamında)
  try {
    applyDomTranslations(snap);
  } catch (_) {
    // UI hiçbir zaman çökmesin
  }

  return snap;
}
