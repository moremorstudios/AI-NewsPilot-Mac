import * as Headline from "./headline.js";
import * as Body from "./body.js";
import { buildContext as _buildContext } from "./structure.js";

/**
 * LNIE entrypoint.
 * Contract:
 * - generateLocalPackage(payload) -> { ok, topHeadline, bodyText, ... }
 * - generateLocal(payload) alias kept for older callers
 */

// Local safe helpers to avoid hard-crash when language-utils exports change.
function safeString(v) {
  return typeof v === "string" ? v : (v == null ? "" : String(v));
}

function safeJsonClone(obj) {
  try {
    if (obj == null) return obj;
    return JSON.parse(JSON.stringify(obj));
  } catch {
    // Shallow fallback (better than crash); callers mostly pass plain JSON anyway.
    if (obj && typeof obj === "object") return { ...obj };
    return obj;
  }
}

// --- NEW: author alias helpers (no architecture change) ---
function pickAuthorName(inputs) {
  return safeString(
    inputs?.authorName ??
    inputs?.author ??
    inputs?.byline ??
    inputs?.writer ??
    inputs?.reporterName ??
    inputs?.name ??
    ""
  ).trim();
}

function pickAuthorLocation(inputs) {
  return safeString(
    inputs?.authorLocation ??
    inputs?.location ??
    inputs?.city ??
    inputs?.dateline ??
    inputs?.reporterLocation ??
    ""
  ).trim();
}

// --- NEW: W5H1 alias normalization ---
function pickW5H1(inputs) {
  const w =
    inputs?.w5h1 ||
    inputs?.w5n1k ||
    inputs?.w5w1h ||
    inputs?.w5W1H ||
    inputs?.fivew1h ||
    inputs?.fiveW1H ||
    inputs?.w ||
    {};

  // allow direct top-level fallbacks too
  return {
    who: safeString(w.who || w.WHO || inputs?.who || ""),
    what: safeString(w.what || w.WHAT || inputs?.what || ""),
    when: safeString(w.when || w.WHEN || inputs?.when || ""),
    where: safeString(w.where || w.WHERE || inputs?.where || ""),
    why: safeString(w.why || w.WHY || inputs?.why || ""),
    how: safeString(w.how || w.HOW || inputs?.how || "")
  };
}

function ensureCtx(ctx, inputs) {
  const t =
    safeString(inputs?.sourceText) ||
    safeString(inputs?.rawText) ||
    safeString(inputs?.text) ||
    safeString(inputs?.details) ||
    safeString(inputs?.source) ||
    "";

  ctx = ctx || {};
  ctx.sourceText = t;
  ctx.rawText = t;
  ctx.text = t;

  // ✅ W5H1 map (expanded aliases; fixes “input yok” in TV/Radio when UI uses w5n1k etc.)
  const w = pickW5H1(inputs);
  ctx.w5h1 = { ...w };

  ctx.language = safeString(inputs?.language || inputs?.lang || ctx.language || "en");
  ctx.styleKey = safeString(inputs?.style || inputs?.styleKey || ctx.styleKey || "news_site");
  ctx.tone = safeString(inputs?.tone || ctx.tone || "neutral");
  ctx.lengthPreset = safeString(inputs?.length || inputs?.lengthPreset || ctx.lengthPreset || "default");

  // ✅ Author meta (expanded aliases; fixes “author/location almıyor”)
  const authorName = pickAuthorName(inputs);
  const authorLocation = pickAuthorLocation(inputs);

  ctx.meta = ctx.meta || {};

  // Preserve press-release hint if caller passes it
  if (inputs?.meta && typeof inputs.meta === "object") {
    ctx.meta = { ...ctx.meta, ...safeJsonClone(inputs.meta) };
  }
  if (inputs?.isPressRelease === true) ctx.meta.isPressRelease = true;
  if (safeString(inputs?.contentType)) ctx.meta.contentType = safeString(inputs.contentType);

  // ✅ ensure these exist for body.js rendering
  if (authorName) ctx.meta.authorName = authorName;
  if (authorLocation) ctx.meta.authorLocation = authorLocation;

  return ctx;
}

function callHeadline(ctx, styleKey, tone, variationSeed) {
  // headline.js signature is destructured; passing ctx is OK.
  return Headline.generateHeadline(ctx, styleKey, tone, variationSeed);
}

function callBody(ctx, styleKey, tone, lengthPreset) {
  return Body.generateBody(ctx, styleKey, tone, lengthPreset);
}

export async function generateLocalPackage(payload = {}) {
  const inputs = payload?.inputs && typeof payload.inputs === "object" ? payload.inputs : payload;

  // Normalize text sources
  const sourceText =
    safeString(inputs?.sourceText) ||
    safeString(inputs?.rawText) ||
    safeString(inputs?.text) ||
    safeString(inputs?.details) ||
    safeString(inputs?.source) ||
    "";

  // Build base context from structure.js (kept)
  const baseCtx = _buildContext({
    ...safeJsonClone(inputs),
    sourceText,
    rawText: sourceText,
    text: sourceText,

    // ✅ pass author explicitly too (structure.js already supports)
    authorName: pickAuthorName(inputs),
    authorLocation: pickAuthorLocation(inputs),

    // ✅ pass W5H1 explicitly (structure expects w5h1)
    w5h1: pickW5H1(inputs)
  });

  // Finalize ctx (kept compatible)
  const ctx = ensureCtx(baseCtx, { ...inputs, sourceText });

  const styleKey = safeString(inputs?.style || inputs?.styleKey || ctx.styleKey || "news_site");
  const tone = safeString(inputs?.tone || ctx.tone || "neutral");
  const lengthPreset = safeString(inputs?.length || inputs?.lengthPreset || ctx.lengthPreset || "default");

  const topHeadline = callHeadline(ctx, styleKey, tone, payload?.variationSeed || payload?.seed || "");
  const bodyText = callBody(ctx, styleKey, tone, lengthPreset);

  return {
    ok: true,
    engine: "local",
    language: ctx.language,
    style: styleKey,
    tone,
    length: lengthPreset,
    topHeadline,
    bodyText
  };
}

// Backward-compatible alias
export async function generateLocal(payload) {
  return generateLocalPackage(payload);
}
