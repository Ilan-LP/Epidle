import { describe, expect, it } from "vitest";
import { checkServerUrl, DEFAULT_SERVER_URL, parseCliArgs } from "./args";

describe("parseCliArgs", () => {
  it("plays on the default server", () => {
    expect(parseCliArgs([], {})).toEqual({ command: "play", server: DEFAULT_SERVER_URL });
  });

  it("takes --server over the environment", () => {
    const env = { EPIDLE_SERVER_URL: "https://env.example" };
    expect(parseCliArgs([], env)).toMatchObject({ server: "https://env.example" });
    expect(parseCliArgs(["--server", "https://flag.example/"], env)).toMatchObject({
      server: "https://flag.example",
    });
  });

  it("knows the other commands", () => {
    expect(parseCliArgs(["--logout"], {})).toMatchObject({ command: "logout" });
    expect(parseCliArgs(["-h"], {})).toMatchObject({ command: "help" });
    expect(parseCliArgs(["-v"], {})).toMatchObject({ command: "version" });
  });

  it("rejects unknown options", () => {
    expect(parseCliArgs(["--nope"], {})).toHaveProperty("error");
  });
});

describe("checkServerUrl", () => {
  it("keeps only the origin", () => {
    expect(checkServerUrl("https://epidle.example/some/path?x=1")).toEqual({
      url: "https://epidle.example",
    });
  });

  it("allows plain http only for a local server, the token is a bearer", () => {
    expect(checkServerUrl("http://localhost:3000")).toEqual({ url: "http://localhost:3000" });
    expect(checkServerUrl("http://127.0.0.1:3000")).toHaveProperty("url");
    expect(checkServerUrl("http://epidle.example")).toHaveProperty("error");
    expect(checkServerUrl("ftp://epidle.example")).toHaveProperty("error");
    expect(checkServerUrl("not a url")).toHaveProperty("error");
  });
});
