import * as Sentry from "@sentry/node";

/**
 * Burning's own errors, sent with the Sentry SDK like any app's: to a project
 * on this server or on another Burning. Off unless BURNING_SENTRY_DSN is set.
 */
export interface SelfReportSettings {
  dsn: string; // where the backend's errors go
  webDSN: string; // where the web app's errors go (it is handed to the page)
  environment: string;
  release: string; // set in the image at build time
}

let on = false;
let own: { host: string; project: string } | null = null;

/** Starts the SDK. `baseURL` is this server's address, to tell its own project apart. */
export function startSelfReport(s: SelfReportSettings, baseURL: string): void {
  if (!s.dsn) return;
  Sentry.init({
    dsn: s.dsn,
    environment: s.environment,
    release: s.release || undefined,
    // No tracing: only errors.
    enableOpenTelemetrySetup: false,
  });
  on = true;
  own = ownProject(s.dsn, baseURL);
  console.log(`own errors go to ${new URL(s.dsn).host}, project ${new URL(s.dsn).pathname.replace(/^\//, "")}`);
}

/**
 * The project the DSN points at, when it is on this server: then a failure
 * handling its events is not reported, or one bad event would report itself
 * again and again. With no BURNING_BASE_URL, any host counts as this one.
 */
export function ownProject(dsn: string, baseURL: string): { host: string; project: string } | null {
  try {
    const u = new URL(dsn);
    const project = u.pathname.split("/").filter(Boolean).pop() ?? "";
    const host = baseURL ? new URL(baseURL).host : "";
    if (host && host !== u.host) return null;
    return { host, project };
  } catch {
    return null;
  }
}

/** Reports `err`, unless it came from handling an event of Burning's own project. */
export function selfReport(err: unknown, opts: { projectId?: number | string } = {}): void {
  if (!on) return;
  if (own && opts.projectId !== undefined && String(opts.projectId) === own.project) return;
  Sentry.captureException(err);
}

/** The page's settings, for a meta tag in index.html; empty with no web DSN. */
export function webSettingsTag(s: SelfReportSettings): string {
  if (!s.webDSN) return "";
  const json = JSON.stringify({ dsn: s.webDSN, environment: s.environment, release: s.release });
  const attr = json.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<meta name="burning-sentry" content="${attr}" />`;
}
