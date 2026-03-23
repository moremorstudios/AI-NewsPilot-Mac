// FILE: src/app/license.js
// Microsoft Store / MSIX-ready license layer for AI NewsPilot.
//
// Notes:
// - STT / OpenAI feature code is NOT touched here.
// - Manual offline code activation is disabled in Store builds.
// - Local 7-day full trial is ENABLED.
// - Trial grants Basic access + OpenAI-connected writing access.
// - Real Pro ownership is still Store-based only.
// - Compatibility helpers are kept so ui.js does not need invasive changes.

import {
  getEffectiveLicenseTier,
  getStoreLicenseSnapshot,
  setStoreLicenseSnapshot,
  clearStoreLicenseSnapshot,
  clearProLicense,
  clearBasicLicense
} from "./storage.js";

// Session cache; persistent truth comes from storage.js snapshot helpers.
let licenseTier = getEffectiveLicenseTier(); // "", "basic", "pro"

const TRIAL_DAYS_TOTAL = 7;
const TRIAL_STORAGE_KEY = "np_trial_v1_startedAt";

function getNowMs() {
  return Date.now();
}

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (_) {
    return false;
  }
}

function safeLocalStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (_) {}
}

function parseTrialStart(raw) {
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return ms;
}

function readTrialStartMs() {
  return parseTrialStart(safeLocalStorageGet(TRIAL_STORAGE_KEY));
}

function writeTrialStartMs(ms) {
  const iso = new Date(ms).toISOString();
  safeLocalStorageSet(TRIAL_STORAGE_KEY, iso);
  return iso;
}

function hasPaidStoreLicense() {
  return licenseTier === "basic" || licenseTier === "pro";
}

export function ensureTrialStart() {
  // Trial is only relevant before any paid Store license exists.
  if (hasPaidStoreLicense()) {
    return null;
  }

  let startedAtMs = readTrialStartMs();
  if (!startedAtMs) {
    startedAtMs = getNowMs();
    return writeTrialStartMs(startedAtMs);
  }

  return new Date(startedAtMs).toISOString();
}

export function getTrialInfo() {
  const startedAtMs = readTrialStartMs();
  const startedAt = startedAtMs ? new Date(startedAtMs).toISOString() : null;

  if (!startedAtMs) {
    return {
      enabled: true,
      startedAt: null,
      daysUsed: 0,
      daysTotal: TRIAL_DAYS_TOTAL,
      expired: false
    };
  }

  const elapsedMs = Math.max(0, getNowMs() - startedAtMs);
  const dayMs = 24 * 60 * 60 * 1000;
  const daysUsed = Math.min(TRIAL_DAYS_TOTAL, Math.ceil(elapsedMs / dayMs) || 0);
  const expired = elapsedMs >= TRIAL_DAYS_TOTAL * dayMs;

  return {
    enabled: true,
    startedAt,
    daysUsed,
    daysTotal: TRIAL_DAYS_TOTAL,
    expired
  };
}

export function isProEnabled() {
  return licenseTier === "pro" || isTrialActive();
}

export function isTrialActive() {
  // Paid Store licenses override trial needs.
  if (hasPaidStoreLicense()) {
    return false;
  }

  ensureTrialStart();
  const info = getTrialInfo();
  return info.enabled && !info.expired;
}

export function isOpenAITrialOrProEnabled() {
  return licenseTier === "pro" || isTrialActive();
}

export function isBasicEnabled() {
  return licenseTier === "basic" || licenseTier === "pro" || isTrialActive();
}

// Compatibility helper: keep old callers from crashing.
export function setProEnabled(v) {
  licenseTier = v ? "pro" : "";
}

export function refreshLicenseStateFromStorage() {
  licenseTier = getEffectiveLicenseTier();

  // If there is no paid license, make sure trial starts automatically.
  if (!hasPaidStoreLicense()) {
    ensureTrialStart();
  }

  return licenseTier;
}

export function shouldShowActivateButton() {
  // During trial, user can still see activation / upgrade paths.
  return licenseTier !== "basic" && licenseTier !== "pro";
}

export function getLicenseTier() {
  return licenseTier;
}

export function getLicenseStatus() {
  const store = getStoreLicenseSnapshot();

  return {
    tier: licenseTier,
    trial: getTrialInfo(),
    store
  };
}

// Manual offline code activation is disabled in the Store/MSIX flow.
export function validateProCode(_code) {
  return false;
}

export function validateBasicCode(_code) {
  return false;
}

export async function activateLicenseKey(_input) {
  return {
    ok: false,
    error: "Manual license code activation is disabled in the Microsoft Store build."
  };
}

async function invokeStoreBridge(methodName) {
  try {
    const api = window?.npStore || window?.npStoreLicense || window?.storeLicense || null;
    if (!api || typeof api[methodName] !== "function") {
      return { ok: false, error: "Store bridge not available." };
    }
    const res = await api[methodName]();
    return res || { ok: false, error: "Empty store response." };
  } catch (e) {
    return { ok: false, error: e?.message || "Store bridge failed." };
  }
}

function normalizeStoreResult(res) {
  const tier = String(res?.tier || "").trim().toLowerCase();
  const basicExpiresISO = String(res?.basicExpiresISO || "").trim();
  const proExpiresISO = String(res?.proExpiresISO || "").trim();

  return {
    tier,
    basicExpiresISO,
    proExpiresISO
  };
}

export async function refreshStoreLicenseStatus() {
  const res = await invokeStoreBridge("getStatus");
  if (!res || !res.ok) {
    refreshLicenseStateFromStorage();
    return {
      ok: false,
      error: res?.error || "Store license status unavailable.",
      tier: licenseTier
    };
  }

  const normalized = normalizeStoreResult(res);
  setStoreLicenseSnapshot(normalized);
  refreshLicenseStateFromStorage();

  return {
    ok: true,
    tier: licenseTier,
    ...normalized
  };
}

export async function purchaseBasicLicense() {
  const res = await invokeStoreBridge("purchaseBasic");
  if (!res || !res.ok) {
    return { ok: false, error: res?.error || "Basic purchase failed." };
  }

  const normalized = normalizeStoreResult(res);
  setStoreLicenseSnapshot(normalized);
  refreshLicenseStateFromStorage();

  return {
    ok: true,
    tier: licenseTier,
    ...normalized
  };
}

export async function purchaseProLicense() {
  const res = await invokeStoreBridge("purchasePro");
  if (!res || !res.ok) {
    return { ok: false, error: res?.error || "Pro purchase failed." };
  }

  const normalized = normalizeStoreResult(res);
  setStoreLicenseSnapshot(normalized);
  refreshLicenseStateFromStorage();

  return {
    ok: true,
    tier: licenseTier,
    ...normalized
  };
}

export function clearAllLocalLicenses() {
  clearStoreLicenseSnapshot();
  clearBasicLicense();
  clearProLicense();
  safeLocalStorageRemove(TRIAL_STORAGE_KEY);
  refreshLicenseStateFromStorage();
}

// Ensure trial exists as early as possible for local / unpacked runs.
refreshLicenseStateFromStorage();