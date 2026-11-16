import type { ReactNode } from "react";
import { Tip } from "./Tip";

// Values data scrubbing took out before the event was stored show as
// "[Filtered]". They get a look of their own and say why on hover.

export const FILTERED = "[Filtered]";
const TIP = "Removed before storage by data scrubbing: it looked like a secret (a password, token, key, or card number). The original was never kept.";

function Mark({ tip }: { tip: boolean }) {
  if (!tip) return <span className="redacted">filtered</span>;
  return (
    <Tip content={TIP}>
      <span className="redacted">filtered</span>
    </Tip>
  );
}

/** Text with each "[Filtered]" shown as a redaction mark. */
export function Redacted({ text, tip = true }: { text: string; tip?: boolean }): ReactNode {
  if (!text.includes(FILTERED)) return text;
  const parts = text.split(FILTERED);
  return parts.map((p, i) => (
    <span key={i}>
      {p}
      {i < parts.length - 1 && <Mark tip={tip} />}
    </span>
  ));
}

/** Highlighted code HTML with each "[Filtered]" marked. A native title says why, since it is not React. */
export function redactHtml(html: string): string {
  if (!html.includes(FILTERED)) return html;
  const title = TIP.replace(/"/g, "&quot;");
  return html.replaceAll(FILTERED, `<span class="redacted" title="${title}">filtered</span>`);
}
