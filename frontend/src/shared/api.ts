import useSWR from "swr";

export interface Issue {
  id: number;
  projectId: number;
  projectName?: string;
  title: string;
  culprit: string;
  level: string;
  platform: string;
  firstSeen: number;
  lastSeen: number;
  eventCount: number;
  hours: number[];
}

export type Role = "viewer" | "member" | "admin";

export interface ProjectRef {
  id: number;
  name: string;
  role?: Role | null;
}

export interface Project extends ProjectRef {
  publicKey: string;
  createdAt: number;
  dsn: string;
}

export interface ProjectSummary extends ProjectRef {
  openCount: number;
  unresolvedDay: number;
  createdAt: number;
}

// ProjectPulse says whether a project is still reporting.
export interface ProjectPulse {
  lastEvent: number; // 0 when it never had one
  release: string; // newest release, "" when none
  releaseSeen: number;
}

export interface Board {
  project: (ProjectRef & { pulse: ProjectPulse }) | null;
  projects: ProjectSummary[];
  issues: Issue[];
  filter: { sort: string; query: string };
  counts: { open: number };
  burning: number;
  events: { day: number; hour: number };
  openTotal: number;
}

export interface FrameView {
  location: string;
  function: string;
  lineno: number;
  inApp: boolean;
  lines: { no: number; text: string; current: boolean }[];
  vars: [string, string][];
}

export interface EventView {
  id: number;
  eventId: string;
  receivedAt: number;
  release: string;
  environment: string;
  serverName: string;
  platform: string;
  sdk: string;
  message: string;
  tags: [string, string][];
  exceptions: { type: string; value: string; handled: string; frames: FrameView[] }[];
  breadcrumbs: { timestamp: number | null; category: string; level: string; message: string; data: string }[];
  context: [string, string][];
  raw: string;
}

export type EventRow = { id: number; eventId: string; receivedAt: number; release: string; environment: string };
export type EventPage = { events: EventRow[]; more: boolean };

export interface IssueDetail {
  project: ProjectRef;
  issue: Issue;
  releases: { release: string; environment: string; eventCount: number; lastSeen: number }[];
  events: EventRow[];
  moreEvents: boolean;
  storedEvents: number;
  event: EventView | null;
}

export interface Session {
  methods: { oidc: boolean; oidcName: string; password: boolean }; // how to sign in, as configured on the backend
  user: { email: string; name: string; groups: string[]; username: string; displayName: string } | null;
}

// Profile is what Burning keeps about the signed-in person.
export interface Profile {
  email: string;
  username: string; // preferred_username
  name: string; // name claim
  displayName: string; // their own choice; empty means the username
  shownAs: string;
  groups: string[];
  issuer: string;
  subject: string;
  tokenExpires: number; // Unix seconds
  firstLogin: number;
  lastLogin: number;
  claims: [string, string][];
}

export interface Grant {
  kind: "user" | "group";
  subject: string;
  role: Role;
  createdAt: number;
  name: string; // display name of a user who has signed in; empty for groups
}

export interface ProjectSettings {
  project: ProjectRef & { createdAt: number };
  dsn: string;
  grants: Grant[];
  roles: Role[];
}

// ---- Notifications ----

export type MatchOp = "=" | "!=" | "=~" | "!~" | "value" | "empty" | "!value" | "absent" | "!absent";
export interface Matcher { field: string; op: MatchOp; value: string }
export type ReceiverKind = "user" | "email" | "mattermost" | "webhook" | "mattermost_dm";
export interface Receiver { kind: ReceiverKind; target: string }
export interface Route { name: string; matchers: Matcher[]; sink: boolean; receivers: Receiver[]; continue: boolean }

export interface Routing {
  project: ProjectRef;
  routes: Route[];
  defaultRecipients: { email: string; name: string }[];
  names: Record<string, string>; // display names of the people in the routes, by email
  fields: string[];
  ops: MatchOp[];
  receiverKinds: ReceiverKind[];
  email: boolean; // email is set up on the server
  mattermost: boolean; // the Mattermost bot is set up
}

// PersonalRouting is how alerts that reach this person are delivered.
export interface PersonalRouting {
  routes: Route[];
  initial: boolean; // never saved: the starting route
  fields: string[];
  ops: MatchOp[];
  receiverKinds: ReceiverKind[];
  email: boolean;
  mattermost: boolean;
  address: string;
}

/** Kinds the server cannot send: routes using them get a warning. */
export function unavailableKinds(r: { email: boolean; mattermost: boolean }): ReceiverKind[] {
  return [...(r.email ? [] : (["email"] as const)), ...(r.mattermost ? [] : (["mattermost", "mattermost_dm"] as const))];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// signIn sends the browser to the sign-in page, then back here.
export function signIn(): void {
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 401) {
    signIn();
    throw new ApiError(401, "Sign in first.");
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as T & { detail?: string };
  if (!res.ok) throw new ApiError(res.status, data.detail ?? `Request failed (${res.status}).`);
  return data;
}

// useApi loads a path and reloads it on demand or every refreshMs, so the
// board and issue pages follow new events without a page refresh.
export function useApi<T>(path: string | null, refreshMs = 0) {
  const { data, error, mutate } = useSWR<T>(path, (key: string) => api<T>(key), {
    refreshInterval: refreshMs,
  });
  return {
    data: data ?? null,
    error: error instanceof Error ? error.message : "",
    reload: () => {
      void mutate();
    },
  };
}
