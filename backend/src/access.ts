import type { User } from "./auth.js";
import type { Db } from "./db.js";

// A project grants roles to users (by email) and to groups (by the name in the
// groups claim). Each role includes the ones below it.
export const ROLES = ["viewer", "member", "admin"] as const;
export type Role = (typeof ROLES)[number];
export type SubjectKind = "user" | "group";

export interface Grant {
  kind: SubjectKind;
  subject: string;
  role: Role;
  createdAt: number;
}

export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);
export const atLeast = (role: Role | null | undefined, need: Role): boolean => !!role && ROLES.indexOf(role) >= ROLES.indexOf(need);

/** Emails are lowercased, so a grant matches however the provider cases them. Group names are kept as sent. */
export const normalizeSubject = (kind: SubjectKind, subject: string): string =>
  kind === "user" ? subject.trim().toLowerCase() : subject.trim();

type Row = { project_id: number; subject_kind: string; subject: string; role: string; created_at: number };
const toGrant = (r: Row): Grant => ({ kind: r.subject_kind as SubjectKind, subject: r.subject, role: r.role as Role, createdAt: r.created_at });

export async function listGrants(db: Db, projectId: number): Promise<Grant[]> {
  const rows = await db.all<Row>(
    `SELECT * FROM project_access WHERE project_id = ?
      ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, subject_kind DESC, subject`,
    projectId,
  );
  return rows.map(toGrant);
}

export async function setGrant(db: Db, projectId: number, kind: SubjectKind, subject: string, role: Role): Promise<void> {
  await db.run(
    `INSERT INTO project_access (project_id, subject_kind, subject, role, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (project_id, subject_kind, subject) DO UPDATE SET role = excluded.role`,
    projectId,
    kind,
    normalizeSubject(kind, subject),
    role,
    Date.now(),
  );
}

export async function removeGrant(db: Db, projectId: number, kind: SubjectKind, subject: string): Promise<boolean> {
  const r = await db.run("DELETE FROM project_access WHERE project_id = ? AND subject_kind = ? AND subject = ?", projectId, kind, normalizeSubject(kind, subject));
  return r.changes > 0;
}

/**
 * An error when a change would leave the project without a user who is
 * admin. Group admins do not count: membership changes outside Burning, and
 * then no one could manage the project.
 */
export function adminCheck(grants: Grant[], kind: SubjectKind, subject: string, role: Role | null): string {
  const key = normalizeSubject(kind, subject);
  const after = grants.filter((g) => !(g.kind === kind && g.subject === key));
  if (role) after.push({ kind, subject: key, role, createdAt: 0 });
  return after.some((g) => g.kind === "user" && g.role === "admin") ? "" : "a project needs at least one user as admin";
}

/**
 * Access decides roles. Only grants count: a project with no grants is
 * closed to everyone but site admins (emails or group names from
 * BURNING_SITE_ADMINS), who are admin on every project. No user (inside
 * the server, not through the API) counts as a site admin.
 */
export class Access {
  private siteAdmins: Set<string>;

  constructor(
    private db: Db,
    siteAdmins: string[] = [],
  ) {
    this.siteAdmins = new Set(siteAdmins.flatMap((a) => [a, a.toLowerCase()]));
  }

  isSiteAdmin(user: User | undefined): boolean {
    if (!user) return true;
    return this.siteAdmins.has(user.email.toLowerCase()) || user.groups.some((g) => this.siteAdmins.has(g));
  }

  async role(projectId: number, user: User | undefined): Promise<Role | null> {
    if (this.isSiteAdmin(user)) return "admin";
    return bestRole(await listGrants(this.db, projectId), user!);
  }

  /** Every project the user can see, with their role in it. */
  async roles(projectIds: number[], user: User | undefined): Promise<Map<number, Role>> {
    const out = new Map<number, Role>();
    if (this.isSiteAdmin(user)) {
      for (const id of projectIds) out.set(id, "admin");
      return out;
    }
    const byProject = new Map<number, Grant[]>();
    for (const r of await this.db.all<Row>("SELECT * FROM project_access")) {
      byProject.set(r.project_id, [...(byProject.get(r.project_id) ?? []), toGrant(r)]);
    }
    for (const id of projectIds) {
      const role = bestRole(byProject.get(id) ?? [], user!);
      if (role) out.set(id, role);
    }
    return out;
  }
}

function bestRole(grants: Grant[], user: User): Role | null {
  const email = user.email.toLowerCase();
  const groups = new Set(user.groups);
  let best: Role | null = null;
  for (const g of grants) {
    const match = g.kind === "user" ? g.subject === email : groups.has(g.subject);
    if (match && !atLeast(best, g.role)) best = g.role;
  }
  return best;
}
