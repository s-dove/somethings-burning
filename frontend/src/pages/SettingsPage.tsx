import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Layout } from "../components/Layout";
import { Loading } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { api, useApi, type Project } from "../shared/api";
import { stamp } from "../shared/format";
import { input, section, sectionTitle } from "../shared/ui";
import { Button } from "../ui/components/Button";
import { Trash2 } from "../ui/icons";
import { ConnectSection } from "./ConnectSection";

// SettingsPage is one project's DSN and setup, its name, and deleting it.
export function SettingsPage() {
  const { id } = useParams();
  const { data, error, reload } = useApi<{ project: Project }>(`/projects/${id}`);
  const project = data?.project;
  const { mutate } = useSWRConfig();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (project) setName(project.name);
  }, [project]);

  const refreshBoard = () => void mutate((key) => typeof key === "string" && key.startsWith("/board"));

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/projects/${id}`, { method: "PATCH", body: { name } });
      toast("Project renamed");
      reload();
      refreshBoard();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!project || !confirm(`Delete ${project.name} with all its issues and events?`)) return;
    try {
      await api(`/projects/${id}`, { method: "DELETE" });
      toast(`Deleted ${project.name}`);
      refreshBoard();
      navigate("/");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Layout project={project ? { id: project.id, name: project.name } : null} nav="settings">
      {error && <p role="alert" className="text-ember-ink">{error}</p>}
      {!project && !error && <Loading />}
      {project && (
        <>
          <PageHeader title="Settings" titleText="Settings" after={<p className="mt-2 text-[13px] text-cinder">Connect {project.name} and manage it.</p>} />
          <section className={section}>
            <h2 className={sectionTitle}>
              Connect <span className="text-xs font-normal text-cinder">report errors with any Sentry SDK</span>
            </h2>
            <ConnectSection dsn={project.dsn} />
          </section>
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
      )}
    </Layout>
  );
}
