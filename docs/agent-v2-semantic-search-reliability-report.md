# Agent V2: Semantic and Search Reliability

Date: 2026-10-19. Branch: `DuyTD`. No commit or push.

## Verdict and Evidence Boundaries

The guarded native SEARCH contract is REAL_DEVICE_VERIFIED on one Samsung A50s,
both from YouTube Home and previous search results. The same executor completed
Gallery search with independently observed NO_RESULTS. This is not unrestricted
general-purpose acceptance: detail-screen navigation, nonempty Gallery results,
live-as-you-type on an actual application, and interactive browser acceptance
remain UNVERIFIED.

Semantic evaluation is 25/28 faithful on a new fixed held-out set, with zero
observed false-accepted executable plans. This measures a hybrid source-constrained
interpreter, not unrestricted language understanding or Android completion rate.
The three semantic failures remain failures. Historical BLOCKED executions have
not been relabeled. Existing dirty work was preserved.

## Root Causes of the Prior Eight Semantic Rejections

Source: `docs/agent-v2-generalized-planning-search-acceptance.md`, including its
original real-Ollama evidence references. All twelve old responses were valid
structured JSON; this was not an eight-case JSON serialization failure.

| Prior rejected case | Diagnosis |
| --- | --- |
| Visit gallery | Model chose view/navigation rather than requested app launch: action/capability error. |
| Accented launch Clock | Invented radio value: model hallucination/prompt-example coupling, caught by source binding. |
| Launch Gallery, view Albums | Omitted requested clause and changed value: model coverage/copy failure. |
| Launch Notes, search quoted blue sky | Quote delimiters were lost. The semantic query was plausible, but the backend representation required exact source text: avoidable model-copy burden/backend contract mismatch. |
| Open Clock, do not create alarm | Negated clause omitted/misattached: model coverage and negation failure. |
| Send message | Invented app/search/calculation. Schema lacked an explicit faithful unsupported intent; model failure and representation limitation. |
| Show that app | Unresolved reference plus case/source rewriting. Missing explicit ambiguity representation compounded a source-copy failure. |
| Search quoted text in Notes | Backend did not separate explicit application qualifier; model also merged query and app. Extractor/compiler and model error. |

During development, a separate zero-based option experiment also failed: model
returned 1 for the first option. Displaying explicit one-based IDs fixed this
instruction/serialization mismatch. It is not attributed to inference capacity.
No model or inference settings were changed.

## Implemented Abstractions

### Semantic Interpretation

IMPLEMENTED_AND_TESTED / OFFLINE_TESTED:

- Backend extracts clauses, exact values, literal delimiters, negation and source
  offsets. Generic action vocabulary identifies source-supported interpretations.
- Qwen selects displayed one-based option IDs, one per clause. It does not copy
  source strings or generate selectors, coordinates, code, grants, IDs or edges.
- Strict validation still rejects omissions, invented values/actions, negation
  changes, incomplete arithmetic and unsupported executable interpretations.
- Explicit unsupported intents preserve SEND_MESSAGE, DELETE_DATA, UNINSTALL_APP,
  PLAY_MEDIA and ambiguous references without inventing executable capabilities.
- Quoted search plus explicit app qualifier compiles without an invented LAUNCH.
  An unresolved unquoted query/application boundary stays SAFE_BLOCKED.
- Compiler still assigns and validates coverage, graph IDs and dependencies.
  Registered contract readiness is distinct from installed-app/UI readiness.
- Human interpretation review remains mandatory for new model proposals. Owner
  mode does not silently approve the interpretation.

This intentionally restricted candidate vocabulary limits expressiveness. Unknown
verbs and unclear application boundaries can still block. The model often chooses
between a source-supported primary option and unsupported; the benchmark must not
be represented as independent free-form reasoning.

### State-Aware Search and Dispatch

IMPLEMENTED_AND_TESTED; specified live paths below are REAL_DEVICE_VERIFIED:

- Ground collapsed populated search widgets from generic native resource/class
  semantics, prioritizing them over unrelated overflow menus.
- Explicit FOCUS phase for an exact-query field that is not focused.
- One scoped BACK can dismiss a small, observed benign menu with no editable,
  destructive, sensitive, save or checkable affordances. Recovery is consumed;
  it is not arbitrary repeated BACK or a package-specific workflow.
- Fresh native target revalidation ignores unrelated ad/result changes only when
  the issued search scope and actual target attributes remain valid and unique.
- Opening/focus/menu transitions require meaningful field/UI evidence, not any
  fingerprint change. Loading states cause bounded read-only observation.
- NOT_SENT, UNKNOWN and ACKNOWLEDGED diagnostics distinguish pre-dispatch rejection,
  uncertain RPC and acknowledged mutation. Causes are sanitized and bounded.
- Only a proven NOT_SENT stale-target rejection permits regeneration and a new
  issued candidate/grant. UNKNOWN is never blindly replayed.
- Submit receipt is recorded immediately before/after actual dispatch, not while
  locating a target. Exact query, same app/device/session, changed result body,
  and independent result/no-result evidence remain mandatory.
- Search stages distinguish UI opened, query entered, query submitted, results
  observed, no-results observed and completed. Clickable-control counts are not
  video/article rankings.

### Additional Search Layouts

OFFLINE_TESTED:

- Generic native result collections with an independently observed numeric
  item/result summary, rather than only resource IDs named results.
- Live-as-you-type requires exact input readback receipt, independent exact-query
  result summary, changed result body, no suggestion list and two distinct fresh
  snapshots with consistent results. Summary changes alone cannot legitimize
  an unchanged old result body. No automatic completion from typing alone.

Live-as-you-type and nonempty counted Gallery results were not verified on Android.
Gallery's successful final run used explicit IME and NO_RESULTS. WebView/DOM search
was not added to this native contract and remains NOT_IMPLEMENTED here.

## New Real-Qwen Benchmark

Fixed fixture: `tests/fixtures/agent-v2-semantic-heldout-v2.cjs`.
Runner: `scripts/agent-v2-semantic-benchmark.cjs`.
Evidence: `C:/Users/TRANDU~1/AppData/Local/Temp/phone-commander-semantic-reliability-1792405722587.json`.

The 28 fixtures were fixed before the measured run, with exact ground truth for
outcomes, app, value, dependencies, negation and unsupported intent. Runtime does
not import this fixture. Every case calls real Qwen, including known syntax.
The set is now evaluated, not a reusable unseen test set.

| Metric | Result |
| --- | --- |
| Model/settings | qwen2.5:3b-instruct, temperature 0, context 2048, output budget 256, concurrency 1 |
| Schema valid | 28/28 |
| Full semantic/source/dependency match | 25/28, 89.3% |
| Incorrect executable interpretation accepted | 0/28 observed |
| Explicit unsupported/ambiguous faithful and nonexecutable | 6/6 |
| Inference median | 2,072.5 ms |
| Inference range | 1,692-12,586 ms; cold first load 9,152 ms |
| Total inference | 74,516 ms |
| Queue maximum | 2 ms |
| Tokens across set | 3,578 prompt; 182 output |

FAILED / SAFE_BLOCKED cases:

- H09: model declined the source-supported second SEARCH; known outcome validation
  rejected the omission.
- H13: negated SEARCH preserved negation but became UNKNOWN/UNSUPPORTED; graph
  blocked. Counted as semantic failure, not successful unsupported detection.
- H16: model declined the second requested LAUNCH; coverage validation rejected it.

Old 4/12 and new 25/28 use different cohorts and schemas; neither accuracy nor
latency differences establish a paired causal improvement. No model download,
quantization change or inference-budget increase was made. Qwen 3B remains
imperfect; a larger model would require a separate RAM/latency evaluation, not an
unmeasured automatic switch on this 8 GB system.

## Real Android Acceptance

Samsung A50s / SM-A507FN, selected ADB transport `192.168.1.17:33081`.
Physical identity was validated by runtime. One execution/Session at a time.
Evidence files are local temporary artifacts:
`C:/Users/TRANDU~1/AppData/Local/Temp/v2-acceptance-<executionId>.json`.

| Execution ID | Scenario | Actual result | Total ms |
| --- | --- | --- | ---: |
| 886df711-33f4-4260-90da-011e7367e366 | YouTube, English science podcasts | COMPLETED, RESULTS | 40,693 |
| 8fa27cce-21b6-4dc2-9d4b-ee5aa94fb97f | Repeat, astronomy for beginners | SAFE_BLOCKED: acknowledged overflow menu was not Search entry | 33,687 |
| 8adb0d38-1ab3-49f0-8b28-989aa57fa7d7 | Same goal, observed popup initial state after generic fix | COMPLETED: scoped dismiss, collapsed-query discovery, RESULTS | 32,191 |
| 3f26bc34-4302-40c7-8099-2d70f9538767 | Previous results, computer science lectures | COMPLETED, new query and RESULTS | 30,923 |
| dfdbd3e3-ccba-4fee-8400-a9ad30364568 | Gallery, mountains | SAFE_BLOCKED: typed/submitted, nonempty collection not independently verified | 44,718 |
| 365bd3c1-0b6a-4d3a-a270-c6bfacc5bf40 | New English phrasing, marine biology talks | SAFE_BLOCKED: interpretation review expired before reply; no Session/actions | 131,558 |
| de3d7cfa-ae72-4e98-b8dd-bb991b55df36 | Same new phrasing, fresh model review and user approval | COMPLETED, MODEL_REVIEWED, explicit submit, RESULTS | 99,544 |
| e09f06aa-2e58-4955-9fac-751f59cfe43e | Gallery, ocean | COMPLETED, explicit IME, NO_RESULTS | 37,805 |
| f92f9e4a-4c9a-47d0-8caa-904c07d70d35 | Prepared YouTube Home, podcast tieng Anh | COMPLETED, RESULTS | 35,000 |

Home was prepared by clicking an actually observed native accessible Home control,
not by adding that label/package workflow to runtime. Search detail/video initial
state remains UNVERIFIED. No search result/video/image was clicked in these runs.
No photos, notes, alarms or other persistent test records were created or deleted.

The failed Gallery mountains recon showed exact query readback, an unfocused field,
a generic RecyclerView and a 12-item summary. That motivated counted-collection
fixtures but does not retrospectively complete the failed execution. The final
ocean evidence is specifically NO_RESULTS, not a 12-item result acceptance.

The user approved marine biology interpretation after the first execution expired.
It was not resumed with an expired token. A fresh execution and review token were
created, its device/request/summary/category/expiry were checked, then the user's
explicit approval was forwarded. That new execution continued under its own ID
and Session. It included 12,002 ms inference and 54,088 ms human waiting.

## Owner Mode, Isolation and Dashboard

Owner mode was scoped to the selected physical device, enabled by the controlled
runner and disabled in finally. Final runtime API readback: zero active tasks,
zero enabled owner modes, one registered device. Fresh state, Session ownership,
single-use effect grants, cancellation, revocation and budgets were not removed.
Search text containing destructive words is treated as data only for an issued
typed SEARCH target; actual destructive controls/metadata remain denied.

API-based interpretation review and runtime result/evidence handling were exercised
on the real model/device. Dashboard SSR tests verify V1 default, interpretation,
specific search state/diagnostic and no completed label on a blocked result.
Interactive browser visuals, clicking version controls, cancellation and Human
Assistance screenshot selection remain UNVERIFIED: browser tool transport was
closed. No URL-safety bypass or substitute fake browser PASS was used.

## Profiling and Optimization Limits

| Run | Setup | Observation | Execution | Verification | RPC / ADB / parses |
| --- | ---: | ---: | ---: | ---: | --- |
| Prior baseline | not paired | not paired | not paired | not paired | 114 / 74 / 15; total 37,250 ms |
| YouTube recovery 8adb0d38 | 6,069 | 16,666 | 17,140 | 16 | 116 / 74 / 15 |
| YouTube Home f92f9e4a | 6,037 | 16,882 | 17,815 | 16 | 115 / 76 / 15 |
| Gallery NO_RESULTS e09f06aa | 5,750 | 21,421 | 16,249 | 1 | 115 / 76 / 15 |

All durations are milliseconds. Observation, execution and lower-level RPC spans
overlap; do not sum them as exclusive wall-clock phases. Home RPC time was
25,218 ms, ADB 8,574 ms, XML parsing 253 ms. XML parsing is not the dominant cost.
Model-reviewed run had 1 ms inference queue wait, 8,590 ms load, 163 prompt tokens,
8 output tokens; most additional total time was human review, not device work.

One redundant intermediate observation can be omitted when candidate selection
evidence is at most two seconds old. Native dispatch still independently observes
and revalidates the actual target and context. This is a bounded round-trip
reduction, not stale-target reuse. No paired before/after device benchmark was
completed; different initial UI/content/network state prevents a speedup claim.
No peak RAM measurements were captured; memory improvement is UNVERIFIED.

## Validation

- Full final regression: 421/421 PASS (baseline 413 plus eight reliability tests).
- TypeScript: PASS.
- Scoped ESLint on changed implementation/scripts/fixtures/tests: PASS.
- Full ESLint: FAILED, existing unrelated `ExecutionDetailModal.tsx:130` explicit
  any plus nine unused-import warnings. Not suppressed or fixed out of scope.
- Default production build: FAILED, repeated Turbopack CSS child-process startup
  error (Node exited before connection, exit code zero), including outside sandbox
  and with real Node first in PATH. No unsupported source-level workaround applied.
- Official `next build --webpack`: PASS, including TypeScript and 12 generated
  static pages. Existing dynamic-require tracing warnings remain. This is a
  successful alternate-bundler build, not a default Turbopack PASS. No build
  script/configuration was changed; the temporary local Node comparison binary
  was removed. `git diff --check` passed.

Tests cover unchanged-target/new-ad fingerprints, meaningful transitions, unfocused
input, collapsed search, scoped popup recovery, NOT_SENT versus UNKNOWN with exact
mutation counts, live-query independent evidence and stable snapshots, typed
query data versus destructive controls, unsupported intent, exact quoted values,
ambiguous source boundaries and SSR status labels. Existing regression retains
cross-device scope, cancellation, grants, legacy V1 and denial assertions.

The first three reliability fixtures were run failing before implementation, then
green. No old assertion was removed to conceal failure. The final small query-data
policy/ambiguity hardening was tested offline after live runs; those exact edge
queries were not rerun on Android.

## Files Changed in This Request

The working tree already contained substantial uncommitted V2 implementation.
This list describes changes in this request, not ownership of all dirty files.

- `lib/android/agent/outcome-spec.ts`: unsupported semantics, qualified SEARCH,
  conservative ambiguity detection.
- `lib/android/agent/outcome-proposal.ts`: deterministic extraction, constrained
  model choices, source reconstruction and strict interpretation validation.
- `lib/android/agent/goal-compiler.ts`: explicit app qualifier per outcome.
- `lib/android/agent/agent-v2.ts`: model-review metadata and source-choice messaging.
- `lib/android/agent/generic-search.ts`: phases, fresh targets, receipts, popup
  recovery, independent result evidence, counted collections and live transition.
- `lib/android/agent/grounded-candidates-v2.ts`: typed search revalidation.
- `lib/android/grounded-interactions.ts`: native dispatch taxonomy and receipts.
- `lib/android/agent/search-executor.ts`: bounded recovery, no uncertain replay,
  progress, diagnostic and conservative observation reuse.
- `lib/android/agent/goal-graph.ts`, `evidence-predicates.ts`: additive search metadata.
- `lib/android/agent/effect-grants.ts`, `ui-affordances.ts`: typed query-data handling.
- `components/commands/AgentGoalPanel.tsx`: search diagnostics/unsupported intent.
- `scripts/agent-v2-acceptance.cjs`: wait for interpretation without auto-approval.
- `scripts/agent-v2-semantic-benchmark.cjs`: real constrained-model evaluator.
- `tests/fixtures/agent-v2-semantic-heldout-v2.cjs`: fixed new ground-truth cohort.
- `tests/general-agent-v2-search-reliability.test.cjs`: eight root-cause tests.
- `tests/general-agent-v2-search.test.cjs`: owner-mode query-data regression.
- This report; previous reports and failed execution evidence were preserved.

## Remaining Limits

SAFE_BLOCKED is correct when evidence is missing, not autonomous completion.
Uncertain mutation RPCs do not get automatic replay. Ambiguous fields, unknown
foreground/permission states and unchanged old results remain blocked. Native UI
trees can omit result titles, query summaries and accessible navigation; no OCR,
coordinate guessing or package workaround was introduced. Video ranking/playback,
content-detail-to-search navigation, nonempty Gallery result evidence, DOM Search,
real live-as-you-type and interactive Dashboard acceptance are not claimed here.
