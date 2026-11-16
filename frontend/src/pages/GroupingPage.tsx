import type { GroupingRule } from "../shared/api";
import { t } from "../shared/i18n";
import { RulesPage } from "./RulesPage";

export function GroupingPage() {
  return (
    <RulesPage<GroupingRule>
      section="grouping"
      title={(name) => t("{name} grouping", { name })}
      hint={t("Which events count as one issue.")}
      intro={
        <>
          {t("Events that match a rule get its fingerprint instead of the default grouping, so every event with the same fingerprint is one issue. Words in braces take the event's values:")}{" "}
          <span className="mono text-soot">{"{{ type }}"}</span>, <span className="mono text-soot">{"{{ message }}"}</span>, <span className="mono text-soot">{"{{ culprit }}"}</span>,{" "}
          <span className="mono text-soot">{"{{ tag.region }}"}</span>
          {t(", and")} <span className="mono text-soot">{"{{ default }}"}</span>{" "}
          {t("for the usual grouping. Rules apply to new events; to join issues that exist, merge them from the list.")}
        </>
      }
      target={{
        key: "fingerprint",
        label: t("Fingerprint"),
        placeholder: "db-timeout {{ tag.region }}",
        mono: true,
        hint: t("Events with the same fingerprint are one issue. Braces take the event's values; {{ default }} is the usual grouping."),
        blank: () => ({ field: "message", pattern: "", fingerprint: "" }),
      }}
    />
  );
}
