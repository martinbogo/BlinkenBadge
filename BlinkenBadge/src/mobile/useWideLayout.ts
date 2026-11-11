import { useEffect, useState } from "react";

/**
 * Tablet-sized screens (iPad in either orientation, large Android tablets) get
 * the studio layout: slots stay visible beside the editor, as on the desktop.
 * The height floor keeps phones in landscape on the single-column layout.
 */
export const WIDE_QUERY = "(min-width: 744px) and (min-height: 600px)";

const query = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(WIDE_QUERY)
    : null;

export function useWideLayout(): boolean {
  const [wide, setWide] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const list = query();
    if (!list) return;
    const change = () => setWide(list.matches);
    change();
    list.addEventListener?.("change", change);
    return () => list.removeEventListener?.("change", change);
  }, []);
  return wide;
}
