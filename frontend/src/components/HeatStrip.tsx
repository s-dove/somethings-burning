import { useState } from "react";
import { t } from "../shared/i18n";
import { Content, Portal, Root, Trigger } from "@radix-ui/react-tooltip";
import { heatBg, plural } from "../shared/format";

// HeatStrip draws 24 hourly cells, oldest on the left, each colored by its
// event count. Hovering a cell names that hour and fades the others.
export function HeatStrip({ hours, size, muted }: { hours: number[]; size: "sm" | "lg"; muted?: boolean }) {
  const [hot, setHot] = useState<number | null>(null);
  const total = hours.reduce((a, b) => a + b, 0);
  const now = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const box = size === "sm" ? "h-6 w-full gap-0.5 max-xl:gap-px" : "h-10 w-full gap-[3px]";
  return (
    <span
      className={`inline-grid grid-cols-[repeat(24,minmax(0,1fr))] align-middle ${box} ${muted ? "opacity-45 grayscale" : ""}`}
      aria-label={t("{events} in the last 24 hours", { events: plural(total, "event") })}
      onMouseLeave={() => setHot(null)}
    >
      {hours.map((n, i) => {
        const hour = new Date(now - (hours.length - 1 - i) * 3_600_000);
        const label = `${hour.toISOString().slice(5, 13).replace("T", " ")}:00 UTC, ${plural(n, "event")}`;
        return (
          <Root key={i} disableHoverableContent>
            <Trigger asChild>
              <span
                className={`rounded-[2px] ${heatBg(n)} ${hot !== null && hot !== i ? "opacity-40" : ""}`}
                onMouseEnter={() => setHot(i)}
              />
            </Trigger>
            <Portal>
              <Content side="top" sideOffset={6} className="z-50 rounded-control bg-soot px-2 py-1 text-[11px] text-ash">{label}</Content>
            </Portal>
          </Root>
        );
      })}
    </span>
  );
}
