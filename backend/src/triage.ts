// An issue is open, resolved, or muted.
//
// Resolving says everything that fired so far is handled: the next event
// fires the issue again. Muting keeps counting events without alerting, for a
// while: a fixed time, until a release that was not seen before the mute, or
// until someone unmutes it.

export const MuteFor = "for"; // until mute_until
export const MuteNextRelease = "release"; // until an event from a release first seen after the mute
export const MuteIndefinite = "forever"; // until someone unmutes it

export interface MuteOption {
  value: string;
  label: string;
  kind: string;
  durationMs: number;
}

const HOUR = 3_600_000;
export const MUTE_OPTIONS: MuteOption[] = [
  { value: "1h", label: "1 hour", kind: MuteFor, durationMs: HOUR },
  { value: "1d", label: "1 day", kind: MuteFor, durationMs: 24 * HOUR },
  { value: "1w", label: "1 week", kind: MuteFor, durationMs: 7 * 24 * HOUR },
  { value: "release", label: "Next release", kind: MuteNextRelease, durationMs: 0 },
  { value: "forever", label: "Until unmuted", kind: MuteIndefinite, durationMs: 0 },
];

export const muteOption = (value: string): MuteOption | undefined => MUTE_OPTIONS.find((o) => o.value === value);

export interface Mute {
  kind: string;
  until: number; // unix ms, for MuteFor
  mutedAt: number; // unix ms
}

// muteSummary describes the mute as shown in the UI.
export function muteSummary(m: Mute, now: number): string {
  switch (m.kind) {
    case MuteFor: {
      const left = m.until - now;
      return left <= 0 ? "mute ending" : `muted for ${humanDuration(left)} more`;
    }
    case MuteNextRelease:
      return "muted until a new release reports it";
  }
  return "muted until unmuted";
}

// muteBroken decides whether an event ends a mute early: an event from a
// release first seen after the mute ends a "next release" mute. A release that
// was already running when the issue was muted does not.
export function muteBroken(m: Mute, release: string, releaseFirstSeen: number): string | null {
  if (m.kind !== MuteNextRelease || !release || releaseFirstSeen <= m.mutedAt) return null;
  return `An event arrived from release ${release}, which is newer than the mute`;
}

export const muteExpired = (m: Mute, now: number): boolean => m.kind === MuteFor && m.until > 0 && now >= m.until;

export function plural(n: number, word: string): string {
  return n === 1 ? `1 ${word}` : `${n} ${word}s`;
}

// humanDuration rounds up: it describes time left on a mute.
export function humanDuration(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (ms < 60_000) return "less than a minute";
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.ceil(ms / HOUR);
  if (hours < 48) return plural(hours, "hour");
  return plural(Math.ceil(ms / (24 * HOUR)), "day");
}
