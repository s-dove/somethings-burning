import { useState } from "react";
import { toast } from "sonner";
import { mutate } from "swr";
import { Button } from "../ui/components/Button";
import { ArrowRight, Bell, ChevronRight, LogOut } from "../ui/icons";
import { Link } from "../components/common/Link";
import { Layout } from "../components/Layout";
import { PageHeader } from "../components/PageHeader";
import { Loading } from "../components/Loading";
import { api, useApi, type Profile, type Session } from "../shared/api";
import { ago, stamp } from "../shared/format";
import { input } from "../shared/ui";
import { Tip } from "../components/Tip";
import { LangGrid } from "../components/LangSwitch";
import { ProfileGroups } from "./ProfileGroups";
import { chooseLang, lang, t } from "../shared/i18n";

const card = "mt-6 rounded-card border border-rule bg-smoke p-6";
const MAX_NAME = 80;

export function ProfilePage() {
  const { data, error } = useApi<Session>("/session");
  const profile = useApi<Profile>(data?.user ? "/profile" : null);
  if (!data) {
    return <Layout nav="profile">{error ? <p role="alert" className="text-ember-ink">{error}</p> : <Loading />}</Layout>;
  }
  const user = data.user;
  return (
    <Layout nav="profile">
      <PageHeader
        title={t("Profile")}
        actions={user ? <form method="post" action="/auth/logout"><Button type="submit" size="sm" icon={<LogOut aria-hidden="true" />}>{t("Log out")}</Button></form> : undefined}
        after={user ? <p className="mt-2 text-sm text-cinder"><span className="font-semibold text-soot">{user.displayName}</span> · {user.email}</p> : undefined}
        spaceBelow="mb-2"
      />
      <div className="max-w-[720px]">
        {!user && <div className="mt-8 rounded-card border border-rule bg-smoke p-6">
          <p className="text-sm text-cinder">{t("Sign in to see your profile.")}</p>
          <a href="/login?next=/profile" className="ui-button ui-button-primary ui-button-md mt-5 no-underline">{t("Sign in")}<ArrowRight aria-hidden="true" /></a>
        </div>}
        {user && <>
          {profile.error && <p role="alert" className="mt-6 text-sm text-ember-ink">{profile.error}</p>}
          {!profile.data && !profile.error && <Loading />}
          {profile.data && <ProfileDetails profile={profile.data} onSaved={profile.reload} />}
        </>}
      </div>
    </Layout>
  );
}

function ProfileDetails({ profile: p, onSaved }: { profile: Profile; onSaved: () => void }) {
  const rows: [string, string, string?][] = [
    ["Email", p.email, "email claim"],
    ["Name", p.name || "none", "name claim"],
    ["Issuer", p.issuer, "iss claim"],
    ["Subject", p.subject, "sub claim"],
    ["First sign-in", stamp(p.firstLogin)],
    ["Last sign-in", `${stamp(p.lastLogin)} (${ago(p.lastLogin)})`],
    ["ID token expires", p.tokenExpires ? stamp(p.tokenExpires * 1000) : "unknown"],
  ];
  return (
    <>
      <Names profile={p} onSaved={onSaved} />
      <section className={card}>
        <h2 className="text-base">{t("Language")}</h2>
        <p className="mt-1 mb-4 text-xs text-cinder">{t("Language follows your account.")}</p>
        <LangGrid cols={2} onPick={(l) => void chooseLang(l, true)} current={lang} />
      </section>
      <Link to="/profile/notifications" className={`${card} flex items-center gap-4 text-soot no-underline hover:bg-rule-soft`}>
        <span className="grid size-9 shrink-0 place-items-center rounded-control border border-rule bg-ash text-cinder"><Bell aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold">{t("Your notifications")}</span>
          <span className="block text-xs text-cinder">{t("How alerts reach you, and the daily summary.")}</span>
        </span>
        <ChevronRight className="shrink-0 text-cinder" aria-hidden="true" />
      </Link>

      <section className={card}>
        <h2 className="text-base">{t("Account")}</h2>
        <p className="mt-1 mb-4 text-xs text-cinder">{t("From the ID token at your last sign-in. Burning keeps these claims, not the tokens.")}</p>
        <dl className={facts}>
          {rows.map(([k, v, hint]) => (
            <div key={k} className="contents">
              <Tip content={hint}><dt className="text-cinder">{k}</dt></Tip>
              <dd className="m-0 wrap-anywhere">{v}</dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-6 mb-1 text-sm font-semibold">{t("All claims")}</h3>
        <p className="mb-3 text-xs text-cinder">Everything else the provider said about you. Claims about the token itself (exp, aud, nonce, …) are left out, and groups are listed below.</p>
        <dl className={facts}>
          {p.claims.filter(([k]) => k !== "groups").map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="mono text-cinder">{k}</dt>
              <dd className="mono m-0 wrap-anywhere">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={card}>
        <h2 className="text-base">{t("Groups")}</h2>
        <p className="mt-1 mb-4 text-xs text-cinder">Taken from the groups claim at sign-in. Project roles can be granted to a group.</p>
        <ProfileGroups groups={p.groups} />
      </section>
    </>
  );
}

const facts = "m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-[13px]";

// Names is the two names a person has: the display name everyone sees, which
// they choose, and the username, which comes from sign-in.
function Names({ profile: p, onSaved }: { profile: Profile; onSaved: () => void }) {
  const [value, setValue] = useState(p.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = value.trim() !== p.displayName;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await api<Profile>("/profile", { method: "PUT", body: { displayName: value } });
      setValue(next.displayName);
      onSaved();
      void mutate("/session");
      toast("Display name saved");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={card}>
      <h2 className="text-base">{t("Names")}</h2>
      <div className="mt-4 grid gap-5 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-x-6">
        <label htmlFor="display-name" className="text-[13px] font-medium sm:pt-2">{t("Display name")}</label>
        <div>
          <form className="flex flex-wrap items-center gap-2" onSubmit={save}>
            <input id="display-name" className={`${input} h-9 max-w-80 flex-1`} value={value} maxLength={MAX_NAME} placeholder={p.username} onChange={e => setValue(e.target.value)} />
            <Button type="submit" variant="primary" size="sm" disabled={busy || !changed}>{busy ? "Saving…" : "Save"}</Button>
          </form>
          <p className="mt-1.5 text-xs text-cinder">What everyone sees on access lists and in routing. Empty means your username.</p>
          {error && <p role="alert" className="mt-1.5 text-xs text-ember-ink">{error}</p>}
        </div>

        <span className="text-[13px] font-medium">{t("Username")}</span>
        <div>
          <span className="mono text-[13px]">{p.username}</span>
          <p className="mt-1.5 text-xs text-cinder">
            Set by sign-in from the preferred_username claim, or your email before the @.
          </p>
        </div>
      </div>
    </section>
  );
}
