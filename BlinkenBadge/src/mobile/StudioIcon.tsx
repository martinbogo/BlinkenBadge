export type StudioGlyph =
  | "send"
  | "cut"
  | "paste"
  | "check"
  | "undo"
  | "redo"
  | "play"
  | "pause"
  | "left"
  | "right"
  | "copy"
  | "plus"
  | "onion"
  | "more"
  | "expand"
  | "collapse";
const paths: Record<StudioGlyph, string> = {
  send: "m3 3 18 9-18 9 4-9-4-9Zm4 9h14",
  cut: "m9 8 11 12M9 16 20 4M7 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  paste: "M9 5H5v16h14V5h-4M9 3h6v4H9V3Zm-1 9h8m-8 4h8",
  check: "m4 12 5 5L20 6",
  undo: "M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12",
  redo: "m15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12",
  play: "m8 4 12 8-12 8V4Z",
  pause: "M8 4v16M16 4v16",
  left: "m15 5-7 7 7 7",
  right: "m9 5 7 7-7 7",
  copy: "M8 8h12v12H8V8ZM4 15V4h11",
  plus: "M12 4v16M4 12h16",
  onion:
    "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  more: "M4 12h1m6 0h1m6 0h1",
  expand: "M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6",
  collapse: "M3 9h6V3m6 0v6h6M9 21v-6H3m12 6v-6h6",
};
export default function StudioIcon({ name }: { name: StudioGlyph }) {
  return (
    <svg
      className="studio-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
