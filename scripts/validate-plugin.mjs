#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const parse = (relativePath) => JSON.parse(read(relativePath));

const marketplace = parse(".claude-plugin/marketplace.json");
const manifest = parse("st4ck/.claude-plugin/plugin.json");
const browseCommand = read("st4ck/commands/st4ck-browse.md");
const entry = marketplace.plugins?.find((plugin) => plugin.name === manifest.name);
const manifestPath = "st4ck/.claude-plugin/plugin.json";
const baseRef = process.env.ST4CK_PLUGIN_BASE_REF ?? "origin/main";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

check(entry, `marketplace has no entry for plugin ${manifest.name}`);
check(entry.source === "./st4ck", "st4ck marketplace source must remain ./st4ck");
check(typeof manifest.version === "string" && parseSemver(manifest.version),
  "plugin.json must contain a semver plugin version");
check(!Object.hasOwn(entry, "version"),
  "declare the plugin version only in plugin.json; marketplace version is a competing source");

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

function requireBaseRef(ref) {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch {
    throw new Error(
      `release base ref "${ref}" is unavailable; fetch that ref or run ` +
      `ST4CK_PLUGIN_BASE_REF=<existing-ref> node scripts/validate-plugin.mjs`,
    );
  }
}

function parseSemver(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!match) return null;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) return null;
  return {
    core: match.slice(1, 4).map(Number),
    prerelease,
  };
}

function isGreaterVersion(current, base) {
  const a = parseSemver(current);
  const b = parseSemver(base);
  check(a && b, `release versions must be semver (current ${current}, base ${base})`);
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i];
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length > 0 && a.prerelease.length === 0;
  }
  const count = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < count; i++) {
    const left = a.prerelease[i];
    const right = b.prerelease[i];
    if (left === undefined || right === undefined) return right === undefined;
    if (left === right) continue;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) return Number(left) > Number(right);
    if (leftNumeric !== rightNumeric) return !leftNumeric;
    return left > right;
  }
  return false;
}

check(isGreaterVersion("1.2.3-rc.2+build.7", "1.2.3-rc.1"),
  "internal SemVer comparison must support prerelease/build syntax");
check(isGreaterVersion("1.2.3", "1.2.3-rc.2"),
  "a SemVer release must sort after its prereleases");

requireBaseRef(baseRef);

const changedTracked = git(["diff", "--name-only", baseRef, "--", "st4ck"])
  .trim().split("\n").filter(Boolean);
const changedUntracked = git(["ls-files", "--others", "--exclude-standard", "--", "st4ck"])
  .trim().split("\n").filter(Boolean);
const payloadChanges = [...new Set([...changedTracked, ...changedUntracked])];

if (payloadChanges.length > 0) {
  let baseManifest;
  try {
    baseManifest = JSON.parse(git(["show", `${baseRef}:${manifestPath}`]));
  } catch (error) {
    throw new Error(
      `release base ref "${baseRef}" does not provide a readable ${manifestPath}: ${error.message}`,
    );
  }
  check(manifest.version !== baseManifest.version,
    `plugin payload changed without a version bump from ${baseManifest.version}: ${payloadChanges.join(", ")}`);
  check(isGreaterVersion(manifest.version, baseManifest.version),
    `plugin version ${manifest.version} must be greater than ${baseManifest.version} from ${baseRef}`);
}

const browseSurface = [
  ["interactables", /browse interactables\b/],
  ["locate", /browse locate\b/],
  ["get-text", /browse get-text\b/],
  ["assert-contains", /browse assert-contains[^\n]*--contains\b/],
  ["scroll", /browse scroll\b/],
  ["prune", /browse prune\b/],
  ["quiet output", /--format quiet\b/],
  ["focused fill", /browse fill[^\n]*--focused\b/],
  ["settled click", /browse click[^\n]*--settle\b/],
  ["native click", /browse click_native\b/],
  ["native pointer sequence", /browse click_native[^\n]*--pointer-sequence\b/],
  ["locator collision index", /--locator-index\b/],
  ["storage-state auth", /--storage-state\b/],
  ["secure auth temp file", /mktemp[^\n]*st4ck-auth/],
  ["restricted auth permissions", /chmod 600/],
  ["auth cleanup trap", /trap[^\n]*rm -f/],
];

for (const [name, pattern] of browseSurface) {
  check(pattern.test(browseCommand), `st4ck-browse command does not teach ${name}`);
}

check(!/browse launch --help[^\n]*planned/i.test(browseCommand),
  "Browse per-op help is shipped and must not be documented as planned");
check(/browse interactables --help\b/.test(browseCommand),
  "st4ck-browse command must teach the shipped browse <op> --help surface");
check(!/\bxpath\b/i.test(browseCommand),
  "st4ck-browse must not list unsupported xpath locators");
check(!/Fix today[^\n]*--platform/i.test(browseCommand),
  "launch --platform is forward-compatible only, not today's reactive-UI fix");
check(/forward compatibility only/i.test(browseCommand) && /do not rely on this launch flag today/i.test(browseCommand),
  "st4ck-browse must state that launch --platform cannot be relied on today");
check(!/\$SB_TOKEN|--local-storage[^\n]*auth-token/i.test(browseCommand),
  "auth tokens must never be passed through process arguments");

process.stdout.write(`ok: st4ck plugin ${manifest.version} manifests and Browse contract are coherent\n`);
