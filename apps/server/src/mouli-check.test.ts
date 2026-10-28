import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import {
  CHALLENGE_EXPIRES_MS,
  CHAR_SET,
  flagMouliCheck,
  getOrCreateChallenge,
  INITIAL_GRACE_PERIOD_MS,
  isMouliCheckRequired,
  randomCode,
  renderAscii,
  solveChallenge,
  VERIFIED_DURATION_MS,
} from "./mouli-check";
import { testApp } from "./test-utils";

describe("mouli-check ASCII rendering", () => {
  it("renders 4 lines of ASCII for any supported string", () => {
    const ascii = renderAscii("7K4B");
    expect(ascii).toHaveLength(4);
    // Every row should be a non-empty string of equal length
    const width = ascii[0]?.length;
    expect(width).toBeGreaterThan(15);
    for (const row of ascii) {
      expect(row.length).toBe(width);
    }
  });

  it("produces valid random codes from the non-ambiguous charset", () => {
    for (let i = 0; i < 20; i++) {
      const code = randomCode(4);
      expect(code).toHaveLength(4);
      for (const char of code) {
        expect(CHAR_SET).toContain(char);
      }
    }
  });
});

describe("mouli-check database state & verification", () => {
  const db = openDb(":memory:");
  const now = 1_000_000;
  // Create a test user
  db.prepare(
    "INSERT INTO users (id, ms_oid, pseudo, created_at) VALUES (1, 'oid-1', 'TekBot', ?)",
  ).run(now);

  it("is not required during the new account grace period", () => {
    expect(isMouliCheckRequired(db, 1, now)).toBe(false);
    expect(isMouliCheckRequired(db, 1, now + INITIAL_GRACE_PERIOD_MS)).toBe(false);
  });

  it("is required once the grace period is over, even if never flagged", () => {
    expect(isMouliCheckRequired(db, 1, now + INITIAL_GRACE_PERIOD_MS + 1)).toBe(true);
  });

  it("becomes required when flagged manually or by detection", () => {
    flagMouliCheck(db, 1);
    expect(isMouliCheckRequired(db, 1, now)).toBe(true);
  });

  it("creates a challenge and reuses active one before expiration", () => {
    const challenge1 = getOrCreateChallenge(db, 1, now);
    expect(challenge1.id).toBeDefined();
    expect(challenge1.ascii).toHaveLength(4);
    expect(challenge1.expiresIn).toBe(CHALLENGE_EXPIRES_MS / 1000);

    // Call again immediately: should return same challenge
    const challenge2 = getOrCreateChallenge(db, 1, now + 5000);
    expect(challenge2.id).toBe(challenge1.id);
  });

  it("rejects invalid answers and decrements remaining attempts", () => {
    const challenge = getOrCreateChallenge(db, 1, now);
    const res1 = solveChallenge(db, 1, challenge.id, "WRON", now);
    expect(res1).toEqual({ ok: false, error: "invalid_code", remainingAttempts: 2 });

    const res2 = solveChallenge(db, 1, challenge.id, "NOPE", now);
    expect(res2).toEqual({ ok: false, error: "invalid_code", remainingAttempts: 1 });

    const res3 = solveChallenge(db, 1, challenge.id, "FAIL", now);
    expect(res3).toEqual({ ok: false, error: "too_many_attempts" });

    // After 3 failed attempts, challenge is burned
    const res4 = solveChallenge(db, 1, challenge.id, "ANYTHING", now);
    expect(res4).toEqual({ ok: false, error: "not_found" });
  });

  it("validates correct answer (case-insensitive) and sets verified status", () => {
    const challenge = getOrCreateChallenge(db, 1, now);
    // Retrieve the secret code from the DB for testing the correct answer
    const row = db
      .prepare("SELECT raw_code FROM mouli_challenges WHERE id = ?")
      .get(challenge.id) as {
      raw_code: string;
    };

    // Answer in lowercase with extra spaces
    const res = solveChallenge(db, 1, challenge.id, `  ${row.raw_code.toLowerCase()}  `, now);
    expect(res).toEqual({ ok: true });

    // User is now unflagged and verified for 4 hours
    expect(isMouliCheckRequired(db, 1, now)).toBe(false);
    expect(isMouliCheckRequired(db, 1, now + VERIFIED_DURATION_MS - 1000)).toBe(false);

    // After 4 hours, check is required again
    expect(isMouliCheckRequired(db, 1, now + VERIFIED_DURATION_MS + 1000)).toBe(true);
  });

  it("handles expired challenges", () => {
    const challenge = getOrCreateChallenge(db, 1, now);
    const res = solveChallenge(db, 1, challenge.id, "CODE", now + CHALLENGE_EXPIRES_MS + 1000);
    expect(res).toEqual({ ok: false, error: "expired" });
  });
});

describe("mouli-check HTTP API integration", () => {
  it("blocks intents when flagged and unblocks upon solving the challenge", async () => {
    const t = await testApp();
    const token = t.player("oid-mouli-target", "MouliPlayer");
    await t.get(token, "/api/state");

    // Initially can send intent
    const okIntent = await t.intent(token, { type: "setStrictness", stage: "loc", level: 0 });
    expect(okIntent.statusCode).toBe(200);

    // Flag player for Mouli Check
    flagMouliCheck(t.db, 1);

    // Intent is now blocked with 403 mouli_check_required
    const blocked = await t.intent(token, { type: "setStrictness", stage: "loc", level: 1 });
    expect(blocked.statusCode).toBe(403);
    const body = blocked.json();
    expect(body.error).toBe("mouli_check_required");
    expect(body.challenge).toBeDefined();
    expect(body.challenge.ascii).toHaveLength(4);

    // Retrieve code to test solve endpoint
    const challengeRow = t.db
      .prepare("SELECT raw_code FROM mouli_challenges WHERE id = ?")
      .get(body.challenge.id) as { raw_code: string };

    // Wrong answer
    const failSolve = await t.app.inject({
      method: "POST",
      url: "/api/mouli-check/solve",
      headers: t.auth(token),
      payload: { id: body.challenge.id, answer: "FAIL" },
    });
    expect(failSolve.statusCode).toBe(400);
    expect(failSolve.json().error).toBe("invalid_code");
    expect(failSolve.json().remainingAttempts).toBe(2);

    // Correct answer
    const okSolve = await t.app.inject({
      method: "POST",
      url: "/api/mouli-check/solve",
      headers: t.auth(token),
      payload: { id: body.challenge.id, answer: challengeRow.raw_code },
    });
    expect(okSolve.statusCode).toBe(200);
    expect(okSolve.json()).toEqual({ ok: true });

    // Intent now passes!
    const unblocked = await t.intent(token, { type: "setStrictness", stage: "loc", level: 1 });
    expect(unblocked.statusCode).toBe(200);
  });
});
