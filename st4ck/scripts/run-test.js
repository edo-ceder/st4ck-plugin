#!/usr/bin/env node
/**
 * st4ck Deterministic Test Runner
 *
 * Zero-dependency Node.js script. Executes test blocks via agent-browser CLI
 * with no LLM calls. Called by Sonnet agent via Bash.
 *
 * Usage:
 *   node run-test.js <test_case_id> <base_url> [token]
 *   node run-test.js <test_case_id> <base_url> [token] --continue <execution_id> --from-block <N>
 *   node run-test.js <test_case_id> <base_url> [token] --headless
 *
 * Exit codes:
 *   0  — all blocks completed successfully
 *   1  — failure (eval error, browser crash, MCP error)
 *   42 — agentic pause (block requires agent handling)
 *
 * Environment:
 *   ST4CK_TOKEN  — MCP auth token (preferred over positional arg)
 *   ST4CK_MCP_URL — MCP endpoint (default: https://app.st4ck.io/mcp/v3/)
 */

'use strict';

const { execFile: execFileCb, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const execFile = promisify(execFileCb);

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB
const AB_TIMEOUT = 30_000; // 30s per agent-browser command
const VERIFY_POLL_INTERVAL = 500; // ms
const VERIFY_POLL_MAX = 20_000; // 20s max
const LOG_FILE_PREFIX = '/tmp/st4ck-run-';
const FIXTURE_DIR_PREFIX = '/tmp/st4ck-fixtures/';

// ─── CLI Parsing ─────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    testCaseId: '',
    baseUrl: '',
    token: '',
    mcpUrl: process.env.ST4CK_MCP_URL || 'https://app.st4ck.io/mcp/v3/',
    mcpDataUrl: process.env.ST4CK_MCP_DATA_URL || '', // Derived from mcpUrl if not set — V1 for data tools (bubble, supabase)
    headless: false,
    continueExecId: '',
    fromBlock: -1,
    session: `st4ck-${Date.now()}`,
  };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--headless':
        opts.headless = true;
        break;
      case '--continue':
        opts.continueExecId = args[++i] || '';
        break;
      case '--from-block':
        opts.fromBlock = parseInt(args[++i] || '0', 10);
        break;
      case '--session':
        opts.session = args[++i] || opts.session;
        break;
      default:
        positional.push(args[i]);
    }
  }

  opts.testCaseId = positional[0] || '';
  opts.baseUrl = positional[1] || '';
  opts.token = process.env.ST4CK_TOKEN || positional[2] || '';

  // Fallback: read bearer token from project .mcp.json if ST4CK_TOKEN not set
  if (!opts.token) {
    opts.token = readTokenFromMcpJson();
  }

  if (!opts.testCaseId) {
    console.error('Usage: node run-test.js <test_case_id> <base_url> [token] [--headless] [--continue <exec_id> --from-block <N>]');
    process.exit(1);
  }
  if (!opts.token) {
    console.error('Error: No MCP token. Set ST4CK_TOKEN env var, pass as 3rd argument, or ensure .mcp.json has st4ck-qa headers.Authorization.');
    process.exit(1);
  }

  // Derive V1 data URL from V3 QA URL: /mcp/v3/ → /mcp/
  if (!opts.mcpDataUrl) {
    opts.mcpDataUrl = opts.mcpUrl.replace(/\/mcp\/v3\/?$/, '/mcp/');
  }

  return opts;
}

/** Try to read the bearer token from the project's .mcp.json file */
function readTokenFromMcpJson() {
  const fs = require('fs');
  const path = require('path');
  // Walk up from cwd looking for .mcp.json
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, '.mcp.json');
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      const config = JSON.parse(raw);
      const servers = config.mcpServers || {};
      // Prefer st4ck-qa, fall back to st4ck
      for (const name of ['st4ck-qa', 'st4ck']) {
        const auth = servers[name]?.headers?.Authorization || '';
        if (auth.startsWith('Bearer ')) {
          console.error(`[info] Token loaded from ${candidate} (server: ${name})`);
          return auth.slice(7);
        }
      }
    } catch { /* not found, try parent */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '';
}

// ─── Node.js Version Check ──────────────────────────────────────────────────

function checkNodeVersion() {
  const major = parseInt(process.version.slice(1), 10);
  if (major < 22) {
    console.error(`st4ck-run requires Node.js 22+, you have ${process.version}`);
    process.exit(1);
  }
}

// ─── MCP Client ──────────────────────────────────────────────────────────────

let mcpRequestId = 0;

async function mcpCall(mcpUrl, token, toolName, args) {
  const body = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: toolName, arguments: args },
    id: ++mcpRequestId,
  };

  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });

  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('text/event-stream')) {
    // Check for HTTP errors before parsing SSE body
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`MCP HTTP ${res.status} (${toolName}): ${errText}`);
    }
    // Parse SSE — find the JSON-RPC result frame (has `result` or `error` field)
    const text = await res.text();
    const lines = text.split('\n');
    let resultFrame = null;
    let lastData = null;
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(line.slice(6));
          lastData = parsed;
          // Prefer frames with JSON-RPC result or error (skip progress/heartbeat frames)
          if (parsed.result !== undefined || parsed.error !== undefined) {
            resultFrame = parsed;
          }
        } catch { /* skip non-JSON data lines */ }
      }
    }
    const frame = resultFrame || lastData;
    if (!frame) throw new Error(`MCP SSE: no valid data frame from ${toolName}`);
    if (frame.error) throw new Error(`MCP error (${toolName}): ${JSON.stringify(frame.error)}`);
    return extractMcpResult(frame);
  }

  // Standard JSON response
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`MCP HTTP ${res.status} (${toolName}): ${errText}`);
  }
  const json = await res.json();
  if (json.error) throw new Error(`MCP error (${toolName}): ${JSON.stringify(json.error)}`);
  return extractMcpResult(json);
}

function extractMcpResult(rpcResponse) {
  const result = rpcResponse.result;
  if (!result) return rpcResponse;
  // MCP tool results have { content: [{ type: 'text', text: '...' }] }
  if (result.content && Array.isArray(result.content)) {
    const textParts = result.content.filter(c => c.type === 'text').map(c => c.text);
    const combined = textParts.join('\n');
    try { return JSON.parse(combined); } catch { return combined; }
  }
  return result;
}

// ─── Agent-Browser CLI ───────────────────────────────────────────────────────

async function abExec(session, command, opts = {}) {
  const args = ['--session', session];
  if (opts.headed === false) args.push('--headed', 'false');
  else args.push('--headed', 'true');

  // If command is an array, spread it; otherwise split
  const cmdParts = Array.isArray(command) ? command : command.split(' ');
  args.push(...cmdParts);

  // When stdin data is provided, use spawn + explicit stdin.write/end
  // instead of execFile({ input }) which silently drops stdin on Node 22.
  if (opts.stdin) {
    const timeout = opts.timeout || AB_TIMEOUT;
    return new Promise((resolve) => {
      const child = spawn('agent-browser', args);

      let stdout = '';
      let stderr = '';
      let killed = false;
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (killed) {
          resolve({ stdout: stdout.trim(), stderr: `timed out after ${timeout}ms`, ok: false, code: 'ETIMEDOUT' });
        } else if (code === 0) {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), ok: true });
        } else {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim() || `exit code ${code}`, ok: false, code });
        }
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ stdout: '', stderr: err.message, ok: false, code: err.code });
      });

      child.stdin.write(opts.stdin);
      child.stdin.end();
    });
  }

  try {
    const { stdout, stderr } = await execFile('agent-browser', args, {
      maxBuffer: MAX_BUFFER,
      timeout: opts.timeout || AB_TIMEOUT,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), ok: true };
  } catch (err) {
    return {
      stdout: err.stdout?.trim() || '',
      stderr: err.stderr?.trim() || err.message,
      ok: false,
      code: err.code,
    };
  }
}

async function abEval(session, evalCode, opts = {}) {
  // Use --stdin to avoid shell escaping issues
  const result = await abExec(session, ['eval', '--stdin'], {
    ...opts,
    stdin: evalCode,
  });
  return result;
}

async function abNavigate(session, url, opts = {}) {
  return abExec(session, ['navigate', url], opts);
}

async function abClose(session) {
  // 1. Graceful close (closes browser, may or may not kill daemon process).
  const result = await abExec(session, ['close']);

  // 2. Kill the daemon process and scrub its pid/sock files. agent-browser
  //    leaves ~/.agent-browser/<session>.pid and .sock behind on exit; without
  //    this step, running many tests leaks one daemon per run indefinitely.
  try {
    const home = process.env.HOME || require('node:os').homedir();
    const dir = path.join(home, '.agent-browser');
    const pidFile = path.join(dir, `${session}.pid`);
    const sockFile = path.join(dir, `${session}.sock`);
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
        await new Promise(r => setTimeout(r, 200));
        try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch { /* dead */ }
      }
      fs.unlinkSync(pidFile);
    }
    if (fs.existsSync(sockFile)) fs.unlinkSync(sockFile);
    const engineFile = path.join(dir, `${session}.engine`);
    if (fs.existsSync(engineFile)) fs.unlinkSync(engineFile);
  } catch { /* best-effort */ }

  return result;
}

// Garbage-collect agent-browser session files whose daemon is no longer alive.
// Runs once at script startup so stale files from prior crashed runs get cleaned.
function sweepDeadAgentBrowserSessions() {
  try {
    const home = process.env.HOME || require('node:os').homedir();
    const dir = path.join(home, '.agent-browser');
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    const pidFiles = files.filter(f => f.endsWith('.pid'));
    let swept = 0;
    for (const pidFile of pidFiles) {
      const full = path.join(dir, pidFile);
      let alive = false;
      try {
        const pid = parseInt(fs.readFileSync(full, 'utf8').trim(), 10);
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); alive = true; } catch { alive = false; }
        }
      } catch { /* unreadable, treat as dead */ }
      if (!alive) {
        const base = pidFile.slice(0, -4);
        for (const ext of ['.pid', '.sock', '.engine']) {
          const f = path.join(dir, base + ext);
          try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
        }
        swept++;
      }
    }
    if (swept > 0) console.error(`[cleanup] swept ${swept} stale agent-browser session file(s)`);
  } catch { /* best-effort */ }
}

async function abSnapshot(session) {
  return abExec(session, ['snapshot', '-i']);
}

async function abScreenshot(session) {
  return abExec(session, ['screenshot']);
}

async function abErrors(session) {
  return abExec(session, ['errors']);
}

// ─── Fixture Management ─────────────────────────────────────────────────────

async function downloadFixtures(mcpUrl, token, testCaseId) {
  const shortId = testCaseId.slice(0, 8);
  const fixtureDir = path.join(FIXTURE_DIR_PREFIX, shortId);

  let urlData;
  try {
    urlData = await mcpCall(mcpUrl, token, 'get_fixture_urls', { test_case_id: testCaseId });
  } catch {
    return {}; // No fixtures or error — continue without
  }

  if (!urlData?.urls || Object.keys(urlData.urls).length === 0) return {};

  fs.mkdirSync(fixtureDir, { recursive: true });
  const localPaths = {};

  for (const [name, signedUrl] of Object.entries(urlData.urls)) {
    const safeName = path.basename(name);
    const rand = crypto.randomBytes(2).toString('hex');
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext);
    const localName = `${base}-${rand}${ext}`;
    const localPath = path.join(fixtureDir, localName);

    try {
      const res = await fetch(signedUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(localPath, buffer);
      localPaths[name] = localPath;
    } catch (err) {
      console.error(`[fixture] Failed to download ${name}: ${err.message}`);
    }
  }

  return localPaths;
}

function cleanupFixtures(testCaseId) {
  const shortId = testCaseId.slice(0, 8);
  const fixtureDir = path.join(FIXTURE_DIR_PREFIX, shortId);
  try {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  } catch { /* best effort */ }
}

// ─── Profile Management ─────────────────────────────────────────────────────

/**
 * Acquire a test user profile by role. Returns decrypted credentials.
 * Tracks acquired profiles for cleanup on exit.
 */
async function acquireProfile(mcpUrl, token, role, environmentId, acquiredProfiles, profileName, cacheKey, properties) {
  const key = cacheKey || role;
  // Check if we already acquired a profile for this key
  if (acquiredProfiles.has(key)) return acquiredProfiles.get(key);

  const args = { role, environment_id: environmentId };
  if (profileName) args.profile_name = profileName;
  if (properties && typeof properties === 'object' && Object.keys(properties).length > 0) args.properties = properties;

  const result = await mcpCall(mcpUrl, token, 'acquire_profile', args);

  const profile = result?.data || result;
  if (!profile?.profile_id) throw new Error(`acquire_profile failed for role "${role}"${profileName ? ` (profile_name: "${profileName}")` : ''}: no profile returned`);

  acquiredProfiles.set(key, profile);
  return profile;
}

/**
 * Release all acquired profiles. Best-effort — errors are logged but don't block exit.
 */
async function releaseAllProfiles(mcpUrl, token, acquiredProfiles) {
  for (const [role, profile] of acquiredProfiles) {
    try {
      await mcpCall(mcpUrl, token, 'release_profile', { profile_id: profile.profile_id });
      console.error(`[profile] Released ${role} (${profile.profile_id})`);
    } catch (err) {
      console.error(`[profile] Failed to release ${role}: ${err.message}`);
    }
  }
}

/**
 * Substitute profile credential placeholders in eval step content.
 * Handles {{profile.email}}, {{profile.password}}, {{profile.id}}.
 */
function substituteProfileCredentials(step, profile) {
  if (!profile) return step;
  const stepStr = JSON.stringify(step);
  // JSON-escape credential values so they don't break the JSON.parse round-trip
  // (handles passwords with ", \, newlines, etc.)
  const esc = (v) => JSON.stringify(v).slice(1, -1); // stringify then strip surrounding quotes
  const replaced = stepStr
    .replaceAll('{{profile.email}}', esc(profile.email || ''))
    .replaceAll('{{profile.password}}', esc(profile.password || profile.decrypted_password || ''))
    .replaceAll('{{profile.id}}', esc(profile.profile_id || ''))
    .replaceAll('{{profile.display}}', esc(profile.profile_display || profile.profile_name || ''));
  if (replaced === stepStr) return step;
  return JSON.parse(replaced);
}

// ─── Execution Engine ────────────────────────────────────────────────────────

async function resolveAction(mcpUrl, token, action) {
  if (action.type === 'agentic') return { agentic: true, action };
  // Legacy {action, expected} format — treat entire block as agentic (R3/task 8.1)
  if (action.action && !action.component) return { agentic: true, action };
  if (!action.component) return { steps: [action], agentic: false };

  // Resolve component via MCP
  const result = await mcpCall(mcpUrl, token, 'resolve_action', {
    component_name: action.component,
    method: action.method || 'default',
    params: action.params || {},
  });

  if (result.error) throw new Error(`resolve_action: ${result.error}`);
  return { steps: result.steps || result.data?.steps || [], agentic: false };
}

// ─── Step Execution Engine ──────────────────────────────────────────────────
//
// Supports all agent-browser commands as step types. Each step is an object
// with a type-specific key. Steps in component eval_sequence use these types.
//
// Simple steps:      { eval, navigate, click, fill, type+selector, press, hover,
//                      focus, check, uncheck, select, scroll, screenshot, wait,
//                      wait_fn, get, is, find, command }
// Snapshot:          { type: "snapshot" } — takes accessibility snapshot, stores
//                      result for branch conditions
// Branch:            { type: "branch", condition, then } — evaluates condition
//                      against last snapshot or params, executes `then` steps if match
// Conditional skip:  Any step with { condition } — skipped if condition is false

// Shared state: last snapshot text, available to branch conditions
let _lastSnapshot = '';
// Shared state: last API response (for assert/capture steps)
let _lastApiResponse = null;
// Shared state: captured values from API responses (for use in later steps)
const _captures = new Map();

function evaluateCondition(condition, params) {
  if (!condition) return true;
  // "sidebar contains 'X'" / "contains 'X'" — match against last snapshot
  const containsMatch = condition.match(/contains\s+'([^']+)'/);
  if (containsMatch) return _lastSnapshot.includes(containsMatch[1]);
  // "param === value" — match against component params
  const paramMatch = condition.match(/^(\w+)\s*===?\s*(.+)$/);
  if (paramMatch) {
    const [, key, rawVal] = paramMatch;
    const val = rawVal.trim();
    const paramVal = params?.[key];
    if (val === 'true') return paramVal === true;
    if (val === 'false') return paramVal === false || !paramVal;
    return String(paramVal) === val;
  }
  return false;
}

async function executeEvalStep(session, step, headless, params, mcpCtx) {
  // Conditional skip — any step with a `condition` field
  if (step.condition && !evaluateCondition(step.condition, params)) {
    return { stdout: 'skipped (condition false)', stderr: '', ok: true };
  }

  const opts = { headed: !headless };

  // ── Snapshot ──
  if (step.type === 'snapshot') {
    const flags = step.interactive !== false ? ['-i'] : [];
    if (step.selector) flags.push('-s', step.selector);
    if (step.compact) flags.push('-c');
    const result = await abExec(session, ['snapshot', ...flags], opts);
    if (result.ok) _lastSnapshot = result.stdout;
    return result;
  }

  // ── Branch (state-machine pattern) ──
  if (step.type === 'branch') {
    if (!evaluateCondition(step.condition, params)) {
      return { stdout: 'branch skipped', stderr: '', ok: true };
    }
    // "DONE" string means success — no sub-steps to execute
    if (typeof step.then === 'string') {
      return { stdout: step.then, stderr: '', ok: true };
    }
    // Execute sub-steps sequentially
    for (const subStep of step.then) {
      const result = await executeEvalStep(session, subStep, headless, params, mcpCtx);
      if (!result.ok) return result;
    }
    return { stdout: 'branch completed', stderr: '', ok: true };
  }

  // ── Eval (JS execution via stdin) ──
  if (step.eval) {
    return abEval(session, step.eval, opts);
  }

  // ── Navigate ──
  if (step.navigate) {
    return abNavigate(session, step.navigate, opts);
  }

  // ── Click (supports @ref and CSS selectors) ──
  if (step.click) {
    return abExec(session, ['click', step.click], opts);
  }
  if (step.ref && (step.type === 'click' || !step.type)) {
    return abExec(session, ['click', `@${step.ref}`], opts);
  }
  if (step.type === 'dblclick' && (step.ref || step.selector)) {
    return abExec(session, ['dblclick', step.ref ? `@${step.ref}` : step.selector], opts);
  }

  // ── Fill (clear + type) ──
  if (step.fill !== undefined && (step.ref || step.selector)) {
    const target = step.ref ? `@${step.ref}` : step.selector;
    return abExec(session, ['fill', target, step.fill], opts);
  }

  // ── Type (keystroke into element) ──
  if (step.type && step.selector) {
    return abExec(session, ['type', step.selector, step.type], opts);
  }
  if (step.type === 'type' && step.ref && step.text) {
    return abExec(session, ['type', `@${step.ref}`, step.text], opts);
  }

  // ── Press key ──
  if (step.press) {
    return abExec(session, ['press', step.press], opts);
  }

  // ── Hover ──
  if (step.hover) {
    return abExec(session, ['hover', step.hover], opts);
  }

  // ── Focus ──
  if (step.focus) {
    return abExec(session, ['focus', step.focus], opts);
  }

  // ── Check / Uncheck ──
  if (step.check) {
    return abExec(session, ['check', step.check], opts);
  }
  if (step.uncheck) {
    return abExec(session, ['uncheck', step.uncheck], opts);
  }

  // ── Select (dropdown) ──
  if (step.select && step.value) {
    const values = Array.isArray(step.value) ? step.value : [step.value];
    return abExec(session, ['select', step.select, ...values], opts);
  }

  // ── Scroll ──
  if (step.scroll) {
    const args = ['scroll', step.scroll];
    if (step.pixels) args.push(String(step.pixels));
    return abExec(session, args, opts);
  }
  if (step.scrollintoview) {
    return abExec(session, ['scrollintoview', step.scrollintoview], opts);
  }

  // ── Wait (element, ms, or --load) ──
  if (step.wait) {
    const args = ['wait'];
    if (step.wait === 'networkidle' || step.wait === 'load') {
      args.push('--load', step.wait);
    } else {
      args.push(String(step.wait));
    }
    return abExec(session, args, { ...opts, timeout: step.timeout || AB_TIMEOUT });
  }
  if (step.wait_fn) {
    return abExec(session, ['wait', '--fn', step.wait_fn], {
      ...opts,
      timeout: step.timeout || AB_TIMEOUT,
    });
  }

  // ── Screenshot ──
  if (step.screenshot || step.type === 'screenshot') {
    const args = ['screenshot'];
    if (typeof step.screenshot === 'string') args.push(step.screenshot);
    return abExec(session, args, opts);
  }

  // ── Get info (text, html, value, attr, title, url, count) ──
  if (step.get) {
    const args = ['get', step.get];
    if (step.selector || step.ref) args.push(step.ref ? `@${step.ref}` : step.selector);
    if (step.attr) args.push(step.attr);
    return abExec(session, args, opts);
  }

  // ── Is check (visible, enabled, checked) ──
  if (step.is) {
    const target = step.ref ? `@${step.ref}` : step.selector;
    return abExec(session, ['is', step.is, target], opts);
  }

  // ── Find (role, text, label, etc.) ──
  if (step.find) {
    const args = ['find', step.find.locator, step.find.value, step.find.action || 'click'];
    if (step.find.text) args.push(step.find.text);
    return abExec(session, args, opts);
  }

  // ── Upload ──
  if (step.upload && step.files) {
    const files = Array.isArray(step.files) ? step.files : [step.files];
    return abExec(session, ['upload', step.upload, ...files], opts);
  }

  // ── Cookies ──
  if (step.cookies) {
    return abExec(session, ['cookies', step.cookies], opts);
  }

  // ── Keyboard ──
  if (step.keyboard) {
    return abExec(session, ['keyboard', step.keyboard.action, step.keyboard.text], opts);
  }

  // ── Reload / Back / Forward ──
  if (step.reload) return abExec(session, ['reload'], opts);
  if (step.back) return abExec(session, ['back'], opts);
  if (step.forward) return abExec(session, ['forward'], opts);

  // ── Generic command (escape hatch) ──
  if (step.command) {
    const parts = Array.isArray(step.command) ? step.command : step.command.split(' ');
    return abExec(session, parts, opts);
  }

  // ── MCP call (backend data verification — any platform) ──
  if (step.type === 'mcp_call') {
    return executeMcpCallStep(step, mcpCtx);
  }

  // ── Assert (check last MCP/API response) ──
  if (step.type === 'assert') {
    return executeAssertStep(step);
  }

  // ── Capture (save field from last MCP/API response) ──
  if (step.type === 'capture') {
    return executeCaptureStep(step);
  }

  return { stdout: '', stderr: `Unknown step type: ${JSON.stringify(Object.keys(step))}`, ok: false };
}

// ─── Backend Verification Steps ────────────────────────────────────────────
//
// Supports API-based backend verification. Step types:
//   bubble_api  — HTTP call to Bubble's Data API (list or get records)
//   assert      — validate fields in _lastApiResponse
//   capture     — save fields from _lastApiResponse to _captures map
//
// The _captures map is accessible via {{capture:name}} substitution in
// subsequent eval steps (profile/fixture substitution already exists).

/**
 * Execute any MCP tool and store the response for assert/capture steps.
 * This is the generic backend verification mechanism — works with any
 * MCP tool: bubble_list_records, supabase_query, or any future tool.
 */
async function executeMcpCallStep(step, mcpCtx) {
  if (!mcpCtx?.mcpUrl || !mcpCtx?.token) {
    return { stdout: '', stderr: 'mcp_call: no MCP context (mcpUrl/token) available', ok: false };
  }
  const tool = step.tool;
  if (!tool) return { stdout: '', stderr: 'mcp_call: "tool" field required', ok: false };

  // Route to the correct MCP server:
  //   V3 (/mcp/v3/) — QA tools (resolve_action, get_test_details, etc.)
  //   V1 (/mcp/)    — Project data tools (bubble_list_records, supabase_query, etc.)
  // Backend verification blocks use data tools → V1
  const url = mcpCtx.mcpDataUrl || mcpCtx.mcpUrl;

  try {
    const result = await mcpCall(url, mcpCtx.token, tool, step.params || {});

    // Fail loudly on error responses — don't silently fall through to assert steps.
    // mcpCall may return: a string (MCP error text), { error: "..." }, or { success: false, error: "..." }
    if (typeof result === 'string' && result.startsWith('MCP error')) {
      return { stdout: '', stderr: `mcp_call ${tool} failed: ${result.slice(0, 300)}`, ok: false };
    }
    if (result?.error) {
      return { stdout: '', stderr: `mcp_call ${tool} failed: ${typeof result.error === 'string' ? result.error : JSON.stringify(result.error)}`.slice(0, 300), ok: false };
    }
    if (result?.success === false) {
      return { stdout: '', stderr: `mcp_call ${tool} failed: ${result.message || result.error || 'unknown error'}`, ok: false };
    }

    _lastApiResponse = result?.data || result;

    // Normalize list responses for assert/capture convenience:
    // - Bubble returns { response: { results: [...], remaining: N } }
    // - Supabase returns { rows: [...] } or an array directly
    const rows = _lastApiResponse?.response?.results
      || _lastApiResponse?.rows
      || (Array.isArray(_lastApiResponse) ? _lastApiResponse : null);

    if (rows) {
      _lastApiResponse._results = rows;
      _lastApiResponse._result_count = rows.length;
    }

    const count = _lastApiResponse._result_count ?? '?';
    return { stdout: `ok: ${tool} returned ${count} record(s)`, stderr: '', ok: true };
  } catch (err) {
    return { stdout: '', stderr: `mcp_call ${tool}: ${err.message}`, ok: false };
  }
}

/**
 * Assert conditions on the last API response.
 * Supported checks: expected_min, expected_max, expected_value, expected_contains
 */
function executeAssertStep(step) {
  if (!_lastApiResponse) {
    return { stdout: '', stderr: 'assert: no prior API response to check', ok: false };
  }

  const field = step.field;
  let actual;

  if (field === 'result_count') {
    actual = _lastApiResponse._result_count ?? 0;
  } else if (_lastApiResponse._results && _lastApiResponse._results.length > 0) {
    // Get field from first result
    actual = _lastApiResponse._results[0][field];
  } else if (_lastApiResponse.response) {
    actual = _lastApiResponse.response[field];
  } else {
    actual = _lastApiResponse[field];
  }

  // expected_min
  if (step.expected_min !== undefined && (actual === undefined || actual < step.expected_min)) {
    return { stdout: '', stderr: `assert: ${field} = ${actual}, expected >= ${step.expected_min}`, ok: false };
  }
  // expected_max
  if (step.expected_max !== undefined && (actual === undefined || actual > step.expected_max)) {
    return { stdout: '', stderr: `assert: ${field} = ${actual}, expected <= ${step.expected_max}`, ok: false };
  }
  // expected_value (exact match)
  if (step.expected_value !== undefined && actual !== step.expected_value) {
    return { stdout: '', stderr: `assert: ${field} = ${JSON.stringify(actual)}, expected ${JSON.stringify(step.expected_value)}`, ok: false };
  }
  // expected_contains (string includes)
  if (step.expected_contains !== undefined && (!actual || !String(actual).includes(step.expected_contains))) {
    return { stdout: '', stderr: `assert: ${field} does not contain "${step.expected_contains}", got ${JSON.stringify(actual)}`, ok: false };
  }

  return { stdout: `ok: assert ${field} = ${JSON.stringify(actual)}`, stderr: '', ok: true };
}

/**
 * Capture a field from the last API response into the _captures map.
 */
function executeCaptureStep(step) {
  if (!_lastApiResponse) {
    return { stdout: '', stderr: 'capture: no prior API response', ok: false };
  }

  const field = step.field;
  const as = step.as;
  if (!as) return { stdout: '', stderr: 'capture: "as" name required', ok: false };

  let value;
  if (field === 'result_count') {
    value = _lastApiResponse._result_count ?? 0;
  } else if (_lastApiResponse._results && _lastApiResponse._results.length > 0) {
    value = _lastApiResponse._results[0][field];
  } else if (_lastApiResponse.response) {
    value = _lastApiResponse.response[field];
  } else {
    value = _lastApiResponse[field];
  }

  if (value === undefined) {
    return { stdout: '', stderr: `capture: field "${field}" not found in response`, ok: false };
  }

  _captures.set(as, value);
  return { stdout: `ok: captured ${as} = ${JSON.stringify(value)}`, stderr: '', ok: true };
}

async function pollVerify(session, verifyStep, headless) {
  const timeout = verifyStep.timeout || VERIFY_POLL_MAX;
  const interval = verifyStep.interval || VERIFY_POLL_INTERVAL;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const result = await executeEvalStep(session, verifyStep, headless, undefined, undefined);
    if (result.ok && result.stdout && result.stdout !== 'false' && result.stdout !== 'null' && result.stdout !== 'undefined') {
      return { ...result, verified: true };
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  return { stdout: '', stderr: `Verify timed out after ${timeout}ms`, ok: false, verified: false };
}

async function executeBlock(session, block, blockIndex, mcpUrl, token, headless, log, fixturePaths, acquiredProfiles, environmentId, baseUrl, mcpDataUrl) {
  const blockLog = {
    block: blockIndex,
    block_type: block.block_type || 'frontend',
    block_mode: block.block_mode || 'scripted',
    profile_display: block.profile_display || null,
    actions: [],
    console_errors: [],
    status: 'pending',
    started_at: new Date().toISOString(),
  };

  // ── BLOCK-LEVEL AGENTIC MODE ────────────────────────────────────────────
  // Agentic blocks halt the deterministic runner before any action execution.
  // The parent Sonnet agent receives a briefing via the pause envelope (main()
  // loop), executes the block with its own tools (Playwright, bubble_api,
  // etc.), marks the block as passed in the structured_log via save_execution_log,
  // then resumes the runner with --continue --from-block N+1.
  //
  // We halt BEFORE profile acquisition — the parent agent manages its own
  // session context for agentic blocks and doesn't need a locked profile.
  if (block.block_mode === 'agentic') {
    blockLog.agentic_brief = block.agentic_brief || block.expected_outcome || '';
    blockLog.status = 'agentic_pause';
    log.blocks.push(blockLog);
    return { success: false, agenticPause: true, block: blockIndex, action: 0, log: blockLog };
  }

  // Acquire profile for this block's role (frontend blocks only)
  let blockProfile = null;
  if (block.block_type !== 'backend' && (block.role || block.profile_id)) {
    const role = block.role || 'default';
    // Use profile_name as cache key when specified (avoids returning wrong profile
    // when multiple profiles share the same role, e.g., "Customer" vs "Customer B")
    const cacheKey = block.profile_name || role;
    try {
      blockProfile = await acquireProfile(mcpUrl, token, role, environmentId, acquiredProfiles, block.profile_name, cacheKey, block.properties);
      blockLog.profile_display = blockProfile.profile_display || blockProfile.profile_name || role;
    } catch (err) {
      blockLog.status = 'failed';
      blockLog.error = `Failed to acquire profile for role "${role}": ${err.message}`;
      log.blocks.push(blockLog);
      return { success: false, log: blockLog };
    }
  }

  // Navigate to entry_url if set (substitute {{base_url}} placeholder)
  if (block.entry_url) {
    let entryUrl = block.entry_url;
    if (baseUrl) entryUrl = entryUrl.replaceAll('{{base_url}}', baseUrl.replace(/\/$/, ''));
    const navResult = await abNavigate(session, entryUrl, { headed: !headless });
    if (!navResult.ok) {
      blockLog.status = 'failed';
      blockLog.error = `Failed to navigate to entry_url: ${navResult.stderr}`;
      log.blocks.push(blockLog);
      return { success: false, log: blockLog };
    }
  }

  const actions = block.actions || [];
  for (let ai = 0; ai < actions.length; ai++) {
    const action = actions[ai];
    const actionLog = {
      index: ai,
      type: action.type || 'deterministic',
      started_at: new Date().toISOString(),
    };

    // Check for agentic action
    if (action.type === 'agentic') {
      blockLog.actions.push({ ...actionLog, status: 'agentic_pause' });
      blockLog.status = 'agentic_pause';
      log.blocks.push(blockLog);
      return { success: false, agenticPause: true, block: blockIndex, action: ai, log: blockLog };
    }

    try {
      // Resolve component references
      const resolved = await resolveAction(mcpUrl, token, action);
      if (resolved.agentic) {
        blockLog.actions.push({ ...actionLog, status: 'agentic_pause' });
        blockLog.status = 'agentic_pause';
        log.blocks.push(blockLog);
        return { success: false, agenticPause: true, block: blockIndex, action: ai, log: blockLog };
      }

      // Wait before
      if (action.wait_before) {
        await new Promise(resolve => setTimeout(resolve, action.wait_before));
      }

      // Execute each resolved eval step
      let lastResult = null;
      for (const step of resolved.steps) {
        // Substitute fixture paths in eval code
        let processedStep = step;
        if (fixturePaths && Object.keys(fixturePaths).length > 0) {
          const stepStr = JSON.stringify(step);
          let replaced = stepStr;
          for (const [name, localPath] of Object.entries(fixturePaths)) {
            replaced = replaced.replaceAll(`{{fixture:${name}}}`, localPath);
          }
          if (replaced !== stepStr) processedStep = JSON.parse(replaced);
        }

        // Substitute profile credentials ({{profile.email}}, {{profile.password}}, etc.)
        if (blockProfile) {
          processedStep = substituteProfileCredentials(processedStep, blockProfile);
        }

        // Substitute {{base_url}} with the CLI-provided base URL
        if (baseUrl) {
          const stepStr = JSON.stringify(processedStep);
          const replaced = stepStr.replaceAll('{{base_url}}', baseUrl.replace(/\/$/, ''));
          if (replaced !== stepStr) processedStep = JSON.parse(replaced);
        }

        // Substitute {{capture:name}} references in step fields
        if (_captures.size > 0) {
          let stepStr = JSON.stringify(processedStep);
          for (const [name, val] of _captures) {
            stepStr = stepStr.replaceAll(`{{capture:${name}}}`, typeof val === 'string' ? val : JSON.stringify(val));
          }
          processedStep = JSON.parse(stepStr);
        }

        lastResult = await executeEvalStep(session, processedStep, headless, action.params, { mcpUrl, mcpDataUrl, token });

        // Failure detection — TWO independent triggers:
        //   1. Process-level: agent-browser exited non-zero (timeout, crash, MCP error)
        //   2. Eval convention: the JS expression returned an 'nf:' (not found) marker.
        //      Component eval steps in Ori use the convention `cond ? 'ok: ...' : 'nf: <reason>'`.
        //      agent-browser exits 0 when the JS runs cleanly, so we MUST inspect stdout content.
        //      Without this check, every component "not found" return silently rubber-stamps
        //      the action and the test reports green against a non-completed flow.
        //
        // NOTE on stderr: agent-browser writes warnings (e.g. "--headed ignored: daemon
        // already running") to stderr on successful invocations. We do NOT treat stderr
        // alone as failure — only when the process also exited non-zero. The original
        // pre-fix runner had this scoping right; an earlier version of this fix
        // incorrectly added `!!stderr` to isFailure, which made warnings fatal.
        const stdoutTrim = (lastResult.stdout || '').trim();
        const isNfReturn = stdoutTrim === 'nf' || stdoutTrim.startsWith('nf:');
        const isFailure = !lastResult.ok || isNfReturn;

        if (isFailure) {
          // Capture DOM snapshot + screenshot on failure
          const snapshot = await abSnapshot(session);
          const screenshot = await abScreenshot(session);
          actionLog.failure = {
            step: processedStep,
            stdout: lastResult.stdout,
            stderr: lastResult.stderr,
            dom_snapshot: snapshot.stdout?.slice(0, 2000),
            screenshot: screenshot.stdout,
            detection: isNfReturn ? 'nf_return' : (!lastResult.ok ? 'process_error' : 'process_stderr'),
          };
          actionLog.status = 'failed';
          blockLog.actions.push(actionLog);
          blockLog.status = 'failed';
          log.blocks.push(blockLog);
          return { success: false, log: blockLog };
        }
      }

      // Wait after
      if (action.wait_after) {
        await new Promise(resolve => setTimeout(resolve, action.wait_after));
      }

      // Verify (polling)
      if (action.verify) {
        const verifyResult = await pollVerify(session, action.verify, headless);
        actionLog.verify = {
          result: verifyResult.stdout,
          verified: verifyResult.verified,
          duration_ms: Date.now() - new Date(actionLog.started_at).getTime(),
        };
        if (!verifyResult.verified) {
          actionLog.status = 'failed';
          actionLog.failure = { reason: 'verify_timeout', stderr: verifyResult.stderr };
          blockLog.actions.push(actionLog);
          blockLog.status = 'failed';
          log.blocks.push(blockLog);
          return { success: false, log: blockLog };
        }
      }

      actionLog.status = 'passed';
      actionLog.result = lastResult?.stdout?.slice(0, 500);
      actionLog.duration_ms = Date.now() - new Date(actionLog.started_at).getTime();
      blockLog.actions.push(actionLog);

    } catch (err) {
      actionLog.status = 'error';
      actionLog.error = err.message;
      blockLog.actions.push(actionLog);
      blockLog.status = 'failed';
      log.blocks.push(blockLog);
      return { success: false, log: blockLog };
    }
  }

  // Console error check after block
  const errors = await abErrors(session);
  // Strip ANSI escape codes from agent-browser output formatting before checking
  const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').trim();
  if (errors.ok && errors.stdout && stripAnsi(errors.stdout) !== '[]' && stripAnsi(errors.stdout) !== '') {
    try {
      const parsed = JSON.parse(stripAnsi(errors.stdout));
      if (Array.isArray(parsed) && parsed.length > 0) {
        blockLog.console_errors = parsed;
        blockLog.status = 'failed';
        blockLog.error = `Console errors detected: ${parsed.length} error(s)`;
        log.blocks.push(blockLog);
        return { success: false, log: blockLog };
      }
    } catch {
      // Non-JSON errors output — check if non-empty after ANSI stripping
      const cleaned = stripAnsi(errors.stdout);
      if (cleaned.length > 0 && cleaned !== '✗' && cleaned !== '✓') {
        blockLog.console_errors = [cleaned];
        blockLog.status = 'failed';
        blockLog.error = 'Console errors detected';
        log.blocks.push(blockLog);
        return { success: false, log: blockLog };
      }
    }
  }

  blockLog.status = 'passed';
  blockLog.finished_at = new Date().toISOString();
  log.blocks.push(blockLog);
  return { success: true, log: blockLog };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  checkNodeVersion();
  sweepDeadAgentBrowserSessions();
  const opts = parseArgs();

  const log = {
    test_case_id: opts.testCaseId,
    runner_type: 'deterministic',
    started_at: new Date().toISOString(),
    base_url: opts.baseUrl,
    session: opts.session,
    blocks: [],
    status: 'running',
  };

  let executionId = opts.continueExecId || null;
  let fixturePaths = {};
  const acquiredProfiles = new Map(); // role → profile data

  // On normal exit, clean up fixture temp files (profiles released explicitly before each exit point)
  process.on('exit', () => { cleanupFixtures(opts.testCaseId); });
  process.on('SIGTERM', () => {
    // Best-effort cleanup (async, may not complete before exit)
    releaseAllProfiles(opts.mcpUrl, opts.token, acquiredProfiles).catch(() => {});
    abClose(opts.session).catch(() => {});
    cleanupFixtures(opts.testCaseId);
    process.exit(1);
  });
  process.on('SIGINT', () => {
    releaseAllProfiles(opts.mcpUrl, opts.token, acquiredProfiles).catch(() => {});
    abClose(opts.session).catch(() => {});
    cleanupFixtures(opts.testCaseId);
    process.exit(1);
  });

  try {
    // Get test case details via MCP
    const testDetails = await mcpCall(opts.mcpUrl, opts.token, 'get_test_details', {
      test_case_id: opts.testCaseId,
    });

    if (!testDetails?.data && !testDetails?.scenario_blocks) {
      throw new Error(`Test case not found or has no data: ${opts.testCaseId}`);
    }

    const testData = testDetails.data || testDetails;
    const blocks = testData.scenario_blocks || [];

    if (blocks.length === 0) {
      throw new Error('Test case has no scenario_blocks');
    }

    // Seal enforcement (R11, task 7.4): verify signatures before execution
    const hasComponentActions = blocks.some(b =>
      (b.actions || []).some(a => a.component)
    );
    if (hasComponentActions) {
      // Component-format tests require journey_signature
      if (!testData.journey_signature) {
        throw new Error('Test case uses component actions but has no journey_signature. Run review + sign before executing.');
      }
    } else {
      // Legacy-format tests require review_signature
      if (!testData.review_signature) {
        throw new Error('Test case has no review_signature. Run review + sign before executing.');
      }
    }

    // Resolve environment ID for profile locking
    let environmentId = testData.environment_id || null;
    if (!environmentId) {
      try {
        const envs = await mcpCall(opts.mcpUrl, opts.token, 'get_test_environments', {});
        const envList = envs?.data || envs || [];
        const env = Array.isArray(envList) ? envList.find(e => opts.baseUrl.includes(e.base_url)) || envList[0] : null;
        if (env) environmentId = env.id;
      } catch { /* continue without environment — profile locking will use defaults */ }
    }

    // Download fixtures
    if (testData.fixtures && Object.keys(testData.fixtures).length > 0) {
      fixturePaths = await downloadFixtures(opts.mcpUrl, opts.token, opts.testCaseId);
    }

    // If continuing, load existing log
    if (opts.continueExecId) {
      try {
        const existingLog = await mcpCall(opts.mcpUrl, opts.token, 'get_execution_log', {
          execution_id: opts.continueExecId,
        });
        if (existingLog?.data?.structured_log) {
          log.blocks = existingLog.data.structured_log.blocks || [];
        }
      } catch {
        console.error('[warn] Could not load existing execution log, starting fresh');
      }
    }

    // Determine start block
    const startBlock = opts.fromBlock >= 0 ? opts.fromBlock : 0;

    // Execute blocks sequentially — skip already-completed blocks (R6)
    for (let bi = startBlock; bi < blocks.length; bi++) {
      // When continuing, skip blocks already recorded as passed in the loaded log
      if (opts.continueExecId && log.blocks[bi] && log.blocks[bi].status === 'passed') {
        console.error(`[block ${bi}/${blocks.length - 1}] SKIP (already passed)`);
        continue;
      }

      const block = blocks[bi];
      console.error(`[block ${bi}/${blocks.length - 1}] ${block.block_type || 'frontend'} — ${block.description || 'unnamed'}`);

      const result = await executeBlock(
        opts.session, block, bi,
        opts.mcpUrl, opts.token,
        opts.headless, log, fixturePaths,
        acquiredProfiles, environmentId, opts.baseUrl, opts.mcpDataUrl
      );

      if (result.agenticPause) {
        // Save partial log and exit with code 42
        log.status = 'agentic_pause';
        log.paused_at_block = result.block;
        log.paused_at_action = result.action;

        // Save to DB
        const saveResult = await mcpCall(opts.mcpUrl, opts.token, 'save_execution_log', {
          test_case_id: opts.testCaseId,
          execution_id: executionId || undefined,
          structured_log: log,
          status: 'blocked',
        });
        executionId = saveResult?.execution_id || saveResult?.data?.execution_id || executionId;

        // Output pause info to stdout for the calling agent.
        // Enriched with everything the parent needs to execute the block
        // without round-tripping back to MCP for test details.
        const pausedBlock = blocks[result.block] || {};
        const pauseInfo = {
          status: 'agentic_pause',
          block: result.block,
          action: result.action,
          execution_id: executionId,
          test_case_id: opts.testCaseId,
          // Block-level agentic ('agentic') vs action-level agentic ('scripted' with
          // an agentic action embedded). Parent agent uses this to decide whether
          // to fulfill a whole-block brief or just a single action.
          block_mode: result.log?.block_mode || 'scripted',
          agentic_brief: result.log?.agentic_brief || pausedBlock.agentic_brief || null,
          // Self-contained briefing so the parent doesn't need to re-fetch test details
          block_info: {
            block_type: pausedBlock.block_type || 'frontend',
            role: pausedBlock.role || null,
            profile_name: pausedBlock.profile_name || null,
            entry_url: pausedBlock.entry_url || null,
            expected_outcome: pausedBlock.expected_outcome || null,
          },
          // Captures so far — parent can reference {{capture:name}} values from
          // previous scripted blocks when executing its agentic brief.
          captures: Object.fromEntries(_captures),
          // Guidance for the parent. Whichever path it takes, it must update
          // the structured_log before resuming so --continue skips this block.
          next_step: `Execute the brief with your own tools (Playwright via agent-browser, bubble_api via MCP). Then call save_execution_log to mark block ${result.block} as 'passed' in structured_log.blocks[${result.block}]. Finally resume with: node ${__filename} ${opts.testCaseId} <base_url> --continue ${executionId || '<check saved execution_id>'} --from-block ${result.block + 1}`,
        };
        console.log(JSON.stringify(pauseInfo));
        await releaseAllProfiles(opts.mcpUrl, opts.token, acquiredProfiles);
        await abClose(opts.session).catch(() => {});
        process.exit(42);
      }

      if (!result.success) {
        // Block failed — release profiles, save log and exit
        log.status = 'failed';
        log.failed_at_block = bi;
        log.finished_at = new Date().toISOString();

        await releaseAllProfiles(opts.mcpUrl, opts.token, acquiredProfiles);
        await mcpCall(opts.mcpUrl, opts.token, 'save_execution_log', {
          test_case_id: opts.testCaseId,
          execution_id: executionId || undefined,
          structured_log: log,
          status: 'failed',
        });

        // Write local log
        const logPath = `${LOG_FILE_PREFIX}${Date.now()}.json`;
        fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
        console.error(`[FAIL] Block ${bi} failed. Log: ${logPath}`);
        await abClose(opts.session).catch(() => {});
        process.exit(1);
      }
    }

    // All blocks passed
    log.status = 'passed';
    log.finished_at = new Date().toISOString();

    const saveResult = await mcpCall(opts.mcpUrl, opts.token, 'save_execution_log', {
      test_case_id: opts.testCaseId,
      execution_id: executionId || undefined,
      structured_log: log,
      status: 'passed',
    });
    executionId = saveResult?.execution_id || saveResult?.data?.execution_id || executionId;

    // Write local log
    const logPath = `${LOG_FILE_PREFIX}${Date.now()}.json`;
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
    console.error(`[PASS] All ${blocks.length} blocks passed. Log: ${logPath}`);

    // Release all acquired profiles
    await releaseAllProfiles(opts.mcpUrl, opts.token, acquiredProfiles);
    await abClose(opts.session).catch(() => {});

    process.exit(0);

  } catch (err) {
    log.status = 'error';
    log.error = err.message;
    log.finished_at = new Date().toISOString();

    // Release profiles and close browser before exit
    try { await releaseAllProfiles(opts.mcpUrl, opts.token, acquiredProfiles); } catch { /* best effort */ }
    try { await abClose(opts.session); } catch { /* best effort */ }

    // Try to save error log
    try {
      await mcpCall(opts.mcpUrl, opts.token, 'save_execution_log', {
        test_case_id: opts.testCaseId,
        execution_id: executionId || undefined,
        structured_log: log,
        status: 'failed',
      });
    } catch { /* best effort */ }

    // Write local log
    const logPath = `${LOG_FILE_PREFIX}${Date.now()}.json`;
    try {
      fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
      console.error(`[ERROR] ${err.message}. Log: ${logPath}`);
    } catch {
      console.error(`[ERROR] ${err.message}`);
    }

    process.exit(1);
  }
}

main();
