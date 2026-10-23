import { spawn } from "node:child_process";

/** Command that opens `url` in the default browser. */
export function openerCommand(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === "darwin") return ["open", [url]];
  // Not "cmd /c start": cmd would interpret "&" in the URL.
  if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  return ["xdg-open", [url]];
}

/** Best effort: on a remote machine (ssh) there may be no browser, the URL is shown anyway. */
export function openBrowser(url: string): void {
  // The URL comes from the server: only ever open a web page.
  if (!URL.canParse(url) || new URL(url).protocol !== "https:") return;
  const [cmd, args] = openerCommand(process.platform, url);
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // No opener installed.
  }
}
