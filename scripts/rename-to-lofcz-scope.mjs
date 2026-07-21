/**
 * Plate-style fork publish rename:
 * - package name: @embedpdf/foo → @lofcz/embedpdf-foo
 * - dep keys stay @embedpdf/foo
 * - workspace values: workspace:* → workspace:@lofcz/embedpdf-foo@*
 * Source imports are left unchanged; consumers map via npm overrides.
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

function toPublishName(name) {
  if (!name?.startsWith("@embedpdf/")) return name;
  return `@lofcz/embedpdf-${name.slice("@embedpdf/".length)}`;
}

function rewriteDepValue(key, value) {
  if (!key.startsWith("@embedpdf/")) return value;
  if (typeof value !== "string") return value;
  const published = toPublishName(key);
  if (value.startsWith("workspace:@lofcz/")) return value;
  if (value === "workspace:*" || value === "workspace:^" || value === "workspace:~") {
    return `workspace:${published}@*`;
  }
  const m = value.match(/^workspace:(.+)$/);
  if (m) {
    const range = m[1];
    if (range.startsWith("@")) return value;
    return `workspace:${published}@${range}`;
  }
  return value;
}

function rewriteDepRecord(rec) {
  if (!rec || typeof rec !== "object") return false;
  let changed = false;
  for (const [key, value] of Object.entries(rec)) {
    const next = rewriteDepValue(key, value);
    if (next !== value) {
      rec[key] = next;
      changed = true;
    }
  }
  return changed;
}

let updated = 0;
for (const file of walk(ROOT)) {
  const raw = fs.readFileSync(file, "utf8");
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    continue;
  }
  let changed = false;

  if (typeof pkg.name === "string" && pkg.name.startsWith("@embedpdf/")) {
    pkg.name = toPublishName(pkg.name);
    changed = true;
  }

  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    if (rewriteDepRecord(pkg[field])) changed = true;
  }

  if (pkg.repository && typeof pkg.repository === "object" && typeof pkg.repository.url === "string") {
    if (pkg.repository.url.includes("github.com/embedpdf/embed-pdf-viewer")) {
      pkg.repository.url = pkg.repository.url.replace(
        "github.com/embedpdf/embed-pdf-viewer",
        "github.com/lofcz/embed-pdf-viewer",
      );
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
    updated++;
    console.log("updated", path.relative(ROOT, file), "->", pkg.name);
  }
}

const csPath = path.join(ROOT, ".changeset/config.json");
if (fs.existsSync(csPath)) {
  const text = fs.readFileSync(csPath, "utf8");
  let next = text.replaceAll("@embedpdf/", "@lofcz/embedpdf-");
  next = next.replaceAll('"repo": "embedpdf/embed-pdf-viewer"', '"repo": "lofcz/embed-pdf-viewer"');
  if (next !== text) {
    fs.writeFileSync(csPath, next);
    console.log("updated .changeset/config.json");
  }
}

console.log("done, package.json files updated:", updated);
