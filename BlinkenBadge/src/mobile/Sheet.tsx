import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

export default function Sheet({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const locked = useRef(busy);
  locked.current = busy;
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const overlay = dialog.parentElement!;
    const previous = document.activeElement as HTMLElement | null;
    const siblings = [...overlay.parentElement!.children].filter(
      (x): x is HTMLElement => x instanceof HTMLElement && x !== overlay,
    );
    const old = siblings.map((x) => ({
      inert: x.inert,
      hidden: x.getAttribute("aria-hidden"),
    }));
    siblings.forEach((x) => {
      x.inert = true;
      x.setAttribute("aria-hidden", "true");
    });
    const items = () => [
      ...dialog.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
      ),
    ];
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked.current) {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab") {
        const list = items();
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    const focus = (e: FocusEvent) => {
      if (!dialog.contains(e.target as Node)) (items()[0] ?? dialog).focus();
    };
    window.addEventListener("keydown", key, true);
    document.addEventListener("focusin", focus);
    return () => {
      window.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", focus);
      siblings.forEach((x, i) => {
        x.inert = old[i].inert;
        if (old[i].hidden === null) x.removeAttribute("aria-hidden");
        else x.setAttribute("aria-hidden", old[i].hidden!);
      });
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useLayoutEffect(() => {
    // Keep focus in the sheet when switching to a confirmation or submenu.
    const dialog = ref.current!;
    (
      dialog.querySelector<HTMLElement>("button:not(:disabled)") ?? dialog
    ).focus();
  }, [title]);
  return (
    <div
      className="mobile-sheet-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={ref}
        className="mobile-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header>
          <h2>{title}</h2>
          <button disabled={busy} onClick={onClose}>
            Done
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
