// Test helpers: an in-memory app with a fake Microsoft and a controllable clock.
import { buildApp } from "./app";
import { createSession, upsertUser } from "./auth";
import { LEGACY_CLIENT } from "./client-version";
import { openDb } from "./db";
import { AuthError, type DevicePoll, type IdentityProvider } from "./entra";
import { NO_MODIFIERS, type Rotation } from "./modifiers";
import { setPseudo } from "./pseudo";
import { runMaintenance } from "./seasons";

export function fakeProvider() {
  /** Authorization codes the fake Microsoft will accept, mapped to the oid they log in. */
  const codes = new Map<string, string>();
  const devices = new Map<string, { userCode: string; result: DevicePoll }>();
  const nonces: string[] = [];
  let n = 0;
  const provider: IdentityProvider = {
    authorizeUrl: ({ state, nonce, codeChallenge, redirectUri }) =>
      `https://login.test/authorize?${new URLSearchParams({ state, nonce, code_challenge: codeChallenge, redirect_uri: redirectUri })}`,
    async redeemCode({ code, nonce }) {
      const oid = codes.get(code);
      codes.delete(code);
      if (!oid) throw new AuthError("unknown code");
      nonces.push(nonce);
      return { oid };
    },
    async startDeviceCode() {
      n++;
      devices.set(`dc${n}`, { userCode: `CODE${n}`, result: { status: "pending" } });
      return {
        deviceCode: `dc${n}`,
        userCode: `CODE${n}`,
        verificationUri: "https://microsoft.com/devicelogin",
        expiresIn: 900,
        interval: 0,
      };
    },
    async pollDeviceCode(deviceCode) {
      return devices.get(deviceCode)?.result ?? { status: "expired" };
    },
  };
  const setResult = (userCode: string, result: DevicePoll) => {
    for (const d of devices.values()) if (d.userCode === userCode) d.result = result;
  };
  return {
    provider,
    codes,
    nonces,
    approve: (userCode: string, oid: string) =>
      setResult(userCode, { status: "ok", identity: { oid } }),
    setResult,
  };
}

/** Requests in tests send no client header; client-version.test.ts covers the real minimums. */
export const LEGACY_MIN_VERSIONS = { cli: LEGACY_CLIENT, web: "0.0.0" };

export const T0 = Date.UTC(2026, 9, 1);
/** Core durations are in seconds, the clock is in ms. */
export const MS = 1000;

export async function testApp({ rotation = NO_MODIFIERS }: { rotation?: Rotation } = {}) {
  const db = openDb(":memory:");
  const clock = { t: T0 };
  const fake = fakeProvider();
  const app = await buildApp({
    db,
    provider: fake.provider,
    publicUrl: "http://localhost:5173",
    now: () => clock.t,
    rotation,
    minVersions: LEGACY_MIN_VERSIONS,
  });
  // What the server does at boot: the first season starts at T0.
  runMaintenance(db, clock.t, rotation);
  let requestIds = 0;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  // Tests move the clock by hours: keep the Mouli Check, tested in mouli-check.test.ts, out of the way.
  const skipMouliCheck = (userId: number) =>
    db
      .prepare("INSERT OR IGNORE INTO mouli_status (user_id, verified_until) VALUES (?, ?)")
      .run(userId, Number.MAX_SAFE_INTEGER);

  /** Logs in through the device code flow, then picks a pseudo if given. Returns the token. */
  async function login(oid: string, pseudo?: string): Promise<string> {
    const start = await app.inject({ method: "POST", url: "/api/auth/device" });
    const { handle, userCode } = start.json();
    fake.approve(userCode, oid);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/device/token",
      payload: { handle },
    });
    const { token } = res.json();
    const user = db.prepare("SELECT id FROM users WHERE ms_oid = ?").get(oid) as { id: number };
    skipMouliCheck(user.id);
    if (pseudo) {
      await app.inject({
        method: "PUT",
        url: "/api/me/pseudo",
        headers: auth(token),
        payload: { pseudo },
      });
    }
    return token;
  }

  /** Creates a player straight in the database: no login round trips, no auth rate limit. */
  function player(oid: string, pseudo: string): string {
    const id = upsertUser(db, { oid }, clock.t);
    setPseudo(db, id, pseudo, clock.t);
    skipMouliCheck(id);
    return createSession(db, id, clock.t);
  }

  const intent = (token: string, body: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: "/api/intent",
      headers: auth(token),
      payload: { requestId: `req-${++requestIds}-test`, ...body },
    });

  const get = (token: string, url: string) =>
    app.inject({ method: "GET", url, headers: auth(token) });

  /** What the maintenance job does every minute: rollover and live scores. */
  const refresh = () => runMaintenance(db, clock.t, rotation);

  return { app, db, clock, fake, auth, login, player, intent, get, refresh };
}
