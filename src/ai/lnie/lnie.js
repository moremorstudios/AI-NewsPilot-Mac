// FILE: src/ai/lnie/lnie.js
import { buildFromText } from "./structure.js";
import { genHeadlines, genTopHeadline, genSubheads } from "./headline.js";
import { genSpots } from "./spot.js";
import { genQuotes } from "./quote.js";
import { genBody } from "./body.js";
import { getStyleProfile } from "./styles/index.js";

export async function generateWithLocal({ inputs, settings }){
  const profile = getStyleProfile(settings.style || "agency");
  const ctx = buildFromText({ text: inputs.sourceText || "", w5h1: inputs.w5h1 || {} });

  const topHeadline = genTopHeadline(ctx, profile, settings);
  const headlines = genHeadlines(ctx, profile, settings);
  const subheadlines = genSubheads(ctx, profile, settings);
  const spots = genSpots(ctx, profile, settings);
  const quotes = genQuotes(ctx, profile, settings);
  const body = genBody(ctx, profile, settings);

  return {
    engineUsed: "local",
    inputs,
    outputs: { topHeadline, headlines, subheadlines, spots, quotes, body }
  };
}
