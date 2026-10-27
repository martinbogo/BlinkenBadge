import { useEffect, useRef, useState } from "react";
import {
  applyPoints,
  clearRect,
  ellipsePoints,
  expandBrush,
  extractRect,
  floodFillPoints,
  linePoints,
  normalizeRect,
  pasteBlock,
  rectContains,
  rectPoints,
  type Point,
  type Rect,
} from "../draw";
import type { Frame, Tool } from "../types";

export type MobileTool = Tool | "pan";
interface View {
  cell: number;
  offset: number;
  offsetY: number;
}
interface Stroke {
  base: Frame;
  draft: Frame;
  start: Point;
  last: Point;
  value: boolean;
  mode: "paint" | "shape" | "select" | "move";
  selection: Rect | null;
}

export default function MobileCanvas({
  frame,
  onionFrame,
  tool,
  onChange,
  selection = null,
  onSelectionChange,
  brushSize = 1,
  filled = false,
  fitVersion = 0,
  zoomVersion = 0,
}: {
  frame: Frame;
  onionFrame?: Frame | null;
  tool: MobileTool;
  onChange(frame: Frame, history: boolean): void;
  selection?: Rect | null;
  onSelectionChange?(rect: Rect | null): void;
  brushSize?: number;
  filled?: boolean;
  fitVersion?: number;
  zoomVersion?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 300, height: 400 });
  const [view, setView] = useState<View>({ cell: 26, offset: 0, offsetY: 0 });
  const pointers = useRef(new Map<number, Point>());
  const stroke = useRef<Stroke | null>(null);
  const gesture = useRef<{
    distance: number;
    view: View;
    center: number;
    centerY: number;
  } | null>(null);
  const pan = useRef<{
    x: number;
    y: number;
    offset: number;
    offsetY: number;
  } | null>(null);
  const [preview, setPreview] = useState<Frame | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const width = frame[0]?.length ?? 44;
  const normalize = (v: View): View => ({
    cell: Math.max(6, Math.min(64, v.cell)),
    offsetY: Math.max(
      0,
      Math.min(Math.max(0, 11 * v.cell + 24 - size.height), v.offsetY),
    ),
    offset: Math.max(
      0,
      Math.min(Math.max(0, width * v.cell - size.width), v.offset),
    ),
  });
  useEffect(() => {
    const element = host.current!;
    const resize = () =>
      setSize({
        width: element.clientWidth || 300,
        height: element.clientHeight || 400,
      });
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setView((v) => ({
      ...v,
      offset: Math.min(v.offset, Math.max(0, width * v.cell - size.width)),
      offsetY: Math.min(v.offsetY, Math.max(0, 11 * v.cell + 24 - size.height)),
    }));
  }, [size.width, size.height, width]);
  useEffect(() => {
    if (fitVersion)
      setView({
        cell: Math.max(
          6,
          Math.min(
            48,
            Math.floor((size.width - 16) / width),
            Math.floor((size.height - 20) / 11),
          ),
        ),
        offset: 0,
        offsetY: 0,
      });
  }, [fitVersion]);
  useEffect(() => {
    if (zoomVersion)
      setView((v) =>
        normalize({
          cell: v.cell * 1.5,
          offset: v.offset * 1.5,
          offsetY: v.offsetY * 1.5,
        }),
      );
  }, [zoomVersion]);
  useEffect(() => {
    stroke.current = null;
    gesture.current = null;
    pan.current = null;
    pointers.current.clear();
    setPreview(null);
    setMarquee(null);
  }, [frame]);
  const top = Math.max(12, (size.height - 11 * view.cell) / 2);
  const left = Math.max(0, (size.width - width * view.cell) / 2);
  const point = (p: Point): Point => ({
    x: Math.floor((p.x - left + view.offset) / view.cell),
    y: Math.floor((p.y - top + view.offsetY) / view.cell),
  });
  const inside = (p: Point) => p.x >= 0 && p.x < width && p.y >= 0 && p.y < 11;
  const position = (e: React.PointerEvent): Point => {
    const b = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const movedRect = (s: Stroke): Rect | null =>
    s.selection && {
      x0: s.selection.x0 + s.last.x - s.start.x,
      x1: s.selection.x1 + s.last.x - s.start.x,
      y0: s.selection.y0 + s.last.y - s.start.y,
      y1: s.selection.y1 + s.last.y - s.start.y,
    };
  const paint = (p: Point) => {
    const s = stroke.current;
    if (!s || !inside(p)) return;
    if (s.mode === "paint") {
      const points =
        tool === "fill"
          ? floodFillPoints(s.base, s.start)
          : expandBrush(linePoints(s.last, p), brushSize);
      s.draft = applyPoints(s.draft, points, s.value);
    } else if (s.mode === "shape") {
      const points =
        tool === "line"
          ? expandBrush(linePoints(s.start, p), brushSize)
          : tool === "rect"
            ? rectPoints(s.start, p, filled)
            : ellipsePoints(s.start, p, filled);
      s.draft = applyPoints(s.base, points, s.value);
    }
    s.last = p;
    if (s.mode === "select") setMarquee(normalizeRect(s.start, p));
    if (s.mode === "move" && s.selection) {
      const next = movedRect(s)!;
      s.draft = pasteBlock(
        clearRect(s.base, s.selection),
        extractRect(s.base, s.selection),
        next.x0,
        next.y0,
        true,
      );
      setMarquee(next);
    }
    setPreview(s.draft);
  };
  const finish = (cancelled = false) => {
    const s = stroke.current;
    if (s && !cancelled) {
      if (s.mode === "select")
        onSelectionChange?.(normalizeRect(s.start, s.last));
      else {
        if (s.draft !== s.base) onChange(s.draft, true);
        if (s.mode === "move") onSelectionChange?.(movedRect(s));
      }
    }
    stroke.current = null;
    setPreview(null);
    setMarquee(null);
  };
  const first = Math.max(0, Math.floor(view.offset / view.cell));
  const last = Math.min(
    width,
    Math.ceil((view.offset + size.width) / view.cell),
  );
  const shown = preview ?? frame;
  const selected = marquee ?? selection;
  return (
    <div className="mobile-canvas-host" ref={host}>
      <span className="mobile-zoom-label">
        {width * view.cell > size.width ? "Pinch to Zoom" : "Full View"}
      </span>
      <svg
        className="mobile-pixel-canvas"
        width="100%"
        height="100%"
        role="img"
        aria-label={`${width} by 11 pixel canvas; ${tool}`}
        aria-describedby="mobile-canvas-help"
        tabIndex={0}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.button !== 2) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = position(e);
          pointers.current.set(e.pointerId, p);
          if (pointers.current.size >= 2) {
            finish(true);
            pan.current = null;
            const [a, b] = [...pointers.current.values()];
            gesture.current = {
              distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
              view,
              center: (a.x + b.x) / 2,
              centerY: (a.y + b.y) / 2,
            };
            return;
          }
          if (gesture.current) return;
          if (tool === "pan") {
            pan.current = {
              x: p.x,
              y: p.y,
              offset: view.offset,
              offsetY: view.offsetY,
            };
            return;
          }
          const cell = point(p);
          if (!inside(cell)) return;
          const mode =
            tool === "select"
              ? selection && rectContains(selection, cell)
                ? "move"
                : "select"
              : ["line", "rect", "ellipse"].includes(tool)
                ? "shape"
                : "paint";
          stroke.current = {
            base: frame,
            draft: frame,
            start: cell,
            last: cell,
            value:
              tool === "fill"
                ? !frame[cell.y][cell.x]
                : e.button !== 2 && tool !== "eraser",
            mode,
            selection,
          };
          paint(cell);
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return;
          const p = position(e);
          pointers.current.set(e.pointerId, p);
          if (pointers.current.size >= 2 && gesture.current) {
            const [a, b] = [...pointers.current.values()],
              g = gesture.current;
            const cell = Math.max(
              6,
              Math.min(
                64,
                (g.view.cell * Math.hypot(a.x - b.x, a.y - b.y)) / g.distance,
              ),
            );
            const anchor = (g.center + g.view.offset - left) / g.view.cell;
            setView(
              normalize({
                cell,
                offset:
                  anchor * cell -
                  (a.x + b.x) / 2 +
                  Math.max(0, (size.width - width * cell) / 2),
                offsetY:
                  ((g.centerY + g.view.offsetY - top) / g.view.cell) * cell -
                  (a.y + b.y) / 2 +
                  Math.max(12, (size.height - 11 * cell) / 2),
              }),
            );
          } else if (pan.current)
            setView(
              normalize({
                ...view,
                offset: pan.current.offset - p.x + pan.current.x,
                offsetY: pan.current.offsetY - p.y + pan.current.y,
              }),
            );
          else if (!gesture.current && tool !== "fill") paint(point(p));
        }}
        onPointerUp={(e) => {
          if (!gesture.current && !pan.current && tool !== "fill")
            paint(point(position(e)));
          finish();
          pointers.current.delete(e.pointerId);
          if (!pointers.current.size) {
            gesture.current = null;
            pan.current = null;
          }
        }}
        onPointerCancel={(e) => {
          finish(true);
          pointers.current.delete(e.pointerId);
          if (!pointers.current.size) {
            gesture.current = null;
            pan.current = null;
          }
        }}
        onKeyDown={(e) => {
          const p = cursor ?? { x: first, y: 0 };
          if (
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
          ) {
            e.preventDefault();
            const next = {
              x: Math.max(
                0,
                Math.min(
                  width - 1,
                  p.x +
                    (e.key === "ArrowRight"
                      ? 1
                      : e.key === "ArrowLeft"
                        ? -1
                        : 0),
                ),
              ),
              y: Math.max(
                0,
                Math.min(
                  10,
                  p.y +
                    (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0),
                ),
              ),
            };
            setCursor(next);
            if (next.x < first || next.x >= last)
              setView(
                normalize({
                  ...view,
                  offset: next.x * view.cell - size.width / 2,
                }),
              );
          } else if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onChange(applyPoints(frame, [p], !frame[p.y][p.x]), true);
          }
        }}
      >
        {shown.flatMap((row, y) =>
          row
            .slice(first, last)
            .map((lit, i) => (
              <rect
                key={`${i + first}:${y}`}
                data-onion={
                  !lit && onionFrame?.[y]?.[i + first] ? "true" : undefined
                }
                x={left + (i + first) * view.cell - view.offset}
                y={top + y * view.cell - view.offsetY}
                width={view.cell}
                height={view.cell}
                fill={
                  lit
                    ? "var(--mobile-led)"
                    : onionFrame?.[y]?.[i + first]
                      ? "var(--mobile-onion)"
                      : "var(--mobile-pixel)"
                }
                stroke="var(--mobile-grid)"
                strokeWidth={view.cell >= 12 ? 0.7 : 0}
              />
            )),
        )}
        {width > 44 && (
          <rect
            x={left - view.offset}
            y={top - view.offsetY}
            width={44 * view.cell}
            height={11 * view.cell}
            fill="none"
            stroke="var(--mobile-accent)"
            strokeWidth="2"
            strokeDasharray="5 4"
            pointerEvents="none"
          />
        )}
        {selected && (
          <rect
            x={left + selected.x0 * view.cell - view.offset}
            y={top + selected.y0 * view.cell - view.offsetY}
            width={(selected.x1 - selected.x0 + 1) * view.cell}
            height={(selected.y1 - selected.y0 + 1) * view.cell}
            fill="none"
            stroke="var(--mobile-accent)"
            strokeWidth="2"
            strokeDasharray="5 4"
            pointerEvents="none"
          />
        )}
        {cursor && (
          <rect
            x={left + cursor.x * view.cell - view.offset}
            y={top + cursor.y * view.cell - view.offsetY}
            width={view.cell}
            height={view.cell}
            fill="none"
            stroke="var(--mobile-accent)"
            strokeWidth="2"
            pointerEvents="none"
          />
        )}
      </svg>
      <span id="mobile-canvas-help" className="mobile-sr">
        Draw or select with one finger; pinch or use Move Canvas to navigate.
        Use arrow keys and Space to edit pixels with a keyboard.
      </span>
    </div>
  );
}
