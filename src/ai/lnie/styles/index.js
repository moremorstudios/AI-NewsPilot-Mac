// FILE: src/ai/lnie/styles/index.js
export function getStyleProfile(key = "general") {
  const base = (k, lead, opts = {}) => ({ key: k, lead, ...opts });
  const map = {
    general:    base("general",    "balanced",            { capsDateline: true }),
    agency:     base("agency",     "inverted_pyramid",    { terse: true }),
    newspaper:  base("newspaper",  "community_focus",     { subhedDeck: true }),
    news_site:  base("news_site",  "digital_scannable",   { bulletsOk: true }),
    magazine:   base("magazine",   "scene_then_facts",    { colorAllowed: true }),
    tv:         base("tv",         "broadcast_rundown",   { veryShortSents: true }),
    radio:      base("radio",      "broadcast_audio",     { timeRefs: true })
  };
  return map[key] || map.general;
}
