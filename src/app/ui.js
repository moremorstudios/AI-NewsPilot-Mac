// FILE: src/app/ui.js

import { getState, setState, subscribe } from "./state.js";
import { generateOrRegenerate } from "./generate.js";
import { getActivePackage, setActiveVersion } from "./versions.js";
import { buildFinalAndRender, copyFinal, saveTXT, saveDOCX, savePDF, share } from "./export.js";
import {
  setApiKey, removeApiKey, getApiKey,
  setSpeechKey, removeSpeechKey, getSpeechKey
} from "./storage.js";
import { isRecordingSupported, startVoiceSession } from "../speech/mic.js";
import { writeRecordingToDisk, toFileUrl, saveAudioBlob } from "../speech/audio-file.js";
import { openExternalGrammarTool, checkGrammarWithOpenAI } from "../utils/grammar.js";
import { getLangList, loadI18n, getCurrentI18n } from "../utils/i18n.js";
import { precheckRun } from "./ui_precheck.js";
import {
  isProEnabled,
  isOpenAITrialOrProEnabled,
  refreshLicenseStateFromStorage,
  shouldShowActivateButton,
  getTrialInfo,
  activateLicenseKey,
  purchaseBasicLicense,
  purchaseProLicense,
  refreshStoreLicenseStatus,
  getLicenseStatus
} from "./license.js";


const $ = (id) => document.getElementById(id);

function tKey(key) {
  try {
    const cur = (typeof getCurrentI18n === "function") ? getCurrentI18n() : null;
    if (cur && typeof cur.t === "function") {
      return cur.t(key);
    }
  } catch (_) {}
  return key;
}

function setText(el, txt){
  if (!el) return;
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") el.value = txt ?? "";
  else el.textContent = txt ?? "";
}
function getText(el){
  if (!el) return "";
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return (el.value ?? "");
  return (el.textContent ?? "");
}

function setVisible(el, show){
  if (!el) return;
  el.style.display = show ? "" : "none";
}

function setClosestVisible(el, show){
  if (!el) return;
  const host = el.closest?.(".np-row") || el.closest?.("label") || el.parentElement;
  if (host && host.style) host.style.display = show ? "" : "none";
  else if (el.style) el.style.display = show ? "" : "none";
}

function applyThemeLogo() {
  const el = document.getElementById("imgLogo");
  if (!el) return;

  const theme = document.documentElement.getAttribute("data-theme") || "light";
  el.src = theme === "dark"
    ? "./assets/logo/newspilot-logo-transparent-horizontal.png"
    : "./assets/logo/newspilot-logo-horizontal.png";
}

function cloneActivePackageForUpdate() {
  const s = getState();
  const items = s?.versions?.items;
  const idx = s?.versions?.activeIndex;

  if (!Array.isArray(items)) return null;
  if (typeof idx !== "number" || idx < 0 || idx >= items.length) return null;

  const cur = items[idx];
  if (!cur) return null;

  let next;
  try {
    next = (typeof structuredClone === "function")
      ? structuredClone(cur)
      : JSON.parse(JSON.stringify(cur));
  } catch (e) {
    console.error("cloneActivePackageForUpdate clone failed:", e);
    return null;
  }

  return { items, idx, next };
}

function updateActivePackage(mutator){
  const snap = cloneActivePackageForUpdate();
  if (!snap) return null;

  const { items, idx, next } = snap;
  try { mutator(next); } catch (_) {}

  const nextItems = items.slice();
  nextItems[idx] = next;

  setState({ versions: { items: nextItems, activeIndex: idx } });
  return next;
}

function ensureChoicesOnPackage(pkg){
  if (!pkg || !pkg.outputs) return null;
  if (String(pkg.engineUsed || "").toLowerCase() !== "openai") return null;
  if (pkg.choices && Array.isArray(pkg.choices.items)) return pkg.choices;

  const o = pkg.outputs;
  const items = [];

  const push = (id, labelKey, text, maxWords, selected) => {
  items.push({
    id,
    labelKey,
    label: tKey(labelKey),
    text: String(text || "").trim(),
    maxWords: maxWords ?? null,
    selected: Boolean(selected)
  });
};


  // Top manşet
  push("topHeadline", "Top Headline", o.topHeadline, 12, true);

  // Headline 1–3
  if (Array.isArray(o.headlines)) {
    o.headlines.slice(0, 3).forEach((h, i) => {
      push(`headline${i + 1}`, `Headline ${i + 1}`, h, 10, false);
    });
  }

  // Subheadline (string; varsa tek slot)
  const sub = String(
    Array.isArray(o.subheadline) ? (o.subheadline[0] || "") : (o.subheadline || "")
  ).trim();

  if (sub) {
    push("subheadline1", "Subheadline", sub, 16, false);
  }

  // Spot/Keyline 1–4 (Eskisi gibi bırakıyoruz)
  if (Array.isArray(o.spots)) {
    o.spots.slice(0, 4).forEach((s, i) => {
      push(`spot${i + 1}`, `Spot/Keyline ${i + 1}`, s, 25, false);
    });
  }

  // Alıntılar
  if (Array.isArray(o.quotes)) {
    o.quotes.slice(0, 4).forEach((q, i) => {
      push(`quote${i + 1}`, `Quote ${i + 1}`, q, 30, false);
    });
  }

  // Haber gövdesi – ID "body", başlık "News Body"
const rawBody = String(o.bodyText || o.body || "").trim();
let bodyText = rawBody;


items.push({
  id: "body",
  label: tKey("News Body"),
  text: bodyText,
  maxWords: null,
  selected: true
});

  // Aktif pakete yaz
  updateActivePackage((p) => { p.choices = { items, updatedAt: Date.now() }; });

  return { items, updatedAt: Date.now() };
}



function renderDraftOptionsFromActive(){
  const host = $("draftOptions");
  if (!host) return;

  const pkg = getActivePackage();
  if (!pkg || !pkg.outputs) {
    host.innerHTML = "";
    return;
  }

  const choices = ensureChoicesOnPackage(pkg);
  const items = (choices && Array.isArray(choices.items)) ? choices.items : [];
  host.innerHTML = "";

  if (!items.length) return;

  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "np-opt-row";

    const left = document.createElement("label");
    left.className = "np-opt-check";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = Boolean(it.selected);
    chk.setAttribute("data-opt-id", String(it.id || ""));
    left.appendChild(chk);

    const lab = document.createElement("span");
lab.className = "np-opt-label";
// Etiketleri her dil değişiminde güncel i18n sözlüğünden oku
lab.textContent = tKey(it.labelKey || it.label || it.id || "Option");
left.appendChild(lab);

    const meta = document.createElement("span");
    meta.className = "np-opt-meta";
    meta.textContent = it.maxWords ? `max ${it.maxWords}w` : "";
    left.appendChild(meta);

    row.appendChild(left);

    const right = document.createElement("div");
    right.className = "np-opt-edit";

    // Body is edited in the Draft textarea below (keeps UX simple).
if (String(it.id) === "body") {
  const hint = document.createElement("div");
  hint.id = "np_hint_body_draft";
  hint.className = "np-muted";
  hint.style.fontSize = "12px";
  hint.style.paddingTop = "6px";

  // IMPORTANT: locale key is the full EN sentence (see en.json / tr.json)
  const KEY = "Body is edited in the Draft area below.";
  hint.setAttribute("data-i18n", KEY);
  hint.textContent = tKey(KEY);
  right.appendChild(hint);

// Dinamik eklenen node için i18n uygula (refresh)
try {
  if (typeof window.applyI18n === "function") window.applyI18n(hint);
  else if (window.i18n && typeof window.i18n.apply === "function") window.i18n.apply(hint);
} catch (_) {}
} else {
  const ta = document.createElement("textarea");
  ta.value = String(it.text || "");
  ta.setAttribute("data-opt-id", String(it.id || ""));
  right.appendChild(ta);
}

    row.appendChild(right);
    host.appendChild(row);

    const div = document.createElement("div");
    div.className = "np-opt-divider";
    host.appendChild(div);
  });
}

function updateGenerateButtonLabel(){
  const btn = $("btnGenerate");
  if (!btn) return;
  const generated = !!getState().ui?.hasGenerated;

  btn.textContent = generated ? tKey("Re Generate News") : tKey("Generate News");
}

// Engine defaulting should happen only once per app boot (do not override user clicks)
let __engineBootDone = false;

let _statusTimer = null;
let _statusToken = 0;

function status(msg, opts) {
  setText($("genStatus"), msg || "");
  const stNow = (typeof getState === "function") ? (getState() || {}) : {};
setState({ ui: { ...(stNow.ui || {}), status: msg || "" } });

  const ms = (typeof opts === "number")
    ? opts
    : (opts && typeof opts.autoClearMs === "number" ? opts.autoClearMs : 0);

  if (_statusTimer) {
    clearTimeout(_statusTimer);
    _statusTimer = null;
  }

  if (msg && ms > 0) {
    const token = ++_statusToken;
    _statusTimer = setTimeout(() => {
      if (_statusToken === token) status("");
    }, ms);
  }
}

function statusFinal(msg, opts) {
  setText($("precheckHint"), msg || "");
  const stNow = (typeof getState === "function") ? (getState() || {}) : {};
setState({ ui: { ...(stNow.ui || {}), precheckHint: msg || "" } });

  const ms = (typeof opts === "number")
    ? opts
    : (opts && typeof opts.autoClearMs === "number" ? opts.autoClearMs : 2500);

  if (msg && ms > 0) {
    const token = ++_statusToken;
    setTimeout(() => {
      // sadece aynı mesaj duruyorsa temizle
      if (_statusToken === token && getText($("precheckHint")) === (msg || "")) {
        setText($("precheckHint"), "");
      }
    }, ms);
  }
}

// Action status shown under the action buttons (Grammar/Share/Copy/Build Final)
function statusAction(msg, opts) {
  // Try to place under the action button row (prefer Share button)
  const btn =
    $("btnShareFinal") || $("btnCopyFinal") || $("btnGrammar") || $("btnBuildFinal") || $("btnPrecheck");

  if (!btn) return;

  const row = btn.closest(".np-row") || btn.parentElement;
  if (!row) return;

  let el = document.getElementById("actionHint");
  if (!el) {
    el = document.createElement("div");
    el.id = "actionHint";
    el.className = "np-hint";
    el.style.marginTop = "6px";
    row.insertAdjacentElement("afterend", el);
  }

  setText(el, msg || "");

  const ms = (typeof opts === "number")
    ? opts
    : (opts && typeof opts.autoClearMs === "number" ? opts.autoClearMs : 2500);

  if (msg && ms > 0) {
    const token = ++_statusToken;
    setTimeout(() => {
      if (_statusToken === token && getText(el) === (msg || "")) setText(el, "");
    }, ms);
  }
}

function ensureDraftPanelOpenAINote() {
  // Draft panel başlığını nokta atışı bul (senin HTML: <div class="np-section-title">Draft News – ...</div>)
  const titleEl = Array.from(document.querySelectorAll(".np-section-title"))
    .find(el => (el.textContent || "").trim() === "Draft News – Headlines, Spots/Keylines and Quotes");

  if (!titleEl) return;

  // Not elemanı yoksa oluştur
  let note = document.getElementById("draftOpenaiNote");
  if (!note) {
    note = document.createElement("div");
    note.id = "draftOpenaiNote";
    note.className = "np-hint";
    note.style.marginTop = "6px";
    note.style.fontSize = "12px";
    note.style.opacity = "0.85";

    // BAŞLIĞIN HEMEN ALTINA KOY
    titleEl.insertAdjacentElement("afterend", note);
  }

  // Gate: hide OpenAI note entirely when not Trial/Pro
  if (!isOpenAITrialOrProEnabled()) {
  note.style.display = "none";
  return;
}

  // i18n text
  let txt = "More headlines, spots/keylines and quotes are available only with the OpenAI option.";
  try {
    if (typeof getCurrentI18n === "function") {
      const i18n = getCurrentI18n();
      if (i18n && typeof i18n.t === "function") {
        const v = i18n.t("Draft panel OpenAI note");
        if (v && v !== "Draft panel OpenAI note") txt = v;
      }
    }
  } catch (e) {}

  // Engine + key durumuna göre göster/gizle:
  // - Local AI seçiliyse göster
  // - OpenAI seçili ama key yoksa göster
  // - OpenAI seçili ve key varsa gizle
  const openAiRadio = document.querySelector('input[name="engine"][value="openai"]');
  const isOpenAI = !!openAiRadio && !!openAiRadio.checked;

  const key = (typeof getApiKey === "function") ? String(getApiKey() || "").trim() : "";
  const shouldShow = (!isOpenAI) || (isOpenAI && !key);

  note.style.display = shouldShow ? "block" : "none";
  if (shouldShow) setText(note, txt);
}


// Static info hint shown under the Final panel action buttons (Precheck/Grammar)
function ensureFinalButtonsInfoHint() {
  const btn = $("btnPrecheck") || $("btnGrammar") || $("btnBuildFinal") || $("btnCopyFinal") || $("btnShareFinal");
  if (!btn) return;

  const row = btn.closest(".np-row") || btn.parentElement;
  if (!row) return;

  let el = document.getElementById("finalButtonsInfoHint");
  if (!el) {
    el = document.createElement("div");
    el.id = "finalButtonsInfoHint";
    el.className = "np-hint";
    el.style.marginTop = "6px";
    row.insertAdjacentElement("afterend", el);
  }

  // i18n (fallback to EN)
  let txt = isOpenAITrialOrProEnabled()
    ? "Precheck runs locally (offline) and checks for missing fields/placeholders. Grammar requires an OpenAI API key and works online."
    : "Precheck runs locally (offline) and checks for missing fields/placeholders. Online Grammar is available only in Pro.";
  try {
    if (typeof getCurrentI18n === "function") {
      const i18n = getCurrentI18n();
      if (i18n && typeof i18n.t === "function") {
        const v = i18n.t("Final buttons note (Precheck/Grammar)");
        if (v && v !== "Final buttons note (Precheck/Grammar)") txt = v;
      }
    }
  } catch (e) {}

  setText(el, txt);
}

// ---------- OpenAI Key Setup Modal ----------
function openKeyModal() {
  // In Basic, show license modal instead of silently doing nothing.
  if (!isOpenAITrialOrProEnabled()) {
    openLicenseModal();
    return;
  }
  const overlay = $("keyModalOverlay");
  const inp = $("inpKeyModal");
  const msg = $("keyModalMsg");

  if (!overlay || !inp) return;

  // Panel açılırken kullanıcıya nereye kaydedileceğini söyle
  if (msg) msg.textContent = tKey("Your key will be stored on this device.");

  // Uzun açıklama (Transcript Speech vb.) — alttaki hint div’ini i18n’e bağla
  const mainHint = document.getElementById("keyModalMainHint");
  if (mainHint) {
    mainHint.textContent = tKey(
      "Your key is stored on this device. It is used for OpenAI news generation, “Transcript Speech”, and live transcription."
    );
  }

  // Prefer speech key if present, otherwise news key
  const existing = String(getSpeechKey() || getApiKey() || "").trim();
  inp.value = existing;

  overlay.style.display = "block";
  inp.focus();
}



function closeKeyModal() {
  const overlay = $("keyModalOverlay");
  if (overlay) overlay.style.display = "none";
}

function wireKeyModal() {
  const overlay = $("keyModalOverlay");
  const box = $("keyModalBox");
  const btnClose = $("btnKeyModalClose");
  const btnSave = $("btnKeyModalSave");
  const btnDel = $("btnKeyModalDelete");
  const inp = $("inpKeyModal");
  const msg = $("keyModalMsg");

  if (!overlay || !box || !btnClose || !btnSave || !btnDel || !inp) return;

  btnClose.addEventListener("click", closeKeyModal);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeKeyModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.style.display !== "none") closeKeyModal();
  });

  btnSave.addEventListener("click", () => {
    if (!isOpenAITrialOrProEnabled()) {
  statusAction(tKey("Pro required: key setup is disabled."), { autoClearMs: 4500 });
  return;
}
    const v = String(inp.value || "").trim();
    if (!v) {
      if (msg) msg.textContent = "Please paste your OpenAI API key.";
      return;
    }

    // Single source of truth: save to BOTH stores so existing STT/news flows continue
    setApiKey(v);
    setSpeechKey(v);
 
        // Key kaydedildiği an OpenAI varsayılan olsun (ama kullanıcı sonra Local seçebilsin)
    setState({ ui: { ...(getState().ui || {}), engine: "openai" } });

 
    if (msg) msg.textContent = "Saved ✓ Your key is stored on this device.";
    statusAction(tKey("Saved ✓ Your key is stored on this device."), { autoClearMs: 2500 });
    renderSettings();
    ensureDraftPanelOpenAINote();
  });

  btnDel.addEventListener("click", () => {
    if (!isOpenAITrialOrProEnabled()) {
      statusAction(tKey("Pro required: key setup is disabled."), { autoClearMs: 4500 });
      return;
    }
    removeApiKey();
    removeSpeechKey();

    inp.value = "";
    if (msg) msg.textContent = "Deleted. This device no longer has a saved key.";
    statusAction(tKey("API key deleted."), { autoClearMs: 2500 });
    renderSettings();
  });
}

// ---------- /OpenAI Key Setup Modal End----------


// ---------- Share Center (Electron-safe; no WebShare dependency)

let __shareCenterText = "";

function openExternal(url) {
  if (!url) return;

  try {
    if (window.np && typeof window.np.openExternal === "function") {
      window.np.openExternal(url);
      return;
    }
  } catch (_) {}

  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (_) {}
}

function applyShareCenterLanguage(overlay) {
  try {
    if (!overlay) return;

    const title = overlay.querySelector("#shareCenterTitle");
    if (title) title.textContent = tKey("Share Center");

    const note = overlay.querySelector("#shareCenterNote");
    if (note) note.textContent = tKey("Final text is copied. Choose where to share:");

    const foot = overlay.querySelector("#shareCenterFoot");
    if (foot) {
      foot.textContent = tKey("If a target opens in browser, it's normal on desktop. Text is already copied.");
    }

    overlay.querySelectorAll("button[data-label-key]").forEach((btn) => {
      const key = btn.getAttribute("data-label-key");
      if (key) btn.textContent = tKey(key);
    });
  } catch (_) {}
}

function ensureShareCenterModal() {
  let overlay = document.getElementById("shareCenterOverlay");
  if (overlay) {
    try { applyShareCenterLanguage(overlay); } catch (_) {}
    return overlay;
  }

  overlay = document.createElement("div");
  overlay.id = "shareCenterOverlay";
  overlay.style.position = "fixed";
  overlay.style.left = "0";
  overlay.style.top = "0";
  overlay.style.right = "0";
  overlay.style.bottom = "0";
  overlay.style.background = "rgba(0,0,0,0.55)";
  overlay.style.display = "none";
  overlay.style.zIndex = "9999";

  const box = document.createElement("div");
  box.id = "shareCenterBox";
  box.style.position = "absolute";
  box.style.left = "50%";
  box.style.top = "50%";
  box.style.transform = "translate(-50%, -50%)";
  box.style.width = "min(560px, 92vw)";
  box.style.background = "#111";
  box.style.border = "1px solid rgba(255,255,255,0.12)";
  box.style.borderRadius = "10px";
  box.style.boxShadow = "0 12px 40px rgba(0,0,0,0.5)";
  box.style.padding = "14px";

  const head = document.createElement("div");
  head.style.display = "flex";
  head.style.alignItems = "center";
  head.style.justifyContent = "space-between";
  head.style.gap = "10px";

  const title = document.createElement("div");
  title.id = "shareCenterTitle";
  title.textContent = tKey("Share Center");
  title.style.fontWeight = "700";
  title.style.color = "#fff";

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "✕";
  close.style.border = "0";
  close.style.background = "transparent";
  close.style.color = "#fff";
  close.style.fontSize = "18px";
  close.style.cursor = "pointer";
  close.addEventListener("click", () => {
    overlay.style.display = "none";
  });

  head.appendChild(title);
  head.appendChild(close);

  const note = document.createElement("div");
  note.id = "shareCenterNote";
  note.style.marginTop = "10px";
  note.style.color = "rgba(255,255,255,0.85)";
  note.style.fontSize = "13px";
  note.textContent = tKey("Final text is copied. Choose where to share:");

  const grid = document.createElement("div");
  grid.style.marginTop = "12px";
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "1fr 1fr";
  grid.style.gap = "10px";

  function mkBtn(labelKey, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.labelKey = labelKey;
    b.textContent = tKey(labelKey);
    b.style.padding = "10px 12px";
    b.style.borderRadius = "8px";
    b.style.border = "1px solid rgba(255,255,255,0.14)";
    b.style.background = "rgba(255,255,255,0.06)";
    b.style.color = "#fff";
    b.style.cursor = "pointer";
    b.addEventListener("click", onClick);
    return b;
  }

  const btnEmail = mkBtn("Email (default app)", () => {
    const t = __shareCenterText || "";
    const subj = encodeURIComponent("AI-NewsPilot Final News");
    const body = encodeURIComponent(t);
    openExternal(`mailto:?subject=${subj}&body=${body}`);
  });

  const btnWhatsApp = mkBtn("WhatsApp", () => {
    const t = __shareCenterText || "";
    openExternal(`https://wa.me/?text=${encodeURIComponent(t)}`);
  });

  const btnTelegram = mkBtn("Telegram", () => {
    const t = __shareCenterText || "";
    openExternal(`https://t.me/share/url?text=${encodeURIComponent(t)}`);
  });

  const btnX = mkBtn("X (Twitter)", () => {
    const t = __shareCenterText || "";
    openExternal(`https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}`);
  });

  const btnLinkedIn = mkBtn("LinkedIn (text already copied)", () => {
    openExternal("https://www.linkedin.com/feed/");
  });

  const btnClose2 = mkBtn("Close", () => {
    overlay.style.display = "none";
  });

  grid.appendChild(btnEmail);
  grid.appendChild(btnWhatsApp);
  grid.appendChild(btnTelegram);
  grid.appendChild(btnX);
  grid.appendChild(btnLinkedIn);
  grid.appendChild(btnClose2);

  const foot = document.createElement("div");
  foot.id = "shareCenterFoot";
  foot.style.marginTop = "10px";
  foot.style.color = "rgba(255,255,255,0.65)";
  foot.style.fontSize = "12px";
  foot.textContent = tKey("If a target opens in browser, it's normal on desktop. Text is already copied.");

  box.appendChild(head);
  box.appendChild(note);
  box.appendChild(grid);
  box.appendChild(foot);

  overlay.appendChild(box);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.style.display = "none";
  });

  document.body.appendChild(overlay);

  try { applyShareCenterLanguage(overlay); } catch (_) {}

  return overlay;
}

async function openShareCenterWithFinalText() {
  const st = getState();
  const text =
    (getText($("finalOutput")) || st.final?.text || "").trim() ||
    (getText($("draftOutput")) || st.draft?.text || "").trim();

  if (!text) {
    statusAction(tKey("Nothing to share."), { autoClearMs: 3000 });
    return;
  }

  let copied = false;
  try {
    copied = await copyFinal();
  } catch (_) {}

  __shareCenterText = text;

  const overlay = ensureShareCenterModal();
  if (overlay) {
    try { applyShareCenterLanguage(overlay); } catch (_) {}
    overlay.style.display = "block";
  }

  statusAction(
    copied
      ? tKey("Copied. Share Center opened.")
      : tKey("Share Center opened."),
    { autoClearMs: 3500 }
  );
}

// ---------- /Share Center ----------


// ---------- /Share Center ----------
function precheckHint(msg) {
  setText($("precheckHint"), msg || "");
  const stNow = (typeof getState === "function") ? (getState() || {}) : {};
  setState({ ui: { ...(stNow.ui || {}), precheckHint: msg || "" } });
}

function getSavedLanguage() {
  try {
    const v = localStorage.getItem("np_lang");
    return v || null;
  } catch (_) {
    return null;
  }
}

async function applyLanguage(code){
  // State güvenli oku
  const st = (typeof getState === "function" ? (getState() || {}) : {});
  // localStorage'dan da fallback dene
  const fallback = getSavedLanguage() || "en";
  const next = code || st.language || fallback;

    // state'e yaz (sadece dili güncelle; başka state alanlarını ezme)
  if (typeof setState === "function") {
    setState({ language: next });
  }

  // localStorage'a yaz
  try {
    localStorage.setItem("np_lang", next);
  } catch (_) {}

  await loadI18n(next);

  // Dil değiştikten sonra dinamik metinleri güncelle
  try { refreshLanguageDependentHints(); } catch (_) {}
  try { renderOutputFromActive(); } catch (_) {}
}


function refreshLanguageDependentHints() {
  // Engine altındaki Local AI ipucu
  try {
    const hint = document.querySelector(".np-engine-hint");
    if (hint && typeof getCurrentI18n === "function") {
      const snap = getCurrentI18n();
      if (snap && typeof snap.t === "function") {
        const v = snap.t("Local AI short hint under engine");
        if (v && v !== "Local AI short hint under engine") {
          hint.textContent = v;
        }
      }
    }
  } catch (_) {
    // UI hiçbir zaman çökmesin
  }

  // Taslak panelindeki OpenAI notu ve alt buton açıklaması da dile duyarlı:
  try { ensureDraftPanelOpenAINote(); } catch (_) {}
  try { ensureFinalButtonsInfoHint(); } catch (_) {}
}

function renderLang() {
  const sel = $("selLang");
  if (!sel) return;

  // getState() her zaman varmış gibi davranmayalım
  const st = (typeof getState === "function" ? (getState() || {}) : {});
  const list = st.languageList || getLangList();

  // Dil kodlarına göre sabit İngilizce adlar
  const EN_NAMES = {
    "en": "English",

    // Hem tireli hem alt çizgili kodları kapsa
    "en-GB": "English (UK)",
    "en-US": "English (US)",
    
    "de": "German",
    "fr": "French",
    "es": "Spanish",
    "it": "Italian",
    "pt": "Portuguese",
    "ru": "Russian",
    "ar": "Arabic",
    "zh": "Chinese",
    "ja": "Japanese",
    "hi": "Hindi",
    "da": "Danish",
    "sv": "Swedish",
    "nl": "Dutch",
    "no": "Norwegian",
    "pl": "Polish",
    "tr": "Turkish"
    // Diğer kodlar için list'teki name veya code kullanılacak
  };

  // HER çağrıda listeyi baştan oluştur: önce temizle
  sel.innerHTML = "";

  list.forEach(({ code, name }) => {
    const opt = document.createElement("option");
    opt.value = code;
    // Menüde her zaman sabit İngilizce ad göster:
    opt.textContent = EN_NAMES[code] || name || code;
    sel.appendChild(opt);
  });

  // Seçili kod: önce localStorage (np_lang), yoksa state.language, yoksa "en"
  let effective = "en";

  try {
    if (typeof getSavedLanguage === "function") {
      const saved = getSavedLanguage();
      if (saved && typeof saved === "string") {
        effective = saved;
      } else if (st.language && typeof st.language === "string") {
        effective = st.language;
      }
    } else if (st.language && typeof st.language === "string") {
      effective = st.language;
    }
  } catch (_) {
    if (st.language && typeof st.language === "string") {
      effective = st.language;
    }
  }

  sel.value = effective;
}




function renderSettings() {
  const st = getState();

        // --- Engine: startup default + user choice preserved ---
  const hasNewsKey = !!String(getApiKey() || "").trim();

  let engine = st.ui && st.ui.engine;

  // 1) App boot anında: sadece PRO ise OpenAI'yi otomatik seç; değilse Local
const pro = isOpenAITrialOrProEnabled(); // Trial or paid Pro

if (!__engineBootDone) {
  engine = (pro && hasNewsKey) ? "openai" : "local";
  __engineBootDone = true;
}

// Lisans yoksa OpenAI seçimine izin verme (key olsa bile)
if (!pro && engine === "openai") {
  engine = "local";
}

// Pro var ama key yoksa Local
if (pro && engine === "openai" && !hasNewsKey) {
  engine = "local";
}

  // State içindeki ui.engine değeri ile senkron tut
  if (!st.ui || st.ui.engine !== engine) {
    setState({
      ui: {
        ...(st.ui || {}),
        engine
      }
    });
  }

    const radios = document.querySelectorAll('input[name="engine"]');
  radios.forEach((r) => {
    r.checked = (r.value === engine);
  });



  // --- PRO GATE: hide OpenAI + STT UI when not Trial/Pro ---
  try {
    // Hide OpenAI engine option entirely when not Trial/Pro
        const rOpen = document.querySelector('input[name="engine"][value="openai"]');
    if (rOpen) {
      const host = rOpen.closest("label") || rOpen.parentElement;
      if (host) {
        host.style.display = "";
        host.style.opacity = "1";
      }
      rOpen.disabled = false;
    }

    const rLocal = document.querySelector('input[name="engine"][value="local"]');
    if (rLocal) {
      const hostL = rLocal.closest("label") || rLocal.parentElement;
      if (hostL) {
        hostL.style.display = "";
        hostL.style.opacity = "1";
      }
      rLocal.disabled = false;
    }


    // Key setup controls (news + STT share the same modal)
        // Key setup controls must stay visible in Basic too.
    setClosestVisible($("btnKeySetupNews"), true);
    setClosestVisible($("btnKeySetupSpeech"), true);
    setVisible($("btnSpeechDelKey"), pro);

    if (!pro) {
      setVisible($("keyStatusNews"), false);
      setVisible($("keyStatusSpeech"), false);
    }

    // STT auto-transcribe checkbox
    const chk = $("chkAutoTranscribe");
    if (chk) {
      if (!pro) chk.checked = false;
      chk.disabled = !pro;
      // Always visible in Basic, but disabled until Pro is active
      setClosestVisible(chk, true);
      try {
        const host = chk.closest?.(".np-row") || chk.closest?.("label") || chk.parentElement;
        if (host && host.style) host.style.opacity = pro ? "1" : "0.55";
      } catch (_) {}
    }

    // Grammar is OpenAI-based
    const btnG = $("btnGrammar");
    if (btnG) {
      btnG.disabled = !pro;
      setVisible(btnG, pro);
    }

    // Any STT hint
    if (!pro) setVisible($("sttInfoHint"), false);
  } catch (_) {}



  // Generate buton label'ı engine ve hasGenerated'a göre güncellensin
  updateGenerateButtonLabel();

  // Style/Tone/Length
  const selStyle = $("styleSelect");
  const style = st.ui?.style || "newspaper";

  const selTone = $("selTone");
  if (selTone) selTone.value = String(st.ui.tone || 2);

  const selLen = $("selLength");
  if (selLen) selLen.value = st.ui.lengthPreset || "medium";

  const inpWords = $("inpTargetWords");
  if (inpWords) inpWords.value = st.ui.targetWords ?? "";

  // Author / Dateline
  const inpDateline = $("inpDateline");
  if (inpDateline) inpDateline.value = st.inputs.authorLocation || "";

  const inpAuthorName = $("inpAuthorName");
  if (inpAuthorName) inpAuthorName.value = st.inputs.authorName || "";

  // 5W1H
  const w = st.inputs.w5h1 || {};
  if ($("inpWho")) $("inpWho").value = w.who || "";
  if ($("inpWhat")) $("inpWhat").value = w.what || "";
  if ($("inpWhen")) $("inpWhen").value = w.when || "";
  if ($("inpWhere")) $("inpWhere").value = w.where || "";
  if ($("inpWhy")) $("inpWhy").value = w.why || "";
  if ($("inpHow")) $("inpHow").value = w.how || "";

  // Source input
  const src = $("txtSource");
  if (src) src.value = st.inputs.sourceText || "";

      // Keys — visibility rules requested by Deniz
  const hasNews = !!String(getApiKey() || "").trim();
  const hasSpeech = !!String(getSpeechKey() || "").trim();
  const hasAnyKey = hasNews || hasSpeech;


  // STT intent
  const autoEl = $("chkAutoTranscribe");
  const wantsAutoSTT = !!(autoEl && autoEl.checked);

  // --- News key status: only when OpenAI selected AND missing key
  const elNews = $("keyStatusNews");
  if (elNews) {
    if (pro && engine === "openai" && !hasNews) {
      elNews.style.display = "block";
      elNews.textContent = "OpenAI key not added. Click Setup.";
    } else {
      elNews.style.display = "none";
      elNews.textContent = "";
    }
  }

  // --- STT info hint: show only while transcribing (or when auto-transcribe is ON AND a recording exists)
const sttInfo = $("sttInfoHint");
if (sttInfo) {
  const st2 = getState();
  const hasRecordings = Array.isArray(st2.voices) && st2.voices.length > 0;
  const isTranscribing = /Transcrib/i.test(String(st2.ui?.status || ""));
  sttInfo.style.display = (pro && (isTranscribing || (wantsAutoSTT && hasRecordings))) ? "block" : "none";
}

  // --- Speech key status:
  // show only if user intends transcription (auto ON) AND no key exists
  const elSpeech = $("keyStatusSpeech");
  if (elSpeech) {
    if (pro && wantsAutoSTT && !hasAnyKey) {
      elSpeech.style.display = "block";
      elSpeech.textContent = "OpenAI key not added. Required for transcription. Click Setup.";
    } else {
      elSpeech.style.display = "none";
      elSpeech.textContent = "";
    }
  }


    // Draft/Final
  const draftEl = $("draftOutput");
  if (draftEl && typeof st.draft?.text === "string") draftEl.value = st.draft.text || "";

  const finalEl = $("finalOutput");
  if (finalEl && typeof st.final?.text === "string") finalEl.value = st.final.text || "";

      // License / Pro: reflect activation state on button
  const btnUpgrade = $("btnUpgrade");
  if (btnUpgrade) {
    const paid = isProEnabled(); // license.js içindeki gerçek Pro durumu

    // Buton her zaman görünsün, sadece başlık (title) durumu anlatsın
    btnUpgrade.style.display = "";
    btnUpgrade.disabled = false;
    btnUpgrade.textContent = tKey("Activate");

    if (paid) {
      // Pro aktif → tooltip durumu anlatsın
      btnUpgrade.title = tKey("License active on this device.");
    } else {
      // Pro pasif → klasik Activate açıklaması
      btnUpgrade.title = tKey("Activate Pro");
    }
  }
}


function renderVersions() {
  const tabs = $("versionsTabs");
  if (!tabs) return;

  const st = getState();
  const items = st.versions.items || [];
  tabs.innerHTML = "";

  if (items.length === 0) {
    tabs.textContent = "";
    return;
  }


  items.forEach((_, i) => {
    const b = document.createElement("button");
    b.className = "btn btn-secondary np-vtab";
    b.type = "button";
    b.textContent = `V${i + 1}`;
    if (i === st.versions.activeIndex) b.style.borderColor = "var(--warn)";
    b.addEventListener("click", () => {
      setActiveVersion(i);
      renderOutputFromActive();
      renderVersions();
    });
    tabs.appendChild(b);
  });
}

function buildDraftTextFromPackage(pkg){
  if (!pkg || !pkg.outputs) return "";
  const o = pkg.outputs;
  const lines = [];

  if (o.topHeadline) lines.push(o.topHeadline);
    const sub = String(
    Array.isArray(o.subheadline) ? (o.subheadline.join("\n") || "") : (o.subheadline || "")
  ).trim();
  if (sub) lines.push(sub);

  if (Array.isArray(o.spots) && o.spots.length) {
    lines.push("");
    lines.push(tKey("SPOTS:"));
    o.spots.forEach((s) => lines.push(`- ${s}`));
  }

  if (Array.isArray(o.quotes) && o.quotes.length) {
    lines.push("");
    lines.push(tKey("QUOTES:"));
    o.quotes.forEach((q) => lines.push(`- ${q}`));
  }

  if (o.bodyText) {
    lines.push("");
    lines.push(o.bodyText);
  }

  return lines.join("\n").trim();
}

function renderOutputFromActive() {
  const pkg = getActivePackage();

  // Render selectable options (Panel-2 top area) when choices exist
  if (pkg && pkg.choices && Array.isArray(pkg.choices.items)) {
    renderDraftOptionsFromActive();

    const bodyItem = pkg.choices.items.find((it) => String(it.id) === "body");
    let bodyText = bodyItem
      ? String(bodyItem.text || "")
      : String(pkg.outputs?.bodyText || pkg.outputs?.body || "");

    // --- OpenAI: Yazar adı + lokasyon/dateline'ı gövdenin en üstünde garanti göster
    try {
      const st = getState();
      const engineUsed = String(pkg.engineUsed || st?.ui?.engine || "").toLowerCase();
      if (engineUsed === "openai") {
        const name = String(st?.inputs?.authorName || "").trim();
        const loc  = String(st?.inputs?.authorLocation || "").trim();

        if (name || loc) {
  let header = "";
  if (name && loc) header = `${name} — ${loc}`;
  else if (name) header = `${name}`;
  else header = `${loc}`;

          const firstLine = String(bodyText || "").split(/\r?\n/)[0].trim().toLowerCase();
          const headerLc = header.trim().toLowerCase();

          const already =
            firstLine === headerLc ||
            firstLine.startsWith(headerLc) ||
            (name && firstLine.includes(name.toLowerCase()) && (loc ? firstLine.includes(loc.toLowerCase()) : true));

          if (!already) {
            bodyText = `${header}\n\n${String(bodyText || "").trim()}`.trim();
            if (bodyItem) bodyItem.text = bodyText;
          }
        }
      }
    } catch (_) {}

    setText($("draftOutput"), bodyText);
    setState({ draft: { text: bodyText } });
    return;
  }

  // Fallback: classic single textarea draft
  renderDraftOptionsFromActive();
  const draftText = buildDraftTextFromPackage(pkg);
  setText($("draftOutput"), draftText);
  setState({ draft: { text: draftText } });
}


function renderVoices() {
  const list = $("voiceList");
  if (!list) return;

  const pro = isOpenAITrialOrProEnabled();

  const st = getState();
  const items = Array.isArray(st.voices) ? st.voices : [];

  list.innerHTML = "";

  if (items.length === 0) {
    const p = document.createElement("p");
    p.className = "np-muted";
    p.textContent = "No recordings yet.";
    list.appendChild(p);
    return;
  }

  // Build per-base sequential numbers (oldest=1) while keeping current display order
  const baseOf = (it) => {
    const raw = String(it.label || "").trim();
    if (raw && raw !== "Speech" && raw !== "clip") return raw;
    const fn = String(it.filename || "").trim();
    return fn ? fn.replace(/\.[a-z0-9]+$/i, "") : "Clip";
  };

  const parseWhen = (it) => {
    const t = Date.parse(String(it.when || ""));
    return Number.isFinite(t) ? t : 0;
  };

  const groups = new Map();
  items.forEach((it) => {
    const b = baseOf(it);
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push(it);
  });

  const seqById = new Map();
  groups.forEach((arr, b) => {
    arr
      .slice()
      .sort((a, c) => parseWhen(a) - parseWhen(c)) // oldest first
      .forEach((it, idx) => {
        seqById.set(it.id, { base: b, n: idx + 1, total: arr.length });
      });
  });

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "np-voice-row";

    const meta = document.createElement("div");
    meta.className = "np-voice-meta";
    const title = document.createElement("div");
    title.className = "np-voice-title";
    const s = seqById.get(item.id) || { base: (item.label || "Speech"), n: 1, total: 1 };
    const shownName = s.total > 1 ? `${s.base} (${s.n})` : s.base;
    title.textContent = `S${items.indexOf(item) + 1}  ${shownName}`;

    const small = document.createElement("div");
    small.className = "np-small";
    small.textContent = item.when || "";
    meta.appendChild(title);
    meta.appendChild(small);

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = item.url;

    const actions = document.createElement("div");
    actions.className = "np-voice-actions";

    {
      const btnTranscript = document.createElement("button");
      btnTranscript.type = "button";
      btnTranscript.className = "btn btn-secondary";
      btnTranscript.textContent = "Transcript Speech";
      if (!pro) {
        btnTranscript.disabled = true;
        btnTranscript.style.opacity = "0.55";
      } else {
        btnTranscript.addEventListener("click", async () => {
          await transcriptAndAppend(item.id);
        });
      }
      actions.appendChild(btnTranscript);
    }

    const btnDownload = document.createElement("button");
    btnDownload.type = "button";
    btnDownload.className = "btn btn-secondary";
    btnDownload.textContent = "Save";
    btnDownload.addEventListener("click", async () => {
      if (item.blob) {
        saveAudioBlob(item.blob, item.filename || "speech.wav");
      } else if (item.filePath) {
        status("Saved in app data folder (RecordedVoice).", { autoClearMs: 2000 });
      }
    });

    const btnDelete = document.createElement("button");
    btnDelete.type = "button";
    btnDelete.className = "btn btn-secondary";
    btnDelete.textContent = "Delete";
    btnDelete.addEventListener("click", async () => {
      await deleteRecording(item.id);
    });

    actions.appendChild(btnDownload);
    actions.appendChild(btnDelete);

    row.appendChild(meta);
    row.appendChild(audio);
    row.appendChild(actions);

    list.appendChild(row);
  });
}

async function loadRecordingsFromDisk(){
  if (!window.np || !window.np.listRecordings) return;
  try {
    const arr = await window.np.listRecordings();
    const items = (arr || []).slice(0, 50).map((r) => ({
      id: r.id,
      label: r.name || r.id,
      filename: r.name || (r.id + ".wav"),
      url: toFileUrl(r.path),
      filePath: r.path,
      blob: null,
      text: "",
      when: r.mtime ? new Date(r.mtime).toLocaleString() : ""
    }));
    setState({ voices: items });
  } catch (e) {
    // non-fatal
  }
}

async function deleteRecording(id){
  const st = getState();
  const items = Array.isArray(st.voices) ? st.voices : [];
  const it = items.find((x) => x.id === id);
  if (!it) return;

  if (it.filePath && window.np && window.np.deleteRecording) {
    try { await window.np.deleteRecording({ filePath: it.filePath }); } catch (_) {}
  }

  const next = items.filter((x) => x.id !== id);
  setState({ voices: next });
  renderVoices();
  status("Deleted.", { autoClearMs: 2000 });
}

async function transcriptAndAppend(id){
  if (!isOpenAITrialOrProEnabled()) {
  status("Pro required: transcription is disabled. Activate Pro to use Speech-to-Text.", { autoClearMs: 4500 });
  return;
}

  const st = getState();
  const items = Array.isArray(st.voices) ? st.voices : [];
  const it = items.find((x) => x.id === id);
  if (!it) return;

  const src = $("txtSource");
  const currentText = src ? (src.value || "") : (st.inputs.sourceText || "");

  if (it.text && it.text.trim()) {
    const appended = (currentText ? currentText.trim() + "\n\n" : "") + it.text.trim();
    if (src) src.value = appended;
    const stNow = getState();
setState({ inputs: { ...(stNow.inputs || {}), sourceText: appended } });
    status("Transcript appended.", { autoClearMs: 2000 });
    return;
  }

// Prefer Speech key if set, but fall back to News key if Speech key fails.
const speechKey = getSpeechKey();
const newsKey = getApiKey();
const normalizeKey = (k) => String(k || "").trim().replace(/[\u200B-\u200D\uFEFF]/g, "");
const keyPrimary = normalizeKey(speechKey || "");
const keyFallback = normalizeKey(newsKey || "");

const key = keyPrimary || keyFallback;
if (!key) {
  const elSpeech = $("keyStatusSpeech");
  if (elSpeech) {
    elSpeech.style.display = "block";
    elSpeech.textContent = "OpenAI key not added. Required for transcription. Click Setup.";
  }
  status("Speech API key missing. Add an OpenAI key first.");
  // Kullanıcıya direkt key girmesi için Setup modalını aç
  openKeyModal();
  return;
}



  if (!window.np || !window.np.openaiTranscribeBytes) {
    status("STT is not available (IPC missing)." );
    return;
  }

  let bytes;
  if (it.blob) {
    bytes = new Uint8Array(await it.blob.arrayBuffer());
  } else if (it.filePath && window.np.readFileBytes) {
    bytes = await window.np.readFileBytes(it.filePath);
  } else {
    status("Audio bytes unavailable for this recording." );
    return;
  }

  status("Transcribing..." );
  try {
    const lang = "auto";

    const filename = (it.filename && String(it.filename).trim()) ? String(it.filename).trim() : "speech.wav";
    const lower = filename.toLowerCase();
    const mimeType =
      (it.meta && it.meta.mimeType ? String(it.meta.mimeType) : "") ||
      (lower.endsWith(".mp3") ? "audio/mpeg" :
       lower.endsWith(".m4a") ? "audio/mp4" :
       lower.endsWith(".mp4") ? "audio/mp4" :
       lower.endsWith(".webm") ? "audio/webm" :
       lower.endsWith(".ogg") ? "audio/ogg" :
       lower.endsWith(".wav") ? "audio/wav" : "audio/wav");

let res = await window.np.openaiTranscribeBytes({
  apiKey: key,
  bytes,
  filename,
  mimeType,
  language: lang
});

// If Speech key is set but invalid/expired, retry once with the News key.
if (res && String(res.error || "") === "http_401" && keyPrimary && keyFallback && key !== keyFallback) {
  res = await window.np.openaiTranscribeBytes({
    apiKey: keyFallback,
    bytes,
    filename,
    mimeType,
    language: lang
  });
}

    const text = (res && res.text) ? String(res.text) : "";
    const err = (res && res.error) ? String(res.error) : "";
    const detail = (res && res.detail) ? String(res.detail) : "";

    if (!text.trim()) {
      // Surface IPC-side errors (main process) to the user; renderer console may be clean otherwise.
      const msg = err ? ("Transcription error: " + err) : "No transcript returned.";
      const more = detail ? (" | " + detail.slice(0, 180)) : "";
      status(msg + more, { autoClearMs: 3500 });
      return;
    }

    it.text = text.trim();
    const next = items.map((x) => x.id === id ? it : x);
    setState({ voices: next });
    renderVoices();

    const appended = (currentText ? currentText.trim() + "\n\n" : "") + it.text;
    if (src) src.value = appended;
    const stNow = getState();
setState({ inputs: { ...(stNow.inputs || {}), sourceText: appended } });
    status("Transcribed and appended.", { autoClearMs: 2000 });
  } catch (e) {
    status("Transcription failed.", { autoClearMs: 2500 });
  }
}

function wireSaveMenu(){
  const btn = $("btnSave");
  const menu = $("saveMenu");
  if (!btn || !menu) return;

  const close = () => { menu.style.display = "none"; };

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    menu.style.display = (menu.style.display === "none" || !menu.style.display) ? "block" : "none";
  });

  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && e.target !== btn) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

// ---------- License / Activate Modal ----------

let __licenseOverlay = null;

function ensureLicenseModal() {
  if (__licenseOverlay) return __licenseOverlay;

  const overlay = document.createElement("div");
  overlay.id = "licenseOverlay";
  overlay.style.position = "fixed";
  overlay.style.left = "0";
  overlay.style.top = "0";
  overlay.style.right = "0";
  overlay.style.bottom = "0";
  overlay.style.background = "rgba(0,0,0,0.55)";
  overlay.style.display = "none";
  overlay.style.zIndex = "9999";

  const box = document.createElement("div");
  box.id = "licenseBox";
  box.style.position = "absolute";
  box.style.left = "50%";
  box.style.top = "50%";
  box.style.transform = "translate(-50%, -50%)";
  box.style.width = "min(620px, 92vw)";
  box.style.background = "#111";
  box.style.border = "1px solid rgba(255,255,255,0.12)";
  box.style.borderRadius = "12px";
  box.style.boxShadow = "0 16px 50px rgba(0,0,0,0.55)";
  box.style.padding = "18px";

  const head = document.createElement("div");
  head.style.display = "flex";
  head.style.alignItems = "center";
  head.style.justifyContent = "space-between";
  head.style.gap = "10px";

  const title = document.createElement("div");
  title.id = "licenseTitle";
  title.textContent = tKey("license_title");
  title.style.fontWeight = "700";
  title.style.fontSize = "18px";
  title.style.color = "#fff";

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "✕";
  close.style.border = "0";
  close.style.background = "transparent";
  close.style.color = "#fff";
  close.style.fontSize = "18px";
  close.style.cursor = "pointer";
  close.addEventListener("click", () => {
    overlay.style.display = "none";
  });

  head.appendChild(title);
  head.appendChild(close);

  const body = document.createElement("div");
  body.style.marginTop = "12px";
  body.style.color = "rgba(255,255,255,0.92)";
  body.style.fontSize = "14px";
  body.style.lineHeight = "1.55";

  const p1 = document.createElement("p");
  p1.id = "licenseP1";
  p1.textContent = "Licenses in this build are managed through Microsoft Store.";

  const p2 = document.createElement("p");
  p2.id = "licenseP2";
  p2.textContent = "Use Refresh License to sync your plan, or buy/renew Basic or Pro at any time.";

  body.appendChild(p1);
  body.appendChild(p2);

  const infoWrap = document.createElement("div");
  infoWrap.id = "licenseInfoWrap";
  infoWrap.style.marginTop = "10px";
  infoWrap.style.padding = "10px";
  infoWrap.style.borderRadius = "8px";
  infoWrap.style.background = "rgba(255,255,255,0.06)";
  infoWrap.style.border = "1px solid rgba(255,255,255,0.10)";

  const infoLine1 = document.createElement("div");
  infoLine1.id = "licenseInfoLine1";
  infoLine1.style.fontSize = "13px";
  infoLine1.style.color = "#fff";
  infoLine1.style.fontWeight = "600";
  infoLine1.textContent = "Choose or renew a plan.";

  const infoLine2 = document.createElement("div");
  infoLine2.id = "licenseInfoLine2";
  infoLine2.style.marginTop = "6px";
  infoLine2.style.fontSize = "12px";
  infoLine2.style.opacity = "0.88";
  infoLine2.style.color = "#ddd";
  infoLine2.textContent = "Basic unlocks offline/core features. Pro unlocks AI and speech features.";

  infoWrap.appendChild(infoLine1);
  infoWrap.appendChild(infoLine2);
  body.appendChild(infoWrap);

  const actions = document.createElement("div");
  actions.style.marginTop = "16px";
  actions.style.display = "flex";
  actions.style.flexWrap = "wrap";
  actions.style.gap = "10px";
  actions.style.justifyContent = "flex-end";

  function mkBtn(label) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.padding = "8px 14px";
    b.style.borderRadius = "8px";
    b.style.border = "1px solid rgba(255,255,255,0.16)";
    b.style.background = "rgba(255,255,255,0.10)";
    b.style.color = "#fff";
    b.style.cursor = "pointer";
    return b;
  }

  function setLicenseModalInfo(line1, line2) {
    const info1 = document.getElementById("licenseInfoLine1");
    const info2 = document.getElementById("licenseInfoLine2");
    if (info1) info1.textContent = line1 || "";
    if (info2) info2.textContent = line2 || "";
  }

  const btnLater = mkBtn(tKey("license_btn_later"));
  btnLater.id = "licenseBtnLater";
  btnLater.addEventListener("click", () => {
    overlay.style.display = "none";
  });

  const btnRefresh = mkBtn("Refresh License");
  btnRefresh.id = "licenseBtnRefresh";

  const btnBasic = mkBtn("Buy / Renew Basic");
  btnBasic.id = "licenseBtnBasic";

  const btnPro = mkBtn("Buy / Renew Pro");
  btnPro.id = "licenseBtnPro";
  btnPro.style.borderColor = "var(--warn, #f6b26b)";
  btnPro.style.background = "var(--warn, #f6b26b)";
  btnPro.style.color = "#000";
  btnPro.style.fontWeight = "600";

  btnRefresh.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    btnRefresh.disabled = true;
    btnBasic.disabled = true;
    btnPro.disabled = true;

    try {
      const res = await refreshStoreLicenseStatus();

      if (!res || !res.ok) {
        const msg = res?.error || "License refresh failed.";
        setLicenseModalInfo("License check failed.", msg);
        status(msg, { autoClearMs: 3000 });
        return;
      }

      refreshLicenseStateFromStorage();

      const tierMsg =
        res.tier === "pro"
          ? "Current plan: Pro"
          : res.tier === "basic"
            ? "Current plan: Basic"
            : "No active paid license found.";

      const detailMsg =
        res.tier === "pro"
          ? (res.proExpiresISO
              ? `Pro is active. Expires: ${res.proExpiresISO}`
              : "Pro is active.")
          : res.tier === "basic"
            ? (res.basicExpiresISO
                ? `Basic is active. Expires: ${res.basicExpiresISO}`
                : "Basic is active.")
            : "No active paid license found. You can buy or renew Basic or Pro below.";

      setLicenseModalInfo(tierMsg, detailMsg);
      status(detailMsg, { autoClearMs: 2500 });
      renderSettings();
    } finally {
      btnRefresh.disabled = false;
      btnBasic.disabled = false;
      btnPro.disabled = false;
    }
  });

  btnBasic.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    btnRefresh.disabled = true;
    btnBasic.disabled = true;
    btnPro.disabled = true;

    try {
      const res = await purchaseBasicLicense();

      if (!res || !res.ok) {
        const msg = res?.error || "Basic purchase failed.";
        setLicenseModalInfo("Basic purchase failed.", msg);
        status(msg, { autoClearMs: 3000 });
        return;
      }

      refreshLicenseStateFromStorage();

      const detailMsg = res.basicExpiresISO
        ? `Basic is active. Expires: ${res.basicExpiresISO}`
        : "Basic is active.";

      setLicenseModalInfo("Current plan: Basic", detailMsg);
      status("Basic activated.", { autoClearMs: 2500 });
      renderSettings();
    } finally {
      btnRefresh.disabled = false;
      btnBasic.disabled = false;
      btnPro.disabled = false;
    }
  });

  btnPro.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    btnRefresh.disabled = true;
    btnBasic.disabled = true;
    btnPro.disabled = true;

    try {
      const res = await purchaseProLicense();

      if (!res || !res.ok) {
        const msg = res?.error || "Pro purchase failed.";
        setLicenseModalInfo("Pro purchase failed.", msg);
        status(msg, { autoClearMs: 3000 });
        return;
      }

      refreshLicenseStateFromStorage();

      const detailMsg = res.proExpiresISO
        ? `Pro is active. Expires: ${res.proExpiresISO}`
        : "Pro is active.";

      setLicenseModalInfo("Current plan: Pro", detailMsg);
      status("Pro activated.", { autoClearMs: 2500 });
      renderSettings();
    } finally {
      btnRefresh.disabled = false;
      btnBasic.disabled = false;
      btnPro.disabled = false;
    }
  });

  actions.appendChild(btnLater);
  actions.appendChild(btnRefresh);
  actions.appendChild(btnBasic);
  actions.appendChild(btnPro);

  box.appendChild(head);
  box.appendChild(body);
  box.appendChild(actions);

  box.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  overlay.appendChild(box);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.style.display = "none";
  });

  document.body.appendChild(overlay);
  __licenseOverlay = overlay;
  return overlay;
}

function openLicenseModal() {
  const overlay = ensureLicenseModal();

  try {
    const t = (k) => tKey(k);

    const elTitle = document.getElementById("licenseTitle");
    if (elTitle) elTitle.textContent = t("license_title");

    const elP1 = document.getElementById("licenseP1");
    if (elP1) {
      elP1.textContent = "Licenses in this build are managed through Microsoft Store.";
    }

    const elP2 = document.getElementById("licenseP2");
    if (elP2) {
      elP2.textContent = "Use Refresh License to sync your plan, or buy/renew Basic or Pro at any time.";
    }

    const info1 = document.getElementById("licenseInfoLine1");
    const info2 = document.getElementById("licenseInfoLine2");
    const st = getLicenseStatus();

    if (info1) {
      info1.textContent =
        st?.tier === "pro"
          ? "Current plan: Pro"
          : st?.tier === "basic"
            ? "Current plan: Basic"
            : "Choose or renew a plan.";
    }

    if (info2) {
      info2.textContent = "Basic unlocks offline/core features. Pro unlocks AI and speech features.";
    }

    const bLater = document.getElementById("licenseBtnLater");
    if (bLater) bLater.textContent = t("license_btn_later");

    const bRefresh = document.getElementById("licenseBtnRefresh");
    if (bRefresh) bRefresh.textContent = "Refresh License";

    const bBasic = document.getElementById("licenseBtnBasic");
    if (bBasic) bBasic.textContent = "Buy / Renew Basic";

    const bPro = document.getElementById("licenseBtnPro");
    if (bPro) bPro.textContent = "Buy / Renew Pro";
  } catch (_) {}

  overlay.style.display = "block";
}

// ---------- Docs / About Modal (in-app; no window.open) ----------

let __docsOverlay = null;

function ensureDocsModal() {
  if (__docsOverlay) return __docsOverlay;

  const overlay = document.createElement("div");
  overlay.id = "docsOverlay";
  overlay.style.position = "fixed";
  overlay.style.left = "0";
  overlay.style.top = "0";
  overlay.style.right = "0";
  overlay.style.bottom = "0";
  overlay.style.background = "rgba(0,0,0,0.55)";
  overlay.style.display = "none";
  overlay.style.zIndex = "9999";

  const box = document.createElement("div");
  box.id = "docsBox";
  box.style.position = "absolute";
  box.style.left = "50%";
  box.style.top = "50%";
  box.style.transform = "translate(-50%, -50%)";
  box.style.width = "min(980px, 94vw)";
  box.style.height = "min(86vh, 920px)";
  box.style.background = "#0f0f0f";
  box.style.border = "1px solid rgba(255,255,255,0.12)";
  box.style.borderRadius = "12px";
  box.style.boxShadow = "0 16px 50px rgba(0,0,0,0.55)";
  box.style.display = "flex";
  box.style.flexDirection = "column";
  box.style.overflow = "hidden";

  const head = document.createElement("div");
  head.style.display = "flex";
  head.style.alignItems = "center";
  head.style.justifyContent = "space-between";
  head.style.gap = "10px";
  head.style.padding = "10px 12px";
  head.style.borderBottom = "1px solid rgba(255,255,255,0.10)";

  const title = document.createElement("div");
  title.textContent = "About / Docs";
  title.style.fontWeight = "700";
  title.style.color = "#fff";

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  actions.style.alignItems = "center";

  function mkBtn(label) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.border = "1px solid rgba(255,255,255,0.14)";
    b.style.background = "rgba(255,255,255,0.06)";
    b.style.color = "#fff";
    b.style.borderRadius = "8px";
    b.style.padding = "7px 10px";
    b.style.cursor = "pointer";
    return b;
  }

  const btnBack = mkBtn("Back");
  btnBack.addEventListener("click", () => {
    // Modal içinde “Back” = kapat (browser history’ye gitmez)
    overlay.style.display = "none";
  });

  const btnClose = mkBtn("Close");
  btnClose.style.borderColor = "rgba(255,255,255,0.22)";
  btnClose.addEventListener("click", () => {
    overlay.style.display = "none";
  });

  // Tek “Top” butonu (header’da değil — böylece “üstte ikinci Top” oluşmaz)
  actions.appendChild(btnBack);
  actions.appendChild(btnClose);

  head.appendChild(title);
  head.appendChild(actions);

  const iframe = document.createElement("iframe");
  iframe.id = "docsFrame";
  iframe.style.border = "0";
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.background = "#0f0f0f";
  iframe.setAttribute("sandbox", "allow-same-origin allow-scripts allow-forms allow-popups allow-modals");
 

  // overlay outside click closes
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.style.display = "none";
  });

  // ESC closes
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.style.display !== "none") {
      overlay.style.display = "none";
    }
  });

  box.appendChild(head);
  box.appendChild(iframe);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  __docsOverlay = overlay;
  return overlay;
}

function normalizeDocsLang(code) {
  const raw = String(code || "").trim();
  if (!raw) return "en";

  const low = raw.toLowerCase().replace("_", "-");

  // en-US/en-GB için ayrı docs dosyası yoksa "en" kullan
  if (low === "en-us" || low === "en-gb") return "en";

  // zh-CN -> zh, pt-BR -> pt vb.
  return (low.split("-")[0] || "en");
}

function openDocsModalForCurrentLanguage() {
  const overlay = ensureDocsModal();
  const iframe = document.getElementById("docsFrame");
  if (!iframe) return;

  let lang = "en";
  try {
    lang = getSavedLanguage() || (getCurrentI18n && getCurrentI18n().lang) || "en";
  } catch (_) {}

  lang = normalizeDocsLang(lang);

  // PRIMARY: hosted docs (direct file = daha hızlı, "redirecting" yok)
  const base = "https://moremor.com/newspilot/docs/";
  const remoteDoc = `${base}newspilot-docs-${lang}.html`;
  const remoteEn  = `${base}newspilot-docs-en.html`;

  // OFFLINE / last resort:
  const localEn = "./docs/newspilot-docs-en.html";

  // 2 aşamalı fallback: remote lang -> remote en -> local en
  let stage = 0;
  try {
    iframe.onerror = () => {
      stage += 1;
      if (stage === 1) iframe.src = remoteEn;
      else iframe.src = localEn;
    };
  } catch (_) {}

  // Overlay önce açılsın (lazy-load davranışı daha stabil)
  overlay.style.display = "block";

  // Performans: iframe’i eager yükle
  try { iframe.loading = "eager"; } catch (_) {}

  iframe.src = remoteDoc;
}


// ---------- /Docs / About Modal ----------

function syncInputsFromDomToState() {
  const stNow = getState();
  const nextInputs = { ...(stNow.inputs || {}) };

  // Author / Dateline
  const inpDateline = $("inpDateline");
  const inpAuthorName = $("inpAuthorName");
  if (inpDateline) nextInputs.authorLocation = inpDateline.value || "";
  if (inpAuthorName) nextInputs.authorName = inpAuthorName.value || "";

  // 5W1H
  const w = { ...(nextInputs.w5h1 || {}) };
  const who = $("inpWho"), what = $("inpWhat"), when = $("inpWhen"), where = $("inpWhere"), why = $("inpWhy"), how = $("inpHow");
  if (who) w.who = who.value || "";
  if (what) w.what = what.value || "";
  if (when) w.when = when.value || "";
  if (where) w.where = where.value || "";
  if (why) w.why = why.value || "";
  if (how) w.how = how.value || "";
  nextInputs.w5h1 = w;

  // Source
  const src = $("txtSource");
  if (src) nextInputs.sourceText = src.value || "";

  setState({ inputs: nextInputs });
}

function syncUiFromDomToState() {
  const stNow = getState();
  const nextUi = { ...(stNow.ui || {}) };

  // style/tone/length/targetWords
  const selStyle = $("styleSelect");
  const selTone = $("selTone");
  const selLen = $("selLength");
  const inpWords = $("inpTargetWords");

  if (selStyle) nextUi.style = selStyle.value || nextUi.style;
  if (selTone) nextUi.tone = parseInt(selTone.value, 10) || nextUi.tone || 2;
  if (selLen) nextUi.lengthPreset = selLen.value || nextUi.lengthPreset || "medium";
  if (inpWords) {
    const v = String(inpWords.value || "").trim();
    nextUi.targetWords = v ? (parseInt(v, 10) || null) : null;
  }

  // engine
  const openAiRadio = document.querySelector('input[name="engine"][value="openai"]');
  const localRadio = document.querySelector('input[name="engine"][value="local"]');
  if (openAiRadio && openAiRadio.checked) nextUi.engine = "openai";
  else if (localRadio && localRadio.checked) nextUi.engine = "local";

  setState({ ui: nextUi });
}

// ---------- /License / Activate Modal ----------

function bindUIInternal() {
  
  // Language
  const selLang = $("selLang");
  if (selLang) selLang.addEventListener("change", async () => {
    await applyLanguage(selLang.value);
    renderLang();
  });

     // === About / Docs button ===
  const btnDocs = $("btnDocs");
if (btnDocs) {
  btnDocs.addEventListener("click", (e) => {
    e.preventDefault();
    openDocsModalForCurrentLanguage();
  });
}

// === Theme toggle button ===
const btnToggleDark = $("btnToggleDark");
if (btnToggleDark && !btnToggleDark.dataset.bound) {
  btnToggleDark.dataset.bound = "1";

  const setThemeNow = (theme) => {
    // 1) HTML attribute (senin CSS selector'ların için)
    document.documentElement.setAttribute("data-theme", theme);

    // 2) dark.css unconditional olabilir → light'ta disable et
    const darkLink = document.querySelector(
      'link[href$="css/dark.css"], link[href$="./css/dark.css"], link[href$="dark.css"]'
    );
    if (darkLink) darkLink.disabled = (theme !== "dark");

    // 3) Kalıcılık: state varsa yaz
    try {
      if (typeof getState === "function" && typeof setState === "function") {
        const st = getState() || {};
        setState({ ...st, theme });
      }
    } catch (_) {}

    // 4) New Work / tam reload sonrası için ayrıca localStorage'a yaz
    try {
      localStorage.setItem("np_theme", theme);
    } catch (_) {}

    // 5) Logo
    try {
      applyThemeLogo();
    } catch (_) {}
  };

  btnToggleDark.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    const next = cur === "dark" ? "light" : "dark";
    setThemeNow(next);
  });

  // İlk açılışta: önce localStorage, sonra state.theme, yoksa HTML attribute; en son dark
  let bootTheme = "dark";

  try {
    let saved = null;
    try {
      saved = localStorage.getItem("np_theme");
    } catch (_) {}

    if (saved === "dark" || saved === "light") {
      // 1) Tercihen localStorage
      bootTheme = saved;
    } else if (typeof getState === "function") {
      // 2) Sonra state
      const st = getState() || {};
      if (st.theme === "dark" || st.theme === "light") {
        bootTheme = st.theme;
      } else {
        const attr = document.documentElement.getAttribute("data-theme");
        if (attr === "dark" || attr === "light") bootTheme = attr;
      }
    } else {
      // 3) Son çare: HTML attribute
      const attr = document.documentElement.getAttribute("data-theme");
      if (attr === "dark" || attr === "light") bootTheme = attr;
    }
  } catch (_) {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") bootTheme = attr;
  }

  setThemeNow(bootTheme);
}


// İlk render: sayfa açılışında doğru logoyu bas
applyThemeLogo();

    // Engine
const engineRadios = document.querySelectorAll('input[name="engine"]');
if (engineRadios && engineRadios.length) {
  // Engine satırının hemen altına kısa bilgilendirme notu ekle
  const firstRadio = engineRadios[0];
  const engineRow = firstRadio.closest(".np-row") || firstRadio.parentElement;

  if (engineRow && !document.querySelector(".np-engine-hint")) {
    const hint = document.createElement("div");
    hint.className = "np-hint np-engine-hint";

    // i18n'den çek (yoksa İngilizce fallback kullan)
    let txt = "Local AI is a lightweight option. It currently generates one primary headline and the main story body. We recommend using OpenAI.";
    try {
      // getCurrentI18n import edilmişse kullan
      if (typeof getCurrentI18n === "function") {
        const i18n = getCurrentI18n();
        if (i18n && typeof i18n.t === "function") {
          txt = i18n.t("Local AI short hint under engine");
        }
      }
    } catch (e) {
      // sessizce EN fallback kalsın
    }

    hint.textContent = txt;
    engineRow.insertAdjacentElement("afterend", hint);
  }

  engineRadios.forEach((r) => {
    r.addEventListener("change", () => {
      // Her değişimde güncel state'i alıp sadece ui.engine alanını güncelliyoruz.
      const stNow = getState();
      setState({
        ui: {
          ...(stNow.ui || {}),
          engine: r.value,
        },
      });

      renderSettings();
      ensureDraftPanelOpenAINote();


      // OpenAI selected: only allow in Pro/Trial. Never auto-open key setup in Basic.
                  if (r.value === "openai") {
        if (!isOpenAITrialOrProEnabled()) {
          const rLocal = document.querySelector('input[name="engine"][value="local"]');
          if (rLocal) rLocal.checked = true;

          const stNow = getState();
          setState({ ui: { ...(stNow.ui || {}), engine: "local" } });

          openLicenseModal();
          renderSettings();
          return;
        }

        const hasNews = !!String(getApiKey() || "").trim();
        if (!hasNews) openKeyModal();
      }
    });
  });
}


  // Style
const selStyle = $("styleSelect");
if (selStyle) selStyle.addEventListener("change", () => {
  const stNow = getState();
setState({ ui: { ...(stNow.ui || {}), style: selStyle.value, hasGenerated: false } });
  updateGenerateButtonLabel();
});


  // Tone
  const selTone = $("selTone");
  if (selTone) selTone.addEventListener("change", () => {
    const stNow = getState();
setState({ ui: { ...(stNow.ui || {}), tone: parseInt(selTone.value, 10) || 2 } });
});


  // Length
  const selLen = $("selLength");
  if (selLen) selLen.addEventListener("change", () => {
    const stNow = getState();
setState({ ui: { ...(stNow.ui || {}), lengthPreset: selLen.value } });
  });

  // Target words
  const inpWords = $("inpTargetWords");
  if (inpWords) inpWords.addEventListener("input", () => {
    const v = String(inpWords.value || "").trim();
    const stNow = getState();
setState({ ui: { ...(stNow.ui || {}), targetWords: v ? parseInt(v, 10) : null } });

  });

  // Dateline / author location
  const inpDateline = $("inpDateline");
  if (inpDateline) inpDateline.addEventListener("input", () => {
    const stNow = getState();
setState({ inputs: { ...(stNow.inputs || {}), authorLocation: inpDateline.value || "" } });
  });

  const inpAuthorName = $("inpAuthorName");
  if (inpAuthorName) inpAuthorName.addEventListener("input", () => {
    const stNow = getState();
setState({ inputs: { ...(stNow.inputs || {}), authorName: inpAuthorName.value || "" } });
  });

    // 5W1H
  const map = [
    ["inpWho", "who"],
    ["inpWhat", "what"],
    ["inpWhen", "when"],
    ["inpWhere", "where"],
    ["inpWhy", "why"],
    ["inpHow", "how"],
  ];

  map.forEach(([id, key]) => {
    const el = $(id);
    if (!el) return;

    el.addEventListener("input", () => {
      const st = getState();
      const w = { ...(st.inputs.w5h1 || {}) };
      w[key] = el.value || "";
      const stNow = getState();
setState({ inputs: { ...(stNow.inputs || {}), w5h1: w } });
    });
  });

  // Source text
  const src = $("txtSource");
  if (src) {
    src.addEventListener("input", () => {
      const stNow = getState();
setState({ inputs: { ...(stNow.inputs || {}), sourceText: src.value || "" } });
    });
  }

  // Draft edit
  const draftEl = $("draftOutput");
  if (draftEl) {
    draftEl.addEventListener("input", () => {
      setState({ draft: { text: draftEl.value || "" } });
    });
  }

  // Final edit
  const finalEl = $("finalOutput");
  if (finalEl) {
    finalEl.addEventListener("input", () => {
      setState({ final: { text: finalEl.value || "" } });
    });
  }



  if ($("btnSpeechDelKey")) {
    $("btnSpeechDelKey").addEventListener("click", () => {
      removeSpeechKey();
      status("Speech API key deleted.");
      renderSettings();
    });
  }

  // Generate
  const btnGen = $("btnGenerate");
  if (btnGen) btnGen.addEventListener("click", async () => {
  const sel = $("selLang");
if (sel && sel.value) {
  setState({ language: sel.value });
  try { localStorage.setItem("np_lang", sel.value); } catch (_) {}
}
    syncInputsFromDomToState();
    syncUiFromDomToState();
    
   
    status("Generating..." );
    try {
      await generateOrRegenerate();
      const stNow = getState();
setState({ ui: { ...(stNow.ui || {}), hasGenerated: true } });
updateGenerateButtonLabel();
      renderVersions();
      renderOutputFromActive();
      status("Done." );
    } catch (e) {
      status("Generate failed." );
    }
  });

     // New News – sayfayı temiz başlat (tam refresh, en risksiz yöntem)
  const btnNew = $("btnNewNews");
  if (btnNew) {
    btnNew.addEventListener("click", () => {
      // Tüm state'i, formları vs. en temiz şekilde sıfırlamak için
      // mevcut sayfayı yeniden yüklüyoruz.
      window.location.reload();
    });
  }

  // Important – Local AI / OpenAI açıklamasını modal popup olarak göster
const btnImportant = $("btnImportant");
if (btnImportant) {
  btnImportant.addEventListener("click", () => {
    openImportantModal();
  });
}

// Tip – Add Details help modal
const btnDetailsTip = $("btnDetailsTip");
if (btnDetailsTip) btnDetailsTip.addEventListener("click", openDetailsTipModal);


    // Precheck (integrity gate used by Share)
  async function runPrecheck(purpose = "precheck") {
    const st = getState();
    const pkg = getActivePackage();
    const finalText = getText($("finalOutput")) || st.final?.text || "";
    const draftText = getText($("draftOutput")) || st.draft?.text || "";

    const res = await precheckRun({
      purpose,
      state: st,
      pkg,
      finalText,
      draftText
    });

    const msg = res?.message || "";

// Precheck button should show its message under the action buttons (not under Source).
if (purpose === "precheck") {
  let outMsg = msg || "Pre-check: no notes.";

  // Try to translate known Pre-check messages
  try {
    if (typeof getCurrentI18n === "function") {
      const i18n = getCurrentI18n();
      if (i18n && typeof i18n.t === "function") {
        const v = i18n.t(outMsg);
        if (v && v !== outMsg) outMsg = v;
      }
    }
  } catch (e) {}

  statusAction(outMsg, { autoClearMs: 4500 });

  // Optional: keep left column clean
  precheckHint("");
  statusFinal("", { autoClearMs: 1 });
}



    // Persist pass/fail so other actions can consult it if needed
    const stNow = getState();
setState({ ui: { ...(stNow.ui || {}), precheckPassed: Boolean(res?.ok) } });

    return res;
  }

  const btnPre = $("btnPrecheck");
  if (btnPre) btnPre.addEventListener("click", async () => {
    try {
      await runPrecheck("precheck");
    } catch (e) {
  let outMsg = (e && e.message) ? e.message : "Precheck failed.";

  try {
    if (typeof getCurrentI18n === "function") {
      const i18n = getCurrentI18n();
      if (i18n && typeof i18n.t === "function") {
        const v = i18n.t(outMsg);
        if (v && v !== outMsg) outMsg = v;
      }
    }
  } catch (err) {}

  statusAction(outMsg, { autoClearMs: 4500 });
  precheckHint("");
  statusFinal("", { autoClearMs: 1 });
  const stNow = getState();
setState({ ui: { ...(stNow.ui || {}), precheckPassed: false } });
}
});

  // Show a static note under Final panel action buttons (Precheck/Grammar)
ensureFinalButtonsInfoHint();

  // Grammar (always bound; uses selected language/style; never silently does nothing)
  const btnGram = $("btnGrammar");
  if (btnGram) btnGram.addEventListener("click", async () => {
    if (!isProEnabled()) {
      statusAction(tKey("Grammar is available only in Pro."), { autoClearMs: 4500 });
      return;
    }

    const st = getState();
    const lang = st.language || "en";
    const style = st.ui?.style || "agency";

    const text =
      (getText($("finalOutput")) || st.final?.text || "").trim() ||
      (getText($("draftOutput")) || st.draft?.text || "").trim();

    if (!text) {
      statusAction(tKey("Grammar: nothing to check. Generate + Build Final first."), { autoClearMs: 4500 });
      return;
    }

    const key = getApiKey();
if (!key) {
  // Do not open external websites; just inform the user.
  let msg = "Grammar: OpenAI key missing. Add a key in Setup or Settings.";
  try {
    if (typeof getCurrentI18n === "function") {
      const i18n = getCurrentI18n();
      if (i18n && typeof i18n.t === "function") {
        const v = i18n.t("Grammar: OpenAI key missing");
        if (v && v !== "Grammar: OpenAI key missing") msg = v;
      }
    }
  } catch (e) {}
  statusAction(msg, { autoClearMs: 6500 });
  return;
}


     try {
      const out = await checkGrammarWithOpenAI({ apiKey: key, text, lang, style });
      const cleaned = (out && typeof out.cleanedText === "string") ? out.cleanedText : "";
      if (!cleaned.trim()) {
        statusAction("Grammar: no edited text returned.", { autoClearMs: 4500 });
        return;
      }

      setText($("finalOutput"), cleaned);
      setState({ final: { text: cleaned } });
      statusAction("Grammar: applied to Final output.", { autoClearMs: 2500 });
    } catch (e) {
      const msg = (e && e.message) ? e.message : "Grammar check failed.";
      statusAction("Grammar error: " + msg, { autoClearMs: 5000 });
     }
  });

  // Build Final (always bound)
  const btnFinal = $("btnBuildFinal");
  if (btnFinal) btnFinal.addEventListener("click", () => {
    const draftText = getText($("draftOutput")) || getState().draft.text || "";
    setState({ draft: { text: draftText } });

    try {
      buildFinalAndRender();

      // Post-fix: normalize section headers in Final text (accept QUOTES or QUOTES:)
      try {
        const finalEl = $("finalOutput");
        const txt0 = (getText(finalEl) || getState().final?.text || "").toString();
        if (txt0) {
          // Prefer ":" variant keys; fallback to non-colon keys if needed.
          const pickLbl = (withColonKey, withoutColonKey) => {
            const a = String(tKey(withColonKey) || "").trim();
            const b = String(tKey(withoutColonKey) || "").trim();
            let v = (a && a !== withColonKey) ? a : ((b && b !== withoutColonKey) ? b : withColonKey);
            if (!/:\s*$/.test(v)) v = v.replace(/\s*$/, "") + ":";
            return v;
          };

          const qLbl  = pickLbl("QUOTES:", "QUOTES");
          const sLbl  = pickLbl("SPOTS:", "SPOTS");
          const kqLbl = pickLbl("KEY QUOTES:", "KEY QUOTES");

          let txt = txt0
            // English headers (with or without colon) -> localized
            .replace(/(^|\n)\s*QUOTES\s*:?\s*(\n|$)/gi, `\n\n${qLbl}\n`)
            .replace(/(^|\n)\s*KEY\s+QUOTES\s*:?\s*(\n|$)/gi, `\n\n${kqLbl}\n`)
            .replace(/(^|\n)\s*SPOTS\s*:?\s*(\n|$)/gi, `\n\n${sLbl}\n`);

          // Also normalize accidental extra blank lines
          txt = txt.replace(/\n{3,}/g, "\n\n").trim();

          if (txt !== txt0) {
            setText(finalEl, txt);
            const stNow = getState();
            setState({ final: { ...(stNow.final || {}), text: txt } });
          }
        }
      } catch (_) {}
      status("Final built." );
      statusFinal("Final built.", { autoClearMs: 1500 });
    } catch (e) {
      const msg = (e && e.message) ? e.message : "Build Final failed.";
      statusFinal("Build Final error: " + msg, { autoClearMs: 5000 });
    }
  });



// Draft Options interactions (OPENAI->OPTIONS->BUILD_FINAL)
const draftOut = $("draftOutput");
if (draftOut) {
  draftOut.addEventListener("input", () => {
    const t = getText(draftOut) || "";
    setState({ draft: { text: t } });

    updateActivePackage((p) => {
      if (!p || !p.choices || !Array.isArray(p.choices.items)) return;
      const body = p.choices.items.find((it) => String(it.id) === "body");
      if (body) body.text = t;

      // keep outputs in sync for export fallbacks
      if (!p.outputs) p.outputs = {};
      p.outputs.body = t;
      p.outputs.bodyText = t;
    });
  });
}

const optHost = $("draftOptions");
if (optHost) {
  optHost.addEventListener("change", (ev) => {
    const el = ev.target;
    if (!el) return;

    if (el.matches && el.matches('input[type="checkbox"][data-opt-id]')) {
      const id = el.getAttribute("data-opt-id");
      const checked = !!el.checked;

      updateActivePackage((p) => {
        if (!p || !p.choices || !Array.isArray(p.choices.items)) return;
        const it = p.choices.items.find((x) => String(x.id) === String(id));
        if (it) it.selected = checked;
        if (p.choices) p.choices.updatedAt = Date.now();
      });
    }
  });

  optHost.addEventListener("input", (ev) => {
    const el = ev.target;
    if (!el) return;

    if (el.matches && el.matches('textarea[data-opt-id]')) {
      const id = el.getAttribute("data-opt-id");
      const val = String(el.value || "");

      updateActivePackage((p) => {
        if (!p || !p.choices || !Array.isArray(p.choices.items)) return;
        const it = p.choices.items.find((x) => String(x.id) === String(id));
        if (it) it.text = val;
        if (p.choices) p.choices.updatedAt = Date.now();

        // Keep outputs arrays aligned for any legacy consumers
        if (!p.outputs) p.outputs = {};
        if (String(id) === "topHeadline") p.outputs.topHeadline = val;

        const m1 = String(id).match(/^headline(\d)$/);
        if (m1) {
          const i = Number(m1[1]) - 1;
          const arr = Array.isArray(p.outputs.headlines) ? p.outputs.headlines.slice() : [];
          while (arr.length < 3) arr.push("");
          arr[i] = val;
          p.outputs.headlines = arr;
        }

                if (String(id) === "subheadline1") {
          // subheadline is stored as string
          p.outputs.subheadline = val;
        }

        const m2 = String(id).match(/^spot(\d)$/);
        if (m2) {
          const i = Number(m2[1]) - 1;
          const arr = Array.isArray(p.outputs.spots) ? p.outputs.spots.slice() : [];
          while (arr.length < 4) arr.push("");
          arr[i] = val;
          p.outputs.spots = arr;
        }

        const m3 = String(id).match(/^quote(\d)$/);
        if (m3) {
          const i = Number(m3[1]) - 1;
          const arr = Array.isArray(p.outputs.quotes) ? p.outputs.quotes.slice() : [];
          while (arr.length < 4) arr.push("");
          arr[i] = val;
          p.outputs.quotes = arr;
        }
      });
    }
  });
}

    // Copy / Share (always observable; Share blocked if precheck fails)
  if ($("btnCopyFinal")) $("btnCopyFinal").addEventListener("click", async () => {
    const ok = await copyFinal();
    statusAction(
  ok ? tKey("Copied.") : tKey("Copy failed: clipboard permission not available."),
  { autoClearMs: 3500 }
);
  });

  if ($("btnShareFinal")) $("btnShareFinal").addEventListener("click", async () => {
  // Optional integrity gate: if precheck fails, block share with a clear message
  try {
    const check = await runPrecheck("share");
    if (!check?.ok) {
      statusAction(tKey("Share blocked: fix Pre-check issues first."), { autoClearMs: 4500 });
      return;
    }
  } catch (e) {
    statusAction(tKey("Pre-check failed; share blocked."), { autoClearMs: 4500 });
    return;
  }


  // Electron-safe Share Center (no navigator.share dependency)
  await openShareCenterWithFinalText();
});


  // Save buttons (called from popup menu)
  if ($("btnSaveTxt")) $("btnSaveTxt").addEventListener("click", () => saveTXT());
  if ($("btnSaveDocx")) $("btnSaveDocx").addEventListener("click", () => saveDOCX());
  if ($("btnSavePdf")) $("btnSavePdf").addEventListener("click", () => savePDF());

  wireSaveMenu();

      // Auto-transcribe checkbox: visible in Basic/Trial/Pro, but usable only with Trial/Pro + key
  const chkAuto = $("chkAutoTranscribe");
  if (chkAuto) {
    chkAuto.addEventListener("change", () => {
      const canUseOpenAI = isOpenAITrialOrProEnabled();
      const hasAnyKey = !!String(getSpeechKey() || getApiKey() || "").trim();

            if (!canUseOpenAI) {
        chkAuto.checked = false;
        openLicenseModal();
        renderSettings();
        return;
      }

      if (chkAuto.checked && !hasAnyKey) {
        chkAuto.checked = false;
        statusAction(tKey("OpenAI key is required."), { autoClearMs: 3500 });
        openKeyModal();
        renderSettings();
        return;
      }

      renderSettings();
    });
  }

    // OpenAI engine radio: allow in Trial/Pro, require key
  const rOpenAI = document.querySelector('input[name="engine"][value="openai"]');
  if (rOpenAI) {
    rOpenAI.addEventListener("change", () => {
      if (!rOpenAI.checked) return;

            if (!isOpenAITrialOrProEnabled()) {
        const rLocal = document.querySelector('input[name="engine"][value="local"]');
        if (rLocal) rLocal.checked = true;

        const stNow = getState();
        setState({ ui: { ...(stNow.ui || {}), engine: "local" } });

        openLicenseModal();
        renderSettings();
        return;
      }

      const hasNews = !!String(getApiKey() || "").trim();
      if (!hasNews) {
        openKeyModal();
      }
    });
  }
 
  // ---------- IMPORTANT MODAL (Local AI vs OpenAI) ----------
function openImportantModal() {
  let overlay = document.getElementById("importantModalOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "importantModalOverlay";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.5)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "1000";

    const box = document.createElement("div");
    box.style.maxWidth = "520px";
    box.style.width = "90%";
    box.style.borderRadius = "16px";
    box.style.padding = "18px 20px 16px";
    box.style.boxShadow = "0 18px 45px rgba(0,0,0,.45)";
    box.style.fontSize = "14px";
    box.style.lineHeight = "1.5";
    box.style.background = "var(--panel)";
    box.style.color = "var(--text)";

    const title = document.createElement("div");
    title.id = "importantModalTitle";

// Mevcut i18n snapshot'ını al
let tipT = null;
if (typeof getCurrentI18n === "function") {
  try {
    const snap = getCurrentI18n();
    if (snap && typeof snap.t === "function") {
      tipT = snap.t;
    }
  } catch (_) {
    // sessiz geç
  }
}

const tipTranslate = (s) => (tipT ? tipT(s) : s);

title.textContent = tipTranslate("Important – Local AI vs OpenAI");
title.style.fontWeight = "800";
title.style.fontSize = "16px";
title.style.marginBottom = "8px";

const p1 = document.createElement("p");
p1.id = "importantModalP1";
p1.textContent = tipTranslate(
  "Local AI is a lightweight option. It currently generates one primary headline and the main story body, and may not produce meaningfully different versions from tone/style changes."
);

const p2 = document.createElement("p");
p2.id = "importantModalP2";
p2.textContent = tipTranslate(
  "For more output types (multiple headlines, spots/keylines/summary lines, and quotes) — and for higher-quality, clearly different versions — add an OpenAI API key. This usually costs only a few cents per run."
);

const p3 = document.createElement("p");
p3.id = "importantModalP3";
p3.textContent = tipTranslate(
  "You can add an OpenAI API key from the Setup button or Settings area."
);


    const footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.marginTop = "12px";

    const btnClose = document.createElement("button");
btnClose.id = "importantModalClose";           
btnClose.type = "button";
btnClose.className = "btn btn-secondary";
btnClose.textContent = tKey("Close");          
btnClose.addEventListener("click", () => {     
  overlay.style.display = "none";              
});                                            

    footer.appendChild(btnClose);

    box.appendChild(title);
    box.appendChild(p1);
    box.appendChild(p2);
    box.appendChild(p3);
    box.appendChild(footer);

    overlay.appendChild(box);

    // Kutunun dışına tıklayınca kapansın
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) overlay.style.display = "none";
    });

    document.body.appendChild(overlay);
  }
   
     // Her açılışta metinleri GÜNCEL i18n ile tazele (dil değişince eski dilde kalmasın)
  try {
    let t = (s) => s;
    if (typeof getCurrentI18n === "function") {
      const snap = getCurrentI18n();
      if (snap && typeof snap.t === "function") t = snap.t.bind(snap);
    }

    const titleEl = document.getElementById("importantModalTitle");
    if (titleEl) titleEl.textContent = t("Important – Local AI vs OpenAI");

    const p1El = document.getElementById("importantModalP1");
    if (p1El) p1El.textContent = t(
      "Local AI is a lightweight option. It currently generates one primary headline and the main story body, and may not produce meaningfully different versions from tone/style changes."
    );

    const p2El = document.getElementById("importantModalP2");
    if (p2El) p2El.textContent = t(
      "For more output types (multiple headlines, spots/keylines/summary lines, and quotes) — and for higher-quality, clearly different versions — add an OpenAI API key. This usually costs only a few cents per run."
    );

    const p3El = document.getElementById("importantModalP3");
    if (p3El) p3El.textContent = t(
      "You can add an OpenAI API key from the Setup button or Settings area."
    );

    const btn = document.getElementById("importantModalClose");
    if (btn) btn.textContent = t("Close");
  } catch (_) {}

  overlay.style.display = "flex";
}

// ---------- DETAILS TIP MODAL ----------
function openDetailsTipModal() {
  let overlay = document.getElementById("detailsTipOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "detailsTipOverlay";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.5)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "1000";

    const box = document.createElement("div");
    box.style.maxWidth = "560px";
    box.style.width = "92%";
    box.style.borderRadius = "16px";
    box.style.padding = "18px 20px 16px";
    box.style.boxShadow = "0 18px 45px rgba(0,0,0,45)";
    box.style.fontSize = "14px";
    box.style.lineHeight = "1.5";
    box.style.background = "var(--panel)";
    box.style.color = "var(--text)";

        // TIP başlık + gövde (i18n destekli)
    const title = document.createElement("div");
    title.id = "detailsTipTitle";

    // İngilizce fallback metinler (en.json / tr.json okunamazsa)
    const fallbackTitle =
      "Tip – Create news in another language / translate";
    const fallbackBody =
      "If you want to create a news story in a different language (or translate your story), first set the app language to the language you want for the output.\n\nThen paste your press release / interview / notes here. You can also fill the 5W1H fields. Click Generate and the app will produce the news story in the selected app language—even if the pasted text is in another language.";

    let titleText = fallbackTitle;
    let bodyText = fallbackBody;

    // i18n'den çekmeyi dene (details_tip_title + details_tip_text)
    try {
      if (typeof getCurrentI18n === "function") {
        const snap = getCurrentI18n();
        if (snap && typeof snap.t === "function") {
          const tTitle = snap.t("details_tip_title");
          const tBody = snap.t("details_tip_text");

          if (tTitle && typeof tTitle === "string") {
            titleText = tTitle;
          }
          if (tBody && typeof tBody === "string") {
            bodyText = tBody;
          }
        }
      }
    } catch (e) {
      // Hata olursa fallback EN metinler kalır
    }

    title.textContent = titleText;
    title.style.fontWeight = "800";
    title.style.fontSize = "16px";
    title.style.marginBottom = "8px";

    // details_tip_text içindeki \n\n ile paragraflara böl
    const parts = String(bodyText).split(/\n\s*\n/);

    const p1 = document.createElement("p");
    p1.id = "detailsTipP1";
    p1.textContent = parts[0] || "";

    const p2 = document.createElement("p");
    p2.id = "detailsTipP2";
    p2.textContent = parts[1] || "";


    const footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.marginTop = "12px";

    const btnClose = document.createElement("button");
    btnClose.id = "detailsTipClose"; // ← EKLENEN SATIR
    btnClose.type = "button";
    btnClose.className = "btn btn-secondary";
    btnClose.textContent = tKey("Close");
    btnClose.addEventListener("click", () => {
      overlay.style.display = "none";
    });

    footer.appendChild(btnClose);

    box.appendChild(title);
    box.appendChild(p1);
    box.appendChild(p2);
    box.appendChild(footer);
    overlay.appendChild(box);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.style.display = "none";
    });

    document.body.appendChild(overlay);
  }

   

     // Her açılışta TIP metnini güncel dile göre tazele
  try {
    const snap = (typeof getCurrentI18n === "function") ? getCurrentI18n() : null;
    const t = (snap && typeof snap.t === "function") ? snap.t.bind(snap) : (s) => s;

    const fallbackTitle = "Tip – Create news in another language / translate";
    const fallbackBody =
      "If you want to create a news story in a different language (or translate your story), first set the app language to the language you want for the output.\n\nThen paste your press release / interview / notes here. You can also fill the 5W1H fields. Click Generate and the app will produce the news story in the selected app language—even if the pasted text is in another language.";

    let titleText = t("details_tip_title");
    if (!titleText || titleText === "details_tip_title") titleText = fallbackTitle;

    let bodyText = t("details_tip_text");
    if (!bodyText || bodyText === "details_tip_text") bodyText = fallbackBody;

    const titleEl = document.getElementById("detailsTipTitle");
    if (titleEl) titleEl.textContent = titleText;

    const parts = String(bodyText).split(/\n\s*\n/);
    const p1El = document.getElementById("detailsTipP1");
    const p2El = document.getElementById("detailsTipP2");
    if (p1El) p1El.textContent = parts[0] || "";
    if (p2El) p2El.textContent = parts[1] || "";

    const closeEl = document.getElementById("detailsTipClose");
    if (closeEl) closeEl.textContent = t("Close");
  } catch (_) {}

  overlay.style.display = "flex";
}


  // Recording
  const btnMic = $("btnMic");
  if (btnMic) {
    if (!isRecordingSupported()) btnMic.disabled = true;

    let session = null;
    btnMic.addEventListener("click", async () => {
      if (!session) {
        status("Recording..." );
        btnMic.textContent = "Stop";
	btnMic.classList.add("is-recording");
        try {
          session = await startVoiceSession({ lang: getState().language || "en" });
        } catch (e) {
          session = null;
          btnMic.textContent = "Record";
	  btnMic.classList.remove("is-recording");
          status("Mic permission denied." );
        }
        return;
      }

      // Stop
      try {
        const stopRes = await session.stop();
        session = null;
        btnMic.textContent = "Record";
	btnMic.classList.remove("is-recording");
        const when = new Date().toLocaleString();

        // label sadece kayıt için; import'a bulaşmasın
        const fallbackLabel = "sound_" + Date.now();
        const label = (inpClipName && inpClipName.value ? inpClipName.value : "").trim() || fallbackLabel;

        // KAYITTA importAudio YOK: direkt blob'u diske yaz
        const saved = await writeRecordingToDisk(stopRes.blob, "wav", label);
        const id = saved.filePath || ("rec_" + Date.now());

        const item = {
          id,
          label,
          when,
          filename: (saved.filePath ? saved.filePath.split(/[/\\]/).pop() : (saved.name || saved.filename)) || "speech.wav",
          url: saved.filePath ? toFileUrl(saved.filePath) : (stopRes.url || ""),
          filePath: saved.filePath || null,
          blob: stopRes.blob,
          text: ""
        };

        const st = getState();
        const items = Array.isArray(st.voices) ? st.voices : [];
        const next = [item, ...items].slice(0, 50);
        setState({ voices: next });
        renderVoices();
        status("");

        // Kayıt bitince isim alanı temizlensin (bir sonraki import'a bulaşmasın)
        if (inpClipName) inpClipName.value = "";

        // Auto-transcribe
        const auto = $("chkAutoTranscribe");
        if (auto && auto.checked) {
          await transcriptAndAppend(id);
        }

        status("Recording saved.", { autoClearMs: 2500 });
      } catch (e) {
        session = null;
        btnMic.textContent = "Record";
	btnMic.classList.remove("is-recording");
        status("Stop failed." );
      }
    });
  }

//- - - -5W1H-FIELD-- autogrow
function attachAutoGrowTextareas(ids, maxRows = 6) {
  const resizeOne = (el) => {
    if (!el) return;
    el.style.height = "auto"; // allow shrink
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 18;
    const py = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const by = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const maxH = (line * maxRows) + py + by;

    const next = Math.min(el.scrollHeight, maxH);
    el.style.height = next + "px";
  };

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el || el.tagName !== "TEXTAREA") return;

    // Wrap long words nicely
    el.style.whiteSpace = "pre-wrap";
    el.style.overflowWrap = "anywhere";

    const onInput = () => resizeOne(el);
    el.addEventListener("input", onInput);
    window.addEventListener("resize", onInput);
    // initial sizing (for restored values)
    resizeOne(el);
  });
}
attachAutoGrowTextareas(["inpWho","inpWhat","inpWhen","inpWhere","inpWhy","inpHow"], 6);

      // Pro / Activate entry point
  const btnUpgrade = $("btnUpgrade");
  if (btnUpgrade) {
    btnUpgrade.addEventListener("click", () => {
      openLicenseModal();
    });
  }
}

export function bindUI() {
  bindUIInternal();
  // (1) İlk açılışta mevcut temaya göre doğru logo
  applyThemeLogo();

      // Key setup buttons (single source of truth)
  [
    "btnKeySetupNews",
    "btnKeySetupSpeech",
    "btnSetup",
    "btnSetupTop",
    "btnSetupOpenAI",
    "btnOpenAISetup",
    "btnSetupAi"
  ].forEach((id) => {
    const el = $(id);
    if (el) {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openKeyModal();
      });
    }
  });

  const btnSetupSpeech = $("btnKeySetupSpeech");
  if (btnSetupSpeech) btnSetupSpeech.addEventListener("click", openKeyModal);

  wireKeyModal();
  installLicenseAutoSync();
  
  ensureDraftPanelOpenAINote();

  // Session list starts empty on each app start (disk recordings remain on disk)
  setState({ voices: [] });
  renderVoices();
  status("");

  //loadRecordingsFromDisk()
  //  .then(() => renderVoices())
  //  .catch(() => {});

  subscribe(() => {
    renderLang();
    renderSettings();
  });
}

export function renderAll() {
  renderLang();
  renderSettings();
  renderVersions();
  renderVoices();
}

const btnImportAudio = document.getElementById("btnImportAudio");
const inpClipName = document.getElementById("inpClipName");

if (btnImportAudio) {
  btnImportAudio.addEventListener("click", async () => {
    try{
      // Import'ta inpClipName'i etiket olarak kullanma:
      // dosya kendi adıyla gelsin; önceki kayıt adı bulaşmasın
      if (!window.np || !window.np.importAudio) return;

      // Bazı preload sürümlerinde label zorunlu olabilir; boş string güvenli
      const res = await window.np.importAudio({ label: "" });
      if (!res || res.canceled) return;
      if (res.ok === false) {
        alert(res.error || "Import failed.");
        return;
      }

      // Add ONLY the imported file to UI (do NOT reload whole disk)
      const st = getState();
      const items = Array.isArray(st.voices) ? st.voices : [];

      const p = res.path || res.filePath || res.fullPath || res.destPath || res.savedPath || null;
      const name = res.name || res.filename || (p ? String(p).split(/[/\\]/).pop() : "import.wav");
      const when = res.mtime ? new Date(res.mtime).toLocaleString() : new Date().toLocaleString();
      const id = res.id || p || ("imp_" + Date.now());

      const newItem = {
        id,
        label: "",          // boş bırak: baseOf() filename'den okunur (kanka2 gibi)
        when,
        filename: name,
        url: p ? toFileUrl(p) : "",
        filePath: p,
        blob: null,
        meta: {
          mimeType: (() => {
            const fn = String(name || "").toLowerCase();
            if (fn.endsWith(".mp3")) return "audio/mpeg";
            if (fn.endsWith(".m4a")) return "audio/mp4";
            if (fn.endsWith(".mp4")) return "audio/mp4";
            if (fn.endsWith(".webm")) return "audio/webm";
            if (fn.endsWith(".ogg")) return "audio/ogg";
            if (fn.endsWith(".wav")) return "audio/wav";
            return "";
          })()
        },
        text: ""
      };

            const next = [newItem, ...items].slice(0, 50);
      setState({ voices: next });
      renderVoices();

      // Import sonrası da alan temiz kalsın
      if (inpClipName) inpClipName.value = "";

      // Auto-transcribe for imported audio too
      const auto = $("chkAutoTranscribe");
      if (auto && auto.checked) {
        await transcriptAndAppend(id);
      }

            status("Imported.", { autoClearMs: 2000 });
    } catch (e) {
      alert((e && e.message) ? e.message : "Import failed.");
    }
  });
}

/// === New Work / tam sayfa yenileme sonrası dili geri yükle ===
try {
  window.addEventListener("load", async () => {
    try {
      // Helper fonksiyonlar gerçekten var mı?
      const hasGetSaved = (typeof getSavedLanguage === "function");
      const hasApply = (typeof applyLanguage === "function");

      if (hasGetSaved && hasApply) {
        const saved = getSavedLanguage();

        if (saved && typeof saved === "string" && saved !== "") {
          // 1) Kaydedilmiş dili tam olarak uygula
          await applyLanguage(saved);
        } else {
          // 2) Yine de fallback’le dili uygula (en azından state + np_lang dolsun)
          await applyLanguage();
        }

        // 3) Dil dropdown’unu her durumda senkronla
        try {
          if (typeof renderLang === "function") {
            renderLang();
          }
        } catch (_) {
          // sessiz geç
        }
      }
    } catch (_) {
      // sessiz geç
    }
  });
} catch (_) {
  // çok eski ortamlarda window yoksa sessiz geç
}


let __licenseAutoSyncTimer = null;

async function syncLicenseQuietly() {
  try {
    await refreshStoreLicenseStatus();
  } catch(e) {}

  try {
    refreshLicenseStateFromStorage();
  } catch(e) {}

  try {
    renderSettings();
  } catch(e) {}
}

function installLicenseAutoSync() {

  // App açılınca 1 kez kontrol
  syncLicenseQuietly();

  // 24 saatte 1 kontrol
  if (!__licenseAutoSyncTimer) {
    __licenseAutoSyncTimer = setInterval(syncLicenseQuietly, 24 * 60 * 60 * 1000);
  }

  // App tekrar aktif olursa kontrol
  window.addEventListener("focus", syncLicenseQuietly);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncLicenseQuietly();
  });
}