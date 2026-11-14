import { useState } from "react";
import { Copy } from "../ui/icons";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { copyText } from "../shared/clipboard";

function Snippet({ code, wrap }: { code: string; wrap?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className={`mono overflow-x-auto rounded-card bg-[var(--code-bg)] px-4 py-3.5 pr-[84px] text-[var(--code-fg)] shadow-[inset_0_0_0_1px_var(--code-border)] ${wrap ? "wrap-anywhere whitespace-pre-wrap" : "whitespace-pre"}`}>{code}</pre>
      <button
        className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-control border border-[color-mix(in_oklab,var(--code-fg)_25%,transparent)] bg-[color-mix(in_oklab,var(--code-fg)_8%,var(--code-bg))] px-2.5 py-[3px] text-xs text-[var(--code-fg)]"
        type="button"
        onClick={async () => { if (await copyText(code)) setCopied(true); }}
      >
        <Copy aria-hidden="true" />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

// ConnectSection shows the DSN and how to add an SDK.
export function ConnectSection({ dsn }: { dsn: string }) {
  const python = `pip install sentry-sdk

import sentry_sdk

sentry_sdk.init(
    dsn="${dsn}",
    release="1.4.0",
    environment="production",
    traces_sample_rate=0,
)`;
  const go = `go get github.com/getsentry/sentry-go

err := sentry.Init(sentry.ClientOptions{
    Dsn:         "${dsn}",
    Release:     "1.4.0",
    Environment: "production",
})
defer sentry.Flush(2 * time.Second)

sentry.CaptureException(err)`;
  const javascript = `npm install @sentry/node

import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: "${dsn}",
  release: "1.4.0",
  environment: "production",
});`;
  const step = "relative mb-8 border-b border-rule pb-8 pl-12 before:absolute before:top-0 before:left-0 before:grid before:size-7 before:place-items-center before:rounded-control before:border before:border-rule before:bg-smoke before:text-xs before:font-semibold";
  return (
    <section aria-label="Connect">
      <ol className="m-0 list-none p-0">
        <li className={`${step} before:content-['1']`}>
          <h3 className="mb-1.5">Copy the DSN</h3>
          <p className="mb-3 text-cinder">Any official Sentry SDK can report here. Only errors and log messages are kept, so leave tracing off.</p>
          <Snippet code={dsn} wrap />
        </li>
        <li className={`${step} before:content-['2']`}>
          <h3 className="mb-1.5">Add the SDK to your service</h3>
          <p className="mb-3 text-cinder">Set the release to the version you deploy, so the issue page can tell releases apart.</p>
          <TabGroup>
            <TabList className="mb-3 flex gap-1 rounded-control bg-smoke p-1">
              {["Python", "JavaScript", "Go"].map(name => <Tab key={name} className="cursor-pointer rounded-control px-4 py-2 text-xs font-medium text-cinder data-selected:bg-ash data-selected:text-soot data-selected:shadow-sm">{name}</Tab>)}
            </TabList>
            <TabPanels><TabPanel><Snippet code={python} /></TabPanel><TabPanel><Snippet code={javascript} /></TabPanel><TabPanel><Snippet code={go} /></TabPanel></TabPanels>
          </TabGroup>
        </li>
      </ol>
    </section>
  );
}
