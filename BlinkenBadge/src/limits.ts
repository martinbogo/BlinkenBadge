import {
  ANIMATION_MAX_FRAMES,
  BADGE_HEIGHT,
  BADGE_WIDTH,
  MAX_BYTE_COLUMNS,
  MAX_MESSAGES,
} from "./types";

/** Limits apply before decoding or allocating imported artwork. */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
export const MAX_BITMAP_WIDTH = MAX_BYTE_COLUMNS * 8;
export const MAX_PROJECT_PIXELS =
  MAX_MESSAGES * MAX_BITMAP_WIDTH * BADGE_HEIGHT;
export const MAX_SOURCE_IMAGE_PIXELS = 32 * 1024 * 1024;

export function imageLayout(width: number, height: number, asFrames: boolean) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new Error("That image has no pixels.");
  }
  if (width * height > MAX_SOURCE_IMAGE_PIXELS)
    throw new Error("Image exceeds 32 megapixels.");
  const scaledWidth = Math.max(1, Math.round((width * BADGE_HEIGHT) / height));
  const limit = asFrames
    ? BADGE_WIDTH * ANIMATION_MAX_FRAMES
    : MAX_BITMAP_WIDTH;
  if (scaledWidth > limit) {
    throw new Error(
      asFrames
        ? "A slot holds up to 8 frames."
        : `Image exceeds ${MAX_BITMAP_WIDTH} columns.`,
    );
  }
  return {
    width: scaledWidth,
    count: asFrames ? Math.ceil(scaledWidth / BADGE_WIDTH) : 1,
  };
}

export function checkDocumentSize(text: string) {
  if (
    text.length > MAX_DOCUMENT_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES
  ) {
    throw new Error("Document exceeds the 8 MiB limit.");
  }
}
