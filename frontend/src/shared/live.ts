import { useEffect, useRef, useState } from "react";

// useUnseenAlerts marks a project when a new alert arrives and clears it once
// that project is open. The stream carries only the project id.
export function useUnseenAlerts(openProjectId: number | null): ReadonlySet<number> {
  const [unseen, setUnseen] = useState<ReadonlySet<number>>(() => new Set());
  const open = useRef(openProjectId);
  open.current = openProjectId;

  useEffect(() => {
    const source = new EventSource("/api/alerts");
    source.onmessage = (ev) => {
      let projectId = 0;
      try {
        projectId = Number((JSON.parse(ev.data) as { projectId?: unknown }).projectId);
      } catch {
        return;
      }
      if (!projectId || projectId === open.current) return;
      setUnseen((cur) => {
        if (cur.has(projectId)) return cur;
        const next = new Set(cur);
        next.add(projectId);
        return next;
      });
    };
    return () => source.close();
  }, []);

  useEffect(() => {
    if (!openProjectId) return;
    setUnseen((cur) => {
      if (!cur.has(openProjectId)) return cur;
      const next = new Set(cur);
      next.delete(openProjectId);
      return next;
    });
  }, [openProjectId]);

  return unseen;
}
