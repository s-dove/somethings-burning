import useSWR from "swr";

export interface Mute {
  kind: string; // "for" (until), "release" (next release), "forever"
  until: number;
  mutedAt: number;
}

export interface Issue {
  id: number;
  projectId: number;
  projectName?: string;
  role?: Role;
  title: string;
  culprit: string;
  level: string;
  platform: string;
  status: "open" | "resolved" | "muted";
  resolvedAt: number;
  mute: Mute;
  reopenReason: string;
  assignee: string; // email, "" for no one
  externalUrl: string; // a GitHub issue made from it, "" for none
  firstSeen: number;
  lastSeen: number;
  eventCount: number;
  hours: number[];
}

export type MuteOptions = { value: string; label: string }[];

export type Role = "viewer" | "member" | "admin";

// canTriage is true for members and admins. Viewers only read.
export const canTriage = (role?: Role | null): boolean => role === "member" || role === "admin";

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

export interface Suspects {
  from: { release: string; sha: string };
  to: { release: string; sha: string };
  repo: string;
  compareUrl: string;
  files: { path: string; status: string }[];
  commits: { sha: string; message: string; author: string; url: string }[];
}

export interface ReleaseSummary {
  version: string;
  firstSeen: number;
  commit: string;
  events: number;
  issues: number;
  newIssues: number;
  regressions: number;
  deploys: { environment: string; url: string; at: number }[];
}

export interface Artifact {
  release: string;
  name: string;
  size: number;
  createdAt: number;
}

export interface TokenView {
  id: number;
  name: string;
  prefix: string;
  createdBy: string;
  createdAt: number;
  lastUsed: number;
}

export interface Board {
  project: (ProjectRef & { pulse: ProjectPulse }) | null;
  projects: ProjectSummary[];
  issues: Issue[];
  filter: { status: string; sort: string; query: string; release?: string };
  counts: Record<string, number>; // open, resolved, muted, all
  burning: number;
  events: { day: number; hour: number };
  openTotal: number;
  muteOptions: MuteOptions;
}

export interface FrameView {
  location: string;
  function: string;
  lineno: number;
  inApp: boolean;
  lines: { no: number; text: string; current: boolean }[];
  vars: [string, string][];
  link: string; // the line in the repository, "" when no code source covers it
  linesFrom: string; // "repo@sha" when the lines were read from a code source
  mapped: string; // the minified location a source map turned into this one
  changed: string; // added, modified, removed since the previous release
}

export interface EventView {
  id: number;
  eventId: string;
  receivedAt: number;
  release: string;
  environment: string;
  serverName: string;
  level: string; // as the SDK sent it; "" when it did not
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

export interface IssueComment {
  id: number;
  author: string;
  body: string;
  createdAt: number;
  editedAt: number; // 0 when never edited
  authorName: string; // display name
  authorUsername: string; // for @mentions
  canEdit: boolean;
  canDelete: boolean;
}

export interface IssueDetail {
  project: ProjectRef;
  issue: Issue;
  activity: { at: number; kind: string; text: string; release: string; environment: string; actor: string; actorName: string }[];
  comments: IssueComment[];
  muteOptions: MuteOptions;
  latestRelease: string;
  tags: { key: string; total: number; values: { value: string; count: number }[] }[];
  users: number;
  merged: { fingerprint: string; title: string; mergedAt: number; events: number }[];
  suspects: Suspects | null;
  github: boolean;
  githubIssues: { url: string; at: number; by: string }[];
  releases: { release: string; environment: string; eventCount: number; lastSeen: number }[];
  events: EventRow[];
  moreEvents: boolean;
  storedEvents: number;
  event: EventView | null;
}

export type RuleField = "path" | "type" | "message" | "culprit" | "tag";

export interface OwnerRule {
  field: RuleField;
  tag?: string;
  pattern: string;
  owner: string;
}

export interface GroupingRule {
  field: RuleField;
  tag?: string;
  pattern: string;
  fingerprint: string;
}

export interface ProjectConfig {
  owners: OwnerRule[];
  grouping: GroupingRule[];
  scrub: { defaults: boolean; fields: string[] };
}

export interface ConfigView {
  project: ProjectRef;
  config: ProjectConfig;
}

export interface Session {
  methods: { oidc: boolean; oidcName: string; password: boolean }; // how to sign in, as configured on the backend
  user: { email: string; name: string; groups: string[]; username: string; displayName: string; lang: string } | null;
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
export type ReceiverKind = "user" | "assignee" | "email" | "mattermost" | "slack" | "webhook" | "mattermost_dm";
export interface Receiver { kind: ReceiverKind; target: string }
export interface Spike { events: number; factor: number }
export interface Route { name: string; matchers: Matcher[]; sink: boolean; receivers: Receiver[]; continue: boolean; spike?: Spike }

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

// ---- Code sources ----

export type SourceKind = "github" | "git";
export type ReleaseKind = "auto" | "sha" | "tag" | "vtag" | "template" | "event_tag" | "regex" | "branch";
export interface Mapping { prefix: string; dir: string }
export interface SourceConfig {
  kind: SourceKind;
  repo: string;
  branch: string;
  mappings: Mapping[];
  release: { kind: ReleaseKind; value: string };
  primary: boolean;
  context: string;
  web: string;
}
export interface SourcesView {
  project: ProjectRef;
  sources: SourceConfig[];
  releaseKinds: ReleaseKind[];
  hosts: string[];
  sshKey: boolean;
}
export interface SourcesTest {
  event: { issueId: number; eventId: string; release: string } | null;
  sources: { sha: string; ref: string; how: string; error: string }[];
  frames: { location: string; line: number; source: number | null; path: string; found: boolean | null; link: string }[];
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
