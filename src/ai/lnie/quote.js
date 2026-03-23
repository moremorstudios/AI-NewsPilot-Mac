// FILE: src/ai/lnie/quote.js
import { normalizeWhitespace as norm, splitSentences } from "./language-utils.js";

export function generateQuotes({ sourceText, styleKey, variationSeed, maxQuotes=4, maxWordsPerQuote=30 }){
  const text = norm(sourceText||"");
  const sentences = splitSentences(text);
  const out = [];

  for (const s of sentences){
    const trimmed = s.trim();
    if (!trimmed) continue;
    if (!/[\"“”]/.test(trimmed) && trimmed.split(/\s+/).length <= maxWordsPerQuote){
      out.push(trimmed);
      if (out.length >= maxQuotes) break;
    }
  }

  return out;
}
