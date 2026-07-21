/**
 * Interactive recursive publish (stdio inherited so npm can block on the
 * browser / web-auth challenge). Skips versions already on the registry.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const ALLOW_PREFIXES = [
  "@lofcz/embedpdf-core",
  "@lofcz/embedpdf-engines",
  "@lofcz/embedpdf-models",
  "@lofcz/embedpdf-pdfium",
  "@lofcz/embedpdf-utils",
  "@lofcz/embedpdf-plugin-",
  "@lofcz/embedpdf-fonts-",
  "@lofcz/embedpdf-snippet",
  "@lofcz/embedpdf-react-pdf-viewer",
];

const DENY = new Set([
  "@lofcz/embedpdf-plugin-ai-manager",
  "@lofcz/embedpdf-plugin-layout-analysis",
  "@lofcz/embedpdf-build",
]);

const dirs = [
  ...listPackageDirs(path.join(ROOT, "packages")),
  path.join(ROOT, "viewers/react"),
  path.join(ROOT, "viewers/snippet"),
];

function listPackageDirs(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === "pdfium-src" || e.name === "examples")
      continue;
    const p = path.join(dir, e.name);
    if (!e.isDirectory()) continue;
    if (fs.existsSync(path.join(p, "package.json"))) acc.push(p);
    else listPackageDirs(p, acc);
  }
  return acc;
}

function isAllowed(name) {
  if (DENY.has(name)) return false;
  return ALLOW_PREFIXES.some((p) => name === p || name.startsWith(p));
}

function alreadyPublished(name, version) {
  const result = spawnSync("npm", ["view", `${name}@${version}`, "version"], {
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return false;
  return (result.stdout || "").trim() === version;
}

const published = [];
const skipped = [];
const failed = [];

// Interactive web-auth needs a real TTY. Do not pipe stdout/stderr.
if (!process.stdin.isTTY) {
  console.error("Run this from an interactive terminal (cmd/PowerShell), not a pipe.");
  process.exit(1);
}

console.log("Interactive publish: when npm prints a browser URL, open it and finish the challenge.");
console.log("The CLI will wait until that auth completes.\n");

for (const dir of dirs) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  if (pkg.private) {
    skipped.push(`${pkg.name} (private)`);
    continue;
  }
  if (!isAllowed(pkg.name)) {
    skipped.push(`${pkg.name} (not in publish set)`);
    continue;
  }

  if (alreadyPublished(pkg.name, pkg.version)) {
    skipped.push(`${pkg.name}@${pkg.version} (already on npm)`);
    console.log(`↩ skip (already on npm): ${pkg.name}@${pkg.version}`);
    continue;
  }

  console.log(`\n→ publishing ${pkg.name}@${pkg.version}`);
  console.log(`  cwd: ${dir}`);

  // Use npm directly so the web-auth / EOTP browser flow can block on this TTY.
  const result = spawnSync("npm", ["publish", "--access", "public"], {
    cwd: dir,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status === 0) {
    published.push(`${pkg.name}@${pkg.version}`);
    continue;
  }

  failed.push(`${pkg.name}@${pkg.version}`);
  console.error(`✖ failed: ${pkg.name}@${pkg.version} (exit ${result.status})`);
  console.error("Fix auth / retry. Re-run `pnpm ci:publish` — already-published packages are skipped.");
  break;
}

const summary = { published, skipped, failed };
fs.writeFileSync(path.join(ROOT, "pnpm-publish-summary.json"), JSON.stringify(summary, null, 2));
console.log("\n=== publish summary ===");
console.log(JSON.stringify(summary, null, 2));

if (failed.length) process.exit(1);
