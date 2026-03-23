// FILE: src/app/export.js
// Final build + export helpers for AI-NewsPilot UI

import { getState, setState } from "./state.js";
import { getActivePackage } from "./versions.js";

function upperAuthorLine(name = "") {
  const t = String(name || "").trim();
  if (!t) return "";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].toUpperCase();
  const last = parts[parts.length - 1].toUpperCase();
  const firsts = parts.slice(0, -1).join(" ").toUpperCase();
  return `${firsts} ${last}`.trim();
}

function upperLocationLine(loc = "") {
  const t = String(loc || "").trim();
  return t ? t.toUpperCase() : "";
}

function setOutText(el, text) {
  if (!el) return;
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    el.value = text;
  } else {
    el.textContent = text;
  }
}

function readOutText(el) {
  if (!el) return "";
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    return String(el.value || "");
  }
  return String(el.textContent || "");
}function normalizeChoices(pkg, outputs){
  if (!pkg) return null;
  const c = pkg.choices;
  if (c && Array.isArray(c.items)) return c;

  // Backwards compatibility: build choices on the fly (do not persist)
  const items = [];
  const pushItem = (id, label, text, selected) => items.push({
    id, label, text: String(text || "").trim(), selected: Boolean(selected)
  });

  if (outputs && outputs.topHeadline) pushItem("topHeadline", "Top Headline", outputs.topHeadline, true);

  if (outputs && Array.isArray(outputs.headlines)) {
    outputs.headlines.slice(0, 3).forEach((h, i) => pushItem(`headline${i+1}`, `Headline ${i+1}`, h, false));
  }

  const sub = (outputs && Array.isArray(outputs.subheadline)) ? (outputs.subheadline[0] || "") : "";
  if (sub) pushItem("subheadline1", "Subheadline", sub, false);

  if (outputs && Array.isArray(outputs.spots)) {
    outputs.spots.slice(0, 4).forEach((s, i) => pushItem(`spot${i+1}`, `Spot/Keyline ${i+1}`, s, false));
  }

  if (outputs && Array.isArray(outputs.quotes)) {
    outputs.quotes.slice(0, 4).forEach((q, i) => pushItem(`quote${i+1}`, `Quote ${i+1}`, q, false));
  }

  const body = (outputs && (outputs.bodyText || outputs.body)) ? (outputs.bodyText || outputs.body) : "";
  if (body) pushItem("body", "Body", body, true);

  return { items, updatedAt: Date.now() };
}

function choiceById(choices){
  const m = new Map();
  if (!choices || !Array.isArray(choices.items)) return m;
  choices.items.forEach(it => { if (it && it.id) m.set(String(it.id), it); });
  return m;
}

function isSelected(choicesMap, id){
  const it = choicesMap.get(String(id));
  return it ? Boolean(it.selected) : false;
}

function choiceText(choicesMap, id, fallback){
  const it = choicesMap.get(String(id));
  if (it && typeof it.text === "string") return it.text.trim();
  return String(fallback || "").trim();
}



// Build a final text from the active version package (structured output).
function buildFinalTextFromPackage() {
  const pkg = getActivePackage();
  if (!pkg || !pkg.outputs) return "";

  const state = getState();
  const inputs = pkg.inputs || state.inputs || {};
  const o = pkg.outputs || {};

  const choices = normalizeChoices(pkg, o);
  const cmap = choiceById(choices);
  const useChoices = choices && Array.isArray(choices.items) && choices.items.length;

  const lines = [];

  if (useChoices) {
    const top = choiceText(cmap, "topHeadline", o.topHeadline);
    if (top && isSelected(cmap, "topHeadline")) lines.push(top);

    const heads = [];
    for (let i = 1; i <= 3; i++) {
      const id = `headline${i}`;
      if (isSelected(cmap, id)) {
        const t = choiceText(cmap, id, (Array.isArray(o.headlines) ? o.headlines[i - 1] : ""));
        if (t) heads.push(t);
      }
    }
    if (heads.length) {
  lines.push("");
  heads.forEach((h, i) => {
    lines.push(h);
    if (i !== heads.length - 1) lines.push(""); // blank line between headlines
  });
}


    const sub = choiceText(cmap, "subheadline1", (Array.isArray(o.subheadline) ? o.subheadline[0] : ""));
    if (sub && isSelected(cmap, "subheadline1")) {
      lines.push("");
      lines.push(sub);
    }
  } else {
    if (o.topHeadline) lines.push(String(o.topHeadline).trim());

    if (Array.isArray(o.headlines) && o.headlines.length) {
      lines.push("");
      lines.push(...o.headlines.map(h => String(h || "").trim()).filter(Boolean));
    }

    if (Array.isArray(o.subheadline) && o.subheadline.length) {
      lines.push("");
      lines.push(...o.subheadline.map(h => String(h || "").trim()).filter(Boolean));
    }
  }

  const author = upperAuthorLine(inputs.authorName);
  const loc = upperLocationLine(inputs.authorLocation);
  if (author || loc) {
    lines.push("");
    if (author && loc) lines.push(`${author} — ${loc}`);
    else lines.push(author || loc);
  }

  if (useChoices) {
    const spots = [];
    for (let i = 1; i <= 4; i++) {
      const id = `spot${i}`;
      if (isSelected(cmap, id)) {
        const t = choiceText(cmap, id, (Array.isArray(o.spots) ? o.spots[i - 1] : ""));
        if (t) spots.push(t);
      }
    }
    if (spots.length) {
  lines.push("");
  spots.forEach((s, i) => {
    lines.push(`• ${s}`);
    if (i !== spots.length - 1) lines.push(""); // blank line between spots
  });
}

    const body = choiceText(cmap, "body", (o.bodyText || o.body || ""));
    if (body && isSelected(cmap, "body")) {
      lines.push("");
      lines.push(body);
    }

    const quotes = [];
    for (let i = 1; i <= 4; i++) {
      const id = `quote${i}`;
      if (isSelected(cmap, id)) {
        const t = choiceText(cmap, id, (Array.isArray(o.quotes) ? o.quotes[i - 1] : ""));
        if (t) quotes.push(t);
      }
    }
    if (quotes.length) {
  lines.push("");
  // Use localized header if available (UI i18n uses full keys)
  const hdr = (typeof document !== "undefined" && document.documentElement)
    ? (document.documentElement.getAttribute("data-lang") || "")
    : "";
  // We don't have tKey here; keep it stable and let UI post-fix translate if needed.
  // BUT we at least standardize the header token and colon for matching.
  lines.push("QUOTES:");
  lines.push("");
  quotes.forEach((q, i) => {
    lines.push(`"${q}"`);
    if (i !== quotes.length - 1) lines.push(""); // blank line between quotes
  });
}
  } else {
    if (Array.isArray(o.spots) && o.spots.length) {
      const spots = o.spots.map(s => String(s || "").trim()).filter(Boolean);
      if (spots.length) {
        lines.push("");
        lines.push(...spots.map(s => `• ${s}`));
      }
    }

    if (o.body) {
      const body = String(o.body || "").trim();
      if (body) {
        lines.push("");
        lines.push(body);
      }
    }

    if (Array.isArray(o.quotes) && o.quotes.length) {
      const quotes = o.quotes.map(q => String(q || "").trim()).filter(Boolean);
      if (quotes.length) {
        lines.push("");
        lines.push("QUOTES:");
        lines.push("");
        quotes.forEach((q, i) => {
  lines.push(`"${q}"`);
  if (i !== quotes.length - 1) lines.push(""); // blank line between quotes
});

      }
    }
  }

  return lines.join("\n").trim();

}

// Prefer user-edited text when available (Final first, then Draft, then package build).
function getFinalTextForExport() {
  const s = getState();
  if (s && s.final && typeof s.final.text === "string" && s.final.text.trim()) {
    return s.final.text.trim();
  }

  const finalEl = document.getElementById("finalOutput");
  const finalText = readOutText(finalEl).trim();
  if (finalText) return finalText;

  const draftEl = document.getElementById("draftOutput");
  const draftText = readOutText(draftEl).trim();
  if (draftText) return draftText;

  return buildFinalTextFromPackage();
}

// Called from UI "Build Final" button.
export function buildFinalAndRender() {
  const pkg = getActivePackage();
  const hasChoices = Boolean(pkg && pkg.choices && Array.isArray(pkg.choices.items) && pkg.choices.items.length);

  const draftEl = document.getElementById("draftOutput");
  const preferred = readOutText(draftEl).trim();

  const text = hasChoices ? buildFinalTextFromPackage() : (preferred || buildFinalTextFromPackage());
  if (!text) throw new Error("No generated version to build from.");

  setState({ final: { text } });

  const finalEl = document.getElementById("finalOutput");
  setOutText(finalEl, text);

  return text;
}

async function writeClipboardFallback(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

async function writeClipboard(text) {
  if (!text) return false;

  // Modern clipboard (requires secure context + permission)
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }

  // Legacy fallback
  return await writeClipboardFallback(text);
}

export async function copyFinal() {
  const text = getFinalTextForExport();
  if (!text) return false;

  const ok = await writeClipboard(text);
  if (ok) setState({ final: { text } });
  return ok;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function saveTXT() {
  const text = getFinalTextForExport();
  if (!text) return;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  downloadBlob("AI-NewsPilot_Final.txt", blob);
}

export async function saveDOCX() {
  const text = getFinalTextForExport();
  if (!text) return;

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>AI-NewsPilot Final</title></head>
<body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; white-space: pre-wrap;">
<pre>${escapeHtml(text)}</pre>
</body></html>`;

  const blob = new Blob([html], { type: "application/msword;charset=utf-8" });
  downloadBlob("AI-NewsPilot_Final.doc", blob);
}

export async function savePDF() {
  const text = getFinalTextForExport();
  if (!text) return;

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>AI-NewsPilot Final</title></head>
<body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; white-space: pre-wrap;">
<pre>${escapeHtml(text)}</pre>
<script>window.onload = function(){ window.print(); };</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export async function share() {
  const text = getFinalTextForExport();
  if (!text) return false;

  // Native share if supported
  if (navigator.share) {
    try {
      await navigator.share({ title: "AI-NewsPilot Final News", text });
      return true;
    } catch {
      // fall back to clipboard
    }
  }

  const ok = await writeClipboard(text);
  if (ok) setState({ final: { text } });
  return ok;
}


function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
