import { Link } from "../components/common/Link";
import { PageHeader } from "../components/PageHeader";
import { Tag } from "../components/Tag";
import { TimeTip } from "../components/Tip";
import type { IssueDetail } from "../shared/api";
import { ago, splitTitle } from "../shared/format";
import { ArrowLeft } from "../ui/icons";

// Sticky issue header: the title stays pinned as the page scrolls. The
// message and culprit are in the page body (IssueSummary).
export function IssueHeader({ detail }: { detail: IssueDetail }) {
  const { issue, project } = detail;
  const [type, msg] = splitTitle(issue.title);
  return (
    <PageHeader
      before={
        <Link className="inline-flex items-center gap-2 text-xs text-cinder no-underline hover:text-soot" to={`/p/${project.id}`}>
          <ArrowLeft aria-hidden="true" /> Back to issues
        </Link>
      }
      title={type || msg}
      titleText={type || msg}
      titleLines={type ? 1 : 2}
      spaceBelow="mb-2"
    />
  );
}

// IssueSummary opens the page body. The title above and this message and
// culprit are the issue's: set from its first event and never updated. The
// note says so, because the event payload below can differ.
export function IssueSummary({ issue }: { issue: IssueDetail["issue"] }) {
  const [type, msg] = splitTitle(issue.title);
  return (
    <div className="mb-6">
      {type && <p className="text-base leading-relaxed wrap-anywhere text-cinder">{msg}</p>}
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-cinder ${type ? "mt-3" : ""}`}>
        {issue.culprit && (
          <Tag name="culprit" value={issue.culprit} mono title="Where it happened: the event's culprit, or else the innermost frame of your code" />
        )}
        <span>
          Title and culprit from the first event,{" "}
          <TimeTip at={issue.firstSeen}>
            <span>{ago(issue.firstSeen)}</span>
          </TimeTip>
        </span>
      </div>
    </div>
  );
}
