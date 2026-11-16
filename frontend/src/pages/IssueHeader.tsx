import { ArrowLeft } from "../ui/icons";
import { Link } from "../components/common/Link";
import { PageHeader } from "../components/PageHeader";
import type { IssueDetail } from "../shared/api";
import { ago, muteSummary, sentence, splitTitle } from "../shared/format";
import { Redacted } from "../components/Redacted";
import { Tag } from "../components/Tag";
import { pill, pillTone } from "../shared/ui";
import { IssueTriage } from "./IssueTriage";
import { Tip, TimeTip } from "../components/Tip";

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
      before={<Link className="inline-flex items-center gap-2 text-xs text-cinder no-underline hover:text-soot" to={`/p/${project.id}`}><ArrowLeft aria-hidden="true" /> Back to issues</Link>}
      title={<Redacted text={type || msg} tip={false} />}
      titleText={type || msg}
      titleLines={type ? 1 : 2}
      actions={<IssueTriage detail={detail} onChange={onChange} />}
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
  const statusLabel = { open: "Open", resolved: "Resolved", muted: "Muted" }[issue.status];
  return (
    <div className="mb-6">
      {type && <p className="text-base leading-relaxed text-cinder wrap-anywhere"><Redacted text={msg} /></p>}
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-cinder ${type ? "mt-3" : ""}`}>
        <Tip content="Issue status, changed by Resolve, Mute, and Reopen"><span className={`${pill} ${pillTone[issue.status]}`}>{statusLabel}</span></Tip>
        {issue.culprit && <Tag name="culprit" value={issue.culprit} mono title="Where it happened: the event's transaction, or else the innermost frame of your code" />}
        <span>Title and culprit from the first event, <TimeTip at={issue.firstSeen}><span>{ago(issue.firstSeen)}</span></TimeTip></span>
      </div>
    </div>
  );
}

function statusBanner(issue: IssueDetail["issue"]) {
  if (issue.status === "open" && issue.reopenReason) return (
    <div className={`${banner} border-[#f6cfae] bg-ember-soft text-ember-ink`}>
      <b className="font-semibold">Firing again.</b> {sentence(issue.reopenReason)}.
    </div>
  );
  if (issue.status === "resolved") return (
    <div className={`${banner} border-[#c4dbe6] bg-doused-soft text-[#1f4b60]`}>
      <b className="font-semibold">Resolved {ago(issue.resolvedAt)}.</b> Everything up to then is handled. The next event fires it again.
    </div>
  );
  if (issue.status === "muted") return (
    <div className={`${banner} border-rule bg-rule-soft text-cinder`}>
      <b className="font-semibold">{sentence(muteSummary(issue.mute))}.</b> Events keep counting, but nothing alerts.
    </div>
  );
  return null;
}
