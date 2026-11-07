import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import EmojiPalette from "../components/EmojiPalette";
import { fitText, measureText } from "../font";
import type { LedColor } from "../types";

const names: Record<string, string> = {
  "←": "Left arrow", "↑": "Up arrow", "→": "Right arrow", "↓": "Down arrow",
  "☀": "Sun", "☁": "Cloud", "☕": "Coffee", "♠": "Spade", "♣": "Club",
  "♦": "Diamond", "♪": "Music note", "⚠": "Warning", "⚡": "Lightning",
  "✔": "Check mark", "❄": "Snowflake", "❌": "Cross", "❤": "Heart",
  "⭐": "Star", "🌙": "Moon", "🎁": "Gift", "🎂": "Cake", "🎈": "Balloon",
  "🐱": "Cat", "👀": "Eyes", "👍": "Thumbs up", "👑": "Crown",
  "👻": "Ghost", "👽": "Alien", "💀": "Skull", "💩": "Pile of poo",
  "🔑": "Key", "🔒": "Lock", "🔔": "Bell", "🔥": "Fire", "😀": "Grinning face",
  "😉": "Winking face", "😎": "Sunglasses", "😡": "Angry face",
  "😢": "Crying face", "🙂": "Smiling face", "🚀": "Rocket", "🤖": "Robot",
};

const symbolName = (char: string) => names[char] ?? char;
type Range = [start: number, end: number];
type Insertion = { before: string; after: string; range: Range };

/** Preserve the caret across the picker, including when the stamp field unmounts. */
export function useSymbolText(
  value: string,
  change: (text: string) => void,
  budget: number,
  face: string,
  context: string,
) {
  const input = useRef<HTMLTextAreaElement>(null);
  const range = useRef<Range | null>(null);
  const pending = useRef<Range | null>(null);
  const [history, setHistory] = useState<Insertion[]>([]);
  const [notice, setNotice] = useState("");

  useLayoutEffect(() => {
    range.current = null;
    pending.current = null;
    setHistory([]);
    setNotice("");
  }, [context]);

  useLayoutEffect(() => {
    if (input.current && pending.current) {
      input.current.setSelectionRange(...pending.current);
      pending.current = null;
    }
  });

  function rememberRange() {
    const field = input.current;
    if (field) range.current = [field.selectionStart, field.selectionEnd];
  }

  function type(text: string) {
    setHistory([]);
    setNotice("");
    rememberRange();
    change(fitText(text, budget, face));
  }

  function apply(text: string, nextRange: Range) {
    range.current = nextRange;
    pending.current = nextRange;
    // Replacing a selection with the same character may leave value unchanged.
    input.current?.setSelectionRange(...nextRange);
    change(text);
  }

  function pick(char: string) {
    const [start, end] = range.current ?? [value.length, value.length];
    const next = value.slice(0, start) + char + value.slice(end);
    if (next.length > 8192 || measureText(next, face) > budget) {
      setNotice("This symbol won’t fit in the available badge memory.");
      return;
    }
    const caret = start + char.length;
    if (next !== value) {
      setHistory((items) => [...items.slice(-99), { before: value, after: next, range: [start, end] }]);
    }
    apply(next, [caret, caret]);
    setNotice(`${symbolName(char)} inserted`);
  }

  const previous = history[history.length - 1];
  function undo() {
    if (!previous || previous.after !== value) return;
    setHistory((items) => items.slice(0, -1));
    apply(previous.before, previous.range);
    setNotice("Symbol insertion undone");
  }

  return { input, rememberRange, type, pick, undo, canUndo: previous?.after === value, notice };
}

interface PaletteProps {
  chars: string[];
  led: LedColor;
  onPick: (char: string) => void;
}

export function SymbolGrid({ chars, led, onPick }: PaletteProps) {
  return <EmojiPalette chars={chars} led={led} onPick={onPick} nameForChar={symbolName} cell={3} />;
}

export function SymbolPopover({
  anchor,
  onClose,
  ...palette
}: PaletteProps & {
  anchor: RefObject<HTMLButtonElement | null>;
  onClose: (restoreFocus: boolean) => void;
}) {
  const popover = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = popover.current!;
    const viewport = window.visualViewport;
    const size = () => {
      const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const editorBottom = element.closest(".mobile-compose")?.getBoundingClientRect().bottom;
      const bottom = Math.min(viewportBottom, editorBottom || viewportBottom);
      const space = bottom - element.getBoundingClientRect().top - 16;
      element.style.maxHeight = `${Math.max(120, Math.min(392, space))}px`;
    };
    const pointer = (event: PointerEvent) => {
      if (event.target instanceof Element && !element.contains(event.target)
        && !anchor.current?.contains(event.target)
        && !event.target.closest("[data-keep-symbols]")) onClose(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose(true);
      }
    };
    size();
    window.addEventListener("resize", size);
    window.addEventListener("scroll", size, true);
    viewport?.addEventListener("resize", size);
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("resize", size);
      window.removeEventListener("scroll", size, true);
      viewport?.removeEventListener("resize", size);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", key);
    };
  }, [anchor, onClose]);

  return (
    <section ref={popover} id="mobile-text-symbols" className="mobile-symbol-popover"
      role="dialog" aria-label="Badge Symbols">
      <header>
        <h2>Badge Symbols</h2>
        <button onClick={() => onClose(true)}>Done</button>
      </header>
      <SymbolGrid {...palette} />
    </section>
  );
}
