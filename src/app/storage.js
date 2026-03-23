// FILE: src/app/storage.js

const KEY_API = "np_openai_key";               // News generation
const KEY_SPEECH_API = "np_openai_speech_key"; // Speech-to-text (Whisper)
const KEY_LICENSE = "np_license";
const KEY_TRIAL_START = "np_trial_start";
const KEY_BASIC_EXPIRES = "np_basic_expires"; // Basic (1 year)
const KEY_PRO_CODE = "np_pro_code";           // Pro code
const KEY_PRO_EXPIRES = "np_pro_expires";     // Pro expiry ISO

// Store / MSIX cache
const KEY_STORE_TIER = "np_store_tier";                 // "", "basic", "pro"
const KEY_STORE_BASIC_EXPIRES = "np_store_basic_expires";
const KEY_STORE_PRO_EXPIRES = "np_store_pro_expires";
const KEY_STORE_LAST_SYNC = "np_store_last_sync";

// News API key
export function setApiKey(k){
  localStorage.setItem(KEY_API, String(k || ""));
}
export function getApiKey(){
  return (localStorage.getItem(KEY_API) || "").trim();
}
export function removeApiKey(){
  localStorage.removeItem(KEY_API);
}

// Speech-to-text API key (OpenAI Whisper)
export function setSpeechKey(k){
  localStorage.setItem(KEY_SPEECH_API, String(k || ""));
}
export function getSpeechKey(){
  return (localStorage.getItem(KEY_SPEECH_API) || "").trim();
}
export function removeSpeechKey(){
  localStorage.removeItem(KEY_SPEECH_API);
}

export function getTrialStartISO(){
  return (localStorage.getItem(KEY_TRIAL_START) || "").trim();
}
export function setTrialStartISO(iso){
  localStorage.setItem(KEY_TRIAL_START, String(iso || ""));
}

function addDaysISO(days){
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function isFutureISO(iso){
  try{
    const t = new Date(String(iso || "").trim()).getTime();
    return Number.isFinite(t) && t > Date.now();
  }catch(_){
    return false;
  }
}

// Basic: legacy/local entitlement
export function ensureBasicEntitlement(){
  try{
    const cur = (localStorage.getItem(KEY_BASIC_EXPIRES) || "").trim();
    if (!cur){
      localStorage.setItem(KEY_BASIC_EXPIRES, addDaysISO(365));
    }
  }catch(_){ }
}

export function getBasicExpiresISO(){
  try { return (localStorage.getItem(KEY_BASIC_EXPIRES) || "").trim(); } catch(_) { return ""; }
}

export function isBasicValid(){
  try{
    const exp = (localStorage.getItem(KEY_BASIC_EXPIRES) || "").trim();
    if (!exp) return false;
    const t = new Date(exp).getTime();
    return Number.isFinite(t) && t > Date.now();
  }catch(_){
    return false;
  }
}

export function setBasicLicense(expiresISO){
  try{
    localStorage.setItem(KEY_BASIC_EXPIRES, String(expiresISO || ""));
  }catch(_){ }
}

export function clearBasicLicense(){
  try{
    localStorage.removeItem(KEY_BASIC_EXPIRES);
  }catch(_){ }
}

// Pro license: legacy/local 1 year
export function setProLicense(code, expiresISO){
  try{
    localStorage.setItem(KEY_LICENSE, "paid");
    localStorage.setItem(KEY_PRO_CODE, String(code || ""));
    localStorage.setItem(KEY_PRO_EXPIRES, String(expiresISO || ""));
  }catch(_){ }
}

export function clearProLicense(){
  try{
    localStorage.removeItem(KEY_LICENSE);
    localStorage.removeItem(KEY_PRO_CODE);
    localStorage.removeItem(KEY_PRO_EXPIRES);
  }catch(_){ }
}

export function getProExpiresISO(){
  try { return (localStorage.getItem(KEY_PRO_EXPIRES) || "").trim(); } catch(_) { return ""; }
}

// Legacy compatibility helpers
export function setPaidUnlocked(flag){
  if (flag){
    setProLicense("LOCAL", addDaysISO(365));
  } else {
    clearProLicense();
  }
}

// Paid = legacy/local Pro geçerli mi? (expiry kontrolü ile)
export function isPaidUnlocked(){
  try{
    if ((localStorage.getItem(KEY_LICENSE) || "") !== "paid") return false;
    const exp = (localStorage.getItem(KEY_PRO_EXPIRES) || "").trim();
    if (!exp) return false;
    const t = new Date(exp).getTime();
    return Number.isFinite(t) && t > Date.now();
  }catch(_){
    return false;
  }
}

// Store / MSIX cache snapshot
export function setStoreLicenseSnapshot(snapshot = {}){
  try{
    const tier = String(snapshot.tier || "").trim().toLowerCase();
    const basicExpiresISO = String(snapshot.basicExpiresISO || "");
    const proExpiresISO = String(snapshot.proExpiresISO || "");

    localStorage.setItem(KEY_STORE_TIER, tier);
    localStorage.setItem(KEY_STORE_BASIC_EXPIRES, basicExpiresISO);
    localStorage.setItem(KEY_STORE_PRO_EXPIRES, proExpiresISO);
    localStorage.setItem(KEY_STORE_LAST_SYNC, new Date().toISOString());

    // Backward-compatible mirrors so existing code paths do not break.
    if (tier === "pro" && proExpiresISO) {
      localStorage.setItem(KEY_LICENSE, "paid");
      localStorage.setItem(KEY_PRO_CODE, "STORE");
      localStorage.setItem(KEY_PRO_EXPIRES, proExpiresISO);
      localStorage.removeItem(KEY_BASIC_EXPIRES);
    } else if (tier === "basic" && basicExpiresISO) {
      localStorage.removeItem(KEY_LICENSE);
      localStorage.removeItem(KEY_PRO_CODE);
      localStorage.removeItem(KEY_PRO_EXPIRES);
      localStorage.setItem(KEY_BASIC_EXPIRES, basicExpiresISO);
    } else if (!tier) {
      localStorage.removeItem(KEY_LICENSE);
      localStorage.removeItem(KEY_PRO_CODE);
      localStorage.removeItem(KEY_PRO_EXPIRES);
      localStorage.removeItem(KEY_BASIC_EXPIRES);
    }
  }catch(_){ }
}

export function clearStoreLicenseSnapshot(){
  try{
    localStorage.removeItem(KEY_STORE_TIER);
    localStorage.removeItem(KEY_STORE_BASIC_EXPIRES);
    localStorage.removeItem(KEY_STORE_PRO_EXPIRES);
    localStorage.removeItem(KEY_STORE_LAST_SYNC);
  }catch(_){ }
}

export function getStoreLicenseSnapshot(){
  try{
    return {
      tier: (localStorage.getItem(KEY_STORE_TIER) || "").trim().toLowerCase(),
      basicExpiresISO: (localStorage.getItem(KEY_STORE_BASIC_EXPIRES) || "").trim(),
      proExpiresISO: (localStorage.getItem(KEY_STORE_PRO_EXPIRES) || "").trim(),
      lastSyncISO: (localStorage.getItem(KEY_STORE_LAST_SYNC) || "").trim()
    };
  }catch(_){
    return {
      tier: "",
      basicExpiresISO: "",
      proExpiresISO: "",
      lastSyncISO: ""
    };
  }
}

export function isStoreBasicUnlocked(){
  try{
    const st = getStoreLicenseSnapshot();
    return st.tier === "basic" && isFutureISO(st.basicExpiresISO);
  }catch(_){
    return false;
  }
}

export function isStoreProUnlocked(){
  try{
    const st = getStoreLicenseSnapshot();
    return st.tier === "pro" && isFutureISO(st.proExpiresISO);
  }catch(_){
    return false;
  }
}

export function getEffectiveLicenseTier(){
  try{
    if (isStoreProUnlocked()) return "pro";
    if (isStoreBasicUnlocked()) return "basic";
    return "";
  }catch(_){
    return "";
  }
}
