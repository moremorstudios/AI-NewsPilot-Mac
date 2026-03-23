// FILE: src/app/state.js
const listeners = new Set();

let state = {
  language: "en",
  languageList: [],
  ui: {
    engine: "local",
    style: "agency",
    tone: 2,
    lengthPreset: "medium",
    targetWords: null,
    status: "",
    costInfo: "",
    precheckHint: ""
  },
  inputs: {
    sourceText: "",
    w5h1: {
      who: "", what: "", when: "", where: "", why: "", how: ""
    },
    authorName: "",
    authorLocation: ""
  },
  versions: {
    items: [],
    activeIndex: 0
  },
  draft: {
    text: ""
  },
  voices: [],
  final: {
    text: ""
  }
};

export function initState() {
  // keep defaults; no-op for now
  return state;
}

export function getState() {
  return state;
}

export function setState(patch) {
  // shallow merge top-level + nested known objects
  state = {
    ...state,
    ...patch,
    ui: { ...state.ui, ...(patch.ui || {}) },
    inputs: { ...state.inputs, ...(patch.inputs || {}) },
    versions: { ...state.versions, ...(patch.versions || {}) },
    draft: { ...state.draft, ...(patch.draft || {}) },
    voices: Array.isArray(patch.voices) ? patch.voices : state.voices,
    final: { ...state.final, ...(patch.final || {}) }
  };
  listeners.forEach((fn) => {
    try { fn(state); } catch (_) {}
  });
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
