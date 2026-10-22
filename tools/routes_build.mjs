// Writes worker/routes.json from the Worker's ROUTES: node tools/routes_build.mjs
import { registerHooks } from "node:module";
import { writeFileSync } from "node:fs";
registerHooks({
  load(url, ctx, next) {
    return next(url, url.endsWith(".json") ? { ...ctx, importAttributes: { type: "json" } } : ctx);
  },
});
const { ROUTES } = await import(new URL("../worker/worker.js", import.meta.url));
writeFileSync(new URL("../worker/routes.json", import.meta.url), JSON.stringify(ROUTES, null, 2) + "\n");
