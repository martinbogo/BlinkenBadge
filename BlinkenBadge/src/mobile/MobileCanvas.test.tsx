// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { blankFrame } from "../badge";
import MobileCanvas from "./MobileCanvas";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    },
  );
  SVGElement.prototype.setPointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const pointer = (pointerId: number, x: number, y: number) => ({
  pointerId,
  clientX: 21 + x * 6,
  clientY: 170 + y * 6,
  button: 0,
});

describe("mobile canvas gestures", () => {
  it("commits a stroke once and never commits a pinch gesture", () => {
    const change = vi.fn();
    render(
      <MobileCanvas frame={blankFrame(44)} tool="pencil" onChange={change} />,
    );
    const canvas = screen.getByRole("img");
    fireEvent.pointerDown(canvas, pointer(1, 0, 0));
    fireEvent.pointerMove(canvas, pointer(1, 3, 0));
    expect(change).not.toHaveBeenCalled();
    fireEvent.pointerUp(canvas, pointer(1, 3, 0));
    expect(change).toHaveBeenCalledTimes(1);
    expect(change.mock.calls[0][0][0].slice(0, 4)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(change.mock.calls[0][1]).toBe(true);
    change.mockClear();
    fireEvent.pointerDown(canvas, pointer(1, 0, 0));
    fireEvent.pointerDown(canvas, pointer(2, 3, 0));
    fireEvent.pointerMove(canvas, pointer(2, 5, 0));
    fireEvent.pointerUp(canvas, pointer(2, 5, 0));
    fireEvent.pointerUp(canvas, pointer(1, 0, 0));
    expect(change).not.toHaveBeenCalled();
  });
  it("toggles a pixel with one finger and keeps the chosen ink throughout a stroke", () => {
    const change = vi.fn();
    let frame = blankFrame(44);
    frame[0][1] = true;
    const { rerender } = render(
      <MobileCanvas frame={frame} tool="pencil" onChange={change} />,
    );
    const canvas = screen.getByRole("img");
    const stroke = (start: number, end = start) => {
      fireEvent.pointerDown(canvas, pointer(1, start, 0));
      fireEvent.pointerMove(canvas, pointer(1, end, 0));
      fireEvent.pointerMove(canvas, pointer(1, start, 0));
      fireEvent.pointerUp(canvas, pointer(1, end, 0));
      frame = change.mock.calls[change.mock.calls.length - 1][0];
      rerender(<MobileCanvas frame={frame} tool="pencil" onChange={change} />);
    };
    stroke(1);
    expect(frame[0][1]).toBe(false);
    stroke(1);
    expect(frame[0][1]).toBe(true);
    // Drawing across existing ink keeps it on; revisiting cells does not flip them.
    stroke(0, 3);
    expect(frame[0].slice(0, 4)).toEqual([true, true, true, true]);
    // Starting on ink erases the whole stroke, including repeated passes.
    stroke(0, 3);
    expect(frame[0].slice(0, 4)).toEqual([false, false, false, false]);
    expect(change).toHaveBeenCalledTimes(4);
  });
  it("lets Erase clear a stroke even when it starts on a dark pixel", () => {
    const change = vi.fn(),
      frame = blankFrame(44);
    frame[0][2] = true;
    render(<MobileCanvas frame={frame} tool="eraser" onChange={change} />);
    const canvas = screen.getByRole("img");
    fireEvent.pointerDown(canvas, pointer(1, 0, 0));
    fireEvent.pointerUp(canvas, pointer(1, 3, 0));
    expect(change.mock.calls[0][0][0].slice(0, 4)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
  it("draws filled shapes using the shared geometry", () => {
    const change = vi.fn();
    render(
      <MobileCanvas
        frame={blankFrame(44)}
        tool="rect"
        filled
        onChange={change}
      />,
    );
    const canvas = screen.getByRole("img");
    fireEvent.pointerDown(canvas, pointer(1, 0, 0));
    fireEvent.pointerMove(canvas, pointer(1, 2, 2));
    fireEvent.pointerUp(canvas, pointer(1, 2, 2));
    expect(
      change.mock.calls[0][0].slice(0, 3).map((r: boolean[]) => r.slice(0, 3)),
    ).toEqual(Array(3).fill([true, true, true]));
  });
  it("keeps onion pixels out of the edited frame and cancels interrupted strokes", () => {
    const change = vi.fn(),
      onion = blankFrame(44);
    onion[0][0] = true;
    const { container } = render(
      <MobileCanvas
        frame={blankFrame(44)}
        onionFrame={onion}
        tool="pencil"
        onChange={change}
      />,
    );
    expect(container.querySelectorAll('[data-onion="true"]')).toHaveLength(1);
    const canvas = screen.getByRole("img");
    fireEvent.pointerDown(canvas, pointer(1, 1, 1));
    fireEvent.pointerCancel(canvas, pointer(1, 1, 1));
    expect(change).not.toHaveBeenCalled();
  });
  it("selects a rectangle without modifying pixels", () => {
    const change = vi.fn(),
      select = vi.fn();
    render(
      <MobileCanvas
        frame={blankFrame(44)}
        tool="select"
        onChange={change}
        onSelectionChange={select}
      />,
    );
    const canvas = screen.getByRole("img");
    fireEvent.pointerDown(canvas, pointer(1, 1, 1));
    fireEvent.pointerUp(canvas, pointer(1, 3, 2));
    expect(select).toHaveBeenCalledWith({ x0: 1, y0: 1, x1: 3, y1: 2 });
    expect(change).not.toHaveBeenCalled();
  });
  it("fits all 44 columns, retains zoom between frames, and restores Fit", () => {
    const frame = blankFrame(44),
      change = vi.fn();
    const { container, rerender } = render(
      <MobileCanvas frame={frame} tool="pencil" onChange={change} />,
    );
    const cells = () =>
      container.querySelectorAll("svg.mobile-pixel-canvas > rect");
    expect(cells()).toHaveLength(44 * 11);
    expect(cells()[0].getAttribute("width")).toBe("6");
    rerender(
      <MobileCanvas
        frame={frame}
        tool="pencil"
        onChange={change}
        viewRequest={{ serial: 1, scale: 4 }}
      />,
    );
    expect(cells()[0].getAttribute("width")).toBe("24");
    rerender(
      <MobileCanvas
        frame={blankFrame(44)}
        tool="pencil"
        onChange={change}
        viewRequest={{ serial: 1, scale: 4 }}
      />,
    );
    expect(cells()[0].getAttribute("width")).toBe("24");
    rerender(
      <MobileCanvas
        frame={frame}
        tool="pencil"
        onChange={change}
        viewRequest={{ serial: 2, scale: "fit" }}
      />,
    );
    expect(cells()).toHaveLength(44 * 11);
    expect(cells()[0].getAttribute("width")).toBe("6");
    expect(change).not.toHaveBeenCalled();
  });
  it("keeps the original pinch focal point stable across repeated zoom moves", () => {
    const frame = blankFrame(44),
      change = vi.fn();
    frame[5][22] = true;
    const { container } = render(
      <MobileCanvas frame={frame} tool="pencil" onChange={change} />,
    );
    const canvas = screen.getByRole("img");
    fireEvent.pointerDown(canvas, pointer(1, 20, 5));
    fireEvent.pointerDown(canvas, pointer(2, 24, 5));
    for (const spread of [8, 14, 20]) {
      fireEvent.pointerMove(canvas, pointer(1, 22 - spread, 5));
      fireEvent.pointerMove(canvas, pointer(2, 22 + spread, 5));
      const pixel = container.querySelector(
        'svg.mobile-pixel-canvas > rect[fill="var(--mobile-led)"]',
      )!;
      const cell = Number(pixel.getAttribute("width"));
      expect(Number(pixel.getAttribute("x")) + cell / 2).toBeCloseTo(153);
      expect(Number(pixel.getAttribute("y")) + cell / 2).toBeCloseTo(200);
    }
    fireEvent.pointerUp(canvas, pointer(2, 42, 5));
    fireEvent.pointerUp(canvas, pointer(1, 2, 5));
    expect(change).not.toHaveBeenCalled();
  });
  it("shows a magnifier while drawing and prevents edits during playback", () => {
    const frame = blankFrame(44),
      change = vi.fn();
    const { container, rerender } = render(
      <MobileCanvas frame={frame} tool="pencil" onChange={change} />,
    );
    const canvas = screen.getByRole("img");
    fireEvent.pointerDown(canvas, pointer(1, 2, 3));
    expect(container.querySelector(".canvas-lens")?.textContent).toContain(
      "3, 4",
    );
    fireEvent.pointerUp(canvas, pointer(1, 2, 3));
    expect(container.querySelector(".canvas-lens")).toBeNull();
    expect(change).toHaveBeenCalledTimes(1);
    change.mockClear();
    rerender(
      <MobileCanvas frame={frame} tool="pencil" onChange={change} disabled />,
    );
    fireEvent.pointerDown(canvas, pointer(1, 2, 3));
    fireEvent.pointerUp(canvas, pointer(1, 2, 3));
    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(change).not.toHaveBeenCalled();
    expect(container.querySelector(".canvas-lens")).toBeNull();
  });
});
