//FILE: src/utils/cost-estimate.js
export function estimateCostInfo({ sourceText, targetWords }){
  const chars = (sourceText||"").length;
  const approxTokensIn = Math.max(50, Math.round(chars / 4));
  const approxTokensOut = targetWords ? Math.round(targetWords * 1.4) : 600;
  const total = approxTokensIn + approxTokensOut;

  // rough blended estimate (model-dependent)
  const per1k = 0.015;
  const usd = (total / 1000) * per1k;

  if (usd < 0.01) return "Approx. cost per news: < $0.01";
  if (usd < 1) return `Approx. cost per news: ~$${usd.toFixed(2)} (${Math.round(usd*100)}¢)`;
  return `Approx. cost per news: ~$${usd.toFixed(2)}`;
}
