import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

// Password sign-in reads its accounts from a file, one per line:
//
//   email:scrypt-hash[:group,group]
//
// Blank lines and lines starting with # are skipped. The file is read at
// every sign-in, so edits apply without a restart. Make a hash with
// `pnpm --filter backend hash-password`.

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

/** scrypt$N$r$p$salt$hash, base64. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4]!, "base64");
  const want = Buffer.from(parts[5]!, "base64");
  if (!n || !r || !p || want.length === 0) return false;
  const got = scryptSync(password, salt, want.length, { N: n, r, p, maxmem: 256 * n * r });
  return timingSafeEqual(got, want);
}

export interface Account {
  email: string;
  hash: string;
  groups: string[];
}

export function parseAccounts(body: string): Account[] {
  const out: Account[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [email, hash, groups] = line.split(":");
    if (!email || !hash) continue;
    out.push({
      email: email.trim().toLowerCase(),
      hash: hash.trim(),
      groups: (groups ?? "").split(",").map((g) => g.trim()).filter(Boolean),
    });
  }
  return out;
}

// Checked against when the email is unknown, so a wrong email takes as long
// as a wrong password.
const DUMMY = hashPassword(randomBytes(16).toString("hex"));

/** PasswordLogin checks an email and password against the accounts file. */
export class PasswordLogin {
  private failures = new Map<string, { count: number; since: number }>();

  constructor(private file: string) {
    readFileSync(file, "utf8"); // fail at startup when the file is missing
  }

  private static readonly MAX_FAILURES = 5;
  private static readonly WINDOW_MS = 15 * 60_000;

  /** True when this email has failed too often lately. */
  locked(email: string, now = Date.now()): boolean {
    const f = this.failures.get(email);
    if (f && now - f.since > PasswordLogin.WINDOW_MS) this.failures.delete(email);
    return (this.failures.get(email)?.count ?? 0) >= PasswordLogin.MAX_FAILURES;
  }

  /** The account, or null when the email or password is wrong. */
  verify(emailInput: string, password: string, now = Date.now()): Account | null {
    const email = emailInput.trim().toLowerCase();
    const account = parseAccounts(readFileSync(this.file, "utf8")).find((a) => a.email === email);
    const ok = verifyPassword(password, account?.hash ?? DUMMY) && !!account;
    if (ok) {
      this.failures.delete(email);
      return account!;
    }
    const f = this.failures.get(email) ?? { count: 0, since: now };
    this.failures.set(email, { count: f.count + 1, since: f.since });
    return null;
  }
}
