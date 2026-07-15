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
const managedManifest = parse("st4ck-managed-slack/.claude-plugin/plugin.json");
const managedMcp = parse("st4ck-managed-slack/.mcp.json");
const managedSkill = read("st4ck-managed-slack/skills/shared-channel-st4ck/SKILL.md");
const browseCommand = read("st4ck/commands/st4ck-browse.md");
const entry = marketplace.plugins?.find((plugin) => plugin.name === manifest.name);
const managedEntry = marketplace.plugins?.find((plugin) => plugin.name === managedManifest.name);
const manifestPath = "st4ck/.claude-plugin/plugin.json";
const managedManifestPath = "st4ck-managed-slack/.claude-plugin/plugin.json";
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
check(managedEntry, `marketplace has no entry for plugin ${managedManifest.name}`);
check(managedEntry.source === "./st4ck-managed-slack",
  "managed Slack marketplace source must remain ./st4ck-managed-slack");
check(typeof managedManifest.version === "string" && parseSemver(managedManifest.version),
  "managed Slack plugin.json must contain a semver plugin version");
check(!Object.hasOwn(managedEntry, "version"),
  "declare the managed Slack plugin version only in plugin.json");

const managedServers = Object.entries(managedMcp.mcpServers ?? {});
check(managedServers.length === 1,
  "managed Slack plugin must declare exactly one MCP server");
const [[managedServerName, managedServer]] = managedServers;
check(managedServerName === "st4ck-managed-connector",
  "managed Slack MCP server must be named st4ck-managed-connector");
check(managedServer?.type === "http",
  "managed Slack MCP server must use HTTP transport");
check(managedServer?.url === "https://app.st4ck.io/mcp/managed-connector/",
  "managed Slack MCP server must target the production managed connector endpoint");
check(Object.keys(managedServer).sort().join(",") === "type,url",
  "managed Slack MCP config may contain only type and url; credentials are injected by the Access bundle");
check(!/(authorization|bearer|headers?|token|secret|api[_-]?key|\$\{)/i.test(JSON.stringify(managedMcp)),
  "managed Slack MCP config must not contain credentials, headers, or placeholders");

for (const [label, pattern] of [
  ["bound-project discovery", /list_my_projects/],
  ["returned-project restriction", /only that returned project ID/i],
  ["project guide grounding", /get_project_guide/],
  ["shared-channel privacy", /channel-safe/i],
  ["untrusted-input handling", /untrusted input/i],
  ["issue confirmation", /confirm/i],
  ["Project Action confirmation", /explicit confirmation/i],
]) {
  check(pattern.test(managedSkill), `managed Slack skill does not teach ${label}`);
}

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
  let value = "";
  let tokenStarted = false;
  let quote = null;
  let expandableSegment = "";
  let mayExpand = false;
  let mayExecute = false;

  const flushExpandableSegment = (mode = "unquoted") => {
    const controlSegment = expandableSegment.replace(/<[a-z][a-z0-9_-]*>/gi, "");
    const commandSubstitution = /\$\(|`/.test(expandableSegment);
    const shellControl = mode === "unquoted" && /[<>();&|]/.test(controlSegment);
    if (/\$/.test(expandableSegment)
      || /`/.test(expandableSegment)
      || /%[^%]+%/.test(expandableSegment)
      || /![^!]+!/.test(expandableSegment)
      || (mode === "unquoted" && /[{}<>();&|*?\[]/.test(controlSegment))) {
      mayExpand = true;
    }
    if (commandSubstitution || shellControl) mayExecute = true;
    expandableSegment = "";
  };

  const pushToken = () => {
    if (!tokenStarted) return;
    flushExpandableSegment();
    tokens.push({ value, mayExpand, mayExecute });
    value = "";
    tokenStarted = false;
    mayExpand = false;
    mayExecute = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (quote) {
      if (quote === '"' && character === "\\" && index + 1 < command.length
        && /[$`"\\\n]/.test(command[index + 1])) {
        // Preserve the path spelling for cross-platform checks, but do not
        // treat a shell-escaped metacharacter as executable expansion syntax.
        flushExpandableSegment("double");
        value += character + command[index + 1];
        index += 1;
      } else if (character === quote) {
        const closedQuote = quote;
        quote = null;
        if (closedQuote === '"') flushExpandableSegment("double");
      } else {
        value += character;
        if (quote === '"') expandableSegment += character;
      }
      tokenStarted = true;
    } else if (character === "#" && !tokenStarted) {
      // In shell command examples an unquoted # at a token boundary starts a
      // comment; prose after it may contain apostrophes that are not quoting.
      break;
    } else if (character === "'" || character === '"') {
      if (expandableSegment.endsWith("$")) mayExpand = true;
      flushExpandableSegment("unquoted");
      quote = character;
      tokenStarted = true;
    } else if (character === "\\" && index + 1 < command.length) {
      // Keep backslashes so Windows absolute/traversal checks still see them,
      // while separating an escaped metacharacter from expandable syntax.
      flushExpandableSegment("unquoted");
      value += character + command[index + 1];
      index += 1;
      tokenStarted = true;
    } else if (/\s/.test(character)) {
      pushToken();
    } else {
      if (!tokenStarted && character === "~") mayExpand = true;
      value += character;
      expandableSegment += character;
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
    if (tokens[index].value === flag) {
      const valueToken = tokens[index + 1];
      check(valueToken !== undefined && valueToken.value.length > 0,
        `${label} contains ${flag} without a path value: ${command}`);
      check(!valueToken.value.startsWith("-")
        || /[./\\]/.test(valueToken.value.replace(/^-+/, "")),
        `${label} contains ${flag} without a path value: ${command}`);
      values.push(valueToken);
      index += 1;
    } else if (tokens[index].value.startsWith(`${flag}=`)) {
      const value = tokens[index].value.slice(flag.length + 1);
      check(value.length > 0, `${label} contains ${flag}= without a path value: ${command}`);
      values.push({ value, mayExpand: tokens[index].mayExpand });
    }
  }
  return values;
}

function escapesDefaultRepositoryRoot({ value, mayExpand }) {
  if (mayExpand) return true;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return true;
  if (/^[A-Za-z]:/.test(value)) return true;
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
    const browseIndex = tokens.findIndex((token) => token.value === "browse");
    const op = tokens[browseIndex + 1]?.value;
    check(browseIndex >= 0, `${label} contains a malformed Browse command: ${command}`);
    check(tokens.every((token) => !token.mayExecute),
      `${label} contains executable shell expansion or control syntax: ${command}`);
    if (!op) continue;
    const pathFlags = op === "screenshot"
      ? ["--out"]
      : op === "upload"
        ? ["--file"]
        : [];
    for (const flag of pathFlags) {
      for (const valueToken of commandFlagValues(tokens, flag, label, command)) {
        check(!escapesDefaultRepositoryRoot(valueToken),
          `${label} teaches a ${op} ${flag} path outside the default allowed repository root: ${valueToken.value}`);
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
validateDocumentedFilePaths(
  "dash-prefixed relative filename fixture",
  "st4ck browse screenshot --out --trace.png",
);
validateDocumentedFilePaths(
  "single-quoted literal filename fixture",
  "st4ck browse upload --file 'fixtures/price$1.png'",
);
validateDocumentedFilePaths(
  "escaped literal filename fixture",
  String.raw`st4ck browse upload --file fixtures/\$HOME.png`,
);
validateDocumentedFilePaths(
  "double-quoted escaped literal filename fixture",
  String.raw`st4ck browse upload --file "fixtures/\$HOME.png"`,
);
validateDocumentedFilePaths(
  "explicit equals dash filename fixture",
  "st4ck browse screenshot --out=-h",
);
validateDocumentedFilePaths(
  "single-quoted control literal fixture",
  "st4ck browse upload --file 'fixtures/price;1.png'",
);
validateDocumentedFilePaths(
  "single-quoted glob literal fixture",
  "st4ck browse upload --file 'fixtures/*.png'",
);
validateDocumentedFilePaths(
  "escaped glob literal fixture",
  String.raw`st4ck browse upload --file fixtures/\*.png`,
);
validateDocumentedFilePaths(
  "documentation placeholder fixture",
  "st4ck browse launch <url> --session <slug>",
);
expectPathValidationFailure(
  "missing screenshot path fixture",
  "st4ck browse screenshot --out --full-page",
  /without a path value/,
);
expectPathValidationFailure(
  "short option missing screenshot path fixture",
  "st4ck browse screenshot --out -h",
  /without a path value/,
);
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
expectPathValidationFailure(
  "tilde screenshot fixture",
  "st4ck browse screenshot --out ~/page.png",
  /screenshot --out path outside/,
);
expectPathValidationFailure(
  "environment upload fixture",
  "st4ck browse upload --file $HOME/fixture.png",
  /upload --file path outside/,
);
expectPathValidationFailure(
  "Windows environment upload fixture",
  String.raw`st4ck browse upload --file %TEMP%\fixture.png`,
  /upload --file path outside/,
);
expectPathValidationFailure(
  "Windows drive-relative upload fixture",
  String.raw`st4ck browse upload --file C:tmp\fixture.png`,
  /upload --file path outside/,
);
expectPathValidationFailure(
  "brace expansion screenshot fixture",
  "st4ck browse screenshot --out {..,fixtures}/outside.png",
  /screenshot --out path outside/,
);
expectPathValidationFailure(
  "mixed-quote brace expansion screenshot fixture",
  'st4ck browse screenshot --out {..,"fixtures"}/outside.png',
  /screenshot --out path outside/,
);
expectPathValidationFailure(
  "ANSI-C quoted screenshot fixture",
  "st4ck browse screenshot --out $'../outside.png'",
  /screenshot --out path outside/,
);
expectPathValidationFailure(
  "process substitution screenshot fixture",
  "st4ck browse screenshot --out <(printf-fixture)",
  /executable shell expansion or control syntax/,
);
expectPathValidationFailure(
  "CMD delayed expansion upload fixture",
  String.raw`st4ck browse upload --file !TEMP!\fixture.png`,
  /upload --file path outside/,
);
expectPathValidationFailure(
  "glob upload fixture",
  "st4ck browse upload --file fixtures/*.png",
  /upload --file path outside/,
);
expectPathValidationFailure(
  "question-mark glob screenshot fixture",
  "st4ck browse screenshot --out artifacts/page?.png",
  /screenshot --out path outside/,
);
expectPathValidationFailure(
  "bracket glob upload fixture",
  "st4ck browse upload --file fixtures/[ab].png",
  /upload --file path outside/,
);
expectPathValidationFailure(
  "shell redirection fixture",
  "st4ck browse screenshot --out artifacts/x.png > ../outside.txt",
  /executable shell expansion or control syntax/,
);
expectPathValidationFailure(
  "non-path command substitution fixture",
  "st4ck browse screenshot --out artifacts/x.png $(touch ../outside)",
  /executable shell expansion or control syntax/,
);
expectPathValidationFailure(
  "empty operation redirection fixture",
  'st4ck browse "" > ../outside.txt',
  /executable shell expansion or control syntax/,
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

const managedChangedTracked = git(["diff", "--name-only", baseRef, "--", "st4ck-managed-slack"])
  .trim().split("\n").filter(Boolean);
const managedChangedUntracked = git(["ls-files", "--others", "--exclude-standard", "--", "st4ck-managed-slack"])
  .trim().split("\n").filter(Boolean);
const managedPayloadChanges = [...new Set([...managedChangedTracked, ...managedChangedUntracked])];

if (managedPayloadChanges.length > 0) {
  let baseManagedManifest = null;
  try {
    baseManagedManifest = JSON.parse(git(["show", `${baseRef}:${managedManifestPath}`]));
  } catch {
    // A new package has no base version to compare. Its first release starts at 1.0.0.
  }

  if (baseManagedManifest) {
    check(isGreaterVersion(managedManifest.version, baseManagedManifest.version),
      `managed Slack plugin version ${managedManifest.version} must be greater than ${baseManagedManifest.version} from ${baseRef}`);
  } else {
    check(managedManifest.version === "1.0.0",
      `new managed Slack plugin must begin at version 1.0.0, got ${managedManifest.version}`);
  }
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

process.stdout.write(
  `ok: st4ck ${manifest.version} and st4ck-managed-slack ${managedManifest.version} manifests are coherent\n`,
);
