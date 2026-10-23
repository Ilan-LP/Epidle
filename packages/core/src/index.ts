// Pure, deterministic game core shared by the server and both clients.
// No IO and no clock access: time is always passed in by the caller.

export * from "./advance";
export * from "./config";
export * from "./economy";
export * from "./intents";
export * from "./modifiers";
export * from "./state";

export const GAME_NAME = "Epidle";

export type HealthResponse = {
  status: "ok";
  db: "ok";
};
