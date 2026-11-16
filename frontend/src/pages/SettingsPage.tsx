import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Link } from "../components/common/Link";
import { Layout } from "../components/Layout";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { api, useApi, type ProjectSettings } from "../shared/api";
import { plural, stamp } from "../shared/format";
import { input, section, sectionTitle } from "../shared/ui";
import { Button } from "../ui/components/Button";
import { Tip } from "../components/Tip";
import { ArrowLeft, Bell, ChevronRight, Code, FileText, GitMerge, KeyRound, LockKeyhole, Rocket, Settings2, Shield, Trash2, Users } from "../ui/icons";

/** Loads a project's settings for the settings pages. */
export function useSettings() {
  const { id } = useParams();
  return useApi<ProjectSettings>(`/projects/${id}/settings`);
}

/** The settings pages' shell: the layout, a back link, and the title. */
export function SettingsFrame({ settings, error, back, title, hint, action, children }: {
  settings: ProjectSettings | null;
  error: string;
  back?: { to: string; label: string };
  title: (name: string) => string;
  hint: string;
  action?: ReactNode; // shown to the right of the title
  children: (s: ProjectSettings) => ReactNode;
}) {
  if (!settings) {
    return (
      <Layout nav="settings">
        {error ? (
          <div role="alert" className="px-6 py-14 text-center text-cinder">
            <strong className="mb-1 block text-base text-soot">{error}</strong>
          </div>
        ) : (
          <Loading />
        )}
      </Layout>
    );
  }
  const { project } = settings;
  const to = back ?? { to: `/p/${project.id}`, label: "Back to issues" };
  return (
    <Layout project={project} nav="settings">
      <PageHeader
        before={
          <Link to={to.to} className="inline-flex items-center gap-2 text-xs text-cinder no-underline">
            <ArrowLeft aria-hidden="true" />
            {to.label}
          </Link>
        }
        title={title(project.name)}
        titleText={title(project.name)}
        actions={action}
        after={<p className="mt-2 text-sm text-cinder">{hint}</p>}
        spaceBelow="mb-8"
      />
      {children(settings)}
    </Layout>
  );
}

/** Back to the settings list, for the pages under it. */
export const backToSettings = (s: ProjectSettings | null) => (s ? { to: `/p/${s.project.id}/settings`, label: "Back to settings" } : undefined);

// SettingsPage lists a project's settings pages, then its name and deletion.
export function SettingsPage() {
  const { data, error, reload } = useSettings();
  return (
    <SettingsFrame
      settings={data}
      error={error}
      title={(name) => `${name} settings`}
      hint="Connect a service, decide who sees its errors, and where they go."
      action={
        <Tip content="Sign-in, email, Mattermost, and code access for the whole server">
          <Link to="/settings" className="ui-button ui-button-secondary ui-button-md shrink-0 no-underline">
            <Settings2 aria-hidden="true" />
            Global settings
            <ChevronRight aria-hidden="true" />
          </Link>
        </Tip>
      }
    >
      {({ project, grants }) => {
        const base = `/p/${project.id}/settings`;
        const access = grants.length ? plural(grants.length, "grant") : "No one has access";
        return (
          <>
            <ul className="m-0 mb-6 w-full list-none divide-y divide-rule overflow-hidden rounded-card border border-rule bg-ash p-0">
              <Row to={`${base}/dsn`} icon={<KeyRound aria-hidden="true" />} title="DSN" detail="The address your SDK reports to, and how to set it up." />
              <Row
                to={`${base}/rbac`}
                icon={<Shield aria-hidden="true" />}
                title="Access"
                detail={`Who can view and manage this project. ${access}. Your role: ${project.role ?? "viewer"}.`}
              />
              <Row to={`${base}/notifications`} icon={<Bell aria-hidden="true" />} title="Notifications" detail="Routing: which alerts go to which people, addresses, and channels." />
              <Row to={`${base}/code`} icon={<Code aria-hidden="true" />} title="Code" detail="The repositories stack frames come from, for links to the lines in them." />
              <Row to={`${base}/sourcemaps`} icon={<FileText aria-hidden="true" />} title="Source maps" detail="Turn minified JavaScript frames back into your files and lines." />
              <Row to={`${base}/scrubbing`} icon={<LockKeyhole aria-hidden="true" />} title="Data scrubbing" detail="Passwords, tokens, card numbers, and your own fields, filtered before storage." />
              <Row to={`${base}/ownership`} icon={<Users aria-hidden="true" />} title="Ownership" detail="Who a new issue is assigned to, from the first rule that matches." />
              <Row to={`${base}/grouping`} icon={<GitMerge aria-hidden="true" />} title="Grouping" detail="Which events count as one issue, instead of the default grouping." />
              <Row to={`/p/${project.id}/releases`} icon={<Rocket aria-hidden="true" />} title="Releases" detail="What each release brought, and where CI deployed it." />
              <Row to={`${base}/tokens`} icon={<KeyRound aria-hidden="true" />} title="API tokens" detail="Let CI create releases and mark deploys. Shown once." />
            </ul>
            {project.role === "admin" && <General settings={data!} onChange={reload} />}
          </>
        );
      }}
    </SettingsFrame>
  );
}

function Row({ to, icon, title, detail }: { to: string; icon: ReactNode; title: string; detail: string }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-4 px-5 py-4 text-soot no-underline hover:bg-rule-soft">
        <span className="grid size-9 shrink-0 place-items-center rounded-control border border-rule bg-smoke text-cinder">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="block text-xs text-cinder">{detail}</span>
        </span>
        <ChevronRight className="shrink-0 text-cinder" aria-hidden="true" />
      </Link>
    </li>
  );
}

// General is the project's name, and deleting it. Admins only.
function General({ settings: { project }, onChange }: { settings: ProjectSettings; onChange: () => void }) {
  const { mutate } = useSWRConfig();
  const navigate = useNavigate();
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(project.name), [project.name]);
  const refreshBoard = () => void mutate((key) => typeof key === "string" && key.startsWith("/board"));

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/projects/${project.id}`, { method: "PATCH", body: { name } });
      toast("Project renamed");
      onChange();
      refreshBoard();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete ${project.name} with all its issues and events?`)) return;
    try {
      await api(`/projects/${project.id}`, { method: "DELETE" });
      toast(`Deleted ${project.name}`);
      refreshBoard();
      navigate("/");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <>
      <section className={section}>
        <h2 className={sectionTitle}>
          Name <span className="text-xs font-normal text-cinder">created {stamp(project.createdAt)}</span>
        </h2>
        <form className="flex flex-wrap gap-3" onSubmit={rename}>
          <input className={`${input} flex-1`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required aria-label="Project name" />
          <Button type="submit" disabled={busy || !name.trim() || name.trim() === project.name}>
            Rename
          </Button>
        </form>
      </section>
      <section className={section}>
        <h2 className={sectionTitle}>
          Delete <span className="text-xs font-normal text-cinder">removes the project with its issues and events</span>
        </h2>
        <Button variant="danger" icon={<Trash2 aria-hidden="true" />} onClick={remove}>
          Delete project
        </Button>
      </section>
    </>
  );
}
