// The web app's own errors go to Burning (or any Sentry server) when the
// backend sets BURNING_SENTRY_WEB_DSN: it puts the settings in a meta tag in
// index.html. The SDK is loaded only then.
export function startSentry(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="burning-sentry"]');
  if (!meta) return;
  let s: { dsn?: string; environment?: string; release?: string };
  try {
    s = JSON.parse(meta.content);
  } catch {
    return;
  }
  if (!s.dsn) return;
  void import("@sentry/browser").then((Sentry) =>
    Sentry.init({ dsn: s.dsn, environment: s.environment, release: s.release || undefined }),
  );
}
