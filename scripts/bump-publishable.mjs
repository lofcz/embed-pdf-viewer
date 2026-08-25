/**
 * Bump publishable fork packages.
 *
 * Usage:
 *   node scripts/bump-publishable.mjs patch|minor|major
 *
 * Stack packages share one version (including 3.0.0-next.N).
 * `patch` on a next line increments the next counter (3.0.0-next.7 → 3.0.0-next.8).
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const arg1 = process.argv[2];

const STACK_PREFIXES = [
  "@lofcz/embedpdf-core",
  "@lofcz/embedpdf-engine",
  "@lofcz/embedpdf-react",
  "@lofcz/embedpdf-web",
  "@lofcz/embedpdf-plugin-",
  "@lofcz/embedpdf-viewer",
];

const DENY = new Set([
  "@lofcz/embedpdf-tooling-build",
  "@lofcz/embedpdf-angular",
  "@lofcz/embedpdf-engine-runtime-darwin-arm64",
  "@lofcz/embedpdf-engine-runtime-darwin-x64",
  "@lofcz/embedpdf-engine-runtime-linux-arm64",
  "@lofcz/embedpdf-engine-runtime-linux-x64",
  "@lofcz/embedpdf-engine-runtime-linuxmusl-arm64",
  "@lofcz/embedpdf-engine-runtime-linuxmusl-x64",
  "@lofcz/embedpdf-engine-runtime-win32-arm64",
  "@lofcz/embedpdf-engine-runtime-win32-x64",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "examples",
  "pdfium-src",
  "runtime-src",
  ".turbo",
  ".next",
]);

function walkPkgJson(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkPkgJson(p, acc);
    else if (e.name === "package.json") acc.push(p);
  }
  return acc;
}

function bumpSemver(version, type) {
  const next = String(version).match(/^(\d+)\.(\d+)\.(\d+)-next\.(\d+)$/);
  if (next) {
    const major = Number(next[1]);
    const minor = Number(next[2]);
    const patch = Number(next[3]);
    const n = Number(next[4]);
    if (type === "major") return `${major + 1}.0.0-next.0`;
    if (type === "minor") return `${major}.${minor + 1}.0-next.0`;
    if (type === "patch") return `${major}.${minor}.${patch}-next.${n + 1}`;
    throw new Error(`Unknown bump type: ${type}`);
  }

  const m = String(version).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`Invalid version: ${version}`);
  let major = Number(m[1]);
  let minor = Number(m[2]);
  let patch = Number(m[3]);
  if (type === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (type === "minor") {
    minor += 1;
    patch = 0;
  } else if (type === "patch") {
    patch += 1;
  } else {
    throw new Error(`Unknown bump type: ${type}`);
  }
  return `${major}.${minor}.${patch}`;
}

function isStack(name) {
  if (DENY.has(name)) return false;
  return STACK_PREFIXES.some((p) => name === p || name.startsWith(p));
}

const targets = walkPkgJson(path.join(ROOT, "packages"));
const releaseTypes = new Set(["patch", "minor", "major"]);

if (!releaseTypes.has(arg1)) {
  console.error("Usage: node scripts/bump-publishable.mjs patch|minor|major");
  process.exit(1);
}

const viewerPkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "packages/viewer/react/package.json"), "utf8"),
);
const stackFrom = viewerPkg.version;
const stackTo = bumpSemver(stackFrom, arg1);

let n = 0;
for (const file of targets) {
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (pkg.private || DENY.has(pkg.name) || !isStack(pkg.name)) continue;
  if (pkg.version === stackTo) continue;
  const prev = pkg.version;
  pkg.version = stackTo;
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  n++;
  console.log(`${pkg.name}: ${prev} → ${stackTo}`);
}

console.log(`bumped ${n} packages`);
console.log(`stack_version=${stackTo}`);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${stackTo}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `release_type=${arg1}\n`);
}
