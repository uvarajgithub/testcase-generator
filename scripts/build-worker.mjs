import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { build } from "../node_modules/vite/node_modules/esbuild/lib/main.js";

await mkdir("dist/server", { recursive: true });

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"]
]);

const assets = {};
assets["/index.html"] = {
  content: await readFile("dist/index.html", "utf8"),
  contentType: "text/html; charset=utf-8"
};

for (const file of await readdir("dist/assets")) {
  const path = join("dist", "assets", file);
  assets[`/assets/${file}`] = {
    content: await readFile(path, "utf8"),
    contentType: contentTypes.get(extname(file)) ?? "application/octet-stream"
  };
}

await writeFile(
  "server/generated-assets.ts",
  `export const STATIC_ASSETS: Record<string, { content: string; contentType: string }> = ${JSON.stringify(assets)};\n`
);

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
