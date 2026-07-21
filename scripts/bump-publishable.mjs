/**
 * Bump version on packages that `ci:publish` ships (packages/** + react + snippet).
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const from = process.argv[2] || "2.14.4";
const to = process.argv[3] || "2.14.5";

const targets = [
  ...walkPkgJson(path.join(ROOT, "packages")),
  path.join(ROOT, "viewers/react/package.json"),
  path.join(ROOT, "viewers/snippet/package.json"),
];

function walkPkgJson(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === "pdfium-src") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkPkgJson(p, acc);
    else if (e.name === "package.json") acc.push(p);
  }
  return acc;
}

let n = 0;
for (const file of targets) {
  if (!fs.existsSync(file)) continue;
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (pkg.private) continue;
  if (pkg.version !== from) continue;
  // Skip non-publishable tooling / ignored packages by name convention if needed
  if (pkg.name === "@lofcz/embedpdf-build") continue;
  pkg.version = to;
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  n++;
  console.log(`${pkg.name}: ${from} → ${to}`);
}
console.log(`bumped ${n} packages`);
