import { ConnectSection } from "./ConnectSection";
import { t } from "../shared/i18n";
import { backToSettings, SettingsFrame, useSettings } from "./SettingsPage";

// DsnPage shows the project's DSN and how to add an SDK.
export function DsnPage() {
  const { data, error } = useSettings();
  return (
    <SettingsFrame
      settings={data}
      error={error}
      back={backToSettings(data)}
      title={(name) => t("Connect {name}", { name })}
      hint={t("Two steps to your first error. Use the SDK you already know.")}
    >
      {(s) => <ConnectSection dsn={s.dsn} />}
    </SettingsFrame>
  );
}
