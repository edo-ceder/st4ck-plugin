---
description: Drive a real browser one IPC primitive at a time. Snapshot the live page, decide your next action, send it, observe the result. Captures the trace as a markdown test file you can replay deterministically. Works on vanilla web stacks AND on reactive frameworks (Radix UI, Headless UI, MUI menus) AND on no-code platforms (Bubble, Retool, Webflow, n8n, Wix Velo, Glide, FlutterFlow).
argument-hint: <url> [--instruction "<text>"] [--out <path.md>] [--ipc-fifo <path>] [--no-blank-page-check] [--blank-page-delay <ms>] [--headless]
---

# /st4ck:browse

You drive a real browser one primitive at a time, observing the live page state between every action. The runner spawns Chrome, navigates to `<url>`, opens a POSIX FIFO for IPC commands, emits a `runner_ready` envelope on stdout, and waits. You alternate snapshot → primitive → snapshot until the page state matches what you came to verify, then exit via `{"op":"continue"}` (saves the trace to `--out`) or `{"op":"abort"}` (discards).

The captured trace is a deterministic markdown file. Replay it later with zero LLM cost via `npx st4ck-runner run --test-file <path> --no-mcp`.

## Spawn the runner — recommended one-line recipe

```bash
npx st4ck-runner record <url> \
  --instruction "<one-line description of what you're verifying>" \
  --out <path.md> \
  --ipc-fifo /tmp/st4ck.fifo &
```

Run this with `run_in_background: true` so it stays alive while you iterate. The runner creates `/tmp/st4ck.fifo`, opens it `O_RDWR` (so external writers can come and go without the FIFO seeing EOF), and on exit unlinks it automatically. Capture the `shell_id`. From now on:

- **Read** runner responses with `BashOutput(shell_id)`.
- **Send** commands by appending to the FIFO from any other Bash call: `echo '<json>' > /tmp/st4ck.fifo`.

The runner's first stdout envelope is the `runner_ready` envelope:

```json
{
  "type": "runner_ready",
  "page_url": "<url>",
  "page_errors": [],
  "blank_page_detected": false
}
```

`page_errors` is the buffer of uncaught exceptions thrown by the page during load — non-empty often correlates with `blank_page_detected: true` (a Vercel preview deploy missing an env var, a broken bundle, a CSS rule hiding everything). The pageerror listener attaches before navigation, so module-load throws are caught on the first paint.

## Without `--ipc-fifo` — manual FIFO recipe (fallback)

If `mkfifo` isn't available (e.g. plain Windows without WSL / Git Bash), the legacy recipe is:

```bash
mkfifo /tmp/st4ck-stdin-$$
npx st4ck-runner record <url> \
  --instruction "<text>" \
  --out <path.md> \
  < /tmp/st4ck-stdin-$$ &
exec 9>/tmp/st4ck-stdin-$$
```

`exec 9>/tmp/st4ck-stdin-$$` keeps the FIFO writer-side open in the calling shell. Subsequent `echo '<json>' >&9` calls send commands. The 3-line setup is fragile — `&` in the wrong place causes a deadlock. Prefer `--ipc-fifo` whenever you can.

## Heredoc-friendly multi-line JSON

Long `evaluate` expressions with embedded quotes routinely produce JSON-escape pain when sent on a single line. The runner supports multi-line JSON: it accumulates lines until JSON.parse succeeds, so heredocs work natively:

```bash
cat <<'EOF' > /tmp/st4ck.fifo
{"op":"evaluate",
 "js":"document.querySelectorAll('a, button').length"}
EOF
```

Single-line JSON parses on the first line (fast path). Multi-line JSON parses when the final `}` arrives.

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

### Observation + diagnostic commands (NOT captured into the recording)

```json
{"op":"snapshot"}                         // a11y-tree YAML excerpt of the current page
{"op":"url"}                              // current page URL
{"op":"page_errors","clear":true}         // drain uncaught exceptions thrown by the page since session start
```

These are introspection-only — they don't land in the captured md file. Use snapshot liberally between actions; use `page_errors` whenever the page behaves blank or unresponsive (returns the buffer of pageerror events captured by a listener that attached BEFORE navigation, so module-load throws are caught). Pass `clear:false` to peek without draining.

### Control flow

```json
{"op":"continue"}                      // finalize the recording, write --out, exit 0
{"op":"abort","reason":"<short>"}      // discard the recording, exit 1
```

stdin closing (writer-side disappears, e.g. Ctrl-C in the holder shell, agent process dies) is treated as `eof` — the trace IS saved (same as `continue`), not discarded. Only an explicit `{"op":"abort",...}` discards.

## Reactive-UI flags — NOT just for no-code platforms

Three per-call opt-in flags handle frameworks that listen for full pointer event chains rather than Playwright's native synthesized events. **They apply to ANY reactive UI**, not only no-code platforms:

- **Radix UI** dropdowns / popovers / menus / context menus
- **Headless UI** menus + listboxes
- **MUI menus** with custom-styled triggers (especially when the trigger is a `cursor-pointer` div instead of a real `<button>`)
- **shadcn/ui** components — same Radix root underneath
- **FlutterFlow**, **Bubble**, **Retool**, **Webflow**, **n8n**, **Wix Velo**, **Glide**

Set the flag whenever a click visibly succeeds (no error, no exception) but the component doesn't react.

### `click({dispatch_chain: true})`

Plain `loc.click()` produces a synthetic click that reactive frameworks ignore. With `dispatch_chain:true`, the runner dispatches the full `pointerdown → pointerup → click` MouseEvent chain via DOM events instead.

```json
{"op":"click","locator":{"by":"text","value":"Submit"},"dispatch_chain":true}
```

Required on most Bubble button/icon clicks AND most Radix-driven UI. Default `false`.

### `fill({dispatch_events: ["input","change","blur"]})`

Reactive bindings (Bubble, Radix-controlled inputs, Headless UI combobox values) only fire on dispatched events; native `fill` skips them on wrapped/synthetic inputs. With `dispatch_events`, after the value is set the runner re-dispatches the named events with `bubbles:true` so the framework's listeners see the value change.

```json
{"op":"fill","locator":{"by":"label","value":"Email"},"value":"alice","dispatch_events":["input","change"]}
```

Most Bubble text inputs need `["input","change"]`; some additionally need `["blur"]` (to fire validation handlers wired to focus loss). Default `[]`.

### `select({atomic: true})`

Defeats the "Element not found" race that Bubble / Radix re-renders trigger when they fire between Playwright's resolve and act steps. With `atomic:true`, the runner performs set-value-and-dispatch-change in a single synchronous evaluate — the framework never sees a partially-updated state.

```json
{"op":"select","locator":{"by":"label","value":"Country"},"value":"NL","atomic":true}
```

Single-value only. Multi-select uses the default selectOption path. Default `false`.

## Fail-fast on 0-match locators

By default, `click` / `fill` / `select` / `hover` / `check_box` pre-check `loc.count()` at issue time and fail immediately if zero elements match — rather than burning the full 30s timeout in Playwright's auto-wait. Auto-wait is for actionability (visible / enabled / stable), not existence; for "wait for an element to appear" use `{"op":"wait_until",...}` first. The fail-fast saves ~30s per typo'd selector or wrong role guess.

To restore Playwright's wait-for-element behavior on a specific call:

```json
{"op":"click","locator":{...},"fail_fast":false}
```

Use sparingly; the default is the right choice in 99% of cases.

## Click change-evidence

Every successful `click` returns evidence of whether the click actually changed page state — not just whether Playwright's click machinery succeeded. The result envelope's `evidence.result` carries:

```json
{
  "url_before": "...",
  "url_after": "...",
  "title_before": "...",
  "title_after": "...",
  "body_changed": true|false
}
```

`body_changed: false` after a click that you expected to do something is a signal that the click hit a no-op element (e.g. a Radix dropdown trigger that needs `dispatch_chain:true`, a button covered by an invisible overlay, an event handler that didn't bind). Use it to distinguish "click succeeded mechanically" from "click changed the page."

## Blank-page detection

In record mode, the runner emits a `blank_page_detected: true` flag in the `runner_ready` envelope when, after the configured delay, `#root` (or sibling SPA mount points: `#app`, `#__next`, `[data-reactroot]`, `<main>`) is empty AND body text is under 50 characters. Together with the `page_errors` buffer in the same envelope, this catches:

- **Vercel preview deploys** missing an env var the bundle throws on at module-load.
- **Broken bundles** where the JS parsed but failed to evaluate.
- **CSS bugs** that hide everything — though no `page_errors` will be present, so the agent can distinguish.

Disable with `--no-blank-page-check`. Bump the delay with `--blank-page-delay <ms>` (default 4000) for slow-mounting apps.

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

When the page state matches what you came to verify, close out by appending the control command to the FIFO:

```bash
echo '{"op":"continue"}' > /tmp/st4ck.fifo    # saves the trace, exits 0
# OR
echo '{"op":"abort","reason":"<short>"}' > /tmp/st4ck.fifo   # discards, exits 1
```

The runner unlinks the FIFO automatically on exit. `BashOutput(shell_id)` once more for the final `record_complete` envelope (on continue / EOF) or `agentic_aborted` (on abort) and the captured file path.

If you used the legacy `--ipc-fifo`-less recipe, also clean up the holder shell's writer end:

```bash
exec 9>&-
rm -f /tmp/st4ck-stdin-$$
```

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
