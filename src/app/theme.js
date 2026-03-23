// FILE: src/app/theme.js
// Theme handling: light / dark toggle stored in localStorage.

const STORAGE_KEY = "np_theme";

export function getInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      return saved;
    }
  } catch (_) {
    // ignore
  }
  // Default should be LIGHT for better readability
  return "light";
}

export function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  const root = document.documentElement;

  root.setAttribute("data-theme", t);

  // Optional body helper class if CSS ever uses it
  if (document.body) {
    document.body.classList.toggle("light", t === "light");
  }

  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch (_) {
    // ignore
  }

  return t;
}

export function toggleTheme() {
  const root = document.documentElement;
  const current = root.getAttribute("data-theme") || getInitialTheme();
  const next = current === "dark" ? "light" : "dark";
  return applyTheme(next);
}
