import { useEffect, useState } from "react";
import { platform } from "../platform";
import type { Frame } from "../types";

export default function FontChoice({
  face,
  selected,
  onSelect,
}: {
  face: { id: string; name: string };
  selected: boolean;
  onSelect(): void;
}) {
  const [rows, setRows] = useState<Frame | null>(null);
  useEffect(() => {
    let live = true;
    void platform
      .renderText("Badge", face.id)
      .then((bitmap) => {
        if (live) setRows(bitmap.rows);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [face.id]);
  return (
    <button
      className="mobile-font-choice"
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span>{face.name}</span>
      {rows && (
        <svg viewBox={`0 0 ${rows[0]?.length ?? 44} 11`} aria-hidden="true">
          {rows.flatMap((row, y) =>
            row.map((lit, x) =>
              lit ? (
                <rect key={`${x}:${y}`} x={x} y={y} width="1" height="1" />
              ) : null,
            ),
          )}
        </svg>
      )}
    </button>
  );
}
