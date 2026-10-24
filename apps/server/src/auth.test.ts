import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { openDb } from "./db";
import { fakeProvider, testApp } from "./test-utils";

let t: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.app.close());

/** Starts a web login and returns the state and the cookie the browser would keep. */
async function startWebLogin() {
  const res = await t.app.inject({ method: "GET", url: "/api/auth/login" });
  expect(res.statusCode).toBe(302);
  const url = new URL(res.headers.location as string);
  const cookie = res.cookies.find((c) => c.name === "epidle_login");
  return {
    url,
    state: url.searchParams.get("state") as string,
    loginCookie: cookie?.value as string,
  };
}

const callback = (state: string, code: string, loginCookie?: string) =>
  t.app.inject({
    method: "GET",
    url: `/api/auth/callback?${new URLSearchParams({ state, code })}`,
    cookies: loginCookie ? { epidle_login: loginCookie } : {},
  });

describe("web login (authorization code + PKCE)", () => {
  it("redirects to Microsoft with PKCE, then sets a session cookie", async () => {
    const { url, state, loginCookie } = await startWebLogin();
    expect(url.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:5173/api/auth/callback");
    t.fake.codes.set("good", "oid-alice");

    const res = await callback(state, "good", loginCookie);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("http://localhost:5173/");
    const session = res.cookies.find((c) => c.name === "epidle_session");
    expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax" });
    expect(t.fake.nonces).toEqual([url.searchParams.get("nonce")]);

    const me = await t.app.inject({
      method: "GET",
      url: "/api/me",
      cookies: { epidle_session: session?.value ?? "" },
    });
    expect(me.json()).toEqual({ pseudo: null });
    // Only the Microsoft object id is stored.
    expect(t.db.prepare("SELECT * FROM users").all()).toEqual([
      {
        id: 1,
        ms_oid: "oid-alice",
        pseudo: null,
        created_at: t.clock.t,
        pseudo_key: null,
        pseudo_changed_at: null,
      },
    ]);
  });

  it("rejects a callback without the browser cookie (login CSRF) or with a reused state", async () => {
    const { state } = await startWebLogin();
    t.fake.codes.set("good", "oid-alice");
    expect((await callback(state, "good")).headers.location).toContain("login=error");

    const second = await startWebLogin();
    t.fake.codes.set("good2", "oid-alice");
    expect((await callback(second.state, "good2", second.loginCookie)).headers.location).toBe(
      "http://localhost:5173/",
    );
    t.fake.codes.set("good3", "oid-alice");
    const reused = await callback(second.state, "good3", second.loginCookie);
    expect(reused.headers.location).toContain("login=error");
  });

  it("rejects an expired login and a code Microsoft refuses", async () => {
    const a = await startWebLogin();
    t.clock.t += 11 * 60_000;
    t.fake.codes.set("good", "oid-alice");
    expect((await callback(a.state, "good", a.loginCookie)).headers.location).toContain(
      "login=error",
    );
    const b = await startWebLogin();
    expect((await callback(b.state, "unknown", b.loginCookie)).headers.location).toContain(
      "login=error",
    );
    expect(t.db.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });
});

describe("web login rate limit", () => {
  it("lets a whole campus behind one IP log in, then sends the browser back to the login page", async () => {
    // 300 web logins (login + callback) in the same minute from one IP all go through.
    const codes = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const { state, loginCookie } = await startWebLogin();
      t.fake.codes.set(`code${i}`, `oid-${i}`);
      codes.add((await callback(state, `code${i}`, loginCookie)).statusCode);
    }
    expect([...codes]).toEqual([302]);
    expect(t.db.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 300 });
    // Past 600 a minute on a route: a redirect to the login page with its error, not a JSON page.
    for (let i = 300; i < 600; i++) await t.app.inject({ method: "GET", url: "/api/auth/login" });
    const limited = await t.app.inject({ method: "GET", url: "/api/auth/login" });
    expect(limited.statusCode).toBe(302);
    expect(limited.headers.location).toBe("http://localhost:5173/?login=error");
  });
});

describe("CLI login (device code)", () => {
  it("stays pending until approved, then returns a bearer token", async () => {
    const start = (await t.app.inject({ method: "POST", url: "/api/auth/device" })).json();
    expect(start).toMatchObject({
      userCode: "CODE1",
      verificationUri: "https://microsoft.com/devicelogin",
    });
    expect(JSON.stringify(start)).not.toContain("dc1"); // the Microsoft device code stays server side
    const poll = () =>
      t.app.inject({
        method: "POST",
        url: "/api/auth/device/token",
        payload: { handle: start.handle },
      });
    expect((await poll()).json()).toMatchObject({ status: "pending" });
    t.fake.approve("CODE1", "oid-bob");
    const done = (await poll()).json();
    expect(done.status).toBe("ok");
    expect((await t.get(done.token, "/api/me")).json()).toEqual({ pseudo: null });
    // The handle is single use.
    expect((await poll()).statusCode).toBe(410);
  });

  it("reports denied logins and unknown handles", async () => {
    const start = (await t.app.inject({ method: "POST", url: "/api/auth/device" })).json();
    t.fake.setResult("CODE1", { status: "denied" });
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/device/token",
      payload: { handle: start.handle },
    });
    expect(res.statusCode).toBe(403);
    const unknown = await t.app.inject({
      method: "POST",
      url: "/api/auth/device/token",
      payload: { handle: "nope" },
    });
    expect(unknown.statusCode).toBe(410);
  });
});

describe("Microsoft unreachable", () => {
  const down = async () => {
    throw new TypeError("fetch failed");
  };

  it("answers 503 to the CLI and keeps the login pending", async () => {
    const start = t.fake.provider.startDeviceCode;
    t.fake.provider.startDeviceCode = down;
    const failed = await t.app.inject({ method: "POST", url: "/api/auth/device" });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error).toBe("auth_unavailable");
    t.fake.provider.startDeviceCode = start;

    const { handle, userCode } = (
      await t.app.inject({ method: "POST", url: "/api/auth/device" })
    ).json();
    const poll = t.fake.provider.pollDeviceCode;
    t.fake.provider.pollDeviceCode = down;
    const poll503 = await t.app.inject({
      method: "POST",
      url: "/api/auth/device/token",
      payload: { handle },
    });
    expect(poll503.statusCode).toBe(503);
    t.fake.provider.pollDeviceCode = poll;
    t.fake.approve(userCode, "oid-alice");
    const ok = await t.app.inject({
      method: "POST",
      url: "/api/auth/device/token",
      payload: { handle },
    });
    expect(ok.json().status).toBe("ok");
  });

  it("sends the browser back to the login page", async () => {
    const { state, loginCookie } = await startWebLogin();
    t.fake.provider.redeemCode = down;
    const res = await callback(state, "any", loginCookie);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("http://localhost:5173/?login=error");
  });
});

describe("sessions", () => {
  it("logout everywhere ends every session of the player, only theirs", async () => {
    const laptop = await t.login("oid-a", "Alice");
    const cli = await t.login("oid-a");
    const bob = await t.login("oid-b", "Bobby");
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/logout?all=1",
      headers: t.auth(laptop),
    });
    expect(res.statusCode).toBe(204);
    expect((await t.get(laptop, "/api/me")).statusCode).toBe(401);
    expect((await t.get(cli, "/api/me")).statusCode).toBe(401);
    expect((await t.get(bob, "/api/me")).statusCode).toBe(200);
  });

  it("uses a __Host- cookie on https", async () => {
    const fake = fakeProvider();
    const app = await buildApp({
      db: openDb(":memory:"),
      provider: fake.provider,
      publicUrl: "https://epidle.example.org",
    });
    const start = await app.inject({ method: "GET", url: "/api/auth/login" });
    const state = new URL(start.headers.location as string).searchParams.get("state") as string;
    fake.codes.set("good", "oid-a");
    const res = await app.inject({
      method: "GET",
      url: `/api/auth/callback?state=${state}&code=good`,
      cookies: { epidle_login: start.cookies.find((c) => c.name === "epidle_login")?.value ?? "" },
    });
    const cookie = res.cookies.find((c) => c.name === "__Host-epidle_session");
    expect(cookie).toMatchObject({ secure: true, httpOnly: true, path: "/" });
    expect(cookie).not.toHaveProperty("domain");
    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      cookies: { "__Host-epidle_session": cookie?.value ?? "" },
    });
    expect(me.statusCode).toBe(200);
    await app.close();
  });

  it("logout revokes the token", async () => {
    const token = await t.login("oid-1");
    expect((await t.get(token, "/api/me")).statusCode).toBe(200);
    await t.app.inject({ method: "POST", url: "/api/auth/logout", headers: t.auth(token) });
    expect((await t.get(token, "/api/me")).statusCode).toBe(401);
  });

  it("expire after 30 days", async () => {
    const token = await t.login("oid-1");
    t.clock.t += 31 * 24 * 3600 * 1000;
    expect((await t.get(token, "/api/me")).statusCode).toBe(401);
  });

  it("logging in again with the same Microsoft account reuses the player", async () => {
    await t.login("oid-1", "Alice");
    const again = await t.login("oid-1");
    expect((await t.get(again, "/api/me")).json()).toEqual({ pseudo: "Alice" });
  });
});
