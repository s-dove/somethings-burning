import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/components/Button";
import { Plus } from "../ui/icons";
import { api, unavailableKinds, useApi, type PersonalRouting, type Receiver, type Route } from "../shared/api";
import { RouteList } from "./RouteList";
import { RouteModal } from "./RouteModal";
import { useRouteTable } from "./useRouteTable";
import { t } from "../shared/i18n";

const card = "mt-6 rounded-card border border-rule bg-smoke p-6";

// ProfileNotifications is this person's own routing: how alerts that reach
// them as a person are delivered, or dropped. Same rules as a project's
// table, with no default route: nothing matching means nothing is sent.
// Changes save as they are made.
export function ProfileNotifications() {
  const { data, error } = useApi<PersonalRouting>("/profile/notifications");
  const { saved, routes, finish, remove, reorder } = useRouteTable<PersonalRouting>("/profile/notifications", data);
  const [editing, setEditing] = useState<{ index: number; route: Route } | null>(null);
  if (!saved) return error ? <p role="alert" className="mt-6 text-sm text-ember-ink">{error}</p> : null;

  const unavailable = unavailableKinds(saved);
  const newRoute = (): Route => ({ name: "", matchers: [{ field: "project", op: "=~", value: ".*" }], sink: false, receivers: [{ kind: "email", target: saved.address }], continue: false });

  async function test(x: Receiver) {
    try {
      await api("/profile/notifications/test", { method: "POST", body: x });
      toast(t("Test sent to {target}", { target: x.target }));
    } catch (err) {
      toast.error(`${x.target}: ${(err as Error).message}`);
    }
  }

  return (
    <section className={card}>
      <h2 className="text-base">{t("Notifications")}</h2>
      <p className="mt-1 mb-4 text-xs leading-relaxed text-cinder">
        {t("How alerts that a project sends to you as a person reach you: by email, by Mattermost message, or not at all (sink). Routes work like a project's: tried from the top, all conditions must match, and you can match on project too. Nothing matching means nothing is sent. Email addresses and channels in a project's routing are not affected.")}
        {saved.initial && ` ${t("You have not changed anything yet, so this is the starting route.")}`}
      </p>

      <RouteList routes={routes} readOnly={false} empty={t("No routes. You get no notifications.")} unavailable={unavailable}
        onReorder={reorder} onOpen={i => setEditing({ index: i, route: routes[i]! })} />
      <Button size="sm" className="mt-3" icon={<Plus aria-hidden="true" />} onClick={() => setEditing({ index: -1, route: newRoute() })}>{t("Add route")}</Button>

      <RouteModal route={editing?.route ?? null} index={editing?.index ?? -1}
        fields={saved.fields} ops={saved.ops} kinds={saved.receiverKinds} readOnly={false} unavailable={unavailable}
        onClose={() => setEditing(null)}
        onDone={async r => { const err = editing ? await finish(editing.index, r) : null; if (!err) setEditing(null); return err; }}
        onDelete={async () => { const err = editing ? await remove(editing.index) : null; if (!err) setEditing(null); return err; }}
        onTest={x => void test(x)} />
    </section>
  );
}
