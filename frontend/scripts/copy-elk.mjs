// The ELK layout worker is served as a plain static file: bundling it through Vite breaks its GWT bootstrap.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(resolve(root, "public"), { recursive: true });
copyFileSync(
  resolve(root, "node_modules/elkjs/lib/elk-worker.min.js"),
  resolve(root, "public/elk-worker.min.js"),
);
