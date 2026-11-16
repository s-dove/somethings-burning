import { useState } from "react";
import { toast } from "sonner";
import { Toggle } from "../components/Toggle";
import { api, useApi } from "../shared/api";
import { ago } from "../shared/format";
import { Button } from "../ui/components/Button";
import { CalendarClock } from "../ui/icons";
import { t } from "../shared/i18n";

type Digest = { enabled: boolean; lastSent: number; hourUTC: number; email: boolean };

const card = "mt-6 rounded-card border border-rule bg-smoke p-6";

/** One email a day about the projects this person can see. */
export function ProfileDigest() {
  const { data, reload } = useApi<Digest>("/profile/digest");
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const toggle = async (enabled: boolean) => {
    await api("/profile/digest", { method: "PUT", body: { enabled } });
    toast(enabled ? "Daily summary on" : "Daily summary off");
    reload();
  };
  const now = async () => {
    setBusy(true);
    try {
      const r = await api<{ ok?: boolean; detail?: string }>("/profile/digest/test", { method: "POST" });
      toast(r.ok ? "Summary sent" : (r.detail ?? "Nothing to send"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const hour = String(data.hourUTC).padStart(2, "0");
  return (
    <section className={card}>
      <h2 className="flex items-center gap-2 text-base"><CalendarClock aria-hidden="true" />{t("Daily summary")}</h2>
      <p className="mt-1 mb-4 text-xs text-cinder">One email a day, from {hour}:00 UTC, about your projects. Nothing is sent on a quiet day.</p>
      <Toggle checked={data.enabled} onChange={(on) => void toggle(on)} label="Daily summary">
        <span>{data.enabled ? "On" : "Off"}{data.lastSent > 0 && <span className="text-cinder"> · last sent {ago(data.lastSent)}</span>}</span>
      </Toggle>
      <p className="mt-3 text-xs text-cinder">{t("Issues first seen and firing again in the last day, and the busiest.")}</p>
      <Button className="mt-4" size="sm" disabled={busy || !data.email} onClick={() => void now()}>{busy ? "Sending…" : "Send me one now"}</Button>
      {!data.email && <p className="mt-2 text-xs text-cinder">{t("Email is not set up on this server.")}</p>}
    </section>
  );
}
