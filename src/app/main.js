// FILE: src/app/main.js

import { getInitialTheme, applyTheme, toggleTheme } from "./theme.js";
import { initState, getState, setState } from "./state.js";
import { bindUI, renderAll } from "./ui.js";
import { loadI18n, getLangList } from "../utils/i18n.js";

function detectLang() {
  const nav = (navigator.language || "en").toLowerCase();
  const code = nav.includes("-") ? nav.split("-")[0] : nav;
  return (code || "en").slice(0, 2);
}

function boot() {
  initState();

  // Theme init + icon
  applyTheme(getInitialTheme());
  const btnTheme = document.getElementById("btnToggleDark");
  const syncIcon = () => {
    if (!btnTheme) return;
    const theme = document.documentElement.getAttribute("data-theme") || "light";
    btnTheme.textContent = theme === "dark" ? "🌙" : "☀️";
    btnTheme.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  };
  if (btnTheme) {
    btnTheme.addEventListener("click", () => {
      toggleTheme();
      syncIcon();
    });
    syncIcon();
  }

  // Languages
  const initialLang = detectLang();
  setState({ language: initialLang, languageList: getLangList() });

  loadI18n(initialLang)
  .then((pack) => {
    // i18n paketini state’e koymazsan UI çeviremez
    setState({ language: pack.lang, i18n: pack });
    // HTML lang/dir ayarı (RTL için)
    document.documentElement.lang = pack.lang || "en";
    const rtl = new Set(["ar", "fa", "ur", "he"]);
    document.documentElement.dir = rtl.has(pack.lang) ? "rtl" : "ltr";
  })
  .catch(() => {})
  .finally(() => {
    bindUI();
    renderAll(getState());
  });

}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
