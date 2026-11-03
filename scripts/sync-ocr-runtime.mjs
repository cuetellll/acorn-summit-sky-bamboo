import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dest = path.join(root, "public/ocr");
await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(path.join(root, "node_modules/tesseract.js/dist/worker.min.js"), path.join(dest, "worker.min.js"));
const core = path.join(root, "node_modules/tesseract.js-core");
for (const name of await readdir(core)) {
  const keep =
    name.startsWith("tesseract-core") &&
    name.includes("lstm") &&
    (name.endsWith(".wasm") || name.endsWith(".wasm.js"));
  if (!keep) continue;
  await cp(path.join(core, name), path.join(dest, name));
}
