import { describe, expect, it } from "vitest";
import { ApiError, createApi, newRequestId } from "./api";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("createApi", () => {
  it("sends the bearer token and the base url", async () => {
    const { fn, calls } = fakeFetch(200, { pseudo: "neo" });
    const api = createApi({ baseUrl: "http://srv:3000/", token: () => "tok", fetch: fn });
    expect(await api.me()).toEqual({ pseudo: "neo" });
    expect(calls[0]?.url).toBe("http://srv:3000/api/me");
    expect(calls[0]?.init.headers).toHaveProperty("authorization", "Bearer tok");
  });

  it("sends no authorization header without a token", async () => {
    const { fn, calls } = fakeFetch(200, {});
    await createApi({ fetch: fn }).state();
    expect(calls[0]?.url).toBe("/api/state");
    expect(calls[0]?.init.headers).not.toHaveProperty("authorization");
  });

  it("adds a fresh requestId to every intent", async () => {
    const { fn, calls } = fakeFetch(200, {});
    const api = createApi({ fetch: fn });
    await api.intent({ type: "buyRoom" });
    await api.intent({ type: "buyRoom" });
    const ids = calls.map((c) => JSON.parse(String(c.init.body)).requestId);
    expect(ids[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("turns error responses into ApiError with the server message", async () => {
    const { fn } = fakeFetch(410, { error: "login_expired", message: "La connexion a expiré." });
    const err = await createApi({ fetch: fn })
      .devicePoll("h")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 410, code: "login_expired" });
  });

  it("reports a network failure as status 0", async () => {
    const fn = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(createApi({ fetch: fn }).me()).rejects.toMatchObject({ status: 0 });
  });
});

it("newRequestId gives 128 bits of hex", () => {
  expect(newRequestId()).toMatch(/^[0-9a-f]{32}$/);
});
