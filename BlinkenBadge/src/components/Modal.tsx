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

import { useLayoutEffect, useRef, useState } from "react";

export interface ModalAction {
  label: string;
  /** The one Enter triggers and focus lands on. */
  primary?: boolean;
  /** Renders as destructive, and is never the primary. */
  danger?: boolean;
  onSelect: () => void | Promise<void>;
}

interface Props {
  title: string;
  body?: React.ReactNode;
  actions: ModalAction[];
  /** Escape and the backdrop pick this. Omit to make the dialog unskippable. */
  onCancel?: () => void;
}

/**
 * A modal question. Deliberately not `window.confirm`: that only offers two
 * answers, and "you have unsaved changes" needs three (save, discard, cancel).
 * Losing work to a two-button dialog is exactly the failure this exists to
 * prevent.
 */
export default function Modal({ title, body, actions, onCancel }: Props) {
  const primary = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef(onCancel);
  cancel.current = busy ? undefined : onCancel;

  useLayoutEffect(() => {
    const modal = dialog.current!;
    const backdrop = modal.parentElement!;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const siblings = [...backdrop.parentElement!.children].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== backdrop,
    );
    const previousInert = siblings.map((el) => el.inert);
    siblings.forEach((el) => {
      el.inert = true;
    });
    const buttons = () => [
      ...modal.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ];
    const focus = () => (primary.current ?? buttons()[0] ?? modal).focus();
    focus();
    const keepFocus = (e: FocusEvent) => {
      if (!modal.contains(e.target as Node)) focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel.current?.();
      } else if (e.key === "Tab") {
        const items = buttons();
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next = e.shiftKey
          ? index <= 0
            ? items.length - 1
            : index - 1
          : (index + 1) % items.length;
        e.preventDefault();
        e.stopPropagation();
        (items[next] ?? modal).focus();
      }
    };
    document.addEventListener("focusin", keepFocus);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("focusin", keepFocus);
      window.removeEventListener("keydown", onKey, true);
      siblings.forEach((el, i) => {
        el.inert = previousInert[i];
      });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel?.();
      }}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-busy={busy}
        aria-modal="true"
        aria-label={title}
      >
        <h2 className="modal-title">{title}</h2>
        {body && <div className="modal-body">{body}</div>}
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          {actions.map((a) => (
            <button
              key={a.label}
              ref={a.primary ? primary : undefined}
              className={
                a.danger ? "danger" : a.primary ? "primary" : undefined
              }
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await a.onSelect();
                } catch {
                  setError("Could not finish that action.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
