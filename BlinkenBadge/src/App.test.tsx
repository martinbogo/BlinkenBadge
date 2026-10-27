// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Platform } from "./platform/types";
import { newMessage } from "./badge";
import { serializeProject } from "./doc";

const host = vi.hoisted(() => ({
  kind: "web",
  fontMetrics: vi.fn(async () => []),
  renderText: vi.fn(),
  usbFind: vi.fn(async () => null),
  onUsbPresence: vi.fn(() => () => {}),
  onSendProgress: vi.fn(() => () => {}),
  takePendingFiles: vi.fn(async (): Promise<string[]> => []),
  recoveryRead: vi.fn(async () => null),
  recoveryWrite: vi.fn(async () => {}),
  recoveryClear: vi.fn(async () => {}),
  onMenu: vi.fn(() => () => {}),
  onOpenFile: vi.fn(() => () => {}),
  onExitRequested: vi.fn(() => () => {}),
  setTitle: vi.fn(),
  confirmExit: vi.fn(async () => {}),
  pickOpen: vi.fn(),
  pickSave: vi.fn(),
  writeText: vi.fn(async () => {}),
  readText: vi.fn(),
}));
vi.mock("./platform", () => ({ platform: host as unknown as Platform }));
import App from "./App";

beforeEach(() => {
  vi.clearAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    clear: () => storage.clear(),
  });
  host.takePendingFiles.mockResolvedValue([]);
  host.recoveryRead.mockResolvedValue(null);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const renderApp = () =>
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

describe("editor regressions", () => {
  it("keeps the editor visible when undo removes the active message", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Add message" }));
    await user.click(screen.getByRole("button", { name: "Add message" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("textbox", { name: "Message Name" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /Messages.*2\/8/i }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("textbox", { name: "Message Name" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /Messages.*1\/8/i }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(
      screen.getByRole("heading", { name: /Messages.*2\/8/i }),
    ).toBeTruthy();
  });
  it("blocks undo behind a modal, traps focus, and restores focus on cancel", async () => {
    const user = userEvent.setup();
    renderApp();
    fireEvent.change(screen.getByRole("textbox", { name: "Message Name" }), {
      target: { value: "Edited" },
    });
    const trigger = screen.getByRole("button", { name: "New" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(document.activeElement).toBe(save);
    fireEvent.keyDown(save, { key: "z", metaKey: true });
    expect(
      (
        screen.getByRole("textbox", {
          name: "Message Name",
          hidden: true,
        }) as HTMLInputElement
      ).value,
    ).toBe("Edited");
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    await user.tab();
    expect(document.activeElement).toBe(save);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it("opens pending files once across StrictMode effect replay", async () => {
    const m = { ...newMessage(), name: "From Disk" };
    host.takePendingFiles.mockResolvedValue(["selected.badge"]);
    host.readText.mockResolvedValue(
      serializeProject({ brightness: 100, messages: [m] }),
    );
    renderApp();
    await waitFor(() =>
      expect(
        (
          screen.getByRole("textbox", {
            name: "Message Name",
          }) as HTMLInputElement
        ).value,
      ).toBe("From Disk"),
    );
    expect(host.takePendingFiles).toHaveBeenCalledOnce();
    expect(host.readText).toHaveBeenCalledOnce();
  });
  it("ignores a corrupt LED preference instead of crashing", () => {
    localStorage.setItem("badge-led", "unknown-color");
    renderApp();
    expect(screen.getByRole("textbox", { name: "Message Name" })).toBeTruthy();
  });
});
