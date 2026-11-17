// Copyright 2026 Martin Bogomolni
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { useCallback, useEffect, useState } from "react";

/**
 * Light, dark, or whatever the system says.
 *
 * The choice is kept in localStorage, which the browser and the desktop
 * webview both persist; nothing needs a cookie, since no server ever reads it.
 * The resolved theme is written to <html data-theme>, which is all the
 * stylesheets look at. The LED surfaces (canvas, preview, badge) stay dark in
 * both: they depict a panel of unlit LEDs.
 */
export type ThemeChoice = "auto" | "light" | "dark";

export const THEME_CHOICES: ThemeChoice[] = ["auto", "light", "dark"];

const KEY = "blinkenbadge.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark" || saved === "auto") return saved;
  } catch {
    // Storage can be off (private windows, blocked site data). Auto it is.
  }
  return "auto";
}

function systemDark(): boolean {
  return typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches;
}

/** Write the resolved theme to the document. Safe to call before React. */
export function applyTheme(choice: ThemeChoice): void {
  const dark = choice === "dark" || (choice === "auto" && systemDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

/** The current choice and a setter that applies and remembers it. */
export function useTheme(): [ThemeChoice, (next: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);

  useEffect(() => {
    applyTheme(choice);
    if (choice !== "auto" || typeof matchMedia !== "function") return;
    // Follow the system while on auto, including a change at sunset.
    const query = matchMedia(DARK_QUERY);
    const follow = () => applyTheme("auto");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [choice]);

  const choose = useCallback((next: ThemeChoice) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Not remembered, but still applied for this session.
    }
    setChoice(next);
  }, []);

  return [choice, choose];
}

export const THEME_LABELS: Record<ThemeChoice, string> = {
  auto: "Auto",
  light: "Light",
  dark: "Dark",
};
