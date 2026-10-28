import { useEffect, useRef, useState } from "react";
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
  onSelect(index: number): void;
  onDuplicate(): void;
  onBlank(): void;
  onFrames(): void;
  onTools(): void;
  onMore(): void;
  onSend(): void;
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
  const play = (
    <button
      className="studio-action"
      aria-label={p.playing ? "Pause Preview" : "Play Preview"}
      onClick={p.onPlay}
    >
      <StudioIcon name={p.playing ? "pause" : "play"} />
      <span>{p.playing ? "Pause" : "Play"}</span>
    </button>
  );
  const history = (
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
  );
  const badge = (
    <MiniBadge
      message={p.playing ? p.message : { ...p.message, frames: [frame] }}
      step={p.playing ? p.step : undefined}
      playing={p.playing}
      brightness={p.brightness}
    />
  );
  return (
    <section
      className={`mobile-studio${p.focus ? " studio-focus" : ""}${p.playing ? " studio-playing" : ""}`}
      aria-label="Drawing Workspace"
    >
      {p.focus ? (
        <div className="studio-focus-bar">
          <button aria-label="Exit Focus" onClick={() => p.onFocus(false)}>
            <StudioIcon name="collapse" />
          </button>
          <div className="studio-focus-monitor">{badge}</div>
          {history}
        </div>
      ) : (
        <div className="studio-monitor">
          <div className="studio-monitor-display">{badge}</div>
          <button
            className="studio-action"
            aria-label="Send to Badge"
            onClick={p.onSend}
          >
            <StudioIcon name="send" />
            <span>Send</span>
          </button>
        </div>
      )}
      <div
        className="studio-controls"
        role="toolbar"
        aria-label={
          p.canvas.tool === "select" ? "Selected Pixels" : "Playback and Frames"
        }
      >
        {p.canvas.tool === "select" ? (
          <>
            <button
              className="studio-action"
              aria-label="Copy Pixels"
              disabled={!p.canvas.selection}
              onClick={() => {
                p.onCopy();
                setNotice("Copied Pixels");
              }}
            >
              <StudioIcon name="copy" />
              <span>Copy</span>
            </button>
            <button
              className="studio-action"
              aria-label="Cut Pixels"
              disabled={!p.canvas.selection}
              onClick={() => {
                p.onCut();
                setNotice("Cut Pixels");
              }}
            >
              <StudioIcon name="cut" />
              <span>Cut</span>
            </button>
            <button
              className="studio-action"
              aria-label="Paste Pixels"
              disabled={!p.hasClipboard}
              onClick={() => {
                p.onPaste();
                setNotice("Pasted Pixels");
              }}
            >
              <StudioIcon name="paste" />
              <span>Paste</span>
            </button>
            <button
              className="studio-action"
              aria-label="Selection Options"
              onClick={p.onSelectionTools}
            >
              <StudioIcon name="more" />
              <span>Options</span>
            </button>
            <button
              className="studio-action"
              aria-label="Finish Selection"
              onClick={p.onSelectionDone}
            >
              <StudioIcon name="check" />
              <span>Done</span>
            </button>
          </>
        ) : (
          <>
            {" "}
            {animation && p.focus ? (
              <button
                aria-label="Previous Frame"
                disabled={shown === 0}
                onClick={() => p.onSelect(shown - 1)}
              >
                <StudioIcon name="left" />
              </button>
            ) : (
              play
            )}
            {animation ? (
              <>
                {p.focus && play}
                <button
                  className="studio-frame-position"
                  aria-label="Frame Options"
                  onClick={p.onFrames}
                >
                  <span>
                    Frame {shown + 1}/{p.message.frames.length}
                  </span>
                  <small>Speed {p.message.speed}/8</small>
                </button>
                <button
                  className="studio-action"
                  aria-label="Onion Skin"
                  aria-pressed={p.onion && shown > 0}
                  disabled={p.playing || shown === 0}
                  onClick={() => p.onOnion(!p.onion)}
                >
                  <StudioIcon name="onion" />
                  <span>Onion</span>
                </button>
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
                      className="studio-action"
                      aria-label="Duplicate Frame"
                      disabled={p.message.frames.length >= ANIMATION_MAX_FRAMES}
                      onClick={p.onDuplicate}
                    >
                      <StudioIcon name="copy" />
                      <span>Duplicate</span>
                    </button>
                    <button
                      className="studio-action"
                      aria-label="Add Frame"
                      disabled={p.message.frames.length >= ANIMATION_MAX_FRAMES}
                      onClick={p.onBlank}
                    >
                      <StudioIcon name="plus" />
                      <span>New</span>
                    </button>
                  </>
                )}
              </>
            ) : (
              <span className="studio-frame-caption">
                {p.playing ? "Playing Preview" : "Display Preview"}
              </span>
            )}
          </>
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
      <footer
        className="studio-view-tools"
        role="toolbar"
        aria-label="Canvas Controls"
      >
        <button
          className="studio-tool studio-labeled"
          aria-label="Drawing Tool"
          onClick={p.onTools}
        >
          {
            (
              {
                pencil: "Draw",
                eraser: "Erase",
                line: "Line",
                rect: "Box",
                ellipse: "Oval",
                fill: "Fill",
                select: "Select",
                pan: "Move",
              } as const
            )[p.canvas.tool]
          }
          <small>Tools</small>
        </button>
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
          className="studio-labeled"
          aria-label={p.focus ? "Show Frames" : "Focus Canvas"}
          onClick={() => p.onFocus(!p.focus)}
        >
          <StudioIcon name={p.focus ? "collapse" : "expand"} />
          <small>{p.focus ? "Frames" : "Focus"}</small>
        </button>
        <button
          className="studio-labeled"
          aria-label="Canvas Options"
          onClick={p.onMore}
        >
          <StudioIcon name="more" />
          <small>More</small>
        </button>
      </footer>
    </section>
  );
}
