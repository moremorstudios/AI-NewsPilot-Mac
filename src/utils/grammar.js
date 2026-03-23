// FILE: src/utils/grammar.js

/**
 * Open external grammar tool (fallback).
 */
export function openExternalGrammarTool() {
  window.open("https://app.grammarly.com", "_blank", "noopener");
}

/**
 * Grammar check via OpenAI Chat Completions.
 * Returns: { cleanedText: string }
 * - Keeps language of the input
 * - Keeps selected news style voice
 * - Avoids factual changes
 */
export async function checkGrammarWithOpenAI({ text, apiKey, lang = "en", style = "agency" }) {
  if (!apiKey) throw new Error("OpenAI API key required for grammar check.");

  const trimmed = String(text || "").trim();
  if (!trimmed) return { cleanedText: "" };

  const system = [
    "You are a professional copy editor.",
    "Fix grammar, punctuation, and clarity while preserving meaning.",
    "DO NOT add facts. DO NOT change numbers, names, dates, or claims.",
    "Keep the same language as the input text.",
    `Maintain the writing voice appropriate for news style: ${style}.`,
    "Return ONLY the corrected text, no explanations."
  ].join(" ");

  const body = {
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: trimmed }
    ]
  };

  let res;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error("Network error while contacting OpenAI.");
  }

  const textRes = await res.text();
  let data = null;
  try { data = textRes ? JSON.parse(textRes) : null; } catch { data = null; }

  if (!res.ok) {
    const apiMsg =
      (data && data.error && (data.error.message || data.error.type)) ? (data.error.message || data.error.type) : "";
    const suffix = apiMsg ? ` | ${apiMsg}` : "";
    throw new Error(`OpenAI grammar request failed (HTTP ${res.status})${suffix}`);
  }

  const msg = data?.choices?.[0]?.message?.content || "";
  return { cleanedText: String(msg || "").trim() };
}
