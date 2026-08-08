import { useEffect, useState } from "react";

// Manufacturer accent themes (design README §73). Applied as a global root
// `filter` on .app-root — faithful to the prototype and the only way the special
// modes (terminal/crt) work. `dot` is the swatch shown in the footer picker.
//
// Brand note: "raumdock" is the default and the only brand-correct entry — it
// applies no filter, so the RDOC palette (Space/Graphite/Steel/Off White/Copper/
// Patina, see styles.css) renders as specified. The manufacturer filters are a
// deliberate exception: hue-rotating Copper leaves the brand colour space on
// purpose, as an in-fiction toy. Never make one of them the default, and never
// reuse a filtered screenshot as brand material.
//
// "Light Mode" is NOT one of those toys. Brandkit v2.2 ships a light palette
// that was measured, not inverted — Copper only reaches 2.65:1 on Off White and
// drops to Copper Deep there. So the light entry carries `scheme: "light"`,
// which sets `data-theme="light"` on <html> and swaps the tokens, instead of the
// old `invert(1) hue-rotate(180deg)` filter that also inverted every logo,
// avatar and mission cover on the page.
export type Theme = {
  id: string;
  label: string;
  filter: string;
  dot: string;
  /** Swaps the token palette via `data-theme` instead of filtering pixels. */
  scheme?: "light";
};

export const THEMES: Theme[] = [
  { id: "raumdock", label: "Raumdock", filter: "none", dot: "var(--accent)" },
  { id: "drake", label: "Drake Interplanetary", filter: "hue-rotate(-72deg) saturate(1.12) brightness(1.02)", dot: "#5ee06a" },
  { id: "aegis", label: "Aegis Dynamics", filter: "hue-rotate(14deg) saturate(0.92) brightness(1.05)", dot: "#5cc6ff" },
  { id: "anvil", label: "Anvil Aerospace", filter: "hue-rotate(-82deg) saturate(0.78) brightness(1.1)", dot: "#a8e6a0" },
  { id: "rsi", label: "RSI", filter: "hue-rotate(-168deg) saturate(1.28) brightness(1.02)", dot: "var(--orange)" },
  { id: "origin", label: "Origin Jumpworks", filter: "hue-rotate(20deg) saturate(0.5) brightness(1.14)", dot: "#dbe8ff" },
  { id: "misc", label: "MISC", filter: "hue-rotate(34deg) saturate(1.4) brightness(0.92)", dot: "#3a7bee" },
  { id: "terminal", label: "Terminal Mode", filter: "grayscale(1) sepia(1) hue-rotate(-12deg) saturate(2.7) brightness(1.08) contrast(1.04)", dot: "var(--gold)" },
  { id: "light", label: "Light Mode", filter: "none", dot: "#8a5a22", scheme: "light" },
  { id: "crt", label: "Green CRT", filter: "grayscale(1) sepia(1) hue-rotate(62deg) saturate(2.8) brightness(1.06) contrast(1.05)", dot: "var(--green)" },
];

const STORAGE_KEY = "fpw-theme";

export function useTheme(): { theme: Theme; setThemeId: (id: string) => void } {
  const [id, setId] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? "raumdock";
    } catch {
      return "raumdock";
    }
  });
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme.id);
    } catch {
      /* ignore */
    }
    // The token overrides live on `[data-theme="light"]`, which has to sit on
    // the same element as `:root` — not on .app-root, or the tokens the body
    // background reads would never be reassigned.
    const root = document.documentElement;
    if (theme.scheme) root.setAttribute("data-theme", theme.scheme);
    else root.removeAttribute("data-theme");
  }, [theme.id, theme.scheme]);

  return { theme, setThemeId: setId };
}
