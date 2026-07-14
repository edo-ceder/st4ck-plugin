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

const browseCommandStart = /^(?:\$\s*)?(?:(?:npx(?:\s+(?:-y|--yes))?\s+st4ck(?:@[^\s]+)?)|st4ck)\s+browse\b/;

function extractBrowseCommands(text) {
  const lines = text.split("\n");
  const commands = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    const candidate = inFence ? trimmed.replace(/^\$\s*/, "") : trimmed;
    if (!browseCommandStart.test(candidate)) continue;

    let command = candidate;
    while (/\\\s*$/.test(command) && index + 1 < lines.length) {
      command = command.replace(/\\\s*$/, " ");
      index += 1;
      command += lines[index].trim();
    }
    commands.push(command);
  }
  return commands;
}

function shellTokens(command, label) {
  const tokens = [];
  let token = "";
  let tokenStarted = false;
  let quote = null;

  const pushToken = () => {
    if (!tokenStarted) return;
    tokens.push(token);
    token = "";
    tokenStarted = false;
  };

  for (const character of command) {
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      tokenStarted = true;
    } else if (character === "#" && !tokenStarted) {
      // In shell command examples an unquoted # at a token boundary starts a
      // comment; prose after it may contain apostrophes that are not quoting.
      break;
    } else if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
    } else if (/\s/.test(character)) {
      pushToken();
    } else {
      token += character;
      tokenStarted = true;
    }
  }

  check(!quote, `${label} contains an unterminated quoted Browse command: ${command}`);
  pushToken();
  return tokens;
}

function commandFlagValues(tokens, flag, label, command) {
  const values = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === flag) {
      const value = tokens[index + 1];
      check(value && !value.startsWith("--"),
        `${label} contains ${flag} without a path value: ${command}`);
      values.push(value);
      index += 1;
    } else if (tokens[index].startsWith(`${flag}=`)) {
      const value = tokens[index].slice(flag.length + 1);
      check(value.length > 0, `${label} contains ${flag}= without a path value: ${command}`);
      values.push(value);
    }
  }
  return values;
}

function escapesDefaultRepositoryRoot(value) {
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return true;
  let depth = 0;
  for (const component of value.split(/[\\/]+/)) {
    if (!component || component === ".") continue;
    if (component === "..") {
      if (depth === 0) return true;
      depth -= 1;
    } else {
      depth += 1;
    }
  }
  return false;
}

function validateDocumentedFilePaths(label, surface) {
  for (const command of extractBrowseCommands(surface)) {
    const tokens = shellTokens(command, label);
    const browseIndex = tokens.indexOf("browse");
    const op = tokens[browseIndex + 1];
    check(browseIndex >= 0, `${label} contains a malformed Browse command: ${command}`);
    if (!op) continue;
    const pathFlags = op === "screenshot"
      ? ["--out"]
      : op === "upload"
        ? ["--file"]
        : [];
    for (const flag of pathFlags) {
      for (const value of commandFlagValues(tokens, flag, label, command)) {
        check(!escapesDefaultRepositoryRoot(value),
          `${label} teaches a ${op} ${flag} path outside the default allowed repository root: ${value}`);
      }
    }
  }
}

function expectPathValidationFailure(label, surface, expectedMessage) {
  let failure;
  try {
    validateDocumentedFilePaths(label, surface);
  } catch (error) {
    failure = error;
  }
  check(failure instanceof Error && expectedMessage.test(failure.message),
    `${label} self-test did not fail as expected`);
}

const relativePathFixture = [
  "```bash",
  "npx -y st4ck@latest browse screenshot \\",
  "  --out \".st4ck/screenshots/page shot.png\"",
  "$ st4ck browse upload --file 'fixtures/photo one.jpg'",
  "```",
].join("\n");
check(extractBrowseCommands(relativePathFixture).length === 2,
  "Browse command extraction must recognize npx and bare st4ck forms");
validateDocumentedFilePaths("repository-relative path fixture", relativePathFixture);
expectPathValidationFailure(
  "POSIX screenshot fixture",
  "npx st4ck@latest browse screenshot --out /var/tmp/page.png",
  /screenshot --out path outside/,
);
expectPathValidationFailure(
  "Windows upload fixture",
  String.raw`st4ck browse upload --file \\server\share\fixture.png`,
  /upload --file path outside/,
);
expectPathValidationFailure(
  "parent traversal upload fixture",
  "st4ck browse upload --file ../../outside/fixture.png",
  /upload --file path outside/,
);

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
validateDocumentedFilePaths("st4ck-browse command", browseCommand);

process.stdout.write(`ok: st4ck plugin ${manifest.version} manifests and Browse contract are coherent\n`);
