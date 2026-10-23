import { expect, it } from "vitest";
import { openerCommand } from "./browser";

it("opens the URL without going through a shell", () => {
  const url = "https://microsoft.com/devicelogin?a=1&b=2";
  expect(openerCommand("linux", url)).toEqual(["xdg-open", [url]]);
  expect(openerCommand("darwin", url)).toEqual(["open", [url]]);
  // "cmd /c start" would run what follows the "&".
  expect(openerCommand("win32", url)).toEqual(["rundll32", ["url.dll,FileProtocolHandler", url]]);
});
