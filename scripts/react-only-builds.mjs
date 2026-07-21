/**
 * Fork policy: only build base + react framework adapters by default.
 * Vue/Svelte/Preact package modes remain available via explicit scripts
 * but are not part of `pnpm build` / CI. Snippet switches to /react imports
 * (rollup already aliases react → preact/compat).
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", "dist", ".git", "pdfium-src", ".turbo"]);

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const NEW_BUILD =
  'pnpm run clean && concurrently -c auto -n base,react "vite build --mode base" "vite build --mode react"';

let pkgCount = 0;
for (const file of walk(ROOT).filter((f) => f.endsWith("package.json"))) {
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!pkg.scripts?.build?.includes("base,react,preact,vue,svelte")) continue;
  pkg.scripts.build = NEW_BUILD;
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  pkgCount++;
  console.log("build trimmed:", path.relative(ROOT, file));
}

let snipCount = 0;
const snippetRoot = path.join(ROOT, "viewers/snippet");
for (const file of walk(snippetRoot).filter((f) => /\.(ts|tsx|js|jsx)$/.test(f))) {
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.includes("/preact")) continue;
  const next = raw.replace(/(@embedpdf\/[A-Za-z0-9@._-]+)\/preact\b/g, "$1/react");
  if (next !== raw) {
    fs.writeFileSync(file, next);
    snipCount++;
    console.log("snippet import:", path.relative(ROOT, file));
  }
}

for (const viewer of ["vue", "svelte"]) {
  const pkgPath = path.join(ROOT, "viewers", viewer, "package.json");
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (!pkg.private) {
    pkg.private = true;
    // Don't publish these from the fork.
    delete pkg.publishConfig;
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log("marked private:", path.relative(ROOT, pkgPath));
  }
}

console.log(`done: ${pkgCount} package builds, ${snipCount} snippet files`);
