/**
 * Publish fork packages to npm.
 *
 * - Local: `pnpm publish` (interactive TTY / web-auth).
 * - CI: `pnpm pack` (rewrites workspace: deps) + `npm publish` (OIDC trusted
 *   publishing requires npm >= 11.5.1; no NODE_AUTH_TOKEN / registry-url auth).
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

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

function publishEnv() {
  const env = { ...process.env };
  if (isCI) {
    // Classic / empty tokens prevent the OIDC trusted-publishing exchange.
    delete env.NODE_AUTH_TOKEN;
    delete env.NPM_TOKEN;
    env.NPM_CONFIG_PROVENANCE = env.NPM_CONFIG_PROVENANCE || "true";
  }
  return env;
}

function assertNpmSupportsOidc() {
  const result = spawnSync("npm", ["-v"], {
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const version = (result.stdout || "").trim();
  console.log(`npm ${version}`);
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) {
    console.error("Could not parse npm version; trusted publishing needs npm >= 11.5.1");
    process.exit(1);
  }
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  const ok = major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1)));
  if (!ok) {
    console.error(`npm ${version} is too old for trusted publishing (need >= 11.5.1).`);
    process.exit(1);
  }
}

function publishLocal(dir) {
  return spawnSync("pnpm", ["publish", "--access", "public", "--no-git-checks"], {
    cwd: dir,
    shell: true,
    stdio: "inherit",
    env: publishEnv(),
  }).status;
}

const REPO_URL = "https://github.com/lofcz/embed-pdf-viewer";

/** Provenance requires repository.url === GitHub repo (no empty / .git suffix). */
function ensureRepositoryField(dir) {
  const pkgPath = path.join(dir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const rel = path.relative(ROOT, dir).split(path.sep).join("/");
  const currentUrl = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const normalized = String(currentUrl || "")
    .replace(/\.git$/i, "")
    .replace(/^git\+/, "");
  if (
    normalized === REPO_URL &&
    pkg.repository &&
    typeof pkg.repository === "object" &&
    pkg.repository.directory === rel
  ) {
    return;
  }

  pkg.repository = {
    type: "git",
    url: REPO_URL,
    directory: rel,
  };
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`  set repository.url → ${REPO_URL} (${rel})`);
}

/** Pack with pnpm (workspace rewrite), publish tarball with npm (OIDC). */
function publishCI(dir) {
  ensureRepositoryField(dir);
  const env = publishEnv();
  const pack = spawnSync("pnpm", ["pack"], {
    cwd: dir,
    shell: true,
    encoding: "utf8",
    env,
  });
  if (pack.status !== 0) {
    console.error(pack.stderr || pack.stdout || "pnpm pack failed");
    return pack.status ?? 1;
  }

  const lines = `${pack.stdout || ""}\n${pack.stderr || ""}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const tgzLine = [...lines].reverse().find((l) => l.endsWith(".tgz"));
  if (!tgzLine) {
    console.error("pnpm pack did not print a .tgz path");
    return 1;
  }

  const tgzPath = path.isAbsolute(tgzLine) ? tgzLine : path.join(dir, path.basename(tgzLine));
  if (!fs.existsSync(tgzPath)) {
    // pnpm sometimes prints a relative name from cwd
    const alt = path.join(dir, tgzLine);
    if (!fs.existsSync(alt)) {
      console.error(`Packed tarball not found: ${tgzPath}`);
      return 1;
    }
  }
  const resolvedTgz = fs.existsSync(tgzPath) ? tgzPath : path.join(dir, tgzLine);

  const result = spawnSync(
    "npm",
    ["publish", resolvedTgz, "--access", "public", "--provenance"],
    {
      cwd: dir,
      shell: true,
      stdio: "inherit",
      env,
    },
  );

  try {
    fs.unlinkSync(resolvedTgz);
  } catch {
    // ignore cleanup errors
  }

  return result.status ?? 1;
}

const published = [];
const skipped = [];
const failed = [];

if (!isCI && !process.stdin.isTTY) {
  console.error("Run this from an interactive terminal (cmd/PowerShell), not a pipe.");
  process.exit(1);
}

if (!isCI) {
  console.log("Interactive publish: complete any browser auth challenge when prompted.\n");
} else {
  console.log("CI publish via npm trusted publishing (OIDC).\n");
  assertNpmSupportsOidc();
  if (process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN) {
    console.log("Note: clearing NODE_AUTH_TOKEN / NPM_TOKEN so OIDC is used.\n");
  }
}

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

  const status = isCI ? publishCI(dir) : publishLocal(dir);

  if (status === 0) {
    published.push(`${pkg.name}@${pkg.version}`);
    continue;
  }

  failed.push(`${pkg.name}@${pkg.version}`);
  console.error(`✖ failed: ${pkg.name}@${pkg.version} (exit ${status})`);
  if (isCI) break;
  console.error("Fix auth / retry. Re-run `pnpm ci:publish` — already-published packages are skipped.");
  break;
}

const summary = { published, skipped, failed };
fs.writeFileSync(path.join(ROOT, "pnpm-publish-summary.json"), JSON.stringify(summary, null, 2));
console.log("\n=== publish summary ===");
console.log(JSON.stringify(summary, null, 2));

if (failed.length) process.exit(1);
if (isCI && published.length === 0) {
  const already = skipped.filter((s) => s.includes("already on npm"));
  if (already.length === 0) {
    console.error("CI publish published 0 packages.");
    process.exit(1);
  }
  // Idempotent re-run after a prior successful publish + failed git push.
  console.log(`All ${already.length} target versions already on npm — nothing new to publish.`);
}
