import { createApi } from "@epidle/api-client";
import { render } from "ink";
import pkg from "../package.json" with { type: "json" };
import { App } from "./App";
import { parseCliArgs, USAGE } from "./args";
import { ClientContext } from "./hooks";
import { createStore, settingsPath } from "./store";
import { initColors } from "./theme";

const args = parseCliArgs(process.argv.slice(2), process.env);
if ("error" in args) {
  console.error(`${args.error}\n\n${USAGE}`);
  process.exit(2);
}
if (args.command === "help") {
  console.log(USAGE);
  process.exit(0);
}
if (args.command === "version") {
  console.log(pkg.version);
  process.exit(0);
}

const store = createStore(settingsPath(process.env), args.server);
const api = createApi({
  baseUrl: args.server,
  token: store.token,
  client: { kind: "cli", version: pkg.version },
});

if (args.command === "logout") {
  if (store.token()) await api.logout().catch(() => undefined);
  store.setToken(null);
  console.log(`Déconnecté de ${args.server}.`);
  process.exit(0);
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("Epidle se joue dans un terminal interactif.");
  process.exit(1);
}

initColors(process.env);
const app = render(
  <ClientContext.Provider value={{ api, store, server: args.server }}>
    <App />
  </ClientContext.Provider>,
  { alternateScreen: true },
);
await app.waitUntilExit();
