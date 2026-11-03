# General-purpose Android Agent V2 Implementation Report

Date: 2026-10-19. Branch: `DuyTD`. Starting commit: `458f514`.

Overall status: **PARTIALLY_IMPLEMENTED**. V2 is opt-in and bounded, not completion of the full general-purpose specification. No real-device acceptance was performed in this run.

## A. Implementation Summary

Implemented an execution path using validated requested outcomes, a dependency graph, installed-app discovery, observed affordances, grounded candidates, single-use grants, native execution and backend verification. Supported operations are launch, bounded read navigation and arithmetic through an observed editable math field. Unsupported outcomes block the entire graph before opening a Session; there is no implicit partial execution.

V2 is available through the existing worker/Dashboard. V1 remains default. Typed app/target selection and permission handoff retain the execution and, once opened, its Session. Intermediate artifacts currently represent verified-state metadata, not persisted media or records.

## B. Changed Files

New modules in `lib/android/agent/`:

| Files | Purpose |
| --- | --- |
| `outcome-spec.ts`, `goal-graph.ts`, `goal-compiler.ts` | Request spans, coverage, graph and arithmetic oracle |
| `capability-registry.ts`, `app-catalog.ts` | Executable capability declarations and device-local launchers |
| `ui-affordances.ts`, `grounded-candidates-v2.ts` | Observed controls, ranking, pagination and candidate integrity |
| `evidence-predicates.ts`, `verification-registry.ts` | Typed backend predicates and issued evidence |
| `artifact-store.ts`, `navigation-graph.ts` | Scoped state metadata and bounded verified transitions |
| `effect-grants.ts`, `human-assistance-v2.ts` | Backend authorization and expiring typed assistance |
| `agent-v2.ts` | Integrated observe/decide/authorize/execute/verify loop |

Other created/modified source:

| Files | Purpose |
| --- | --- |
| `lib/android/grounded-interactions.ts` | Native actions with fresh-state checks and field readback |
| `lib/android/condition-executor.ts` | V2 adapter/Session identity and playback accounting |
| `lib/android/targets.ts`, `snapshot.ts`, `state-observer.ts`, `visual-grounding.ts` | Checkable/checked observations and fingerprints |
| `lib/android/agent/goal-planner.ts` | Coverage and quote/app/value-aware Vietnamese semantics |
| `lib/android/agent/evaluator.ts`, `agent-loop.ts` | Opening versus actual playback evidence |
| `app/api/executions/route.ts`, `hooks/useDashboardDemo.ts` | Optional analyzed original request for playback semantics |
| `lib/android/agent/schema.ts`, `runtime-schema.ts`, `device-runtime.ts` | Additive V2 contracts and per-device execution |
| `lib/android/agent/worker-client.ts`, `worker-server.ts`, `runtime-storage.ts` | Feature negotiation, cancellation and worker integration |
| `lib/android/agent/budget.ts`, `reasoning-scheduler.ts`, `ollama.ts` | Queue/service timing, deadline admission and V2 context bounds |
| `components/commands/AgentGoalPanel.tsx` | Version selection, graph/evidence and typed assistance |

Added tests: `tests/general-agent-v2-contracts.test.cjs`, `tests/general-agent-v2-runtime.test.cjs`.

Updated existing fixtures: `agent-reasoning.test.cjs` checks additive timing metrics; `agent.test.cjs`, `autonomous-task.test.cjs`, `multi-device-runtime.test.cjs` provide advancing playback evidence when requesting playback. No old test was removed. This correctness change prevents title-only evidence from satisfying playback.

Changes to `pnpm-lock.yaml` and untracked `pnpm-workspace.yaml` were observed during work and preserved without editing; they are not claimed as V2 implementation. V2 did not require a dependency installation. No model, global policy mode or secret configuration was changed.

## C. Architecture Changes

Before: `request -> legacy GoalSpec/ActionPlan -> existing candidates/executor -> evaluator`.

V2: `request -> OutcomeSpecV2/coverage -> GoalGraphV2 -> app catalog -> existing device reservation/Session -> observe -> affordances -> candidate manifest -> rules/model candidate ID -> revalidate -> EffectGrant -> native executor -> backend predicates -> evidence/state artifact -> next node -> all-node completion`.

Existing Session manager, operation locks, port allocation, device reservations and cancellation remain in use. Worker feature negotiation refuses V2 against an old worker instead of silently downgrading. Active tasks are not automatically stopped for worker reload.

The compiler uses bounded rule-based decomposition, not open-world LLM planning. The graph contract supports dependencies; the compiler currently emits sequential dependencies.

## D. Outcome & Capability Coverage

| Capability | Actual implementation / boundary |
| --- | --- |
| LAUNCH | Verified installed launcher; visible foreground content required; ambiguity needs user choice or blocks |
| NAVIGATE | Related read controls, bounded scroll/back and destination heading verification; not arbitrary forms |
| CALCULATE | Unique observed math field, exact requested expression, observed equals and AST-oracle result comparison; no keypad-only input |
| SEARCH | Contract recognized, V2 execution unavailable; existing V1 search remains available |
| CREATE_RECORD / CAPTURE_MEDIA / SET_STATE / FIND_ARTIFACT | Outcomes retained but execution blocked before side effects; providers unavailable |
| UNKNOWN / unsupported compound | Explicit safe blocking, no silent downgrade |

Executed primitives: native CLICK, SET_VALUE, observed-region SCROLL, guarded BACK, verified launcher open and condition-based observation. Checkable/selectable controls are observed, not automatically authorized for toggle/select. No long press, drag, pinch, password entry or broad form support was added.

Predicate vocabulary includes foreground, visibility, exact text/value, selected/enabled state, state change, record readback, artifact existence/identity and playback progress. Persistence predicates explicitly return provider-unavailable. Compound predicate composition is not implemented.

The artifact store transfers backend-verified OBSERVED_STATE metadata across nodes/apps, scoped to execution/device/physical identity, consumers and expiry. It is not a saved-photo/note/alarm identity pipeline.

## E. Safety & Verification

- Schema and source-span checks reject dropped outcomes, substituted app/value bindings, cycles and evidence-free verified nodes.
- App names such as Dong ho are distinguished from closing verbs; quoted/input values are excluded from action classification.
- Models select offered candidate IDs only; JSON cannot mint generated candidates, grants or verified evidence.
- Dispatch rechecks device, execution, Session, package, snapshot fingerprint/age, native element uniqueness, enabled state and sensitivity.
- Grants are backend-issued, single-use and short-lived, independent of development policy mode. Only read/navigation and explicitly requested arithmetic edits are supported.
- General sensitive-effect approval is not implemented: such effects remain blocked. Permission prompts are handled manually, then freshly observed after acknowledgment.
- Uncertain mutations are not replayed. Dispatch success alone cannot complete a node.
- Assistance is expiring, device/execution-bound and single-use; denial/cancellation cleans up the wait.
- Playback requires matching package/title and advancing media-session position; opening metadata alone is insufficient.
- Existing V1 screenshot-coordinate assistance remains separate. No new V2 screenshot-coordinate approval flow was implemented.

## F. Tests

Commands used the installed Node executable directly:

```powershell
$files = (Get-ChildItem tests -Filter '*.test.cjs').FullName
& 'C:\nvm4w\nodejs\node.exe' --test $files
& 'C:\nvm4w\nodejs\node.exe' node_modules/typescript/bin/tsc --noEmit
& 'C:\nvm4w\nodejs\node.exe' node_modules/eslint/bin/eslint.js <changed-source-and-test-files>
& 'C:\nvm4w\nodejs\node.exe' node_modules/eslint/bin/eslint.js .
& 'C:\nvm4w\nodejs\node.exe' node_modules/next/dist/bin/next build
```

| Check | Result / evidence level |
| --- | --- |
| Full regression | **367/367 PASS**, 20.794 s; OFFLINE_TESTED, including simulated HTTP/Appium |
| New V2 tests | 6 contract + 15 runtime tests included above; OFFLINE_TESTED |
| TypeScript | PASS; SOURCE_VERIFIED |
| Scoped ESLint | Changed/new TS/TSX/CJS files PASS; SOURCE_VERIFIED |
| Full ESLint | FAIL: existing `no-explicit-any` at `components/executions/ExecutionDetailModal.tsx:130`, plus 9 unused-import warnings; unrelated files unchanged |
| Production build | PASS; compile 27.5 s, TypeScript 21.4 s, 12 static pages |
| Build warnings | 3 dynamic filesystem tracing warnings in ADB/runtime storage; not fixed |
| Dashboard availability | HTTP 200; idle runtime reported V2 feature support, zero active executions; availability only |
| Dashboard React SSR | Actual component render test PASS; not browser/visual acceptance |
| Desktop/mobile browser QA | UNVERIFIED: browser control transport closed |
| Android / actual Ollama E2E | UNVERIFIED: no actual phone task or model benchmark executed |

The first final regression run inside the sandbox passed 364/367: two loopback fetch failures and one TEMP rename permission error. Outside the sandbox, the same suite passed 367/367 without source changes.

Negative tests include malformed/invented choices, stale/foreign/tampered candidates, grant replay/revocation, wrong-device artifacts, unavailable verifiers, unsupported outcomes, uncertain mutation without replay, permission denial and interrupted-runtime restoration without replay. Simulated devices retain independent graph/Session/action state, including one blocked device while another completes.

Generalization fixtures vary app packages, values, layouts, dialog/permission state and app ambiguity. These are repository tests, **not a sealed independent held-out benchmark**. Existing tests cover cancellation and transport aliases; not every requested mixed-WebView/duplicate-record/unsaved-form permutation has new V2 coverage.

## G. Five Tasks

| Task | Precise result |
| --- | --- |
| T1 Camera capture | SAFE_BLOCKED tested offline; saved-media verifier missing; real device UNVERIFIED |
| T2 07:00 alarm | SAFE_BLOCKED tested offline; persisted alarm/enabled-state adapter missing; real device UNVERIFIED |
| T3 125 x 48 | Oracle supports 6000; generic execution tested with other expressions/packages/editable layouts. Exact T3 phone flow UNVERIFIED; keypad-only UI unsupported |
| T4 persisted note | SAFE_BLOCKED tested offline; save/readback identity provider missing; real device UNVERIFIED |
| T5 photo to gallery | SAFE_BLOCKED tested offline; state metadata is not media identity; real device UNVERIFIED |

Negative passes demonstrate no false completion, not successful task support. Runtime contains no T1-T5-specific package/selector/coordinate workflow.

## H. Performance

Unique grounded choices use rules without model calls. Ambiguity can invoke the existing Ollama candidate chooser. Catalog cache expires after 30 seconds; candidate pages contain at most eight choices. Navigation and execution budgets remain bounded, model concurrency remains one and the existing four-execution ceiling is unchanged.

Telemetry separates queue wait, service and total latency, deadline remaining, context rejection and cancellation. Expired admissions are rejected. V2 conservatively bounds serialized prompt bytes; this is not an exact tokenizer measurement. No raw XML or screenshot is added to text-model context.

Test/build timings are not phone latency, model throughput or RAM benchmarks. No resource/model settings were increased. Short grant/freshness deadlines may reject slow physical operations and require real acceptance testing.

## I. Remaining Limitations

- Bounded rule-based parsing cannot guarantee universal semantic coverage or arbitrary LLM decomposition.
- Persisted media/record providers, broad forms, toggle/select/date-time dispatch and generic sensitive write approvals are missing.
- No new OCR/VLM provider or screenshot upload; unknown icon-only UI is not clicked by guesswork.
- App labels may be unavailable; package tokens are not invented display labels.
- Recovery is bounded read navigation/dialog handling, not arbitrary mutation repair; no default force-stop/Home reset.
- State metadata does not implement photo identity or full cross-app artifact tasks.
- Dashboard/runtime wiring is offline-tested; live assistance, phone completion and browser layout remain unverified.
- V2 currently has narrower search/video coverage than V1 and does not silently inherit V1 scripts.
- Gates A-E are not fully complete. This repository is not yet the full requested general-purpose product.

## J. Implementation Status

| Area | Classification |
| --- | --- |
| Coverage/graph/arithmetic/Vietnamese correctness within bounded grammar | IMPLEMENTED_AND_TESTED |
| Candidates, grants, native guards and state artifact integrity | IMPLEMENTED_AND_TESTED offline |
| Versioned runtime, simulated isolation, typed assistance, queue timing | IMPLEMENTED_AND_TESTED offline |
| Actual Appium/phone/model operation and browser layout | IMPLEMENTED_UNVERIFIED |
| General-purpose product and recovery coverage | PARTIALLY_IMPLEMENTED |
| Capture/alarm/note/photo identity execution | BLOCKED by missing capability/verifier implementations |
| Open-world LLM decomposition, new OCR/VLM, broad widgets and sensitive approvals | NOT_IMPLEMENTED |

Usage: Dashboard -> Goal Agent -> Agent V2 -> connected phone -> supported launch/read-navigation/math request. V1 remains available. Reload an old worker only when idle; do not interrupt active executions. No commit/push was performed for this implementation request.
