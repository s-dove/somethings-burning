export function Loading() {
  return <div role="status" aria-label="Loading" className="space-y-5 motion-safe:animate-pulse">
    <span className="sr-only">Loading…</span>
    <div className="h-8 w-48 rounded-control bg-rule-soft" />
    <div className="h-4 w-64 max-w-full rounded-control bg-rule-soft" />
    <div className="mt-8 space-y-4 rounded-card border border-rule p-6">
      {[0, 1, 2].map(i => <div key={i} className="h-16 rounded-control bg-rule-soft" />)}
    </div>
  </div>;
}
