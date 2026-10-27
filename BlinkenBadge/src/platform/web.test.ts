// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageSpec } from "./types";

vi.mock("./wire", () => ({ encode: () => new Uint8Array(64) }));
vi.mock("./webfont", () => ({ fontMetrics: () => [], layout: vi.fn() }));

function bluetooth(write: () => Promise<void>) {
  const characteristic = { writeValueWithResponse: vi.fn(write) };
  const service = { getCharacteristic: vi.fn(async () => characteristic) };
  const gatt = {
    connected: true,
    connect: vi.fn(async () => {
      gatt.connected = true;
      return gatt;
    }),
    disconnect: vi.fn(() => {
      gatt.connected = false;
    }),
    getPrimaryService: vi.fn(async (uuid: number) => {
      if (uuid !== 0xfee0)
        throw new Error("No optional Device Information Service");
      return service;
    }),
  };
  const device = {
    id: "badge",
    name: "Test Badge",
    gatt,
    addEventListener: vi.fn(),
  };
  const requestDevice = vi.fn(async () => device);
  vi.stubGlobal("navigator", { bluetooth: { requestDevice } });
  return { gatt, requestDevice, characteristic };
}

const specs: MessageSpec[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("web transport cleanup", () => {
  it("disconnects a stalled write and permits a fresh connection", async () => {
    const { gatt, requestDevice, characteristic } = bluetooth(
      () => new Promise(() => {}),
    );
    const { platform } = await import("./web");
    vi.useFakeTimers();
    const sending = platform.sendBle(specs, 100, "badge");
    const rejection = expect(sending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(8000);
    await rejection;
    expect(gatt.disconnect).toHaveBeenCalled();
    characteristic.writeValueWithResponse.mockResolvedValue(undefined);
    await expect(platform.sendBle(specs, 100, "badge")).resolves.toBe(64);
    expect(requestDevice).toHaveBeenCalledTimes(2);
  });
  it("disconnects when discovery fails", async () => {
    const { gatt } = bluetooth(async () => {});
    gatt.getPrimaryService.mockRejectedValue(new Error("Discovery failed"));
    const { platform } = await import("./web");
    await expect(platform.bleScan(100)).rejects.toThrow(/Discovery failed/);
    expect(gatt.disconnect).toHaveBeenCalledOnce();
  });
  it("disconnects after a failed write", async () => {
    const { gatt } = bluetooth(async () => {
      gatt.connected = false;
      throw new Error("Disconnected");
    });
    const { platform } = await import("./web");
    await expect(platform.sendBle(specs, 100, "badge")).rejects.toThrow(
      /stopped/,
    );
    expect(gatt.disconnect).toHaveBeenCalledOnce();
  });
  it("only blocks browser unloading for unsaved work", async () => {
    vi.stubGlobal("navigator", {});
    const { platform } = await import("./web");
    const unsubscribe = platform.onExitRequested(() => false);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    unsubscribe();
    const unDirty = platform.onExitRequested(() => true);
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    unDirty();
  });
});
