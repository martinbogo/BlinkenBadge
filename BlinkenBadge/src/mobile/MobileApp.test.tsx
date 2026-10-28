// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TextBitmap } from "../types";
import type { Recovery } from "../platform/types";
import { blankFrame, newMessage, renderPreview, stepDelay } from "../badge";
import { parseMessage, parseProject, serializeProject } from "../doc";

const host = vi.hoisted(() => ({
  recoveryRead: vi.fn(async (): Promise<Recovery | null> => null),
  recoveryWrite: vi.fn(async () => {}),
  renderText: vi.fn(async (text: string): Promise<TextBitmap> => ({
    width: 44,
    columns: 6,
    missing: [],
    rows: Array.from({ length: 11 }, (_, y) =>
      Array.from({ length: 44 }, (_, x) => y === 0 && x < text.length),
    ),
  })),
  onSendProgress: vi.fn(() => () => {}),
  bleScan: vi.fn(async () => [
    { id: "badge-1", name: "Test Badge", rssi: -40, services: [] },
  ]),
  sendBle: vi.fn(async (..._args: unknown[]) => 128),
  exportDocument: vi.fn(async (..._args: unknown[]) => true),
  importDocument: vi.fn(async (): Promise<string | null> => null),
}));
vi.mock("../platform", () => ({ platform: host }));
vi.mock("../font", async (original) => ({
  ...(await original<typeof import("../font")>()),
  loadFontMetrics: async () => {},
  faceList: () => [
    { id: "serif", name: "Serif", notice: "" },
    { id: "sans", name: "Sans", notice: "" },
    { id: "cartoon", name: "Cartoon", notice: "" },
    { id: "future", name: "Futuristic", notice: "" },
    ...[
      "Comic",
      "Arcade",
      "Terminal",
      "Stencil",
      "Outline",
      "Tiny",
      "Punk",
      "Script",
    ].map((name) => ({ id: name.toLowerCase(), name, notice: "" })),
  ],
}));
import MobileApp from "./MobileApp";

beforeEach(() => {
  vi.clearAllMocks();
  host.recoveryRead.mockResolvedValue(null);
  host.importDocument.mockResolvedValue(null);
  history.replaceState(null, "", "/");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const open = async () => {
  render(
    <StrictMode>
      <MobileApp />
    </StrictMode>,
  );
  await screen.findByRole("button", { name: /Untitled/ });
};

describe("mobile editing flows", () => {
  it("renders text, returns to the message list, and saves its editable source", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: /Untitled/ }));
    await user.type(screen.getByRole("textbox", { name: "Message" }), "HELLO");
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Done" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(host.renderText).toHaveBeenLastCalledWith("HELLO", "serif");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("button", { name: /HELLO/ })).toBeTruthy();
    await waitFor(() => expect(host.recoveryWrite).toHaveBeenCalled());
    const json = (
      host.recoveryWrite.mock.calls[
        host.recoveryWrite.mock.calls.length - 1
      ] as unknown as [string]
    )[0];
    expect(parseProject(json).messages[0].text).toEqual({
      value: "HELLO",
      face: "serif",
    });
  });
  it("restores a saved mobile draft without asking to discard it", async () => {
    const message = {
      ...newMessage("scroll_left"),
      name: "Recovered",
      text: { value: "Saved", face: "serif" },
    };
    host.recoveryRead.mockResolvedValue({
      json: serializeProject({ brightness: 100, messages: [message] }),
      path: null,
      saved_at: "2026-10-27T19:00:00Z",
    });
    const user = userEvent.setup();
    render(
      <StrictMode>
        <MobileApp />
      </StrictMode>,
    );
    await user.click(await screen.findByRole("button", { name: /Recovered/ }));
    expect(
      (screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
        .value,
    ).toBe("Saved");
  });
  it("does not send while selecting or discovering a badge", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(screen.getByRole("button", { name: "Find Badge" }));
    await screen.findByRole("button", { name: /Test Badge/ });
    expect(host.sendBle).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Send to Badge" }));
    await screen.findByText("The badge accepted the transfer.");
    expect(host.sendBle).toHaveBeenCalledTimes(1);
  });
  it("discloses animation only in drawing mode and leaves the document intact on rotation", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "+ Add" }));
    await user.click(screen.getByRole("button", { name: "Pixel Drawing" }));
    expect(screen.queryByLabelText("Animation Frames")).toBeNull();
    expect(screen.getByRole("button", { name: "Send to Badge" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Canvas Options" }));
    await user.click(screen.getByRole("button", { name: "Motion" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Mode" }),
      "animation",
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }),
    );
    await user.click(screen.getByRole("button", { name: "Add Frame" }));
    expect(
      screen
        .getByRole("button", { name: "Frame 2" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent(window, new Event("resize"));
    expect(
      screen
        .getByRole("button", { name: "Frame 2" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
  it("reports failed draft loading without overwriting the saved data", async () => {
    host.recoveryRead.mockResolvedValue({
      json: "broken",
      path: null,
      saved_at: "",
    });
    render(<MobileApp />);
    await screen.findByText(/saved draft could not be opened/);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(host.recoveryWrite).not.toHaveBeenCalled();
  });
});

describe("mobile desktop feature parity", () => {
  const fullProject = () => ({
    brightness: 75 as const,
    messages: Array.from({ length: 8 }, (_, slot) => ({
      ...newMessage("animation"),
      name: `Animation ${slot + 1}`,
      frames: Array.from({ length: 8 }, (_, index) => {
        const frame = blankFrame(44);
        frame[slot][16 + index] = true;
        return frame;
      }),
    })),
  });
  const restore = async () => {
    const project = fullProject();
    host.recoveryRead.mockResolvedValue({
      json: serializeProject(project),
      path: null,
      saved_at: "",
    });
    render(<MobileApp />);
    await screen.findByRole("button", { name: /Animation 1.*Slot 1/ });
    return project;
  };
  it("exports and sends all eight animation slots with eight frames each", async () => {
    const user = userEvent.setup();
    const project = await restore();
    await user.click(screen.getByRole("button", { name: "Project Options" }));
    await user.click(screen.getByRole("button", { name: "Export Project" }));
    const [json, kind] = host.exportDocument.mock.calls[0];
    expect(kind).toBe("project");
    expect(parseProject(json as string)).toEqual(project);
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(screen.getByRole("button", { name: "Find Badge" }));
    await user.click(
      await screen.findByRole("button", { name: "Send to Badge" }),
    );
    await screen.findByText("The badge accepted the transfer.");
    const [specs, brightness, badge] = host.sendBle.mock.calls[0] as [
      typeof project.messages,
      number,
      string,
    ];
    expect(specs).toHaveLength(8);
    specs.forEach((spec, index) =>
      expect(spec.frames).toEqual(project.messages[index].frames),
    );
    expect(brightness).toBe(75);
    expect(badge).toBe("badge-1");
  });
  it("supports onion skin, frame deletion, duplication, reordering, and undo", async () => {
    const user = userEvent.setup();
    await restore();
    await user.click(
      screen.getByRole("button", { name: /Animation 1.*Slot 1/ }),
    );
    await user.click(screen.getByRole("button", { name: "Frame 2" }));
    expect(document.querySelectorAll('[data-onion="true"]')).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Frame Options" }));
    await user.click(screen.getByRole("checkbox", { name: "Onion Skin" }));
    expect(document.querySelectorAll('[data-onion="true"]')).toHaveLength(0);
    expect(
      (
        screen.getByRole("button", {
          name: "Duplicate Frame",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Delete Frame" }));
    expect(screen.queryByRole("button", { name: "Frame 8" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Frame Options" }));
    await user.click(screen.getByRole("button", { name: "Duplicate Frame" }));
    expect(screen.getByRole("button", { name: "Frame 8" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Frame Options" }));
    await user.click(screen.getByRole("button", { name: "Move Frame Right" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }),
    );
    expect(
      screen
        .getByRole("button", { name: "Frame 3" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Frame 8" })).toBeTruthy();
  });
  it("scrubs through the whole sequence into the eighth slot", async () => {
    const user = userEvent.setup();
    await restore();
    await user.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.change(screen.getByRole("slider", { name: "Preview Timeline" }), {
      target: { value: "63" },
    });
    expect(screen.getByText("Slot 8 of 8 · Frame 8 of 8")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Edit This Slot" }));
    expect(
      screen
        .getByRole("button", { name: "Frame 8" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("heading", { name: "Animation 8" })).toBeTruthy();
  });
  it("plays in the zoomed canvas and pauses on the visible frame without leaving Focus", async () => {
    const user = userEvent.setup();
    const project = await restore();
    await user.click(
      screen.getByRole("button", { name: /Animation 1.*Slot 1/ }),
    );
    await user.click(screen.getByRole("button", { name: "Zoom 4 Times" }));
    await user.click(screen.getByRole("button", { name: "Focus Canvas" }));
    const workspace = screen.getByRole("region", { name: "Drawing Workspace" });
    const canvas = within(workspace).getByRole("img", { name: /pixel canvas/ });
    const lit = () => canvas.querySelector('rect[fill="var(--mobile-led)"]');
    const before = lit()?.getAttribute("x");
    vi.useFakeTimers();
    try {
      fireEvent.click(
        within(workspace).getByRole("button", { name: "Play Preview" }),
      );
      act(() =>
        vi.advanceTimersByTime(stepDelay(project.messages[0].speed) * 2),
      );
      expect(
        within(workspace).getByRole("button", { name: "Frame Options" })
          .textContent,
      ).toContain("Frame 3/8");
      expect(canvas.getAttribute("aria-disabled")).toBe("true");
      expect(lit()?.getAttribute("x")).not.toBe(before);
      const paused = lit()?.getAttribute("x");
      fireEvent.click(
        within(workspace).getByRole("button", { name: "Pause Preview" }),
      );
      expect(canvas.getAttribute("aria-disabled")).toBe("false");
      expect(lit()?.getAttribute("x")).toBe(paused);
      fireEvent.click(
        within(workspace).getByRole("button", { name: "Previous Frame" }),
      );
      expect(
        within(workspace).getByRole("button", { name: "Frame Options" })
          .textContent,
      ).toContain("Frame 2/8");
    } finally {
      vi.useRealTimers();
    }
    await user.click(
      within(workspace).getByRole("button", { name: "Show Frames" }),
    );
    expect(
      screen
        .getByRole("button", { name: "Frame 2" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(canvas.querySelector("rect")?.getAttribute("width")).toBe("24");
    expect(screen.getByRole("button", { name: "Focus Canvas" })).toBeTruthy();
  });
  it("keeps the canvas valid when Undo removes a newly duplicated frame", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "+ Add" }));
    await user.click(screen.getByRole("button", { name: "Animation" }));
    await user.click(screen.getByRole("button", { name: "Zoom 4 Times" }));
    await user.click(screen.getByRole("button", { name: "Duplicate Frame" }));
    expect(
      screen
        .getByRole("button", { name: "Frame 2" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("button", { name: "Frame 2" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Frame 1" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    const canvas = screen.getByRole("img", { name: /pixel canvas/ });
    expect(canvas.querySelector("rect")?.getAttribute("width")).toBe("24");
  });
  it("uses Back to exit Focus and close sheets before leaving the drawing", async () => {
    const user = userEvent.setup();
    await restore();
    await user.click(
      screen.getByRole("button", { name: /Animation 1.*Slot 1/ }),
    );
    await user.click(screen.getByRole("button", { name: "Focus Canvas" }));
    await user.click(screen.getByRole("button", { name: "Frame Options" }));
    history.back();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Exit Focus" })).toBeTruthy();
    history.back();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Exit Focus" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Focus Canvas" })).toBeTruthy();
    history.back();
    expect(
      await screen.findByRole("button", { name: /Animation 1.*Slot 1/ }),
    ).toBeTruthy();
  });
  it("deletes the chosen slot from its root menu and restores it with Undo", async () => {
    const user = userEvent.setup();
    const project = await restore();
    expect(screen.getByRole("heading", { name: "Badge Slots" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Slot 2 Options" }));
    expect(
      (screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value,
    ).toBe("Animation 2");
    await user.click(screen.getByRole("button", { name: "Delete Slot" }));
    expect(screen.getByText(/Delete “Animation 2” from Slot 2/)).toBeTruthy();
    expect(document.activeElement).toBe(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    // Dismissing confirmation leaves all frames untouched.
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(
      screen.getByRole("button", { name: /Animation 2.*Slot 2/ }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Slot 2 Options" }));
    await user.click(screen.getByRole("button", { name: "Delete Slot" }));
    await user.click(screen.getByRole("button", { name: "Delete Slot" }));
    expect(
      screen.queryByRole("button", { name: /Animation 2.*Slot/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /Animation 3.*Slot 2/ }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Project Options" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(screen.getByRole("button", { name: "Export Project" }));
    expect(
      parseProject(host.exportDocument.mock.calls[0][0] as string),
    ).toEqual(project);
  });
  it("lets the last creation be deleted without breaking the one-slot document model", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: /Untitled/ }));
    await user.type(
      screen.getByRole("textbox", { name: "Message" }),
      "KEEP ME",
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Done" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Slot 1 Options" }));
    await user.click(screen.getByRole("button", { name: "Delete Slot" }));
    expect(screen.getByText(/A blank slot will take its place/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete Slot" }));
    expect(screen.queryByRole("button", { name: /KEEP ME/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Untitled/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Project Options" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }),
    );
    expect(screen.getByRole("button", { name: /KEEP ME/ })).toBeTruthy();
  });
  it("returns pixel conversion from a root slot menu to the slot list", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Slot 1 Options" }));
    await user.click(screen.getByRole("button", { name: "Edit Pixels" }));
    await user.click(screen.getByRole("button", { name: "Edit Pixels" }));
    expect(
      screen.getByRole("region", { name: "Drawing Workspace" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back to Slots" }));
    expect(
      await screen.findByRole("heading", { name: "Badge Slots" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Untitled Drawing/ }),
    ).toBeTruthy();
  });
  it("sends only checked slots and locks the transfer controls until completion", async () => {
    const user = userEvent.setup();
    const project = await restore();
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(screen.getByRole("checkbox", { name: /Send Slot 2:/ }));
    await user.click(screen.getByRole("checkbox", { name: /Send Slot 4:/ }));
    expect(screen.getByText(/6 of 8 selected/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Find Badge" }));
    await screen.findByRole("button", { name: /Test Badge/ });
    expect(host.sendBle).not.toHaveBeenCalled();
    let finish!: (bytes: number) => void;
    host.sendBle.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    await user.click(screen.getByRole("button", { name: "Send to Badge" }));
    await waitFor(() => expect(host.sendBle).toHaveBeenCalledTimes(1));
    const [specs] = host.sendBle.mock.calls[0] as [typeof project.messages];
    expect(specs.map((m) => m.frames)).toEqual(
      project.messages
        .filter((_, i) => i !== 1 && i !== 3)
        .map((m) => m.frames),
    );
    expect(
      (
        screen.getByRole("checkbox", {
          name: /Send Slot 1:/,
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Back to Slots",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("combobox", {
          name: "Brightness",
        }) as HTMLSelectElement
      ).disabled,
    ).toBe(true);
    finish(128);
    await screen.findByText("The badge accepted the transfer.");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Brightness" }),
      "50",
    );
    expect(screen.queryByText("The badge accepted the transfer.")).toBeNull();
    expect(screen.getByRole("button", { name: "Send to Badge" })).toBeTruthy();
  });
  it("explains an empty badge search and supports retry without uploading", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Send" }));
    host.bleScan.mockResolvedValueOnce([]);
    await user.click(screen.getByRole("button", { name: "Find Badge" }));
    await screen.findByText(/No badge found/);
    await user.click(screen.getByText("Connection Help"));
    expect(
      screen.getByText(/PIN-protected transfers are not supported/),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Send to Badge",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Find Badge" }));
    await screen.findByRole("button", { name: /Selected for Sending/ });
    expect(host.sendBle).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox", { name: /Send Slot 1:/ }));
    expect(screen.getByText("Select at least one slot to send.")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Send to Badge",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("makes speed editable from frame controls and sending reachable from editor and preview", async () => {
    const user = userEvent.setup();
    await restore();
    await user.click(
      screen.getByRole("button", { name: /Animation 1.*Slot 1/ }),
    );
    await user.click(screen.getByRole("button", { name: "Frame Options" }));
    fireEvent.change(screen.getByRole("slider", { name: "Playback Speed" }), {
      target: { value: "7" },
    });
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }),
    );
    expect(
      screen.getByRole("button", { name: "Frame Options" }).textContent,
    ).toContain("Speed 7/8");
    await user.click(screen.getByRole("button", { name: "Send to Badge" }));
    expect(screen.getByRole("main", { name: "Prepare Transfer" })).toBeTruthy();
    expect(host.sendBle).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Back to Slots" }));
    await user.click(await screen.findByRole("button", { name: "Preview" }));
    await user.click(screen.getByRole("button", { name: "Send to Badge" }));
    await user.click(screen.getByRole("button", { name: "Find Badge" }));
    await screen.findByRole("button", { name: /Test Badge/ });
    await user.click(screen.getByRole("button", { name: "Send to Badge" }));
    await screen.findByText("The badge accepted the transfer.");
    expect(
      (host.sendBle.mock.calls[0][0] as { speed: number }[])[0].speed,
    ).toBe(7);
  });
  it("copies pixels between frames through contextual tools and preserves undo", async () => {
    const user = userEvent.setup();
    const project = await restore();
    await user.click(
      screen.getByRole("button", { name: /Animation 1.*Slot 1/ }),
    );
    await user.click(screen.getByRole("button", { name: "Drawing Tool" }));
    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(
      (screen.getByRole("button", { name: "Copy Pixels" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Selection Options" }));
    await user.click(screen.getByRole("button", { name: "Select All" }));
    await user.click(screen.getByRole("button", { name: "Copy Pixels" }));
    await screen.findByText("Copied Pixels");
    await user.click(screen.getByRole("button", { name: "Frame 2" }));
    await user.click(screen.getByRole("button", { name: "Paste Pixels" }));
    const canvas = screen.getByRole("img", { name: /pixel canvas/ });
    expect(
      canvas.querySelector('rect[fill="var(--mobile-led)"]')?.getAttribute("x"),
    ).toBe("114");
    await user.click(screen.getByRole("button", { name: "Finish Selection" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(screen.getByRole("button", { name: "Canvas Options" }));
    await user.click(screen.getByRole("button", { name: "Clear Frame" }));
    expect(
      canvas.querySelectorAll('rect[fill="var(--mobile-led)"]'),
    ).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(screen.getByRole("button", { name: "Canvas Options" }));
    await user.click(screen.getByRole("button", { name: "Slot Options" }));
    await user.click(screen.getByRole("button", { name: "Export Slot" }));
    expect(
      parseMessage(host.exportDocument.mock.calls[0][0] as string).frames,
    ).toEqual(project.messages[0].frames);
  });
  it("blocks an oversized selection and allows sending after excluding a slot", async () => {
    const user = userEvent.setup();
    const messages = Array.from({ length: 2 }, (_, i) => ({
      ...newMessage("scroll_left"),
      name: `Wide ${i + 1}`,
      width: 4000,
      frames: [blankFrame(4000)],
    }));
    host.recoveryRead.mockResolvedValue({
      json: serializeProject({ brightness: 100, messages }),
      path: null,
      saved_at: "",
    });
    render(<MobileApp />);
    await user.click(await screen.findByRole("button", { name: "Send" }));
    await user.click(screen.getByRole("button", { name: "Find Badge" }));
    await screen.findByRole("button", { name: /Test Badge/ });
    expect(
      screen.getByText(/This selection exceeds badge memory/),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Send to Badge",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: /Send Slot 2:/ }));
    await user.click(screen.getByRole("button", { name: "Send to Badge" }));
    await screen.findByText("The badge accepted the transfer.");
    expect(host.sendBle.mock.calls[0][0]).toHaveLength(1);
  });
  it("offers all twelve pixel fonts and renders the selected face", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: /Untitled/ }));
    await user.click(screen.getByRole("button", { name: "Font: Serif" }));
    for (const name of [
      "Serif",
      "Sans",
      "Cartoon",
      "Futuristic",
      "Comic",
      "Arcade",
      "Terminal",
      "Stencil",
      "Outline",
      "Tiny",
      "Punk",
      "Script",
    ])
      expect(screen.getByRole("button", { name })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Futuristic" }));
    await user.type(screen.getByRole("textbox", { name: "Message" }), "ABC");
    await waitFor(() =>
      expect(host.renderText).toHaveBeenLastCalledWith("ABC", "future"),
    );
  });
});

describe("animation frame artwork", () => {
  it("keeps existing pixels and frame counts when stamping multiple fonts", async () => {
    const user = userEvent.setup();
    const message = newMessage("animation");
    message.frames = Array.from({ length: 8 }, () => blankFrame(44));
    message.frames[0][2][10] = true;
    host.recoveryRead.mockResolvedValue({
      json: serializeProject({ brightness: 100, messages: [message] }),
      path: null,
      saved_at: "",
    });
    render(<MobileApp />);
    await user.click(await screen.findByRole("button", { name: /Untitled/ }));
    for (const [face, pixel] of [
      ["future", 0],
      ["cartoon", 1],
    ] as const) {
      await user.click(screen.getByRole("button", { name: "Canvas Options" }));
      await user.click(screen.getByRole("button", { name: "Stamp Text" }));
      await user.clear(screen.getByRole("textbox", { name: "Stamp Text" }));
      await user.type(screen.getByRole("textbox", { name: "Stamp Text" }), "A");
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Stamp Font" }),
        face,
      );
      const rows = blankFrame(44);
      rows[0][pixel] = true;
      host.renderText.mockResolvedValueOnce({
        rows,
        width: 44,
        columns: 6,
        missing: [],
      });
      await user.click(screen.getByRole("button", { name: "Insert Text" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(host.renderText).toHaveBeenLastCalledWith("A", face);
    }
    await user.click(screen.getByRole("button", { name: "Canvas Options" }));
    await user.click(screen.getByRole("button", { name: "Slot Options" }));
    await user.click(screen.getByRole("button", { name: "Export Slot" }));
    const back = parseMessage(host.exportDocument.mock.calls[0][0] as string);
    expect(back.mode).toBe("animation");
    expect(back.frames).toHaveLength(8);
    expect(back.frames[0][0].slice(0, 2)).toEqual([true, true]);
    expect(back.frames[0][2][10]).toBe(true);
  });
});

it("reapplies a selected font even when the saved face ID already matches", async () => {
  const user = userEvent.setup();
  const message = {
    ...newMessage("fixed"),
    name: "Saved Comic",
    text: { value: "A", face: "comic" },
  };
  host.recoveryRead.mockResolvedValue({
    json: serializeProject({ brightness: 100, messages: [message] }),
    path: null,
    saved_at: "",
  });
  render(<MobileApp />);
  await user.click(await screen.findByRole("button", { name: /Saved Comic/ }));
  expect(host.renderText).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Font: Comic" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Comic" }),
  );
  await waitFor(() =>
    expect(host.renderText).toHaveBeenLastCalledWith("A", "comic"),
  );
});

it("returns Done to the root history entry instead of reopening the editor on Back", async () => {
  const user = userEvent.setup();
  await open();
  for (let i = 0; i < 2; i++) {
    await user.click(screen.getByRole("button", { name: /Untitled/ }));
    expect(history.state.mobileDepth).toBe(1);
    await user.click(screen.getByRole("button", { name: "Done" }));
    await screen.findByRole("button", { name: /Untitled/ });
    expect(history.state).toMatchObject({
      mobileRoute: "project",
      mobileDepth: 0,
    });
  }
});

it("retains short text widths so Fixed mode centers like the desktop editor", async () => {
  const user = userEvent.setup();
  const message = {
    ...newMessage("fixed"),
    text: { value: "", face: "serif" },
  };
  host.recoveryRead.mockResolvedValue({
    json: serializeProject({ brightness: 100, messages: [message] }),
    path: null,
    saved_at: "",
  });
  render(<MobileApp />);
  await user.click(await screen.findByRole("button", { name: /Untitled/ }));
  const rows = blankFrame(16);
  rows[4][0] = true;
  host.renderText.mockResolvedValueOnce({
    rows,
    width: 16,
    columns: 2,
    missing: [],
  });
  await user.type(screen.getByRole("textbox", { name: "Message" }), "HI");
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Done" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  await user.click(screen.getByRole("button", { name: "Done" }));
  await user.click(
    await screen.findByRole("button", { name: "Project Options" }),
  );
  await user.click(screen.getByRole("button", { name: "Export Project" }));
  const back = parseProject(host.exportDocument.mock.calls[0][0] as string)
    .messages[0];
  expect(back.width).toBe(16);
  expect(renderPreview(back, 0)[4][14]).toBe(true);
});

it("waits for text rendering before allowing a mode change", async () => {
  const user = userEvent.setup();
  await open();
  await user.click(screen.getByRole("button", { name: /Untitled/ }));
  let finish!: (value: {
    rows: boolean[][];
    width: number;
    columns: number;
    missing: string[];
  }) => void;
  const pending = new Promise<{
    rows: boolean[][];
    width: number;
    columns: number;
    missing: string[];
  }>((resolve) => {
    finish = resolve;
  });
  host.renderText.mockReturnValueOnce(pending);
  await user.type(screen.getByRole("textbox", { name: "Message" }), "A");
  await waitFor(() =>
    expect(host.renderText).toHaveBeenLastCalledWith("A", "serif"),
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Motion: Scroll left",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  finish({ rows: blankFrame(8), width: 8, columns: 1, missing: [] });
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Motion: Scroll left",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
});
