import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, useApi, type Project, type ProjectSummary } from "../lib/api";
import { ago } from "../lib/time";
import { Button, Card, ErrorNote, Input } from "../ui";

export function ProjectsPage() {
  const { data, error } = useApi<{ projects: ProjectSummary[] }>("/projects", 5000);
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string>();

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setCreateError(undefined);
    try {
      const { project } = await api<{ project: Project }>("/projects", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setCreateError((err as Error).message);
      setBusy(false);
    }
  };

  const projects = data?.projects;

  return (
    <div className="space-y-6">
      <div className="flex items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-neutral-400">Each project has its own DSN. Point a Sentry SDK at it.</p>
        </div>
        <form onSubmit={create} className="ml-auto flex gap-2">
          <Input placeholder="New project name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <Button kind="primary" disabled={busy || !name.trim()}>
            Create
          </Button>
        </form>
      </div>
      <ErrorNote message={createError ?? error} />

      {projects && projects.length === 0 && (
        <Card>
          <p className="py-8 text-center text-neutral-400">No projects yet. Create one to get a DSN.</p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects?.map((p) => (
          <Link
            key={p.id}
            to={`/projects/${p.id}`}
            className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-4 transition hover:border-neutral-600"
          >
            <div className="font-medium">{p.name}</div>
            <div className="mt-3 flex gap-4 text-sm text-neutral-400">
              <span>
                <span className={p.issueCount ? "text-orange-400" : ""}>{p.issueCount}</span> issues
              </span>
              <span>{p.eventCount} events</span>
              <span className="ml-auto">{ago(p.lastSeen)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
