// Pure, deterministic game core shared by the server and both clients.
// No IO and no clock access: time is always passed in by the caller.

export const GAME_NAME = "Epidle";

export type HealthResponse = {
  status: "ok";
  db: "ok";
};
