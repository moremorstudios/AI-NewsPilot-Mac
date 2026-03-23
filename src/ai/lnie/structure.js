// FILE: src/ai/lnie/structure.js
import { normalizeWhitespace, splitSentences, extractNumbers } from "./language-utils.js";

/**
 * buildContext()
 * Normalizes user inputs into a deterministic context object for local generation.
 *
 * Goals:
 * - Preserve enough source detail to support "long" outputs.
 * - Detect interview / Q&A transcripts in Add Details and extract answer material.
 * - Avoid throwing away transcripts (common cause of short outputs).
 * - Provide structured interview QA so body.js can render clean Q/A reliably.
 */
export function buildContext({
  // UI may send any of these keys; prefer non-empty in this order
  rawText = "",
  text = "",
  sourceText = "",

  w5h1 = {},
  authorName = "",
  authorLocation = "",
  publishedAt = "",
  language = "en"
} = {}) {
  const raw = String(rawText || text || sourceText || "");

  const metaFromText = extractMetaFromText(raw);
  const meta = metaFromText.meta || {};

  let cleanText = metaFromText.cleanText || "";
  let normalizedW5H1 = normalizeW5H1(w5h1);

  // If the user did not fill 5W1H, try to infer light defaults from the text.
  const inferredWho = inferWho(cleanText);
  let inferredWhat = inferWhat(cleanText);

  // Interview header guard: do not let "Interview with X, about Y" become WHAT verbatim.
  // If we can extract topic after ", about", use that as WHAT for better lead/headline.
  if (meta.isInterview) {
    const topic = extractTopicFromInterviewHeader(meta?.interview?.titleLine || inferredWhat || "");
    if (topic) inferredWhat = topic;
  }

  if (!normalizedW5H1.who && inferredWho) normalizedW5H1.who = inferredWho;
  if (!normalizedW5H1.what && inferredWhat) normalizedW5H1.what = inferredWhat;

  // Prefer publishedAt if provided
  if (publishedAt && !meta.publishedAt) meta.publishedAt = normalizeWhitespace(publishedAt);

  // Interview mode: keep transcript, do NOT inject synthetic highlights into cleanText (avoids repetition).
  if (meta.isInterview && meta.interview) {
    const interviewee = meta.interview.intervieweeName || normalizedW5H1.who || "";
    if (!normalizedW5H1.who && interviewee) normalizedW5H1.who = interviewee;

    // Rewrite WHAT to remove ugly "X said ..." or duplicated headers
    normalizedW5H1.what = rewriteInterviewWhat(normalizedW5H1.what || "", normalizedW5H1.who || interviewee);

    // Keep synthesized highlights available for body.js, but don't prepend to cleanText.
    const highlights = synthesizeInterviewHighlights(meta.interview, normalizedW5H1);
    if (highlights) {
      meta.interview.synthHighlights = highlights;
    }
  }

  // Build final sentence pool after all transforms
  const sentences = splitSentences(cleanText);
  const numbers = extractNumbers(cleanText);

  return {
    language,
    rawText: raw,
    cleanText,
    sentences,
    numbers,
    w5h1: normalizedW5H1,
    meta: {
      ...meta,
      authorName: normalizeWhitespace(authorName),
      authorLocation: normalizeWhitespace(authorLocation)
    }
  };
}

/* ----------------------------- 5W1H helpers ----------------------------- */

function normalizeW5H1(w5h1 = {}) {
  const w = (w5h1 && typeof w5h1 === "object") ? w5h1 : {};
  return {
    who: normalizeWhitespace(w.who || ""),
    what: normalizeWhitespace(w.what || ""),
    when: normalizeWhitespace(w.when || ""),
    where: normalizeWhitespace(w.where || ""),
    why: normalizeWhitespace(w.why || ""),
    how: normalizeWhitespace(w.how || "")
  };
}

function inferWho(cleanText) {
  const t = String(cleanText || "").trim();
  if (!t) return "";

  // Try: "X said/announced/confirmed ..."
  const m = t.match(/^([A-Z][A-Za-z0-9&().,'’\-\/ ]{2,90}?)\s+(said|says|stated|announced|approved|passed|confirmed|reported|released|issued)\b/i);
  if (m && m[1]) return normalizeWhitespace(m[1]);

  // Try: "Interview with X"
  const iw = t.match(/^\s*interview\s+with\s+(.{4,120})/i);
  if (iw && iw[1]) return normalizeWhitespace(iw[1].replace(/,\s*about\b.*$/i, ""));

  return "";
}

function inferWhat(cleanText) {
  const t = String(cleanText || "").trim();
  if (!t) return "";
  const sents = splitSentences(t).map(x => normalizeWhitespace(x)).filter(Boolean);
  return sents[0] || "";
}

function extractTopicFromInterviewHeader(line) {
  const t = normalizeWhitespace(String(line || ""));
  if (!t) return "";
  if (!/^interview\s+with\b/i.test(t)) return "";

  // Prefer ", about ..."
  const m = t.match(/,\s*about\s+(.+)$/i);
  if (m && m[1]) return normalizeWhitespace(m[1]);

  // Fallback: "about ..." anywhere
  const m2 = t.match(/\babout\s+(.+)$/i);
  if (m2 && m2[1]) return normalizeWhitespace(m2[1]);

  return "";
}

function rewriteInterviewWhat(what, who) {
  let t = String(what || "").trim();
  if (!t) return "";

  // If WHAT is still a header-like "Interview with ..."
  if (/^interview\s+with\b/i.test(t)) {
    const topic = extractTopicFromInterviewHeader(t);
    if (topic) t = topic;
  }

  const w = String(who || "").trim();
  if (w && t.toLowerCase().startsWith(w.toLowerCase())) {
    t = t.slice(w.length).trim();
    t = t.replace(/^[:\-–—]+\s*/g, "");
  }

  // Strip common attribution fragments
  t = t.replace(/^(said|says|stated|reported|noted|added)\b\s*/i, "");
  t = t.replace(/^that\b\s*/i, "");

  // Normalize "the pilot will ..." / "pilot will ..."
  t = t.replace(/^the\s+pilot\s+will\s+/i, "pilot to ");
  t = t.replace(/^pilot\s+will\s+/i, "pilot to ");
  t = t.replace(/\bwill\b\s+/i, "");

  return normalizeWhitespace(t);
}

/* --------------------------- Text meta extraction --------------------------- */

function extractMetaFromText(rawText) {
  const lines = normalizeLines(rawText);

  const meta = {
    contentType: "news",
    isPressRelease: false,
    pressReleaseOrg: "",
    subjectLine: "",
    isInterview: false,
    interview: null
  };

  const skipIdx = new Set();

  // Detect headers near the top
  for (let i = 0; i < Math.min(lines.length, 22); i++) {
    const line = lines[i];
    const lc = line.toLowerCase();

    // Interview / transcript markers
    if (lc.includes("end of transcript") || lc.includes("interview transcript") || lc.startsWith("transcript")) {
      meta.isInterview = true;
      meta.contentType = "interview";
      continue;
    }

    const iw = line.match(/^\s*interview\s+with\s+(.{4,140})/i);
    if (iw && iw[1]) {
      meta.isInterview = true;
      meta.contentType = "interview";
      meta.interview = meta.interview || { intervieweeName: "", titleLine: "", qa: [], highlights: [] };

      // Capture name + title line, but DO NOT keep this header in clean text (prevents repetition).
      meta.interview.intervieweeName = normalizeWhitespace(iw[1].replace(/,\s*about\b.*$/i, ""));
      meta.interview.titleLine = normalizeWhitespace(line);
      skipIdx.add(i);
      continue;
    }

    // Common transcript meta labels
    if (/^(date|location|participants|interviewer|interviewee|speaker|host)\s*:\s*/i.test(line)) {
      meta.isInterview = true;
      meta.contentType = "interview";
      skipIdx.add(i);
      continue;
    }

    // PRESS RELEASE markers
    if (/^press\s*release\b/.test(lc) || /^for\s+immediate\s+release\b/.test(lc)) {
      meta.isPressRelease = true;
      meta.contentType = "press_release";
      skipIdx.add(i);

      const m = line.match(/press\s*release\s*[-—:]+\s*(.+)$/i);
      if (m && m[1]) meta.pressReleaseOrg = normalizeWhitespace(m[1]);
      continue;
    }

    // SUBJECT / RE
    if (/^(subject|re)\s*:\s*/i.test(line)) {
      skipIdx.add(i);
      const subject = line.replace(/^(subject|re)\s*:\s*/i, "");
      meta.subjectLine = normalizeWhitespace(subject);
      continue;
    }

    // Contact boilerplate / links
    if (/^(contact|media\s+contact)\s*:\s*/i.test(line) || /^www\./i.test(line) || /^https?:\/\//i.test(line)) {
      skipIdx.add(i);
      continue;
    }
  }

  // Soft interview detection if not already flagged
  if (!meta.isInterview && looksLikeInterview(lines)) {
    meta.isInterview = true;
    meta.contentType = "interview";
  }

  // Build clean lines, remove skipped ones
  const cleanLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (skipIdx.has(i)) continue;

    let line = lines[i];

    line = line.replace(/\bpress\s*release\b\s*[-—:]*\s*/gi, "").trim();
    line = line.replace(/\bsubject\s*:\s*/gi, "").trim();

    if (!line) continue;
    cleanLines.push(line);
  }

  let cleanText = normalizeTextPreserveBreaks(cleanLines);

  // Interview parse (Q/A) -> store structured QA
  if (meta.isInterview) {
    meta.interview = meta.interview || { intervieweeName: "", titleLine: "", qa: [], highlights: [] };
    meta.interview.qa = parseInterviewQA(cleanLines);
    meta.interview.highlights = extractInterviewHighlights(meta.interview.qa);

    // If still no name, try speaker line "Laura Chen: ..."
    if (!meta.interview.intervieweeName) {
      const sp = cleanLines.slice(0, 40).find(l => /^[A-Z][\w.'’\-]+(?:\s+[A-Z][\w.'’\-]+){0,5}\s*[:\-–—]\s+/.test(l));
      if (sp) {
        const m = sp.match(/^([A-Z][\w.'’\-]+(?:\s+[A-Z][\w.'’\-]+){0,5})\s*[:\-–—]\s+/);
        if (m && m[1]) meta.interview.intervieweeName = normalizeWhitespace(m[1]);
      }
    }

    // Keep cleanText as readable text, but structured QA will be used by body.js.
    cleanText = normalizeInterviewText(cleanLines);
  }

  return { meta, cleanText };
}

function normalizeLines(input) {
  const s = String(input || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n");

  return s.split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

function normalizeTextPreserveBreaks(lines) {
  const out = (Array.isArray(lines) ? lines : [])
    .map(l => String(l || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n");

  return out.trim();
}

function looksLikeInterview(lines) {
  const head = (Array.isArray(lines) ? lines : []).slice(0, 160);

  const hasQA = head.some(l => /^(q|a|answer)\s*[:\-–—]/i.test(l));
  const hasInterviewerCue = head.some(l => /\b(interviewer|interviewee)\b/i.test(l));
  const hasEnd = head.some(l => /end\s+of\s+transcript/i.test(l));
  const hasInterviewWord = head.join(" ").toLowerCase().includes("interview");

  return hasQA || hasInterviewerCue || hasEnd || hasInterviewWord;
}

/* ----------------------------- Interview parsing ----------------------------- */

function parseInterviewQA(lines) {
  const qa = [];
  let cur = null; // { q: "", a: "" }

  const pushCur = () => {
    if (!cur) return;
    const q = normalizeWhitespace(cur.q || "");
    const a = normalizeWhitespace(cur.a || "");
    if (q || a) qa.push({ q, a });
    cur = null;
  };

  for (const rawLine of (lines || [])) {
    const line = cleanTranscriptLine(rawLine);

    const qMatch = line.match(/^(?:q|question)\s*[:\-–—]\s*(.+)$/i);
    if (qMatch && qMatch[1]) {
      pushCur();
      cur = { q: qMatch[1].trim(), a: "" };
      continue;
    }

    const aMatch = line.match(/^(?:a|answer|respondent)\s*[:\-–—]\s*(.+)$/i);
    if (aMatch && aMatch[1]) {
      cur = cur || { q: "", a: "" };
      cur.a = (cur.a ? (cur.a + " " + aMatch[1].trim()) : aMatch[1].trim());
      continue;
    }

    // Speaker format: "Laura Chen: ..."
    const sp = line.match(/^([A-Z][\w.'’\-]+(?:\s+[A-Z][\w.'’\-]+){0,5})\s*[:\-–—]\s+(.+)$/);
    if (sp && sp[2]) {
      cur = cur || { q: "", a: "" };
      cur.a = (cur.a ? (cur.a + " " + sp[2].trim()) : sp[2].trim());
      continue;
    }

    // Continuation lines: append to current answer if we are inside an answer
    if (cur && cur.a) {
      cur.a += " " + line;
    }
  }

  pushCur();
  return qa;
}

function extractInterviewHighlights(qa) {
  const items = [];
  for (const pair of (qa || [])) {
    if (!pair || !pair.a) continue;

    const a = String(pair.a || "").trim();
    if (!a) continue;

    const sents = splitSentences(a).map(s => normalizeWhitespace(s)).filter(Boolean);
    for (const s of sents) {
      const score = scoreInterviewSentence(s);
      if (score >= 3) items.push({ s, score });
    }
  }

  items.sort((x, y) => (y.score - x.score) || (x.s.length - y.s.length));

  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it.s);
    if (out.length >= 8) break;
  }
  return out;
}

function scoreInterviewSentence(s) {
  const t = String(s || "").toLowerCase();
  let score = 0;

  if (t.includes("we will") || t.includes("we're") || t.includes("we are")) score += 1;
  if (t.includes("will be") || t.includes("require") || t.includes("restricted") || t.includes("posted")) score += 1;
  if (t.includes("fines") || t.includes("violations") || t.includes("stop-work") || t.includes("enforcement")) score += 1;
  if (t.includes("data") || t.includes("summary") || t.includes("publish") || t.includes("report")) score += 1;
  if (/\b(after\s+\d{1,2}(:\d{2})?\s*(am|pm)\b)/i.test(s) || /\b\d+\s*(weeks?|days?)\b/i.test(s)) score += 1;

  if (s.trim().split(/\s+/).length < 8) score -= 2;

  return score;
}

function normalizeInterviewText(lines) {
  const cleaned = (lines || [])
    .map(l => cleanTranscriptLine(l))
    .filter(Boolean)
    .map(l => l
      // keep readability, but structured QA is used for final transcript rendering
      .replace(/^(?:q|question)\s*[:\-–—]\s*/i, "")
      .replace(/^(?:a|answer|respondent)\s*[:\-–—]\s*/i, "")
      .trim()
    );

  return normalizeTextPreserveBreaks(cleaned);
}

function cleanTranscriptLine(line) {
  let out = String(line || "").trim();
  if (!out) return "";

  out = out.replace(/^[“”"']+\s*/g, "");
  out = out.replace(/[“”]/g, "\"");
  out = out.replace(/’/g, "'");
  out = out.replace(/^[-•]+\s*/g, "");

  return out.trim();
}

/* ---------------------- Interview highlight synthesis ---------------------- */

function synthesizeInterviewHighlights(interview, w5h1) {
  const who = normalizeWhitespace(w5h1.who || interview.intervieweeName || "");
  const what = normalizeWhitespace(w5h1.what || "");
  const where = normalizeWhitespace(w5h1.where || "");
  const when = normalizeWhitespace(w5h1.when || "");

  const hl = Array.isArray(interview.highlights) ? interview.highlights : [];
  const qa = Array.isArray(interview.qa) ? interview.qa : [];

  const lines = [];

  const frameParts = [];
  if (who) frameParts.push(who);
  if (when) frameParts.push(when);
  if (where) frameParts.push(where);

  const frame = frameParts.length ? frameParts.join(" — ") : (who || "Interview");
  const topic = what ? what.replace(/[.]+$/g, "") : "discussed the issue";

  lines.push(`${frame}: In an interview, ${who ? who : "the official"} ${topic}.`);

  const pick = [];
  for (const s of hl) pick.push(s);
  if (pick.length < 4) {
    for (const pair of qa.slice(0, 8)) {
      if (!pair || !pair.a) continue;
      const sents = splitSentences(pair.a).map(x => normalizeWhitespace(x)).filter(Boolean);
      for (const s of sents) {
        if (pick.length >= 6) break;
        if (s.split(/\s+/).length >= 10) pick.push(s);
      }
      if (pick.length >= 6) break;
    }
  }

  const seen = new Set();
  for (const s of pick) {
    const t = normalizeWhitespace(s);
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);

    const quoted = t.startsWith("\"") ? t : `"${t.replace(/^"+|"+$/g, "")}"`;
    lines.push(quoted);
    if (lines.length >= 1 + 6) break;
  }

  return lines.join("\n\n").trim();
}
