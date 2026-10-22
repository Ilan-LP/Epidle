import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { AuthError, createEntraProvider } from "./entra";

// Fake ids for the tests only, not the real Epitech tenant.
const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }],
  });
});

const idToken = (claims: JWTPayload, { issuer = ISSUER, audience = CLIENT } = {}) =>
  new SignJWT({ tid: TENANT, oid: "oid-1", nonce: "n1", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);

/** A fetch that answers every call with `body` and records the requests. */
function mockFetch(status: number, body: object) {
  const calls: { url: string; params: URLSearchParams }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, params: new URLSearchParams(String(init.body)) });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function provider(status: number, body: object, clientSecret?: string) {
  const f = mockFetch(status, body);
  return {
    p: createEntraProvider({ tenantId: TENANT, clientId: CLIENT, clientSecret, fetch: f.fn, jwks }),
    calls: f.calls,
  };
}

const redeem = (p: ReturnType<typeof provider>["p"]) =>
  p.redeemCode({ code: "c", codeVerifier: "v", redirectUri: "http://x/cb", nonce: "n1" });

describe("Entra provider", () => {
  it("builds a tenant-specific authorize URL with PKCE", () => {
    const { p } = provider(200, {});
    const url = new URL(
      p.authorizeUrl({ state: "s", nonce: "n", codeChallenge: "ch", redirectUri: "http://x/cb" }),
    );
    expect(url.origin + url.pathname).toBe(
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: CLIENT,
      response_type: "code",
      code_challenge: "ch",
      code_challenge_method: "S256",
      state: "s",
      nonce: "n",
    });
  });

  it("redeems a code and keeps only the oid", async () => {
    const { p, calls } = provider(200, { id_token: await idToken({ name: "Jean Dupont" }) }, "shh");
    expect(await redeem(p)).toEqual({ oid: "oid-1" });
    expect(calls[0]?.params.get("code_verifier")).toBe("v");
    expect(calls[0]?.params.get("client_secret")).toBe("shh");
  });

  it("rejects tokens from another tenant, app, issuer, or with a wrong nonce", async () => {
    const bad = [
      await idToken({ tid: OTHER_TENANT }),
      await idToken({}, { audience: "someone-else" }),
      await idToken({}, { issuer: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0` }),
      await idToken({ nonce: "replayed" }),
      await idToken({ oid: undefined }),
    ];
    for (const token of bad) {
      await expect(redeem(provider(200, { id_token: token }).p)).rejects.toBeInstanceOf(AuthError);
    }
  });

  it("rejects a token signed with another key", async () => {
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({ tid: TENANT, oid: "x", nonce: "n1" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT)
      .setExpirationTime("1h")
      .sign(other.privateKey);
    await expect(redeem(provider(200, { id_token: forged }).p)).rejects.toBeInstanceOf(AuthError);
  });

  it("maps device code poll answers", async () => {
    expect(await provider(400, { error: "authorization_pending" }).p.pollDeviceCode("d")).toEqual({
      status: "pending",
    });
    expect(await provider(400, { error: "slow_down" }).p.pollDeviceCode("d")).toEqual({
      status: "slow_down",
    });
    expect(await provider(400, { error: "authorization_declined" }).p.pollDeviceCode("d")).toEqual({
      status: "denied",
    });
    expect(await provider(400, { error: "expired_token" }).p.pollDeviceCode("d")).toEqual({
      status: "expired",
    });
    const { p, calls } = provider(200, { id_token: await idToken({ nonce: undefined }) }, "shh");
    expect(await p.pollDeviceCode("d")).toEqual({ status: "ok", identity: { oid: "oid-1" } });
    expect(calls[0]?.params.get("client_secret")).toBeNull();
  });
});
