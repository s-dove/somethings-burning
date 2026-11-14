import { useCallback, useEffect, useState } from "react";

export type ProjectSummary = {
  id: number;
  name: string;
  publicKey: string;
  createdAt: string;
  issueCount: number;
  eventCount: number;
  lastSeen: string | null;
};

export type Project = { id: number; name: string; publicKey: string; createdAt: string; dsn: string };

export type Issue = {
  id: number;
  projectId: number;
  title: string;
  culprit: string;
  level: string;
  platform: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
};

export type Frame = {
  filename?: string;
  abs_path?: string;
  module?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
};

export type ExceptionValue = { type?: string; value?: string; stacktrace?: { frames?: Frame[] } };

export type SentryEvent = {
  event_id?: string;
  timestamp?: number | string;
  level?: string;
  platform?: string;
  environment?: string;
  release?: string;
  server_name?: string;
  message?: string | { formatted?: string; message?: string };
  logentry?: { formatted?: string; message?: string };
  exception?: { values?: ExceptionValue[] } | ExceptionValue[];
  tags?: Record<string, string> | [string, string][];
  [key: string]: unknown;
};

export type StoredEvent = { id: number; eventId: string; receivedAt: string; payload: SentryEvent };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Fetches `path`, refetching every `refreshMs` (0 to fetch once). */
export function useApi<T>(path: string | null, refreshMs = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    if (!path) return;
    api<T>(path)
      .then((d) => {
        setData(d);
        setError(undefined);
      })
      .catch((e: Error) => setError(e.message));
  }, [path]);

  useEffect(() => {
    load();
    if (!refreshMs) return;
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);

  return { data, error, reload: load };
}
