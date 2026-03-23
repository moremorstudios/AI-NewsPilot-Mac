// FILE: src/ai/lnie/language-utils.js
// Deterministic utilities for the Local News Intelligence Engine (LNIE).
//
// Goals:
// - Provide stable helpers used across headline/body/structure modules.
// - No DOM, no network, no side effects.
// - Export ALL names imported by LNIE modules (prevents "does not provide an export" crashes).

/* ----------------------------- primitives ----------------------------- */

export function safeString(x) {
  return x == null ? "" : String(x);
}

export function safeNumber(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(n, min, max) {
  const x = safeNumber(n, min);
  return Math.max(min, Math.min(max, x));
}

export function safeJsonClone(obj, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (_) {
    return fallback;
  }
}

/* -------------------------- whitespace / text -------------------------- */

/**
 * normalizeWhitespace(text)
 * - Converts literal escape sequences (\\n, \\t, \\r\\n) into real formatting.
 * - Normalizes spaces/tabs, preserves paragraph breaks (double newlines).
 * - Trims line edges conservatively.
 */
export function normalizeWhitespace(text) {
  const raw = safeString(text);

  // Convert *literal* escape sequences (common in pasted transcripts / JSON dumps)
  // "Hello\\nWorld" -> "Hello\nWorld"
  const deEscaped = raw
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ");

  // Normalize real newlines and collapse repeated spaces
  let t = deEscaped
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ")            // NBSP
    .replace(/[ \t\f\v]+/g, " ");       // horizontal whitespace

  // Preserve paragraph breaks: collapse 3+ newlines to 2
  t = t.replace(/\n{3,}/g, "\n\n");

  // Trim each line, keep paragraph structure
  const lines = t.split("\n").map((l) => l.trim());
  return lines.join("\n").trim();
}

/**
 * splitSentences(text)
 * - Conservative deterministic split.
 * - No regex lookbehind (Electron compatibility).
 * - Splits by paragraph first, then sentence end punctuation when next token looks like a new sentence.
 */
export function splitSentences(text) {
  const s = normalizeWhitespace(text);
  if (!s) return [];

  // Hard paragraph boundaries first
  const paras = s
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const out = [];

  for (const p of paras) {
    // Insert delimiter after punctuation when next char suggests a new sentence start
    const marked = p.replace(
      /([.!?…])\s+(?=[A-Z0-9"“‘'(\[])/g,
      "$1\u0000"
    );

    const parts = marked
      .split("\u0000")
      .map((x) => safeString(x).trim())
      .filter(Boolean);

    if (parts.length) out.push(...parts);
    else if (p.trim()) out.push(p.trim());
  }

  return out;
}

/**
 * trimToMaxWords(text, maxWords)
 * - Preserves existing whitespace/punctuation as much as possible.
 * - No ellipsis appended.
 */
export function trimToMaxWords(text, maxWords) {
  const raw = safeString(text);
  const n = Number(maxWords);
  if (!Number.isFinite(n) || n <= 0) return raw;

  // Tokenize into whitespace vs non-whitespace, so we can preserve formatting.
  const tokens = raw.match(/(\s+|[^\s]+)/g) || [];
  let words = 0;
  let out = "";

  for (const tok of tokens) {
    if (/^\s+$/.test(tok)) {
      out += tok;
      continue;
    }
    words += 1;
    if (words > n) break;
    out += tok;
  }

  return out.trim();
}

/* ------------------------------ extraction ----------------------------- */

export function extractNumbers(text = "") {
  const s = normalizeWhitespace(text);
  if (!s) return [];
  const raw = s.match(/\b\d[\d.,%]*\b/g) || [];
  return raw.map((x) => x.replace(/,$/, ""));
}

/* ------------------------------- dedupe -------------------------------- */

/**
 * fingerprint(s)
 * Stable-ish fingerprint used for dedupe.
 * Avoids Unicode property escapes to prevent syntax issues.
 * Covers major scripts (Latin/Cyrillic/Arabic/Devanagari/CJK/Kana/Hangul) conservatively.
 */
export function fingerprint(s) {
  const t = normalizeWhitespace(s).toLowerCase();
  if (!t) return "";

  // Remove digits, normalize punctuation to spaces
  const core = t
    .replace(/[0-9]/g, "")
    .replace(
      /[^a-z\u00C0-\u024F\u1E00-\u1EFF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\s]/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();

  return core.length > 220 ? core.slice(0, 220) : core;
}

export function uniqByFingerprint(items) {
  const out = [];
  const seen = new Set();
  for (const it of items || []) {
    const fp = fingerprint(it);
    if (!fp) continue;
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(it);
  }
  return out;
}

/* ------------------------------- language ------------------------------ */

export function normalizeLang(lang) {
  const l = safeString(lang).trim();
  if (!l) return "en";
  const lower = l.toLowerCase();

  // keep exact casing for known variants used in UI
  if (lower === "en-us") return "en-US";
  if (lower === "en-gb") return "en-GB";

  // preserve any other BCP-47 style tags as-is
  return l;
}

export function baseLang(lang) {
  const l = normalizeLang(lang);
  return l.includes("-") ? l.split("-")[0] : l;
}
