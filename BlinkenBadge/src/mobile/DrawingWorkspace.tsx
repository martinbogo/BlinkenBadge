import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Brightness, Message } from "../types";
import { ANIMATION_MAX_FRAMES } from "../types";
import MobileCanvas, {
  type MobileCanvasProps,
  type ViewRequest,
} from "./MobileCanvas";
import { MiniBadge } from "./MobilePreview";
import StudioIcon from "./StudioIcon";

interface Props {
  message: Message;
  current: number;
  playing: boolean;
  step: number;
  brightness: Brightness;
  focus: boolean;
  onFocus(value: boolean): void;
  onion: boolean;
  onOnion(value: boolean): void;
  onPlay(): void;
  onSpeed(value: number): void;
  onMotion(): void;
  onPreview(): void;
  onSelect(index: number): void;
  onDuplicate(): void;
  onBlank(): void;
  onFrames(): void;
  onTransform(): void;
  onSend?(): void;
  onCopy(): void;
  onCut(): void;
  onPaste(): void;
  onSelectionTools(): void;
  onSelectionDone(): void;
  hasClipboard: boolean;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  tools: ReactNode;
  settings: ReactNode;
  canvas: Omit<
    MobileCanvasProps,
    "frame" | "onionFrame" | "disabled" | "viewRequest" | "onZoomChange"
  >;
}

export default function DrawingWorkspace(p: Props) {
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 1800);
    return () => clearTimeout(timer);
  }, [notice]);
  const animation = p.message.mode === "animation";
  const shown =
    animation && p.playing
      ? p.step % p.message.frames.length
      : Math.min(p.current, p.message.frames.length - 1);
  const frame = p.message.frames[shown];
  const thumbnails = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [request, setRequest] = useState<ViewRequest>({
    serial: 0,
    scale: "fit",
  });
  useEffect(() => {
    thumbnails.current
      ?.querySelector<HTMLElement>(`[data-frame="${shown}"]`)
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [shown, p.message.frames.length, p.focus]);
  const view = (scale: ViewRequest["scale"]) =>
    setRequest((r) => ({ serial: r.serial + 1, scale }));
  const placement = p.canvas.placement;
  const full = p.message.frames.length >= ANIMATION_MAX_FRAMES;

  return (
    <section
      className={`mobile-studio${p.focus ? " studio-focus" : ""}`}
      aria-label="Drawing Workspace"
    >
      <div className="studio-preview-controls">
        {!p.focus && (
          <div className="studio-monitor">
            <button
              className="studio-monitor-display"
              aria-label="Preview Slot"
              onClick={p.onPreview}
            >
              <MiniBadge
                message={
                  p.playing ? p.message : { ...p.message, frames: [frame] }
                }
                step={p.playing ? p.step : undefined}
                playing={p.playing}
                brightness={p.brightness}
              />
              <span>Preview</span>
            </button>
            {p.onSend && (
              <button aria-label="Send to Badge" onClick={p.onSend}>
                <StudioIcon name="send" /> Send
              </button>
            )}
          </div>
        )}
        <div className="studio-controls" role="toolbar" aria-label="Playback">
          <button
            aria-label={p.playing ? "Pause Preview" : "Play Preview"}
            onClick={p.onPlay}
          >
            <StudioIcon name={p.playing ? "pause" : "play"} />
            {p.playing ? "Pause" : "Play"}
          </button>
          {animation && (
            <>
              <label className="studio-speed">
                <span>Speed</span>
                <select
                  aria-label="Playback Speed"
                  value={p.message.speed}
                  onChange={(e) => p.onSpeed(Number(e.target.value))}
                >
                  {Array.from({ length: 8 }, (_, i) => (
                    <option key={i} value={i + 1}>
                      {i + 1}/8
                    </option>
                  ))}
                </select>
              </label>
              <button
                aria-label="Onion Skin"
                aria-pressed={p.onion}
                disabled={p.playing || shown === 0}
                onClick={() => p.onOnion(!p.onion)}
              >
                <StudioIcon name="onion" /> Onion
              </button>
            </>
          )}
          <button onClick={p.onMotion}>Motion</button>
        </div>
      </div>
      <div className="studio-drawing-controls">
        <div
          className="studio-tool-rail"
          role="toolbar"
          aria-label="Drawing Tools"
        >
          {p.tools}
        </div>
        {placement ? (
          <div
            className="studio-tool-settings studio-placement"
            role="toolbar"
            aria-label="Artwork Placement"
          >
            <button onClick={() => placement.onCommit(placement.point)}>
              Place {placement.kind}
            </button>
            <button onClick={placement.onCancel}>Cancel Placement</button>
          </div>
        ) : p.canvas.tool === "select" ? (
          <div
            className="studio-tool-settings"
            role="toolbar"
            aria-label="Selected Pixels"
          >
            <button
              aria-label="Copy Pixels"
              disabled={p.playing || !p.canvas.selection}
              onClick={() => {
                p.onCopy();
                setNotice("Copied Pixels");
              }}
            >
              <StudioIcon name="copy" /> Copy
            </button>
            <button
              aria-label="Cut Pixels"
              disabled={p.playing || !p.canvas.selection}
              onClick={() => {
                p.onCut();
                setNotice("Cut Pixels");
              }}
            >
              <StudioIcon name="cut" /> Cut
            </button>
            <button
              aria-label="Paste Pixels"
              disabled={p.playing || !p.hasClipboard}
              onClick={() => {
                p.onPaste();
                setNotice("Pasted Pixels");
              }}
            >
              <StudioIcon name="paste" /> Paste
            </button>
            <button
              aria-label="Selection Options"
              disabled={p.playing}
              onClick={p.onSelectionTools}
            >
              <StudioIcon name="more" /> Options
            </button>
            <button aria-label="Finish Selection" onClick={p.onSelectionDone}>
              <StudioIcon name="check" /> Done
            </button>
          </div>
        ) : (
          p.settings && (
            <div
              className="studio-tool-settings"
              role="group"
              aria-label="Tool Settings"
            >
              {p.settings}
            </div>
          )
        )}
      </div>
      <main className="studio-canvas">
        <MobileCanvas
          {...p.canvas}
          frame={frame}
          onionFrame={
            !p.playing && p.onion && animation && shown > 0
              ? p.message.frames[shown - 1]
              : null
          }
          disabled={p.playing}
          viewRequest={request}
          onZoomChange={setZoom}
        />
        {notice && (
          <span className="studio-clipboard-notice" role="status">
            {notice}
          </span>
        )}
        {p.playing && (
          <span className="studio-playback-hint">Pause to Draw</span>
        )}
      </main>
      <div className="studio-frames">
        {animation && !p.focus && (
          <div
            className="studio-filmstrip"
            ref={thumbnails}
            aria-label="Animation Frames"
          >
            {p.message.frames.map((f, i) => (
              <button
                key={i}
                data-frame={i}
                aria-label={`Frame ${i + 1}`}
                aria-pressed={shown === i}
                onClick={() => p.onSelect(i)}
              >
                <MiniBadge message={{ ...p.message, frames: [f] }} />
                <span>{i + 1}</span>
              </button>
            ))}
          </div>
        )}
        <div
          className="studio-frame-actions"
          role="toolbar"
          aria-label={animation ? "Frame Actions" : "Drawing Actions"}
        >
          {animation && (
            <>
              {p.focus && (
                <button
                  aria-label="Previous Frame"
                  disabled={shown === 0}
                  onClick={() => p.onSelect(shown - 1)}
                >
                  <StudioIcon name="left" />
                </button>
              )}
              <span className="studio-frame-position">
                Frame {shown + 1}/{p.message.frames.length}
              </span>
              {p.focus ? (
                <button
                  aria-label="Next Frame"
                  disabled={shown === p.message.frames.length - 1}
                  onClick={() => p.onSelect(shown + 1)}
                >
                  <StudioIcon name="right" />
                </button>
              ) : (
                <>
                  <button
                    aria-label="Add Frame"
                    disabled={full}
                    onClick={p.onBlank}
                  >
                    <StudioIcon name="plus" /> New
                  </button>
                  <button
                    aria-label="Duplicate Frame"
                    disabled={full}
                    onClick={p.onDuplicate}
                  >
                    <StudioIcon name="copy" /> Duplicate
                  </button>
                  <button aria-label="Frame Options" onClick={p.onFrames}>
                    <StudioIcon name="more" /> Frame
                  </button>
                </>
              )}
            </>
          )}
          <button onClick={p.onTransform}>Transform</button>
        </div>
      </div>
      <footer
        className="studio-view-tools"
        role="toolbar"
        aria-label="Canvas View"
      >
        <div className="studio-zoom" role="group" aria-label="Canvas Zoom">
          <button
            aria-label="Fit Badge"
            aria-pressed={Math.abs(zoom - 1) < 0.05}
            onClick={() => view("fit")}
          >
            Fit
          </button>
          <button
            aria-label="Zoom 2 Times"
            aria-pressed={Math.abs(zoom - 2) < 0.05}
            onClick={() => view(2)}
          >
            2×
          </button>
          <button
            aria-label="Zoom 4 Times"
            aria-pressed={Math.abs(zoom - 4) < 0.05}
            onClick={() => view(4)}
          >
            4×
          </button>
        </div>
        <button
          aria-label={p.focus ? "Exit Focus" : "Focus Canvas"}
          onClick={() => p.onFocus(!p.focus)}
        >
          <StudioIcon name={p.focus ? "collapse" : "expand"} />{" "}
          {p.focus ? "Exit Focus" : "Focus"}
        </button>
        {p.focus && (
          <>
            <button
              aria-label="Undo"
              disabled={!p.canUndo || p.playing}
              onClick={p.undo}
            >
              <StudioIcon name="undo" />
            </button>
            <button
              aria-label="Redo"
              disabled={!p.canRedo || p.playing}
              onClick={p.redo}
            >
              <StudioIcon name="redo" />
            </button>
          </>
        )}
      </footer>
    </section>
  );
}
