import { ConnectSection } from "./ConnectSection";
import { backToSettings, SettingsFrame, useSettings } from "./SettingsPage";

// DsnPage shows the project's DSN and how to add an SDK.
export function DsnPage() {
  const { data, error } = useSettings();
  return (
    <SettingsFrame
      settings={data}
      error={error}
      back={backToSettings(data)}
      title={(name) => `Connect ${name}`}
      hint="Two steps to your first error. Use the SDK you already know."
    >
      {(s) => <ConnectSection dsn={s.dsn} />}
    </SettingsFrame>
  );
}
