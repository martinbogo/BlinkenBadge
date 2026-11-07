import { enabledMessages } from "../badge";
import type { Progress } from "../platform";
import {
  MAX_BYTE_COLUMNS,
  type BadgeInfo,
  type Brightness,
  type Project,
} from "../types";
import { MiniBadge } from "./MobilePreview";

interface Props {
  project: Project;
  badges: BadgeInfo[];
  badgeId: string | null;
  busy: "scan" | "send" | "file" | null;
  progress: Progress | null;
  status: string | null;
  sent: boolean;
  usedColumns: number;
  onScan(): void;
  onSend(): void;
  onChoose(id: string): void;
  onEnabled(id: string, enabled: boolean): void;
  onBrightness(value: Brightness): void;
  onDone(): void;
}

export default function SendWorkspace(p: Props) {
  const count = enabledMessages(p.project.messages).length;
  const full = p.usedColumns > MAX_BYTE_COLUMNS;
  const selected = p.badges.find((b) => b.id === p.badgeId);
  const ready = !!p.badgeId && count > 0 && !full;
  const reason = !count
    ? "Select at least one slot to send."
    : full
      ? "This selection exceeds badge memory. Turn off slots or shorten the content."
      : !p.badgeId
        ? "Find a badge, then send the checked slots."
        : `Ready to send to ${selected?.name ?? "LED Badge"}.`;
  return (
    <>
      <main
        className="mobile-content mobile-send"
        aria-label="Prepare Transfer"
      >
        <section aria-label="Choose Badge" aria-busy={p.busy === "scan"}>
          <h2>Badge</h2>
          <p>
            Unplug the badge from USB and press button 1 to enable Bluetooth.
          </p>
          <button
            className="mobile-connect"
            disabled={!!p.busy}
            onClick={p.onScan}
          >
            {p.busy === "scan"
              ? "Finding Badges"
              : p.badges.length
                ? "Find Again"
                : "Find Badge"}
          </button>
          {p.badges.map((b) => (
            <button
              key={b.id}
              className="mobile-device"
              aria-pressed={p.badgeId === b.id}
              disabled={!!p.busy}
              onClick={() => p.onChoose(b.id)}
            >
              <span>
                {b.name ?? "LED Badge"}
                {p.badgeId === b.id && <small>Selected for Sending</small>}
              </span>
              <small>{b.rssi === null ? "Bluetooth" : `${b.rssi} dBm`}</small>
            </button>
          ))}
          <details className="mobile-help">
            <summary>Connection Help</summary>
            <ul>
              <li>
                Turn on Bluetooth on your phone and keep the badge nearby.
              </li>
              <li>
                Allow Bluetooth or Nearby Devices access when asked. Older
                Android versions also require Location access for scanning.
              </li>
              <li>
                If access was denied, enable it in this app’s system settings,
                then find the badge again.
              </li>
              <li>
                Unplug the badge from USB and press button 1 again if it stops
                advertising.
              </li>
              <li>
                Disable the badge PIN before sending; PIN-protected transfers
                are not supported.
              </li>
            </ul>
            <p>
              The previews show this device draft. The app does not read saved
              artwork from the badge.
            </p>
          </details>
        </section>
        <section aria-label="Slots to Send">
          <h2>Slots to Send</h2>
          <p>
            {count} of {p.project.messages.length} selected. Sending replaces
            the badge’s current content.
          </p>
          <div className="mobile-send-slots">
            {p.project.messages.map((m, i) => (
              <label
                key={m.id}
                className={`mobile-send-slot${m.enabled === false ? " slot-excluded" : ""}`}
              >
                <input
                  type="checkbox"
                  aria-label={`Send Slot ${i + 1}: ${m.name}`}
                  checked={m.enabled !== false}
                  disabled={!!p.busy}
                  onChange={(e) => p.onEnabled(m.id, e.target.checked)}
                />
                <span className="mobile-send-slot-name">
                  <strong>{m.name}</strong>
                  <small>
                    Slot {i + 1}
                    {m.mode === "animation"
                      ? ` · ${m.frames.length} ${m.frames.length === 1 ? "Frame" : "Frames"}`
                      : ""}
                  </small>
                </span>
                <MiniBadge message={m} brightness={p.project.brightness} />
              </label>
            ))}
          </div>
          <label className="mobile-brightness">
            Brightness
            <select
              value={p.project.brightness}
              disabled={!!p.busy}
              onChange={(e) =>
                p.onBrightness(Number(e.target.value) as Brightness)
              }
            >
              {[25, 50, 75, 100].map((n) => (
                <option key={n} value={n}>
                  {n}%
                </option>
              ))}
            </select>
          </label>
          <div className="mobile-memory">
            <span>
              Badge Memory ·{" "}
              {Math.round((p.usedColumns / MAX_BYTE_COLUMNS) * 100)}%
            </span>
            <progress
              aria-label="Badge Memory"
              max={MAX_BYTE_COLUMNS}
              value={Math.min(p.usedColumns, MAX_BYTE_COLUMNS)}
            />
            <details className="mobile-help">
              <summary>Technical Details</summary>
              <p>
                {p.usedColumns} / {MAX_BYTE_COLUMNS} byte columns used.
              </p>
            </details>
          </div>
        </section>
      </main>
      <footer className="mobile-send-actions">
        <p id="send-readiness" role="status">
          {p.busy === "send"
            ? "Sending. Keep this app open until the transfer finishes."
            : p.busy === "scan"
              ? "Looking for nearby badges…"
              : (p.status ?? reason)}
        </p>
        {p.busy === "send" && (
          <progress
            aria-label="Sending Progress"
            max={p.progress?.total}
            value={p.progress?.chunk}
          />
        )}
        <div className="mobile-control-grid">
          {p.sent && <button onClick={p.onDone}>Done</button>}
          <button
            className="mobile-primary"
            aria-describedby="send-readiness"
            disabled={!!p.busy || !ready}
            onClick={p.onSend}
          >
            {p.busy === "send"
              ? "Sending"
              : p.sent
                ? "Send Again"
                : "Send to Badge"}
          </button>
        </div>
      </footer>
    </>
  );
}
