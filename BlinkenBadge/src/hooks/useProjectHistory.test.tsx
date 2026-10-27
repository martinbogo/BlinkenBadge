// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useProjectHistory } from "./useProjectHistory";
import { newMessage } from "../badge";
import type { Project } from "../types";

afterEach(cleanup);

describe("editor history under StrictMode", () => {
  it("undoes and redoes exactly one change without mutating replayed state", () => {
    const first: Project = { messages: [newMessage()], brightness: 100 };
    const second: Project = { ...first, brightness: 75 };
    const third: Project = { ...first, brightness: 50 };
    const { result } = renderHook(() => useProjectHistory(first), {
      wrapper: StrictMode,
    });
    act(() => result.current.apply(second, true));
    act(() => result.current.apply(third, true));
    act(() => result.current.undo());
    expect(result.current.project).toEqual(second);
    act(() => result.current.undo());
    expect(result.current.project).toEqual(first);
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.redo());
    expect(result.current.project).toEqual(second);
    act(() => result.current.apply(third, true));
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.resetHistory(first));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });
});
