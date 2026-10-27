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
  clientX: 13 + x * 26,
  clientY: 70 + y * 26,
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
});
