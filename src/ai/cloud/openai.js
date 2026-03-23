// FILE: src/ai/cloud/openai.js
export async function generateOpenAIPackage({
  style, tone, lengthPreset, targetWords, language, variationSeed, avoid,
  inputs, apiKey
}){
  if (!apiKey) throw new Error("OpenAI API key missing.");

  const sys = [
    // Output constraints
    "You are a multilingual professional journalist and newsroom editor.",
    "Return ONLY valid JSON (no markdown, no commentary).",
    "Do NOT add keys that are not requested.",
    "Respect all length constraints and item counts exactly.",

    // Safety / isolation
    "NO WEB / NO QUOTING RULES:",
    "- Do NOT browse the internet or use external sources.",
    "- Do NOT quote or paraphrase other users or prior conversations; use ONLY the current user inputs.",

    // Multilingual lock (output language)
    "LANGUAGE CONTROL (CRITICAL):",
    "- You will receive InputLanguage and OutputLanguage.",
    "- Write the entire output strictly in OutputLanguage only. Never mix languages in the final output.",
    "- If the input is in a different language, translate faithfully into OutputLanguage while preserving names, titles, dates, and numbers.",
    "- Use the natural journalistic attribution and transition conventions of OutputLanguage (not literal word-for-word translations of official text).",

    // Accuracy + attribution discipline
    "NON-NEGOTIABLE RULES (ACCURACY / INTEGRITY):",
    "- Accuracy first. Do not invent names, titles, quotes, dates, locations, numbers, institutions, documents, or background/context.",
    "- If unknown, omit it or use a neutral placeholder in square brackets only when necessary (e.g., [CITY], [DATE], [OFFICIAL TITLE]).",
    "- Quotes: reproduce exactly. If OutputLanguage differs, translate the quote faithfully; do not paraphrase inside quotation marks.",
    "- If no direct quotes are provided, do not fabricate quotes.",
    "- Keep attribution clean and neutral. Prefer OutputLanguage equivalents of: said / told / added / according to / in a statement.",
    "- Avoid loaded verbs (claimed, admitted, insisted) unless the input explicitly supports that meaning.",
    "- Avoid repetitive attribution; vary placement and use standard transitions without changing meaning.",

    // Press release → newsroom rewrite (fixes “bülten gibi” problem in any language)
    "PRESS RELEASE / STATEMENT → NEWSROOM REWRITE (MANDATORY):",
    "- If the source is an official statement/press release/bulletin, treat it as SOURCE MATERIAL, not publish-ready copy.",
    "- Do NOT replicate official/bureaucratic voice or sentence structure.",
    "- Convert into newsroom voice: reader-first, reporter-authored language.",
    "- Provide clear attribution without inventing speakers: if none named, attribute to 'the statement/release/announcement/office' in OutputLanguage.",
    "- Prefer plain, active phrasing over passive administrative constructions.",
    "- Preserve facts exactly; change only phrasing, structure, and tone.",

    // AP-like discipline for NEWS Agency
    "AP-LIKE DISCIPLINE FOR AGENCY OUTPUTS:",
    "- When STYLE_KEY is 'agency', default to the simplest neutral attribution verb (OutputLanguage equivalent of 'said').",
    "- Keep sentences tight, factual, and non-interpretive. No promotional or ceremonial phrasing."
  ].join(" ");

  // --- STYLE normalize (prevents 'tv'/'radio' missing due to label differences) ---
  const rawStyle = String(style || "newspaper").toLowerCase().trim();
  const styleKey = (() => {
    if (rawStyle.includes("tv")) return "tv";
    if (rawStyle.includes("radio")) return "radio";
    if (rawStyle.includes("magazine")) return "magazine";
    if (rawStyle.includes("news_site") || rawStyle.includes("news-site") || rawStyle.includes("news site") || rawStyle.includes("website") || rawStyle.includes("news-site")) return "news-site";
    if (rawStyle.includes("newspaper")) return "newspaper";
    if (rawStyle.includes("news agency")) return "agency";
    if (rawStyle.includes("agency")) return "agency";
    return rawStyle || "newspaper";
  })();

  // --- TONE normalize (your UI likely sends strings; make it actually change output) ---
  const toneKey = String(tone || "neutral").toLowerCase().trim();
  const toneGuide = (() => {
    switch (toneKey) {
      case "formal":
        return "Formal, institutional, restrained. No slang. Balanced attribution. No hype.";
      case "friendly":
        return "Readable, conversational but still professional. Shorter sentences, clearer transitions, not casual slang.";
      case "journalistic":
        return "Neutral newsroom tone. Fact-forward, objective, minimal adjectives. Attribution where needed.";
      case "neutral":
        return "Plain neutral professional tone. Not stiff, not friendly.";
      case "dramatic":
        return "Higher urgency and tension, but still factual and non-sensational. Avoid editorializing.";
      default:
        return "Professional tone consistent with the selected style. Avoid exaggeration.";
    }
  })();

  // --- AUTHOR aliases (your inputs are not wired to authorName/authorLocation consistently) ---
  const authorName = String(
    (inputs && (
      inputs.authorName ??
      inputs.author ??
      inputs.byline ??
      inputs.writer ??
      inputs.reporterName ??
      inputs.name
    )) || ""
  ).trim();

  const authorLocation = String(
    (inputs && (
      inputs.authorLocation ??
      inputs.location ??
      inputs.city ??
      inputs.dateline ??
      inputs.reporterLocation
    )) || ""
  ).trim();

  // --- 5W1H aliases (your UI may use different keys than inputs.w5h1) ---
  const w =
    (inputs && (inputs.w5h1 || inputs.w5w1h || inputs.w5n1k || inputs.fivew1h || inputs.fiveW1H)) || {};

  const who = String(w.who || w.WHO || inputs?.who || "").trim();
  const what = String(w.what || w.WHAT || inputs?.what || "").trim();
  const when = String(w.when || w.WHEN || inputs?.when || "").trim();
  const where = String(w.where || w.WHERE || inputs?.where || "").trim();
  const why = String(w.why || w.WHY || inputs?.why || "").trim();
  const how = String(w.how || w.HOW || inputs?.how || "").trim();

  // --- Source text aggregation ---
  const sourceParts = [];
  const pushIf = (v) => { if (typeof v === "string" && v.trim()) sourceParts.push(v.trim()); };

  pushIf(inputs?.sourceText);
  pushIf(inputs?.additionalDetails);
  pushIf(inputs?.details);
  pushIf(inputs?.pressReleaseText);
  pushIf(inputs?.interviewText);
  pushIf(inputs?.pasteText);

  const sourceText = sourceParts.join("\n\n").trim();

  // --- Interview extraction: force Q&A section to exist when interview patterns exist ---
  function extractInterview(text) {
    const s = String(text || "");
    const lines = s.split(/\r?\n/).map(l => String(l || "").trim()).filter(Boolean);
    if (lines.length < 4) return "";

    // Treat as interview ONLY if we detect explicit Q:/A: structure.
    let qCount = 0;
    let aCount = 0;
    const picked = [];

    for (let i = 0; i < lines.length; i++) {
      const cur = lines[i];

      const isQPrefix = /^\s*(q|q\.)\s*[:\-]/i.test(cur);
      const isAPrefix = /^\s*(a|a\.)\s*[:\-]/i.test(cur);

      if (isQPrefix) qCount++;
      if (isAPrefix) aCount++;

      if (isQPrefix) {
        // take Q line and the immediate A line(s) if present
        const a1 = lines[i + 1] || "";
        const a2 = lines[i + 2] || "";
        const a1IsQ = /^\s*(q|q\.)\s*[:\-]/i.test(a1);

        picked.push(cur);
        if (a1 && !a1IsQ) picked.push(a1);
        if (a2 && !a2.endsWith("?") && !/^\s*(q|q\.)\s*[:\-]/i.test(a2)) picked.push(a2);
      }
    }

    // Require at least two explicit Q lines and at least one A line
    if (qCount < 2 || aCount < 1 || picked.length === 0) return "";
    return picked.join("\n").trim();
  }

  function escapeRegExp(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  const interviewExtract = extractInterview(sourceText);

  const interviewHeader = (() => {
    const l = String(language || "").toLowerCase();
    if (l.startsWith("tr")) return "RÖPORTAJ (Soru-Cevap)";
    if (l.startsWith("de")) return "INTERVIEW (Fragen & Antworten)";
    if (l.startsWith("fr")) return "ENTRETIEN (Questions/Réponses)";
    if (l.startsWith("es")) return "ENTREVISTA (Preguntas y Respuestas)";
    if (l.startsWith("it")) return "INTERVISTA (Domande & Risposte)";
    if (l.startsWith("ru")) return "ИНТЕРВЬЮ (Вопрос–Ответ)";
    if (l.startsWith("ar")) return "مقابلة (سؤال/جواب)";
    return "INTERVIEW (Q&A)";
  })();

  const styleAddon = (() => {
    switch (styleKey) {
      case "newspaper":
        return "STYLE: NEWSPAPER — inverted pyramid, hard news, short paragraphs, neutral tone, rewrite statements into newsroom voice.";
      case "magazine":
        return "STYLE: MAGAZINE — longform feature, smoother transitions, no invented scene-setting, weave quotes naturally, rewrite official text into human newsroom prose.";
      case "news-site":
        return "STYLE: NEWSSITE — digital and skimmable, short paragraphs, optional brief subheads if allowed, no bulletin tone, end with next steps only if provided.";
      case "agency":
        return "STYLE: NEWS AGENCY — AP/Reuters-like: ultra-neutral, compact, fact-forward, default to 'said' equivalents, no flourish, no promotional tone, no subheads.";
      case "tv":
        return "STYLE: TV — broadcast script cadence, short sentences, blocks per OutputFormat, convert statements into broadcast-friendly reporting without reading the release verbatim.";
      case "radio":
        return "STYLE: RADIO — audio-first, clear signposting, simple clauses, blocks per OutputFormat, convert statements into listener-friendly reporting.";
      default:
        return "STYLE: NEWSPAPER — default hard news treatment.";
    }
  })();

  // Style-specific output spec
  // For Newspaper / Magazine / News Site, prefer 4 quotes by default,
  // but do NOT force filler when the source is very short.
  const srcWordCount = (sourceText ? sourceText.split(/\s+/).filter(Boolean).length : 0);

  const scaleQuotesN = (wc) => {
    if (wc <= 70) return 1;     // ultra short
    if (wc <= 120) return 2;    // short (e.g., ~100 words)
    return 4;                   // normal
  };

  const spec = (() => {
    const sk = String(styleKey || "newspaper");

    // Defaults (newspaper/news-site/magazine)
    let headlinesN = 3, spotsN = 4, quotesN = scaleQuotesN(srcWordCount), needSub = true;

    if (sk === "agency") {
      headlinesN = 2; spotsN = 2; quotesN = 2; needSub = false;
    }
    if (sk === "radio" || sk === "tv") {
      headlinesN = 2; spotsN = 2; quotesN = 2; needSub = false;
    }

    return { headlinesN, spotsN, quotesN, needSub };
  })();

  const isScript = (styleKey === "radio" || styleKey === "tv");

  const user = `
Generate a structured news package in JSON.

LANGUAGE: ${language}
INPUT_LANGUAGE: ${language}
OUTPUT_LANGUAGE: ${language}
STYLE_ADDON: ${styleAddon}
STYLE_KEY: ${styleKey}
TONE_KEY: ${toneKey}
TONE_GUIDE: ${toneGuide}
LENGTH_PRESET: ${lengthPreset}
TARGET_WORDS: ${targetWords ?? "null"}
VARIATION_SEED: ${variationSeed}

IMPORTANT OUTPUT RULES:
- NO FABRICATION: never add facts, names, roles, institutions, numbers, dates, or causal claims not present in SOURCE_TEXT or 5W1H.
- For toneKey neutral/informative: do NOT add "color" sentences, moral lessons, cultural commentary, or inferred benefits; stick strictly to provided facts.
- topHeadline: 1 item, max 12–16 words (do not truncate meaning).
- headlines: EXACTLY ${spec.headlinesN} item(s), each max 14–16 words.
- subheadline: ${spec.needSub ? "EXACTLY 1 item, max 16–18 words (must NOT be empty)." : "return an empty string \"\" (not used for this style)."}
- spots: Target ${spec.spotsN} item(s). Each should be 18–25 words. If SOURCE_TEXT is too sparse, you may return fewer items and/or shorter items — but NEVER pad with filler or invented details.
- quotes: Target ${spec.quotesN} item(s) (if 0, return []). Each should be 18–30 words. Write them as quote-style key statements derived from SOURCE_TEXT and 5W1H: you may paraphrase, but you MUST NOT add facts. If literal quotations or interview Q&A exist, prefer using them. If SOURCE_TEXT is too sparse to support distinct items, return fewer items rather than padding.
- body: must be fully formatted with paragraphs. Between paragraphs, insert ONE blank line (double newline).

${isScript ? `
SCRIPT FORMAT (RADIO/TV BODY):
- Begin with a brief summary paragraph (2–4 sentences), paragraph-separated with a blank line.
- Then present the script using these labels exactly: ANCHOR:, VO:, SOT1:, SOT2: (if you can), TAG:
- Put ONE blank line between each labeled block.
- Inside each labeled block, separate sentences with ONE blank line (double newline).
- Use SOT lines only with verbatim quotes/excerpts from SOURCE_TEXT/INTERVIEW_EXTRACT. Do not invent quotes.
` : ""}

QUALITY (STRICT):
QUALITY (STRICT):
- Spots must be distinct takeaways (no repeats, no generic filler). Do not restate a Spot as a Quote or vice versa.
- Quotes must be meaningfully different from each other AND from Spots (no paraphrasing the same sentence). If not enough distinct statements exist without padding, return fewer quotes.
- Headlines (topHeadline + headlines + subheadline) must be distinct angles. No reworded duplicates; each must introduce a different emphasis.
- Subheadline must add context that is NOT already in the selected headline.
- Tone must noticeably affect diction and rhythm per TONE_GUIDE while staying factual.

INTERVIEW RULES (STRICT):
If INTERVIEW_EXTRACT is empty: You MUST NOT add any interview section, Q&A heading, transcript, or the title "INTERVIEW (Q&A)" (or any translated equivalent) anywhere.
If INTERVIEW_EXTRACT is not empty:
- For STYLE_KEY = 'tv':
  1) Start body with an anchor-style news brief FIRST (3–5 sentences). It MUST NOT be 1 sentence. The brief MUST include WHAT + WHERE + WHEN (if known) and the policy/action.
  2) Then include a Q&A transcript using labels: ANCHOR:, REPORTER:, GUEST: (role+name if known).

- For STYLE_KEY = 'radio':
  1) Start body with a host intro FIRST (4–6 sentences). It MUST NOT be 1 sentence. The intro MUST include WHAT + WHERE + WHEN (if known) and the main impact.
  2) Then include Q&A using labels: HOST:, GUEST:.

- For ALL OTHER styles:
  1) First write a complete full-length news article in that style (no length limit by default).
  2) After the article, append a section titled exactly: ${interviewHeader}
  3) Under that title, include the Q&A transcript derived from INTERVIEW_EXTRACT (keep speaker labels and order; you may lightly clean typos, but do not convert it into narrative).

AUTHOR (if provided):
- If AUTHOR_NAME exists, include a byline line in body near the top (after headlines/subheadline): "AUTHOR_NAME — AUTHOR_LOCATION" (location optional).
AUTHOR_NAME: ${authorName}
AUTHOR_LOCATION: ${authorLocation}

5W1H (may be partial; use them if present):
WHO: ${who}
WHAT: ${what}
WHEN: ${when}
WHERE: ${where}
WHY: ${why}
HOW: ${how}

AVOID (optional):
${Array.isArray(avoid) ? avoid.join(", ") : ""}

INTERVIEW_EXTRACT:
${interviewExtract}

SOURCE_TEXT:
${sourceText}

JSON KEYS MUST MATCH EXACTLY:
topHeadline, headlines, subheadline, spots, quotes, body

Return JSON exactly in this shape:
{
  "topHeadline": "string",
  "headlines": [${Array(spec.headlinesN).fill('"string"').join(",")}],
  "subheadline": ${spec.needSub ? '"string"' : '""'},
  "spots": [${Array(spec.spotsN).fill('"string"').join(",")}],
  "quotes": [${Array(spec.quotesN).fill('"string"').join(",")}],
  "body": "string"
}
`.trim();

  // --- Model fallback chain (economic + news-friendly)
// If a model is retired/unavailable or rate-limited, try the next one.
// Model list/pricing can change; keep this list easy to update.
const MODEL_FALLBACKS = [
  // Keep current first (your existing behavior)
  "gpt-4.1-mini",
  // More economical, still strong for structured text
  "gpt-4o-mini",
  // Newer flagship-family cost tiers (often best $/quality for text)
  "gpt-5-mini",
  // Emergency ultra-cheap fallback (quality may drop)
  "gpt-5-nano"
];

function shouldTryNextModel(status, bodyText) {
  const t = (bodyText || "").toLowerCase();

  // Model retired / not found / invalid
  if (status === 400 || status === 404) {
    if (t.includes("model") && (t.includes("not found") || t.includes("does not exist") || t.includes("invalid"))) return true;
    if (t.includes("invalid_model") || t.includes("model_not_found")) return true;
  }

  // Rate limits / capacity
  if (status === 429) return true;
  if (status >= 500) return true;

  // Occasionally policy/permissions/config issues: do NOT blindly fallback
  // (e.g. "insufficient_quota" should not be retried with other models)
  if (t.includes("insufficient_quota")) return false;
  if (t.includes("invalid_api_key")) return false;

  return false;
}

let lastErr = null;
let data = null;
let usedModel = null;

for (const modelName of MODEL_FALLBACKS) {
  const payload = {
    model: modelName,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user }
    ],
    response_format: { type: "json_object" }
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    lastErr = new Error(
      `OpenAI completion failed (model=${modelName}, status=${res.status})` +
      (t ? (": " + t.slice(0, 300)) : "")
    );

    // Try next model only for “retired/unavailable/rate-limit/server” classes
    if (shouldTryNextModel(res.status, t)) continue;

    // Non-retriable: stop immediately
    throw lastErr;
  }

  data = await res.json();
  usedModel = modelName;
  break;
}

if (!data) {
  // All fallbacks failed
  throw (lastErr || new Error("OpenAI completion failed (all fallback models failed)."));
}

// (Optional) if you want to surface which model was used later:
// data.__usedModel = usedModel;

const raw = data.choices?.[0]?.message?.content || "";

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OpenAI did not return valid JSON.");
  }

  const subheadline =
    (typeof parsed.subheadline === "string" ? parsed.subheadline : "") ||
    (Array.isArray(parsed.subheadline) ? (parsed.subheadline[0] || "") : "") ||
    (typeof parsed.subhead === "string" ? parsed.subhead : "") ||
    (typeof parsed.subHeadline === "string" ? parsed.subHeadline : "") ||
    (Array.isArray(parsed.subheadlines) ? (parsed.subheadlines[0] || "") : "");

  const outputs = {
  topHeadline: typeof parsed.topHeadline === "string" ? parsed.topHeadline : "",
  headlines: Array.isArray(parsed.headlines) ? parsed.headlines : [],
  subheadline: String(subheadline || "").trim(),
  subheadlines: subheadline ? [String(subheadline).trim()] : [],
  spots: Array.isArray(parsed.spots) ? parsed.spots : [],
  quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [],
  body: typeof parsed.body === "string" ? parsed.body : ""
};

// --- Quote sanity filter: keep quote-style lines readable without breaking non-Latin punctuation.
function endsDangling(s) {
  const t = String(s || "").trim().toLowerCase();
  return /\b(ve|ya|ile|and|or|but)\s*$/.test(t);
}
function cleanQuote(q) {
  let s = String(q || "").trim();
  s = s.replace(/^\-\s+/, "");      // remove "- " prefix
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";

  // If there is sentence-ending punctuation, trim to the last complete sentence.
  // Include common non-Latin punctuation: 。！？؟ and common closing quote marks.
  const lastSentence = s.match(/^(.*[.!?…\u3002\uFF01\uFF1F\u061F]["”»』」】\]]?)\s*[^.!?…\u3002\uFF01\uFF1F\u061F]*$/);
  if (lastSentence && lastSentence[1]) {
    s = String(lastSentence[1]).trim();
  }

  // Drop obviously broken fragments (but do not require punctuation at the end).
  if (endsDangling(s)) return "";
  if (s.length < 12) return "";

  return s;
}
outputs.quotes = (Array.isArray(outputs.quotes) ? outputs.quotes : [])
  .map(cleanQuote)
  .filter(Boolean);

  // --- Hard guard: if we didn't extract a real Q/A, never allow an interview section in body
if (!interviewExtract) {
  
  const hdr = interviewHeader;

  // remove the interview header + anything after it (localized)
  const reLocalized = new RegExp(
    `\\n\\s*\\n\\s*${escapeRegExp(hdr)}\\s*\\n[\\s\\S]*$`,
    "i"
  );

  // extra safety for EN hardcoded heading
  const reEN = /\n\s*\n\s*INTERVIEW\s*\(Q&A\)\s*\n[\s\S]*$/i;

  outputs.body = String(outputs.body || "")
    .replace(reLocalized, "")
    .replace(reEN, "")
    .trim();
}
  outputs.bodyText = outputs.body;

  return { engineUsed:"openai", inputs, outputs };
}
