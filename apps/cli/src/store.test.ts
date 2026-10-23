import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createStore, readSettings, settingsPath } from "./store";

const tmpFile = () => join(mkdtempSync(join(tmpdir(), "epidle-")), "sub", "config.json");

describe("settingsPath", () => {
  it("follows the platform conventions", () => {
    expect(settingsPath({}, "linux", "/home/a")).toBe("/home/a/.config/epidle/config.json");
    expect(settingsPath({ XDG_CONFIG_HOME: "/x" }, "linux", "/home/a")).toBe(
      "/x/epidle/config.json",
    );
    expect(settingsPath({ APPDATA: "C:\\AppData" }, "win32", "C:\\Users\\a")).toContain("epidle");
    expect(settingsPath({ EPIDLE_CONFIG: "/tmp/e.json" }, "linux", "/home/a")).toBe("/tmp/e.json");
  });
});

describe("createStore", () => {
  it("keeps one token per server, in a file only the owner can read", () => {
    const file = tmpFile();
    const a = createStore(file, "https://a.example");
    const b = createStore(file, "https://b.example");
    a.setToken("tok-a");
    b.setToken("tok-b");
    expect(readSettings(file).sessions).toEqual({
      "https://a.example": "tok-a",
      "https://b.example": "tok-b",
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    a.setToken(null);
    expect(createStore(file, "https://a.example").token()).toBeNull();
    expect(createStore(file, "https://b.example").token()).toBe("tok-b");
  });

  it("remembers the language", () => {
    const file = tmpFile();
    createStore(file, "https://a.example").setLanguage("rust");
    expect(createStore(file, "https://a.example").language()).toBe("rust");
    expect(JSON.parse(readFileSync(file, "utf8")).language).toBe("rust");
  });

  it("starts fresh from a missing or corrupted file", () => {
    const file = join(mkdtempSync(join(tmpdir(), "epidle-")), "config.json");
    expect(readSettings(file)).toEqual({ sessions: {} });
    writeFileSync(file, "{nope");
    expect(readSettings(file)).toEqual({ sessions: {} });
    writeFileSync(file, JSON.stringify({ sessions: { x: 42 }, language: 1 }));
    expect(readSettings(file)).toEqual({ sessions: {}, language: undefined });
  });
});
