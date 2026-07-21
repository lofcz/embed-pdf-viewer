/**
 * Bulk-configure npm Trusted Publishing (OIDC) for GitHub Actions.
 *
 * Prerequisites:
 * - npm >= 11.15
 * - Account 2FA enabled + interactive `npm login` (not a bypass-2FA token)
 * - Each package already published at least once
 *
 * First create opens a browser 2FA challenge. On the npm site, enable
 * "skip two-factor authentication for the next 5 minutes", then let the
 * loop finish with --yes.
 *
 * Usage:
 *   node scripts/setup-trusted-publishing.mjs
 *   node scripts/setup-trusted-publishing.mjs --dry-run
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const REPO = "lofcz/embed-pdf-viewer";
const WORKFLOW_FILE = "release.yml";
const dryRun = process.argv.includes("--dry-run");

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

function packageExists(name) {
  const result = spawnSync("npm", ["view", name, "name"], {
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0 && (result.stdout || "").trim().length > 0;
}

function sleep(ms) {
  const sec = Math.max(1, Math.ceil(ms / 1000));
  spawnSync("timeout", ["/t", String(sec), "/nobreak"], {
    shell: true,
    stdio: "ignore",
  });
}

function npmEnv() {
  const env = { ...process.env };
  delete env.NPM_TOKEN;
  delete env.NODE_AUTH_TOKEN;
  return env;
}

/** Returns true if this package already has our GitHub Actions trust config. */
function hasDesiredTrust(name) {
  const result = spawnSync("npm", ["trust", "list", name, "--json"], {
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: npmEnv(),
  });
  const raw = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.status !== 0 && !raw.trim()) return false;

  // Prefer JSON; fall back to plain-text scrape.
  try {
    const data = JSON.parse((result.stdout || "").trim() || "null");
    const rows = Array.isArray(data)
      ? data
      : Array.isArray(data?.trustedPublishers)
        ? data.trustedPublishers
        : Array.isArray(data?.configurations)
          ? data.configurations
          : data
            ? [data]
            : [];
    return rows.some((row) => {
      const repo = row.repository || row.repo || row.repository_name || "";
      const file = row.file || row.workflow || row.workflow_filename || "";
      const type = row.type || row.provider || "";
      const repoOk = !repo || repo === REPO;
      const fileOk = !file || file === WORKFLOW_FILE || file.endsWith(WORKFLOW_FILE);
      const typeOk = !type || /github/i.test(String(type));
      return repoOk && fileOk && typeOk && (repo || file || type);
    });
  } catch {
    return (
      raw.includes(REPO) &&
      (raw.includes(WORKFLOW_FILE) || raw.includes("github"))
    );
  }
}

const dirs = [
  ...listPackageDirs(path.join(ROOT, "packages")),
  path.join(ROOT, "viewers/react"),
  path.join(ROOT, "viewers/snippet"),
];

const names = [];
for (const dir of dirs) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  if (pkg.private || !isAllowed(pkg.name)) continue;
  names.push(pkg.name);
}
names.sort();

console.log(`Configuring GitHub trusted publisher for ${names.length} packages`);
console.log(`  repo:     ${REPO}`);
console.log(`  workflow: .github/workflows/${WORKFLOW_FILE}`);
console.log(`  dry-run:  ${dryRun}`);
console.log("");
console.log("Tip: after the first browser 2FA prompt, enable");
console.log('"skip two-factor authentication for the next 5 minutes".');
console.log("");

if (!process.stdin.isTTY && !dryRun) {
  console.error("Run from an interactive terminal so npm can complete 2FA.");
  process.exit(1);
}

if (process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN) {
  console.error("NPM_TOKEN / NODE_AUTH_TOKEN is set in this shell.");
  console.error("Clear them, then use interactive npm login.");
  process.exit(1);
}

const ok = [];
const skipped = [];
const failed = [];
let interactiveDone = false;

for (const name of names) {
  if (!packageExists(name)) {
    skipped.push(`${name} (not on npm yet)`);
    console.log(`↩ skip (not on registry): ${name}`);
    continue;
  }

  if (hasDesiredTrust(name)) {
    skipped.push(`${name} (already configured)`);
    console.log(`↩ skip (already trusted): ${name}`);
    interactiveDone = true; // auth already proven this session / account
    continue;
  }

  const args = [
    "trust",
    "github",
    name,
    "--file",
    WORKFLOW_FILE,
    "--repo",
    REPO,
    "--allow-publish",
  ];
  // After the first interactive create, use --yes for the 5-minute skip window.
  if (interactiveDone || dryRun) args.push("--yes");
  if (dryRun) args.push("--dry-run");

  console.log(`\n→ npm ${args.join(" ")}`);
  const result = spawnSync("npm", args, {
    shell: true,
    stdio: "inherit",
    env: npmEnv(),
  });

  if (result.status === 0) {
    ok.push(name);
    interactiveDone = true;
  } else if (hasDesiredTrust(name)) {
    // E409 conflict = already configured (e.g. created manually just now).
    skipped.push(`${name} (already configured)`);
    console.log(`↩ skip (already trusted after conflict): ${name}`);
    interactiveDone = true;
  } else {
    failed.push(name);
    console.error(`✖ failed: ${name}`);
  }

  sleep(2000);
}

console.log("\n=== trusted publishing setup summary ===");
console.log(JSON.stringify({ ok, skipped, failed }, null, 2));

if (failed.length) process.exit(1);
