# Current Screen Understanding and Goal-Directed Navigation

Date: 2026-10-18 (Asia/Bangkok). Scope: the existing Goal Agent tab.
The public Action Plan schema and the sequential Action Plan tab are unchanged.

## Implementation

IMPLEMENTED in the existing Agent Loop, State Observer, candidate generator,
RecoveryManager, memory, policy and verifier. No additional executor, polling
loop, Session per step, model or external vision service was introduced.

Each new execution observes the actual phone before selecting an operation.
The screen summary binds device/execution/snapshot, package/activity, semantic
screen type, navigation context, focused element, overlays, loading, evidence
and ambiguity. Package identity alone never proves a home/search/player screen.
Native rules identify accessible search, lists, forms, toolbar-backed detail
pages and navigation controls. The existing web observer supplies DOM evidence.
Existing media adapters contribute player/search evidence. Unsupported UI stays
UNKNOWN; screenshot pixels are not interpreted by the text model.

The current subgoal resolves an internal required capability: APP_READY,
SEARCH_CONTENT, FIND_SECTION, READ_PAGE or SELECT_RESULT. The contract can be
extended without changing the public action schema. Camera capture/mode changes
are not implemented here; opening a discovered Camera retains its old behavior.

If the capability is already available, no recovery navigation is inserted.
Otherwise, existing candidates can supply unique observed Up, menu or exit-fullscreen
controls. A recognized media/fullscreen destination can authorize one system
BACK anchored to a visible player. This is not a programmed BACK count: every
new step requires fresh classification, a new candidate, policy and verification.

One route is selected by rules without inference. Multiple legitimate routes use
the existing constrained candidate-ID reasoner and shared queue. Unknown or
ambiguous evidence cannot mint selectors, coordinates or completion claims.
Fresh UI is checked after reasoning. General candidates still require the full
fingerprint. Capability routes additionally pin device/activity, semantic screen,
required capability, viewport, anchor class/bounds and control label. They can
survive unrelated live playback-counter changes only if regenerating candidates
from the fresh UI proves exactly the same route context. A moved/removed anchor,
new overlay, different device/screen or changed capability still rejects it.

## Recovery, Verification and Isolation

NAVIGATE_CAPABILITY is a bounded subtask of the existing RecoveryManager. It
suspends, but never rewrites, the parent criteria. Completion requires the actual
capability in a fresh snapshot. Intermediate steps require either the capability,
a recognized menu/fullscreen exit, or a changed native heading after observed Up.
A sent key/click is not a verified route. Unverified dispatch, unchanged UI,
cross-device reads and wrong-app destinations cannot resume the parent.

Reusing a focused search field is supported, including submitting an existing
exact query without an earlier INPUT_TEXT in this execution. Text is still
checked against the requested query before submission.

All work shares the original time/step/snapshot/scroll/reasoning/recovery budgets.
Action fingerprints, failed-action records and reasoning fingerprints prevent
replaying an unsuccessful route or reasoning endlessly on the same layout.
Filled native forms (even when unfocused), loading pages, permission UI and
sensitive controls cannot authorize new route gestures.

Memory stores at most 12 screen summaries plus budget-bounded action/navigation
records; no raw hierarchy or screenshot is retained there. Memory, screen state,
recovery, Session, budget and cancellation are execution-local. Runtime device
identity is checked on observations and postconditions. Existing shared reasoning
scheduling remains serial and cancellation remains owner-scoped.

The existing non-resumable Human Assistance/BLOCKED path is retained when no
navigation route can be proven. This does not add an arbitrary screenshot-tap
authorization workflow or weaken existing visual-confirmation restrictions.

## Dashboard

Existing Agent progress events now carry current screen, required capability,
navigation candidates, phase, last route action/verification, recognition time,
route action count and execution time. The Goal Agent progress view renders these
fields alongside Recovery and existing reasoning/snapshot counters. No private
chain of thought is displayed. The Action Plan tab remains a sequential executor;
use Goal Agent for adaptive state-aware navigation.

## Acceptance

Final automated verification after physical fixes: 335/335 regression tests PASS
in 31.9 seconds, including 21 focused navigation cases. Two additional regressions
cover continuously changing playback content and route-context invalidation;
the final screen summary is also asserted against the verified result snapshot.
TypeScript and scoped lint PASS. Test output:
ignored `.next/state-navigation-tests.tap`. These are simulated/software results,
not Android acceptance evidence.

SIMULATED PASS: YouTube Home (zero extra route gestures), media detail, fullscreen,
already focused input, Chrome with an accessible address bar, Settings submenu,
a discovered third-party native app and three isolated devices starting in
different states. Failure cases include frozen BACK, unknown UI, stale/missing
controls, sensitive overlays, filled forms, UI change during inference, wrong
device/app, cancellation, disconnect, shared budget exhaustion and unverified
dispatch. Existing queue isolation tests remain in the regression suite.

Focused simulated measurements (not phone performance):

| Start | Extra route actions | Total goal actions | Outer snapshots | AI calls |
| --- | ---: | ---: | ---: | ---: |
| Search available | 0 | 3 | 4 | 0 |
| Media detail | 1 | 4 | 6 | 0 |
| Fullscreen | 2 | 5 | 8 | 0 |

In one focused run recognition totals were 0.86/0.38/0.42 ms respectively;
mocked I/O is effectively immediate, so these are not a real navigation latency
comparison. Actual device timing, Session setup, snapshots and AI measurements
are emitted by the opt-in probe below. Queue concurrency remains covered by the
existing worker tests; no new model load is introduced by classification.

REAL ANDROID PASS (Samsung over Wi-Fi): after the user prepared an ordinary
YouTube video, a fresh execution identified MEDIA_PLAYBACK, found SEARCH_CONTENT
unavailable, verified one BACK, opened the observed Search control, entered the
exact query `podcast tiếng Anh`, submitted it and independently verified rendered
SEARCH_RESULTS. All four actions were VERIFIED. Total 35.451 s including 6.333 s
Session setup; route execution 4.141 s, recovery wall time 7.759 s, 15 snapshots,
zero scrolls/retries/replans and zero model calls. Session cleanup completed and
the device API reported busy=false afterward. No new video was selected.

The first prepared-media attempt safely BLOCKED with zero actions: unrelated
live content changed the full-screen fingerprint on each revalidation. The route
context fix above addresses that real failure without removing fresh validation.
Raw ignored reports: `.next/state-navigation-youtube-1792278856142.json` (blocked)
and `.next/state-navigation-youtube-1792278966300.json` (pass). The pass report's
legacy `screen` field correctly reads SEARCH_RESULTS; its new `currentScreen`
summary still said SEARCH_INPUT. That telemetry-only stale-summary bug was then
fixed by reusing the same verified postcondition snapshot, with a regression
assertion; no extra Android observation or success override was added.

An earlier guarded probe saw launcher rather than the required starting screen,
sent no action and closed its Session. Fullscreen/Chrome/Settings physical
acceptance remains NOT TESTED; simulated results are not promoted to physical PASS.
REAL MULTI-DEVICE: NOT TESTED; no second connected Android was used.

## Opt-In Real Probe

Prepare the desired starting screen manually and keep the phone unlocked.
Do not run another execution against that physical phone at the same time.

```powershell
node tests/state-aware-navigation.integration.cjs --serial IP:PORT --app youtube --query "podcast tieng Anh" --expect-screen MEDIA_PLAYBACK
node tests/state-aware-navigation.integration.cjs --serial IP:PORT --app youtube --query OpenAI --expect-screen FULLSCREEN
node tests/state-aware-navigation.integration.cjs --serial IP:PORT --app chrome --query "huong dan cai Python" --expect-screen CONTENT_DETAIL
node tests/state-aware-navigation.integration.cjs --serial IP:PORT --app settings --query "Thong tin dien thoai" --expect-screen CONTENT_DETAIL
```

Use the exact accented text shown on the phone for Settings; examples above are
ASCII placeholders. Add `--adb-path` when adb is not on PATH. The probe loads
the project's existing environment, uses the existing Session manager with its
verified installed APK checks, searches/reads only, and closes the same Session.
A starting-screen mismatch stops before any action. Reports under `.next/` are
ignored by Git. Opening/ordinal selection/playback acceptance is deliberately
not repeated by this navigation-only probe.

## Changed Files

- `lib/android/agent/navigation-semantics.ts`: screen/capability contracts and route evidence.
- `lib/android/agent/action-candidates.ts`, `candidate-verifier.ts`, `decision-engine.ts`:
  grounded route choices, deterministic preference, constrained ambiguity and verification.
- `lib/android/agent/agent-loop.ts`, `recovery.ts`, `memory.ts`, `schema.ts`:
  one-loop integration, bounded subtasks, per-execution memory/progress and identity guards.
- `lib/android/agent/goal-planner.ts`: FIND_ELEMENT permits only policy-grounded navigation clicks.
- `lib/android/security-policy.ts`: narrow observed native route-control assessment.
- `lib/android/condition-executor.ts`: submit an independently observed existing search query.
- `components/commands/AgentGoalPanel.tsx`: actual screen/navigation progress.
- `tests/state-aware-navigation.test.cjs`, `tests/state-aware-navigation.integration.cjs`:
  simulated acceptance and explicit opt-in real-device probe.

## Limits

This is evidence-based navigation, not universal semantic access to inaccessible
apps. Labels must be unique, native and safe; missing/fullscreen evidence can
require manual assistance. Device/OEM layouts without usable controls or headings
are not guessed. Up transitions may make bounded progress without reaching the
parent goal; final criteria are still independently checked. No reset, force-stop,
clear-data, sensitive permission grant or security-mode change is performed.
