---
description: Drive a real browser one IPC primitive at a time via the `st4ck browse` CLI. Each subcommand is one Bash invocation; the wrapper hides the runner + FIFO behind the scenes. Multi-session out of the box. Optional `--record` saves the trace as a deterministic md test you can replay with `st4ck run`.
argument-hint: <url> [--session <name>] [--record [--out <path>]] [--instruction "<text>"] [--storage-state <file>] [--device "<name>"] [--viewport <WxH>] [--locale <bcp47>] [--timezone-id <iana>] [--color-scheme <v>] [--reduced-motion <v>] [--geolocation <lat,lon>] [--context-options <json>] [--headless] [--no-blank-page-check]
---

# /st4ck:browse

You drive a real browser one primitive at a time, one Bash command per primitive, observing the live page state between every action. The `st4ck browse` CLI wraps the runner: each subcommand spawns, sends one IPC command, reads one response envelope, exits. You never touch a FIFO, never manage a background runner, never run `mkfifo`. Multi-session is built in: `-s alice` and `-s bob` route to independent runners.

The captured trace (when you launch with `--record`) is a deterministic markdown file. Replay it later with zero LLM cost via `npx st4ck@latest run <path.md>`.

> **Version.** Examples use `npx st4ck@latest` — npm always serves the current release. To pin (CI reproducibility, rolling back to a known-good version), substitute an explicit version (e.g. `npx st4ck@0.2.0-alpha.1`); see `npm view st4ck versions` for the list. The Claude plugin cannot pin its npm dependency, so CLI pinning happens in the command you run.

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
  "page_url": "https://app.example.com/login?next=%2Fdashboard",
  "requested_url": "https://app.example.com/dashboard",
  "redirected": true,
  "page_errors": [],
  "blank_page_detected": false
}
```

`page_url` is the **final** URL after navigation completed. `requested_url` is what the launch was asked to load; `redirected: true` is the cheap signal that the page silently bounced you somewhere else (auth-gate flips, stale-token → /login, locale rewrites). Compare the two when you need to know where you actually landed without an extra `evaluate "location.pathname"` round-trip.

`page_errors` is the buffer of uncaught exceptions thrown by the page during load — non-empty often correlates with `blank_page_detected: true` (a Vercel preview deploy missing an env var, a broken bundle, a CSS rule hiding everything). The pageerror listener attaches before navigation, so module-load throws are caught on the first paint.

**Important launch flags:**

| Flag | What it does |
|---|---|
| `--session <name>` / `-s <name>` | Multi-session name. Defaults to `default`. Validated `^[a-z0-9][a-z0-9_-]{0,63}$`. |
| `--record` | Save the captured primitive trace to disk on close. Without this, the session is ephemeral. |
| `--out <path>` | Where to write the trace (only meaningful with `--record`). |
| `--instruction "<text>"` | Human-readable journey description recorded in the md file's front matter. |
| `--storage-state <file>` | Seed cookies and localStorage before the first navigation. Auth state must use a permission-restricted temporary file. |
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

### Auth injection — skip repeated login drives

For ad-hoc driving of an auth-gated app, mint the session with the app's own admin/service API, then inject it **before the first navigation**. A storage-state file contains impersonation-capable secrets; treat it like a password and never commit, log, or retain it.

```bash
# Run this prelude and launch in one Bash invocation so cleanup always runs.
AUTH_STATE="$(mktemp "${TMPDIR:-/tmp}/st4ck-auth.XXXXXX")"
chmod 600 "$AUTH_STATE"
trap 'rm -f "$AUTH_STATE"' EXIT

# Mint the session and write valid Playwright storageState JSON to $AUTH_STATE
# without printing its contents, then launch with only the file path in argv.
npx st4ck@latest browse launch https://app.example.com -s authed --storage-state "$AUTH_STATE"
```

The runner consumes the file before page load, and the trap deletes it when the launch invocation returns. An `init-script` or later `evaluate` is too late for apps that read auth during startup. `--local-storage key=value` is suitable only for non-secret seed data: never pass an auth token through it, because even environment-variable expansion exposes the value in process arguments. Authored tests still establish their state through the UI.

### 2. Act — one Bash command per primitive

After launch you alternate `snapshot` → action → `snapshot` until the page state matches what you came to verify. Every command takes `-s <name>` (omit for the `default` session).

```bash
# Read the page's a11y tree. Use this BEFORE picking a locator.
npx st4ck@latest browse snapshot --session foo

# Click a button by its accessible role+name.
npx st4ck@latest browse click --session foo --locator-by role --locator-value button --name "Sign in"

# Fill an input by its label.
npx st4ck@latest browse fill --session foo --locator-by label --locator-value "Email" --text "alice@example.com"

# Press Enter — locator is optional for press.
npx st4ck@latest browse press --session foo --key Enter
```

Locator flags are shared by `click` / `fill` / `select` / `hover` / `check_box` / `upload`:

| Flag | Purpose |
|---|---|
| `--locator-by <kind>` | One of `testid` \| `role` \| `label` \| `placeholder` \| `text` \| `css`. |
| `--locator-value <v>` | The value matched against `--locator-by` (selector text, role string, label text, etc.). `--selector` is an alias. |
| `--name "<accname>"` | Accessible-name option (only with `--locator-by role`). |
| `--exact` | String equality on `--locator-value` (default is substring). |
| `--locator-index <n>` | Select the zero-based Nth match. `interactables` includes this in handles when role/name repeats. |
| `--scope-by <kind>` + `--scope-value <v>` | Constrain the locator to a container element (e.g. `--scope-by role --scope-value dialog`). |
| `--timeout-ms <n>` | Override the default 30s actionability timeout. |

(`--by` / `--value` are still accepted as deprecated aliases of `--locator-by` / `--locator-value`, with a stderr deprecation warning.)

Prefer `testid` > `role+name` > `label` > `placeholder` > `text` > `css`. CSS is the last resort — brittle to markup changes. Never bare-tag (`button`, `div`).

#### Action subcommands — one example each

```bash
# navigate
npx st4ck@latest browse navigate --session foo --url "https://example.com/dashboard"

# click
npx st4ck@latest browse click --session foo --locator-by testid --locator-value "submit-btn"

# fill
npx st4ck@latest browse fill --session foo --locator-by label --locator-value "Email" --text "alice@example.com"

# press (locator optional)
npx st4ck@latest browse press --session foo --key Tab

# select — exactly one of --option-value | --option-label | --option-index
npx st4ck@latest browse select --session foo --locator-by label --locator-value "Country" --option-value "NL"

# check_box — exactly one of --checked | --unchecked
npx st4ck@latest browse check_box --session foo --locator-by label --locator-value "I agree" --checked

# hover
npx st4ck@latest browse hover --session foo --locator-by testid --locator-value "tooltip-trigger"

# upload (--file repeats for multi-file)
npx st4ck@latest browse upload --session foo --locator-by testid --locator-value "file-input" --file /abs/path/photo.jpg

# wait_until — JS expression polled until truthy or --timeout-ms expires
npx st4ck@latest browse wait_until --session foo --js "document.querySelectorAll('[data-row]').length > 0" --timeout-ms 10000

# evaluate — read-only JS in the page; result lands in evidence.result
npx st4ck@latest browse evaluate --session foo --js "document.title"

# branch — conditional dispatch; takes a single --json blob
npx st4ck@latest browse branch --session foo --json '{"condition":{"kind":"visible","locator":{"by":"text","value":"Welcome"}},"then":[],"else":[{"primitive":"click","args":{"locator":{"by":"role","value":"button","options":{"name":"Sign in"}}}}]}'
```

#### Low-token discovery and deterministic verification

Use these focused operations instead of dumping the page or writing custom `evaluate` JavaScript when the question is local:

```bash
# Compact visible controls, with ready-to-paste locator handles.
npx st4ck@latest browse interactables -s foo --filter buttons --grep "save|submit" --max 20

# Check uniqueness before acting; returns count, ambiguous, and matches.
npx st4ck@latest browse locate -s foo --locator-by role --locator-value button --name "Save"

# Read only one target's text, without a snapshot/model-grep round trip.
npx st4ck@latest browse get-text -s foo --locator-by css --locator-value ".toast" --format result

# Make the expected text a deterministic exit-0/exit-1 assertion.
npx st4ck@latest browse assert-contains -s foo --locator-by css --locator-value ".toast" --contains "Saved"

# Scroll the document, a nested scroller, or one element into view.
npx st4ck@latest browse scroll -s foo --to bottom
npx st4ck@latest browse scroll -s foo --locator-by css --locator-value ".left-panel" --to bottom
npx st4ck@latest browse scroll -s foo --locator-by role --locator-value button --name "Submit" --to element

# After opening a reactive dropdown, fill its currently-focused search field.
npx st4ck@latest browse fill -s foo --focused --text "Hebrew"

# Wait for the first delayed URL/body change after an asynchronous submit.
npx st4ck@latest browse click -s foo --locator-by role --locator-value button --name "Submit" --settle
```

`assert-contains` also accepts `--equals` or `--matches` when exact text or a regex is the real contract. `click --settle` stops at the first URL/body change; follow it with a final-state `wait_until` or assertion when intermediate renders are possible.

Use `--format result` for a bare focused read. For repeated scripted operations, `--format quiet` keeps only status and key evidence. Keep the default envelope while diagnosing failures.

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

# Locator-driven screenshot — capture just one element by accessible locator.
# Beats pixel `--clip` for visual diffs because the locator survives layout shifts.
# Same locator flags as click/fill: --locator-by/--locator-value/--name + optional --scope-by.
npx st4ck@latest browse screenshot --session foo --out /tmp/btn.png --locator-by role --locator-value button --name "Save"
npx st4ck@latest browse screenshot --session foo --out /tmp/card.png --locator-by testid --locator-value "user-card"
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

#### `set_visibility` — simulate a real OS tab switch (recorded — issue 56b8b016)

```bash
# Tab away (document.visibilityState → hidden, fires visibilitychange + window blur):
npx st4ck@latest browse set_visibility --session foo --state hidden
# Tab back:
npx st4ck@latest browse set_visibility --session foo --state visible
# Focus-driven bugs where timers must keep running while "away" (no lifecycle freeze):
npx st4ck@latest browse set_visibility --session foo --state hidden --no-freeze
```

Repro form-wipe-on-refocus, focus-driven refetch loops, and modal-stack-on-tab-back bugs. NOTE: no CDP method flips the controlled page's real `document.visibilityState` in current Playwright/Chromium, so this is a JS-level emulation (overrides the visibilityState/hidden getters + dispatches the real `visibilitychange` / `blur` / `focus`) — subscribers reading `document.visibilityState` and those listening for the events both observe it. `freeze` (default) also fires the Page Lifecycle signal; `document.hasFocus()` (native) is not shimmed; the override resets on navigation.

#### `bubble_notifier_health` — Bubble pre-flight health probe (issue fd85d2cc)

```bash
# Run BEFORE driving a Bubble UI suite. status: degraded | healthy | unknown.
npx st4ck@latest browse bubble_notifier_health --session preflight
npx st4ck@latest browse bubble_notifier_health --session preflight --probe-ms 12000
```

Probes the Bubble notifier WebSocket (`wss://notifier.api.<region>.bubble.io`) by reloading + watching console/requestfailed over the window. `degraded` (handshake 502s) means Bubble's live-state pushes won't arrive and `wait_until` polls will time out for reasons unrelated to your test — halt the suite and retry in ~10 min instead of burning drives. `--no-reload` for a mid-session re-probe (only catches errors firing during the window).

#### `wait_until` — Playwright's full wait surface

```bash
# Wait for a JS expression to return truthy (kind=custom, default if --js).
npx st4ck@latest browse wait_until --session foo --js "document.querySelectorAll('[data-row]').length > 0" --timeout-ms 10000

# Wait for the URL to match (kind=url) — page.waitForURL.
npx st4ck@latest browse wait_until --session foo --url "**/dashboard"

# Wait for an element to be visible / hidden / attached / detached (locator-driven).
npx st4ck@latest browse wait_until --session foo --locator-by role --locator-value button --name "Save" --kind visible

# Wait for the network to go idle (kind=networkidle).
npx st4ck@latest browse wait_until --session foo --kind networkidle
```

`--kind` is inferred from which flag is set (`--url` → url, `--by` → visible, `--js` → custom); `--kind networkidle` stands alone with no other args. Override with explicit `--kind <v>`.

> **Strict-mode uniqueness for locator-driven kinds.** `--kind visible|hidden|attached|detached` calls Playwright's `locator.waitFor({state})`, which **errors when the locator resolves to more than one element** ("strict mode violation"). Selectors like `[data-sidebar="menu-button"]` (10 sidebar items) or `[data-sidebar="menu"]` (main + footer nav) fail with `element_ambiguous` even when one of those elements would have satisfied the wait.
>
> Disambiguate with a unique anchor — e.g. `a[data-sidebar="menu-button"][href="/"]` (the home link, always rendered exactly once), or scope into a container via `--scope-by role --scope-value navigation`. If you need to wait on "any of N matching items," use `--kind custom --js "document.querySelectorAll('...').length > 0"` instead.

#### Authoring auth components for replay (storage_state rehydration)

The runner snapshots `storage_state` after the first green block boundary and rehydrates it on subsequent runs (TTL-bound). For projects with a `/auth` page that redirects authenticated users to `/`, an `auth.login` component that does `wait_until visible #signin-email` will time out on the second run — the form never renders because the user is already logged in.

**Idempotent auth components must wrap the form interaction in a `branch` primitive:**

```json
{
  "primitive": "branch",
  "args": {
    "condition": { "kind": "visible", "locator": { "by": "css", "value": "#signin-email" }, "timeout_ms": 5000 },
    "then": [/* fill email + password + submit */],
    "else": [/* nothing — already logged in */]
  }
}
```

Then a unified post-condition (e.g. `wait_until visible role=main`) covers both branches. Without this pattern, every project that records a v2 auth component will rediscover the redirect-to-/ failure mode on the second run.

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
npx st4ck@latest browse click --session alice --locator-by role --locator-value button --name "Login"
npx st4ck@latest browse fill  --session bob   --locator-by label --locator-value "Email" --text "bob@..."
npx st4ck@latest browse click --session alice --locator-by testid --locator-value "submit"

# List active sessions.
npx st4ck@latest browse list

# Conservatively delete only dead/corrupt sessions; alive/unknown are kept.
npx st4ck@latest browse prune

# Tear down.
npx st4ck@latest browse close --session alice
npx st4ck@latest browse close --session bob
```

Each `-s <name>` routes to its own runner + browser context. Cross-session orchestration in one flow is just choosing the right `-s` per command. Sessions live under `~/.st4ck/sessions/<name>/`; `list` prints alive vs stale state.

## Reactive-UI click escalation

Use standard `click` first; it is the cheaper default for ordinary buttons and links. If the target is document-delegated, gates on `event.isTrusted`, or `click` passes without triggering the expected UI, retry that locator with `click_native`. It dispatches a real-mouse click through CDP:

```bash
npx st4ck@latest browse click -s foo --locator-by role --locator-value button --name "Open menu"
npx st4ck@latest browse click_native -s foo --locator-by role --locator-value button --name "Open menu"
```

Some handlers also discriminate on pointer-event ordering or timing. Only after plain `click_native` fails, opt into its realistic pointer trail:

```bash
npx st4ck@latest browse click_native -s foo --locator-by css --locator-value ".bubble-element.Button" --pointer-sequence
```

The launch-level `--platform=auto|bubble|...` flag is forwarded for forward compatibility only. The current runner does not use it to change click behavior, so do not rely on this launch flag today.

## When to use `--record` vs not

| Use case | Launch flag |
|---|---|
| You're verifying a flow, want to keep a replayable test artifact | `--record --out tests/<slug>.md` |
| You're driving the browser to investigate / debug — no test artifact needed | (omit `--record`) |
| You're capturing a candidate component / test journey to hand off to `qa-author` | `--record --out .st4ck/recordings/<slug>.md` |

Recordings produced by `--record` live wherever `--out` says (or `.st4ck/recordings/<slug>.md` if omitted) and replay deterministically via `npx st4ck@latest run <path>`.

## Driving strategy

1. **Orient, then narrow.** Use `browse snapshot` once for page semantics; use `interactables`, `locate`, and `get-text` for repeated local discovery. Re-snapshot after navigation or structural UI changes; never reuse stale locators blindly.
2. **Verify each primitive live.** One command, read the response, reason about it, send the next. Never batch primitives blind — that defeats the point of live verification.
3. **Wait deliberately.** Playwright's auto-wait covers most actionability. Add an explicit `wait_until` only when crossing a structural transition (after a click that triggers navigation, after a modal opens, after an async list re-renders).
4. **Prefer accessible locators.** `testid` > `role+name` > `label` > `placeholder` > `text` > `css`. The locator priority ladder gives you free Tier-1 self-heal on replay.
5. **Don't navigate via URL when a click is what should be verified.** Jumping via `browse navigate` skips the very thing the test exists to cover.
6. **Prefer purpose-built reads and assertions.** Use `get-text`, `assert-contains`, and `locate` before `evaluate`. If no primitive fits, `evaluate` is for reads, not mutations; page-state mutation makes the recording brittle on replay.

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

`body_changed: false` after a click that you expected to do something is a signal that the click may have hit a document-delegated or trust-gated target; retry with `click_native`. It can also mean an invisible overlay or an unbound handler, so inspect the page if the native click also has no effect. Use the evidence to distinguish "click succeeded mechanically" from "click changed the page."

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
- You never shell out below the wrapper. The runner is the underlying engine; the `st4ck browse` CLI is the only sanctioned surface.
- You never invoke `st4ck-runner record` directly. That binary is now a private implementation detail; the wrapper resolves it for you.
- One Bash call per primitive. Read the response envelope. Reason. Send the next. The session stays alive between calls because the runner is detached.
- If the session shows up `stale` in `browse list`, `browse abort -s <name>` cleans the directory; re-launch with the same name.

## Discoverability

```bash
npx st4ck@latest browse                       # list actions and common flags
npx st4ck@latest browse launch --help         # launch/auth flags and examples
npx st4ck@latest browse interactables --help  # any `browse <op> --help` prints that op's flags and examples
```

The runtime registry of primitive names + per-primitive flag shapes is the source of truth. If anything in this skill drifts from the wrapper's actual flag parser, the wrapper wins — open an issue.
