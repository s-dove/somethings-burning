import type { OwnerRule } from "../shared/api";
import { t } from "../shared/i18n";
import { RulesPage } from "./RulesPage";

export function OwnershipPage() {
  return (
    <RulesPage<OwnerRule>
      section="owners"
      title={(name) => t("{name} ownership", { name })}
      hint={t("Who a new issue is assigned to.")}
      intro={
        <>
          {t("A new issue is assigned to the owner of the first rule that matches it.")} <span className="mono">path</span>{" "}
          {t("matches any in-app frame's file. Routes can then send alerts to")} <b className="text-soot">{t("the assignee")}</b>.
        </>
      }
      target={{ key: "owner", label: t("Owner"), placeholder: "owner@example.com", hint: t("The email of who gets the issue."), blank: () => ({ field: "path", pattern: "", owner: "" }) }}
    />
  );
}
