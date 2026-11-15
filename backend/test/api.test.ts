import { describe, expect, it } from "vitest";
import { setup } from "./helpers.js";

describe("api", () => {
  it("reports health", async () => {
    const { app } = await setup();
    const res = await app.request("/api/health");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("creates, lists, renames, and deletes projects", async () => {
    const { app } = await setup();
    const created = await app.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json", host: "burning.example.com" },
      body: JSON.stringify({ name: " api " }),
    });
    expect(created.status).toBe(201);
    const { project } = (await created.json()) as { project: { id: number; name: string; publicKey: string; dsn: string } };
    expect(project.name).toBe("api");
    expect(project.dsn).toBe(`http://${project.publicKey}@burning.example.com/${project.id}`);

    const list = (await (await app.request("/api/projects")).json()) as { projects: { name: string }[] };
    expect(list.projects.map((p) => p.name)).toEqual(["api", "web"]);

    const renamed = await app.request(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "backend" }),
    });
    expect(((await renamed.json()) as { project: { name: string } }).project.name).toBe("backend");

    expect((await app.request(`/api/projects/${project.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await app.request(`/api/projects/${project.id}`)).status).toBe(404);
  });

  it("rejects a project without a name", async () => {
    const { app } = await setup();
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  " }),
    });
    expect(res.status).toBe(400);
  });
});
