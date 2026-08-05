import { mkdir } from "node:fs/promises";
import { build } from "../node_modules/vite/node_modules/esbuild/lib/main.js";

await mkdir("dist/server", { recursive: true });

await build({
  entryPoints: ["server/worker.ts"],
  outfile: "dist/server/index.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  mainFields: ["browser", "module", "main"],
  conditions: ["browser", "worker"],
  sourcemap: false,
  minify: false,
  external: ["node:*"]
});
