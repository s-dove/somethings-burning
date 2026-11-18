import { useEffect, useState, type ReactNode } from "react";
import { confirmDialog } from "../components/Confirm";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Link } from "../components/common/Link";
import { Layout } from "../components/Layout";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { api, useApi, type ProjectSettings } from "../shared/api";
import { stamp } from "../shared/format";
import { input } from "../shared/ui";
import { Button } from "../ui/components/Button";
import { Tip } from "../components/Tip";
import { ArrowLeft, Bell, ChevronRight, Code, FileText, GitMerge, KeyRound, LockKeyhole, Pencil, Rocket, Settings2, Shield, Trash2, TriangleAlert, Users } from "../ui/icons";
import { t } from "../shared/i18n";

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
  const to = back ?? { to: `/p/${project.id}`, label: t("Back to issues") };
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
export const backToSettings = (s: ProjectSettings | null) => (s ? { to: `/p/${s.project.id}/settings`, label: t("Back to settings") } : undefined);

// SettingsPage: the project's name first, then its settings pages, then deleting it.
export function SettingsPage() {
  const { data, error, reload } = useSettings();
  return (
    <SettingsFrame
      settings={data}
      error={error}
      title={(name) => t("{name} project settings", { name })}
      hint={t("Connect a service, decide who sees its errors, and where they go.")}
      action={
        <Tip content={t("Sign-in, email, Mattermost, and code access for the whole server")}>
          <Link to="/settings" className="ui-button ui-button-secondary ui-button-md shrink-0 no-underline">
            <Settings2 aria-hidden="true" />
            {t("Global settings")}
            <ChevronRight aria-hidden="true" />
          </Link>
        </Tip>
      }
    >
      {({ project, grants }) => {
        const base = `/p/${project.id}/settings`;
        const access = grants.length ? t("{n} grants", { n: grants.length }) : t("No one has access");
        const role = t(project.role ?? "viewer");
        return (
          <>
            <div className="grid gap-8">
              {project.role === "admin" && <NameGroup settings={data!} onChange={reload} />}
              <Group id="connect" icon={<KeyRound aria-hidden="true" />} title={t("Connect")} hint={t("How the service and its CI reach this project.")}>
                <Row to={`${base}/dsn`} icon={<KeyRound aria-hidden="true" />} title={t("DSN")} detail={t("The address your SDK reports to, and how to set it up.")} />
                <Row to={`${base}/tokens`} icon={<KeyRound aria-hidden="true" />} title={t("API tokens")} detail={t("Let CI create releases and mark deploys. Shown once.")} />
                <Row to={`${base}/sourcemaps`} icon={<FileText aria-hidden="true" />} title={t("Source maps")} detail={t("Turn minified JavaScript frames back into your files and lines.")} />
                <Row to={`/p/${project.id}/releases`} icon={<Rocket aria-hidden="true" />} title={t("Releases")} detail={t("What each release brought, and where CI deployed it.")} />
              </Group>
              <Group id="people" icon={<Shield aria-hidden="true" />} title={t("People and alerts")} hint={t("Who sees its issues, who handles them, and who hears about them.")}>
                <Row to={`${base}/rbac`} icon={<Shield aria-hidden="true" />} title={t("Access")} detail={t("Who can view and manage this project. {access}. Your role: {role}.", { access, role })} />
                <Row to={`${base}/notifications`} icon={<Bell aria-hidden="true" />} title={t("Notifications")} detail={t("Routing: which alerts go to which people, addresses, and channels.")} />
                <Row to={`${base}/ownership`} icon={<Users aria-hidden="true" />} title={t("Ownership")} detail={t("Who a new issue is assigned to, from the first rule that matches.")} />
              </Group>
              <Group id="code" icon={<Code aria-hidden="true" />} title={t("Issues and code")} hint={t("How its events are read, grouped, and kept.")}>
                <Row to={`${base}/code`} icon={<Code aria-hidden="true" />} title={t("Code")} detail={t("The repositories stack frames come from, for links to the lines in them.")} />
                <Row to={`${base}/grouping`} icon={<GitMerge aria-hidden="true" />} title={t("Grouping")} detail={t("Which events count as one issue, instead of the default grouping.")} />
                <Row to={`${base}/scrubbing`} icon={<LockKeyhole aria-hidden="true" />} title={t("Data scrubbing")} detail={t("Passwords, tokens, card numbers, and your own fields, filtered before storage.")} />
              </Group>
              {project.role === "admin" && <DangerZone settings={data!} />}
            </div>
          </>
        );
      }}
    </SettingsFrame>
  );
}

function GroupHead({ id, icon, title, hint, danger }: { id: string; icon: ReactNode; title: string; hint: string; danger?: boolean }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className={`grid size-9 shrink-0 place-items-center rounded-control border ${danger ? "border-ember-ink/30 bg-ember-soft text-ember-ink" : "border-rule bg-smoke text-cinder"}`}>{icon}</span>
      <div className="min-w-0">
        <h2 id={`${id}-title`} className="text-lg">{title}</h2>
        <p className="text-xs text-cinder">{hint}</p>
      </div>
    </div>
  );
}

function Group({ id, icon, title, hint, children }: { id: string; icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`}>
      <GroupHead id={id} icon={icon} title={title} hint={hint} />
      <ul className="m-0 w-full list-none divide-y divide-rule overflow-hidden rounded-card border border-rule bg-ash p-0">{children}</ul>
    </section>
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

const refreshBoard = (mutate: ReturnType<typeof useSWRConfig>["mutate"]) => void mutate((key) => typeof key === "string" && key.startsWith("/board"));

// NameGroup is the project's name, at the top. Admins only.
function NameGroup({ settings: { project }, onChange }: { settings: ProjectSettings; onChange: () => void }) {
  const { mutate } = useSWRConfig();
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(project.name), [project.name]);

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/projects/${project.id}`, { method: "PATCH", body: { name } });
      toast(t("Project renamed"));
      onChange();
      refreshBoard(mutate);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="general-title">
      <GroupHead id="general" icon={<Pencil aria-hidden="true" />} title={t("General")} hint={t("Created {when}", { when: stamp(project.createdAt) })} />
      <form className="flex flex-wrap items-end gap-3 rounded-card border border-rule bg-ash px-5 py-4" onSubmit={rename}>
        <label className="grid min-w-56 flex-1 gap-1.5 text-xs font-medium">
          {t("Name")}
          <input className={`${input} h-9`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        <Button type="submit" disabled={busy || !name.trim() || name.trim() === project.name}>
          {t("Rename")}
        </Button>
      </form>
    </section>
  );
}

// DangerZone deletes the project, at the bottom. Admins only.
function DangerZone({ settings: { project } }: { settings: ProjectSettings }) {
  const { mutate } = useSWRConfig();
  const navigate = useNavigate();
  const remove = async () => {
    if (!(await confirmDialog({ title: t("Delete {name}?", { name: project.name }), body: t("The project goes, with all its issues and events."), confirm: t("Delete"), danger: true }))) return;
    try {
      await api(`/projects/${project.id}`, { method: "DELETE" });
      toast(t("Deleted {name}", { name: project.name }));
      refreshBoard(mutate);
      navigate("/");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  return (
    <section aria-labelledby="danger-title">
      <GroupHead id="danger" icon={<TriangleAlert aria-hidden="true" />} title={t("Danger zone")} hint={t("This cannot be undone.")} danger />
      <div className="flex flex-wrap items-center gap-4 rounded-card border border-ember-ink/30 bg-ash px-5 py-4">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{t("Delete this project")}</span>
          <span className="block text-xs text-cinder">{t("The project goes, with all its issues and events.")}</span>
        </span>
        <Button variant="danger" icon={<Trash2 aria-hidden="true" />} onClick={remove}>
          {t("Delete project")}
        </Button>
      </div>
    </section>
  );
}
