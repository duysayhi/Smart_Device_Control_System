# Agent V2: Open-World Generalization

Date: 2026-10-19. Branch: `DuyTD`. No commit or push.

## Verdict

**Architecture foundation implemented; general-purpose acceptance NOT ACHIEVED.**

This iteration separates discovery planning from executable capability binding,
adds structural UI understanding, context-aware next-action reasoning and
composable backend verification, and integrates them into V2. It does not claim
an arbitrary new task can now execute. Unbound semantics, unknown widgets and
missing independent outcome evidence remain SAFE_BLOCKED.

A new real-device application evaluation, My Files, was deliberately retained
as BLOCKED after entering/submitting a query without independently proving the
result belonged to that submit. No package-specific workaround was added.
The previous YouTube/Gallery successes are historical, not new acceptance of
this revision. Existing uncommitted work was preserved.

## Architecture Audit

| Boundary | Existing limitation | This iteration | Remaining limit |
| --- | --- | --- | --- |
| OutcomeKind / capabilityRegistry | Closed ten-kind vocabulary; UNKNOWN cannot execute | Separate source-preserving discovery plan with missing semantic/execution/verifier contracts | Executable binding still closed; no arbitrary effect synthesis |
| outcome-proposal / outcome-spec | Fixed action vocabulary and clauses; Qwen chooses source-supported options | Unknown goals remain represented independently of a runnable operation | No unrestricted semantic decomposition; unsupported verbs still unresolved |
| agent-v2 | Early unsupported coverage stops execution; capability-specific branches | Discovery state emitted before rejection, original/outstanding goals included in next-action model input | Unbound goals do not autonomously launch/explore applications |
| ui-affordances / candidate generation | Label/resource patterns and task-specific candidate branches | Structural navigation roles from native widget classes, typed world model, hierarchy groups, explicit unknowns | Custom/Compose widgets may expose only generic classes; unknown controls are not guessed |
| navigation graph | Bounded observations/transitions, limited known recovery | Verified route history supplied to planner; loop/unverified-transition errors become typed SAFE_BLOCKED | No general route search or synthesized recovery tree yet |
| verification registry | Closed backend predicates and separate provider paths | Composite all-required predicate contract integrated into ordinary V2 outcome verification | Does not invent an independent verifier for a new semantic outcome |
| app catalog | Package discovery, several conventional defaults, missing launcher display labels | Reused as-is, no application profiles added | App names may need exact package or user disambiguation |
| forms / artifacts | Fixed record fields, persistence/time-layout and exact-URI contracts | Preserved with existing grants/providers | Arbitrary record schemas and generic Gallery identity navigation remain unsupported |
| Qwen | Restricted source-choice vocabulary, omission/abstention and latency | Grounded next-action call now includes goal/context/history/effects/budgets | Candidate selection is not unrestricted capability invention |
| hybrid DOM observer | Existing extraction has browser-specific assumptions, including search result filtering | Web context/headings/link counts exposed as read-only evidence in world model | Existing DOM extraction was not rewritten; new world layer does not execute DOM controls |

V2 remains opt-in. V1 defaults and execution implementation were not rewritten.
Device Runtime, physical locks, Session ownership, shared inference queue, artifact
isolation and owner authorization remain in place.

## General Capabilities Added

### Goal Discovery Plan

`open-world-plan.ts` creates a goal layer containing the original request, every
source-bound outcome, dependencies and its binding state. A goal can remain
DISCOVERY_REQUIRED rather than disappearing because no operation exists.
Missing semantic binding, interpretation review, execution contract and independent
verifier are explicit. Technical next-step purposes are separate from user goals:
OBSERVE, DISCOVER_CONTRACT and GROUND_ACTION. No technical step marks its parent
outcome complete. This layer is runtime-integrated and appears in progress and
terminal metadata.

This is intentionally a discovery representation, not a new executable UNKNOWN
capability. Model-driven arbitrary subgoal creation/rebinding is NOT_IMPLEMENTED.
No guessed verifier or grant is generated for unbound goals.

### Universal UI Evidence Model

`widget-semantics.ts` and `ui-world-model.ts` combine native class/properties,
accessibility-backed affordances, resource uniqueness, hierarchy and Session/
device/execution/snapshot context. They identify typed navigation, native actions,
editors, selection widgets, collections, dialogs, media surfaces and explicit
TextInputLayout form containers. Save/capture labels reuse the existing semantic
affordance layer, not new app rules.

Explicit parent references establish groups; nearby geometry alone cannot bind
fields. Unique package/class/resource triples supply identity hints only within
the observed screen, not globally persistent record identity. Duplicate resources
do not get a stable identity hint. Stale, foreign, loading and system-overlay
evidence is marked unusable. A generic selected=false property is not evidence
that an unknown widget is understood.

Native Button classification indicates only an action affordance, not its effect.
The world model's eligibility flag is not execution permission. Candidate issuance,
destructive/sensitive filtering, owner policy, fresh revalidation and grants still
decide whether an action can run. Arbitrary clickable custom controls do not become
navigation targets. Web context metadata is observational only; OCR/Vision was not
added or sent to any service.

### Dynamic Next-Action Context

The existing multi-candidate V2 branch now calls `chooseGroundedNext`. Input contains
the original goal, current source-bound parent goal, all outstanding goals,
observed UI group context, supplied candidates/effects/verifiers, verified route
history and remaining time/step budgets. Output can select a supplied issued ID,
abstain or request another candidate page. Invalid/foreign/unissued planning
contexts are rejected before reasoning. Labels remain untrusted data.

Existing fresh native revalidation and single-use grants still run after model
selection or human assistance. The model cannot return selectors, coordinates,
shell, new primitive code or completion evidence. Unique direct actions still
avoid inference. Search/forms retain their registered executor loops; they were
not replaced with a universal unconstrained action loop.

Structural navigation candidate generation and selected-state verification now
support native navigation-item classes without requiring an application selector
or a recognized resource name. Unknown custom widget classes are not activated.

### Composite Verification and Recovery Classification

`composite-verification.ts` requires every backend predicate to pass, or returns
SAFE_BLOCKED without usable partial completion evidence. A screen-fingerprint
change alone cannot be an outcome completion contract. Ordinary V2 verification
now composes foreground identity with its registered goal-specific predicate.
Provider-backed search, persistence and artifact verifiers remain separate and
retain their independent receipt/readback requirements.

Navigation loops, depth limits and unverified transitions now raise NavigationBlocked.
They become SAFE_BLOCKED rather than generic FAILED. Unverified transitions never
become route hints, and uncertain mutations are not replayed. Existing bounded
BACK/scroll/menu recovery remains; a general novel-recovery subgoal engine is not
claimed. Parent outcomes remain intact after recovery failure.

## Evaluation Design and Freeze

New evaluation fixture: `tests/fixtures/agent-v2-open-world-holdout.cjs`.
New tests: `tests/general-agent-v2-open-world.test.cjs`.

Application layouts, task-only goals and initial-state variations are separate
cohorts. Runtime never imports the evaluation fixture. The test process hashes
Agent V2 sources before/after the cohort; final Agent-directory hash:
`334c882561556deddd26cfab0d4ea679b5752ea8d1bbe2524e8fbd454e4c08ce`.

Initial development evaluation exposed three issues: a test incorrectly expected
UNSUPPORTED instead of the existing NEEDS_CLARIFICATION for unknown syntax;
selected=false masked unknown widgets; and an unverified benign-dialog transition
was classified FAILED. Later full regression also caught rejection of previously
supported native Button candidates, fixed by recognizing native action structure
without granting navigation permission. Existing tests were not loosened.

These fixtures are now regression/development data, not pristine unseen evaluation.
Their final rerun must not be advertised as an unbiased new-app performance estimate.
Real-device/model evaluations froze all Android TypeScript sources with another,
broader digest and did not modify runtime during the evaluation:
`92f3ae8e7e818aca85e1d4563eae511b5292819ec1982658133c1f46b5eaa4f1`.
The two digests cover different file sets, not inconsistent runtime versions.

## Offline Results

All results in this section are OFFLINE_TESTED, not Android evidence.

| Cohort | Cases | Verified completion | Safe block / unbound |
| --- | ---: | ---: | ---: |
| Application layout | 3 | 2 | 1 unknown custom control |
| Initial state | 4 | 1 already-selected destination | 3 duplicate target, uncertain dispatch, unchanged dialog |
| Novel task language | 3 | 0 | 3 preserved goals with missing semantic/verifier contracts |
| Total | 10 | 3 (30%) | 7 (70%) |

All ten expected classifications pass, but that is NOT ten completed tasks.
Application/initial-state runtime completion is 3/7 (42.9%); two cases perform one
verified navigation click and one requires no click. Three task-only requests
(humidity comparison, accessible itinerary organization, certificate ordering)
retain exact source and missing-contract information: 3/3 preservation, 0/3
semantic/executable resolution. There is no semantic-correctness PASS for those
unresolved tasks. Observed synthetic false completion: 0/10; this small cohort
does not establish a population false-completion rate.

No invalid custom/duplicate target is clicked. An uncertain dispatch is attempted
once, never replayed. A benign-dialog BACK with no observed transition blocks and
does not become a successful route. Recovery success in that dedicated case is
0/1. Capability discovery has no independent complete-widget oracle here, so no
global discovery-accuracy percentage is reported.

## Real Qwen Next-Action Evaluation

Runner: `scripts/agent-v2-next-action-evaluation.cjs`.
Evidence: `C:/Users/TRANDU~1/AppData/Local/Temp/agent-v2-next-action-evaluation-1792417750551.json`.
Classification: REAL_MODEL_SIMULATED_UI; zero Android actions.

Qwen2.5:3b-instruct chose the exact source-requested destination rather than a
competing archive label in 3/3 cases. All outputs matched the constrained schema.
The values/layouts were evaluation-only. These requests still use the existing
launch/navigation grammar: this is candidate-choice evidence, not novel free-form
task decomposition or real Android completion.

Inference times: 20,762 / 14,195 / 17,615 ms (median 17,615). Queue waits 0 / 0 / 3 ms;
prompt tokens 260 / 258 / 261; output tokens 62 / 50 / 69. First load 8,643 ms.
No settings/model download changed. The added context and model-generated reason
have measurable cost; no speedup claim is made. Native fresh-state checks were not
relaxed to accommodate inference time. Historical 25/28 semantic benchmark results
belong to the previous report, not a new accuracy measurement for arbitrary goals.

## Real Android: New Application

Samsung A50s, ADB `192.168.1.17:33081`; Appium ready; awake/unlocked at preflight.
My Files (`com.sec.android.app.myfiles`) had not been a runtime development target
in the previous acceptance work. It was observed before the frozen search task;
this reconnaissance disclosure matters for a strict application-holdout claim.
No runtime change was based on its package or UI labels.

Read-only world-model evidence:
`C:/Users/TRANDU~1/AppData/Local/Temp/agent-v2-world-evaluation-1792416526285.json`.
102 widgets, two hierarchy collection groups, 34 unique resource identity hints;
elapsed 12,257 ms. This first observation predates final native-Button classification
and is not a final-revision end-to-end PASS.

Frozen runtime search execution:
`7d46be4d-c758-464a-8a0e-af00592986ac`.
Goal: open the installed app and search `fieldwork-notes-2026-zqx`.
Evidence: `C:/Users/TRANDU~1/AppData/Local/Temp/v2-acceptance-7d46be4d-c758-464a-8a0e-af00592986ac.json`.
Result: SAFE_BLOCKED, SEARCH_OUTCOME_UNVERIFIED; real verified goal completion 0/1.
The final search outcome, not the app launch, remained unverified.

The generic executor opened Search, entered/read back the exact query and reached
submission/verification. Independent binding of a result transition was insufficient.
Later observation showed the exact query and an empty-result message, but does not
retroactively establish the missing causal/result evidence for the dispatched
submit. Live query updates can produce the same empty state before submission;
the unchanged-result guard conservatively rejects it. That is a foundational
evidence-causality limitation, not a reason to add an app selector or label bypass.

Final-revision observation evidence:
`C:/Users/TRANDU~1/AppData/Local/Temp/agent-v2-world-evaluation-1792417299970.json`.
39 widgets, 23 unique resource hints, exact query plus no-result text, elapsed
9,195 ms. Observation-only; no result/file clicked. The current empty state is
observed, but the requested search execution remains BLOCKED.

Search latency: total 45,475 ms; planning 363; Session setup 6,193; observation
26,870; execution 15,121; verification 12. 180 Appium RPC / 29,161 ms; 118 ADB /
14,873 ms; 26 XML parses / 383 ms. These spans overlap and must not be summed.
No paired speedup or peak RAM measurement was made.

Only launch, search entry/submit and observation were allowed. No file deletion,
overwrite, uninstall, setting change, new photo, note or alarm occurred. One Session
at a time; all closed. Owner mode was scoped to the selected physical device and
disabled by the runner. Final runtime: zero active tasks and zero owner modes.

## Dashboard and Validation

Dashboard V2 progress now exposes the discovery parent/purpose/missing-contract
reason and UI-understanding counts/state alongside existing goal/evidence views.
Existing SSR/V1-default tests pass. Browser visual/interactive acceptance remains
UNVERIFIED in this request; no mock screenshot is counted as acceptance.

- Full regression: **427/427 PASS**, baseline 421 plus six architecture tests.
- TypeScript: PASS, also checked in production build.
- Scoped ESLint, including new runners/fixtures: PASS.
- Full ESLint: existing unrelated explicit-any error in
  `components/executions/ExecutionDetailModal.tsx:130`, plus nine warnings. FAILED,
  not suppressed or silently called clean.
- Production `next build --webpack`: PASS, all 12 pages generated. Existing
  dynamic-require tracing warnings remain. Default Turbopack's prior CSS-child
  startup problem was not retested or declared resolved; no bundler config changed.
- `git diff --check`: PASS (line-ending notices only).

## Files Changed

New runtime abstractions: `widget-semantics.ts`, `ui-world-model.ts`,
`open-world-plan.ts`, `composite-verification.ts` under `lib/android/agent/`.
Integrated in `agent-v2.ts`, `goal-graph.ts`, `ui-affordances.ts`,
`grounded-candidates-v2.ts`, `verification-registry.ts`, `navigation-graph.ts` and
`components/commands/AgentGoalPanel.tsx`.
New evaluation runners: `scripts/agent-v2-world-evaluation.cjs` and
`scripts/agent-v2-next-action-evaluation.cjs`.
New architecture tests and fixture listed above; this report.
Previous reports and historical failure evidence remain unchanged.

## Remaining Work and Support Boundaries

NOT_IMPLEMENTED: unconstrained but source-validated semantic subgoal decomposition;
discovered capability-to-verifier binding for arbitrary goals; novel route search
and recovery-subgoal synthesis; general DOM form/control execution; OCR/Vision.
Existing arbitrary record schemas and content/artifact identity limitations persist.
Structural class coverage is finite and cannot resolve every custom widget.

UNVERIFIED: arbitrary initial screens on real unseen applications, novel-task
Android completion, interactive Dashboard, multi-device live acceptance and general
new-app completion rate. Multi-device isolation is regression-tested, not a new
two-phone measurement. A future held-out evaluation must use genuinely fresh tasks/
applications after freezing runtime, rather than reclassifying these debug cases.

The next architectural need is trusted discovery of completion conditions and
source-preserving subgoals, not another application workflow. Missing evidence
continues to block rather than being silently replaced by successful RPCs.
