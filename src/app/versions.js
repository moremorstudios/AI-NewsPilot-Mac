// FILE: src/app/versions.js
// Version management for generated packages.

import { getState, setState } from "./state.js";

const MAX_VERSIONS = 10; // keep last 10 versions in memory

export function clearVersions() {
  setState({ versions: { items: [], activeIndex: -1 } });
}

/**
 * Allow regeneration while we are below the cap.
 * (UI may ignore this; cap is enforced in addVersion via trimming.)
 */
export function canRegenerate() {
  const s = getState();
  const items =
    s.versions && Array.isArray(s.versions.items)
      ? s.versions.items
      : [];
  return items.length < MAX_VERSIONS;
}

export function addVersion(pkg) {
  const s = getState();
  const current =
    s.versions && Array.isArray(s.versions.items)
      ? s.versions.items
      : [];

  const items = [...current, pkg];
  const trimmed = items.slice(-MAX_VERSIONS);

  setState({
    versions: {
      items: trimmed,
      activeIndex: trimmed.length ? trimmed.length - 1 : -1,
    },
  });
}

export function setActiveVersion(index) {
  const s = getState();
  const items =
    s.versions && Array.isArray(s.versions.items)
      ? s.versions.items
      : [];

  if (!items.length) {
    setState({ versions: { items: [], activeIndex: -1 } });
    return;
  }

  const max = items.length - 1;
  const i = Math.max(0, Math.min(index, max));
  setState({
    versions: {
      items,
      activeIndex: i,
    },
  });
}

export function getActivePackage() {
  const s = getState();
  const items =
    s.versions && Array.isArray(s.versions.items)
      ? s.versions.items
      : [];

  if (!items.length) return null;
  const idx =
    typeof s.versions.activeIndex === "number"
      ? s.versions.activeIndex
      : items.length - 1;

  if (idx < 0 || idx >= items.length) return null;
  return items[idx] || null;
}
