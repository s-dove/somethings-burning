import type { SentryEvent } from "./event.js";

// Data scrubbing: before an event is stored, values that look secret are
// replaced with "[Filtered]". Two kinds of check:
//
// - by key: a field whose name says it holds a secret (password, token,
//   Authorization, cookie, ...), anywhere in the event: request headers,
//   cookies, body, query, extra, contexts, breadcrumb data, local variables.
// - by value: card numbers (that pass the Luhn check), "Bearer ..." tokens,
//   and JWTs, in any string, whatever its key.
//
// A project can add field names of its own; they match anywhere in a key.

export const FILTERED = "[Filtered]";

const SECRET_KEY =
  /(^|[-_.\s])(pass(word|wd|phrase)?|secret|token|api[-_]?key|apikey|access[-_]?key|auth(orization)?|credentials?|cookies?|set[-_]?cookie|session([-_]?id)?|csrf|xsrf|private[-_]?key|card([-_]?number)?|cvv|cvc|ssn)($|[-_.\s])/i;

// Stack frame fields are code, not data: their keys are never secret.
const CODE_KEYS = new Set(["filename", "abs_path", "module", "function", "context_line", "pre_context", "post_context", "lineno", "colno", "in_app", "platform"]);

const BEARER = /\b(bearer|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

export function scrubValue(s: string, defaults = true): string {
  if (!defaults) return s;
  return s
    .replace(BEARER, (m, kind: string) => `${kind} ${FILTERED}`)
    .replace(JWT, FILTERED)
    .replace(CARD, (m) => {
      const d = m.replace(/[ -]/g, "");
      return d.length >= 13 && d.length <= 19 && luhn(d) ? FILTERED : m;
    });
}

export interface ScrubSettings {
  defaults: boolean;
  fields: string[]; // extra field names, lowercase, matched anywhere in a key
}

/** A copy of the event with secrets replaced. The original is left alone. */
export function scrubEvent(ev: SentryEvent, s: ScrubSettings): SentryEvent {
  const extra = s.fields.map((f) => f.toLowerCase());
  const secretKey = (key: string) => (s.defaults && SECRET_KEY.test(key)) || extra.some((f) => key.toLowerCase().includes(f));

  const walk = (v: unknown, key: string, depth: number): unknown => {
    if (depth > 20) return v;
    if (CODE_KEYS.has(key)) return v;
    if (key && secretKey(key) && v !== null && v !== undefined && v !== "") return typeof v === "object" ? FILTERED : FILTERED;
    if (typeof v === "string") return scrubValue(v, s.defaults);
    if (Array.isArray(v)) {
      // Headers and cookies may come as [name, value] pairs.
      if (v.length === 2 && typeof v[0] === "string" && typeof v[1] !== "object" && secretKey(v[0])) return [v[0], FILTERED];
      return v.map((x) => walk(x, "", depth + 1));
    }
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x, k, depth + 1);
      return out;
    }
    return v;
  };

  const out = walk(ev, "", 0) as SentryEvent;
  // A query string is one string: filter its secret parameters by name.
  const req = out.request as { query_string?: unknown } | undefined;
  if (req && typeof req.query_string === "string") {
    req.query_string = req.query_string
      .split("&")
      .map((pair) => {
        const [k, ...rest] = pair.split("=");
        return k && rest.length && secretKey(decodeURIComponent(k)) ? `${k}=${FILTERED}` : pair;
      })
      .join("&");
  }
  return out;
}
