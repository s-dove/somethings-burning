import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { useScrollProgress } from "../shared/useScrollProgress";
import { Tip } from "./Tip";

const TITLE_PX = [28, 18] as const;
const PAD_PX = 12;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Collapses to zero height as t goes 0 -> 1, keeping its natural height at 0.
function Collapse({ t, children, measure }: { t: number; children: ReactNode; measure: Ref<HTMLDivElement> }) {
  const hidden = t >= 1;
  return (
    <div className="grid" style={{ gridTemplateRows: `${1 - t}fr`, opacity: 1 - Math.min(1, t * 1.6) }} aria-hidden={hidden || undefined} inert={hidden}>
      <div className="min-h-0 overflow-hidden"><div ref={measure}>{children}</div></div>
    </div>
  );
}

interface Props {
  /** Fades and collapses above the title as the page scrolls (e.g. a back link). */
  before?: ReactNode;
  title: ReactNode;
  /** Full title text, shown as a tooltip once the title is clamped. */
  titleText?: string;
  /** Lines the title is clamped to once compact. */
  titleLines?: 1 | 2;
  /** Right of the title, always visible. */
  actions?: ReactNode;
  /** Fades and collapses below the title as the page scrolls. */
  after?: ReactNode;
  /** Stays pinned below the title. Receives whether the header is compact. */
  children?: ReactNode | ((compact: boolean) => ReactNode);
  /** Space above the pinned children, expanded then compact. It eases with the scroll. */
  pinnedGap?: readonly [number, number];
  /** Space between the header and the page below it. */
  spaceBelow?: string;
}

// Page header pinned to the top of the content pane. Scrolling shrinks the
// title and collapses `before` and `after`, so the title slides up into place.
export function PageHeader({ before, title, titleText, titleLines = 1, actions, after, children, pinnedGap = [0, 0], spaceBelow = "mb-6" }: Props) {
  // The header shrinks by exactly as much as the page scrolls, so its bottom
  // edge moves with the content. range is that shrink: the collapsing parts,
  // plus the smaller title, less the padding that compact mode adds.
  const [range, setRange] = useState(96);
  const [stickAt, setStickAt] = useState(0);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const { ref, progress: p } = useScrollProgress<HTMLDivElement>(range, placeholderRef, stickAt);
  const compact = p > 0.6;
  const pad = `${lerp(0, PAD_PX, p)}px`;
  const beforeRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const style: CSSProperties = { borderColor: `color-mix(in oklab, var(--color-rule) ${Math.round(p * 100)}%, transparent)`, paddingTop: pad, paddingBottom: pad };
  const clamp = compact ? (titleLines === 1 ? "line-clamp-1" : "line-clamp-2") : "";
  // The header floats over a placeholder of its expanded height, so collapsing
  // it never changes the page height or the scroll position. Otherwise the
  // shorter page moves the scroll offset, which re-expands the header (shake).
  const [full, setFull] = useState(0);
  const atTop = useRef(true);
  atTop.current = p === 0;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const h = el.offsetHeight;
      setFull(f => (atTop.current || h > f ? h : f));
      const sticky = el.parentElement;
      if (sticky) setStickAt(parseFloat(getComputedStyle(sticky).top) || 0);
      if (!atTop.current) return;
      const title = titleRef.current;
      const lineHeight = title ? parseFloat(getComputedStyle(title).lineHeight) / TITLE_PX[0] : 1.25;
      const shrink = (beforeRef.current?.offsetHeight ?? 0) + (afterRef.current?.offsetHeight ?? 0)
        + (TITLE_PX[0] - TITLE_PX[1]) * lineHeight + (pinnedGap[0] - pinnedGap[1]) - 2 * PAD_PX;
      setRange(Math.max(24, Math.round(shrink)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (beforeRef.current) ro.observe(beforeRef.current);
    if (afterRef.current) ro.observe(afterRef.current);
    return () => ro.disconnect();
  }, [ref, pinnedGap]);
  return (
    <>
      <div className="sticky top-14 z-20 -mx-5 h-0 sm:-mx-6 lg:top-0 lg:-mx-9">
        <div ref={ref} className="absolute inset-x-0 top-0 border-b bg-ash/75 px-5 backdrop-blur-md backdrop-saturate-150 sm:px-6 lg:px-9" style={style}>
          {before && <Collapse t={p} measure={beforeRef}><div className="pb-6">{before}</div></Collapse>}
          <div className={`flex flex-wrap justify-between gap-x-4 gap-y-3 ${compact ? "items-center" : "items-start"}`}>
            <Tip content={compact ? titleText : undefined} side="bottom" truncated>
              <h1 ref={titleRef} className={`min-w-0 flex-[1_1_16rem] leading-tight wrap-break-word ${clamp}`} style={{ fontSize: `${lerp(TITLE_PX[0], TITLE_PX[1], p)}px` }}>{title}</h1>
            </Tip>
            {actions && <div className="shrink-0">{actions}</div>}
          </div>
          {after && <Collapse t={p} measure={afterRef}>{after}</Collapse>}
          <div style={{ marginTop: `${lerp(pinnedGap[0], pinnedGap[1], p)}px` }}>{typeof children === "function" ? children(compact) : children}</div>
        </div>
      </div>
      <div ref={placeholderRef} aria-hidden="true" className={spaceBelow} style={{ height: full }} />
    </>
  );
}
