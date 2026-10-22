import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { EntraConfig } from "./config";

// Microsoft Entra ID (OIDC) for one tenant. Web: authorization code + PKCE, CLI: device code.
// The server talks to Microsoft itself, clients only ever get an Epidle session token.

/** The only thing we keep from a Microsoft login. */
export interface Identity {
  oid: string;
}

export interface DeviceCodeStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type DevicePoll =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "ok"; identity: Identity };

export interface IdentityProvider {
  authorizeUrl(p: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }): string;
  redeemCode(p: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    nonce: string;
  }): Promise<Identity>;
  startDeviceCode(): Promise<DeviceCodeStart>;
  pollDeviceCode(deviceCode: string): Promise<DevicePoll>;
}

export class AuthError extends Error {}

// "profile" is needed for the oid claim. We read nothing else from the token.
const SCOPE = "openid profile";

export interface EntraOptions extends EntraConfig {
  fetch?: typeof fetch;
  /** Signing keys. Defaults to the tenant JWKS, cached and refreshed by jose. */
  jwks?: JWTVerifyGetKey;
}

export function createEntraProvider(opts: EntraOptions): IdentityProvider {
  const { tenantId, clientId, clientSecret } = opts;
  const doFetch = opts.fetch ?? fetch;
  const base = `https://login.microsoftonline.com/${tenantId}`;
  const issuer = `${base}/v2.0`;
  const jwks = opts.jwks ?? createRemoteJWKSet(new URL(`${base}/discovery/v2.0/keys`));

  async function post(path: string, params: Record<string, string>) {
    const body = new URLSearchParams({ client_id: clientId, ...params });
    const res = await doFetch(`${base}/oauth2/v2.0/${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, json };
  }

  async function verify(idToken: unknown, nonce: string | null): Promise<Identity> {
    if (typeof idToken !== "string") throw new AuthError("no id_token in token response");
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer,
      audience: clientId,
      algorithms: ["RS256"],
    }).catch((e: unknown) => {
      throw new AuthError(`invalid id_token: ${(e as Error).message}`);
    });
    // The issuer already pins the tenant, tid is checked on top in case of a multi-tenant mixup.
    if (payload.tid !== tenantId) throw new AuthError("wrong tenant");
    if (nonce !== null && payload.nonce !== nonce) throw new AuthError("nonce mismatch");
    if (typeof payload.oid !== "string" || payload.oid === "") throw new AuthError("no oid claim");
    return { oid: payload.oid };
  }

  const secret = (): Record<string, string> =>
    clientSecret ? { client_secret: clientSecret } : {};

  return {
    authorizeUrl({ state, nonce, codeChallenge, redirectUri }) {
      const q = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        response_mode: "query",
        redirect_uri: redirectUri,
        scope: SCOPE,
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      return `${base}/oauth2/v2.0/authorize?${q}`;
    },

    async redeemCode({ code, codeVerifier, redirectUri, nonce }) {
      const { ok, json } = await post("token", {
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        scope: SCOPE,
        ...secret(),
      });
      if (!ok) throw new AuthError(`token endpoint: ${String(json.error ?? "error")}`);
      return verify(json.id_token, nonce);
    },

    async startDeviceCode() {
      const { ok, json } = await post("devicecode", { scope: SCOPE });
      if (!ok || typeof json.device_code !== "string" || typeof json.user_code !== "string") {
        throw new AuthError(`devicecode endpoint: ${String(json.error ?? "error")}`);
      }
      return {
        deviceCode: json.device_code,
        userCode: json.user_code,
        verificationUri: String(json.verification_uri),
        expiresIn: Number(json.expires_in),
        interval: Number(json.interval ?? 5),
      };
    },

    async pollDeviceCode(deviceCode) {
      // Device code flow is a public client flow: no client secret here.
      const { ok, json } = await post("token", {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
      });
      if (ok) return { status: "ok", identity: await verify(json.id_token, null) };
      switch (json.error) {
        case "authorization_pending":
          return { status: "pending" };
        case "slow_down":
          return { status: "slow_down" };
        case "authorization_declined":
        case "access_denied":
          return { status: "denied" };
        case "expired_token":
        case "bad_verification_code":
          return { status: "expired" };
        default:
          throw new AuthError(`token endpoint: ${String(json.error ?? "error")}`);
      }
    },
  };
}
