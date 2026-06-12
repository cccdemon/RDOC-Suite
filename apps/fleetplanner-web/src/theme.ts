import { useEffect, useState } from "react";

// Manufacturer accent themes (design README §73). Applied as a global root
// `filter` on .app-root — faithful to the prototype and the only way the special
// modes (terminal/light/crt) work. `dot` is the swatch shown in the footer picker.
export type Theme = {
  id: string;
  label: string;
  filter: string;
  dot: string;
};

export const THEMES: Theme[] = [
  { id: "raumdock", label: "Raumdock", filter: "none", dot: "#00d4ff" },
  { id: "drake", label: "Drake Interplanetary", filter: "hue-rotate(-72deg) saturate(1.12) brightness(1.02)", dot: "#5ee06a" },
  { id: "aegis", label: "Aegis Dynamics", filter: "hue-rotate(14deg) saturate(0.92) brightness(1.05)", dot: "#5cc6ff" },
  { id: "anvil", label: "Anvil Aerospace", filter: "hue-rotate(-82deg) saturate(0.78) brightness(1.1)", dot: "#a8e6a0" },
  { id: "rsi", label: "RSI", filter: "hue-rotate(-168deg) saturate(1.28) brightness(1.02)", dot: "#ff7a2b" },
  { id: "origin", label: "Origin Jumpworks", filter: "hue-rotate(20deg) saturate(0.5) brightness(1.14)", dot: "#dbe8ff" },
  { id: "misc", label: "MISC", filter: "hue-rotate(34deg) saturate(1.4) brightness(0.92)", dot: "#3a7bee" },
  { id: "terminal", label: "Terminal Mode", filter: "grayscale(1) sepia(1) hue-rotate(-12deg) saturate(2.7) brightness(1.08) contrast(1.04)", dot: "#ffb000" },
  { id: "light", label: "Light Mode", filter: "invert(1) hue-rotate(180deg) brightness(1.06)", dot: "#1b2733" },
  { id: "crt", label: "Green CRT", filter: "grayscale(1) sepia(1) hue-rotate(62deg) saturate(2.8) brightness(1.06) contrast(1.05)", dot: "#00ff88" },
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
  }, [theme.id]);

  return { theme, setThemeId: setId };
}
