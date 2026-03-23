import { fingerprint, normalizeWhitespace, splitSentences } from "./language-utils.js";

/**
 * LNIE Body Generator (Local deterministic)
 * - Supports: interview / press_release / generic news
 * - Style-aware rendering: agency / newspaper / magazine / news_site / tv / radio
 * - Keeps Q/A transcript when present (interview)
 * - Avoids boilerplate ("Following is/are ...") dominating lead/headline logic.
 *
 * Key guarantees (per project rules):
 * - No hard body-length cap (remarks/transcript preserved)
 * - No duplicate lead/headline lines inside body rendering
 * - No "Developing story/News update" used unless absolutely no content exists
 */

// ------------------------- local policy knobs -------------------------

// Print/Web styles: user requirement
const MAX_BULLETS_PRINT_WEB = 3;

// Only bullets are allowed to be shortened a bit for readability.
// Paragraph sentences (lead/nut/support) must NOT be hard-capped.
const BULLET_MAX_WORDS = 28;

// ------------------------- small utils -------------------------

function safeString(v) {
  return typeof v === "string" ? v : (v == null ? "" : String(v));
}

function cleanLine(s) {
  return safeString(s)
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ensurePeriod(s) {
  const t = cleanLine(s);
  if (!t) return "";
  if (/[.!?…]$/.test(t)) return t;
  return t + ".";
}

function trimToMaxWords(text, maxWords) {
  const t = cleanLine(text);
  if (!t) return "";
  const words = t.split(/\s+/);
  if (words.length <= maxWords) return t;
  return words.slice(0, maxWords).join(" ");
}

function getLangCode(ctx) {
  const lang = safeString(ctx?.language || ctx?.meta?.language || "en").trim();
  if (!lang) return "en";
  return lang.split("-")[0].toLowerCase();
}

// Optional label overrides (so later you can bind to language packs without refactor)
function getLabel(ctx, key, fallback) {
  const v =
    ctx?.meta?.labels?.[key] ??
    ctx?.labels?.[key] ??
    ctx?.i18n?.[key] ??
    null;
  return cleanLine(v || "") || fallback;
}

function fpVariants(sentence) {
  // Strong dedupe across minor trimming differences.
  const t = cleanLine(sentence);
  if (!t) return [];
  const v1 = t;
  const v2 = trimToMaxWords(t, 32);
  const v3 = trimToMaxWords(t, 24);
  const v4 = t.replace(/[“”"]/g, "").replace(/[’']/g, "").replace(/[,:;]+/g, " ").replace(/\s+/g, " ").trim();
  return [v1, v2, v3, v4].filter(Boolean).map(x => fingerprint(x));
}

function usedHas(used, sentence) {
  const fps = fpVariants(sentence);
  for (const f of fps) if (used.has(f)) return true;
  return false;
}

function usedAdd(used, sentence) {
  for (const f of fpVariants(sentence)) used.add(f);
}

function isWeakSentence(s) {
  const t = cleanLine(s);
  if (!t) return true;
  const w = t.split(/\s+/).length;
  if (w <= 6) return true;

  // Very common "empty" openers in interviews/remarks:
  const low = t.toLowerCase();
  const weakPatterns = [
    "that's a fair concern",
    "that is a fair concern",
    "we limited it",
    "we are limited",
    "scheduling always has tradeoffs",
    "scheduling has tradeoffs",
    "many are compliant",
    "we're being explicit",
    "by publishing data"
  ];
  if (weakPatterns.some(p => low === p || low.startsWith(p + "."))) return true;

  return false;
}

function inferVerbFromSentence(s) {
  const t = cleanLine(s).toLowerCase();
  if (!t) return "said";
  if (/\bcondemn/.test(t)) return "condemned";
  if (/\bwarn/.test(t)) return "warned";
  if (/\burg(e|ed|ing)\b/.test(t)) return "urged";
  if (/\bstress(ed|es|ing)?\b/.test(t)) return "stressed";
  if (/\bcall(ed)?\s+on\b|\bcalled\s+for\b/.test(t)) return "called for";
  if (/\breaffirm/.test(t)) return "reaffirmed";
  if (/\bmust\b|\bshould\b|\bneed\b/.test(t)) return "said";
  return "said";
}

// ------------------------- author / dateline helpers -------------------------

function pickAuthor(ctx) {
  // Accept many possible field names without breaking architecture
  const a =
    cleanLine(ctx?.meta?.authorName || "") ||
    cleanLine(ctx?.meta?.author || "") ||
    cleanLine(ctx?.meta?.byline || "") ||
    cleanLine(ctx?.author || "") ||
    cleanLine(ctx?.byline || "");
  return a;
}

function pickAuthorLocation(ctx) {
  // "Author Location" should NOT be confused with event WHERE.
  // Accept many possible field names across UI versions.
  const loc =
    cleanLine(ctx?.meta?.authorLocation || "") ||
    cleanLine(ctx?.meta?.author_location || "") ||
    cleanLine(ctx?.meta?.bylineLocation || "") ||
    cleanLine(ctx?.meta?.reporterLocation || "") ||
    cleanLine(ctx?.meta?.reporter_location || "") ||
    cleanLine(ctx?.meta?.authorPlace || "") ||
    cleanLine(ctx?.meta?.authorCity || "") ||
    cleanLine(ctx?.meta?.authorDateline || "") ||
    // In some older UIs, the "Author Location" input was stored as locationInput:
    cleanLine(ctx?.meta?.locationInput || "") ||
    cleanLine(ctx?.authorLocation || "") ||
    cleanLine(ctx?.bylineLocation || "");
  return loc;
}

function pickWhereWhen(ctx, w) {
  // W5H1 first, then meta aliases (support multiple UI versions)
  const where =
    cleanLine(w?.where || "") ||
    cleanLine(ctx?.w5h1?.where || "") ||
    cleanLine(ctx?.meta?.where || "") ||
    cleanLine(ctx?.meta?.location || "") ||
    cleanLine(ctx?.meta?.place || "") ||
    cleanLine(ctx?.meta?.city || "") ||
    cleanLine(ctx?.meta?.country || "") ||
    cleanLine(ctx?.meta?.dateline || "") ||
    cleanLine(ctx?.where || "") ||
    cleanLine(ctx?.location || "") ||
    cleanLine(ctx?.place || "");

  const when =
    cleanLine(w?.when || "") ||
    cleanLine(ctx?.w5h1?.when || "") ||
    cleanLine(ctx?.meta?.when || "") ||
    cleanLine(ctx?.meta?.date || "") ||
    cleanLine(ctx?.meta?.dateInput || "") ||
    cleanLine(ctx?.meta?.time || "") ||
    cleanLine(ctx?.meta?.publishedAt || "") ||
    cleanLine(ctx?.when || "") ||
    cleanLine(ctx?.date || "");

    return {
  where: cleanLine(where).replace(/\s*—\s*$/g, ""),
  when: cleanLine(when).replace(/^\s*—\s*/g, "")
};
}

function formatByline(lang, author, authorLocation, ctx) {
  const a = cleanLine(author || "");
  const loc = cleanLine(authorLocation || "");
  if (!a && !loc) return "";

  const l = String(lang || "en").toLowerCase();

  if (l === "tr") {
    const prefix = getLabel(ctx, "byline_prefix_tr", "Haber:");
    if (a && loc) return `${prefix} ${a} | ${loc}`;
    if (a) return `${prefix} ${a}`;
    return loc;
  }

    // No "By" prefix (user preference)
  if (a && loc) return `${a} | ${loc}`;
  if (a) return `${a}`;
  return loc;
}

function formatDateline(lang, where, when) {
  const w = cleanLine(where || "");
  const d = cleanLine(when || "");
  if (!w && !d) return "";
  if (String(lang || "en").toLowerCase() === "tr") {
    if (w && d) return `${w} — ${d}`;
    return w || d;
  }
  // EN dateline style: PLACE — DATE
    // EN dateline style: PLACE — DATE (no forced uppercasing)
  if (w && d) return `${w} — ${d}`;
  return (w ? w : d);
}

// ------------------------- style rendering helpers -------------------------

function styleId(styleKey) {
  const s = String(styleKey || "").toLowerCase();
  if (s.includes("tv")) return "tv";
  if (s.includes("radio")) return "radio";
  if (s.includes("magazine")) return "magazine";
  if (s.includes("newspaper")) return "newspaper";
  if (s.includes("agency")) return "agency";
  return "news_site";
}

function labelQA(lang, kind, ctx) {
  const l = String(lang || "en").toLowerCase();
  if (l === "tr") return kind === "q" ? getLabel(ctx, "qa_q_tr", "S:") : getLabel(ctx, "qa_a_tr", "C:");
  return kind === "q" ? getLabel(ctx, "qa_q_en", "Q:") : getLabel(ctx, "qa_a_en", "A:");
}

function labelSection(lang, key, ctx) {
  const l = String(lang || "en").toLowerCase();

  if (l === "tr") {
    if (key === "full_remarks") return getLabel(ctx, "sec_full_remarks_tr", "Tam Metin");
    if (key === "full_transcript") return getLabel(ctx, "sec_full_transcript_tr", "Tam Röportaj");
    if (key === "interview_qa") return getLabel(ctx, "sec_interview_qa_tr", "Röportaj (Soru/Cevap)");
  }

  if (key === "full_remarks") return getLabel(ctx, "sec_full_remarks_en", "Full remarks");
  if (key === "full_transcript") return getLabel(ctx, "sec_full_transcript_en", "Full transcript");
  if (key === "interview_qa") return getLabel(ctx, "sec_interview_qa_en", "Interview text (Q/A)");
  return key;
}

function pickQuoteSentence(cleanSentences, usedSet, avoidSentence) {
  // Prefer: numbers OR strong verbs OR longer informative lines.
  const avoid = cleanLine(avoidSentence || "");
  const avoidFPs = fpVariants(avoid);

  function ok(s) {
    const t = cleanLine(s);
    if (!t) return false;
    if (isBoilerSentence(t)) return false;
    if (isWeakSentence(t)) return false;
    if (avoid && avoidFPs.some(f => fpVariants(t).includes(f))) return false;
    const short = trimToMaxWords(t, BULLET_MAX_WORDS);
    if (!short) return false;
    if (usedSet && usedHas(usedSet, short)) return false;
    return true;
  }

  // Pass 1: strongest candidates
  for (const s of cleanSentences || []) {
    if (!ok(s)) continue;
    const t = cleanLine(s);
    const short = trimToMaxWords(t, BULLET_MAX_WORDS);
    if (/[0-9]/.test(short) || /(urge|warn|condemn|stress|call|support|must|will|should|need)\b/i.test(short)) {
      if (usedSet) usedAdd(usedSet, short);
      return ensurePeriod(short);
    }
  }

  // Pass 2: any good informative sentence
  for (const s of cleanSentences || []) {
    if (!ok(s)) continue;
    const t = cleanLine(s);
    const short = trimToMaxWords(t, BULLET_MAX_WORDS);
    if (usedSet) usedAdd(usedSet, short);
    return ensurePeriod(short);
  }

  return "";
}

function renderBullets(lines, maxBullets) {
  const out = [];
  const pick = (Array.isArray(lines) ? lines : []).filter(Boolean).slice(0, Math.max(0, maxBullets));
  for (const x of pick) {
    const t = cleanLine(String(x).replace(/^→\s*/, ""));
    if (!t) continue;
    out.push(`→ ${ensurePeriod(trimToMaxWords(t, BULLET_MAX_WORDS))}`);
  }
  return out;
}

function renderBodyByStyle(ctx, styleKey, model) {
  const lang = getLangCode(ctx);
  const sid = styleId(styleKey);

  const lead = safeString(model?.lead).trim();
  const nut = safeString(model?.nut).trim();
  const support = Array.isArray(model?.support) ? model.support.filter(Boolean) : [];
  const supportClean = support;
  const highlights = Array.isArray(model?.highlights) ? model.highlights.filter(Boolean) : [];
  const remarks = safeString(model?.remarks).trim();
  const transcript = safeString(model?.transcript).trim();
  const speaker = safeString(model?.speaker).trim();

  const author = pickAuthor(ctx);
  const w = ctx?.w5h1 || {};
  const ww = pickWhereWhen(ctx, w);
  const authorLoc = pickAuthorLocation(ctx);
  const byline = formatByline(lang, author, authorLoc, ctx);
  const dateline = formatDateline(lang, ww.where, ww.when);

  // Optional broadcast fields
  const quote = safeString(model?.quote).trim();

  // TV / RADIO: do not change behavior per requirement
  if (sid === "tv") {
    const lines = [];
    const pushSeg = (line) => {
      if (line === null || line === undefined) return;
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      lines.push(line);
    };

    if (byline) lines.push(byline);
    if (dateline) lines.push(dateline);

    const hasTranscript = !!(transcript && transcript.trim());
    if (hasTranscript && String(model?.type || "") === "interview") {
      const briefText = lead || (highlights[0] ? String(highlights[0]).replace(/^→\s*/, "") : "");
      if (briefText) pushSeg(`BRIEF: ${cleanLine(briefText)}`);
    }

    if (lead) pushSeg(`ANCHOR: ${lead}`);

    const voParts = [nut, ...support].filter(Boolean);
    if (voParts.length) pushSeg(`VO: ${voParts.join(" ")}`);

    const graphic = safeString(model?.graphic || "").trim();
    const g = graphic || (highlights[0] ? highlights[0].replace(/^→\s*/, "") : "");
    if (g) pushSeg(`GRAPHIC: ${trimToMaxWords(g.replace(/^→\s*/, ""), 12)}`);

    const sotCandidates = [];
    if (quote) sotCandidates.push(quote);
    for (const h of highlights) sotCandidates.push(String(h || "").replace(/^→\s*/, ""));

    let sotIndex = 1;
    for (const s of sotCandidates) {
      const t = cleanLine(s);
      if (!t) continue;
      if (isWeakSentence(t) || isBoilerSentence(t)) continue;
      if (lead && cleanLine(t) === cleanLine(lead)) continue;
      if (nut && cleanLine(t) === cleanLine(nut)) continue;
      pushSeg(`SOT${sotIndex}: "${t}"${speaker ? " — " + speaker : ""}`);
      lines.push("");
      sotIndex += 1;
    }

    let factIndex = 1;
    for (const h of highlights) {
      const t = cleanLine(String(h || "").replace(/^→\s*/, ""));
      if (!t) continue;
      if (isWeakSentence(t) || isBoilerSentence(t)) continue;
      if (lead && cleanLine(t) === cleanLine(lead)) continue;
      if (nut && cleanLine(t) === cleanLine(nut)) continue;
      pushSeg(`FACT${factIndex}: ${t}`);
      factIndex += 1;
    }

    const tag = support[support.length - 1] ||
      (highlights[highlights.length - 1] ? String(highlights[highlights.length - 1]).replace(/^→\s*/, "") : "");
    if (tag) pushSeg(`TAG: ${cleanLine(tag)}`);

    if (hasTranscript && String(model?.type || "") === "interview") {
      lines.push("");
      const secKey = model?.transcriptKind === "full_transcript" ? "full_transcript" : "interview_qa";
      pushSeg(labelSection(lang, secKey, ctx));
      lines.push("");
      lines.push(transcript);
    }

    return lines.filter(l => l !== null && l !== undefined).join("\n");
  }

  if (sid === "radio") {
    const lines = [];
    const pushSeg = (line) => {
      if (line === null || line === undefined) return;
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      lines.push(line);
    };

    if (byline) lines.push(byline);
    if (dateline) lines.push(dateline);

    const hasTranscript = !!(transcript && transcript.trim());
    if (hasTranscript && String(model?.type || "") === "interview") {
      const briefText = lead || (highlights[0] ? String(highlights[0]).replace(/^→\s*/, "") : "");
      if (briefText) pushSeg(`BRIEF: ${cleanLine(briefText)}`);
    }

    if (lead) pushSeg(`HOST: ${lead}`);

    const wrapParts = [nut, ...support].filter(Boolean);
    if (wrapParts.length) pushSeg(`WRAP: ${wrapParts.join(" ")}`);

    const actCandidates = [];
    if (quote) actCandidates.push(quote);
    for (const h of highlights) actCandidates.push(String(h || "").replace(/^→\s*/, ""));

    let actIndex = 1;
    for (const s of actCandidates) {
      const t = cleanLine(s);
      if (!t) continue;
      if (isWeakSentence(t) || isBoilerSentence(t)) continue;
      if (lead && cleanLine(t) === cleanLine(lead)) continue;
      if (nut && cleanLine(t) === cleanLine(nut)) continue;
      pushSeg(`ACTUALITY${actIndex}: "${t}"${speaker ? " — " + speaker : ""}`);
      lines.push("");
      actIndex += 1;
    }

    let factIndex = 1;
    for (const h of highlights) {
      const t = cleanLine(String(h || "").replace(/^→\s*/, ""));
      if (!t) continue;
      if (isWeakSentence(t) || isBoilerSentence(t)) continue;
      if (lead && cleanLine(t) === cleanLine(lead)) continue;
      if (nut && cleanLine(t) === cleanLine(nut)) continue;
      pushSeg(`FACT${factIndex}: ${t}`);
      factIndex += 1;
    }

    const outro = support[support.length - 1] ||
      (highlights[highlights.length - 1] ? String(highlights[highlights.length - 1]).replace(/^→\s*/, "") : "");
    if (outro) pushSeg(`OUTRO: ${cleanLine(outro)}`);

    if (hasTranscript && String(model?.type || "") === "interview") {
      lines.push("");
      const secKey = model?.transcriptKind === "full_transcript" ? "full_transcript" : "interview_qa";
      pushSeg(labelSection(lang, secKey, ctx));
      lines.push("");
      lines.push(transcript);
    }

    return lines.filter(l => l !== null && l !== undefined).join("\n");
  }

  // Print / web styles
  const parts = [];

  if (byline) parts.push(byline);
  if (dateline) parts.push(dateline);

  // Lead paragraph
  if (lead) parts.push(lead);

  // Bullets must be right after lead (per requirement), max 2 for print/web
  const bulletLines = renderBullets(highlights, MAX_BULLETS_PRINT_WEB);
  if (bulletLines.length) parts.push(bulletLines.join("\n"));

  // Narrative paragraphs (no hard caps)
if (sid === "agency") {
  const sub = [nut, ...support].filter(Boolean).join(" ");
  if (sub) parts.push(sub);
} else {
  const sub = [nut, ...support].filter(Boolean).join("\n\n");
  if (sub) parts.push(sub);
}

  // Transcripts/remarks preserved at end
  if (transcript) {
    const secKey = model?.transcriptKind === "full_transcript" ? "full_transcript" : "interview_qa";
    parts.push(`${labelSection(lang, secKey, ctx)}\n\n${transcript}`);
  }
  if (remarks) parts.push(`${labelSection(lang, "full_remarks", ctx)}\n\n${remarks}`);

  return parts.filter(Boolean).join("\n\n");
}

// ------------------------- sentence handling -------------------------

function normalizeSourceParagraphs(raw) {
  const text = safeString(raw).replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const paras = [];
  let buf = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (buf.length) {
        paras.push(buf.join(" ").replace(/\s+/g, " ").trim());
        buf = [];
      }
      continue;
    }
    buf.push(t);
  }
  if (buf.length) paras.push(buf.join(" ").replace(/\s+/g, " ").trim());
  return paras.filter(Boolean).join("\n\n").trim();
}

function splitSentencesClean(rawOrParas) {
  const text = Array.isArray(rawOrParas) ? rawOrParas.join(" ") : safeString(rawOrParas);
  const sents = splitSentences(text);
  const out = [];
  for (const s of sents) {
    const t = cleanLine(s);
    if (!t) continue;
    out.push(t);
  }
  return out;
}

function isBoilerSentence(s) {
  const t = cleanLine(s).toLowerCase();
  if (!t) return true;

  // EN boiler
  if (t.startsWith("following is") || t.startsWith("following are")) return true;
  if (t.includes("for immediate release")) return true;
  if (t.startsWith("contact:")) return true;
  if (t.startsWith("###")) return true;

  // TR boiler
  if (t.includes("basın açıklaması") || t.includes("basin aciklamasi")) return true;
  if (t.includes("aşağıdaki açıklamanın") || t.includes("asagidaki aciklamanin")) return true;

  return false;
}

function extractFirstNonBoilerSentence(sentences) {
  for (const s of sentences || []) {
    if (!s) continue;
    if (isBoilerSentence(s)) continue;
    return s;
  }
  return "";
}

// Aggressive duplicate header cleanup (UN/agency-style releases often repeat title line)
function dropObviousHeaderRepeats(sentences) {
  const s = Array.isArray(sentences) ? [...sentences] : [];
  if (s.length < 2) return s;

  const a = cleanLine(s[0]);
  const b = cleanLine(s[1]);

  if (a && b && a.toLowerCase() === b.toLowerCase()) {
    s.splice(1, 1);
    return s;
  }

  // If first line looks like a title and second line starts by repeating it:
  // Example: "United Nations Marks ..." then next sentence repeats the same prefix.
  if (a && b) {
    const aLow = a.toLowerCase();
    const bLow = b.toLowerCase();
    const prefix = aLow.slice(0, Math.min(60, aLow.length));
    if (prefix.length >= 18 && bLow.startsWith(prefix)) {
      // drop the repeated second
      s.splice(1, 1);
      return s;
    }
  }

  return s;
}

// ------------------------- W5H1 lead helpers -------------------------

function safeLeadFromW5H1(ctx, w, styleKey, fallbackSentence) {
  const who = cleanLine(w?.who || "");
  const what = cleanLine(w?.what || "");
  const where = cleanLine(w?.where || "") || cleanLine(ctx?.meta?.location || "") || cleanLine(ctx?.location || "");
  const when = cleanLine(w?.when || "") || cleanLine(ctx?.meta?.date || "") || cleanLine(ctx?.date || "");
  const how = cleanLine(w?.how || "");
const why = cleanLine(w?.why || "");

  // Basic LNIE rule: lead prioritizes What; if missing, use first detail sentence.
    if (what) {
    // Lead should be short and readable:
    // Prefer WHO + WHAT, do NOT pack WHERE/WHEN/WHY/HOW into the lead.
    const leadBits = [];
    if (who) leadBits.push(who);
    leadBits.push(what);

    const leadLine = ensurePeriod(leadBits.join(" "));
    if (!leadLine) return "";

    return leadLine;
  }

  const s = cleanLine(fallbackSentence || "");
  if (s) return ensurePeriod(s);

  if (who) return ensurePeriod(`${who}`);
  return "";
}

// ------------------------- press release helpers -------------------------

function parsePressReleaseHeader(raw) {
  const lines = safeString(raw).replace(/\r\n/g, "\n").split("\n").map(l => l.trim()).filter(Boolean);
  const head = lines.slice(0, 6).join(" ");
  const out = { speaker: "", occasion: "", observed: "", kind: "" };

  let m = head.match(/following\s+(?:is|are)\s+(.+?)['’]s\s+(message|remarks|statement)\s+for\s+(.+?)(?:,?\s+observed\s+on\s+(.+?))?:/i);
  if (m) {
    out.speaker = cleanLine(m[1] || "");
    out.kind = cleanLine(m[2] || "");
    out.occasion = cleanLine(m[3] || "");
    out.observed = cleanLine(m[4] || "");
    return out;
  }

  m = head.match(/following\s+(?:is|are)\s+(.+?)\s+(message|remarks|statement)\s+for\s+(.+?)(?:,?\s+observed\s+on\s+(.+?))?:/i);
  if (m) {
    out.speaker = cleanLine(m[1] || "");
    out.kind = cleanLine(m[2] || "");
    out.occasion = cleanLine(m[3] || "");
    out.observed = cleanLine(m[4] || "");
    return out;
  }

  m = head.match(/^(.+?)\s+bas[ıi]n\s+aç[ıi]klamas[ıi]/i);
  if (m) {
    out.speaker = cleanLine(m[1] || "");
    out.kind = "basin_aciklamasi";
    return out;
  }

  return out;
}

function prStripLeadingWe(s) {
  return cleanLine(s).replace(/^(we\s+|today\s+|on\s+this\s+day\s+)/i, "");
}

// IMPORTANT: Do NOT cap core sentences hard. Only bullet items are shortened later.
function prMakeCoreSentence(cleanSentences) {
  const first = extractFirstNonBoilerSentence(cleanSentences);
  if (!first) return "";

  const t = cleanLine(first);

  const colon = t.indexOf(":");
  if (colon > 0 && colon < 120) {
    const after = prStripLeadingWe(t.slice(colon + 1));
    if (after) return after;
  }

  const lowered = t.toLowerCase();
  if (lowered.startsWith("on the international day") || lowered.startsWith("on international day")) {
    const cut = t.replace(/^On\s+the\s+International\s+Day\s+of\s+[^,]+,\s*/i, "");
    const core = cleanLine(cut) || t;
    return prStripLeadingWe(core);
  }

  return prStripLeadingWe(t);
}

function buildPressReleaseLead(ctx, w, header, cleanSentences) {
  const who = cleanLine(w?.who || "") || cleanLine(ctx?.meta?.speaker || "") || cleanLine(header?.speaker || "");
  const what = cleanLine(w?.what || "") || cleanLine(ctx?.meta?.topic || "") || cleanLine(header?.occasion || "");
  const core = prMakeCoreSentence(cleanSentences);

  const lang = getLangCode(ctx);
  if (lang === "tr") {
    const speakerTR = who || header?.speaker || "Yetkililer";
    if (core) return ensurePeriod(`${speakerTR}, yaptığı açıklamada ${core}`);
    if (what) return ensurePeriod(`${speakerTR}, ${what} konusunda açıklama yaptı`);
    return "";
  }

  const speaker = who || "Officials";
  const occasion = what || header?.occasion || "";
  const observed = cleanLine(header?.observed || "");
  const verb = inferVerbFromSentence(core);

  if (core && occasion) {
    const obs = observed ? `, observed on ${observed}` : "";
    return ensurePeriod(`${speaker}, in a ${header?.kind ? header.kind : "message"} for ${occasion}${obs}, ${verb} ${core}`);
  }
  if (core) return ensurePeriod(`${speaker} ${verb} ${core}`);
  if (occasion) return ensurePeriod(`${speaker}, in a message for ${occasion}, spoke on the issue`);
  return "";
}

function prMakeNut(cleanSentences, used, lead) {
  for (const s of cleanSentences) {
    if (!s) continue;
    if (isBoilerSentence(s)) continue;
    if (isWeakSentence(s)) continue;

    const full = ensurePeriod(cleanLine(s));
    if (!full) continue;

    if (lead && (cleanLine(full) === cleanLine(lead) || usedHas(used, full) || usedHas(used, lead))) continue;

    usedAdd(used, full);
    return full;
  }
  return "";
}

function pickPressHighlights(cleanSentences, used, avoidSentence) {
  const out = [];
  const avoid = cleanLine(avoidSentence || "");

  for (const s of cleanSentences) {
    if (!s) continue;
    if (isBoilerSentence(s)) continue;
    if (isWeakSentence(s)) continue;
    if (avoid && cleanLine(s) === avoid) continue;

    const full = ensurePeriod(cleanLine(s));
    if (!full) continue;
    if (usedHas(used, full)) continue;

    // Prefer "strong" lines
    if (/[0-9]/.test(full) || /(only|one in|per cent|percent|globally|must|should|will|need|technology|artificial intelligence|platforms)\b/i.test(full)) {
      usedAdd(used, full);
      out.push(full);
      if (out.length >= 6) return out;
    }
  }

  for (const s of cleanSentences) {
    if (!s) continue;
    if (isBoilerSentence(s)) continue;
    if (isWeakSentence(s)) continue;
    if (avoid && cleanLine(s) === avoid) continue;

    const full = ensurePeriod(cleanLine(s));
    if (!full) continue;
    if (usedHas(used, full)) continue;

    usedAdd(used, full);
    out.push(full);
    if (out.length >= 6) break;
  }

  return out;
}

function buildSupportLinePool(cleanSentences, used) {
  const pool = [];
  for (const s of cleanSentences) {
    if (!s) continue;
    if (isBoilerSentence(s)) continue;
    if (isWeakSentence(s)) continue;

    const full = ensurePeriod(cleanLine(s));
    if (!full) continue;
    if (used && usedHas(used, full)) continue;

    pool.push(full);
  }
  return pool;
}

function buildPressReleaseNewsBody(ctx, styleKey, _sentences, _raw) {
  const used = new Set();
  const w = ctx?.w5h1 || {};

  let cleanSentences = splitSentencesClean(_raw);
  cleanSentences = dropObviousHeaderRepeats(cleanSentences);

  const header = parsePressReleaseHeader(_raw);

  const lead = buildPressReleaseLead(ctx, w, header, cleanSentences);
  if (lead) usedAdd(used, lead);
  const leadLc = cleanLine(lead).toLowerCase();

  const firstCore = prMakeCoreSentence(cleanSentences);
  if (firstCore) usedAdd(used, firstCore);

  const nut = prMakeNut(cleanSentences, used, lead);

  // Build more than needed, renderer will limit to 2 bullets for print/web.
  const highlights = pickPressHighlights(cleanSentences, used, firstCore);

  // Support paragraphs: NO hard cap, but keep it short-ish (2 units) for typical print/web readability.
  const supportPool = buildSupportLinePool(cleanSentences, used);
  const support = [];
  for (const s of supportPool) {
    if (!s) continue;
    if (usedHas(used, s)) continue;
    usedAdd(used, s);
    support.push(s);
  }

  const remarks = normalizeSourceParagraphs(_raw);

  const quote = pickQuoteSentence(cleanSentences, used, lead);

  const speaker = cleanLine(w?.who || "") || cleanLine(ctx?.meta?.speaker || "") || cleanLine(header?.speaker || "");
  const topic = cleanLine(w?.what || "") || cleanLine(ctx?.meta?.topic || "") || cleanLine(header?.occasion || "");

  const model = {
    type: "press_release",
    speaker,
    topic,
    graphic: topic || (header?.kind ? `${header.kind}` : ""),
    lead,
    nut,
    support,
    highlights,
    remarks,
    quote
  };

  return renderBodyByStyle(ctx, styleKey, model);
}

// ------------------------- interview helpers -------------------------

function extractInterviewQA(text) {
  const lines = safeString(text).replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let buf = [];
  let mode = "";

  function flush() {
    if (!buf.length) return;
    blocks.push(buf.join(" ").replace(/\s+/g, " ").trim());
    buf = [];
  }

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      flush();
      mode = "";
      continue;
    }
    const q = t.match(/^\s*Q\s*:\s*(.*)$/i);
    const a = t.match(/^\s*A\s*:\s*(.*)$/i);

    if (q) {
      flush();
      mode = "Q";
      buf.push("Q: " + (q[1] || "").trim());
      continue;
    }
    if (a) {
      flush();
      mode = "A";
      buf.push("A: " + (a[1] || "").trim());
      continue;
    }

    if (mode) {
      buf.push(t);
    } else {
      if (/interview\s+text\s*\(q\/a\)/i.test(t)) continue;
      if (/^interview\s+with\b/i.test(t)) continue;
      buf.push(t);
    }
  }
  flush();
  return blocks;
}

function pickBestSentenceFromAnswer(answerText) {
  const sents = splitSentencesClean(answerText || "");
  if (!sents.length) return "";

  for (const s of sents) {
    const t = cleanLine(s);
    if (!t || isWeakSentence(t) || isBoilerSentence(t)) continue;
    const w = t.split(/\s+/).length;
    if (/[0-9]/.test(t) || /(must|will|should|because|to\s+do|we\s+require|we\s+can|we\s+will)\b/i.test(t) || w >= 12) {
      return t;
    }
  }

  for (const s of sents) {
    const t = cleanLine(s);
    if (!t || isWeakSentence(t) || isBoilerSentence(t)) continue;
    return t;
  }

  return cleanLine(sents[0] || "");
}

function buildInterviewBodySimple(ctx, styleKey, _sentences, raw) {
  const used = new Set();
  const w = ctx?.w5h1 || {};
  const lang = getLangCode(ctx);

  const text = String(raw || "").replace(/\r\n/g, "\n");
  const mSpeaker = text.match(/Interview\s+with\s+(.+?),\s*about\s+/i);
  const extractedSpeaker = mSpeaker ? normalizeWhitespace(mSpeaker[1] || "").trim() : "";
  const speaker = normalizeWhitespace(w?.who || "").trim() || extractedSpeaker || "";

  const mTopic = text.match(/Interview\s+with\s+.+?,\s*about\s+(.+?)\s*(?:\n|$)/i);
  const topic = mTopic ? normalizeWhitespace(mTopic[1] || "").trim() : normalizeWhitespace(w?.what || "").trim();

  const qaBlocks = extractInterviewQA(text);
  const answers = qaBlocks
    .filter(b => /^\s*A\s*:/i.test(b))
    .map(b => b.replace(/^\s*A\s*:\s*/i, "").trim())
    .filter(Boolean);

  const bestA0 = answers[0] ? pickBestSentenceFromAnswer(answers[0]) : "";
  let lead = "";
  if (w?.what && String(w.what).trim()) {
    lead = safeLeadFromW5H1(ctx, w, styleKey, "");
  } else if (bestA0) {
    const whoPart = speaker || "The interviewee";
    lead = ensurePeriod(`${whoPart} said ${trimToMaxWords(bestA0, 22)}`);
  } else {
    lead = speaker ? ensurePeriod(`${speaker} spoke about ${topic || "the issue"}`) : ensurePeriod("Interview highlights");
  }
  if (lead) usedAdd(used, lead);

  const highlights = [];
  const answerSentencePool = [];
  for (const a of answers) {
    const pick = pickBestSentenceFromAnswer(a);
    if (!pick) continue;
    answerSentencePool.push(pick);

    const full = ensurePeriod(cleanLine(pick));
    if (!full) continue;
    if (isWeakSentence(full)) continue;
    if (usedHas(used, full)) continue;

    usedAdd(used, full);
    highlights.push(full);
    if (highlights.length >= 6) break;
  }

  // IMPORTANT formatting: keep blank line after each Q and A block
  const transcript = qaBlocks
    .map(b => {
      if (/^\s*Q\s*:/i.test(b)) return b.replace(/^\s*Q\s*:/i, labelQA(lang, "q", ctx));
      if (/^\s*A\s*:/i.test(b)) return b.replace(/^\s*A\s*:/i, labelQA(lang, "a", ctx));
      return b;
    })
    .join("\n\n")
    .trim();

  const quote = pickQuoteSentence(answerSentencePool, used, lead) || (highlights[0] || "");

  const model = {
    type: "interview",
    speaker,
    topic,
    graphic: topic || "",
    lead,
    nut: "",
    support: [],
    highlights,
    transcript,
    quote
  };

  return renderBodyByStyle(ctx, styleKey, model);
}

function buildInterviewBody(ctx, styleKey, sentences, raw) {
  const __qa = extractInterviewQA(raw);
  const __hasQA = __qa.some(b => /^\s*Q\s*:/i.test(b)) && __qa.some(b => /^\s*A\s*:/i.test(b));
  if (__hasQA) return buildInterviewBodySimple(ctx, styleKey, sentences, raw);

  // If the pasted content is interview-like (even without Q:/A: tags),
  // generate the body normally but also preserve the full interview text.
  if (looksLikeInterviewText(raw) || ctx?.meta?.contentType === "interview" || ctx?.meta?.isInterview) {
    const base = buildGenericNewsBodyModel(ctx, styleKey, sentences);
    base.type = "interview";
    base.transcriptKind = "full_transcript";
    base.transcript = normalizeSourceParagraphs(raw);
    return renderBodyByStyle(ctx, styleKey, base);
  }

  return buildGenericNewsBody(ctx, styleKey, sentences);
}

// ------------------------- generic news -------------------------

function buildGenericNewsBodyModel(ctx, styleKey, sentences) {
  const used = new Set();
  const w = ctx?.w5h1 || {};
    // W5H1 fields (used in lead/nut/support/highlights)
  const who = cleanLine(w?.who || "");
  const what = cleanLine(w?.what || "");
  const where = cleanLine(w?.where || "");
  const when = cleanLine(w?.when || "");
  const why = cleanLine(w?.why || "");
  const how = cleanLine(w?.how || "");

  let sents = dropObviousHeaderRepeats(sentences);

  const first = extractFirstNonBoilerSentence(sents);

  const lead = safeLeadFromW5H1(ctx, w, styleKey, first) || ensurePeriod(first);
  if (lead) usedAdd(used, lead);
  const leadLc = cleanLine(lead).toLowerCase();

  // Eğer kullanıcı sadece 5W1H doldurduysa (raw/details yoksa),
// gövdeyi 5W1H’den kur: nut + support (hard limit yok)
const hasAnyW5H1 =
  cleanLine(w?.who || "") ||
  cleanLine(w?.what || "") ||
  cleanLine(w?.when || "") ||
  cleanLine(w?.where || "") ||
  cleanLine(w?.why || "") ||
  cleanLine(w?.how || "");

const rawEmpty = !extractFirstNonBoilerSentence(sents);

let nutFromW5H1 = "";
const supportFromW5H1 = [];

if (hasAnyW5H1 && rawEmpty) {
  
    // Nut: WHY (tek başına) — HOW ayrı paragraf olarak support'a gitsin
  if (why) nutFromW5H1 = ensurePeriod(why);
  else nutFromW5H1 = "";

    // Support: 5W1H parçalarını ayrı paragraflara böl (lead tekrarını azalt)
  // 1) WHO + WHAT (lead zaten bunları içeriyorsa, dedupe seti yakalar)
  const sA = ensurePeriod([who, what].filter(Boolean).join(" "));
if (sA && !usedHas(used, sA)) {
  const sALc = cleanLine(sA).toLowerCase();
  if (!leadLc || sALc !== leadLc) {
    usedAdd(used, sA);
    supportFromW5H1.push(sA);
  }
}

  // 2) WHERE + WHEN
  const sB = ensurePeriod([where, when].filter(Boolean).join(" "));
if (sB && !usedHas(used, sB)) {
  const sBLc = cleanLine(sB).toLowerCase();
  if (!leadLc || sBLc !== leadLc) {
    usedAdd(used, sB);
    supportFromW5H1.push(sB);
  }
}

  // 3) WHY (nut içinde değilse ayrıca)
  const nutLc = cleanLine(nutFromW5H1).toLowerCase();
  if (why && (!nutLc || !nutLc.includes(cleanLine(why).toLowerCase()))) {
    const sC = ensurePeriod(why);
    if (sC && !usedHas(used, sC)) {
      usedAdd(used, sC);
      supportFromW5H1.push(sC);
    }
  }

   // 4) HOW (her zaman ayrı destek paragrafı olarak)
  if (how) {
    const sD = ensurePeriod(how);
    if (sD && !usedHas(used, sD)) {
      usedAdd(used, sD);
      supportFromW5H1.push(sD);
    }
  }

  if (nutFromW5H1 && !usedHas(used, nutFromW5H1)) {
    usedAdd(used, nutFromW5H1);
  }
}
    const pool = buildSupportLinePool(sents, used);

  const support = [];
  for (const s of pool) {
    if (!s) continue;
    if (usedHas(used, s)) continue;
    usedAdd(used, s);
    support.push(s);
  }

    // --- Highlights: 5W1H-only durumda bullet üret (→ ...)
  // Only build W5H1 bullets when we actually used the W5H1-only path
  if (hasAnyW5H1 && rawEmpty) {
    supportFromW5H1.__highlights = supportFromW5H1.__highlights || [];

    const h = [];
    if (what) h.push(ensurePeriod(what));
    if (why)  h.push(ensurePeriod(why));
    if (how)  h.push(ensurePeriod(how));

        for (const x of h) {
      if (!x) continue;
      // Bullet'larda used kontrolü yapma: 5W1H özetidir, mutlaka göster
      supportFromW5H1.__highlights.push(x);
      if (supportFromW5H1.__highlights.length >= 6) break;
    }
  }

  // highlights: önce 5W1H bullet'ları, sonra havuzdan ekleme
  const highlights = Array.isArray(supportFromW5H1.__highlights)
    ? [...supportFromW5H1.__highlights]
    : [];


  for (const s of pool) {
    if (!s) continue;
    if (usedHas(used, s)) continue;
    usedAdd(used, s);
    highlights.push(s);
    if (highlights.length >= 6) break;
  }

  return {
  type: "news",
  speaker: cleanLine(w?.who || ""),
  topic: cleanLine(w?.what || ""),
  graphic: cleanLine(w?.what || ""),
  lead,
  nut: nutFromW5H1 || "",
  support: supportFromW5H1.length ? supportFromW5H1 : support,
  highlights
};
}

function buildGenericNewsBody(ctx, styleKey, sentences) {
  const model = buildGenericNewsBodyModel(ctx, styleKey, sentences);
  return renderBodyByStyle(ctx, styleKey, model);
}

// ------------------------- routing (public API) -------------------------

function looksLikePressRelease(raw) {
  const t = safeString(raw).trim().toLowerCase();
  if (!t) return false;

  const headLines = t.split(/\r?\n/).slice(0, 6).join(" ");
  if (headLines.startsWith("following is") || headLines.startsWith("following are")) return true;
  if (headLines.includes("for immediate release")) return true;
  if (headLines.includes("message for") || headLines.includes("remarks on") || headLines.includes("remarks for")) return true;

  if (headLines.includes("basın açıklaması") || headLines.includes("basin aciklamasi")) return true;

  // UN / IOC / agency releases often start with "CITY, date (Org) —"
  if (/^[a-z\s\.\-]+,\s*\d{1,2}\s+[a-z]+\s*\([^)]*\)\s*—/i.test(headLines)) return true;

  return false;
}

function looksLikeInterviewQA(raw) {
  const t = safeString(raw);
  return /\n\s*Q\s*:\s+/i.test(t) && /\n\s*A\s*:\s+/i.test(t);
}

function looksLikeInterviewText(raw) {
  const t = safeString(raw).trim();
  if (!t) return false;

  const lines = t.replace(/\r\n/g, "\n").split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 4) return false;

  let qMarks = 0;
  let speakerLabels = 0;
  let shortLines = 0;

  for (const line of lines.slice(0, 40)) {
    if (line.length <= 90) shortLines += 1;
    if (line.endsWith("?")) qMarks += 1;
    if (/^(interviewer|reporter|host|anchor|journalist|moderator)\s*:/i.test(line)) speakerLabels += 1;
    if (/^[A-ZÇĞİÖŞÜ][\w'’\-\.\s]{1,28}:\s+/.test(line)) speakerLabels += 1;
  }

  if (speakerLabels >= 2) return true;
  if (qMarks >= 2 && shortLines >= 4) return true;

  return false;
}

function stripW5H1FormBlocks(raw) {
  const lines = safeString(raw).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  const keys = new Set(["WHO","WHAT","WHEN","WHERE","WHY","HOW","KİM","NE","NE ZAMAN","NEREDE","NEDEN","NASIL"]);
  let skipMode = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    if (/^additional\s+details\b/i.test(t)) continue;
    if (/^use\s+this\s+as\s+your\s+additional\s+details\b/i.test(t)) continue;
    if (/^paste\s+(press\s+release|interview\s+text)\b/i.test(t)) continue;

    if (keys.has(t.toUpperCase())) {
      skipMode = true;
      continue;
    }

    if (skipMode) {
      if (!t) {
        skipMode = false;
      }
      continue;
    }

    out.push(line);
  }

  return out.join("\n").trim();
}

export function generateBody(ctx, styleKey, tone, lengthPreset) {
  // lengthPreset intentionally ignored for LOCAL: default is no hard limit (project rule).
  const raw = stripW5H1FormBlocks(safeString(ctx?.rawText || ctx?.text || "")).trim();
  const cleanSentences = splitSentencesClean(raw);

  if (looksLikeInterviewQA(raw)) {
    return buildInterviewBody(ctx, styleKey, cleanSentences, raw);
  }

  if (looksLikeInterviewText(raw) || ctx?.meta?.contentType === "interview" || ctx?.meta?.isInterview) {
    return buildInterviewBody(ctx, styleKey, cleanSentences, raw);
  }

  if (looksLikePressRelease(raw) || ctx?.meta?.isPressRelease || ctx?.meta?.contentType === "press_release") {
    return buildPressReleaseNewsBody(ctx, styleKey, cleanSentences, raw);
  }

  return buildGenericNewsBody(ctx, styleKey, cleanSentences);
}