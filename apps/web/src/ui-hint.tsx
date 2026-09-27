import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const VIEWPORT_MARGIN = 8;
const GAP = 6;
const MIN_WIDTH = 240;
const MAX_WIDTH = 512;

/** Keeps a popover inside the viewport: below its trigger when it fits, above it otherwise. */
function place(anchor: HTMLElement, body: HTMLElement): { top: number; left: number; width: number; maxHeight: number } {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2));
  const left = Math.min(Math.max(VIEWPORT_MARGIN, rect.left), Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN));
  const below = window.innerHeight - rect.bottom - GAP - VIEWPORT_MARGIN;
  const above = rect.top - GAP - VIEWPORT_MARGIN;
  const content = body.scrollHeight;
  const useBelow = below >= Math.min(content, 120) || below >= above;
  const maxHeight = Math.max(96, useBelow ? below : above);
  const top = useBelow ? rect.bottom + GAP : Math.max(VIEWPORT_MARGIN, rect.top - GAP - Math.min(content, maxHeight));
  return { top, left, width, maxHeight };
}

function sameBox(left: ReturnType<typeof place> | null, right: ReturnType<typeof place>): boolean {
  return left !== null && left.top === right.top && left.left === right.left && left.width === right.width && left.maxHeight === right.maxHeight;
}

export interface HelpHintProps {
  /** Short subject of the explanation, for example "Row order". It names the thing, not the answer. */
  readonly label: string;
  /** The explanation itself. Plain text or short markup; it never holds interactive controls. */
  readonly children: ReactNode;
  /** Optional id for the explanation body, so an existing aria-describedby keeps working. */
  readonly bodyId?: string;
  readonly className?: string;
}

/**
 * A compact explanation that stays out of the layout until a reader asks for it.
 *
 * Pointer hover and keyboard focus open it, click or Enter pins it, Escape and an
 * outside click close it, and the body is positioned against the viewport so a
 * scrolling ancestor never clips it. The explanation stays in the DOM while
 * collapsed, so its text remains available to tests and to text extraction.
 */
export function HelpHint({ label, children, bodyId, className }: HelpHintProps) {
  const generated = useId();
  const id = bodyId ?? `help-${generated}`;
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [box, setBox] = useState<ReturnType<typeof place> | null>(null);
  const open = hovered || focused || pinned;
  const close = useCallback(() => { setHovered(false); setFocused(false); setPinned(false); }, []);

  useLayoutEffect(() => {
    if (!open) { setBox(null); return; }
    const anchor = triggerRef.current;
    const body = bodyRef.current;
    if (!anchor || !body) return;
    const update = () => {
      const next = place(anchor, body);
      setBox(previous => sameBox(previous, next) ? previous : next);
    };
    update();
    // The trigger can move with the layout, so the popover follows resize, scroll, and layout shifts.
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, children]);

  useEffect(() => {
    if (!pinned) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && wrapperRef.current?.contains(event.target)) return;
      setPinned(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [pinned]);

  return <span ref={wrapperRef} className={className === undefined ? "help-hint" : `help-hint ${className}`}
    onPointerEnter={event => { if (event.pointerType === "mouse") setHovered(true); }}
    onPointerLeave={event => { if (event.pointerType === "mouse") setHovered(false); }}
    onFocus={() => setFocused(true)}
    onBlur={() => setFocused(false)}
    onKeyDown={event => { if (event.key === "Escape" && open) { event.stopPropagation(); close(); } }}>
    <button ref={triggerRef} type="button" className="help-hint-trigger" aria-expanded={open} aria-controls={id}
      onClick={() => setPinned(value => !value)}>
      <span className="help-hint-icon" aria-hidden="true">i</span>
      <span className="help-hint-label">{label}</span>
    </button>
    <div ref={bodyRef} id={id} className="help-hint-body" role="note" hidden={!open}
      style={open && box !== null ? { top: box.top, left: box.left, width: box.width, maxHeight: box.maxHeight } : undefined}>
      {children}
    </div>
  </span>;
}
