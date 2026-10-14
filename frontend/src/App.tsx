import { useEffect, useState } from "react";

type Health = "checking" | "ok" | "down";

function useHealth(): Health {
  const [health, setHealth] = useState<Health>("checking");
  useEffect(() => {
    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: { status?: string }) => setHealth(body.status === "ok" ? "ok" : "down"))
      .catch(() => setHealth("down"));
  }, []);
  return health;
}

const healthStyle: Record<Health, string> = {
  checking: "bg-neutral-500",
  ok: "bg-emerald-500",
  down: "bg-red-500",
};

export function App() {
  const health = useHealth();
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200">
      <header className="border-b border-neutral-800">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-4">
          <img src="/favicon.svg" alt="" className="h-6 w-6" />
          <span className="font-semibold tracking-tight">Something's burning</span>
          <span className="ml-auto flex items-center gap-2 text-sm text-neutral-400">
            <span className={`h-2 w-2 rounded-full ${healthStyle[health]}`} />
            API {health}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Nothing is burning.</h1>
        <p className="mt-3 text-neutral-400">
          A small error tracker. Errors will show up here once something reports them.
        </p>
      </main>
    </div>
  );
}
