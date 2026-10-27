import { describe, expect, it } from "vitest";
import {
  checkDocumentSize,
  imageLayout,
  MAX_BITMAP_WIDTH,
  MAX_DOCUMENT_BYTES,
} from "./limits";

describe("import allocation limits", () => {
  it("rejects excessive filmstrips before allocating canvas or frames", () => {
    expect(imageLayout(352, 11, true)).toEqual({ width: 352, count: 8 });
    expect(() => imageLayout(353, 11, true)).toThrow(/8 frames/);
    expect(() => imageLayout(MAX_BITMAP_WIDTH + 1, 11, false)).toThrow(
      /columns/,
    );
  });
  it("bounds source pixels and rejects invalid dimensions", () => {
    expect(() => imageLayout(10000, 10000, false)).toThrow(/megapixels/);
    for (const value of [0, -1, NaN, Infinity])
      expect(() => imageLayout(value, 11, false)).toThrow();
  });
  it("counts UTF-8 bytes rather than only string length", () => {
    expect(() =>
      checkDocumentSize("é".repeat(MAX_DOCUMENT_BYTES / 2 + 1)),
    ).toThrow(/8 MiB/);
  });
});
