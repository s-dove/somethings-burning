import { Link } from "../components/common/Link";
import { Layout } from "../components/Layout";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { useApi, type Session } from "../shared/api";
import { copyText } from "../shared/clipboard";
import { t } from "../shared/i18n";
import { input, section } from "../shared/ui";
import { Button } from "../ui/components/Button";
import { useState } from "react";
import { ArrowLeft, Copy, KeyRound } from "../ui/icons";
import { Tip } from "../components/Tip";
import { CreateTokenModal } from "./CreateTokenModal";

/** Connecting an AI agent over MCP: what to tell it, and the tools it gets. */
export function ProfileMcpPage() {
  const session = useApi<Session>("/session");
  return (
    <Layout nav="profile">
      <PageHeader
        before={
          <Link to="/profile" className="inline-flex items-center gap-2 text-xs text-cinder no-underline">
            <ArrowLeft aria-hidden="true" />
            {t("Back to profile")}
          </Link>
        }
        title={t("Connect an AI agent (MCP)")}
        actions={
          session.data?.user && (
            <Link to="/profile/tokens" className="ui-button ui-button-secondary ui-button-md no-underline">
              {t("Access tokens")}
            </Link>
          )
        }
        after={<p className="mt-2 text-sm text-cinder">{t("Send this to your agent.")}</p>}
        spaceBelow="mb-2"
      />
      {!session.data ? (
        session.error ? <p role="alert" className="text-ember-ink">{session.error}</p> : <Loading />
      ) : session.data.user ? (
        <Mcp />
      ) : (
        <p className="mt-8 text-sm text-cinder">{t("Sign in to see your profile.")}</p>
      )}
    </Layout>
  );
}

/** How to connect an AI agent: a text to hand to the agent, with the MCP endpoint and the token. */
/** brp_ and the last four characters, the rest dotted out. */
const redact = (token: string) => (token.length > 12 ? `${token.slice(0, 4)}${"•".repeat(8)}${token.slice(-4)}` : "•".repeat(Math.max(4, token.length)));

function Mcp() {
  // The token goes into the message: pasted, or made here. It is not kept anywhere else.
  const [token, setToken] = useState("");
  const tokenValue = token.trim();
  const [creating, setCreating] = useState(false);
  const url = `${window.location.origin}/mcp`;
  const lines = [
    t('Add an MCP server named "burning" to your configuration:'),
    `- ${t("Transport")}: Streamable HTTP`,
    `- URL: ${url}`,
    `- ${t("Header")}: Authorization: Bearer `,
    t("It is Burning, an error tracker. Use it to find issues and read their stack traces."),
  ];
  // The page shows the token redacted; only the copied text has it in full.
  const shown = tokenValue ? redact(tokenValue) : t("<generate or paste a token>");
  const prompt = lines.map((l, i) => (i === 3 ? l + (tokenValue || shown) : l)).join("\n");
  const read: [string, string][] = [
    ["search_issues", t("Find issues: open, busiest first, by text, project, assignee, or release")],
    ["get_issue", t("An issue with its stack trace, tags, users, history, and suspect changes")],
    ["list_events", t("An issue's stored events")],
    ["list_projects", t("Your projects and your role in each")],
  ];
  const write: [string, string][] = [
    ["resolve_issue", t("Change an issue's status")],
    ["reopen_issue", t("Change an issue's status")],
    ["mute_issue", t("Change an issue's status")],
    ["assign_issue", t("Assign, and comment, as you")],
    ["comment_on_issue", t("Assign, and comment, as you")],
  ];
  const chips = (list: [string, string][], hot: boolean) => (
    <div className="flex flex-wrap gap-1.5">
      {list.map(([name, what]) => (
        <Tip key={name} content={what}>
          <span className={`mono cursor-default rounded-full border px-2 py-0.5 text-xs ${hot ? "border-[#f6cfae] bg-ember-soft text-ember-ink" : "border-rule bg-smoke text-soot"}`}>{name}</span>
        </Tip>
      ))}
    </div>
  );
  return (
    <section className={section}>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="grid min-w-64 flex-1 gap-1.5 text-xs font-medium">
          {t("Your token")}
          <input
            type="password"
            className={`${input} mono h-9`}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="brp_…"
            spellCheck={false}
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
          />
        </label>
        <Button icon={<KeyRound aria-hidden="true" />} onClick={() => setCreating(true)}>{t("Generate token")}</Button>
      </div>
      <pre className="mono m-0 overflow-x-auto rounded-control bg-smoke p-3 text-xs leading-relaxed whitespace-pre-wrap">
        {lines.map((l, i) => (
          <span key={i}>
            {l}
            {i === 3 && <span className={tokenValue ? "rounded-sm bg-ember-soft px-0.5 font-semibold text-ember-ink" : "text-cinder italic"}>{shown}</span>}
            {i < lines.length - 1 && "\n"}
          </span>
        ))}
      </pre>
      <div className="mt-3 flex justify-end">
        <Button variant={tokenValue ? "primary" : "secondary"} icon={<Copy aria-hidden="true" />} onClick={() => void copyText(prompt)}>
          {t("Copy")}
        </Button>
      </div>
      <CreateTokenModal open={creating} onClose={() => setCreating(false)} onCreated={setToken} />
      <h3 className="mt-6 mb-2 text-[13px] font-semibold">{t("Tools")}</h3>
      <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-start gap-x-4 gap-y-2.5 text-xs text-cinder">
        <span className="leading-6">{t("Read only")}</span>
        {chips(read, false)}
        <span className="leading-6">{t("Read and write")}</span>
        {chips(write, true)}
      </div>
    </section>
  );
}
