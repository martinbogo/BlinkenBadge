// @vitest-environment jsdom
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { applyTheme, readTheme, useTheme } from "./theme";

function systemPrefersDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: dark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

describe("theme", () => {
  it("defaults to auto, and ignores anything it did not write", () => {
    expect(readTheme()).toBe("auto");
    localStorage.setItem("blinkenbadge.theme", "purple");
    expect(readTheme()).toBe("auto");
  });

  it("follows the system on auto", () => {
    systemPrefersDark(true);
    applyTheme("auto");
    expect(document.documentElement.dataset.theme).toBe("dark");
    systemPrefersDark(false);
    applyTheme("auto");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("lets an explicit choice override the system", () => {
    systemPrefersDark(true);
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    systemPrefersDark(false);
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("remembers a choice and applies it", () => {
    systemPrefersDark(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe("auto");
    act(() => result.current[1]("light"));
    expect(result.current[0]).toBe("light");
    expect(localStorage.getItem("blinkenbadge.theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(readTheme()).toBe("light");
  });
});
