import { describe, expect, it } from "vitest";
import { board } from "../src/board.js";
import { eventView } from "../src/event-view.js";
import { getEvent, recordEvent } from "../src/issues.js";
import { createProject } from "../src/projects.js";
import { pythonError, setup } from "./helpers.js";

const HOUR = 3_600_000;

describe("board", () => {
  it("counts events per hour and ranks busy issues first", () => {
    const { db, project } = setup();
    const now = Date.UTC(2026, 0, 1, 12, 30);
    recordEvent(db, project.id, pythonError, now - 20 * HOUR);
    recordEvent(db, project.id, pythonError, now - 20 * HOUR);
    recordEvent(db, project.id, { message: "slow" }, now - 5 * 60_000);

    const b = board(db, { sort: "hot", q: "" }, now);
    expect(b.issues.map((i) => i.title)).toEqual(["slow", "ZeroDivisionError: division by zero"]);
    expect(b.issues[1]!.hours[3]).toBe(2);
    expect(b.issues[0]!.hours[23]).toBe(1);
    expect(b.events).toEqual({ day: 3, hour: 1 });
    expect(b.burning).toBe(1);
    expect(b.projects[0]).toMatchObject({ name: "web", openCount: 2, unresolvedDay: 3 });

    expect(board(db, { sort: "count", q: "" }, now).issues[0]!.eventCount).toBe(2);
    expect(board(db, { sort: "hot", q: "division" }, now).issues).toHaveLength(1);
  });

  it("scopes to one project and reports its pulse", () => {
    const { db, project } = setup();
    const other = createProject(db, "api");
    recordEvent(db, project.id, { ...pythonError, release: "web@1.2.0" });
    recordEvent(db, other.id, { message: "elsewhere" });
    const b = board(db, { projectId: project.id, sort: "latest", q: "" });
    expect(b.issues).toHaveLength(1);
    expect(b.project?.pulse.release).toBe("web@1.2.0");
    expect(b.openTotal).toBe(2);
  });
});

describe("eventView", () => {
  it("numbers source lines and lists the raised exception first", () => {
    const { db, project } = setup();
    const { issueId } = recordEvent(db, project.id, {
      exception: {
        values: [
          { type: "KeyError", value: "'id'" },
          {
            type: "LookupFailed",
            value: "no user",
            mechanism: { handled: false },
            stacktrace: {
              frames: [
                { filename: "app.py", function: "get", lineno: 10, in_app: true, pre_context: ["a", "b"], context_line: "c", post_context: ["d"], vars: { id: 7 } },
              ],
            },
          },
        ],
      },
      tags: { region: "eu" },
      breadcrumbs: { values: [{ timestamp: 1, category: "http", message: "GET /" }] },
    } as never);
    const v = eventView(getEvent(db, issueId)!);
    expect(v.exceptions.map((e) => e.type)).toEqual(["LookupFailed", "KeyError"]);
    expect(v.exceptions[0]!.handled).toBe("unhandled");
    expect(v.exceptions[0]!.frames[0]!.lines).toEqual([
      { no: 8, text: "a", current: false },
      { no: 9, text: "b", current: false },
      { no: 10, text: "c", current: true },
      { no: 11, text: "d", current: false },
    ]);
    expect(v.exceptions[0]!.frames[0]!.vars).toEqual([["id", "7"]]);
    expect(v.tags).toEqual([["region", "eu"]]);
    expect(v.breadcrumbs[0]).toMatchObject({ timestamp: 1000, category: "http", message: "GET /" });
  });
});
