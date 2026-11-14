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

export interface ProjectRef {
  id: number;
  name: string;
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

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
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
