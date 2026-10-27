// Copyright 2026 Martin Bogomolni
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { platform } from "./platform";
import { useProjectHistory } from "./hooks/useProjectHistory";
import { useRecovery } from "./hooks/useRecovery";
import { MAX_BITMAP_WIDTH } from "./limits";
import PixelCanvas from "./components/PixelCanvas";
import { ToolOptions, ToolPalette } from "./components/ToolPalette";
import Timeline from "./components/Timeline";
import BadgePreview from "./components/BadgePreview";
import TransportBar from "./components/TransportBar";
import PlaybackBar from "./components/PlaybackBar";
import EmojiPalette from "./components/EmojiPalette";
import SlotList from "./components/SlotList";
import Modal from "./components/Modal";
import {
  previewPeriod,
  sequenceAt,
  sequenceLength,
  sequenceSlots,
  stepDelay,
} from "./badge";
import {
  faceList,
  fitText,
  loadFontMetrics,
  measureText,
  pictographs,
} from "./font";
import { importImage } from "./importImage";
import {
  DocError,
  MESSAGE_EXT,
  PROJECT_EXT,
  baseName,
  parseMessage,
  parseProject,
  safeFileName,
  serializeMessage,
  serializeProject,
} from "./doc";
import { clearRect, extractRect, pasteBlock, type Rect } from "./draw";
import {
  byteColumns,
  blankFrame,
  enabledMessages,
  moveTo,
  cloneFrame,
  flipH,
  flipV,
  invert,
  newMessage,
  resizeFrame,
  shift,
  stamp,
} from "./badge";
import {
  BADGE_HEIGHT,
  BADGE_WIDTH,
  ANIMATION_MAX_FRAMES,
  MAX_MESSAGES,
  MAX_BYTE_COLUMNS,
  TOOLS,
  TOOL_KEYS,
  MODES,
  MODE_LABELS,
  LED_COLORS,
  LED_ORDER,
  type LedColor,
  type Frame,
  type Message,
  type Mode,
  type Project,
  type Tool,
} from "./types";
import { WebMenuBar } from "./components/WebMenuBar";
import "./App.css";

const MAX_FRAMES = ANIMATION_MAX_FRAMES;

/** A pending modal. `recover` is asked at startup, the rest guard losing work. */
type Ask =
  | { kind: "recover"; json: string; path: string | null; savedAt: string }
  | { kind: "unsaved"; then: () => void; verb: string }
  | { kind: "quit" };

export default function App() {
  const blank = useMemo<Project>(
    () => ({ messages: [newMessage("scroll_left")], brightness: 100 }),
    [],
  );
  const { project, apply, resetHistory, undo, redo, canUndo, canRedo } =
    useProjectHistory(blank);
  // Which badge you physically own, not a property of the document. Loading
  // someone else's project must not change the color of your hardware.
  const isCapture =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("capture");

  const [led, setLed] = useState<LedColor>(() => {
    try {
      const color = localStorage.getItem("badge-led");
      return LED_ORDER.includes(color as LedColor)
        ? (color as LedColor)
        : "red";
    } catch {
      return "red";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("badge-led", led);
    } catch {
      /* Storage is optional. */
    }
  }, [led]);

  useEffect(() => {
    loadFontMetrics().then(
      () => setMetricsReady(true),
      // Not worth blocking the editor over: measuring falls back to 8px per
      // character, which is right for the face selected at startup.
      () => undefined,
    );
  }, []);
  const [requestedId, setActiveId] = useState<string>(
    () => project.messages[0].id,
  );
  const [frameIndex, setFrameIndex] = useState(0);
  // Parked on the first frame at startup. An animation looping the moment the
  // app opens is motion nobody asked for; press play to preview it.
  const [playing, setPlaying] = useState(false);
  // Preview one message, or the whole 8-slot loop the badge actually cycles.
  const [scope, setScope] = useState<"message" | "sequence">("message");
  const [onion, setOnion] = useState(true);
  const [textInput, setTextInput] = useState("");
  // The face the next stamp uses. Not stored in the document: text becomes
  // pixels the moment it is stamped, so a project has no idea which face drew
  // it and messages can freely mix them.
  const [faceId, setFaceId] = useState("serif");
  // Bumped once the faces arrive, so anything measured before then is
  // remeasured with the real widths rather than the 8px assumption.
  const [metricsReady, setMetricsReady] = useState(false);
  const faces = useMemo(() => (metricsReady ? faceList() : []), [metricsReady]);
  const emoji = useMemo(
    () => (metricsReady ? pictographs() : []),
    [metricsReady],
  );
  // The palette is off until asked for. It is a wall of sprites, and most
  // stamps are text.
  const [showEmoji, setShowEmoji] = useState(false);
  const textRef = useRef<HTMLInputElement>(null);
  const [textWarning, setTextWarning] = useState<string | null>(null);
  // Insert is a two-button group; only the open one shows its controls.
  const [insert, setInsert] = useState<"text" | "image" | null>(null);
  const [threshold, setThreshold] = useState(127);
  const [step, setStep] = useState(0);
  const [tool, setTool] = useState<Tool>("pencil");
  const [brushSize, setBrushSize] = useState(1);
  const [filled, setFilled] = useState(false);
  const [selection, setSelection] = useState<Rect | null>(null);
  /** Message slots picked out for a multi-slot drag. */
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [clipboard, setClipboard] = useState<boolean[][] | null>(null);

  // The file this document belongs to, and the exact bytes last written to it.
  // Dirtiness is a comparison rather than a flag, so undoing back to the saved
  // state correctly stops claiming there is anything to lose.
  const [docPath, setDocPath] = useState<string | null>(null);
  const [savedJson, setSavedJson] = useState<string>(() =>
    serializeProject(blank),
  );
  /** A question that has to be answered before anything else happens. */
  const [ask, setAsk] = useState<Ask | null>(null);
  const documentEpoch = useRef(0);
  const saveSequence = useRef(0);
  const documentWrites = useRef(Promise.resolve());

  const active =
    project.messages.find((m) => m.id === requestedId) ??
    project.messages[0] ??
    null;
  const activeId = active?.id ?? "";
  const commit = useCallback((next: Project) => apply(next, true), [apply]);
  const [startupReady, setStartupReady] = useState(false);
  const currentJson = useMemo(() => serializeProject(project), [project]);
  const dirty = currentJson !== savedJson;
  const { clearRecovery, savedRecovery } = useRecovery(
    currentJson,
    dirty,
    docPath,
    startupReady && ask?.kind !== "recover",
    setTextWarning,
  );

  useEffect(() => {
    setSelection(null);
  }, [activeId, frameIndex]);

  // Keep the selected frame in range when the message or its frames change.
  useEffect(() => {
    if (active && frameIndex >= active.frames.length) {
      setFrameIndex(Math.max(0, active.frames.length - 1));
    }
  }, [active, frameIndex]);

  const updateActive = useCallback(
    (fn: (m: Message) => Message, history = true) => {
      if (!active) return;
      apply(
        {
          ...project,
          messages: project.messages.map((m) =>
            m.id === active.id ? fn(m) : m,
          ),
        },
        history,
      );
    },
    [active, project, apply],
  );

  const updateFrame = useCallback(
    (fn: (f: Frame) => Frame, history = true) => {
      updateActive(
        (m) => ({
          ...m,
          frames: m.frames.map((f, i) => (i === frameIndex ? fn(f) : f)),
        }),
        history,
      );
    },
    [updateActive, frameIndex],
  );

  const setMode = useCallback(
    (mode: Mode) => {
      updateActive((m) => {
        if (mode === "animation") {
          return {
            ...m,
            mode,
            width: BADGE_WIDTH,
            frames: m.frames.map((f) => resizeFrame(f, BADGE_WIDTH)),
          };
        }
        // Leaving animation mode collapses to the first frame, since every
        // other mode displays a single bitmap.
        if (m.mode === "animation") {
          return {
            ...m,
            mode,
            frames: [m.frames[0]],
            width: m.frames[0][0].length,
          };
        }
        return { ...m, mode };
      });
      setFrameIndex(0);
    },
    [updateActive],
  );

  const setWidth = useCallback(
    (width: number) => {
      if (!Number.isFinite(width)) return;
      const w = Math.max(8, Math.min(MAX_BITMAP_WIDTH, Math.round(width)));
      updateActive((m) => ({
        ...m,
        width: w,
        frames: m.frames.map((f) => resizeFrame(f, w)),
      }));
    },
    [updateActive],
  );

  const insertText = useCallback(async () => {
    if (!textInput || !active) return;
    try {
      const bmp = await platform.renderText(textInput, faceId);
      setTextWarning(
        bmp.missing.length
          ? `No glyph for ${bmp.missing.join(" ")}, replaced with "?"`
          : null,
      );
      const grow = active.mode !== "animation";
      updateActive((m) => {
        const frames = m.frames.map((f, i) => {
          if (i !== frameIndex) return f;
          const base = grow ? blankFrame(bmp.width) : f;
          const out = stamp(base, bmp.rows, 0, 0, true);
          // Animation frames must stay exactly the display width.
          return grow ? out : resizeFrame(out, m.width);
        });
        return {
          ...m,
          frames,
          width: grow ? bmp.width : m.width,
          name: m.name === "Untitled" ? textInput.slice(0, 20) : m.name,
        };
      });
    } catch (e) {
      setTextWarning(String(e));
    }
  }, [textInput, faceId, active, frameIndex, updateActive]);

  const copySelection = useCallback(() => {
    if (!selection || !active) return;
    setClipboard(extractRect(active.frames[frameIndex], selection));
  }, [selection, active, frameIndex]);

  const cutSelection = useCallback(() => {
    if (!selection || !active) return;
    setClipboard(extractRect(active.frames[frameIndex], selection));
    updateFrame((f) => clearRect(f, selection));
  }, [selection, active, frameIndex, updateFrame]);

  const eraseSelection = useCallback(() => {
    if (!selection) return;
    updateFrame((f) => clearRect(f, selection));
  }, [selection, updateFrame]);

  const pasteClipboard = useCallback(() => {
    if (!clipboard) return;
    // Land it on the selection if there is one, otherwise top-left.
    const ox = selection?.x0 ?? 0;
    const oy = selection?.y0 ?? 0;
    updateFrame((f) => pasteBlock(f, clipboard, ox, oy, false));
    setSelection({
      x0: ox,
      y0: oy,
      x1: ox + (clipboard[0]?.length ?? 1) - 1,
      y1: oy + clipboard.length - 1,
    });
    setTool("select");
  }, [clipboard, selection, updateFrame]);

  const selectAll = useCallback(() => {
    if (!active) return;
    setSelection({
      x0: 0,
      y0: 0,
      x1: (active.frames[frameIndex]?.[0]?.length ?? 1) - 1,
      y1: BADGE_HEIGHT - 1,
    });
    setTool("select");
  }, [active, frameIndex]);

  /** Move the selected pixels by (dx, dy), leaving blank behind. */
  const nudgeSelection = useCallback(
    (dx: number, dy: number) => {
      if (!selection || !active) return;
      const block = extractRect(active.frames[frameIndex], selection);
      updateFrame((f) =>
        pasteBlock(
          clearRect(f, selection),
          block,
          selection.x0 + dx,
          selection.y0 + dy,
          true,
        ),
      );
      setSelection({
        x0: selection.x0 + dx,
        y0: selection.y0 + dy,
        x1: selection.x1 + dx,
        y1: selection.y1 + dy,
      });
    },
    [selection, active, frameIndex, updateFrame],
  );

  /** Copy the previous frame's art into this one, the usual animation workflow. */
  const copyPreviousFrame = useCallback(() => {
    if (!active || frameIndex === 0) return;
    const prev = active.frames[frameIndex - 1];
    updateFrame(() => prev.map((row) => row.slice()));
  }, [active, frameIndex, updateFrame]);

  // Built from the enabled slots only, so the whole-sequence preview matches
  // what the badge is going to play rather than what the list happens to show.
  const live = useMemo(
    () => enabledMessages(project.messages),
    [project.messages],
  );
  const slots = useMemo(() => sequenceSlots(live), [live]);

  // In sequence scope the step counts across every slot, so the message being
  // shown is whichever the playhead is inside, not the one being edited.
  const here = useMemo(
    () => (scope === "sequence" ? sequenceAt(slots, step) : null),
    [scope, slots, step],
  );
  const shown = here ? (live[here.slot.index] ?? active) : active;
  const shownStep = here ? here.local : step;

  const period = useMemo(
    () =>
      scope === "sequence"
        ? sequenceLength(slots)
        : active
          ? previewPeriod(active)
          : 1,
    [scope, slots, active],
  );

  // Scrubbing takes the preview off the clock: dragging the bar or stepping a
  // frame while it is playing would be undone by the next interval tick.
  const scrubTo = useCallback(
    (v: number) => {
      setPlaying(false);
      setStep(Math.max(0, Math.min(period - 1, v)));
    },
    [period],
  );

  /** Jog by whole steps, wrapping, so you can go either way round the loop. */
  const scrubBy = useCallback(
    (d: number) => {
      setPlaying(false);
      setStep((s) => (((s + d) % period) + period) % period);
    },
    [period],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const inField =
        e.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);
      if (ask || inField) return;
      if (
        !mod &&
        e.target instanceof HTMLElement &&
        e.target.closest('button, [role="tab"], [contenteditable=true]')
      )
        return;

      if (mod) {
        switch (e.key.toLowerCase()) {
          case "z":
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
            return;
          case "c":
            e.preventDefault();
            copySelection();
            return;
          case "x":
            e.preventDefault();
            cutSelection();
            return;
          case "v":
            e.preventDefault();
            pasteClipboard();
            return;
          case "a":
            e.preventDefault();
            selectAll();
            return;
        }
        return;
      }

      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
        return;
      }
      if (e.key === "Escape") {
        setSelection(null);
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        if (selection) {
          e.preventDefault();
          eraseSelection();
        }
        return;
      }

      const nudges: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (nudges[e.key] && selection) {
        e.preventDefault();
        nudgeSelection(...nudges[e.key]);
        return;
      }
      // With nothing selected there is nothing to nudge, so left and right jog
      // the preview instead. Up and down stay unbound.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        scrubBy(e.key === "ArrowLeft" ? -1 : 1);
        return;
      }

      const hit = TOOLS.find((t) => TOOL_KEYS[t] === e.key.toLowerCase());
      if (hit) setTool(hit);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    ask,
    undo,
    redo,
    selection,
    copySelection,
    cutSelection,
    pasteClipboard,
    selectAll,
    eraseSelection,
    nudgeSelection,
    scrubBy,
  ]);

  // --- documents ---------------------------------------------------------

  /** Replace the whole document and treat the result as freshly opened. */
  const adopt = useCallback(
    (next: Project, path: string | null) => {
      documentEpoch.current++;
      resetHistory(next);
      setActiveId(next.messages[0].id);
      setFrameIndex(0);
      setStep(0);
      setSelection(null);
      setDocPath(path);
      setSavedJson(serializeProject(next));
      setTextWarning(null);
    },
    [resetHistory],
  );

  /** Write to a known path. Returns false if the write failed. */
  const writeTo = useCallback(
    async (path: string, p: Project) => {
      const json = serializeProject(p);
      const epoch = documentEpoch.current;
      const sequence = ++saveSequence.current;
      const write = documentWrites.current.then(() =>
        platform.writeText(path, json, "project"),
      );
      documentWrites.current = write.catch(() => {});
      try {
        await write;
        // A slow save must not adopt its path into a newer document.
        if (
          epoch !== documentEpoch.current ||
          sequence !== saveSequence.current
        )
          return false;
        setDocPath(path);
        setSavedJson(json);
        // The autosave exists to survive a crash. Once the work is on disk for
        // real there is nothing left to recover, and a stale one would prompt
        // on next launch for no reason.
        await savedRecovery(json);
        setTextWarning(`Saved to ${path}`);
        return true;
      } catch (e) {
        setTextWarning(String(e));
        return false;
      }
    },
    [savedRecovery],
  );

  const saveProjectAs = useCallback(async () => {
    const suggested = `${safeFileName(baseName(docPath) ?? "Untitled", "Untitled")}.${PROJECT_EXT}`;
    const epoch = documentEpoch.current;
    try {
      const path = await platform.pickSave("project", suggested);
      if (!path || epoch !== documentEpoch.current) return false;
      return await writeTo(path, project);
    } catch (e) {
      setTextWarning(String(e));
      return false;
    }
  }, [docPath, project, writeTo]);

  /** Save in place, falling back to Save As for a document with no file yet. */
  const saveProject = useCallback(async () => {
    if (!docPath) return saveProjectAs();
    return writeTo(docPath, project);
  }, [docPath, project, saveProjectAs, writeTo]);

  const loadProjectFrom = useCallback(
    async (path: string) => {
      try {
        const text = await platform.readText(path, "project");
        adopt(parseProject(text), path);
      } catch (e) {
        setTextWarning(
          e instanceof DocError
            ? e.message
            : `Could not open that project: ${e}`,
        );
      }
    },
    [adopt],
  );

  const openProject = useCallback(async () => {
    try {
      const picked = await platform.pickOpen("project");
      if (!picked) return;
      adopt(parseProject(picked.text), picked.path);
    } catch (e) {
      setTextWarning(
        e instanceof DocError ? e.message : `Could not open that project: ${e}`,
      );
    }
  }, [adopt]);

  const newProject = useCallback(() => {
    adopt({ messages: [newMessage("scroll_left")], brightness: 100 }, null);
  }, [adopt]);

  // --- single messages ---------------------------------------------------

  const exportMessage = useCallback(async () => {
    if (!active) return;
    const suggested = `${safeFileName(active.name, "message")}.${MESSAGE_EXT}`;
    try {
      const path = await platform.pickSave("message", suggested);
      if (!path) return;
      await platform.writeText(path, serializeMessage(active), "message");
      setTextWarning(`Exported ${active.name} to ${path}`);
    } catch (e) {
      setTextWarning(String(e));
    }
  }, [active]);

  const importMessageFrom = useCallback(
    (text: string, source: string) => {
      try {
        const m = parseMessage(text);
        if (project.messages.length >= MAX_MESSAGES) {
          throw new DocError(
            `This project already holds ${MAX_MESSAGES} messages. Delete one first.`,
          );
        }
        // A fresh id, or importing the same file twice would produce two
        // messages the selection logic cannot tell apart.
        const copy: Message = { ...m, id: newMessage().id };
        commit({ ...project, messages: [...project.messages, copy] });
        setActiveId(copy.id);
        setFrameIndex(0);
        setTextWarning(`Imported ${copy.name} from ${source}`);
      } catch (e) {
        setTextWarning(
          e instanceof DocError ? e.message : `Could not import that: ${e}`,
        );
      }
    },
    [project, commit],
  );

  const importMessage = useCallback(async () => {
    try {
      const picked = await platform.pickOpen("message");
      if (!picked) return;
      importMessageFrom(picked.text, picked.path);
    } catch (e) {
      setTextWarning(String(e));
    }
  }, [importMessageFrom]);

  // Byte columns still available for this message. The badge's buffer is shared
  // across all 8 slots, so what the others spend is not available here.
  const textBudget = useMemo(() => {
    const others = project.messages
      .filter((m) => m.id !== activeId)
      .filter((m) => m.enabled !== false)
      .reduce((n, m) => n + byteColumns(m), 0);
    return Math.max(0, MAX_BYTE_COLUMNS - others);
  }, [project.messages, activeId]);

  // The budget in the units the face measures in. A proportional face lands
  // wherever it lands and the message rounds up to a byte column at the end.
  const textBudgetPx = textBudget * 8;

  // What the typed string will actually occupy in the chosen face, asked of
  // that face rather than inferred from the string's length. See font.ts.
  const textPx = useMemo(
    () => measureText(textInput, faceId),
    [textInput, faceId, metricsReady],
  );

  /** Drop a pictograph in at the caret, or at the end if the field is not focused. */
  const insertEmoji = useCallback(
    (c: string) => {
      const el = textRef.current;
      const at = el?.selectionStart ?? textInput.length;
      const end = el?.selectionEnd ?? at;
      const next = fitText(
        textInput.slice(0, at) + c + textInput.slice(end),
        textBudgetPx,
        faceId,
      );
      setTextInput(next);
      // Put the caret after what was just inserted rather than at the end,
      // so picking several in a row builds a string in the order they were
      // clicked.
      queueMicrotask(() => {
        const pos = Math.min(at + c.length, next.length);
        el?.focus();
        el?.setSelectionRange(pos, pos);
      });
    },
    [textInput, textBudgetPx, faceId],
  );

  const reorder = useCallback(
    (ids: Set<string>, gap: number) =>
      commit({ ...project, messages: moveTo(project.messages, ids, gap) }),
    [project, commit],
  );

  const toggleEnabled = useCallback(
    (id: string) =>
      commit({
        ...project,
        messages: project.messages.map((m) =>
          m.id === id ? { ...m, enabled: m.enabled === false } : m,
        ),
      }),
    [project, commit],
  );

  /** Run `then` once it is safe to throw the current document away. */
  const guard = useCallback(
    (verb: string, then: () => void) => {
      if (!dirty) {
        then();
        return;
      }
      setAsk({ kind: "unsaved", verb, then });
    },
    [dirty],
  );

  /** Shut down for real. Clearing the autosave is what marks the exit clean. */
  const leave = useCallback(async () => {
    await clearRecovery();
    await platform.confirmExit().catch(() => {});
  }, [clearRecovery]);

  /** Open a path, choosing project or message by its extension. */
  const openPath = useCallback(
    async (path: string) => {
      if (path.toLowerCase().endsWith(`.${MESSAGE_EXT}`)) {
        try {
          const text = await platform.readText(path, "message");
          importMessageFrom(text, path);
        } catch (e) {
          setTextWarning(String(e));
        }
        return;
      }
      await loadProjectFrom(path);
    },
    [importMessageFrom, loadProjectFrom],
  );

  // The title bar is the only always-visible place to say which file this is
  // and whether it has been saved.
  useEffect(() => {
    const name = baseName(docPath) ?? "Untitled";
    platform.setTitle(`${dirty ? "• " : ""}${name} - BlinkenBadge`);
  }, [docPath, dirty]);

  const startup = useRef<Promise<{
    pending: string[];
    recovery: Awaited<ReturnType<typeof platform.recoveryRead>>;
  }> | null>(null);

  // Startup: a leftover autosave means the last session did not end cleanly.
  // Files the OS asked us to open win over it, since that was a deliberate act.
  useEffect(() => {
    let alive = true;
    startup.current ??= (async () => ({
      pending: await platform.takePendingFiles().catch(() => []),
      recovery: await platform.recoveryRead().catch(() => null),
    }))();
    void startup.current.then(async ({ pending, recovery }) => {
      if (!alive) return;
      if (pending.length) await openPath(pending[0]);
      else if (recovery)
        setAsk({
          kind: "recover",
          json: recovery.json,
          path: recovery.path,
          savedAt: recovery.saved_at,
        });
      if (alive) setStartupReady(true);
    });
    return () => {
      alive = false;
    };
    // Deliberately once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Demo capture loader for docs screenshots (?demo=editor / ?demo=animation)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const demo = params.get("demo");
    if (demo === "editor" || demo === "animation") {
      fetch("/demo.badge")
        .then((r) => r.text())
        .then((text) => {
          const p = parseProject(text);
          adopt(p, "demo.badge");
          setLed("orange");
          if (demo === "animation") {
            setActiveId(p.messages[2].id);
            setOnion(true);
            setPlaying(false);
          } else {
            setActiveId(p.messages[0].id);
            setPlaying(false);
          }
        })
        .catch(console.error);
    }
  }, [adopt]);

  // Files opened from the OS while already running: double-click, "Open With",
  // or dropping onto the dock icon.
  useEffect(() => {
    return platform.onOpenFile((path) => {
      if (path.toLowerCase().endsWith(`.${MESSAGE_EXT}`)) {
        // Importing adds to the document rather than replacing it, so there is
        // nothing to lose and nothing to confirm.
        void openPath(path);
      } else {
        guard("open another project", () => void openPath(path));
      }
    });
  }, [openPath, guard]);

  // Menu items act here rather than in Rust, because only this side knows
  // whether the document is dirty and therefore whether to ask first.
  useEffect(() => {
    return platform.onMenu((id) => {
      if (ask) return;
      if (id.startsWith("open-recent:")) {
        const path = id.slice("open-recent:".length);
        if (path.toLowerCase().endsWith(`.${MESSAGE_EXT}`)) void openPath(path);
        else guard("open another project", () => void openPath(path));
        return;
      }
      switch (id) {
        case "new-project":
          guard("start a new project", newProject);
          break;
        case "open-project":
          guard("open another project", () => void openProject());
          break;
        case "save-project":
          void saveProject();
          break;
        case "save-project-as":
          void saveProjectAs();
          break;
        case "import-message":
          void importMessage();
          break;
        case "export-message":
          void exportMessage();
          break;
        case "clear-recent":
          void platform.recentClear();
          break;
        case "quit-app":
          if (dirty) setAsk({ kind: "quit" });
          else void leave();
          break;
      }
    });
  }, [
    ask,
    guard,
    newProject,
    openProject,
    openPath,
    saveProject,
    saveProjectAs,
    importMessage,
    exportMessage,
    dirty,
    leave,
  ]);

  // Closing is the last chance to lose work, so it gets the same guard as New
  // and Open. The host holds the exit until we answer, where it can.
  useEffect(
    () =>
      platform.onExitRequested(() => {
        if (platform.kind === "web") return dirty;
        if (ask) return dirty;
        if (dirty) setAsk({ kind: "quit" });
        else void leave();
        return dirty;
      }),
    [ask, dirty, leave],
  );

  const importImageFile = useCallback(async () => {
    if (!active) return;
    try {
      const dataUrl = await platform.pickImage();
      if (!dataUrl) return;
      const asFrames = active.mode === "animation";
      const res = await importImage(dataUrl, { threshold, asFrames });
      if (asFrames && res.frames.length > MAX_FRAMES) {
        throw new Error(
          `That image is ${res.frames.length} frames wide; the badge holds ${MAX_FRAMES}.`,
        );
      }
      updateActive((m) => ({
        ...m,
        frames: res.frames,
        width: res.width,
      }));
      setFrameIndex(0);
      setTextWarning(
        res.scaledFrom
          ? `Scaled from ${res.scaledFrom}px tall to 11px. ${res.frames.length} frame(s).`
          : `Imported ${res.frames.length} frame(s).`,
      );
    } catch (e) {
      setTextWarning(String(e));
    }
  }, [active, threshold, updateActive]);

  const addMessage = useCallback(() => {
    if (project.messages.length >= MAX_MESSAGES) return;
    const m = newMessage("scroll_left");
    commit({ ...project, messages: [...project.messages, m] });
    setActiveId(m.id);
    setFrameIndex(0);
  }, [project, commit]);

  const removeMessage = useCallback(
    (id: string) => {
      if (project.messages.length <= 1) return;
      const rest = project.messages.filter((m) => m.id !== id);
      commit({ ...project, messages: rest });
      if (activeId === id) setActiveId(rest[0].id);
    },
    [project, commit, activeId],
  );

  useEffect(() => setStep(0), [activeId, active?.mode, scope]);

  useEffect(() => {
    if (!shown || !playing || period <= 1) return;
    const t = setInterval(
      () => setStep((s) => (s + 1) % period),
      stepDelay(shown.speed),
    );
    return () => clearInterval(t);
  }, [shown, playing, period]);

  // Only animation mode has real frames. Showing "51 / 68" for a scrolling
  // message reads as a frame count when it is really scroll position.
  const frameLabel = (() => {
    if (!shown) return null;
    const where =
      scope === "sequence" && here
        ? `${here.slot.index + 1}/${project.messages.length} · `
        : "";
    if (shown.mode === "animation") {
      return `${where}frame ${shownStep + 1} / ${shown.frames.length}`;
    }
    if (shown.mode === "fixed") return `${where}still`;
    return where ? where.replace(/ · $/, "") : null;
  })();

  const currentFrame = active?.frames[frameIndex] ?? blankFrame(BADGE_WIDTH);
  const onionFrame =
    onion && active?.mode === "animation" && frameIndex > 0
      ? active.frames[frameIndex - 1]
      : null;

  return (
    <div className="app">
      {isCapture && (
        <div
          style={{
            height: "28px",
            background: "#0b0d12",
            borderBottom: "1px solid #1a1e27",
            display: "flex",
            alignItems: "center",
            padding: "0 14px",
            position: "relative",
            userSelect: "none",
            flex: "none",
          }}
        >
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <div
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                background: "#ff5f57",
                border: "1px solid #e0443e",
              }}
            />
            <div
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                background: "#febc2e",
                border: "1px solid #d89e24",
              }}
            />
            <div
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                background: "#28c840",
                border: "1px solid #1aab29",
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: "85px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              color: "#9c9d9f",
              fontSize: "13px",
              fontWeight: 500,
              fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
            }}
          >
            <span>demo - BlinkenBadge</span>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          BlinkenBadge
        </div>
        {/* The desktop has the operating system's menu; the browser has none. */}
        {platform.kind === "web" && !isCapture && <WebMenuBar />}
        <div className="topbar-controls">
          <label title="LED color. Preview only; not sent to badge.">
            <span
              className="led-swatch"
              style={{ background: LED_COLORS[led] }}
              aria-hidden="true"
            />
            <select
              value={led}
              onChange={(e) => setLed(e.target.value as LedColor)}
            >
              {LED_ORDER.map((c) => (
                <option key={c} value={c}>
                  {c[0].toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <span className="sep" />
          {/* Duplicates of the File menu. The menu is the complete set; these
              are the two that get used constantly. */}
          <button
            onClick={() => guard("start a new project", newProject)}
            title="New Project (Cmd/Ctrl+N)"
          >
            New
          </button>
          <button
            onClick={() =>
              guard("open another project", () => void openProject())
            }
            title="Open Project (Cmd/Ctrl+O)"
          >
            Open
          </button>
          <button
            onClick={() => void saveProject()}
            disabled={!dirty && docPath !== null}
            title={
              docPath
                ? dirty
                  ? `Save to ${docPath} (Cmd/Ctrl+S)`
                  : "No changes since the last save"
                : "Save this project to a file (Cmd/Ctrl+S)"
            }
          >
            Save
          </button>
          <span className="sep" />
          <button onClick={undo} disabled={!canUndo} title="Cmd/Ctrl+Z">
            Undo
          </button>
          <button onClick={redo} disabled={!canRedo} title="Cmd/Ctrl+Shift+Z">
            Redo
          </button>
        </div>
      </header>

      <div className="body">
        <aside className="panel slots">
          <h2>
            Messages
            <span className="muted small">
              {project.messages.length}/{MAX_MESSAGES}
            </span>
          </h2>
          <SlotList
            messages={project.messages}
            activeId={activeId}
            playing={
              here ? project.messages.indexOf(live[here.slot.index]) : null
            }
            selected={picked}
            onSelected={setPicked}
            onActivate={(id) => {
              setActiveId(id);
              setFrameIndex(0);
            }}
            onReorder={reorder}
            onToggleEnabled={toggleEnabled}
            onRemove={removeMessage}
          />
          <button
            onClick={addMessage}
            disabled={project.messages.length >= MAX_MESSAGES}
          >
            Add message
          </button>
        </aside>

        <main className="editor">
          {active && (
            <>
              <div className="preview-strip">
                <BadgePreview
                  message={shown}
                  step={shownStep}
                  brightness={project.brightness}
                  playing={playing}
                  led={led}
                />
                <PlaybackBar
                  playing={playing}
                  onTogglePlay={() => setPlaying((p) => !p)}
                  onRestart={() => setStep(0)}
                  frameLabel={frameLabel}
                  step={step}
                  period={period}
                  onScrub={scrubTo}
                  onJog={scrubBy}
                  scope={scope}
                  onScope={setScope}
                  canSequence={project.messages.length > 1}
                />
              </div>

              <div className="message-props">
                <span className="group-tag">This message</span>
                <input
                  className="name-input"
                  aria-label="Message Name"
                  value={active.name}
                  onChange={(e) =>
                    updateActive((m) => ({ ...m, name: e.target.value }))
                  }
                />
                <label>
                  Mode
                  <select
                    value={active.mode}
                    onChange={(e) => setMode(e.target.value as Mode)}
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
                    min={1}
                    max={8}
                    value={active.speed}
                    onChange={(e) =>
                      updateActive((m) => ({
                        ...m,
                        speed: Number(e.target.value),
                      }))
                    }
                  />
                  <span className="mu tabular">{active.speed}</span>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={active.blink}
                    onChange={(e) =>
                      updateActive((m) => ({ ...m, blink: e.target.checked }))
                    }
                  />
                  Blink
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={active.ants}
                    onChange={(e) =>
                      updateActive((m) => ({ ...m, ants: e.target.checked }))
                    }
                  />
                  Border
                </label>
                {active.mode !== "animation" && (
                  <label>
                    Width
                    <input
                      className="num"
                      type="number"
                      min={8}
                      step={8}
                      value={active.width}
                      onChange={(e) => setWidth(Number(e.target.value))}
                    />
                    <span className="mu small">px</span>
                  </label>
                )}
              </div>

              <div className="workspace">
                <ToolPalette tool={tool} onTool={setTool} />

                <div className="workspace-main">
                  <div className="bar-row">
                    <ToolOptions
                      tool={tool}
                      brushSize={brushSize}
                      onBrushSize={setBrushSize}
                      filled={filled}
                      onFilled={setFilled}
                      hasSelection={!!selection}
                      hasClipboard={!!clipboard}
                      onCopy={copySelection}
                      onCut={cutSelection}
                      onPaste={pasteClipboard}
                      onDeleteSelection={eraseSelection}
                      onSelectAll={selectAll}
                      onClearSelection={() => setSelection(null)}
                    />
                    <span className="grow" />
                    <span className="group-tag">Insert</span>
                    <button
                      className={insert === "text" ? "active" : ""}
                      onClick={() =>
                        setInsert((v) => (v === "text" ? null : "text"))
                      }
                    >
                      Text...
                    </button>
                    <button
                      className={insert === "image" ? "active" : ""}
                      onClick={() =>
                        setInsert((v) => (v === "image" ? null : "image"))
                      }
                    >
                      Image...
                    </button>
                  </div>

                  {insert === "text" && (
                    <div className="bar-row insert-panel">
                      <input
                        autoFocus
                        ref={textRef}
                        placeholder="Text to stamp into this frame"
                        value={textInput}
                        onChange={(e) =>
                          setTextInput(
                            fitText(e.target.value, textBudgetPx, faceId),
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            insertText();
                            setInsert(null);
                          }
                          if (e.key === "Escape") setInsert(null);
                        }}
                      />
                      <button
                        className="primary"
                        onClick={() => {
                          insertText();
                          setInsert(null);
                        }}
                        disabled={!textInput}
                      >
                        Insert
                      </button>
                      <button onClick={() => setInsert(null)}>Cancel</button>
                      {emoji.length > 0 && (
                        <button
                          className={showEmoji ? "active" : undefined}
                          onClick={() => setShowEmoji((v) => !v)}
                          title="Emoji and icon pictographs"
                          aria-expanded={showEmoji}
                        >
                          Emoji
                        </button>
                      )}
                      {faces.length > 1 && (
                        <select
                          value={faceId}
                          onChange={(e) => setFaceId(e.target.value)}
                          title="Typeface for text stamp"
                          aria-label="Typeface"
                        >
                          {faces.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <span
                        className={
                          textPx >= textBudgetPx ? "warn small" : "mu small"
                        }
                        title={`Width, not character count: the badge holds ${MAX_BYTE_COLUMNS * 8}px of text across all messages, and the others use ${(MAX_BYTE_COLUMNS - textBudget) * 8}px.`}
                      >
                        {textPx} / {textBudgetPx} px
                      </span>
                    </div>
                  )}

                  {insert === "text" && showEmoji && (
                    <EmojiPalette
                      chars={emoji}
                      led={led}
                      onPick={insertEmoji}
                    />
                  )}

                  {insert === "image" && (
                    <div className="bar-row insert-panel">
                      <label title="Threshold for lit pixels">
                        Threshold
                        <input
                          type="range"
                          min={0}
                          max={255}
                          value={threshold}
                          onChange={(e) => setThreshold(Number(e.target.value))}
                        />
                        <span className="mu tabular">{threshold}</span>
                      </label>
                      <button
                        className="primary"
                        onClick={() => {
                          importImageFile();
                          setInsert(null);
                        }}
                      >
                        Choose file...
                      </button>
                      <button onClick={() => setInsert(null)}>Cancel</button>
                    </div>
                  )}

                  {textWarning && <p className="warn small">{textWarning}</p>}

                  <PixelCanvas
                    frame={currentFrame}
                    onionFrame={onionFrame}
                    tool={tool}
                    brushSize={brushSize}
                    filled={filled}
                    selection={selection}
                    onSelectionChange={setSelection}
                    onChange={(f, history) => updateFrame(() => f, history)}
                    led={led}
                  />

                  <div className="bar-row">
                    <span className="group-tag">This frame</span>
                    {/* Back to a bare badge, not a blank canvas of whatever
                        width the last drawing happened to need. Clearing a
                        240px scroll otherwise leaves an empty 240px canvas and
                        a trip to the Width box to undo it.

                        Resizing the siblings cannot lose anything: extra frames
                        exist only in animation mode, where the width is already
                        the badge's own. */}
                    <button
                      onClick={() =>
                        updateActive((m) => ({
                          ...m,
                          width: BADGE_WIDTH,
                          frames: m.frames.map((f, i) =>
                            i === frameIndex
                              ? blankFrame(BADGE_WIDTH)
                              : resizeFrame(f, BADGE_WIDTH),
                          ),
                        }))
                      }
                      title={`Clear frame to ${BADGE_WIDTH}x${BADGE_HEIGHT}`}
                    >
                      Clear
                    </button>
                    <button onClick={() => updateFrame(invert)}>Invert</button>
                    <button
                      onClick={() => updateFrame(flipH)}
                      title="Flip horizontally"
                    >
                      Flip ⇄
                    </button>
                    <button
                      onClick={() => updateFrame(flipV)}
                      title="Flip vertically"
                    >
                      Flip ⇅
                    </button>
                    <span className="sep" />
                    <span className="mu">Shift</span>
                    <button
                      onClick={() => updateFrame((f) => shift(f, -1, 0))}
                      title="Shift left"
                    >
                      ←
                    </button>
                    <button
                      onClick={() => updateFrame((f) => shift(f, 1, 0))}
                      title="Shift right"
                    >
                      →
                    </button>
                    <button
                      onClick={() => updateFrame((f) => shift(f, 0, -1))}
                      title="Shift up"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => updateFrame((f) => shift(f, 0, 1))}
                      title="Shift down"
                    >
                      ↓
                    </button>
                    {active.mode === "animation" && frameIndex > 0 && (
                      <>
                        <span className="sep" />
                        <button
                          onClick={copyPreviousFrame}
                          title="Copy previous frame"
                        >
                          Copy previous
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {active.mode === "animation" ? (
                <Timeline
                  frames={active.frames}
                  current={frameIndex}
                  led={led}
                  maxFrames={MAX_FRAMES}
                  onion={onion}
                  onOnion={setOnion}
                  onSelect={setFrameIndex}
                  onAdd={() => {
                    updateActive((m) => ({
                      ...m,
                      frames: [...m.frames, blankFrame(m.width)],
                    }));
                    setFrameIndex(active.frames.length);
                  }}
                  onDuplicate={(i) => {
                    updateActive((m) => {
                      const next = m.frames.slice();
                      next.splice(i + 1, 0, cloneFrame(m.frames[i]));
                      return { ...m, frames: next };
                    });
                    setFrameIndex(i + 1);
                  }}
                  onDelete={(i) => {
                    updateActive((m) => ({
                      ...m,
                      frames: m.frames.filter((_, j) => j !== i),
                    }));
                    setFrameIndex(Math.max(0, i - 1));
                  }}
                  onMove={(from, to) => {
                    updateActive((m) => {
                      const next = m.frames.slice();
                      const [f] = next.splice(from, 1);
                      next.splice(to, 0, f);
                      return { ...m, frames: next };
                    });
                    setFrameIndex(to);
                  }}
                />
              ) : (
                <p className="muted small">
                  {MODE_LABELS[active.mode]} displays a single bitmap. Switch to
                  Animation mode for frame-by-frame editing.
                </p>
              )}
            </>
          )}
        </main>
      </div>

      <TransportBar
        messages={project.messages}
        brightness={project.brightness}
        onBrightness={(b) => commit({ ...project, brightness: b })}
      />

      {ask?.kind === "unsaved" && (
        <Modal
          title={`Save changes to ${baseName(docPath) ?? "Untitled"}?`}
          body={
            <p>
              You have unsaved changes. If you {ask.verb} now they will be lost.
            </p>
          }
          onCancel={() => setAsk(null)}
          actions={[
            {
              label: "Save",
              primary: true,
              onSelect: async () => {
                const then = ask.then;
                // Keep the editor inert until the save has finished.
                const saved = await saveProject();
                setAsk(null);
                if (saved) then();
              },
            },
            {
              label: "Discard",
              danger: true,
              onSelect: () => {
                const then = ask.then;
                setAsk(null);
                then();
              },
            },
            { label: "Cancel", onSelect: () => setAsk(null) },
          ]}
        />
      )}

      {ask?.kind === "quit" && (
        <Modal
          title={`Save changes to ${baseName(docPath) ?? "Untitled"} before closing?`}
          body={<p>You have unsaved changes. Closing now will lose them.</p>}
          onCancel={() => setAsk(null)}
          actions={[
            {
              label: "Save",
              primary: true,
              onSelect: async () => {
                if (await saveProject()) await leave();
                else setAsk(null);
              },
            },
            {
              label: "Discard",
              danger: true,
              onSelect: () => leave(),
            },
            { label: "Cancel", onSelect: () => setAsk(null) },
          ]}
        />
      )}

      {ask?.kind === "recover" && (
        <Modal
          title="BlinkenBadge Closed Unexpectedly"
          body={
            <>
              <p>
                There is unsaved work from{" "}
                {new Date(ask.savedAt).toLocaleString()}
                {ask.path ? (
                  <>
                    {" "}
                    belonging to <strong>{baseName(ask.path)}</strong>
                  </>
                ) : (
                  " from a project that was never saved to a file"
                )}
                .
              </p>
              <p className="mu small">
                Discarding keeps whatever is already on disk and throws the
                recovered copy away.
              </p>
            </>
          }
          actions={[
            {
              label: "Restore",
              primary: true,
              onSelect: () => {
                try {
                  const p = parseProject(ask.json);
                  adopt(p, platform.kind === "web" ? null : ask.path);
                  // Restored work is not yet on disk, so it must read as
                  // unsaved. Anything else invites closing without saving.
                  setSavedJson("");
                  setTextWarning(
                    ask.path
                      ? `Recovered unsaved changes to ${baseName(ask.path)}.`
                      : "Recovered an unsaved project. Use Save to give it a file.",
                  );
                } catch (e) {
                  setTextWarning(
                    e instanceof DocError
                      ? `The recovered copy is unreadable: ${e.message}`
                      : String(e),
                  );
                }
                setAsk(null);
              },
            },
            {
              label: "Discard",
              danger: true,
              onSelect: () => {
                void clearRecovery();
                setAsk(null);
              },
            },
          ]}
        />
      )}
    </div>
  );
}
