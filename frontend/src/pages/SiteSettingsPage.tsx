import type { ReactNode } from "react";
import { Link } from "../components/common/Link";
import { Layout } from "../components/Layout";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { useApi } from "../shared/api";
import { ArrowLeft, Code, KeyRound, Mail, MessageCircle } from "../ui/icons";

interface SiteSettings {
  signIn: {
    password: { enabled: boolean; file: string };
    oidc: {
      enabled: boolean;
      issuer: string;
      clientId: string;
      clientAuth: string;
      secretSet: boolean;
      redirectURL: string;
      scope: string;
      groupsClaim: string;
      name: string;
    };
    siteAdmins: number;
    sessionSecretSet: boolean;
  };
  email: {
    enabled: boolean;
    missing: string[];
    host: string;
    port: number;
    security: "none" | "starttls" | "ssl";
    from: string;
    user: string;
    passwordSet: boolean;
  };
  mattermost: { enabled: boolean; url: string; tokenSet: boolean };
  git: { hosts: string[]; sshKey: boolean };
}

const SECURITY = { none: "None (plain SMTP)", starttls: "STARTTLS", ssl: "SSL/TLS from the start" } as const;
const unset = <span className="text-cinder">Not set</span>;
const mono = (v: string) => <span className="mono">{v}</span>;

// SiteSettingsPage shows the server's settings. They come from its
// environment, so the page only reads them.
export function SiteSettingsPage() {
  const { data, error } = useApi<SiteSettings>("/site/settings");
  return (
    <Layout nav="site">
      <PageHeader
        before={
          <Link to="/" className="inline-flex items-center gap-2 text-xs text-cinder no-underline">
            <ArrowLeft aria-hidden="true" />
            Back to issues
          </Link>
        }
        title="Global settings"
        after={<p className="mt-2 text-sm text-cinder">Settings for this Burning server. They come from its environment variables and are read-only here.</p>}
        spaceBelow="mb-8"
      />
      {!data ? (
        error ? (
          <p role="alert" className="text-ember-ink">
            {error}
          </p>
        ) : (
          <Loading />
        )
      ) : (
        <div className="grid gap-10">
          <SignInSection s={data.signIn} />
          <EmailSection email={data.email} />
          <MattermostSection mm={data.mattermost} />
          <GitSection git={data.git} />
        </div>
      )}
    </Layout>
  );
}

function SignInSection({ s }: { s: SiteSettings["signIn"] }) {
  const methods = [s.password.enabled && "passwords", s.oidc.enabled && "OIDC"].filter(Boolean).join(" and ");
  return (
    <Section id="signin" icon={<KeyRound aria-hidden="true" />} title="Sign-in" hint="How people sign in. Either way can be on, or both." status={methods ? `On: ${methods}` : "Off"} on={!!methods}>
      <dl className="m-0 divide-y divide-rule overflow-hidden rounded-card border border-rule bg-ash">
        <Row label="Passwords" env="BURNING_PASSWORD_FILE">
          {s.password.enabled ? <>{mono(s.password.file)}<span className="text-cinder">, one email:hash[:groups] per line</span></> : <span className="text-cinder">Off</span>}
        </Row>
        <Row label="OIDC issuer" env="BURNING_OIDC_ISSUER">{s.oidc.enabled ? mono(s.oidc.issuer) : <span className="text-cinder">Off</span>}</Row>
        {s.oidc.enabled && (
          <>
            <Row label="Client" env="BURNING_OIDC_CLIENT_ID, BURNING_OIDC_CLIENT_AUTH">
              {mono(s.oidc.clientId)}
              <span className="text-cinder">
                {" "}
                · {s.oidc.clientAuth || "unknown"}
                {s.oidc.clientAuth !== "none" && (s.oidc.secretSet ? ", secret set" : ", no secret")}
              </span>
            </Row>
            <Row label="Redirect URL" env="BURNING_OIDC_REDIRECT_URL">{s.oidc.redirectURL ? mono(s.oidc.redirectURL) : unset}</Row>
            <Row label="Scope and groups" env="BURNING_OIDC_SCOPE, BURNING_OIDC_GROUPS_CLAIM">
              {mono(s.oidc.scope)}
              <span className="text-cinder"> · groups from the </span>
              {mono(s.oidc.groupsClaim)}
              <span className="text-cinder"> claim</span>
            </Row>
            <Row label="Button" env="BURNING_OIDC_NAME">Sign in with {s.oidc.name}</Row>
          </>
        )}
        <Row label="Site admins" env="BURNING_SITE_ADMINS">
          {s.siteAdmins ? `${s.siteAdmins} ${s.siteAdmins === 1 ? "entry" : "entries"}, admin on every project` : <span className="text-cinder">None. Projects are managed by their own admins.</span>}
        </Row>
        <Row label="Session secret" env="BURNING_SESSION_SECRET">{s.sessionSecretSet ? "Set" : <span className="text-cinder">Not set: a random one kept in the database</span>}</Row>
      </dl>
    </Section>
  );
}

function EmailSection({ email }: { email: SiteSettings["email"] }) {
  return (
    <Section id="email" icon={<Mail aria-hidden="true" />} title="Email" hint="The server that sends alert email to people and addresses." status={email.enabled ? "Sending" : "Off"} on={email.enabled}>
      {!email.enabled && (
        <p className="mb-4 rounded-card border border-rule bg-smoke px-4 py-3 text-[13px] text-cinder">
          No alert email is sent until these are set: <span className="mono">{email.missing.join(", ")}</span>.
        </p>
      )}
      <dl className="m-0 divide-y divide-rule overflow-hidden rounded-card border border-rule bg-ash">
        <Row label="SMTP server" env="BURNING_SMTP_HOST, BURNING_SMTP_PORT">{email.host ? mono(`${email.host}:${email.port}`) : unset}</Row>
        <Row label="Security" env="BURNING_SMTP_TLS, BURNING_SMTP_SSL">{SECURITY[email.security]}</Row>
        <Row label="From" env="BURNING_SMTP_FROM">{email.from || unset}</Row>
        <Row label="Sign-in" env="BURNING_SMTP_USER, BURNING_SMTP_PASSWORD">
          {email.user ? (
            <>
              {email.user}
              <span className="text-cinder">{email.passwordSet ? ", password set" : ", no password"}</span>
            </>
          ) : (
            <span className="text-cinder">None. The server accepts mail without signing in.</span>
          )}
        </Row>
      </dl>
    </Section>
  );
}

function MattermostSection({ mm }: { mm: SiteSettings["mattermost"] }) {
  return (
    <Section
      id="mm"
      icon={<MessageCircle aria-hidden="true" />}
      title="Mattermost"
      hint="A bot that sends direct messages to people and posts in channels. Add the bot to a channel before routing alerts there."
      status={mm.enabled ? "Sending" : "Off"}
      on={mm.enabled}
    >
      <dl className="m-0 divide-y divide-rule overflow-hidden rounded-card border border-rule bg-ash">
        <Row label="Server" env="BURNING_MATTERMOST_URL">{mm.url ? mono(mm.url) : unset}</Row>
        <Row label="Bot token" env="BURNING_MATTERMOST_TOKEN">{mm.tokenSet ? "Set" : unset}</Row>
      </dl>
    </Section>
  );
}

function GitSection({ git }: { git: SiteSettings["git"] }) {
  const on = git.hosts.length > 0 || git.sshKey;
  return (
    <Section id="git" icon={<Code aria-hidden="true" />} title="Code access" hint="How projects' code sources are read. Public repositories need nothing." status={on ? "Set" : "Public only"} on={on}>
      <dl className="m-0 divide-y divide-rule overflow-hidden rounded-card border border-rule bg-ash">
        <Row label="Tokens" env="BURNING_GIT_CREDENTIALS">{git.hosts.length ? mono(git.hosts.join(", ")) : unset}</Row>
        <Row label="SSH key" env="BURNING_GIT_SSH_KEY">{git.sshKey ? "Set" : unset}</Row>
      </dl>
    </Section>
  );
}

function Section({ id, icon, title, hint, status, on, children }: { id: string; icon: ReactNode; title: string; hint: string; status: string; on: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-control border border-rule bg-smoke text-cinder">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-title`} className="text-lg">
            {title}
          </h2>
          <p className="text-xs text-cinder">{hint}</p>
        </div>
        <span className={`rounded-control px-2.5 py-0.5 text-xs font-medium ${on ? "bg-doused-soft text-doused" : "bg-rule-soft text-cinder"}`}>{status}</span>
      </div>
      {children}
    </section>
  );
}

function Row({ label, env, children }: { label: string; env: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-5 py-3.5 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-6">
      <dt>
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="mono block text-[11px] text-cinder">{env}</span>
      </dt>
      <dd className="m-0 self-center text-[13px] wrap-anywhere">{children}</dd>
    </div>
  );
}
