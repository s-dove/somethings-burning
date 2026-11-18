import { Fragment, type ReactNode } from "react";
import { t } from "../shared/i18n";
import type { ProjectPulse, ProjectRef } from "../shared/api";
import { ago, shortRelease, stamp } from "../shared/format";
import { Link } from "./common/Link";
import { Tip, TimeTip } from "./Tip";

// ProjectPulseLine is the line under a project's name: whether it is still
// reporting, and its newest release.
export function ProjectPulseLine({ project }: { project: ProjectRef & { pulse: ProjectPulse } }) {
  const { pulse } = project;
  const parts: ReactNode[] = [];
  if (pulse.lastEvent) {
    parts.push(
      <>
        {t("Last event")}{" "}
        <TimeTip at={pulse.lastEvent}>
          <span className="text-soot">{ago(pulse.lastEvent)}</span>
        </TimeTip>
      </>,
    );
  } else {
    parts.push(
      <>
        {t("No events yet.")}{" "}
        <Link to={`/p/${project.id}/settings/dsn`} className="text-soot">
          {t("Set up the DSN to start reporting.")}
        </Link>
      </>,
    );
  }
  if (pulse.release) {
    parts.push(
      <>
        {t("latest release")}{" "}
        <Tip
          content={
            <>
              {pulse.release}
              <br />
              {t("First seen {when}", { when: stamp(pulse.releaseSeen) })}
            </>
          }
        >
          <span className="mono text-soot">{shortRelease(pulse.release)}</span>
        </Tip>
      </>,
    );
  }
  return (
    <p className="mt-2 text-[13px] text-cinder">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          {p}
        </Fragment>
      ))}
    </p>
  );
}
