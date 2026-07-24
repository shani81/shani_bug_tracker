"use client";

import * as React from "react";

type ThemeState = {
  theme: "light" | "dark";
  density: "cozy" | "compact";
  contrast: "normal" | "high";
};

type ThemeCtx = ThemeState & {
  setTheme: (t: ThemeState["theme"]) => void;
  toggleTheme: () => void;
  setDensity: (d: ThemeState["density"]) => void;
  setContrast: (c: ThemeState["contrast"]) => void;
};

const Ctx = React.createContext<ThemeCtx | null>(null);

const KEYS = { theme: "bt-theme", density: "bt-density", contrast: "bt-contrast" } as const;

function apply(state: ThemeState) {
  const el = document.documentElement;
  el.setAttribute("data-theme", state.theme);
  el.setAttribute("data-density", state.density);
  el.setAttribute("data-contrast", state.contrast);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ThemeState>({
    theme: "light",
    density: "cozy",
    contrast: "normal",
  });

  // hydrate from what the pre-paint script already set on <html>
  React.useEffect(() => {
    const el = document.documentElement;
    setState({
      theme: (el.getAttribute("data-theme") as ThemeState["theme"]) || "light",
      density: (el.getAttribute("data-density") as ThemeState["density"]) || "cozy",
      contrast: (el.getAttribute("data-contrast") as ThemeState["contrast"]) || "normal",
    });
  }, []);

  const update = React.useCallback((patch: Partial<ThemeState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      apply(next);
      try {
        localStorage.setItem(KEYS.theme, next.theme);
        localStorage.setItem(KEYS.density, next.density);
        localStorage.setItem(KEYS.contrast, next.contrast);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value: ThemeCtx = {
    ...state,
    setTheme: (theme) => update({ theme }),
    toggleTheme: () => update({ theme: state.theme === "dark" ? "light" : "dark" }),
    setDensity: (density) => update({ density }),
    setContrast: (contrast) => update({ contrast }),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

// Blocking script injected in <head> to set theme attributes before first paint
// (prevents a flash of the wrong theme).
export const themeInitScript = `
(function(){
  try {
    var t = localStorage.getItem('bt-theme');
    if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    var d = localStorage.getItem('bt-density') || 'cozy';
    var c = localStorage.getItem('bt-contrast') || 'normal';
    var el = document.documentElement;
    el.setAttribute('data-theme', t);
    el.setAttribute('data-density', d);
    el.setAttribute('data-contrast', c);
  } catch(e) {}
})();
`;
