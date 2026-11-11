declare const __BADGE_HOST__: string;

export const nativeMobile =
  typeof __BADGE_HOST__ !== "undefined" &&
  ["ios", "android"].includes(__BADGE_HOST__);
export const mobileHost =
  nativeMobile ||
  new URLSearchParams(location.search).has("mobile") ||
  /Android|iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
