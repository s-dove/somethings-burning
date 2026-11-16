import { ArrowLeft } from "../ui/icons";
import { Link } from "../components/common/Link";
import { PageHeader } from "../components/PageHeader";
import type { IssueDetail } from "../shared/api";
import { ago, muteSummary, sentence, splitTitle } from "../shared/format";
import { Redacted } from "../components/Redacted";
import { Tag } from "../components/Tag";
import { pill, pillTone } from "../shared/ui";
import { AssigneePicker } from "./AssigneePicker";
import { GitHubButton } from "./GitHubButton";
import { IssueTriage } from "./IssueTriage";
import { Tip, TimeTip } from "../components/Tip";
import { translateActivity } from "../shared/activity";
import { t } from "../shared/i18n";

const banner = "rounded-card border px-4 py-3";

// Sticky issue header: the title, the triage actions (top right), and the
// status banner stay pinned. The message, status, and culprit are in the
// page body (IssueSummary).
export function IssueHeader({ detail, onChange }: { detail: IssueDetail; onChange: () => void }) {
  const { issue, project } = detail;
  const [type, msg] = splitTitle(issue.title);
  const bannerNode = statusBanner(issue);
  return (
    <PageHeader
      before={<Link className="inline-flex items-center gap-2 text-xs text-cinder no-underline hover:text-soot" to={`/p/${project.id}`}><ArrowLeft aria-hidden="true" /> {t("Back to issues")}</Link>}
      title={<Redacted text={type || msg} tip={false} />}
      titleText={type || msg}
      titleLines={type ? 1 : 2}
      actions={<span className="flex flex-wrap items-center justify-end gap-2"><GitHubButton detail={detail} onChange={onChange} /><AssigneePicker detail={detail} onChange={onChange} /><IssueTriage detail={detail} onChange={onChange} /></span>}
      // The message under the title belongs to it; a banner gets more room.
      spaceBelow={bannerNode ? "mb-5" : "mb-2"}
    >
      {compact => bannerNode && <div className={compact ? "mt-2.5" : "mt-5"}>{bannerNode}</div>}
    </PageHeader>
  );
}

// IssueSummary opens the page body. The title above and this message and
// culprit are the issue's: set from its first event and never updated. The
// note says so, because the event payload below can differ.
export function IssueSummary({ issue }: { issue: IssueDetail["issue"] }) {
  const [type, msg] = splitTitle(issue.title);
  const statusLabel = { open: t("Open"), resolved: t("Resolved"), muted: t("Muted") }[issue.status];
  return (
    <div className="mb-6">
      {type && <p className="text-base leading-relaxed text-cinder wrap-anywhere"><Redacted text={msg} /></p>}
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-cinder ${type ? "mt-3" : ""}`}>
        <Tip content={t("Issue status, changed by Resolve, Mute, and Reopen")}><span className={`${pill} ${pillTone[issue.status]}`}>{statusLabel}</span></Tip>
        {issue.culprit && <Tag name="culprit" value={issue.culprit} mono title={t("Where it happened: the event's transaction, or else the innermost frame of your code")} />}
        <span>{t("Title and culprit from the first event,")} <TimeTip at={issue.firstSeen}><span>{ago(issue.firstSeen)}</span></TimeTip></span>
      </div>
    </div>
  );
}

function statusBanner(issue: IssueDetail["issue"]) {
  if (issue.status === "open" && issue.reopenReason) return (
    <div className={`${banner} border-[#f6cfae] bg-ember-soft text-ember-ink`}>
      <b className="font-semibold">{t("Firing again.")}</b> {sentence(translateActivity(issue.reopenReason))}.
    </div>
  );
  if (issue.status === "resolved") return (
    <div className={`${banner} border-[#c4dbe6] bg-doused-soft text-[#1f4b60]`}>
      <b className="font-semibold">{t("Resolved {when}.", { when: ago(issue.resolvedAt) })}</b> {t("Everything up to then is handled. The next event fires it again.")}
    </div>
  );
  if (issue.status === "muted") return (
    <div className={`${banner} border-rule bg-rule-soft text-cinder`}>
      <b className="font-semibold">{sentence(muteSummary(issue.mute))}.</b> {t("Events keep counting, but nothing alerts.")}
    </div>
  );
  return null;
}
