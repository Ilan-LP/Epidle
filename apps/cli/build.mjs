// Bundles the CLI into dist/epidle.js. `--publish` (run by prepack) bakes the production server
// in and refuses to build without one: a published CLI pointing to localhost cannot play.
import { build } from "esbuild";

const publish = process.argv.includes("--publish");
const server = process.env.EPIDLE_PUBLISH_SERVER_URL;
if (publish && !server?.startsWith("https://")) {
  console.error("Set EPIDLE_PUBLISH_SERVER_URL=https://<EPIDLE_SITE> to build the published CLI.");
  process.exit(1);
}

await build({
  entryPoints: ["src/index.tsx"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  jsx: "automatic",
  external: ["chalk", "ink", "react"],
  banner: { js: "#!/usr/bin/env node" },
  outfile: "dist/epidle.js",
  define: server ? { __DEFAULT_SERVER_URL__: JSON.stringify(server) } : {},
});
