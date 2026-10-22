import { describe, expect, it } from "vitest";
import { GAME_NAME } from "./index";

describe("core", () => {
  it("exposes the game name", () => {
    expect(GAME_NAME).toBe("Epidle");
  });
});
