import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { mutate } from "swr";
import { LangSwitch } from "../components/LangSwitch";
import { Layout } from "../components/Layout";
import { Logo } from "../components/Logo";
import { useApi, type Session } from "../shared/api";
import { input } from "../shared/ui";
import { Button } from "../ui/components/Button";
import { ArrowRight, Shield, TriangleAlert } from "../ui/icons";

const safe = (next: string) => (next.startsWith("/") && !next.startsWith("//") ? next : "/");

// LoginPage offers the ways to sign in the backend has configured: a
// password form, a single sign-on button, or both. With neither, it says so.
export function LoginPage() {
  const [params] = useSearchParams();
  const next = safe(params.get("next") || "/");
  const { data: session, error } = useApi<Session>("/session");
  const navigate = useNavigate();
  useEffect(() => {
    if (session?.user) navigate(next);
  }, [session, next, navigate]);
  const methods = session?.methods;
  const none = methods && !methods.oidc && !methods.password;
  return (
    <Layout nav="login">
      <div className="grid min-h-dvh lg:grid-cols-2">
        <section className="flex flex-col justify-between border-b border-rule bg-smoke p-8 lg:border-r lg:border-b-0 lg:p-16">
          <Logo size="lg" tagline={false} />
          <div className="max-w-[480px] py-12 lg:py-20">
            <h1 className="text-4xl leading-[1.15] font-semibold tracking-tight sm:text-5xl">Something's burning.</h1>
            <p className="mt-6 max-w-[34ch] text-lg leading-relaxed text-cinder">Find the error. Follow the trace. Get back to building.</p>
            <div className="mt-12 grid h-12 grid-cols-24 gap-1.5" aria-hidden="true">
              {Array.from({ length: 24 }, (_, i) => (
                <span key={i} className={`rounded-[3px] ${i > 15 && i < 20 ? "bg-heat-4" : i > 12 && i < 22 ? "bg-heat-2" : "bg-rule"}`} />
              ))}
            </div>
          </div>
          <p className="text-xs text-cinder">Error tracking for your services. Powered by Sentry SDKs.</p>
        </section>
        <section className="flex items-center justify-center px-8 py-16 lg:p-16">
          <div className="w-full max-w-[360px]">
            <div className="mb-6 flex justify-end"><LangSwitch /></div>
            <h2 className="text-2xl">Sign in to Burning</h2>
            {error && (
              <p role="alert" className="mt-4 text-sm text-ember-ink">
                {error}
              </p>
            )}
            {none && <NotConfigured />}
            {methods && !none && (
              <>
                <p className="mt-3 mb-8 text-sm leading-relaxed text-cinder">Review errors across your projects and pick up where you left off.</p>
                {methods.password && <PasswordForm next={next} />}
                {methods.password && methods.oidc && (
                  <div className="my-6 flex items-center gap-3 text-xs text-cinder" aria-hidden="true">
                    <span className="h-px flex-1 bg-rule" />
                    or
                    <span className="h-px flex-1 bg-rule" />
                  </div>
                )}
                {methods.oidc && (
                  <>
                    <form method="post" action="/auth/oidc">
                      <input type="hidden" name="next" value={next} />
                      <Button variant={methods.password ? "secondary" : "primary"} type="submit" className="w-full">
                        Sign in with {methods.oidcName}
                        <ArrowRight aria-hidden="true" />
                      </Button>
                    </form>
                    <p className="mt-5 flex items-center justify-center gap-2 text-xs text-cinder">
                      <Shield aria-hidden="true" />
                      Single sign-on with OpenID Connect
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </Layout>
  );
}

// PasswordForm signs in with an email and password from the backend's accounts file.
function PasswordForm({ next }: { next: string }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      const res = await fetch("/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? `Sign-in failed (${res.status}).`);
      }
      await mutate("/session");
      navigate(next);
    } catch (err) {
      setProblem((err as Error).message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="grid gap-3" onSubmit={submit}>
      <label className="grid gap-1.5 text-xs font-medium">
        Email
        <input className={`${input} h-10`} type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="grid gap-1.5 text-xs font-medium">
        Password
        <input className={`${input} h-10`} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {problem && (
        <p role="alert" className="text-xs text-ember-ink">
          {sentenceCase(problem)}
        </p>
      )}
      <Button variant="primary" type="submit" className="mt-2 w-full" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".");

// NotConfigured is shown when the backend has no way to sign in.
function NotConfigured() {
  return (
    <div role="alert" className="mt-6 rounded-card border border-rule bg-smoke p-5">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <TriangleAlert className="text-ember-ink" aria-hidden="true" />
        Please configure auth in the backend
      </p>
      <p className="mt-3 text-xs leading-relaxed text-cinder">
        Set <span className="mono text-soot">BURNING_PASSWORD_FILE</span> for email and password sign-in, or{" "}
        <span className="mono text-soot">BURNING_OIDC_ISSUER</span> and the other <span className="mono text-soot">BURNING_OIDC_*</span> settings for
        single sign-on. Both can be on. See <span className="mono text-soot">backend/.env.example</span>, then restart the backend.
      </p>
    </div>
  );
}
