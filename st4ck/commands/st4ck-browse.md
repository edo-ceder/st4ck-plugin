---
description: Drive a real browser one IPC primitive at a time. Snapshot the live page, decide your next action, send it, observe the result. Captures the trace as a markdown test file you can replay deterministically. Works on vanilla web stacks and on no-code platforms (Bubble, Retool, Webflow, n8n, Wix Velo, Glide, FlutterFlow).
argument-hint: <url> [--instruction "<text>"] [--out <path.md>] [--platform=auto|web|bubble|retool|webflow|n8n|wix-velo|glide|flutterflow] [--headless]
---

# /st4ck:browse

You drive a real browser one primitive at a time, observing the live page state between every action. The runner spawns Chrome, navigates to `<url>`, then waits for line-delimited JSON commands on stdin and emits one `ActionResult` JSON object on stdout per command. You alternate snapshot → primitive → snapshot until the page state matches what you came to verify, then exit via `{"op":"continue"}` (saves the trace to `--out`) or `{"op":"abort"}` (discards).

The captured trace is a deterministic markdown file. Replay it later with zero LLM cost via `npx st4ck-runner run --test-file <path> --no-mcp`.

## Spawn the runner

The runner is `st4ck-runner` — a thin Playwright wrapper that exposes the IPC primitive surface. Drive it via a stdin FIFO so you can send commands incrementally between observations.

```bash
mkfifo /tmp/st4ck-stdin-$$
npx st4ck-runner record <url> \
  --instruction "<one-line description of what you're verifying>" \
  --out <path.md> \
  < /tmp/st4ck-stdin-$$ &
exec 9>/tmp/st4ck-stdin-$$
```

Run this with `run_in_background: true` so the FIFO stays open while you iterate. Capture the `shell_id`. From now on:

- **Read** runner responses with `BashOutput(shell_id)`.
- **Send** commands with `echo '<json>' >&9` (one JSON object per line).

The runner emits an `agentic_pause` envelope on stdout immediately after launch. Read it before sending anything else — it carries `page_url`, `block_index`, `brief`, and confirms the page loaded.

## IPC primitive vocabulary

Every command is a JSON object with an `op` field. Locator-bearing primitives accept a `locator` object plus an optional `scope`. Each command returns `{"primitive": "...", "status": "passed"|"failed", "started_at": "...", "completed_at": "...", "error?": {...}, "evidence?": {...}}`.

### Locator shapes

```json
{"by": "testid",      "value": "submit-btn"}
{"by": "role",        "value": "button", "options": {"name": "Sign in", "exact": false}}
{"by": "label",       "value": "Email address", "options": {"exact": false}}
{"by": "placeholder", "value": "you@example.com"}
{"by": "text",        "value": "Forgot password?", "options": {"exact": false}}
{"by": "css",         "value": "form > .submit"}
```

Prefer `testid` > `role+name` > `label` > `placeholder` > `text` > `css`. CSS is the last resort — brittle to markup changes. Never bare-tag (`button`, `div`).

### Scope — disambiguating common strings

Optional `scope` constrains a locator to a container. Same shape as `within` on text-based primitives. Handles modals/popups/portals where the same element text appears in multiple places at once.

```json
"scope": "dialog"                                   // role-scoped to nearest open dialog
"scope": {"by": "testid", "value": "row-3"}         // arbitrary ancestor LocatorSpec
```

### Action commands (each captured into the recording)

| Op | Shape | Notes |
|---|---|---|
| Navigate | `{"op":"navigate","url":"https://...","timeout_ms":30000}` | URL may be relative; resolved against the current page. |
| Click | `{"op":"click","locator":{...},"scope":"dialog"}` | See no-code `dispatch_chain` flag below. |
| Fill | `{"op":"fill","locator":{...},"value":"alice@example.com"}` | See no-code `dispatch_events` flag below. |
| Press | `{"op":"press","key":"Enter","locator":{...}}` | Playwright `KeyboardEvent.key` shape: `"Enter"`, `"Escape"`, `"Tab"`, `"Control+a"`. |
| Select | `{"op":"select","locator":{...},"value":"opt-1"}` | Multi-select: `"value":["a","b"]`. See no-code `atomic` flag below. |
| Check_box | `{"op":"check_box","locator":{...},"checked":true}` | Toggles to the explicit boolean state — idempotent. |
| Hover | `{"op":"hover","locator":{...}}` |  |
| Upload | `{"op":"upload","locator":{...},"files":["/abs/path"]}` | Absolute paths only. |
| Wait_until | `{"op":"wait_until","args":{"kind":"visible","locator":{...},"timeout_ms":30000}}` | `kind ∈ visible / hidden / attached / detached / url / networkidle / custom`. For `kind:"url"` pass `url: "<regex-or-string>"`. For `kind:"custom"` pass `js: "<expression>"` plus `interval_ms`. |
| Evaluate | `{"op":"evaluate","js":"document.title"}` | Page-side JS expression. Result lands in `evidence.result`. Use for read-only checks; never mutate page state via evaluate. |

### Text-disambiguation primitives

When "Save" / "OK" / "Cancel" / "Submit" appears in multiple places and you don't have a stable testid:

```json
{"op":"click_by_text","text":"Save","within":"dialog"}
{"op":"click_by_text","text":"Save","role":"button","exact":true}
{"op":"hover_by_text","text":"Settings","within":{"by":"testid","value":"sidebar"}}
{"op":"type_by_text","text":"Search","value":"my query","within":"dialog"}
```

`within` accepts the same shapes as `scope` (`"dialog"` or any LocatorSpec). `role` narrows resolution without needing an ancestor.

### Conditional dispatch — `branch`

For "if X is visible, do A; else do B" patterns. Replaces the legacy `{type:"branch"}` eval-step in older systems.

```json
{
  "op": "branch",
  "args": {
    "condition": {"kind":"visible","locator":{"by":"text","value":"Welcome back"},"timeout_ms":3000},
    "then": [],
    "else": [
      {"primitive":"click","args":{"locator":{"by":"role","value":"button","options":{"name":"Sign in"}}}},
      {"primitive":"wait_until","args":{"kind":"visible","locator":{"by":"text","value":"Welcome back"}}}
    ]
  }
}
```

`condition` uses the same grammar as `wait_until` (kind / locator / url / js). Sub-steps inside `then` / `else` use the saved-step shape `{primitive, args, opts?}` — not the IPC `op` shape. Any primitive registered on Session is callable inside a branch arm.

### Observation commands (NOT captured into the recording)

```json
{"op":"snapshot"}    // a11y-tree YAML excerpt of the current page
{"op":"url"}         // current page URL
```

These are introspection-only — they don't land in the captured md file. Use them liberally between actions to ground your next decision.

### Control flow

```json
{"op":"continue"}                      // finalize the recording, write --out, exit 0
{"op":"abort","reason":"<short>"}      // discard the recording, exit 1
```

## No-code platform flags — per-call opt-ins

Bubble, Retool, Webflow, n8n, Wix Velo, Glide, and FlutterFlow have reactive runtimes that ignore some of Playwright's native primitive calls. Three per-call opt-in flags handle the difference. Set them on every relevant primitive when working against a no-code platform.

### `click({dispatch_chain: true})`

Bubble swallows plain `loc.click()` — its reactive runtime listens for the full pointer event chain, not just the synthetic click. With `dispatch_chain:true`, the runner dispatches `pointerdown → pointerup → click` MouseEvent chain via DOM events instead of Playwright's native `loc.click()`.

```json
{"op":"click","locator":{"by":"text","value":"Submit"},"dispatch_chain":true}
```

Required on most Bubble button/icon clicks. Default `false`.

### `fill({dispatch_events: ["input","change","blur"]})`

Bubble's reactive bindings only fire on dispatched events; native `fill` skips them on wrapped/synthetic inputs. With `dispatch_events`, after the value is set the runner re-dispatches the named events with `bubbles:true` so the platform's listeners see the value change.

```json
{"op":"fill","locator":{"by":"label","value":"Email"},"value":"alice","dispatch_events":["input","change"]}
```

Most Bubble text inputs need `["input","change"]`; some additionally need `["blur"]` (to fire validation handlers wired to focus loss). Default `[]`.

### `select({atomic: true})`

Defeats the "Element not found" race that Bubble triggers when its re-render fires between Playwright's resolve and act steps. With `atomic:true`, the runner performs set-value-and-dispatch-change in a single synchronous evaluate — the platform never sees a partially-updated state.

```json
{"op":"select","locator":{"by":"label","value":"Country"},"value":"NL","atomic":true}
```

Single-value only. Multi-select uses the default selectOption path. Default `false`.

## Session-level platform mode (forthcoming)

A session-level `--platform` flag is shipping in **PR-B** (next code drop after the validation harness Pass 1). When set to a closed-loop platform, the per-call flags above flip on as **defaults** so you don't have to pass them on every primitive:

```bash
npx st4ck-runner record <url> --platform=auto
npx st4ck-runner record <url> --platform=bubble
```

Detection precedence when `--platform=auto`:

1. Explicit flag (any value other than `auto`) wins.
2. Response headers (`X-Powered-By: Bubble`, `X-Powered-By: Webflow`, etc.).
3. DOM probe (`body[data-bubble]`, `meta[name="generator"]`, etc.) executed once via `evaluate`.
4. URL pattern (`*.bubbleapps.io`, `*.webflow.io`, etc.).
5. Fallback to `web` (no flag flips).

Recognized values: `auto` | `web` | `bubble` | `retool` | `webflow` | `n8n` | `wix-velo` | `glide` | `flutterflow`.

**Until PR-B ships**, the `--platform` flag is not recognized — set the per-call flags explicitly on every Bubble click/fill/select. Same end behavior, just verbose at the call site. Once PR-B ships I'll strike this paragraph.

## Driving strategy

1. **Snapshot first.** `{"op":"snapshot"}` before doing anything to discover stable locators on the live page. Don't guess from the URL.
2. **Verify each primitive live.** One command, read the response, reason about it, send the next. Never batch primitives blind — that defeats the point of live verification.
3. **Wait deliberately.** Playwright's auto-wait covers most actionability. Add an explicit `wait_until` only when crossing a structural transition (after a click that triggers navigation, after a modal opens, after an async list re-renders).
4. **Prefer accessible locators.** `testid` > `role+name` > `label` > `placeholder` > `text` > `css`. The runner's locator priority ladder gives you free Tier-1 self-heal on replay if you stick to the top tiers.
5. **Don't navigate via URL when a click is what should be verified.** A click is part of what the test exercises; jumping via URL skips the very thing the test exists to cover.
6. **`evaluate` is for reads, not mutations.** Mutating page state via evaluate makes the recording brittle on replay.

## Finish

When the page state matches what you came to verify, close out:

```bash
echo '{"op":"continue"}' >&9    # OR: echo '{"op":"abort","reason":"…"}' >&9
exec 9>&-
rm -f /tmp/st4ck-stdin-$$
```

`BashOutput(shell_id)` once more for the final `record_complete` envelope (on continue) or `agentic_aborted` (on abort) and the captured file path.

## Replay the captured trace

```bash
npx st4ck-runner run --test-file <path.md> --no-mcp [--headless]
```

Zero LLM, pure Playwright execution, ~10× faster than the recording, deterministic. Use after every code change to verify the flow still works.

## Discoverability

The runtime registry of primitive names + per-primitive flag shapes is also available via:

```bash
npx st4ck-runner --list-primitives
```

That's the canonical runtime source — if anything in this skill drifts from `--list-primitives`, the latter wins.
