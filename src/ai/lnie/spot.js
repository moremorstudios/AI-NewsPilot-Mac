// FILE: src/ai/lnie/spot.js
import { normalizeWhitespace as norm, trimToMaxWords as trimW, splitSentences } from "./language-utils.js";

export function generateSpots({ sourceText, styleKey, variationSeed, maxSpots=4, maxWordsPerSpot=25 }){
  const text = norm(sourceText||"");
  const sentences = splitSentences(text);
  const spots = [];

  for (const s of sentences){
    const cleaned = trimW(s, maxWordsPerSpot).trim();
    if (!cleaned) continue;
    spots.push(cleaned);
    if (spots.length>=maxSpots) break;
  }

  return spots;
}
