---
description: Drive a real browser one IPC primitive at a time via the `st4ck browse` CLI. Each subcommand is one Bash invocation; the wrapper hides the runner + FIFO behind the scenes. Multi-session out of the box. Optional `--record` saves the trace as a deterministic md test you can replay with `st4ck run`.
argument-hint: <url> [--session <name>] [--record [--out <path>]] [--instruction "<text>"] [--platform=<v>] [--device "<name>"] [--viewport <WxH>] [--locale <bcp47>] [--timezone-id <iana>] [--color-scheme <v>] [--reduced-motion <v>] [--geolocation <lat,lon>] [--context-options <json>] [--headless] [--no-blank-page-check]
---

# /st4ck:browse

You drive a real browser one primitive at a time, one Bash command per primitive, observing the live page state between every action. The `st4ck browse` CLI wraps the runner: each subcommand spawns, sends one IPC command, reads one response envelope, exits. You never touch a FIFO, never manage a background runner, never run `mkfifo`. Multi-session is built in: `-s alice` and `-s bob` route to independent runners.

The captured trace (when you launch with `--record`) is a deterministic markdown file. Replay it later with zero LLM cost via `npx st4ck@latest run <path.md>`.

> **Version.** Examples use `npx st4ck@latest` — npm always serves the current release. To pin (CI reproducibility, rolling back to a known-good version), substitute an explicit version (e.g. `npx st4ck@0.2.0-alpha.1`); see `npm view st4ck versions` for the list. The plugin manifest schema has no version-pinning field, so the docs are the only place pinning happens.

## Lifecycle — launch, act, close

Three phases. Every `st4ck browse <op>` invocation prints one JSON envelope on stdout and exits with the per-op exit code (table at the bottom).

### 1. Launch

```bash
npx st4ck@latest browse launch <url> --session <name> --instruction "<one-line description>"
```

Returns the `runner_ready` envelope:

```json
{
  "type": "runner_ready",
  "page_url": "<url>",
  "page_errors": [],
  "blank_page_detected": false
}
```

`page_errors` is the buffer of uncaught exceptions thrown by the page during load — non-empty often correlates with `blank_page_detected: true` (a Vercel preview deploy missing an env var, a broken bundle, a CSS rule hiding everything). The pageerror listener attaches before navigation, so module-load throws are caught on the first paint.

**Important launch flags:**

| Flag | What it does |
|---|---|
| `--session <name>` / `-s <name>` | Multi-session name. Defaults to `default`. Validated `^[a-z0-9][a-z0-9_-]{0,63}$`. |
| `--record` | Save the captured primitive trace to disk on close. Without this, the session is ephemeral. |
| `--out <path>` | Where to write the trace (only meaningful with `--record`). |
| `--instruction "<text>"` | Human-readable journey description recorded in the md file's front matter. |
| `--platform=<v>` | Forwarded to the runner. Recognized values: `auto` \| `web` \| `bubble` \| `retool` \| `webflow` \| `n8n` \| `wix-velo` \| `glide` \| `flutterflow`. When the runner ships per-call reactive-UI flag defaults (forthcoming), this flag flips them on. |
| `--headless` | Run Chromium headless. Default headed. |
| `--blank-page-delay <ms>` | How long to wait before checking for a blank-rendered page (default 4000). |
| `--no-blank-page-check` | Skip the blank-page heuristic entirely. |

### Browser-context emulation flags

These mirror Playwright's [`BrowserContextOptions`](https://playwright.dev/docs/api/class-browser#browser-new-context) — agents familiar with Playwright Test config find the flag they expect. Each is forwarded to the runner and resolved against `playwright.devices[name]` / native context options. Wrapper-side validation fails fast on bad strings BEFORE Chromium spawns (typos error in <100ms).

| Flag | What it does |
|---|---|
| `--device "iPhone 14 Pro"` | Apply a Playwright device descriptor. Sets viewport + UA + DPR + isMobile + hasTouch as a bundle. The right way to test mobile — viewport-only emulation does NOT trigger `@media (pointer: coarse)` / touch event paths / mobile UA gating that real responsive sites use. See `npx playwright devices` for the full list. |
| `--viewport "393x852"` | Standalone viewport, OR overrides the viewport from `--device` when both are set. |
| `--user-agent "..."` | Custom User-Agent string. Standalone or overrides `--device`'s UA. |
| `--locale "he-IL"` | BCP 47 locale tag. Drives `Intl.*`, `Accept-Language` header, `navigator.language`. |
| `--timezone-id "Asia/Jerusalem"` | IANA timezone ID. Drives `new Date()` and `Intl` timezone resolution. Maps to Playwright's `timezoneId` field. (`--timezone` is also accepted as an alias for backward compat with alpha.5.) |
| `--color-scheme dark` | `prefers-color-scheme` media query. One of `light` / `dark` / `no-preference`. |
| `--reduced-motion reduce` | `prefers-reduced-motion` media query. One of `reduce` / `no-preference`. Tests animation-disabled / accessibility paths. |
| `--forced-colors active` | `forced-colors` media query. One of `active` / `none`. Tests Windows High Contrast / forced-color paths. |
| `--geolocation "32.0853,34.7818"` | Seed `navigator.geolocation.getCurrentPosition`. **The `geolocation` permission is auto-granted** so apps that read coords on mount don't sit in the prompt-pending state. |
| `--permissions clipboard-read,notifications` | Comma-separated permission names granted via `context.grantPermissions()` after creation. Merges with the auto-granted geolocation permission when both are set. |
| `--http-credentials "user:pass"` | HTTP Basic auth for staging environments behind a credential gate. |
| `--offline` | Start the context offline — useful for testing offline-handling code paths. |
| `--bypass-csp` | Bypass the page's Content-Security-Policy header. Lets you `evaluate` arbitrary JS on sites with strict CSP. |
| `--context-options '<json>'` | **Escape hatch** — raw JSON `BrowserContextOptions` blob. Reaches Playwright fields not exposed as first-class flags: `recordVideo`, `recordHar`, `extraHTTPHeaders`, `screen`, future Playwright additions. Validated as JSON wrapper-side BEFORE Chromium spawns. **Merge precedence:** `--context-options` is the BASE layer; `--device` descriptor overrides on top; explicit named flags (`--viewport`, `--locale`, etc.) override last — so `--device "iPhone 14 Pro" --context-options '{"reducedMotion":"reduce"}'` gives you iPhone emulation PLUS reducedMotion without conflict. |

**Composite example — mobile + Hebrew + Tel Aviv timezone + dark mode + geolocation:**

```bash
npx st4ck@latest browse launch https://app.example.com \
  --session plenty-mobile \
  --device "iPhone 14 Pro" \
  --locale "he-IL" \
  --timezone-id "Asia/Jerusalem" \
  --color-scheme dark \
  --geolocation "32.0853,34.7818"
```

**Escape-hatch example — record video + capture HAR alongside iPhone emulation:**

```bash
npx st4ck@latest browse launch https://app.example.com \
  --session plenty-recorded \
  --device "iPhone 14 Pro" \
  --context-options '{"recordVideo":{"dir":"/tmp/v"},"recordHar":{"path":"/tmp/h.har"},"extraHTTPHeaders":{"X-Test-Run":"plenty-1"}}'
```

Each flag is orthogonal to the others — pick the dimensions your test cares about. `--device` covers the most ground for mobile testing; the rest layer on locale-aware behavior, theming, and location-aware features. `--context-options` is the open door for anything Playwright supports that isn't exposed as a curated flag.

If you need to pass extra runner flags the wrapper doesn't know about, use the `--` separator:

```bash
npx st4ck@latest browse launch <url> --session foo -- --some-future-runner-flag value
```

Without `--`, unknown flags exit `5` (bad_input) — typos surface instead of being silently ignored.

### 2. Act — one Bash command per primitive

After launch you alternate `snapshot` → action → `snapshot` until the page state matches what you came to verify. Every command takes `-s <name>` (omit for the `default` session).

```bash
# Read the page's a11y tree. Use this BEFORE picking a locator.
npx st4ck@latest browse snapshot --session foo

# Click a button by its accessible role+name.
npx st4ck@latest browse click --session foo --by role --value button --name "Sign in"

# Fill an input by its label.
npx st4ck@latest browse fill --session foo --by label --value "Email" --text "alice@example.com"

# Press Enter — locator is optional for press.
npx st4ck@latest browse press --session foo --key Enter
```

Locator flags are shared by `click` / `fill` / `select` / `hover` / `check_box` / `upload`:

| Flag | Purpose |
|---|---|
| `--by <kind>` | One of `testid` \| `role` \| `label` \| `placeholder` \| `text` \| `css` \| `xpath`. |
| `--value <v>` | The value matched against `--by` (selector text, role string, label text, etc.). |
| `--name "<accname>"` | Accessible-name option (only with `--by role`). |
| `--exact` | String equality on `--value` (default is substring). |
| `--scope-by <kind>` + `--scope-value <v>` | Constrain the locator to a container element (e.g. `--scope-by role --scope-value dialog`). |
| `--timeout-ms <n>` | Override the default 30s actionability timeout. |

Prefer `testid` > `role+name` > `label` > `placeholder` > `text` > `css`. CSS is the last resort — brittle to markup changes. Never bare-tag (`button`, `div`).

#### Action subcommands — one example each

```bash
# navigate
npx st4ck@latest browse navigate --session foo --url "https://example.com/dashboard"

# click
npx st4ck@latest browse click --session foo --by testid --value "submit-btn"

# fill
npx st4ck@latest browse fill --session foo --by label --value "Email" --text "alice@example.com"

# press (locator optional)
npx st4ck@latest browse press --session foo --key Tab

# select — exactly one of --option-value | --option-label | --option-index
npx st4ck@latest browse select --session foo --by label --value "Country" --option-value "NL"

# check_box — exactly one of --checked | --unchecked
npx st4ck@latest browse check_box --session foo --by label --value "I agree" --checked

# hover
npx st4ck@latest browse hover --session foo --by testid --value "tooltip-trigger"

# upload (--file repeats for multi-file)
npx st4ck@latest browse upload --session foo --by testid --value "file-input" --file /abs/path/photo.jpg

# wait_until — JS expression polled until truthy or --timeout-ms expires
npx st4ck@latest browse wait_until --session foo --js "document.querySelectorAll('[data-row]').length > 0" --timeout-ms 10000

# evaluate — read-only JS in the page; result lands in evidence.result
npx st4ck@latest browse evaluate --session foo --js "document.title"

# branch — conditional dispatch; takes a single --json blob
npx st4ck@latest browse branch --session foo --json '{"condition":{"kind":"visible","locator":{"by":"text","value":"Welcome"}},"then":[],"else":[{"primitive":"click","args":{"locator":{"by":"role","value":"button","options":{"name":"Sign in"}}}}]}'
```

#### Text-disambiguation actions

When "Save" / "OK" / "Cancel" / "Submit" appears in multiple places and you don't have a stable testid:

```bash
# click-by-text — narrow with --within-by/--within-value or --role
npx st4ck@latest browse click-by-text --session foo --text "Save" --within-by role --within-value dialog

# hover-by-text
npx st4ck@latest browse hover-by-text --session foo --text "Settings" --role button

# type-by-text — types into the field whose visible text matches
npx st4ck@latest browse type-by-text --session foo --text "Search" --value "my query" --within-by role --within-value dialog
```

Use `--exact` to demand string equality.

#### Diagnostic + observation subcommands (NOT captured into the recording)

```bash
# Drain pageerror buffer (default behavior is to clear).
npx st4ck@latest browse page-errors --session foo

# Peek without clearing.
npx st4ck@latest browse page-errors --session foo --no-clear

# Current page URL.
npx st4ck@latest browse url --session foo

# A11y snapshot of the current page.
npx st4ck@latest browse snapshot --session foo

# Screenshot to disk — for visual audits ("does this card render right at 360px?").
# Pair with the agent's Read tool: capture, then read the PNG to inspect visually.
npx st4ck@latest browse screenshot --session foo --out /tmp/audit.png
npx st4ck@latest browse screenshot --session foo --out /tmp/full.png --full-page
npx st4ck@latest browse screenshot --session foo --out /tmp/clip.jpg --type jpeg --quality 85 --clip 0,0,400,300
```

`snapshot` / `url` / `page-errors` / `screenshot` are introspection-only — they don't land in the captured md file. Use `snapshot` liberally between actions, `page-errors` whenever the page behaves blank or unresponsive, and `screenshot` for visual audit / debugging when "evaluate-only" leaves you guessing whether layout is right.

#### Mid-session viewport resize (recorded — replays restore the viewport mid-journey)

```bash
# Resize the layout viewport without changing UA / DPR / isMobile / hasTouch.
# Use this to audit responsive breakpoints (360 / 393 / 414 / 768 / 1280) in
# a single session instead of N launch/close cycles.
npx st4ck@latest browse set_viewport_size --session foo --viewport 360x740
npx st4ck@latest browse set_viewport_size --session foo --width 414 --height 896
```

Maps to Playwright's `page.setViewportSize`. Page-level — for a different logical device (different UA / touch / DPR), launch a fresh session with `--device <name>`.

#### `wait_until` — Playwright's full wait surface

```bash
# Wait for a JS expression to return truthy (kind=custom, default if --js).
npx st4ck@latest browse wait_until --session foo --js "document.querySelectorAll('[data-row]').length > 0" --timeout-ms 10000

# Wait for the URL to match (kind=url) — page.waitForURL.
npx st4ck@latest browse wait_until --session foo --url "**/dashboard"

# Wait for an element to be visible / hidden / attached / detached (locator-driven).
npx st4ck@latest browse wait_until --session foo --by role --value button --name "Save" --kind visible

# Wait for the network to go idle (kind=networkidle).
npx st4ck@latest browse wait_until --session foo --kind networkidle
```

`--kind` is inferred from which flag is set (`--url` → url, `--by` → visible, `--js` → custom); `--kind networkidle` stands alone with no other args. Override with explicit `--kind <v>`.

### 3. Close — finalize or abort

```bash
# Default close — saves the trace IF launch was --record.
npx st4ck@latest browse close --session foo

# Discard the session entirely (any pending recording is dropped).
npx st4ck@latest browse abort --session foo --reason "<short>"
```

`close` waits for the runner's `record_complete` envelope (when `--record` was set on launch) or `agentic_aborted` (otherwise) before cleaning up the session directory and exiting `0`. `abort` is **idempotent** — re-running it on a session that's already gone returns an `abort_noop` envelope and exits `0`.

## Multi-session — same machinery, different name

```bash
# Open two browsers, one per role.
npx st4ck@latest browse launch https://app.com -s alice
npx st4ck@latest browse launch https://app.com -s bob

# Drive them in alternating Bash calls.
npx st4ck@latest browse click --session alice --by role --value button --name "Login"
npx st4ck@latest browse fill  --session bob   --by label --value "Email" --text "bob@..."
npx st4ck@latest browse click --session alice --by testid --value "submit"

# List active sessions.
npx st4ck@latest browse list

# Tear down.
npx st4ck@latest browse close --session alice
npx st4ck@latest browse close --session bob
```

Each `-s <name>` routes to its own runner + browser context. Cross-session orchestration in one flow is just choosing the right `-s` per command. Sessions live under `~/.st4ck/sessions/<name>/`; `list` prints alive vs stale state.

## Reactive-UI handling

Three classes of UI need pointer-event chains rather than synthesized clicks: **Radix UI** dropdowns / popovers / menus / context menus, **Headless UI** menus + listboxes, **MUI menus** with custom-styled triggers, **shadcn/ui** components (Radix root underneath), and most no-code platforms (**Bubble**, **Retool**, **Webflow**, **n8n**, **Wix Velo**, **Glide**, **FlutterFlow**).

Symptom: `click` returns `status: "passed"` but the UI doesn't react. The result envelope's `evidence.result` carries `body_changed: false` — confirming the click hit a no-op.

**Fix today (the canonical surface):** launch with `--platform=<v>`. The wrapper forwards the flag to the runner, which (when supported) flips the per-call reactive flags (`dispatch_chain`, `dispatch_events`, `atomic`) on as defaults for the whole session.

```bash
npx st4ck@latest browse launch https://app.bubbleapps.io --platform=bubble --session foo
npx st4ck@latest browse launch https://radix-app.example.com --platform=auto --session foo
```

Recognized values: `auto` | `web` | `bubble` | `retool` | `webflow` | `n8n` | `wix-velo` | `glide` | `flutterflow`. With `auto`, the runner detects via response headers > DOM probes > URL pattern.

Per-call `--dispatch-chain` / `--dispatch-events` / `--atomic` flags on individual subcommands are not yet exposed in the wrapper CLI; use session-level `--platform` for now. If a single flow mixes platforms and you need per-call control, file an issue and we'll prioritize the per-op flags.

## When to use `--record` vs not

| Use case | Launch flag |
|---|---|
| You're verifying a flow, want to keep a replayable test artifact | `--record --out tests/<slug>.md` |
| You're driving the browser to investigate / debug — no test artifact needed | (omit `--record`) |
| You're capturing a candidate component / test journey to hand off to `qa-author` | `--record --out .st4ck/recordings/<slug>.md` |

Recordings produced by `--record` live wherever `--out` says (or `.st4ck/recordings/<slug>.md` if omitted) and replay deterministically via `npx st4ck@latest run <path>`.

## Driving strategy

1. **Snapshot first.** `browse snapshot` before doing anything to discover stable locators on the live page. Don't guess from the URL.
2. **Verify each primitive live.** One command, read the response, reason about it, send the next. Never batch primitives blind — that defeats the point of live verification.
3. **Wait deliberately.** Playwright's auto-wait covers most actionability. Add an explicit `wait_until` only when crossing a structural transition (after a click that triggers navigation, after a modal opens, after an async list re-renders).
4. **Prefer accessible locators.** `testid` > `role+name` > `label` > `placeholder` > `text` > `css`. The locator priority ladder gives you free Tier-1 self-heal on replay.
5. **Don't navigate via URL when a click is what should be verified.** Jumping via `browse navigate` skips the very thing the test exists to cover.
6. **`evaluate` is for reads, not mutations.** Mutating page state via evaluate makes the recording brittle on replay.

## Click change-evidence

Every successful `click` returns evidence of whether the click actually changed page state — not just whether Playwright's click machinery succeeded. The result envelope's `evidence.result` carries:

```json
{
  "url_before": "...",
  "url_after": "...",
  "title_before": "...",
  "title_after": "...",
  "body_changed": true
}
```

`body_changed: false` after a click that you expected to do something is a signal that the click hit a no-op element (e.g. a Radix dropdown trigger that needs `--platform=auto`, a button covered by an invisible overlay, an event handler that didn't bind). Use it to distinguish "click succeeded mechanically" from "click changed the page."

## Fail-fast on 0-match locators

By default, `click` / `fill` / `select` / `hover` / `check_box` pre-check `loc.count()` at issue time and fail immediately if zero elements match — rather than burning the full 30s timeout in Playwright's auto-wait. Auto-wait is for actionability (visible / enabled / stable), not existence; for "wait for an element to appear" first send `wait_until`. The fail-fast saves ~30s per typo'd selector or wrong role guess.

## Blank-page detection

In record mode, the runner emits a `blank_page_detected: true` flag in the `runner_ready` envelope when, after the configured delay, `#root` (or sibling SPA mount points: `#app`, `#__next`, `[data-reactroot]`, `<main>`) is empty AND body text is under 50 characters. Together with the `page_errors` buffer in the same envelope, this catches Vercel preview deploys missing an env var, broken bundles, and CSS bugs that hide everything.

Disable with `--no-blank-page-check`. Bump the delay with `--blank-page-delay <ms>` for slow-mounting apps.

## Replay the captured trace

```bash
npx st4ck@latest run tests/<slug>.md [--headless]
```

Zero LLM, pure Playwright execution, ~10× faster than the recording, deterministic. Use after every code change to verify the flow still works.

## Exit codes — per subcommand

| Code | Meaning | Agent action |
|---|---|---|
| `0` | Action succeeded; envelope on stdout has `status: "passed"` (or `runner_ready` for launch). | Continue. |
| `1` | Action failed; envelope on stdout has `status: "failed"` plus `error.class` + `error.detail`. | Diagnose from the error fields; usually a stale selector or wrong locator. |
| `2` | Session lock contention — couldn't acquire within 5s. | Retry the command once; lock will free as the prior command completes. |
| `3` | Session is dead — runner PID gone or never started. | `browse abort -s <name>` then re-launch. |
| `4` | Runner protocol error — corrupt envelope, unexpected stream close, startup timeout. | Treat as session_dead; abort + relaunch. |
| `5` | Bad CLI input — unknown flag, malformed value, invalid session name. | Fix the invocation. |

`launch` and `close` follow the same contract. `list` always exits `0`.

## Hard rules — for naive agents

- You never run `mkfifo`, never spawn the runner manually, never `echo > FIFO`. The wrapper does all of that. If you find yourself reaching for those, STOP — you're working at the wrong layer.
- You never invoke `agent-browser` directly. The runner is the underlying engine; the `st4ck browse` CLI is the surface.
- You never invoke `st4ck-runner record` directly. That binary is now a private implementation detail; the wrapper resolves it for you.
- One Bash call per primitive. Read the response envelope. Reason. Send the next. The session stays alive between calls because the runner is detached.
- If the session shows up `stale` in `browse list`, `browse abort -s <name>` cleans the directory; re-launch with the same name.

## Discoverability

```bash
npx st4ck@latest browse              # prints subcommand usage
npx st4ck@latest browse launch --help # (planned)
```

The runtime registry of primitive names + per-primitive flag shapes is the source of truth. If anything in this skill drifts from the wrapper's actual flag parser, the wrapper wins — open an issue.
