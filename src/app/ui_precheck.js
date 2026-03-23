// FILE: src/app/ui_precheck.js

function isEmpty(v) {
  return !String(v || "").trim();
}

function hasPlaceholderMarkers(text) {
  const t = String(text || "");
  if (!t.trim()) return false;

  // Generic bracket placeholders like [WHO], [MAHKEME], [SOURCE], [NAME SURNAME]
  const bracket = /\[[A-ZÇĞİÖŞÜ][A-Z0-9ÇĞİÖŞÜ _-]{1,40}\]/g;

  // Common placeholder tokens
  const tokens = /\b(TBD|TODO|LOREM IPSUM|INSERT HERE|FILL IN|UNKNOWN)\b/i;

  return bracket.test(t) || tokens.test(t);
}

function extractRiskMarkers(text) {
  const t = String(text || "");
  const hits = [];

  // You can expand this list later; keep it conservative (no false positives spam)
  const patterns = [
    { id: "bracket_placeholders", re: /\[[A-ZÇĞİÖŞÜ][A-Z0-9ÇĞİÖŞÜ _-]{1,40}\]/g, label: "Bracket placeholders" },
    { id: "tbd_todo", re: /\b(TBD|TODO|INSERT HERE|LOREM IPSUM)\b/gi, label: "TBD/TODO placeholders" }
  ];

  for (const p of patterns) {
    const m = t.match(p.re);
    if (m && m.length) hits.push(`${p.label} (${m.length})`);
  }

  return hits;
}

async function langPackExists(lang) {
  const code = String(lang || "en").trim() || "en";
  if (code === "en") return true;

  // ui_precheck.js lives in src/app/, packs are in src/assets/i18n/
  const url = new URL(`../assets/i18n/${code}.json`, import.meta.url);

  try {
    const res = await fetch(String(url), { method: "GET", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * precheckRun({ purpose, state, pkg, finalText, draftText })
 * purpose: "precheck" | "share" | "build"
 * Returns:
 *  {
 *    ok: boolean,
 *    message: string,
 *    errors: string[],
 *    warnings: string[]
 *  }
 */
export async function precheckRun({ purpose = "precheck", state, pkg, finalText, draftText }) {
  const st = state || {};
  const errors = [];
  const warnings = [];

  const lang = st.language || "en";

  // 1) Input required (for generation pipeline sanity)
  const src = st.inputs?.sourceText || "";
  const w = st.inputs?.w5h1 || {};
  const wAny = [w.who, w.what, w.when, w.where, w.why, w.how].some(v => !isEmpty(v));

    if (isEmpty(src) && !wAny) {
    // For share/build, we can still proceed if final exists; otherwise block.
    const anyText = !isEmpty(finalText) || !isEmpty(draftText);

    // IMPORTANT: keep this as a stable, full sentence (i18n key needs exact match)
    if (!anyText) {
      errors.push("Pre-check FAIL. Missing input: add Source text or 5W1H fields.");
    }
  }


  // 2) Language pack presence (warn or error depending on purpose)
  const hasPack = await langPackExists(lang);
  if (!hasPack) {
    const msg = `Missing language pack file for "${lang}" (src/assets/i18n/${lang}.json). Falling back to English UI strings.`;
    // Not fatal for generation, but you explicitly asked to catch it.
    if (purpose === "share" || purpose === "build") warnings.push(msg);
    else warnings.push(msg);
  }

  // 3) Generated output integrity (when user wants to build/share)
  const outputs = pkg?.outputs || null;
  if ((purpose === "share" || purpose === "build") && !outputs && isEmpty(finalText) && isEmpty(draftText)) {
    errors.push("No generated output found. Click Generate News first.");
  }

  if (outputs) {
    const top = String(outputs.topHeadline || "").trim();
    const heads = Array.isArray(outputs.headlines) ? outputs.headlines.map(x => String(x || "").trim()).filter(Boolean) : [];
    const body = String(outputs.bodyText || outputs.body || "").trim();

    if (!top && heads.length === 0) errors.push("Missing section: headline(s) not found in generated output.");
    if (!body) errors.push("Missing section: body text not found in generated output.");

    // Broken structure checks (arrays should be arrays if present)
    if (outputs.spots != null && !Array.isArray(outputs.spots)) warnings.push("Output structure: spots is not an array.");
    if (outputs.quotes != null && !Array.isArray(outputs.quotes)) warnings.push("Output structure: quotes is not an array.");
  }

  // 4) Placeholder / risk markers (check the text that would be shared/exported)
  const textToCheck =
    (!isEmpty(finalText) ? finalText : (!isEmpty(draftText) ? draftText : ""));

  if (!isEmpty(textToCheck)) {
    if (hasPlaceholderMarkers(textToCheck)) {
      errors.push("Bad placeholders detected (e.g., [WHO], TBD, TODO). Fix before exporting/sharing.");
    }
    const risk = extractRiskMarkers(textToCheck);
    if (risk.length) warnings.push("Risk markers: " + risk.join("; "));
  } else if (purpose === "share") {
    errors.push("Nothing to share: Final output is empty. Use Build Final first.");
  }

  // 5) Build/share-specific minimums (avoid sharing tiny fragments)
  if ((purpose === "share" || purpose === "build") && !isEmpty(textToCheck)) {
    const len = textToCheck.trim().length;
    if (len < 120) warnings.push("Final text is very short; verify the output before sharing.");
  }

    const ok = errors.length === 0;

  // If we already pushed a full, stable FAIL sentence, use it directly (no re-prefixing)
  const hasFullFail = errors.some(e => typeof e === "string" && e.startsWith("Pre-check FAIL."));

  const msg =
    ok
      ? (warnings.length ? ("Pre-check PASS. Warnings: " + warnings.join(" ")) : "Pre-check PASS.")
      : (hasFullFail ? errors.join(" ") : ("Pre-check FAIL. " + errors.join(" ")));

  return { ok, message: msg, errors, warnings };

}
