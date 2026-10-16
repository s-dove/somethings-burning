import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import { highlight, languageFor } from "../components/common/CodeBlock";
import type { EventView, FrameView } from "../shared/api";

type Exception = EventView["exceptions"][number];

// StackTrace is one exception's frames, newest call first, in its own card.
// The first frames of your own code start open.
export function StackTrace({ exception, platform, causedBy }: { exception: Exception; platform: string; causedBy: boolean }) {
  const frames = exception.frames;
  return (
    // One card: the heading, then the frames edge to edge with dividers.
    <section className="mb-6 min-w-0 overflow-hidden rounded-card border border-rule bg-ash">
      <h2 className="flex flex-wrap items-baseline gap-2 px-5 py-4 text-sm font-semibold">
        Stack trace
        <span className="text-xs font-normal text-cinder">
          {causedBy && (
            <>
              for <span className="mono">{exception.type}</span>, which caused the one above.{" "}
            </>
          )}
          {frames.length} {frames.length === 1 ? "frame" : "frames"}, newest call first
        </span>
      </h2>
      <div>
        {frames.map((f, k) => (
          <Disclosure key={k} as="div" defaultOpen={f.inApp && k < 3} className="border-t border-rule-soft">
            {({ open }) => (
              <>
                <div className="flex items-stretch hover:bg-smoke">
                  <DisclosureButton
                    className={`mono flex min-w-0 flex-1 cursor-pointer flex-wrap items-baseline gap-2 py-2.5 pr-5 pl-5 text-left ${f.inApp ? "" : "text-cinder"}`}
                  >
                    <span className="w-2.5 text-cinder">{open ? "−" : "+"}</span>
                    <span className="wrap-anywhere">{f.location}</span>
                    {f.function && (
                      <>
                        <span className="text-cinder">in</span> <span className={f.inApp ? "font-semibold" : ""}>{f.function}</span>
                      </>
                    )}
                    {f.lineno > 0 && <span className="text-cinder">line {f.lineno}</span>}
                    {!f.inApp && <span className="ml-auto text-[11px] text-cinder">library</span>}
                  </DisclosureButton>
                </div>
                <DisclosurePanel>
                  {f.lines.length > 0 && <FrameSource lines={f.lines} language={languageFor(platform, f.location)} />}
                  {f.vars.length > 0 && (
                    <dl className="mono grid grid-cols-[max-content_minmax(0,1fr)] gap-x-[18px] gap-y-0.5 border-t border-rule-soft py-2.5 pr-5 pl-[38px]">
                      {f.vars.map(([name, value]) => (
                        <div key={name} className="contents">
                          <dt className="text-cinder">{name}</dt>
                          <dd className="m-0">
                            <pre className="mono">{value}</pre>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </DisclosurePanel>
              </>
            )}
          </Disclosure>
        ))}
      </div>
    </section>
  );
}

// FrameSource is the code around a frame, highlighted line by line so each
// keeps its number and the failing line keeps its ember mark.
function FrameSource({ lines, language }: { lines: FrameView["lines"]; language: string }) {
  return (
    <pre className={`mono language-${language} border-t border-rule-soft py-1.5`}>
      {lines.map((l) => (
        <div key={l.no} className={`grid min-w-max grid-cols-[52px_1fr] ${l.current ? "bg-heat-4/20 shadow-[inset_3px_0_0_var(--color-heat-4)]" : ""}`}>
          <span className="pr-3 text-right text-[var(--code-line)] select-none">{l.no}</span>
          <code className="mono pr-3.5" dangerouslySetInnerHTML={{ __html: highlight(l.text, language) || " " }} />
        </div>
      ))}
    </pre>
  );
}
