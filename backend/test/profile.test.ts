import { describe, expect, it } from "vitest";
import { clientAuthFor, groupsFromClaims } from "../src/auth.js";
import { as, json, setup, signIn } from "./helpers.js";

describe("profile", () => {
  it("shows the claims Burning keeps, without the token's own", async () => {
    const s = await setup({ auth: true });
    await signIn(s.db, "ana@example.com", { preferred_username: "ana", name: "Ana", exp: 2_000_000_000, aud: "burning", locale: "en" });
    const p = (await (await s.app.request("/api/profile", { headers: as("ana@example.com", ["eng"]) })).json()) as {
      username: string;
      name: string;
      groups: string[];
      claims: [string, string][];
    };
    expect(p).toMatchObject({ username: "ana", name: "Ana", groups: ["eng"] });
    expect(p.claims.map(([k]) => k).sort()).toEqual(["email", "locale", "name", "preferred_username"]);
  });

  it("sets the display name, and empty goes back to the username", async () => {
    const s = await setup({ auth: true });
    await signIn(s.db, "ana@example.com", { preferred_username: "ana" });
    const put = (displayName: string) => s.app.request("/api/profile", { method: "PUT", ...json({ displayName }, as("ana@example.com")) });
    expect(await (await put(" Ana B. ")).json()).toMatchObject({ displayName: "Ana B.", shownAs: "Ana B." });
    expect(await (await put("")).json()).toMatchObject({ displayName: "", shownAs: "ana" });
    expect((await put("x".repeat(81))).status).toBe(400);
  });

  it("asks to sign in again when the person has no saved record", async () => {
    const s = await setup();
    expect((await s.app.request("/api/profile")).status).toBe(404);
  });

  it("reads groups as a list or a space-separated string", async () => {
    expect(groupsFromClaims({ groups: ["a", "", "b"] }, "groups")).toEqual(["a", "b"]);
    expect(groupsFromClaims({ roles: "a  b" }, "roles")).toEqual(["a", "b"]);
    expect(groupsFromClaims({}, "groups")).toEqual([]);
  });
});

describe("OIDC client authentication", () => {
  // What a client authentication adds to a token request.
  const sent = (auth: ReturnType<typeof clientAuthFor>) => {
    const body = new URLSearchParams();
    const headers = new Headers();
    auth({ issuer: "https://issuer.example.com" }, { client_id: "burning" }, body, headers);
    if (headers.get("authorization")?.startsWith("Basic ")) return "basic";
    if (body.get("client_secret")) return "post";
    return body.get("client_id") ? "none" : "?";
  };

  it("defaults to basic with a secret and none without, and checks the setting", async () => {
    expect(sent(clientAuthFor({ clientSecret: "s", clientAuth: "" }))).toBe("basic");
    expect(sent(clientAuthFor({ clientSecret: "", clientAuth: "" }))).toBe("none");
    expect(sent(clientAuthFor({ clientSecret: "s", clientAuth: "client_secret_post" }))).toBe("post");
    expect(() => clientAuthFor({ clientSecret: "", clientAuth: "client_secret_post" })).toThrow(/needs BURNING_OIDC_CLIENT_SECRET/);
    expect(() => clientAuthFor({ clientSecret: "s", clientAuth: "private_key_jwt" })).toThrow(/must be one of/);
  });
});
