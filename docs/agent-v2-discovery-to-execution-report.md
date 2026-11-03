# Agent V2: Discovery to Execution, M0-M3 Checkpoint

Checkpoint date: 2026-10-20 (Asia/Bangkok). Branch: `DuyTD`. No commit or push. Existing uncommitted work
preserved. Latest prior report was read from
`docs/agent-v2-open-world-generalization-report.md`. The named Vietnamese overview
file was not found in the repository.

## Verdict

**STOP AT M3. Not all acceptance gates are green.**

The missing discovery-to-execution path now exists in code: a novel command can
produce source-bound typed primitive subgoals, receive interpretation review, bind
registered executor/verifier contracts and run through the existing V2 runtime.
An integrated OFFLINE_TESTED novel Vietnamese launch completes through a real
backend verifier with a simulated adapter, not just a planner status.

However, real Qwen 3B resolved **0/3 development probes** under the new decomposition
schema. Bad source ranges/dependencies and truncated JSON are rejected before
device discovery or action. Do not interpret implementation as real-world language
generalization acceptance. M4 tuning and M5 sealed evaluation are deferred, as
requested when stopping after M3 without all-green evidence.

No new REAL_ANDROID completion is claimed in this request. The My Files regression
and sealed real-device evaluation were not run at this checkpoint. Their prior
BLOCKED results remain unchanged. No model, inference context or output budget was
increased; no larger model was downloaded.
The idle worker was reloaded to the final source without creating an Android
Session. Final runtime readback: zero active tasks and zero enabled owner modes.

## Flow

```text
Original request (V2 opt-in; V1 remains default)
  -> existing deterministic interpretation / constrained semantic choices
  -> unknown-language primitive decomposition, when ordinary labels cannot bind
       Qwen: primitive + source/target/value spans + negation + dependencies
       backend: schema, exact source, coverage, known outcomes, effects, topology
  -> missing executor / verifier / scope / negation contract? DISCOVERY_REQUIRED
  -> explicit interpretation review before application discovery or any effect
  -> bind registered primitive contract; retain all requested source and parents
  -> installed app + physical identity + readiness + owned Session
  -> observe fresh UI -> world model -> issued grounded candidates
  -> choose supplied ID using original/outstanding goals and verified route history
  -> bounded exploration / policy / fresh native revalidation / single-use grant
  -> execute once -> independent typed verification -> update parent goal
  -> persist only independently verified navigation hints (device/app version scoped)
  -> all parent outcomes verified? COMPLETED : SAFE_BLOCKED / next bounded step
```

Model output never supplies selectors, coordinates, commands, grants, predicate
implementations, evidence or new primitives. Persisted route hints are advisory
data, never executable instructions or reusable selectors.

## M0: Baseline and Sealed Design

Baseline measured in this request:

| Check | Result |
| --- | --- |
| Full regression | 427/427 PASS, 31,331 ms test-run duration |
| TypeScript | PASS |
| Scoped ESLint | PASS |
| Working tree | Existing substantial dirty V2 tree retained on DuyTD |

All previous 12/28 semantic cohorts, open-world application/state/task fixtures,
next-action probes, YouTube/Gallery/My Files cases and the new development probes
are development data. They are not unseen evaluation cases.

`scripts/seal-agent-v2-cohort.cjs` created an encrypted separate fixture:
`tests/sealed/discovery-to-execution.json`. Eighteen randomized descriptors span
TASK, APPLICATION and INITIAL_STATE groups, mixed Vietnamese/English, UI surfaces,
exact query values and difficult initial states. Its key remains outside the repo
in the local temporary directory. Neither ciphertext nor plaintext was opened
while developing. Runtime does not import this fixture. Generation refuses to
overwrite an existing cohort.

This is a sealed evaluation DESIGN, not a finished measured benchmark. Final
natural-language requests, ground truth and eligible real installed app assignment
must be materialized before M5 without subsequent runtime tuning. The README
documents this boundary and the external-key recovery limitation. M5 was not run.

## M1: Independent Read-Only Verifiers

Implemented in `read-only-verifiers.ts`, `evidence-predicates.ts`,
`verification-registry.ts`, `composite-verification.ts` and Search integration.

| Predicate | Evidence / constraints |
| --- | --- |
| FOREGROUND_IS | Existing fresh same-device/app foreground predicate |
| ELEMENT_TEXT_PRESENT | One exact visible native text; optional exact resource binding |
| WIDGET_STATE | One typed native checked/selected/value property and exact expected value |
| LIST_NONEMPTY_CORRELATED_WITH_VALUE | Exact field value, independent exact-query summary, one result collection, no suggestions |
| EXPLICIT_EMPTY_RESULT | Exact field value and one nonclickable explicit empty widget, no result items |
| KEYBOARD_DISMISSED_OR_SUBMIT_DISPATCHED | Issued Search scope with acknowledged submit or independently verified live-query state; cannot accept a caller-invented receipt |
| Existing provider readbacks | MediaStore delta, record reopen/readback, exact-URI viewer identity and playback progress retained |

Evidence carries class, confidence tier and reason. Classes distinguish native
readback, correlated result state, explicit empty state, acknowledged submit,
live query state, provider readback, artifact identity and playback progress.
Confidence means evidence provenance/strength, not a model-generated percentage.

An empty widget alone is an observation, not proof that a particular query was
applied. Composite outcome contracts require a separate commit predicate when
using result-surface facts. Partial successful predicates do not escape as completed
evidence. Foreground plus screen-fingerprint change is still insufficient outcome
proof. Successful RPCs alone never complete the Search goal.

The keyboard-only branch is deliberately not inferred from focused=false. There is
no independent generic keyboard visibility provider added here. The implemented
predicate proves an acknowledged submit or an independently verified live-query
state, and its explanation says which. A new Settings provider was not invented;
existing toggle verification remains native checked-state readback.

### Search State, Not Invented Submit Causality

Existing explicit-submit/change-after-submit and independently correlated live
search paths remain. New handling covers a result that already appeared while
typing before submit:

1. Issued scope binds exact user query/device/execution/node/Session/app.
2. Entry has exact native readback and a captured pre-entry result signature.
3. Submit has an acknowledged receipt; ambiguous/unknown dispatch is not replayed.
4. Current exact query is no longer focused; result body differs from pre-entry.
5. Two distinct fresh committed snapshots agree on the result surface.
6. Verify outcome state, explicitly without claiming submit caused the transition.

Unchanged old empty/list states still block. Typing without a receipt or independent
live-query correlation still blocks. A query-summary change alone cannot relabel
an old result body. A clickable control whose label says no results is not accepted
as an empty-state widget. Precise reasons now distinguish missing echo, unchanged
result without query-application evidence, pending second snapshot, suggestions
and absent/ambiguous result surface.

OFFLINE_TESTED: new live-before-submit success, stale-empty denial, no-submit denial,
same-snapshot denial, foreign-execution receipt denial and typed fact composition.
REAL_ANDROID: not newly tested here; no My Files success is inferred from these tests.

## M2: Source-Preserving Primitive Binding

`primitive-decomposition.ts` defines a closed typed catalog:

| Primitive | Binding state |
| --- | --- |
| OPEN_APP | Installed-app identity + existing foreground verifier/executor |
| NAVIGATE_TO | Observed navigation + existing destination verifier/granted execution |
| SEARCH | Existing issued Search contract and independent outcome verifier |
| TOGGLE | Conditional: explicit desired boolean, observed unique checkable, existing toggle contract |
| CREATE_RECORD | Conditional: existing supported new-record schema and independent persistence/readback |
| SET_VALUE | DISCOVERY_REQUIRED: generic field/replace-scope executor missing |
| SELECT_ITEM | DISCOVERY_REQUIRED: generic item identity/selection executor missing |
| READ_VALUE | DISCOVERY_REQUIRED: generic value-role/readback execution contract missing |
| CONFIRM | DISCOVERY_REQUIRED: parent mutation/confirmation contract missing |

Having a predicate name in the catalog does not authorize a primitive whose scope
or executor is missing. Conditional record/toggle bindings still go through their
old schema and effect checks; this is not unrestricted form or setting support.

Qwen receives a compact wire schema. Each step returns a primitive, UTF-16 source
range, target/value ranges or null, source negation and earlier dependency indices.
Backend reconstructs exact strings itself. It validates bounds, slot containment,
full ordered source coverage, no omissions/absorbed known outcomes, no self/future
dependencies, preserved known app/value/ambiguity, source negation and destructive/
external/hidden-write guards. Unresolved compound actions are rejected. Models do
not copy source values, assign graph IDs or specify executors/verifiers.

Valid unknown-language decomposition requires human GOAL_INTERPRETATION approval
before app discovery or Session creation. Owner mode does not implicitly approve
semantics. The validated proposal is process-issued and tamper checked, then bound
to existing V2 nodes and predicates. Graph metadata records primitive/source parent,
BOUND versus DISCOVERY_REQUIRED and missing contracts. Parent completion still
requires issued backend verification evidence, not the bound status.

OFFLINE_TESTED: a novel Vietnamese launch proceeds through review, one execution,
one Session and foreground verification. Tests reject omission, invented/outside
slots, negation changes, known-outcome changes, hidden effects, malformed schema,
invalid dependencies and post-validation mutation. Explicit Search app qualifiers
are preserved. Missing primitive executors stay blocked without device actions.

## M3: Bounded Exploration and Route Hints

Reused the existing Observe/Reason/Act/Verify/Update V2 loop rather than introducing
a second executor. `BoundedExploration` adds issued-parent checks, repeated-epoch
denial, uncertain-effect replay denial and recovery-subtask budget consumption for
technical navigation/scroll/back steps. Existing time/step/scroll/iteration limits,
NavigationBlocked loop/depth/transition errors and cancellation remain.

No unknown widget becomes eligible merely because it is clickable. Read-only
menu/back/scroll exploration still needs a grounded candidate and an allowed
observed affordance. Writes retain their issued effect/value/owner contracts.
Original parent goals are not replaced by recovery steps or marked complete by
navigation progress. Unknown mutation results terminate without replay.

`route-hints.ts` atomically persists bounded route documents keyed by physical
device identity, package and observed Android package versionCode. Version discovery
uses read-only PackageManager data. Only an issued read-navigation candidate plus
independently issued ELEMENT_VISIBLE destination evidence and a real state change
can be written. Foreign, cloned/unissued, stale, unchanged or fingerprint-only
proof is rejected. Documents are checked for scope/version on load; malformed
cache data is ignored. No selectors or native element references are persisted.

Hints feed the constrained next-action reasoning context. They cannot bypass fresh
observation, candidate generation, policy or grant issuance. Optional hint write
failure does not erase independently verified goal evidence. Only the final edge
whose destination has independent verification is persisted; intermediate mere
geometry changes are not promoted into durable routes.

OFFLINE_TESTED: persisted route reuse, physical-device/version isolation, rejection
of cloned/fingerprint-only proof, one-attempt uncertainty denial and existing
bounded-navigation/isolation/cancellation regressions. REAL_ANDROID route persistence
and novel-command execution remain UNVERIFIED at this checkpoint.

## Real Model Development Probes

These are unsealed DEVELOPMENT probes with no adapter, Session, effect grant or
Android action. Classification: REAL_MODEL_SIMULATED_UI. They evaluate source
decomposition/graph readiness, not UI execution or goal completion.

The first full prompt/schema exceeded the backend's conservative context guard:
2,960-2,969 prompt-byte upper bound. A shorter description still exceeded it. Both
attempts stopped before calling Ollama (CONTEXT_LIMIT), not model misunderstanding.
Those evidence files were retained. Compact range-array wire encoding reduced the
measured upper bound to 1,182-1,191 within the same guard. Validator strength and
context/output limits were not loosened.

Measured wire run evidence:
`C:/Users/TRANDU~1/AppData/Local/Temp/agent-v2-decomposition-1792428747658.json`.
Source hash during that run:
`3c7e4ef2e86b2934048d112a02cc264623278183a00f4ea3dc4eb1aa456ac4f1`.
Later generic safety/UI fixes are not represented as a rerun of these probes.

| Development request | Result | Inference ms | Tokens prompt/output |
| --- | --- | ---: | --- |
| Ghe org.development.viewer (accented request in runner) | Valid wire JSON, invalid slots including zero-length value ranges/extra step | 24,548 | 74 / 120 |
| Nho do quoted san ho (accented in runner) | Truncated/invalid JSON at output budget | 23,208 | 77 / 256 |
| Doc so do quoted do am (accented in runner) | Valid wire JSON, coverage/dependency rejection | 9,124 | 79 / 88 |

Model: qwen2.5:3b-instruct; context 2048, output 256, temperature 0 unchanged.
Wire JSON validity 2/3; faithful backend-accepted decomposition 0/3; autonomous
completion 0/3; all rejected before effects. Median inference 23,208 ms; queue
wait 0-2 ms; first model load 10,151 ms. No causal speedup, peak RAM or new-device
completion rate is claimed. The sealed cohort was not opened to substitute for
these failures. A larger model/output budget would require a separate next-stage
measurement, not an automatic fallback.

## Validation

- Baseline 427/427 PASS; checkpoint full regression 433/433 PASS after six new tests.
- Final verification after minor source-binding/UI fixes: **433/433 PASS**, 43,342 ms.
- Scoped ESLint: PASS on M1-M3 runtime, Dashboard, scripts and tests.
- Full ESLint: FAILED on the existing unrelated explicit-any error at
  `components/executions/ExecutionDetailModal.tsx:130`, plus nine unused warnings.
  No suppressions or unrelated cleanup was made.
- TypeScript/build initially found a new Dashboard optionality error; it was fixed,
  not suppressed. Final TypeScript: PASS. Final `next build --webpack`: PASS,
  including TypeScript and all 12 generated pages; existing dynamic-require
  tracing warnings remain. `git diff --check`: PASS (line-ending notices only).
- Default Turbopack was not retested; known prior CSS-child startup issue is not
  represented as fixed. Webpack is the explicitly requested build command.

The route atomic-rename test initially failed in the Windows filesystem sandbox;
rerunning outside that sandbox passed without changing the assertion or storage
implementation. Existing tests were not deleted or loosened. No mocks are counted
as Android success. Existing My Files BLOCKED and all old logs remain unchanged.

## Files Changed in This Request

New:
- `lib/android/agent/read-only-verifiers.ts`
- `lib/android/agent/primitive-decomposition.ts`
- `lib/android/agent/bounded-exploration.ts`
- `lib/android/agent/route-hints.ts`
- `tests/general-agent-v2-discovery-execution.test.cjs`
- `scripts/seal-agent-v2-cohort.cjs`
- `scripts/agent-v2-decomposition-evaluation.cjs`
- `tests/sealed/README.md` and encrypted design fixture
- This report

Integrated changes:
- `lib/android/agent/evidence-predicates.ts`, `verification-registry.ts`,
  `composite-verification.ts`, `generic-search.ts`, `search-executor.ts`
- `lib/android/agent/agent-v2.ts`, `goal-graph.ts`, `open-world-plan.ts`
- `components/commands/AgentGoalPanel.tsx`

## Remaining Gates

NOT_IMPLEMENTED: generic SET_VALUE/SELECT_ITEM/READ_VALUE/CONFIRM executors and their
full effect/identity scopes; arbitrary new record schemas; independent keyboard-only
visibility provider; new Settings provider; M4 resource/inference optimization;
M5 sealed cohort materialization/evaluation. Generalization is not established
merely by adding catalog names.

UNVERIFIED: real Android execution of novel decomposed language, live-before-submit
result acceptance on an actual application, durable route hints on Android,
interactive Dashboard and current-revision My Files outcome. There are no new
REAL_ANDROID success metrics for this request.

The next gate is source-decomposition reliability on Qwen (or a separately measured
alternative), followed by controlled Android regression and a genuinely frozen
sealed evaluation. Do not advance to M4/M5 or claim general-purpose PASS from the
offline integration result while the real-model gate is 0/3.
