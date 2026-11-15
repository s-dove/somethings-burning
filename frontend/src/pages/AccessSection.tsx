import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/components/Button";
import { Select, type SelectOption } from "../components/common/Select";
import { Trash2, UserRound, Users } from "../ui/icons";
import { api, useApi, type Grant, type ProjectSettings, type Role, type Session } from "../shared/api";
import { input } from "../shared/ui";
import { Tip } from "../components/Tip";

const ROLE_HELP: Record<Role, string> = {
  viewer: "Sees issues and events.",
  member: "Also receives alerts by the default route.",
  admin: "Also changes access, notifications, and the project.",
};
const roleLabel = (role: Role) => role[0]!.toUpperCase() + role.slice(1);
const roleOptions = (roles: Role[]): SelectOption<Role>[] => roles.map(r => ({ value: r, label: roleLabel(r), hint: ROLE_HELP[r] }));
const KIND_OPTIONS: SelectOption<Grant["kind"]>[] = [
  { value: "user", label: "User", hint: "One person, by email.", icon: <UserRound size={14} /> },
  { value: "group", label: "Group", hint: "Everyone in a sign-in group.", icon: <Users size={14} /> },
];
const youTag = "shrink-0 rounded-full bg-ember-soft px-2 py-px text-[11px] font-medium text-ember-ink";

// AccessSection lists who has which role. Admins add, change, and remove
// grants; everyone else sees the list read-only. At least one user must stay
// admin; the server refuses a change that would break that.
export function AccessSection({ settings, onChange }: { settings: ProjectSettings; onChange: (s: ProjectSettings) => void }) {
  const { project, grants, roles } = settings;
  const admin = project.role === "admin";
  const userAdmins = grants.filter(g => g.kind === "user" && g.role === "admin").length;
  const lastAdmin = (g: Grant) => g.kind === "user" && g.role === "admin" && userAdmins === 1;
  // Mark the grants that apply to the signed-in user: their email, or a group
  // in their groups claim.
  const { data: session } = useApi<Session>("/session", 60_000);
  const me = session?.user;
  const mine = (g: Grant) => !!me && (g.kind === "user" ? g.subject === me.email.toLowerCase() : me.groups.includes(g.subject));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(method: "PUT" | "DELETE", body: { kind: Grant["kind"]; subject: string; role?: Role }) {
    setBusy(true);
    setError("");
    try {
      onChange(await api<ProjectSettings>(`/projects/${project.id}/access`, { method, body }));
      toast(method === "DELETE" ? "Access removed" : "Access saved");
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Access">
      <dl className="mb-5 grid gap-2 sm:grid-cols-3">
        {roles.map(r => <div key={r} className="rounded-control border border-rule bg-smoke px-3 py-2"><dt className="text-xs font-semibold">{roleLabel(r)}</dt><dd className="m-0 text-xs text-cinder">{ROLE_HELP[r]}</dd></div>)}
      </dl>
      {grants.length === 0 && <p className="mb-4 rounded-card border border-rule bg-smoke px-4 py-3 text-[13px] text-cinder">No one has access to this project. Grant a user the admin role first.</p>}
      {admin && <AddGrant roles={roles} busy={busy} onAdd={(kind, subject, role) => send("PUT", { kind, subject, role })} />}
      {error && <p role="alert" className="mb-3 text-xs text-ember-ink">{error}</p>}
      {grants.length > 0 && <ul className="m-0 list-none divide-y divide-rule overflow-hidden rounded-card border border-rule bg-ash p-0">
        {grants.map(g => <li key={`${g.kind}:${g.subject}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
          {g.kind === "group" ? <Users className="shrink-0 text-cinder" aria-label="Group" /> : <UserRound className="shrink-0 text-cinder" aria-label="User" />}
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Tip content={g.subject}><span className="min-w-0 truncate text-sm">
              {g.name && g.name !== g.subject ? <>{g.name} <span className="text-xs text-cinder">{g.subject}</span></> : g.subject}
            </span></Tip>
            {mine(g) && <span className={youTag}>{g.kind === "user" ? "You" : "You're in this group"}</span>}
          </span>
          {admin
            ? <>
              <Select
                label={`Role for ${g.subject}`}
                hideLabel
                size="sm"
                className="w-32"
                value={g.role}
                options={roleOptions(roles)}
                disabled={busy}
                title={lastAdmin(g) ? "The last user who is admin keeps the admin role." : undefined}
                onChange={role => { if (role !== g.role) void send("PUT", { kind: g.kind, subject: g.subject, role }); }}
              />
              <Tip content={lastAdmin(g) ? "The last user who is admin cannot be removed." : "Remove"}><span className="inline-flex"><button type="button" className="cursor-pointer rounded-control p-2 text-cinder hover:bg-rule-soft hover:text-ember-ink disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || lastAdmin(g)} aria-label={`Remove ${g.subject}`} onClick={() => void send("DELETE", { kind: g.kind, subject: g.subject })}><Trash2 /></button></span></Tip>
            </>
            : <span className="text-xs text-cinder">{roleLabel(g.role)}</span>}
        </li>)}
      </ul>}
      {admin && grants.length > 0 && <p className="mt-3 text-xs text-cinder">At least one user must stay admin. Group admins do not count.</p>}
      {!admin && <p className="mt-3 text-xs text-cinder">{project.role ? `Only admins change access. Your role here is ${project.role}.` : "You no longer have access to this project."}</p>}
    </section>
  );
}

function AddGrant({ roles, busy, onAdd }: { roles: Role[]; busy: boolean; onAdd: (kind: Grant["kind"], subject: string, role: Role) => Promise<boolean> }) {
  const [kind, setKind] = useState<Grant["kind"]>("user");
  const [role, setRole] = useState<Role>("member");
  const [subject, setSubject] = useState("");
  return (
    <form className="mb-4 flex flex-wrap items-end gap-2 rounded-card border border-rule bg-smoke p-4" onSubmit={async e => {
      e.preventDefault();
      if (await onAdd(kind, subject, role)) setSubject("");
    }}>
      <Select label="Type" className="w-32" value={kind} options={KIND_OPTIONS} onChange={setKind} />
      <label className="grid min-w-[220px] flex-1 gap-1.5 text-xs font-medium">{kind === "user" ? "Email" : "Group name"}
        <input className={`${input} h-9`} value={subject} onChange={e => setSubject(e.target.value)} required type={kind === "user" ? "email" : "text"} placeholder={kind === "user" ? "name@example.com" : "e.g. platform-eng"} />
      </label>
      <Select label="Role" className="w-36" value={role} options={roleOptions(roles)} onChange={setRole} />
      <Button variant="primary" type="submit" disabled={busy}>Grant access</Button>
    </form>
  );
}
