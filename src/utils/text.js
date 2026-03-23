// FILE: src/utils/text.js
// Lightweight text helpers used by local deterministic generation.
// Keep this file dependency-free (no DOM, no Node APIs).

export function normalizeWhitespace(input = "") {
  return String(input || "")
    // Support both real newlines and literal "\\n" sequences that may arrive from form fields.
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    // Normalize non-breaking spaces and tabs.
    .replace(/\u00A0/g, " ")
    .replace(/\t/g, " ")
    // Trim each line but preserve paragraph breaks.
    .split("\n")
    .map(line => line.trim())
    .join("\n")
    // Collapse multiple blank lines.
    .replace(/\n{3,}/g, "\n\n")
    // Collapse repeated spaces within lines.
    .replace(/[ \f\v]{2,}/g, " ")
    .trim();
}

export function trimToMaxWords(text = "", maxWords = 220) {
  const s = normalizeWhitespace(text);
  if (!s) return "";

  const words = s.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return s;

  const trimmed = words.slice(0, Math.max(1, maxWords)).join(" ");
  return trimmed
    // Clean up dangling punctuation created by word-trimming.
    .replace(/[\s]+([,.;:!?])/g, "$1")
    .replace(/\s+—\s*$/g, "")
    .trim();
}

// Backwards-compatible alias used in some LNIE modules.
// (Some earlier iterations imported { trimW } instead of { trimToMaxWords }.)
export const trimW = trimToMaxWords;
