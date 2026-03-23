// FILE: src/ai/lnie/headline.js
// Deterministic local headline generator.
// Rule: derive primarily from 5W1H "What" (if present) for ordinary news/interview.
// If missing, derive from the first sentence of details/source text.
// Press release: use provided title if present; otherwise first sentence/paragraph.
// IMPORTANT: Do not output "Update", "News update", "Developing story" unless absolutely nothing exists.

import { safeString, normalizeWhitespace, splitSentences, clamp } from "./language-utils.js";

function cleanLine(s) {
  let t = normalizeWhitespace(safeString(s));
  // Strip obvious paste markers
  t = t.replace(/^\s*Update\b\s*[:\-–—]?\s*/i, "");
  t = t.replace(/^\s*Following\s+(is|are)\b\s*[:\-–—]?\s*/i, "");
  t = t.replace(/^\s*Interview\s+text\b\s*(\([^)]+\))?\s*[:\-–—]?\s*/i, "");
  t = t.replace(/^\s*Press\s+Release\b\s*[:\-–—]?\s*/i, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function isBoiler(s) {
  const t = cleanLine(s).toLowerCase();
  if (!t) return true;

  const banned = new Set([
    "update",
    "news update",
    "latest developments",
    "press release",
    "statement",
    "interview text",
    "interview transcript",
    "full remarks",
    "full transcript"
  ]);

  if (banned.has(t)) return true;

  // Catch combined markers like "Update Following is ..."
  if (/^update\b/i.test(t)) return true;
  if (/\bfollowing\s+(is|are)\b/i.test(t)) return true;

  if (/^following\s+(is|are)\b/.test(t)) return true;
  if (/^this\s+is\s+the\s+(text|full\s+text)\b/.test(t)) return true;
  if (/^for\s+immediate\s+release\b/.test(t)) return true;

  // If a sentence is basically "X's message/remarks/statement for Y", it should NOT become headline.
  // Example: "UN Secretary-General António Guterres’ message for the International Day of ..."
  if (/\b(message|remarks|statement)\b/i.test(t) && /\b(for|on)\b/i.test(t) && t.split(/\s+/).length >= 6) return true;

  // Weird broken merges like "condemned are haunted..."
  if (/^(condemned|warned|urged|stressed|noted|added)\s+(are|is|was|were)\b/i.test(t)) return true;

  return false;
}

function pickFromWhat(w5h1) {
  const what = cleanLine(w5h1?.what || "");
  if (!what) return "";
  if (isBoiler(what)) return "";
  return what;
}

function pickFromTitle(meta) {
  // Press release: prioritize title/subject if present
  const title = cleanLine(meta?.title || meta?.subject || "");
  if (!title) return "";
  if (isBoiler(title)) return "";
  return title;
}

function looksLikePressReleaseText(rawText) {
  const t = safeString(rawText).trim();
  if (!t) return false;
  const head = t.split(/\r?\n/).slice(0, 6).join(" ").toLowerCase();

  if (head.startsWith("following is") || head.startsWith("following are")) return true;
  if (head.includes("for immediate release")) return true;
  if (head.includes("message for") || head.includes("remarks on") || head.includes("remarks for")) return true;
  if (head.includes("observed on")) return true;

  return false;
}

function firstRealSentence(text) {
  const sentences = splitSentences(text);
  for (const s of sentences) {
    let c = cleanLine(s);
    if (!c) continue;
    if (isBoiler(c)) continue;

    // Skip mid-sentence fragments
    if (/^[a-z]/.test(c)) continue;
    if (/^(are|is|was|were|be|been|being)\b/i.test(c)) continue;
    if (/^(according\s+to|amid|while)\b/i.test(c)) continue;

    const original = c;

    // Shorten long "Interview with ..." descriptors deterministically.
    c = c.replace(/^interview\s+with\s+/i, "");
    c = c.replace(/^an?\s+interview\s+with\s+/i, "");

    const about = c.match(/\babout\b\s+(.+)$/i);
    if (about && about[1]) {
      let core = cleanLine(about[1]);
      core = core.replace(/^(the|a|an)\s+/i, "");
      return core;
    }

    // If it's very long, prefer the FIRST strong clause, not a tail fragment.
    if (c.split(/\s+/).length > 22) {
      // Prefer "X marks/announces/launches/urges..." etc.
      const m1 = original.match(/^(.{0,140}\b(marks?|announces?|launches?|highlights?|urges?|calls\s+for|warns?|condemns?|welcomes?|unveils?|reaffirms?)\b[^.]{0,220})/i);
      if (m1 && m1[1]) return cleanLine(m1[1]);

      // Otherwise take the first ~22 words, not the tail.
      const head = original.split(/\s+/).slice(0, 22).join(" ");
      if (head && head.split(/\s+/).length >= 8) return cleanLine(head);
    }

    if (c.split(/\s+/).length < 4) continue;
    return c;
  }
  return "";
}

function firstRealParagraph(text) {
  const t = safeString(text).replace(/\r\n/g, "\n").trim();
  if (!t) return "";
  const paras = t.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  for (const p of paras) {
    const c = cleanLine(p);
    if (!c) continue;
    if (isBoiler(c)) continue;
    return p;
  }
  return "";
}

function trimToMaxWords(s, maxWords = 20) {
  let t = cleanLine(s);
  if (!t) return "";

  // Guard against broken fragments chosen from sentence splitters
  if (/^[a-z]/.test(t)) t = t.charAt(0).toUpperCase() + t.slice(1);

  // Avoid headlines that start with auxiliary verbs
  if (/^(are|is|was|were|be|been|being)\b/i.test(t)) return "";

  const words = t.split(/\s+/);
  if (words.length <= maxWords) return t;

  // Prefer cutting at punctuation/clause boundary before truncating mid-meaning.
  const candidates = [
    /[.?!]/,
    /[;:]/,
    /\s[-–—]\s/,
    /,\s+(but|and|as|after|before|while|when|because|since|amid|over|under)\b/i,
    /\b(which|that)\b/i
  ];

  for (const rx of candidates) {
    const m = t.search(rx);
    if (m > 24) {
      const cut = cleanLine(t.slice(0, m));
      const cw = cut.split(/\s+/);
      if (cw.length >= 6 && cw.length <= maxWords) return cut;
    }
  }

  // Hard cap (slightly relaxed) to avoid losing meaning.
  const hard = clamp(maxWords + 4, 18, 30);
  return words.slice(0, hard).join(" ");
}

function maxWordsByStyle(styleKey) {
  // Keep limits generous; headline truncation was harming meaning.
  const k = (styleKey || "").toLowerCase();

  // Broadcast formats should be shorter, but not "cut in half".
  if (k === "tv") return 18;
  if (k === "radio") return 18;

  // Print / web / agency
  if (k === "news-site" || k === "newssite" || k === "web") return 22;
  if (k === "agency" || k === "news-agency" || k === "newsagency") return 22;
  if (k === "newspaper") return 22;
  if (k === "magazine") return 24;

  return 22;
}

function looksLikeTitleLine(line) {
  const t = cleanLine(line);
  if (!t) return false;
  if (isBoiler(t)) return false;
  if (t.length < 18 || t.length > 220) return false;

  // Avoid common metadata headers
  if (/^(for immediate release|contact|press release|media advisory|###)\b/i.test(t)) return false;

  // Avoid label-only lines ending with colon
  if (/:\s*$/.test(t)) return false;

  // Minimum information threshold
  const w = t.split(/\s+/);
  if (w.length < 4 && !/[0-9]/.test(t)) return false;

  return true;
}

function firstMeaningfulLineForHeadline(rawText) {
  const raw = safeString(rawText).replace(/\r\n/g, "\n");
  if (!raw.trim()) return "";
  const lines = raw.split(/\n/).map((x) => cleanLine(x)).filter(Boolean);

  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const ln = lines[i];

    // Skip obvious boiler blocks
    if (isBoiler(ln)) continue;
    if (/^#+\s*$/.test(ln)) continue;
    if (/^(for immediate release|contact)\b/i.test(ln)) continue;
    if (/^following\s+(is|are)\b/i.test(ln)) continue;

    if (looksLikeTitleLine(ln)) return ln;
  }
  return "";
}

function pressReleaseHeadlineFromText(meta, rawText, styleKey) {
  const mw = maxWordsByStyle(styleKey);

  // 1) Prefer a true title line near the top of pasted press release text.
  // This prevents picking sentence fragments like:
  // "When Conducive to Terrorism under the theme ..."
  const titleLine = firstMeaningfulLineForHeadline(rawText);
  if (titleLine) return trimToMaxWords(titleLine, mw);

  // 2) Otherwise fall back to first paragraph / first real sentence.
  const p = firstRealParagraph(rawText);
  const s = firstRealSentence(p || rawText);
  if (!s) return "";

  let core = cleanLine(s);

  // If it has a colon, strip ONLY if the left side looks like a short label, not a meaningful clause.
  // Example to strip: "STATEMENT: ..." or "UPDATE: ..."
  const colon = core.indexOf(":");
  if (colon > 0 && colon < 60) {
    const left = cleanLine(core.slice(0, colon));
    const right = cleanLine(core.slice(colon + 1));
    const leftWords = left.split(/\s+/).filter(Boolean).length;

    const isLabel =
      leftWords <= 2 &&
      /^(update|statement|news|briefing|announcement|commitment|message)\b/i.test(left);

    if (isLabel && right && !isBoiler(right)) core = right;
  }

  core = core.replace(/^(we\s+|today\s+|on\s+the\s+international\s+day\s+|on\s+this\s+day\s+)/i, "");

  return trimToMaxWords(core, mw);
}

/**
 * generateHeadline({ w5h1, meta, rawText, styleKey, language })
 * Returns a single line headline string.
 */
export function generateHeadline({ w5h1 = {}, meta = {}, rawText = "", styleKey = "agency", language = "en" } = {}) {
  const mw = maxWordsByStyle(styleKey);

  const isPressRelease = Boolean(
    meta?.contentType === "press_release" ||
    meta?.isPressRelease ||
    looksLikePressReleaseText(rawText)
  );

  if (isPressRelease) {
    const t = pickFromTitle(meta);
    if (t) {
      const out = trimToMaxWords(t, mw);
      return out || "News report";
    }
   

    const pr = pressReleaseHeadlineFromText(meta, rawText, styleKey);
    if (pr) {
      const out = trimToMaxWords(pr, mw);
      return out || "News report";
    }
  }

  const fromWhat = pickFromWhat(w5h1);
  if (fromWhat) {
    const out = trimToMaxWords(fromWhat, mw);
    return out || "News report";
  }

  const first = firstRealSentence(rawText);
  if (first) {
    const out = trimToMaxWords(first, mw);
    return out || "News report";
  }

  return "News report";
}