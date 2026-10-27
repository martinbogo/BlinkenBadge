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
import type { Recovery } from "../platform/types";
import { blankFrame, newMessage } from "../badge";
import { parseMessage, parseProject, serializeProject } from "../doc";

const host = vi.hoisted(() => ({
  recoveryRead: vi.fn(async (): Promise<Recovery | null> => null),
  recoveryWrite: vi.fn(async () => {}),
  renderText: vi.fn(async (text: string) => ({
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
    expect(screen.getByRole("button", { name: /HELLO/ })).toBeTruthy();
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
    expect(screen.queryByRole("button", { name: "Send to Badge" })).toBeNull();
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
        frame[slot][index] = true;
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
  it("offers all four pixel fonts and renders the selected face", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: /Untitled/ }));
    await user.click(screen.getByRole("button", { name: "Serif" }));
    for (const name of ["Serif", "Sans", "Cartoon", "Futuristic"])
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
      await user.click(screen.getByRole("button", { name: "Insert" }));
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
