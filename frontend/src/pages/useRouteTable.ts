import { useEffect, useState } from "react";
import { t } from "../shared/i18n";
import { toast } from "sonner";
import { api, type Route } from "../shared/api";

// useRouteTable keeps a routing table in step with the server. Every change
// saves the whole table at once: finishing a route's editor, deleting it, or
// dragging it to a new place. There is no separate Save.
export function useRouteTable<T extends { routes: Route[] }>(path: string, data: T | null) {
  const [saved, setSaved] = useState<T | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  useEffect(() => { if (data) { setSaved(data); setRoutes(data.routes); } }, [data]);

  // persist returns an error message, or null once the server has the table.
  const persist = async (next: Route[], done: string): Promise<string | null> => {
    try {
      const res = await api<T>(path, { method: "PUT", body: { routes: next } });
      setSaved(res);
      setRoutes(res.routes);
      toast(done);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  return {
    saved,
    routes,
    // Finishing a route's editor: index -1 adds it at the end.
    finish: (index: number, r: Route) =>
      persist(index < 0 ? [...routes, r] : routes.map((x, j) => (j === index ? r : x)), index < 0 ? t("Route added") : t("Route saved")),
    remove: (index: number) => persist(routes.filter((_, j) => j !== index), t("Route deleted")),
    // Reordering shows the new order at once and puts it back if saving fails.
    reorder: (from: number, to: number) => {
      const before = routes;
      const next = [...routes];
      const [r] = next.splice(from, 1);
      next.splice(to, 0, r!);
      setRoutes(next);
      void persist(next, t("Order saved")).then(err => {
        if (err) {
          setRoutes(before);
          toast.error(err);
        }
      });
    },
  };
}
