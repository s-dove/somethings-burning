import { useState } from "react";
import { useParams } from "react-router";
import { unavailableKinds, useApi, type Route, type Routing } from "../shared/api";
import { Button } from "../ui/components/Button";
import { Plus } from "../ui/icons";
import { RouteList } from "./RouteList";
import { RouteModal } from "./RouteModal";
import { backToSettings, SettingsFrame, useSettings } from "./SettingsPage";
import { useRouteTable } from "./useRouteTable";
import { t } from "../shared/i18n";

const newRoute = (): Route => ({
  name: "",
  matchers: [{ field: "env", op: "=~", value: "production" }],
  sink: false,
  receivers: [{ kind: "user", target: "" }],
  continue: false,
});

// RoutingPage is a project's notification routing table, in the style of
// Alertmanager: routes tried top to bottom, all conditions in a route must
// match, and the default route catches what matches nothing.
export function RoutingPage() {
  const { id } = useParams();
  const settings = useSettings();
  const { data, error } = useApi<Routing>(`/projects/${id}/routing`);
  const { saved: routing, routes, finish, remove, reorder } = useRouteTable<Routing>(`/projects/${id}/routing`, data);
  // The route open in the editor: its index, or -1 for a new one.
  const [editing, setEditing] = useState<{ index: number; route: Route } | null>(null);
  const admin = routing?.project.role === "admin";
  const unavailable = routing ? unavailableKinds(routing) : [];

  return (
    <SettingsFrame
      settings={settings.data}
      error={settings.error || error}
      back={backToSettings(settings.data)}
      title={(name) => `${name} notifications`}
      hint="Who hears about new issues, issues firing again, and issues firing after a mute."
      action={
        admin ? (
          <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setEditing({ index: -1, route: newRoute() })}>
            Add route
          </Button>
        ) : undefined
      }
    >
      {() =>
        !routing ? null : (
          <div className="pb-10">
            <RouteList
              routes={routes}
              names={routing.names}
              readOnly={!admin}
              empty=""
              unavailable={unavailable}
              fallback={{ recipients: routing.defaultRecipients.map((p) => p.name) }}
              onReorder={reorder}
              onOpen={(i) => setEditing({ index: i, route: routes[i]! })}
            />

            <RouteModal
              route={editing?.route ?? null}
              index={editing?.index ?? -1}
              fields={routing.fields}
              ops={routing.ops}
              kinds={routing.receiverKinds}
              readOnly={!admin}
              project={routing.project.id}
              unavailable={unavailable}
              onClose={() => setEditing(null)}
              onDone={async (r) => {
                const err = editing ? await finish(editing.index, r) : null;
                if (!err) setEditing(null);
                return err;
              }}
              onDelete={async () => {
                const err = editing ? await remove(editing.index) : null;
                if (!err) setEditing(null);
                return err;
              }}
            />

            {!admin && <p className="mt-6 text-xs text-cinder">{t("Only project admins can change notifications.")}</p>}
          </div>
        )
      }
    </SettingsFrame>
  );
}
