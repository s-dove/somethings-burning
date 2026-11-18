import { useState } from "react";
import { toast } from "sonner";
import { Link } from "../components/common/Link";
import { confirmDialog } from "../components/Confirm";
import { Layout } from "../components/Layout";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { api, useApi, type PersonalTokenView, type Session } from "../shared/api";
import { ago } from "../shared/format";
import { t } from "../shared/i18n";
import { section } from "../shared/ui";
import { Button } from "../ui/components/Button";
import { ArrowLeft, Plus } from "../ui/icons";
import { CreateTokenModal } from "./CreateTokenModal";

const DAY = 86_400_000;

/** Personal access tokens, for scripts and AI agents. New ones are made in a dialog. */
export function ProfileTokensPage() {
  const session = useApi<Session>("/session");
  const user = session.data?.user;
  const [creating, setCreating] = useState(false);
  const tokens = useApi<{ tokens: PersonalTokenView[] }>(user ? "/profile/tokens" : null);
  return (
    <Layout nav="profile">
      <PageHeader
        before={
          <Link to="/profile" className="inline-flex items-center gap-2 text-xs text-cinder no-underline">
            <ArrowLeft aria-hidden="true" />
            {t("Back to profile")}
          </Link>
        }
        title={t("Access tokens")}
        actions={user && <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setCreating(true)}>{t("New token")}</Button>}
        spaceBelow="mb-2"
      />
      {!session.data ? (
        session.error ? <p role="alert" className="text-ember-ink">{session.error}</p> : <Loading />
      ) : user ? (
        <Tokens data={tokens.data} error={tokens.error} reload={tokens.reload} />
      ) : (
        <p className="mt-8 text-sm text-cinder">{t("Sign in to see your profile.")}</p>
      )}
      <CreateTokenModal open={creating} onClose={() => setCreating(false)} onCreated={() => tokens.reload()} />
    </Layout>
  );
}

function Tokens({ data, error, reload }: { data: { tokens: PersonalTokenView[] } | null; error: string; reload: () => void }) {
  const revoke = async (tok: PersonalTokenView) => {
    if (!(await confirmDialog({ title: t("Revoke {name}?", { name: tok.name }), body: t("Anything using it stops working at once."), confirm: t("Revoke"), danger: true }))) return;
    try {
      await api(`/profile/tokens/${tok.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const expires = (at: number) => {
    if (!at) return t("never expires");
    const left = at - Date.now();
    if (left <= 0) return t("expired");
    return t("expires in {n} days", { n: Math.ceil(left / DAY) });
  };

  return (
    <div className="grid gap-6">
      <section className={section}>
        {error && <p role="alert" className="text-[13px] text-ember-ink">{error}</p>}
        {!data ? (
          !error && <Loading />
        ) : !data.tokens.length ? (
          <p className="text-[13px] text-cinder">{t("No tokens.")}</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-rule-soft p-0">
            {data.tokens.map((tok) => {
              const dead = !!tok.expiresAt && tok.expiresAt <= Date.now();
              return (
                <li key={tok.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13px] ${dead ? "opacity-60" : ""}`}>
                  <span className="font-medium">{tok.name}</span>
                  <span className="mono text-xs text-cinder">{tok.prefix}…</span>
                  <span className={`rounded-full border px-2 py-px text-[11px] font-medium ${tok.scope === "write" ? "border-[#f6cfae] bg-ember-soft text-ember-ink" : "border-rule bg-smoke text-cinder"}`}>
                    {tok.scope === "write" ? t("Read and write") : t("Read only")}
                  </span>
                  <span className="text-xs text-cinder">
                    {t("made {when}", { when: ago(tok.createdAt) })} · {tok.lastUsed ? t("used {when}", { when: ago(tok.lastUsed) }) : t("never used")} · {expires(tok.expiresAt)}
                  </span>
                  <button type="button" className="ml-auto cursor-pointer text-xs text-cinder hover:text-ember-ink" onClick={() => void revoke(tok)}>{t("Revoke")}</button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
