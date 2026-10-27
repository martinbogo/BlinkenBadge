import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationTimeout, operationLock, withTimeout } from "./async";

afterEach(() => vi.useRealTimers());

describe("device operation deadlines", () => {
  it("disconnects a stalled operation and releases the operation lock", async () => {
    vi.useFakeTimers();
    const lock = operationLock();
    const disconnect = vi.fn();
    const pending = lock(() =>
      withTimeout(
        new Promise(() => {}),
        8000,
        "Transfer timed out.",
        disconnect,
      ),
    );
    const failure = expect(pending).rejects.toBeInstanceOf(OperationTimeout);
    await expect(lock(async () => 1)).rejects.toThrow(/already running/);
    await vi.advanceTimersByTimeAsync(8000);
    await failure;
    expect(disconnect).toHaveBeenCalledOnce();
    await expect(lock(async () => 2)).resolves.toBe(2);
  });
  it("clears the deadline after completion", async () => {
    vi.useFakeTimers();
    const disconnect = vi.fn();
    await expect(
      withTimeout(Promise.resolve(42), 10, "Timeout", disconnect),
    ).resolves.toBe(42);
    await vi.advanceTimersByTimeAsync(20);
    expect(disconnect).not.toHaveBeenCalled();
  });
});
