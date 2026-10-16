import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { createProject } from "../src/projects.js";

export function setup() {
  const db = openDb(":memory:");
  const app = createApp(db);
  const project = createProject(db, "web");
  return { db, app, project };
}

export const pythonError = {
  event_id: "fc6d8c0c43fc4630ad850ee518f1b9d0",
  platform: "python",
  level: "error",
  exception: {
    values: [
      {
        type: "ZeroDivisionError",
        value: "division by zero",
        stacktrace: {
          frames: [
            { filename: "lib/runner.py", function: "run", lineno: 10, in_app: false },
            { filename: "app/views.py", module: "app.views", function: "ratio", lineno: 42, in_app: true },
          ],
        },
      },
    ],
  },
};
