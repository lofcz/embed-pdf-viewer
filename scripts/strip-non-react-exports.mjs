/**
 * Drop preact/vue/svelte package exports + peerDeps from publishable packages.
 * Keeps optional build:* scripts for manual use; default build stays base+react.
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
    else if (e.name === "package.json") acc.push(p);
  }
  return acc;
}

let n = 0;
for (const file of walk(path.join(ROOT, "packages"))) {
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  let changed = false;

  if (pkg.exports && typeof pkg.exports === "object") {
    for (const key of ["./preact", "./vue", "./svelte"]) {
      if (key in pkg.exports) {
        delete pkg.exports[key];
        changed = true;
      }
    }
  }

  if (pkg.peerDependencies) {
    for (const key of ["preact", "vue", "svelte"]) {
      if (key in pkg.peerDependencies) {
        delete pkg.peerDependencies[key];
        changed = true;
      }
    }
    if (Object.keys(pkg.peerDependencies).length === 0) {
      delete pkg.peerDependencies;
      changed = true;
    }
  }

  if (pkg.peerDependenciesMeta) {
    for (const key of ["preact", "vue", "svelte"]) {
      if (key in pkg.peerDependenciesMeta) {
        delete pkg.peerDependenciesMeta[key];
        changed = true;
      }
    }
    if (Object.keys(pkg.peerDependenciesMeta).length === 0) {
      delete pkg.peerDependenciesMeta;
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
    n++;
    console.log("stripped", path.relative(ROOT, file));
  }
}

console.log("updated", n, "packages");
