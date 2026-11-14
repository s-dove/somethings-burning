import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, useApi, type Issue, type Project } from "../lib/api";
import { ago, fullTime } from "../lib/time";
import { Button, Card, CopyBox, ErrorNote, Input, LevelDot } from "../ui";

function snippets(dsn: string) {
  return {
    JavaScript: `import * as Sentry from "@sentry/browser"; // or @sentry/node

Sentry.init({ dsn: "${dsn}" });`,
    Python: `import sentry_sdk

sentry_sdk.init(dsn="${dsn}")`,
  };
}

function curlSnippet(p: Project): string {
  const u = new URL(p.dsn);
  return `curl -X POST '${u.protocol}//${u.host}/api/${p.id}/store/' \\
  -H 'X-Sentry-Auth: Sentry sentry_version=7, sentry_key=${p.publicKey}' \\
  -H 'Content-Type: application/json' \\
  -d '{"message": "Hello from curl", "level": "warning"}'`;
}

function Setup({ project }: { project: Project }) {
  const all = { ...snippets(project.dsn), curl: curlSnippet(project) };
  const [tab, setTab] = useState<keyof typeof all>("JavaScript");
  return (
    <Card title="Setup">
      <div className="space-y-4">
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">DSN</div>
          <CopyBox value={project.dsn} label="Copy DSN" />
        </div>
        <div>
          <div className="mb-2 flex gap-1">
            {(Object.keys(all) as (keyof typeof all)[]).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded px-2 py-1 text-xs ${tab === k ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}
              >
                {k}
              </button>
            ))}
          </div>
          <CopyBox value={all[tab]} />
        </div>
      </div>
    </Card>
  );
}

function Settings({ project, onChange }: { project: Project; onChange: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(project.name);
  const [error, setError] = useState<string>();

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api(`/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      setError(undefined);
      onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete ${project.name} and all its issues and events?`)) return;
    try {
      await api(`/projects/${project.id}`, { method: "DELETE" });
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Card title="Settings">
      <div className="space-y-3">
        <form onSubmit={rename} className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="flex-1" />
          <Button disabled={!name.trim() || name.trim() === project.name}>Rename</Button>
        </form>
        <div className="flex items-center gap-3 border-t border-neutral-800 pt-3">
          <span className="text-sm text-neutral-400">Created {fullTime(project.createdAt)}</span>
          <Button kind="danger" className="ml-auto" onClick={remove}>
            Delete project
          </Button>
        </div>
        <ErrorNote message={error} />
      </div>
    </Card>
  );
}

export function ProjectPage() {
  const { projectId } = useParams();
  const project = useApi<{ project: Project }>(`/projects/${projectId}`);
  const issues = useApi<{ issues: Issue[] }>(`/projects/${projectId}/issues`, 5000);
  const p = project.data?.project;

  if (project.error) return <ErrorNote message={project.error} />;
  if (!p) return null;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Projects
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{p.name}</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card title={`Issues${issues.data ? ` (${issues.data.issues.length})` : ""}`}>
          <ErrorNote message={issues.error} />
          {issues.data?.issues.length === 0 && (
            <p className="py-10 text-center text-neutral-400">Nothing is burning. Send an event with the setup on the right.</p>
          )}
          <ul className="-m-4 divide-y divide-neutral-800">
            {issues.data?.issues.map((i) => (
              <li key={i.id}>
                <Link to={`/projects/${p.id}/issues/${i.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-800/50">
                  <LevelDot level={i.level} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{i.title}</div>
                    <div className="truncate font-mono text-xs text-neutral-500">{i.culprit || i.platform}</div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="text-orange-400">{i.count}</div>
                    <div className="text-xs text-neutral-500" title={fullTime(i.lastSeen)}>
                      {ago(i.lastSeen)}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-6">
          <Setup project={p} />
          <Settings project={p} onChange={project.reload} />
        </div>
      </div>
    </div>
  );
}
