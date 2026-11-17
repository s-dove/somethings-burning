import type { Db } from "./db.js";

// A person signs in through one or more ways (an OIDC provider, GitHub, a
// password), each with a stable id of its own. identities maps each of
// those to the person's account, which is still keyed by email (users,
// grants, and sessions all use it).
//
// A way they have used before finds their account by its id, so an email
// changed at the provider keeps the same account. A new way joins the
// account with the email it vouches for, or starts one. Each way must only
// hand over an email it has verified: that is what links two ways.

export interface Identity {
  provider: string; // "github", "password", or "oidc:<issuer>"
  subject: string; // the provider's stable id for the person
  email: string; // the verified email the provider gave this time
  username: string;
}

/** The account email for this sign-in: the one already linked, else the given email (and links it). */
export async function linkIdentity(db: Db, id: Identity, now = Date.now()): Promise<string> {
  const email = id.email.toLowerCase();
  return db.tx(async (t) => {
    const known = await t.get<{ email: string }>(`SELECT email FROM identities WHERE provider = ? AND subject = ? ${t.forUpdate}`, id.provider, id.subject);
    if (known) {
      await t.run("UPDATE identities SET login_email = ?, username = ?, last_login = ? WHERE provider = ? AND subject = ?", email, id.username, now, id.provider, id.subject);
      if (known.email !== email) console.log(`sign-in via=${id.provider} gave email=${email}, kept the linked account email=${known.email}`);
      return known.email;
    }
    // Another server may link the same identity at once: the first insert wins.
    await t.run(
      `INSERT INTO identities (provider, subject, email, login_email, username, first_login, last_login)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (provider, subject) DO NOTHING`,
      id.provider,
      id.subject,
      email,
      email,
      id.username,
      now,
      now,
    );
    return (await t.get<{ email: string }>("SELECT email FROM identities WHERE provider = ? AND subject = ?", id.provider, id.subject))!.email;
  });
}

export interface LinkedIdentity {
  provider: string;
  subject: string;
  loginEmail: string; // the email the provider gave at the last sign-in
  username: string;
  firstLogin: number;
  lastLogin: number;
}

/** The ways an account has signed in, first used first. */
export async function identitiesOf(db: Db, email: string): Promise<LinkedIdentity[]> {
  const rows = await db.all<{ provider: string; subject: string; login_email: string; username: string; first_login: number; last_login: number }>(
    "SELECT provider, subject, login_email, username, first_login, last_login FROM identities WHERE email = ? ORDER BY first_login, provider",
    email.toLowerCase(),
  );
  return rows.map((r) => ({ provider: r.provider, subject: r.subject, loginEmail: r.login_email, username: r.username, firstLogin: r.first_login, lastLogin: r.last_login }));
}
