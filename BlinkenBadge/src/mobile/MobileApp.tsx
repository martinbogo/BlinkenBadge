import { useCallback, useEffect, useRef, useState } from "react";
import { platform } from "../platform";
import type { Progress } from "../platform";
import {
  blankFrame,
  byteColumns,
  cloneFrame,
  flipH,
  flipV,
  invert,
  shift,
  stamp,
  enabledMessages,
  newMessage,
  previewPeriod,
  resizeFrame,
  stepDelay,
} from "../badge";
import {
  faceList,
  fitText,
  loadFontMetrics,
  measureText,
  pictographs,
} from "../font";
import { clearRect, extractRect, pasteBlock, type Rect } from "../draw";
import { importImage } from "../importImage";
import { MAX_BITMAP_WIDTH } from "../limits";
import { ledPalette } from "../led";
import MobilePreview, { MiniBadge } from "./MobilePreview";
import FontChoice from "./FontChoice";
import EmojiPalette from "../components/EmojiPalette";
import {
  parseMessage,
  parseProject,
  serializeMessage,
  serializeProject,
} from "../doc";
import {
  ANIMATION_MAX_FRAMES,
  BADGE_WIDTH,
  LED_COLORS,
  LED_ORDER,
  MAX_BYTE_COLUMNS,
  type Frame,
  type LedColor,
  MAX_MESSAGES,
  MODES,
  MODE_LABELS,
  type BadgeInfo,
  type Message,
  type Mode,
  type Project,
} from "../types";
import { emptyMobileProject, useMobileProject } from "./useMobileProject";
import type { MobileTool } from "./MobileCanvas";
import Sheet from "./Sheet";
import DrawingWorkspace from "./DrawingWorkspace";
import StudioIcon from "./StudioIcon";
import "../App.css";
import "./mobile.css";

type Route = "project" | "text" | "draw" | "send" | "preview";
type Panel =
  | "project"
  | "add"
  | "font"
  | "motion"
  | "tool"
  | "canvas"
  | "message"
  | "confirm-new"
  | "confirm-import"
  | "confirm-delete"
  | "frames"
  | "selection"
  | "transform"
  | "insert"
  | "stamp"
  | "image"
  | "color"
  | "confirm-mode"
  | "convert"
  | null;

export default function MobileApp() {
  const editor = useMobileProject();
  const { project, commit, replace, ready, saveState, error, setError, flush } =
    editor;
  const [route, setRoute] = useState<Route>("project");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [draft, setDraft] = useState("");
  const [face, setFace] = useState("serif");
  const [fonts, setFonts] = useState<ReturnType<typeof faceList>>([]);
  const [rendering, setRendering] = useState(false);
  const [onion, setOnion] = useState(true);
  const [brushSize, setBrushSize] = useState(1);
  const [filled, setFilled] = useState(false);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [clipboard, setClipboard] = useState<Frame | null>(null);
  const [stampText, setStampText] = useState("");
  const [stampFace, setStampFace] = useState("serif");
  const [showEmoji, setShowEmoji] = useState(false);
  const [threshold, setThreshold] = useState(127);
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  const [led, setLed] = useState<LedColor>(() => {
    try {
      const value = localStorage.getItem("badge-led") as LedColor;
      return LED_ORDER.includes(value) ? value : "red";
    } catch {
      return "red";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("badge-led", led);
    } catch {
      /* Optional preference. */
    }
  }, [led]);
  const [tool, setTool] = useState<MobileTool>("pencil");
  const [frameIndex, setFrameIndex] = useState(0);
  const [fitVersion, fit] = useState(0);
  const [zoomVersion, zoom] = useState(0);
  const [drawingFocus, setDrawingFocus] = useState(false);
  const drawingFocusRef = useRef(false);
  drawingFocusRef.current = drawingFocus;
  const panelRef = useRef<Panel>(null);
  panelRef.current = panel;
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<"scan" | "send" | "file" | null>(null);
  const [badges, setBadges] = useState<BadgeInfo[]>([]);
  const [badgeId, setBadgeId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [previewStart, setPreviewStart] = useState<{
    scope: "slot" | "sequence";
    step: number;
  }>({ scope: "sequence", step: 0 });
  const [status, setStatus] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const renderSequence = useRef(0);
  const forceTextRender = useRef(false);
  const [fontChoiceVersion, refreshFontChoice] = useState(0);
  const operation = useRef(false);
  const active =
    project.messages.find((m) => m.id === selectedId) ?? project.messages[0];
  const frame = active.frames[Math.min(frameIndex, active.frames.length - 1)];
  const navigationDepth = useRef(0);
  const routeRef = useRef(route);
  routeRef.current = route;
  const busyRef = useRef(false);
  busyRef.current = busy !== null || rendering;

  useEffect(() => {
    window.document.documentElement.classList.add("mobile-layout");
    void loadFontMetrics()
      .then(() => setFonts(faceList()))
      .catch((e) => setError(String(e)));
    const resize = () =>
      root.current?.style.setProperty(
        "--mobile-height",
        `${window.visualViewport?.height ?? window.innerHeight}px`,
      );
    resize();
    window.visualViewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    const back = () => {
      if (
        busyRef.current ||
        panelRef.current ||
        (routeRef.current === "draw" && drawingFocusRef.current)
      ) {
        history.pushState(
          {
            mobileRoute: routeRef.current,
            mobileDepth: navigationDepth.current,
          },
          "",
        );
        if (!busyRef.current) {
          if (panelRef.current) setPanel(null);
          else setDrawingFocus(false);
        }
        return;
      }
      const next = history.state?.mobileRoute;
      navigationDepth.current = Math.max(0, history.state?.mobileDepth ?? 0);
      setPanel(null);
      setPlaying(false);
      setRoute(
        ["project", "text", "draw", "send", "preview"].includes(next)
          ? next
          : "project",
      );
    };
    navigationDepth.current = 0;
    history.replaceState({ mobileRoute: "project", mobileDepth: 0 }, "");
    window.addEventListener("popstate", back);
    return () => {
      window.visualViewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
      window.removeEventListener("popstate", back);
    };
  }, [setError]);
  const go = (next: Route, message = active) => {
    forceTextRender.current = false;
    setDrawingFocus(false);
    if (next === "project" && navigationDepth.current > 0) {
      setPanel(null);
      setPlaying(false);
      void flush();
      history.go(-navigationDepth.current);
      return;
    }
    if (next === "preview")
      setPreviewStart({
        scope: route === "project" ? "sequence" : "slot",
        step: route === "draw" && active.mode === "animation" ? frameIndex : 0,
      });
    setPanel(null);
    setPlaying(false);
    setStep(0);
    setStatus(null);
    if (message) {
      setSelectedId(message.id);
      setDraft(message.text?.value ?? "");
      setFace(message.text?.face ?? "serif");
    }
    setFrameIndex(0);
    setSelection(null);
    if (next !== route) {
      navigationDepth.current++;
      history.pushState(
        { mobileRoute: next, mobileDepth: navigationDepth.current },
        "",
      );
    }
    setRoute(next);
    void flush();
  };
  const update = useCallback(
    (id: string, fn: (m: Message) => Message, record = true) => {
      commit(
        (p) => ({
          ...p,
          messages: p.messages.map((m) => (m.id === id ? fn(m) : m)),
        }),
        record,
      );
      setSent(false);
    },
    [commit],
  );

  // Rendering only replaces editable text. Imported pixel artwork is never inferred as text.
  useEffect(() => {
    if (route !== "text" || !ready || !active.text) {
      setRendering(false);
      return;
    }
    if (
      draft === active.text.value &&
      face === active.text.face &&
      !forceTextRender.current
    ) {
      setRendering(false);
      return;
    }
    const sequence = ++renderSequence.current;
    const id = active.id;
    setRendering(true);
    const timer = setTimeout(() => {
      void platform
        .renderText(draft, face)
        .then((bitmap) => {
          if (sequence !== renderSequence.current) return;
          setRendering(false);
          forceTextRender.current = false;
          update(id, (m) => ({
            ...m,
            name: draft.trim().slice(0, 20) || "Untitled",
            width: bitmap.width || BADGE_WIDTH,
            frames: [resizeFrame(bitmap.rows, bitmap.width || BADGE_WIDTH)],
            text: { value: draft, face },
          }));
          setError(
            bitmap.missing.length
              ? `Some characters have no glyph: ${bitmap.missing.join(" ")}.`
              : null,
          );
        })
        .catch((e) => {
          if (sequence === renderSequence.current) {
            setError(String(e));
            setRendering(false);
          }
        })
        .finally(() => {
          if (sequence === renderSequence.current) setRendering(false);
        });
    }, 100);
    return () => {
      clearTimeout(timer);
      renderSequence.current++;
    };
  }, [
    draft,
    face,
    fontChoiceVersion,
    active.id,
    active.text?.value,
    active.text?.face,
    ready,
    route,
    update,
    setError,
  ]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => setStep((s) => (s + 1) % Math.max(1, previewPeriod(active))),
      stepDelay(active.speed),
    );
    return () => clearInterval(timer);
  }, [playing, active]);
  useEffect(() => {
    setFrameIndex((i) => Math.min(i, active.frames.length - 1));
  }, [active.frames.length]);
  useEffect(() => platform.onSendProgress(setProgress), []);
  useEffect(() => setSelection(null), [active.id, frameIndex]);

  const shownFrame =
    playing && active.mode === "animation"
      ? step % active.frames.length
      : Math.min(frameIndex, active.frames.length - 1);
  const selectFrame = (index: number) => {
    setPlaying(false);
    setFrameIndex(index);
    setStep(index);
    setSelection(null);
  };
  const pauseFrame = () => {
    const index = shownFrame;
    setPlaying(false);
    setFrameIndex(index);
    setSelection(null);
    return index;
  };
  const toggleDrawingPlayback = () => {
    if (playing) pauseFrame();
    else {
      setStep(active.mode === "animation" ? frameIndex : 0);
      setPlaying(true);
    }
  };
  const duplicateFrame = () => {
    if (active.frames.length >= ANIMATION_MAX_FRAMES) return;
    const index = pauseFrame();
    update(active.id, (m) => {
      const frames = [...m.frames];
      frames.splice(index + 1, 0, cloneFrame(m.frames[index]));
      return { ...m, frames };
    });
    selectFrame(index + 1);
  };
  const addBlankFrame = () => {
    if (active.frames.length >= ANIMATION_MAX_FRAMES) return;
    const index = active.frames.length;
    update(active.id, (m) => ({
      ...m,
      frames: [...m.frames, blankFrame(m.width)],
    }));
    selectFrame(index);
  };
  const add = (kind: "text" | "drawing" | "animation") => {
    const text = kind === "text";
    if (project.messages.length >= MAX_MESSAGES) return;
    const message: Message = {
      ...newMessage(
        text ? "scroll_left" : kind === "animation" ? "animation" : "fixed",
      ),
      ...(text ? { text: { value: "", face: "serif" } } : {}),
    };
    commit((p) => ({ ...p, messages: [...p.messages, message] }));
    go(text ? "text" : "draw", message);
  };
  const applyMode = (value: Mode) => {
    update(active.id, (m) => ({
      ...m,
      mode: value,
      text: value === "animation" ? undefined : m.text,
      width: value === "animation" ? BADGE_WIDTH : m.width,
      frames:
        value === "animation"
          ? m.frames.map((f) => resizeFrame(f, BADGE_WIDTH))
          : [m.frames[0]],
    }));
    setFrameIndex(0);
    setStep(0);
    if (value === "animation" && route === "text") setRoute("draw");
  };
  const mode = (value: Mode) => {
    if (value === active.mode) return;
    if (
      (active.mode === "animation" && active.frames.length > 1) ||
      (value === "animation" && active.width > BADGE_WIDTH)
    ) {
      setPendingMode(value);
      setPanel("confirm-mode");
    } else applyMode(value);
  };
  const updateFrame = (fn: (f: Frame) => Frame) =>
    update(active.id, (m) => ({
      ...m,
      text: undefined,
      frames: m.frames.map((f, i) => (i === frameIndex ? fn(f) : f)),
    }));
  const moveFrame = (to: number) => {
    if (to < 0 || to >= active.frames.length) return;
    update(active.id, (m) => {
      const frames = [...m.frames];
      const [moved] = frames.splice(frameIndex, 1);
      frames.splice(to, 0, moved);
      return { ...m, frames };
    });
    setFrameIndex(to);
    setSelection(null);
  };
  const moveSlot = (delta: number) => {
    commit((p) => {
      const messages = [...p.messages];
      const from = messages.findIndex((m) => m.id === active.id);
      const to = from + delta;
      if (to < 0 || to >= messages.length) return p;
      const [moved] = messages.splice(from, 1);
      messages.splice(to, 0, moved);
      return { ...p, messages };
    });
    setSent(false);
  };
  const nudge = (dx: number, dy: number) => {
    if (!selection) return;
    const moved = {
      x0: selection.x0 + dx,
      x1: selection.x1 + dx,
      y0: selection.y0 + dy,
      y1: selection.y1 + dy,
    };
    // Keep selected pixels on the canvas; shifts of the whole frame wrap separately.
    if (
      moved.x0 < 0 ||
      moved.y0 < 0 ||
      moved.x1 >= active.width ||
      moved.y1 >= 11
    )
      return;
    updateFrame((f) =>
      pasteBlock(
        clearRect(f, selection),
        extractRect(f, selection),
        moved.x0,
        moved.y0,
        true,
      ),
    );
    setSelection(moved);
  };
  const usedColumns = enabledMessages(project.messages).reduce(
    (n, m) => n + byteColumns(m),
    0,
  );
  const textBudget =
    Math.max(
      0,
      MAX_BYTE_COLUMNS -
        enabledMessages(project.messages)
          .filter((m) => m.id !== active.id)
          .reduce((n, m) => n + byteColumns(m), 0),
    ) * 8;
  const insertStamp = async () => {
    setRendering(true);
    setError(null);
    try {
      const bitmap = await platform.renderText(stampText, stampFace);
      const ox = selection?.x0 ?? 0,
        oy = selection?.y0 ?? 0;
      update(active.id, (m) => {
        const width =
          m.mode === "animation"
            ? BADGE_WIDTH
            : Math.min(MAX_BITMAP_WIDTH, Math.max(m.width, ox + bitmap.width));
        return {
          ...m,
          text: undefined,
          width,
          frames: m.frames.map((f, i) =>
            i === frameIndex
              ? resizeFrame(
                  stamp(resizeFrame(f, width), bitmap.rows, ox, oy, false),
                  width,
                )
              : resizeFrame(f, width),
          ),
        };
      });
      if (bitmap.missing.length)
        setError(`Some characters have no glyph: ${bitmap.missing.join(" ")}.`);
      setPanel(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setRendering(false);
    }
  };
  const insertImage = async () => {
    setBusy("file");
    setError(null);
    try {
      const data = await platform.pickImage();
      if (!data) return;
      const image = await importImage(data, {
        threshold,
        asFrames: active.mode === "animation",
      });
      update(active.id, (m) => ({
        ...m,
        text: undefined,
        frames: image.frames,
        width: image.width,
      }));
      setFrameIndex(0);
      setSelection(null);
      setPanel(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };
  const scan = async () => {
    if (operation.current) return;
    operation.current = true;
    setBusy("scan");
    setError(null);
    setStatus(null);
    try {
      const found = await platform.bleScan(6000);
      setBadges(found);
      setBadgeId((id) =>
        found.some((b) => b.id === id) ? id : (found[0]?.id ?? null),
      );
      if (!found.length)
        setStatus("No badge found; unplug its USB cable and press button 1.");
    } catch (e) {
      setError(String(e));
    } finally {
      operation.current = false;
      setBusy(null);
    }
  };
  const send = async () => {
    if (!badgeId || operation.current) return;
    const live = enabledMessages(project.messages);
    if (!live.length) {
      setError("Enable at least one slot before sending.");
      return;
    }
    operation.current = true;
    setBusy("send");
    setError(null);
    setProgress(null);
    setSent(false);
    try {
      await flush();
      await platform.sendBle(
        live.map((m) => ({
          frames: m.mode === "animation" ? m.frames : [m.frames[0]],
          mode: m.mode,
          speed: m.speed,
          blink: m.blink,
          ants: m.ants,
        })),
        project.brightness,
        badgeId,
      );
      setSent(true);
      setStatus("The badge accepted the transfer.");
    } catch (e) {
      const err = e as { message?: string };
      setError(err?.message ?? String(e));
    } finally {
      operation.current = false;
      setBusy(null);
      setProgress(null);
    }
  };
  const file = async (
    action: "import" | "export",
    kind: "project" | "message" = "project",
  ) => {
    if (operation.current) return;
    operation.current = true;
    setBusy("file");
    setPanel(null);
    setError(null);
    try {
      if (action === "import") {
        const json = platform.importDocument
          ? await platform.importDocument(kind)
          : (await platform.pickOpen(kind))?.text;
        if (json) {
          if (kind === "message") {
            if (project.messages.length >= MAX_MESSAGES)
              throw new Error("A project holds eight slots.");
            const message = { ...parseMessage(json), id: newMessage().id };
            commit((p) => ({ ...p, messages: [...p.messages, message] }));
            go(message.text ? "text" : "draw", message);
          } else {
            replace(parseProject(json));
            setSelectedId(null);
            setRoute("project");
          }
          setSent(false);
        }
      } else {
        const json =
          kind === "message"
            ? serializeMessage(active)
            : serializeProject(project);
        if (platform.exportDocument) await platform.exportDocument(json, kind);
        else {
          const path = await platform.pickSave(
            kind,
            kind === "message" ? "Slot.badgemsg" : "BlinkenBadge.badge",
          );
          if (path) await platform.writeText(path, json, kind);
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      operation.current = false;
      setBusy(null);
    }
  };
  const sheetTitle: Record<Exclude<Panel, null>, string> = {
    project: "Project",
    add: "Add Slot",
    font: "Font",
    motion: "Motion",
    tool: "Drawing Tool",
    canvas: "Canvas",
    message: "Slot",
    frames: "Frame",
    selection: "Selection",
    transform: "Transform",
    insert: "Insert",
    stamp: "Stamp Text",
    image: "Import Image",
    color: "LED Color",
    "confirm-mode": "Change Mode",
    "confirm-new": "New Project",
    "confirm-import": "Import Project",
    "confirm-delete": "Delete Slot",
    convert: "Edit Pixels",
  };
  const disabled = !!busy || rendering || !ready;
  const done = () => {
    if (!disabled) {
      setDraft(active.text?.value ?? "");
      go("project");
    }
  };
  return (
    <div
      className="mobile-app"
      data-drawing-focus={route === "draw" && drawingFocus ? "true" : undefined}
      ref={root}
      style={
        {
          "--mobile-led": LED_COLORS[led],
          "--mobile-onion": ledPalette(led).onion,
        } as React.CSSProperties
      }
    >
      <div className="mobile-screen">
        <header className="mobile-header">
          {route !== "project" && (
            <button
              className="mobile-back"
              aria-label="Back to Slots"
              disabled={disabled}
              onClick={done}
            >
              ‹
            </button>
          )}
          <div
            className={
              route === "project"
                ? "mobile-project-title"
                : "mobile-editor-title"
            }
          >
            <h1>
              {route === "project"
                ? "My Badge"
                : route === "preview"
                  ? "Preview"
                  : route === "send"
                    ? "Send to Badge"
                    : active.name}
            </h1>
            {route === "project" && <span role="status">{saveState}</span>}
          </div>
          {route === "project" ? (
            <button
              aria-label="Project Options"
              disabled={disabled}
              onClick={() => setPanel("project")}
            >
              •••
            </button>
          ) : route === "draw" ? (
            <div className="studio-header-history">
              <button
                aria-label="Undo"
                disabled={!editor.canUndo || playing}
                onClick={editor.undo}
              >
                <StudioIcon name="undo" />
              </button>
              <button
                aria-label="Redo"
                disabled={!editor.canRedo || playing}
                onClick={editor.redo}
              >
                <StudioIcon name="redo" />
              </button>
            </div>
          ) : route !== "send" ? (
            <button disabled={disabled} onClick={done}>
              Done
            </button>
          ) : (
            <span className="mobile-header-spacer" />
          )}
        </header>
        {error && (
          <div className="mobile-notice" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss Error" onClick={() => setError(null)}>
              ×
            </button>
          </div>
        )}
        {!ready ? (
          <main className="mobile-content" role="status">
            Opening your draft...
          </main>
        ) : (
          <>
            {route === "project" && (
              <>
                <main className="mobile-content mobile-message-list">
                  {project.messages.map((m, index) => (
                    <button
                      key={m.id}
                      className="mobile-message-card"
                      onClick={() => go(m.text ? "text" : "draw", m)}
                      disabled={!!busy}
                    >
                      <div>
                        <strong>{m.name}</strong>
                        <span>
                          {m.text
                            ? "Text"
                            : m.mode === "animation"
                              ? "Animation"
                              : "Drawing"}{" "}
                          · Slot {index + 1}
                          {m.mode === "animation"
                            ? ` · ${m.frames.length} Frames`
                            : ""}
                          {m.enabled === false ? " · Off" : ""}
                        </span>
                      </div>
                      <MiniBadge message={m} brightness={project.brightness} />
                      {m.text?.value === "" && (
                        <span className="mobile-empty-hint">
                          Tap to add text.
                        </span>
                      )}
                    </button>
                  ))}
                </main>
                <footer className="mobile-footer">
                  <button
                    disabled={
                      disabled || project.messages.length >= MAX_MESSAGES
                    }
                    onClick={() => setPanel("add")}
                  >
                    + Add
                  </button>
                  <button disabled={disabled} onClick={() => go("preview")}>
                    Preview
                  </button>
                  <button
                    className="mobile-primary"
                    disabled={disabled}
                    onClick={() => {
                      setSent(false);
                      go("send");
                    }}
                  >
                    Send
                  </button>
                </footer>
              </>
            )}
            {route === "text" && (
              <main className="mobile-content mobile-compose">
                <div className="mobile-preview-panel">
                  <MiniBadge
                    message={active}
                    step={playing ? step : undefined}
                    playing={playing}
                    brightness={project.brightness}
                  />
                  <button
                    className="mobile-preview-play"
                    aria-label={playing ? "Pause Preview" : "Play Preview"}
                    onClick={() => {
                      setPlaying((p) => !p);
                      setStep(0);
                    }}
                  >
                    {playing ? "Pause" : "Play"}
                  </button>
                </div>
                <div>
                  <label
                    className="mobile-input-label"
                    htmlFor="mobile-message-text"
                  >
                    Message
                  </label>
                  <textarea
                    id="mobile-message-text"
                    rows={3}
                    value={draft}
                    maxLength={8192}
                    onChange={(e) => {
                      setDraft(fitText(e.target.value, textBudget, face));
                      setRendering(true);
                    }}
                    spellCheck={false}
                    autoCapitalize="off"
                  />
                </div>
                <div className="mobile-text-options">
                  <button disabled={rendering} onClick={() => setPanel("font")}>
                    {fonts.find((f) => f.id === face)?.name ?? "Font"}
                  </button>
                  <button
                    disabled={rendering}
                    onClick={() => setPanel("motion")}
                  >
                    {MODE_LABELS[active.mode]}
                  </button>
                  <button
                    onClick={() => {
                      setShowEmoji((v) => !v);
                    }}
                  >
                    Pictographs
                  </button>
                  <button
                    aria-label="Slot Options"
                    disabled={rendering}
                    onClick={() => setPanel("message")}
                  >
                    •••
                  </button>
                </div>
                {showEmoji && (
                  <EmojiPalette
                    chars={pictographs()}
                    led={led}
                    onPick={(c) => {
                      setDraft((t) => fitText(t + c, textBudget, face));
                      setRendering(true);
                    }}
                  />
                )}
                <span>
                  {measureText(draft, face)} / {textBudget} px
                </span>
                <span className="mobile-render-status" role="status">
                  {rendering ? "Updating Preview" : ""}
                </span>
              </main>
            )}
            {route === "draw" && (
              <DrawingWorkspace
                key={active.id}
                message={active}
                current={frameIndex}
                playing={playing}
                step={step}
                brightness={project.brightness}
                focus={drawingFocus}
                onFocus={setDrawingFocus}
                onion={onion}
                onOnion={setOnion}
                onPlay={toggleDrawingPlayback}
                onSelect={selectFrame}
                onDuplicate={duplicateFrame}
                onBlank={addBlankFrame}
                onFrames={() => {
                  pauseFrame();
                  setPanel("frames");
                }}
                onTools={() => {
                  pauseFrame();
                  setPanel("tool");
                }}
                onMore={() => {
                  pauseFrame();
                  setPanel("canvas");
                }}
                undo={editor.undo}
                redo={editor.redo}
                canUndo={editor.canUndo && !playing}
                canRedo={editor.canRedo && !playing}
                canvas={{
                  tool,
                  brushSize,
                  filled,
                  selection,
                  onSelectionChange: setSelection,
                  fitVersion,
                  zoomVersion,
                  onChange: (next, record) => {
                    if (!playing)
                      update(
                        active.id,
                        (m) => ({
                          ...m,
                          text: undefined,
                          frames: m.frames.map((f, i) =>
                            i === frameIndex ? next : f,
                          ),
                        }),
                        record,
                      );
                  },
                }}
              />
            )}
            {route === "preview" && (
              <MobilePreview
                project={project}
                selectedId={active.id}
                initialScope={previewStart.scope}
                initialStep={previewStart.step}
                onEdit={(message, frame) => {
                  go(message.text ? "text" : "draw", message);
                  setFrameIndex(frame);
                }}
              />
            )}
            {route === "send" && (
              <main className="mobile-content mobile-send">
                <section>
                  <h2>{enabledMessages(project.messages).length} Slots</h2>
                  <p>
                    {usedColumns} / {MAX_BYTE_COLUMNS} byte columns used.
                  </p>
                  <div className="mobile-send-preview">
                    {enabledMessages(project.messages).map((m) => (
                      <MiniBadge key={m.id} message={m} />
                    ))}
                  </div>
                </section>
                <section>
                  <h2>Badge</h2>
                  <p>
                    Unplug the badge from USB and press button 1 to enable
                    Bluetooth.
                  </p>
                  <button
                    className="mobile-connect"
                    disabled={!!busy}
                    onClick={() => void scan()}
                  >
                    {busy === "scan"
                      ? "Finding Badges"
                      : badges.length
                        ? "Find Again"
                        : "Find Badge"}
                  </button>
                  {badges.map((b) => (
                    <button
                      key={b.id}
                      className="mobile-device"
                      aria-pressed={badgeId === b.id}
                      disabled={!!busy}
                      onClick={() => setBadgeId(b.id)}
                    >
                      <span>{b.name ?? "LED Badge"}</span>
                      <span>
                        {b.rssi === null ? "Bluetooth" : `${b.rssi} dBm`}
                      </span>
                    </button>
                  ))}
                </section>
                <label className="mobile-brightness">
                  Brightness
                  <select
                    value={project.brightness}
                    disabled={!!busy}
                    onChange={(e) =>
                      commit((p) => ({
                        ...p,
                        brightness: Number(
                          e.target.value,
                        ) as Project["brightness"],
                      }))
                    }
                  >
                    {[25, 50, 75, 100].map((n) => (
                      <option key={n} value={n}>
                        {n}%
                      </option>
                    ))}
                  </select>
                </label>
                {progress && (
                  <progress
                    max={progress.total}
                    value={progress.chunk}
                    aria-label="Sending Progress"
                  />
                )}
                {(status || busy === "send") && (
                  <p role="status">
                    {busy === "send"
                      ? "Keep this app open until the transfer finishes."
                      : status}
                  </p>
                )}
                <button
                  className="mobile-primary mobile-send-button"
                  disabled={
                    !!busy ||
                    !badgeId ||
                    !enabledMessages(project.messages).length ||
                    usedColumns > MAX_BYTE_COLUMNS
                  }
                  onClick={() => void send()}
                >
                  {busy === "send"
                    ? "Sending"
                    : sent
                      ? "Send Again"
                      : "Send to Badge"}
                </button>
              </main>
            )}
          </>
        )}
      </div>
      {panel && (
        <Sheet
          title={sheetTitle[panel]}
          onClose={() => setPanel(null)}
          busy={!!busy || rendering}
        >
          <div className="mobile-sheet-actions">
            {panel === "project" && (
              <>
                <button onClick={() => setPanel("confirm-new")}>
                  New Project
                </button>
                <button onClick={() => setPanel("confirm-import")}>
                  Import Project
                </button>
                <button onClick={() => void file("export")}>
                  Export Project
                </button>
                <button
                  disabled={project.messages.length >= MAX_MESSAGES}
                  onClick={() => void file("import", "message")}
                >
                  Import Slot
                </button>
                <button disabled={!editor.canUndo} onClick={editor.undo}>
                  Undo
                </button>
                <button disabled={!editor.canRedo} onClick={editor.redo}>
                  Redo
                </button>
                <button onClick={() => setPanel("color")}>LED Color</button>
              </>
            )}
            {panel === "frames" && (
              <>
                <p>
                  Slot {project.messages.indexOf(active) + 1} · Frame{" "}
                  {frameIndex + 1} of {active.frames.length}
                </p>
                <label className="mobile-check">
                  <input
                    type="checkbox"
                    checked={onion}
                    onChange={(e) => setOnion(e.target.checked)}
                  />
                  Onion Skin
                </label>
                <button
                  disabled={active.frames.length >= ANIMATION_MAX_FRAMES}
                  onClick={() => {
                    duplicateFrame();
                    setPanel(null);
                  }}
                >
                  Duplicate Frame
                </button>
                <button
                  disabled={active.frames.length >= ANIMATION_MAX_FRAMES}
                  onClick={() => {
                    addBlankFrame();
                    setPanel(null);
                  }}
                >
                  Add Blank Frame
                </button>
                <button
                  disabled={frameIndex === 0}
                  onClick={() =>
                    updateFrame(() => cloneFrame(active.frames[frameIndex - 1]))
                  }
                >
                  Copy Previous
                </button>
                <div className="mobile-control-grid">
                  <button
                    disabled={frameIndex === 0}
                    onClick={() => moveFrame(frameIndex - 1)}
                  >
                    Move Frame Left
                  </button>
                  <button
                    disabled={frameIndex >= active.frames.length - 1}
                    onClick={() => moveFrame(frameIndex + 1)}
                  >
                    Move Frame Right
                  </button>
                </div>
                <button
                  disabled={active.frames.length <= 1}
                  onClick={() => {
                    update(active.id, (m) => ({
                      ...m,
                      frames: m.frames.filter((_, i) => i !== frameIndex),
                    }));
                    setFrameIndex(Math.max(0, frameIndex - 1));
                    setSelection(null);
                    setPanel(null);
                  }}
                >
                  Delete Frame
                </button>
              </>
            )}
            {panel === "selection" && (
              <>
                <p>
                  Drag to select pixels, then drag inside the selection to move
                  them.
                </p>
                <button
                  onClick={() => {
                    setSelection({
                      x0: 0,
                      y0: 0,
                      x1: active.width - 1,
                      y1: 10,
                    });
                    setPanel(null);
                  }}
                >
                  Select All
                </button>
                <div className="mobile-control-grid">
                  <button
                    disabled={!selection}
                    onClick={() => {
                      setClipboard(extractRect(frame, selection!));
                      setPanel(null);
                    }}
                  >
                    Copy
                  </button>
                  <button
                    disabled={!selection}
                    onClick={() => {
                      setClipboard(extractRect(frame, selection!));
                      updateFrame((f) => clearRect(f, selection!));
                      setPanel(null);
                    }}
                  >
                    Cut
                  </button>
                  <button
                    disabled={!clipboard}
                    onClick={() => {
                      const x = selection?.x0 ?? 0,
                        y = selection?.y0 ?? 0;
                      updateFrame((f) =>
                        pasteBlock(f, clipboard!, x, y, false),
                      );
                      setSelection({
                        x0: x,
                        y0: y,
                        x1: Math.min(
                          active.width - 1,
                          x + clipboard![0].length - 1,
                        ),
                        y1: Math.min(10, y + clipboard!.length - 1),
                      });
                      setPanel(null);
                    }}
                  >
                    Paste
                  </button>
                  <button
                    disabled={!selection}
                    onClick={() => {
                      updateFrame((f) => clearRect(f, selection!));
                      setPanel(null);
                    }}
                  >
                    Erase Selection
                  </button>
                  <button disabled={!selection} onClick={() => nudge(-1, 0)}>
                    Nudge Left
                  </button>
                  <button disabled={!selection} onClick={() => nudge(1, 0)}>
                    Nudge Right
                  </button>
                  <button disabled={!selection} onClick={() => nudge(0, -1)}>
                    Nudge Up
                  </button>
                  <button disabled={!selection} onClick={() => nudge(0, 1)}>
                    Nudge Down
                  </button>
                </div>
                <button
                  onClick={() => {
                    setSelection(null);
                    setPanel(null);
                  }}
                >
                  Deselect
                </button>
              </>
            )}
            {panel === "transform" && (
              <>
                {active.mode !== "animation" && (
                  <label>
                    Width
                    <input
                      aria-label="Canvas Width"
                      type="number"
                      min="8"
                      max={MAX_BITMAP_WIDTH}
                      value={active.width}
                      onChange={(e) => {
                        const width = Math.max(
                          8,
                          Math.min(
                            MAX_BITMAP_WIDTH,
                            Math.round(Number(e.target.value)),
                          ),
                        );
                        if (Number.isFinite(width))
                          update(active.id, (m) => ({
                            ...m,
                            text: undefined,
                            width,
                            frames: m.frames.map((f) => resizeFrame(f, width)),
                          }));
                      }}
                    />
                  </label>
                )}
                <div className="mobile-control-grid">
                  <button onClick={() => updateFrame(invert)}>Invert</button>
                  <button onClick={() => updateFrame(flipH)}>
                    Flip Horizontal
                  </button>
                  <button onClick={() => updateFrame(flipV)}>
                    Flip Vertical
                  </button>
                  <button
                    onClick={() =>
                      update(active.id, (m) => ({
                        ...m,
                        text: undefined,
                        width: BADGE_WIDTH,
                        frames: m.frames.map((f, i) =>
                          i === frameIndex
                            ? blankFrame(BADGE_WIDTH)
                            : resizeFrame(f, BADGE_WIDTH),
                        ),
                      }))
                    }
                  >
                    Clear Frame
                  </button>
                  <button onClick={() => updateFrame((f) => shift(f, -1, 0))}>
                    Shift Left
                  </button>
                  <button onClick={() => updateFrame((f) => shift(f, 1, 0))}>
                    Shift Right
                  </button>
                  <button onClick={() => updateFrame((f) => shift(f, 0, -1))}>
                    Shift Up
                  </button>
                  <button onClick={() => updateFrame((f) => shift(f, 0, 1))}>
                    Shift Down
                  </button>
                </div>
              </>
            )}
            {panel === "insert" && (
              <>
                <button onClick={() => setPanel("stamp")}>Stamp Text</button>
                <button onClick={() => setPanel("image")}>Import Image</button>
              </>
            )}
            {panel === "stamp" && (
              <>
                <p>
                  Text overlays this frame at the selection or top-left corner.
                </p>
                <label>
                  Text
                  <textarea
                    aria-label="Stamp Text"
                    rows={2}
                    value={stampText}
                    onChange={(e) =>
                      setStampText(
                        fitText(e.target.value, textBudget, stampFace),
                      )
                    }
                  />
                </label>
                <label>
                  Pixel Font
                  <select
                    aria-label="Stamp Font"
                    value={stampFace}
                    onChange={(e) => setStampFace(e.target.value)}
                  >
                    {fonts.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <span>
                  {measureText(stampText, stampFace)} /{" "}
                  {active.mode === "animation" ? BADGE_WIDTH : textBudget} px
                  {active.mode === "animation" ? " · Cropped to Frame" : ""}
                </span>
                <button onClick={() => setShowEmoji((v) => !v)}>
                  Pictographs
                </button>
                {showEmoji && (
                  <EmojiPalette
                    chars={pictographs()}
                    led={led}
                    onPick={(c) =>
                      setStampText((t) => fitText(t + c, textBudget, stampFace))
                    }
                  />
                )}
                <button
                  className="mobile-primary"
                  disabled={!stampText || rendering}
                  onClick={() => void insertStamp()}
                >
                  Insert Text
                </button>
              </>
            )}
            {panel === "image" && (
              <>
                <p>
                  {active.mode === "animation"
                    ? "A horizontal image strip replaces this slot with up to eight frames."
                    : "The image replaces this slot and scales to eleven pixels tall."}
                </p>
                <label>
                  Threshold
                  <input
                    type="range"
                    min="0"
                    max="255"
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                  />
                </label>
                <button
                  className="mobile-primary"
                  disabled={!!busy}
                  onClick={() => void insertImage()}
                >
                  Choose Image
                </button>
              </>
            )}
            {panel === "color" && (
              <>
                {LED_ORDER.map((color) => (
                  <button
                    key={color}
                    aria-pressed={led === color}
                    onClick={() => {
                      setLed(color);
                      setPanel(null);
                    }}
                  >
                    {color[0].toUpperCase() + color.slice(1)}
                  </button>
                ))}
              </>
            )}
            {panel === "confirm-mode" && (
              <>
                <p>
                  {pendingMode === "animation"
                    ? "Animation crops each frame to 44 pixels wide."
                    : "Leaving animation keeps only the first frame; Undo restores the others."}
                </p>
                <button
                  onClick={() => {
                    if (pendingMode) applyMode(pendingMode);
                    setPanel(null);
                    setPendingMode(null);
                  }}
                >
                  Change Mode
                </button>
              </>
            )}
            {panel === "confirm-import" && (
              <>
                <p>The imported project replaces this device draft.</p>
                <button onClick={() => void file("export")}>
                  Export Current Draft
                </button>
                <button
                  className="mobile-primary"
                  onClick={() => void file("import")}
                >
                  Choose Project
                </button>
              </>
            )}
            {panel === "add" && (
              <>
                <button onClick={() => add("text")}>Text Message</button>
                <button onClick={() => add("drawing")}>Pixel Drawing</button>
                <button onClick={() => add("animation")}>Animation</button>
              </>
            )}
            {panel === "font" &&
              fonts.map((f) => (
                <FontChoice
                  key={f.id}
                  face={f}
                  selected={face === f.id}
                  onSelect={() => {
                    forceTextRender.current = true;
                    refreshFontChoice((value) => value + 1);
                    setDraft((t) => fitText(t, textBudget, f.id));
                    setFace(f.id);
                    setPanel(null);
                  }}
                />
              ))}
            {panel === "motion" && (
              <>
                <label>
                  Mode
                  <select
                    value={active.mode}
                    onChange={(e) => mode(e.target.value as Mode)}
                  >
                    {MODES.map((m) => (
                      <option key={m} value={m}>
                        {MODE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Speed
                  <input
                    type="range"
                    min="1"
                    max="8"
                    value={active.speed}
                    onChange={(e) =>
                      update(active.id, (m) => ({
                        ...m,
                        speed: Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <label className="mobile-check">
                  <input
                    type="checkbox"
                    checked={active.blink}
                    onChange={(e) =>
                      update(active.id, (m) => ({
                        ...m,
                        blink: e.target.checked,
                      }))
                    }
                  />
                  Blink
                </label>
                <label className="mobile-check">
                  <input
                    type="checkbox"
                    checked={active.ants}
                    onChange={(e) =>
                      update(active.id, (m) => ({
                        ...m,
                        ants: e.target.checked,
                      }))
                    }
                  />
                  Border
                </label>
              </>
            )}
            {panel === "tool" && (
              <>
                <div className="mobile-control-grid">
                  {(
                    [
                      ["pencil", "Draw"],
                      ["eraser", "Erase"],
                      ["fill", "Fill"],
                      ["line", "Line"],
                      ["rect", "Rectangle"],
                      ["ellipse", "Ellipse"],
                      ["select", "Select"],
                      ["pan", "Move Canvas"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      aria-pressed={tool === id}
                      onClick={() => {
                        setTool(id);
                        setPanel(null);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p>
                  With Draw, tap to toggle a pixel. Start on a dark pixel to
                  draw, or a lit pixel to erase.
                </p>
                {tool === "select" && (
                  <button onClick={() => setPanel("selection")}>
                    Selection Options
                  </button>
                )}
                <label>
                  Brush Size
                  <select
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                  >
                    {[1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n} px
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mobile-check">
                  <input
                    type="checkbox"
                    checked={filled}
                    onChange={(e) => setFilled(e.target.checked)}
                  />
                  Filled Shapes
                </label>
              </>
            )}
            {panel === "canvas" && (
              <>
                <button onClick={() => setPanel("insert")}>Insert</button>
                <button onClick={() => setPanel("transform")}>Transform</button>
                <button
                  onClick={() => {
                    setTool("select");
                    setPanel("selection");
                  }}
                >
                  Selection
                </button>
                <button onClick={() => go("preview")}>Preview</button>
                {active.mode === "animation" && (
                  <button onClick={() => setPanel("frames")}>
                    Frame Options
                  </button>
                )}
                <button
                  onClick={() => {
                    fit((v) => v + 1);
                    setPanel(null);
                  }}
                >
                  Fit Canvas
                </button>
                <button
                  onClick={() => {
                    zoom((v) => v + 1);
                    setPanel(null);
                  }}
                >
                  Zoom In
                </button>
                <button
                  disabled={!editor.canRedo}
                  onClick={() => {
                    editor.redo();
                    setPanel(null);
                  }}
                >
                  Redo
                </button>
                <button onClick={() => setPanel("motion")}>Motion</button>
                <button onClick={() => setPanel("message")}>
                  Slot Options
                </button>
              </>
            )}
            {panel === "message" && (
              <>
                <button
                  disabled={project.messages[0].id === active.id}
                  onClick={() => moveSlot(-1)}
                >
                  Move Slot Up
                </button>
                <button
                  disabled={
                    project.messages[project.messages.length - 1].id ===
                    active.id
                  }
                  onClick={() => moveSlot(1)}
                >
                  Move Slot Down
                </button>
                <button onClick={() => void file("export", "message")}>
                  Export Slot
                </button>
                <label>
                  Name
                  <input
                    value={active.name}
                    maxLength={100}
                    onChange={(e) =>
                      update(active.id, (m) => ({ ...m, name: e.target.value }))
                    }
                  />
                </label>
                <label className="mobile-check">
                  <input
                    type="checkbox"
                    checked={active.enabled}
                    onChange={(e) =>
                      update(active.id, (m) => ({
                        ...m,
                        enabled: e.target.checked,
                      }))
                    }
                  />
                  Enable Slot
                </label>
                {active.text && (
                  <button onClick={() => setPanel("convert")}>
                    Edit Pixels
                  </button>
                )}
                <button
                  disabled={project.messages.length >= MAX_MESSAGES}
                  onClick={() => {
                    const copy = {
                      ...active,
                      id: newMessage("fixed").id,
                      name: `${active.name} Copy`,
                      frames: active.frames.map(cloneFrame),
                    };
                    commit((p) => ({ ...p, messages: [...p.messages, copy] }));
                    go(copy.text ? "text" : "draw", copy);
                  }}
                >
                  Duplicate Slot
                </button>
                <button
                  disabled={project.messages.length <= 1}
                  onClick={() => setPanel("confirm-delete")}
                >
                  Delete Slot
                </button>
              </>
            )}
            {panel === "convert" && (
              <>
                <p>
                  Text becomes editable pixels; Undo restores the text source.
                </p>
                <button
                  className="mobile-primary"
                  onClick={() => {
                    update(active.id, (m) => ({ ...m, text: undefined }));
                    setPanel(null);
                    history.replaceState(
                      {
                        mobileRoute: "draw",
                        mobileDepth: navigationDepth.current,
                      },
                      "",
                    );
                    setRoute("draw");
                  }}
                >
                  Edit Pixels
                </button>
              </>
            )}
            {panel === "confirm-new" && (
              <>
                <p>Export a copy before replacing this device draft.</p>
                <button onClick={() => void file("export")}>
                  Export Project
                </button>
                <button
                  onClick={() => {
                    replace(emptyMobileProject());
                    setSelectedId(null);
                    go("project");
                  }}
                >
                  Start New
                </button>
              </>
            )}
            {panel === "confirm-delete" && (
              <>
                <p>This removes the selected slot.</p>
                <button
                  onClick={() => {
                    commit((p) => ({
                      ...p,
                      messages: p.messages.filter((m) => m.id !== active.id),
                    }));
                    setSelectedId(null);
                    go("project");
                  }}
                >
                  Delete Slot
                </button>
              </>
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}
