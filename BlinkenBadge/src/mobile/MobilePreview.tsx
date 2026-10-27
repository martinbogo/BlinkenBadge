import { useEffect, useMemo, useState } from "react";
import {
  enabledMessages,
  previewPeriod,
  renderPreview,
  sequenceAt,
  sequenceLength,
  sequenceSlots,
  stepDelay,
} from "../badge";
import type { Message, Project } from "../types";

export function MiniBadge({
  message,
  step,
  brightness = 100,
  hidden = false,
}: {
  message: Message;
  step?: number;
  brightness?: number;
  hidden?: boolean;
}) {
  const pixels = renderPreview(
    step === undefined ? { ...message, mode: "animation" } : message,
    step ?? 0,
  );
  return (
    <svg
      className="mobile-badge"
      viewBox="0 0 44 11"
      role="img"
      aria-label={`${message.name} badge preview`}
    >
      <g opacity={hidden ? 0 : 0.55 + (brightness / 100) * 0.45}>
        {pixels.flatMap((row, y) =>
          row.map((lit, x) =>
            lit ? (
              <rect
                key={`${x}:${y}`}
                x={x + 0.12}
                y={y + 0.12}
                width=".76"
                height=".76"
                rx=".1"
              />
            ) : null,
          ),
        )}
      </g>
    </svg>
  );
}

export default function MobilePreview({
  project,
  selectedId,
  onEdit,
  initialScope = "sequence",
  initialStep = 0,
}: {
  project: Project;
  selectedId: string;
  initialScope?: "slot" | "sequence";
  initialStep?: number;
  onEdit(message: Message, frame: number): void;
}) {
  const [scope, setScope] = useState<"slot" | "sequence">(initialScope);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(initialStep);
  const [blink, setBlink] = useState(true);
  const enabled = useMemo(
    () => enabledMessages(project.messages),
    [project.messages],
  );
  const spans = useMemo(() => sequenceSlots(enabled), [enabled]);
  const selected =
    project.messages.find((m) => m.id === selectedId) ?? project.messages[0];
  const here = scope === "sequence" ? sequenceAt(spans, step) : null;
  const shown = here ? enabled[here.slot.index] : selected;
  const local = here?.local ?? step;
  const period =
    scope === "sequence" ? sequenceLength(spans) : previewPeriod(selected);
  const available = scope === "slot" || enabled.length > 0;
  useEffect(() => {
    if (!playing || !shown || !available) return;
    const timer = setTimeout(
      () => setStep((s) => (s + 1) % period),
      stepDelay(shown.speed),
    );
    return () => clearTimeout(timer);
  }, [playing, shown, step, period, available]);
  useEffect(() => {
    if (!playing || !shown?.blink) {
      setBlink(true);
      return;
    }
    const timer = setInterval(() => setBlink((b) => !b), 400);
    return () => clearInterval(timer);
  }, [playing, shown?.blink]);
  const scrub = (s: number) => {
    setPlaying(false);
    setStep(Math.max(0, Math.min(period - 1, s)));
  };
  return (
    <main className="mobile-content mobile-playback">
      <label>
        Playback
        <select
          aria-label="Preview Scope"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as typeof scope);
            setStep(0);
            setPlaying(false);
          }}
        >
          <option value="sequence">All Enabled Slots</option>
          <option value="slot">Selected Slot</option>
        </select>
      </label>
      {available && shown ? (
        <>
          <MiniBadge
            message={shown}
            step={local}
            brightness={project.brightness}
            hidden={!blink}
          />
          <p role="status">
            Slot {project.messages.indexOf(shown) + 1} of{" "}
            {project.messages.length}
            {shown.mode === "animation"
              ? ` · Frame ${(local % shown.frames.length) + 1} of ${shown.frames.length}`
              : ` · ${shown.name}`}
          </p>
          <div className="mobile-control-grid">
            <button onClick={() => setPlaying((p) => !p)}>
              {playing ? "Pause" : "Play"}
            </button>
            <button onClick={() => scrub(0)}>Restart</button>
            <button onClick={() => scrub((step - 1 + period) % period)}>
              Previous Step
            </button>
            <button onClick={() => scrub((step + 1) % period)}>
              Next Step
            </button>
          </div>
          <label>
            Timeline
            <input
              type="range"
              aria-label="Preview Timeline"
              min="0"
              max={Math.max(0, period - 1)}
              value={step}
              onChange={(e) => scrub(Number(e.target.value))}
            />
          </label>
          <button
            className="mobile-primary"
            onClick={() =>
              onEdit(
                shown,
                shown.mode === "animation" ? local % shown.frames.length : 0,
              )
            }
          >
            Edit This Slot
          </button>
        </>
      ) : (
        <p>Enable at least one slot to preview the sequence.</p>
      )}
    </main>
  );
}
