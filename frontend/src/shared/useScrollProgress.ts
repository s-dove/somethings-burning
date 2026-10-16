import { useEffect, useRef, useState, type RefObject } from "react";

// The nearest ancestor that scrolls vertically, or null for the window.
// Layout scrolls its content pane on desktop and the window on mobile.
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if (y === "auto" || y === "scroll") return p;
  }
  return null;
}

// Scroll distance of the element's scroll container, mapped to 0..1 over `range` px.
// With an anchor, progress starts once the scroll reaches it, less `stickAt` px.
// That is where a sticky header starts sticking, so it does not scroll and
// shrink at the same time. The anchor must not be sticky itself.
export function useScrollProgress<T extends HTMLElement>(range: number, anchor?: RefObject<HTMLElement | null>, stickAt = 0) {
  const ref = useRef<T>(null);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const parent = scrollParent(el);
      const top = parent ? parent.scrollTop : window.scrollY;
      let start = 0;
      const a = anchor?.current;
      if (a) {
        const base = parent ? parent.getBoundingClientRect().top : 0;
        start = Math.max(0, a.getBoundingClientRect().top - base + top - stickAt);
      }
      setProgress(Math.min(1, Math.max(0, (top - start) / range)));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    // Scroll does not bubble, so listen in the capture phase to catch the content pane.
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    update();
    return () => {
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [range, anchor, stickAt]);
  return { ref, progress };
}
