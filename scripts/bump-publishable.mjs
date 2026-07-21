/**
 * Bump publishable fork packages.
 *
 * Usage:
 *   node scripts/bump-publishable.mjs patch|minor|major
 *   node scripts/bump-publishable.mjs 2.14.5 2.14.6   (legacy explicit)
 *
 * Stack packages (core/plugins/snippet/react) share one version.
 * Font packs bump independently with the same release type.
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const arg1 = process.argv[2];
const arg2 = process.argv[3];

const STACK_PREFIXES = [
  "@lofcz/embedpdf-core",
  "@lofcz/embedpdf-engines",
  "@lofcz/embedpdf-models",
  "@lofcz/embedpdf-pdfium",
  "@lofcz/embedpdf-utils",
  "@lofcz/embedpdf-plugin-",
  "@lofcz/embedpdf-snippet",
  "@lofcz/embedpdf-react-pdf-viewer",
];

const FONT_PREFIX = "@lofcz/embedpdf-fonts-";

const DENY = new Set([
  "@lofcz/embedpdf-build",
  "@lofcz/embedpdf-plugin-ai-manager",
  "@lofcz/embedpdf-plugin-layout-analysis",
]);

function walkPkgJson(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === "pdfium-src" || e.name === "examples")
      continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkPkgJson(p, acc);
    else if (e.name === "package.json") acc.push(p);
  }
  return acc;
}

function bumpSemver(version, type) {
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

function isFont(name) {
  return name.startsWith(FONT_PREFIX);
}

const targets = [
  ...walkPkgJson(path.join(ROOT, "packages")),
  path.join(ROOT, "viewers/react/package.json"),
  path.join(ROOT, "viewers/snippet/package.json"),
];

const releaseTypes = new Set(["patch", "minor", "major"]);
let mode;
let fromExplicit;
let toExplicit;

if (releaseTypes.has(arg1) && !arg2) {
  mode = "semver";
} else if (arg1 && arg2) {
  mode = "explicit";
  fromExplicit = arg1;
  toExplicit = arg2;
} else {
  console.error("Usage: node scripts/bump-publishable.mjs patch|minor|major");
  process.exit(1);
}

const reactPkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "viewers/react/package.json"), "utf8"),
);
const stackFrom = reactPkg.version;
const stackTo = mode === "semver" ? bumpSemver(stackFrom, arg1) : toExplicit;

let n = 0;
for (const file of targets) {
  if (!fs.existsSync(file)) continue;
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (pkg.private || DENY.has(pkg.name)) continue;

  let next = null;
  if (mode === "explicit") {
    if (pkg.version === fromExplicit && (isStack(pkg.name) || isFont(pkg.name))) {
      next = toExplicit;
    }
  } else if (isStack(pkg.name)) {
    next = stackTo;
  } else if (isFont(pkg.name)) {
    next = bumpSemver(pkg.version, arg1);
  }

  if (!next || next === pkg.version) continue;
  const prev = pkg.version;
  pkg.version = next;
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  n++;
  console.log(`${pkg.name}: ${prev} → ${next}`);
}

console.log(`bumped ${n} packages`);
console.log(`stack_version=${stackTo}`);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${stackTo}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `release_type=${arg1 || "explicit"}\n`);
}
