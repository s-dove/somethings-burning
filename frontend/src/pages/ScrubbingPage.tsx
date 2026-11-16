import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Toggle } from "../components/Toggle";
import { api, useApi, type ConfigView } from "../shared/api";
import { input, section, sectionTitle } from "../shared/ui";
import { Button } from "../ui/components/Button";
import { backToSettings, SettingsFrame, useSettings } from "./SettingsPage";
import { t } from "../shared/i18n";

const DEFAULTS = ["password, passwd, passphrase", "secret, token, api_key, access_key, private_key", "auth, authorization, credentials", "cookie, set-cookie, session, csrf, xsrf", "card, card_number, cvv, cvc, ssn"];

export function ScrubbingPage() {
  const { id } = useParams();
  const settings = useSettings();
  const { data, error } = useApi<ConfigView>(`/projects/${id}/config`);
  const [view, setView] = useState<ConfigView | null>(null);
  const [defaults, setDefaults] = useState(true);
  const [fields, setFields] = useState("");
  useEffect(() => setView(data), [data]);
  useEffect(() => {
    if (view) {
      setDefaults(view.config.scrub.defaults);
      setFields(view.config.scrub.fields.join(", "));
    }
  }, [view]);
  const admin = view?.project.role === "admin";
  const list = fields.split(/[\s,]+/).map((f) => f.trim()).filter(Boolean);
  const dirty = !!view && (defaults !== view.config.scrub.defaults || list.join(",") !== view.config.scrub.fields.join(","));
  const save = async () => {
    try {
      setView(await api<ConfigView>(`/projects/${id}/config/scrub`, { method: "PUT", body: { defaults, fields: list } }));
      toast("Saved");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  return (
    <SettingsFrame
      settings={settings.data}
      error={settings.error || error}
      back={backToSettings(settings.data)}
      title={(name) => `${name} data scrubbing`}
      hint="What is filtered out of events before they are stored."
      action={admin ? <Button variant="primary" disabled={!dirty} onClick={() => void save()}>{t("Save")}</Button> : undefined}
    >
      {() =>
        !view ? null : (
          <div className="grid gap-6">
            <section className={section}>
              <Toggle checked={defaults} disabled={!admin} onChange={setDefaults} label="Built-in rules" className="items-start [&>button]:mt-0.5">
                <span>
                  <span className="block text-sm font-semibold">{t("Filter the usual secrets")}</span>
                  <span className="block text-xs text-cinder">
                    Values are replaced with <span className="mono">[Filtered]</span> wherever they are: request headers, cookies, body, and query, extra, contexts, breadcrumb data, and local variables.
                  </span>
                </span>
              </Toggle>
              <ul className="mt-4 ml-12 grid list-disc gap-1 pl-4 text-xs text-cinder">
                <li>Fields named like: {DEFAULTS.join("; ")}</li>
                <li>In any text: card numbers (that pass the Luhn check), &quot;Bearer …&quot; tokens, and JWTs</li>
              </ul>
            </section>
            <section className={section}>
              <h2 className={sectionTitle}>
                More fields <span className="text-xs font-normal text-cinder">{t("a field whose name contains one of these is filtered too")}</span>
              </h2>
              <input className={`${input} mono w-full`} placeholder="email, phone, address" value={fields} disabled={!admin} onChange={(e) => setFields(e.target.value)} />
              <p className="mt-2 text-xs text-cinder">{t("Separate with commas. It applies to events from now on; stored events stay as they are.")}</p>
            </section>
          </div>
        )
      }
    </SettingsFrame>
  );
}
