# Milestone 4: Dynamic Subtasks and Autonomous Recovery

Date: 2026-10-16 (Asia/Bangkok)

## Implementation

IMPLEMENTED: execution-local RecoveryManager integrated into the existing Agent Loop.
It does not open Sessions, create a second decision loop, poll in parallel, load a
model, or change the parent goal's criteria. The original executor, candidate
generator, policy and verifier remain authoritative.

Existing mechanisms reused: reversible BACK verification, navigation layer
evidence, goal package authorization, UI Explorer, condition waits, action
deduplication, bounded replanning, global budgets, cancellation and NDJSON events.

Flow: RUNNING parent -> SUSPENDED parent / RUNNING recovery -> independently
observed completion -> fresh parent evaluation. A loading/discovery recovery can
be suspended by a child obstruction-removal recovery. Child completion is checked
before the suspended parent. Terminal failure/cancel updates the entire active
stack; cleanup still belongs to the original execution.

Each SubtaskSpec records parent IDs, triggering snapshot/fingerprint, objective,
completion criterion, inherited scope, attempts, limits, elapsed time and outcome.
Action records link to the recovery subtask; candidate IDs and verification remain
in existing memory. No screenshot or full XML is retained in recovery memory.
Recovery BACK records cannot hide an unverified parent click/input from the
decision engine. Human Assistance remains awaited; recovery cannot run past it.

## Supported Evidence

- Non-sensitive native dialog or an existing recognized reversible navigation layer:
  one BACK, policy check, fresh candidate validation when available, then verify
  disappearance in the authorized app. Never repeat an uncertain BACK blindly.
- Unexpected foreground after parent progress: restore only the authorized app,
  consume the existing replan budget, verify foreground and reconsider the parent.
- Loading or persistently absent search control: bounded condition WAIT_FOR through
  the existing executor. A single missing search observation first requests a new
  snapshot without dispatching an interaction.
- Missing/offscreen TARGET_VISIBLE: delegate discovery to the existing UI Explorer;
  do not invent selectors or coordinates or treat offscreen bounds as visibility.
- Unverified action: reobserve before another decision; a safe observed obstruction
  can trigger recovery, but an unverified parent mutation is never silently retried.

Rules handle proven cases. Existing Qwen candidate reasoning receives recovery
history along with goal, failure and remaining-budget context. The model cannot
invent a recovery action, change criteria or expand scope. There is no separate
recovery model/request loop; ambiguous recovery routes currently abstain.

## Limits

AgentLimitsSchema validates recoveryDepth (default/max 2), recoverySubtasks
(default/max 3, 0 disables automatic recovery), recoveryAttempts (default 2,
max 3), recoveryTimeMs (default 15000, max 30000). Child tasks share the same
parent time/steps/snapshot/scroll/reasoning/retry/replan limits. Fingerprints are
deduplicated per execution. Identical unresolved mutations are not replayed.
Recovery time is also reported separately as recoveryMs; no baseline overhead
benchmark was performed.

## Verification

SIMULATED PASS: 15 focused tests cover suspension/resume, nested loading/popup,
foreground restoration, missing target, unchanged/duplicate obstacles, depth,
count, scope, deadlines, shared budget, stale evidence, sensitive/CAPTCHA denial,
unverified parent mutation, whole-tree cancellation, device/Session failure and
Dashboard rendering/escaping from real-shaped recovery events.

Regression: 230/230 unit tests PASS. TypeScript --noEmit and scoped ESLint PASS.
Three pre-existing model/provider checks explicitly disable automatic recovery to
continue testing the injected untrusted-provider path; new recovery tests cover
fresh candidate invalidation with recovery enabled. These tests are simulations,
not Android or Dashboard end-to-end proof.

REAL ANDROID PASS (short navigation recovery smoke): Samsung A50s R58MA78W6QK,
Appium 3.8.0, existing opt-in harness. Goal: search Chrome for "dynamic recovery".
Setup opened tab overview using the currently observed unique tab control; setup
was not an Agent decision and did not create/close tabs. Agent then:

1. Detected TAB_OVERVIEW and suspended the parent.
2. Created one DISMISS_LAYER subtask.
3. Sent one BACK through the existing executor/candidate/policy path.
4. Verified layer removal from a fresh snapshot and completed the recovery.
5. Resumed the original parent, opened the search field, entered the exact query,
   submitted it and independently verified rendered search results.

Measured total: 49182 ms including setup; recovery: 8400 ms (task wall: 8405 ms).
Four Agent actions, 28 globally accounted snapshots including two setup reads,
zero scrolls, zero Qwen requests, one recovery subtask. Original Session remained
ab9d63d7-080a-4093-bd50-370cec18477a; Appium log confirms DELETE returned 200.
Local raw report: phone-commander-m311-reasoning-1792084980757.json in the OS temp
directory. This test used the existing harness, not the Dashboard goal form.

Dashboard server returned HTTP 200 at http://127.0.0.1:3000/ after integration.
Dashboard live recovery stream acceptance: NOT TESTED. Human Assistance resume
and YouTube playback acceptance: NOT TESTED in this milestone; earlier unresolved
acceptance is not converted to PASS by these results.

## Unsupported / Safe Stops

Generic web/CSS overlays without native dialog or recognized layer evidence,
arbitrary unexpected menus without a proven return route, indistinguishable
controls, and recovery requiring an app-specific new action sequence are BLOCKED
or delegated to existing Human Assistance when eligible. No automatic close-button
guessing, CAPTCHA solving, permission acceptance, login, purchase, deletion,
security-policy relaxation or unverified mutation replay is implemented.

Real-device popup, nested recovery, loading/missing target and cancellation fault
injection: NOT TESTED; coverage for those cases is simulation only. No new Vision
model, multi-device orchestration, APK installation or Ollama model changes.

## Main Files

- lib/android/agent/recovery.ts: execution-local stack, evidence and limits.
- lib/android/agent/agent-loop.ts: recovery lifecycle, existing dispatch and cleanup.
- lib/android/agent/schema.ts, budget.ts, memory.ts: limits, telemetry and records.
- lib/android/agent/decision-engine.ts: preserve unverified-parent guard; reasoning context.
- components/commands/AgentGoalPanel.tsx: recovery status/history and parent resume.
- tests/dynamic-recovery.test.cjs: 15 focused simulation/render/integration tests.
- tests/action-candidates.test.cjs, agent-reasoning.test.cjs: isolate injected-provider checks.
