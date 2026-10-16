import { useEffect, useState } from "react";
import type { ProjectSettings } from "../shared/api";
import { AccessSection } from "./AccessSection";
import { backToSettings, SettingsFrame, useSettings } from "./SettingsPage";

// RbacPage lists who has which role in the project. Admins change it here.
export function RbacPage() {
  const { data, error } = useSettings();
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  useEffect(() => setSettings(data), [data]);
  return (
    <SettingsFrame
      settings={settings}
      error={error}
      back={backToSettings(settings)}
      title={(name) => `${name} access`}
      hint="Grant a role to a person by email, or to a group from the sign-in groups claim. The highest matching role wins."
    >
      {(s) => <AccessSection settings={s} onChange={setSettings} />}
    </SettingsFrame>
  );
}
