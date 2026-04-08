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

const { execFile: execFileCb } = require('node:child_process');
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

  try {
    const { stdout, stderr } = await execFile('agent-browser', args, {
      maxBuffer: MAX_BUFFER,
      timeout: opts.timeout || AB_TIMEOUT,
      ...(opts.stdin ? { input: opts.stdin } : {}),
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
async function acquireProfile(mcpUrl, token, role, environmentId, acquiredProfiles) {
  // Check if we already acquired a profile for this role
  if (acquiredProfiles.has(role)) return acquiredProfiles.get(role);

  const result = await mcpCall(mcpUrl, token, 'acquire_profile', {
    role,
    environment_id: environmentId,
  });

  const profile = result?.data || result;
  if (!profile?.profile_id) throw new Error(`acquire_profile failed for role "${role}": no profile returned`);

  acquiredProfiles.set(role, profile);
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

async function executeEvalStep(session, step, headless) {
  // Step can be: { eval: "code" } or { navigate: "url" } or { type: "text", selector: "sel" } etc.
  if (step.eval) {
    return abEval(session, step.eval, { headed: !headless });
  }
  if (step.navigate) {
    return abNavigate(session, step.navigate, { headed: !headless });
  }
  if (step.click) {
    return abExec(session, ['click', step.click], { headed: !headless });
  }
  if (step.type && step.selector) {
    return abExec(session, ['type', step.selector, step.type], { headed: !headless });
  }
  if (step.wait_fn) {
    return abExec(session, ['wait', '--fn', step.wait_fn], {
      headed: !headless,
      timeout: step.timeout || AB_TIMEOUT,
    });
  }
  // Generic command
  if (step.command) {
    const parts = Array.isArray(step.command) ? step.command : step.command.split(' ');
    return abExec(session, parts, { headed: !headless });
  }
  return { stdout: '', stderr: 'Unknown step type', ok: false };
}

async function pollVerify(session, verifyStep, headless) {
  const timeout = verifyStep.timeout || VERIFY_POLL_MAX;
  const interval = verifyStep.interval || VERIFY_POLL_INTERVAL;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const result = await executeEvalStep(session, verifyStep, headless);
    if (result.ok && result.stdout && result.stdout !== 'false' && result.stdout !== 'null' && result.stdout !== 'undefined') {
      return { ...result, verified: true };
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  return { stdout: '', stderr: `Verify timed out after ${timeout}ms`, ok: false, verified: false };
}

async function executeBlock(session, block, blockIndex, mcpUrl, token, headless, log, fixturePaths, acquiredProfiles, environmentId, baseUrl) {
  const blockLog = {
    block: blockIndex,
    block_type: block.block_type || 'frontend',
    profile_display: block.profile_display || null,
    actions: [],
    console_errors: [],
    status: 'pending',
    started_at: new Date().toISOString(),
  };

  // Acquire profile for this block's role (frontend blocks only)
  let blockProfile = null;
  if (block.block_type !== 'backend' && (block.role || block.profile_id)) {
    const role = block.role || 'default';
    try {
      blockProfile = await acquireProfile(mcpUrl, token, role, environmentId, acquiredProfiles);
      blockLog.profile_display = blockProfile.profile_display || blockProfile.profile_name || role;
    } catch (err) {
      blockLog.status = 'failed';
      blockLog.error = `Failed to acquire profile for role "${role}": ${err.message}`;
      log.blocks.push(blockLog);
      return { success: false, log: blockLog };
    }
  }

  // Navigate to entry_url if set
  if (block.entry_url) {
    const navResult = await abNavigate(session, block.entry_url, { headed: !headless });
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

        lastResult = await executeEvalStep(session, processedStep, headless);
        if (!lastResult.ok) {
          // Eval returned error or 'nf' (not found)
          if (lastResult.stdout === 'nf' || lastResult.stderr) {
            // Capture DOM snapshot + screenshot on failure
            const snapshot = await abSnapshot(session);
            const screenshot = await abScreenshot(session);
            actionLog.failure = {
              step: processedStep,
              stdout: lastResult.stdout,
              stderr: lastResult.stderr,
              dom_snapshot: snapshot.stdout?.slice(0, 2000),
              screenshot: screenshot.stdout,
            };
            actionLog.status = 'failed';
            blockLog.actions.push(actionLog);
            blockLog.status = 'failed';
            log.blocks.push(blockLog);
            return { success: false, log: blockLog };
          }
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
  if (errors.ok && errors.stdout && errors.stdout.trim() !== '[]' && errors.stdout.trim() !== '') {
    try {
      const parsed = JSON.parse(errors.stdout);
      if (Array.isArray(parsed) && parsed.length > 0) {
        blockLog.console_errors = parsed;
        blockLog.status = 'failed';
        blockLog.error = `Console errors detected: ${parsed.length} error(s)`;
        log.blocks.push(blockLog);
        return { success: false, log: blockLog };
      }
    } catch {
      // Non-JSON errors output — check if non-empty
      if (errors.stdout.trim().length > 0) {
        blockLog.console_errors = [errors.stdout.trim()];
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
    // Best-effort profile release (async, may not complete before exit)
    releaseAllProfiles(opts.mcpUrl, opts.token, acquiredProfiles).catch(() => {});
    cleanupFixtures(opts.testCaseId);
    process.exit(1);
  });
  process.on('SIGINT', () => {
    releaseAllProfiles(opts.mcpUrl, opts.token, acquiredProfiles).catch(() => {});
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
        acquiredProfiles, environmentId, opts.baseUrl
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

        // Output pause info to stdout for the calling agent
        const pauseInfo = {
          status: 'agentic_pause',
          block: result.block,
          action: result.action,
          execution_id: executionId,
          test_case_id: opts.testCaseId,
        };
        console.log(JSON.stringify(pauseInfo));
        await releaseAllProfiles(opts.mcpUrl, opts.token, acquiredProfiles);
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

    process.exit(0);

  } catch (err) {
    log.status = 'error';
    log.error = err.message;
    log.finished_at = new Date().toISOString();

    // Release profiles before exit
    try { await releaseAllProfiles(opts.mcpUrl, opts.token, acquiredProfiles); } catch { /* best effort */ }

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
