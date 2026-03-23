// FILE: src/app/generate.js
import { getState, setState } from "./state.js";
import { addVersion } from "./versions.js";
import * as LNIE from "../ai/lnie/index.js";
import { generateOpenAIPackage } from "../ai/cloud/openai.js";
import { getApiKey } from "./storage.js";
import { trimToMaxWords } from "../ai/lnie/language-utils.js";

function normalizeInputTextKeepNewlines(raw) {
  let t = String(raw || "");
  // keep real newlines; fix CRLF
  t = t.replace(/\r\n/g, "\n");
  // convert literal "\n" sequences (pasted JSON style) into real newlines
  t = t.replace(/\\n/g, "\n").replace(/\\r/g, "");
  return t;
}

function buildPayload(state) {
  const ui = state.ui || {};
  const inputs = state.inputs || {};
  const versions = (state.versions && state.versions.items) || [];

  // ✅ Defensive sync: if UI dropdowns are rendered but state is stale (e.g., after a previous session),
  // prefer the current DOM values. This prevents Newspaper showing Agency outputs unless the user
  // manually toggles the menu.
  const domStyle = (typeof document !== "undefined") ? document.getElementById("styleSelect")?.value : null;
  const domTone  = (typeof document !== "undefined") ? document.getElementById("toneSelect")?.value : null;
  const domLang  = (typeof document !== "undefined") ? document.getElementById("languageSelect")?.value : null;

  const style = domStyle || ui.style || "newspaper";
  const tone  = domTone  || ui.tone  || "neutral";
  const lang  = domLang  || state.language || "en";

  return {
    style,
    tone,
    lengthPreset: ui.lengthPreset || "medium",
    targetWords: ui.targetWords || null,
    language: lang,
    variationSeed: versions.length + 1,
    inputs: {
      sourceText: inputs.sourceText || "",
      w5h1: inputs.w5h1 || inputs.w5n1k || inputs.w5w1h || {
        who: "",
        what: "",
        when: "",
        where: "",
        why: "",
        how: ""
      },
      authorName: inputs.authorName || inputs.author || inputs.byline || "",
      authorLocation: inputs.authorLocation || inputs.dateline || inputs.location || ""
    }
  };
}

function hasAnyW5H1(w) {
  if (!w) return false;
  return Boolean(
    String(w.who || "").trim() ||
    String(w.what || "").trim() ||
    String(w.when || "").trim() ||
    String(w.where || "").trim() ||
    String(w.why || "").trim() ||
    String(w.how || "").trim()
  );
}

function normalizeStyleKey(style) {
  const raw = String(style || "newspaper").toLowerCase().trim();

  // exact-ish, avoid accidental matches
  if (raw === "tv" || raw.includes(" tv")) return "tv";
  if (raw === "radio" || raw.includes(" radio")) return "radio";
  if (raw === "magazine" || raw.includes("magazine")) return "magazine";

  // unify website style
  if (raw === "news-site" || raw === "newssite" || raw.includes("news-site")) return "news-site";
  if (raw === "web" || raw.includes("web")) return "news-site";

  // agency
  if (raw === "agency" || raw.includes("news agency")) return "agency";

  // newspaper default
  if (raw === "newspaper" || raw.includes("newspaper")) return "newspaper";

  // fallback: keep stable default instead of returning raw
  return "newspaper";
}


function gateOpenAIExtrasByStyle(style, outputs) {
  // OpenAI output policy by style (do not delete fields; normalize counts)
  const sk = normalizeStyleKey(style);

  const isAgency = (sk === "agency");
  const isRadio = (sk === "radio");
  const isTv = (sk === "tv");
  const isMagazine = (sk === "magazine");
  const isNewspaper = (sk === "newspaper");
  const isSite = (sk === "news-site");

  // Default (full package) for newspaper/news-site/magazine
  let headlinesN = 3;
  let spotsN = 4;
  let quotesN = 4;
  let subheadlineRequired = true;

  // Agency: 1 topHeadline, 1 headline, 2 spots, 2 quotes
  if (isAgency) {
    headlinesN = 2;
    spotsN = 2;
    quotesN = 2;
    subheadlineRequired = false;
  }

  // Radio/TV: 1 topHeadline, 1 headline, 2 spots, 2 quotes
  if (isRadio || isTv) {
    headlinesN = 2;
    spotsN = 2;
    quotesN = 2;
    subheadlineRequired = false;
  }

  // If user picked something else (unexpected), keep full package
  if (!(isMagazine || isNewspaper || isSite || isAgency || isRadio || isTv)) {
    headlinesN = 3; spotsN = 4; quotesN = 4; subheadlineRequired = true;
  }

  // Normalize arrays safely
  outputs.headlines = Array.isArray(outputs.headlines) ? outputs.headlines.filter(Boolean) : [];
  outputs.spots = Array.isArray(outputs.spots) ? outputs.spots.filter(Boolean) : [];
  outputs.quotes = Array.isArray(outputs.quotes) ? outputs.quotes.filter(Boolean) : [];

  outputs.headlines = outputs.headlines.slice(0, headlinesN);
  outputs.spots = outputs.spots.slice(0, spotsN);
  outputs.quotes = outputs.quotes.slice(0, quotesN);

  // Subheadline
  const sub = String(outputs.subheadline || "").trim();
  if (subheadlineRequired) {
    outputs.subheadline = sub || String(outputs.headlines[0] || outputs.topHeadline || "").trim();
  } else {
    outputs.subheadline = "";
  }
}


function pickLocalGenerator() {
  // Strong compatibility to stop “export missing” crashes forever
  return (
    LNIE.generateLocalPackage ||
    LNIE.generateLocal ||
    LNIE.generateLocalNews ||
    (LNIE.default && LNIE.default.generateLocalPackage)
  );
}

export async function generateOrRegenerate() {
  const s = getState();

  const sourceRaw = normalizeInputTextKeepNewlines((s.inputs && s.inputs.sourceText) ? s.inputs.sourceText : "");
  const w5h1 = (s.inputs && s.inputs.w5h1) ? s.inputs.w5h1 : null;

  if (!sourceRaw.trim() && !hasAnyW5H1(w5h1)) {
    throw new Error("No source text or 5W5H details");
  }

  const payload = buildPayload(s);
  payload.inputs.sourceText = sourceRaw;

  const engine = (s.ui && s.ui.engine) ? s.ui.engine : "local";

  let pkg;
  if (engine === "openai") {
    const apiKey = getApiKey();
    pkg = await generateOpenAIPackage({ ...payload, apiKey });
  } else {
    const genLocal = pickLocalGenerator();
    if (!genLocal) throw new Error("LNIE local generator export not found");

    // IMPORTANT: map UI payload -> LNIE expected fields
    pkg = await genLocal({
      text: payload.inputs.sourceText,
      w5h1: payload.inputs.w5h1,
      styleKey: payload.style,
      tone: payload.tone,
      lengthPreset: payload.lengthPreset,
      variationSeed: payload.variationSeed,
      language: payload.language,
      authorName: payload.inputs.authorName,
      authorLocation: payload.inputs.authorLocation
    });
  }

  const rawOutputs = (pkg && pkg.outputs) ? pkg.outputs : (pkg || {});
  const outputs = { ...rawOutputs };

  // UI renders only bodyText. Keep aliases for compatibility.
  if (!outputs.bodyText && outputs.body) outputs.bodyText = outputs.body;
  if (!outputs.body && outputs.bodyText) outputs.body = outputs.bodyText;

  // Subheadlines disabled in this track.
    // outputs.subheadline = [];

  if (engine !== "openai") {
    outputs.headlines = [];
    outputs.spots = [];
    outputs.quotes = [];
  } else {
    gateOpenAIExtrasByStyle(payload.style, outputs);
  }

  // OpenAI only: style-aware caps (avoid meaning loss)
if (engine === "openai") {
  const s = String(payload.style || "").toLowerCase();
  const isAgency = s.includes("agency");
  const isRadio = s.includes("radio");
  const isTv = s === "tv" || s.includes(" tv") || s.includes("television");

  const capTop = 12;
  const capHeadline = (isAgency || isRadio || isTv) ? 16 : 14;
  const capSpot = 25;
  const capQuote = 30;

  if (outputs.topHeadline) outputs.topHeadline = trimToMaxWords(outputs.topHeadline, capTop);

  if (Array.isArray(outputs.headlines)) {
    outputs.headlines = outputs.headlines.map((h) => trimToMaxWords(h, capHeadline));
  }

  // subheadline is a string in this project
  if (outputs.subheadline) outputs.subheadline = trimToMaxWords(outputs.subheadline, 18);

  if (Array.isArray(outputs.spots)) {
    outputs.spots = outputs.spots.map((sp) => trimToMaxWords(sp, capSpot));
  }

  if (Array.isArray(outputs.quotes)) {
    outputs.quotes = outputs.quotes.map((q) => trimToMaxWords(q, capQuote));
  }
}

  const finalPkg = {
    engineUsed: (pkg && pkg.engineUsed) ? pkg.engineUsed : engine,
    inputs: { ...(s.inputs || {}) },
    outputs
  };



  // OPENAI->OPTIONS->BUILD_FINAL: build selectable draft items for Panel-2
  if (engine === "openai") {
    const items = [];
    const pushItem = (id, label, text, maxWords, selected) => {
      const t = String(text || "").trim();
      items.push({ id, label, text: t, maxWords, selected: Boolean(selected) });
    };

    pushItem("topHeadline", "Top Headline", outputs.topHeadline, 12, true);

    if (Array.isArray(outputs.headlines)) {
      outputs.headlines.slice(0, 3).forEach((h, i) => pushItem(`headline${i+1}`, `Headline ${i+1}`, h, 10, false));
    }

     const sk2 = normalizeStyleKey(payload.style || (s.ui && s.ui.style) || "newspaper");
    const noSubheadlineStyle = (sk2 === "agency" || sk2 === "tv" || sk2 === "radio");
    const sub = String(outputs.subheadline || "").trim();

    // Only show subheadline option for styles that actually use it
    if (!noSubheadlineStyle && sub) {
      pushItem("subheadline1", "Subheadline", sub, 16, false);
    }


    if (Array.isArray(outputs.spots)) {
      outputs.spots.slice(0, 4).forEach((sp, i) => pushItem(`spot${i+1}`, `Spot/Keyline ${i+1}`, sp, 25, false));
    }

    if (Array.isArray(outputs.quotes)) {
      outputs.quotes.slice(0, 4).forEach((q, i) => pushItem(`quote${i+1}`, `Quote ${i+1}`, q, 30, false));
    }

    // Body is editable and selected by default
    const bodyText = outputs.bodyText || outputs.body || "";
    items.push({ id:"body", label:"Body", text: String(bodyText || ""), maxWords: null, selected: true });

    finalPkg.choices = { items, updatedAt: Date.now() };
  }
  addVersion(finalPkg);

  setState({
    ui: {
      ...(s.ui || {}),
      status: "Generated."
    }
  });

  return finalPkg;
}
