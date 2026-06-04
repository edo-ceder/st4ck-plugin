# Proposed backend methodology.ts changes (review-gated)

These touch `backend/src/mcp/v3/methodology.ts` in **fig-video-scribe** (NOT the plugin), so they are NOT applied here — listed for the boss to apply under review. The plugin-side role-doc changes (qa-author.md, qa-runner.md) ARE done on this branch.

## ef715e2a + a617eca9 + 5ad916d2 (role-doc DONE here; methodology.ts parts proposed)

Done on this branch (st4ck/agents/qa-author.md + qa-runner.md):
- Verdict-return / budget discipline: "no re-arm / no wait-for-events / no time-remaining math after ~75% budget; always emit the Verdict JSON as the final output on every exit path; ≤15-min wall-clock author drives or split." (ef715e2a in-surface)
- Ownership push-back fields in the verdict: `brief_premise_check` + `concerns_if_i_were_the_po` (qa-author), `concerns_if_i_were_the_po` (qa-runner). (a617eca9 / 5ad916d2)

Proposed for methodology.ts (a617eca9 Phase 1/5 — orchestration section):
- Dispatch-contract templates gain a required `wall_clock_budget_ms` field; briefs implying >15-min wall-clock drives are forced into a "split into N drives" pattern at compose time.
- Methodology "orchestration" section: add the long-drive guidance ("e2e >15 min → split with hand-off, OR design as a multi-block test the runner replays in one execution rather than one sub-agent drive") with the K3e pre/post split as the worked example.
- Note: the CORE ef715e2a bug (sub-agent conversation-turn terminating mid-thought) is a Claude Code **harness** issue, out of st4ck's surface — track upstream.

## 73d1a4e7 (qa-author/authoring-lead methodology gaps) — mostly methodology.ts

Proposed methodology.ts additions (per the issue recipe — verify against the issue before applying):
- Bubble cross-day data setup guidance.
- Option-set encoding note (cross-ref the option-set substitution work, memory project_bubble_option_set_db_value_substitution_2026-05-19).
- Multi-entry-point popup disambiguation (column-header-anchored trigger selection — the pattern used in the Ori blacklist component this session).
- Orchestrator source-walk discipline (anti-laziness) in the data_setup/process sections.
(Some of this also belongs in qa-author.md — partially covered by the source-walk steps already there.)
