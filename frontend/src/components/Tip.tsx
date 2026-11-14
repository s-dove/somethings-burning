import { useState, type ReactElement, type ReactNode } from "react";
import { Content, Portal, Root, Trigger } from "@radix-ui/react-tooltip";
import { stamp } from "../shared/format";

type Side = "top" | "right" | "bottom" | "left";

// Tip shows a small dark tooltip on hover, the same as the project edge and
// the heat strip. The child must be one element that takes a ref and props.
// With truncated, it only opens when the child's text is cut off (ellipsis),
// to show the full text. A disabled button gets no hover events, so wrap it
// in a span first.
export function Tip({ content, children, side = "top", truncated }: { content: ReactNode; children: ReactElement; side?: Side; truncated?: boolean }) {
  const [open, setOpen] = useState(false);
  const [el, setEl] = useState<HTMLElement | null>(null);
  if (!content) return children;
  const onOpenChange = (next: boolean) => {
    if (next && truncated && el) {
      // The text may sit in the child or in its first child (a clamped heading).
      const cut = (n: Element | null) => !!n && (n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1);
      if (!cut(el) && !cut(el.firstElementChild)) return;
    }
    setOpen(next);
  };
  return (
    <Root disableHoverableContent open={open} onOpenChange={onOpenChange}>
      <Trigger asChild ref={setEl}>{children}</Trigger>
      <Portal>
        <Content side={side} sideOffset={6} collisionPadding={8} className="z-50 max-w-72 rounded-control bg-soot px-2 py-1 text-[11px] leading-snug text-ash wrap-anywhere">
          {content}
        </Content>
      </Portal>
    </Root>
  );
}

// TimeTip shows the exact time of a relative one ("3h ago").
export function TimeTip({ at, children }: { at: number; children: ReactElement }) {
  return <Tip content={stamp(at)}>{children}</Tip>;
}
