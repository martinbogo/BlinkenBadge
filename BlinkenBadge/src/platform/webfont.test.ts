import { describe, expect, it } from "vitest";
import { fontMetrics, layout } from "./webfont";

describe("shipped pixel fonts", () => {
  it("exposes twelve selectable faces with the same alphabet coverage", () => {
    const faces = fontMetrics().filter((f) => f.pickable);
    expect(faces.map((f) => f.name)).toEqual([
      "Serif",
      "Sans",
      "Cartoon",
      "Futuristic",
      "Comic",
      "Arcade",
      "Terminal",
      "Stencil",
      "Outline",
      "Tiny",
      "Punk",
      "Script",
    ]);
    const base = faces[0].advances.map(([c]) => c).sort();
    for (const face of faces) {
      expect(face.advances.map(([c]) => c).sort()).toEqual(base);
      const result = layout("Café Привет 0123!?", face.id);
      expect(result.missing).toEqual([]);
      expect(result.rows).toHaveLength(11);
    }
  });
  it("renders a different design for each face", () => {
    const bitmaps = fontMetrics()
      .filter((f) => f.pickable)
      .map((f) => JSON.stringify(layout("Abc Hello 0123!?", f.id).rows));
    expect(new Set(bitmaps).size).toBe(12);
  });
  it("preserves accent ink at every handwriting offset", () => {
    for (const id of ["cartoon", "comic"]) {
      const count = (text: string) =>
        layout(text, id).rows.flat().filter(Boolean).length;
      const ink = count("É");
      for (let i = 1; i < 12; i++) expect(count(" ".repeat(i) + "É")).toBe(ink);
    }
  });
  it("keeps Terminal monospaced and Tiny compact", () => {
    expect(layout("iiii", "terminal").width).toBe(
      layout("MMMM", "terminal").width,
    );
    expect(layout("Hello", "tiny").width).toBeLessThan(
      layout("Hello", "sans").width,
    );
  });
});

it("joins Script letters at the baseline without changing measured widths", () => {
  const advance = fontMetrics()
    .find((f) => f.id === "script")!
    .advances.find(([c]) => c === "a")![1];
  const result = layout("aa", "script");
  expect(result.width).toBe(advance * 2);
  expect(result.rows[7][advance]).toBe(true);
});
