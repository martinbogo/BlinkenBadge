// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
const host = vi.hoisted(() => ({
  recoveryWrite: vi.fn(async () => {}),
  recoveryClear: vi.fn(async () => {}),
}));
vi.mock("../platform", () => ({ platform: host }));
import { useRecovery } from "./useRecovery";
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("recovery ordering", () => {
  it("clears only after an older in-flight autosave has completed", async () => {
    let finish!: () => void;
    host.recoveryWrite.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const error = vi.fn();
    const { result } = renderHook(() =>
      useRecovery("draft", true, null, true, error),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    let cleared!: Promise<void>;
    act(() => {
      cleared = result.current.clearRecovery();
    });
    expect(host.recoveryClear).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await cleared;
    });
    expect(host.recoveryClear).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });
  it("preserves edits made during a save instead of clearing their recovery", async () => {
    const error = vi.fn();
    const { result, rerender } = renderHook(
      ({ json }) => useRecovery(json, true, "file.badge", false, error),
      { initialProps: { json: "old" } },
    );
    rerender({ json: "new" });
    await act(async () => {
      await result.current.savedRecovery("old");
    });
    expect(host.recoveryClear).not.toHaveBeenCalled();
    expect(host.recoveryWrite).toHaveBeenCalledWith(
      "new",
      "file.badge",
      expect.any(String),
    );
  });
});
