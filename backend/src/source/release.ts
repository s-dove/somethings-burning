import type { ReleaseKind } from "./config.js";

export interface RefCandidate {
  ref: string; // a commit, tag, or branch name to try
  how: string; // shown in the settings test: why this ref was tried
}

const HEX = /^[0-9a-f]{7,40}$/i;

// splitRelease drops the package prefix the Sentry docs recommend
// ("payments-api@2.15.0+3e7cbf4" or "@scope/pkg@1.2.0") and splits off
// build metadata after "+".
export function splitRelease(release: string): { version: string; base: string; build: string } {
  const version = /^(.+?)@(.+)$/.exec(release)?.[2] ?? release;
  const plus = version.indexOf("+");
  return plus < 0 ? { version, base: version, build: "" } : { version, base: version.slice(0, plus), build: version.slice(plus + 1) };
}

// Commits written into the release itself: after "+", the whole version,
// or git describe's "-g<sha>".
function commitsIn(release: string): RefCandidate[] {
  const { version, base, build } = splitRelease(release);
  const out: RefCandidate[] = [];
  if (HEX.test(build)) out.push({ ref: build, how: "commit after + in the release" });
  if (HEX.test(version)) out.push({ ref: version, how: "the release is a commit" });
  const described = /-g([0-9a-f]{7,40})(?:-dirty)?$/i.exec(base)?.[1];
  if (described) out.push({ ref: described, how: "commit from git describe" });
  return out;
}

// refCandidates lists the refs to try for an event, in order, under one
// release rule. The caller tries each and falls back to the branch.
export function refCandidates(rule: { kind: ReleaseKind; value: string }, release: string, tags: [string, string][]): RefCandidate[] {
  const { base } = splitRelease(release);
  const vtag = base.startsWith("v") ? base : `v${base}`;
  let out: RefCandidate[] = [];
  switch (rule.kind) {
    case "auto":
      if (!release) break;
      out = [...commitsIn(release), { ref: base, how: "tag named like the release" }, { ref: vtag, how: "tag v + version" }];
      break;
    case "sha":
      out = commitsIn(release);
      break;
    case "tag":
      if (base) out = [{ ref: base, how: "tag named like the release" }];
      break;
    case "vtag":
      if (base) out = [{ ref: vtag, how: "tag v + version" }];
      break;
    case "template":
      if (base) out = [{ ref: rule.value.replaceAll("{version}", base.replace(/^v/, "")), how: `tag from ${rule.value}` }];
      break;
    case "event_tag": {
      const v = tags.find(([k]) => k === rule.value)?.[1];
      if (v) out = [{ ref: v, how: `event tag ${rule.value}` }];
      break;
    }
    case "regex": {
      let m: RegExpExecArray | null = null;
      try {
        m = new RegExp(rule.value).exec(release);
      } catch {
        m = null;
      }
      if (m?.[1]) out = [{ ref: m[1], how: "matched by the release regex" }];
      break;
    }
    case "branch":
      break;
  }
  // Refs reach git and URLs: keep to what git allows, and drop repeats.
  const seen = new Set<string>();
  return out.filter((c) => /^[\w./-]+$/.test(c.ref) && !c.ref.startsWith("-") && !c.ref.includes("..") && !seen.has(c.ref) && !!seen.add(c.ref));
}
