# Agent V2: Generalized Planning and Search Acceptance

Date: 2026-10-19. Branch: `DuyTD`. No commit or push performed.

## Verdict

**PARTIALLY_IMPLEMENTED. Not a general-purpose acceptance PASS.**

The semantic/compiler boundary and native SEARCH execution are implemented and
offline-tested. One real YouTube search completed with backend evidence; later
repeatability testing safely blocked. Gallery search discovery/input worked, but
submission was unsupported on the observed screen. Real Qwen semantic accuracy
and interactive Dashboard acceptance remain insufficient.

Historical failed executions remain failed/blocked. No mock result is counted as
real-device evidence. The successful live run predates the final old-results
rejection guard; the final guarded revision did not reach submission in its live
rerun. That stronger completion contract is therefore OFFLINE_TESTED, not yet
REAL_DEVICE_VERIFIED end to end.

## A. Architecture Changes

### Semantic Interpretation and Deterministic Compilation

The model receives compact source clauses, not UI XML. Its structured output is
an ordered list of semantic action labels, exact source values and negation.
It cannot supply selectors, coordinates, executable commands, grants, predicates,
internal node IDs or arbitrary graph edges.

Backend source segmentation is quote-aware, preserves source offsets, understands
connective/action boundaries and does not split a package at `.search`. Intra-word
apostrophes such as `I'd` do not mask the remainder as quoted content. V1 retains
its original boundary contract, including its established result/playback planner.

Backend validation checks exact unique source/value binding, full source coverage,
known outcome preservation, action evidence, negation, compound-action omissions,
hidden write verbs and complete arithmetic operands. Query text is data, including
negation or destructive words inside a quoted query. Values are never repaired by
substituting synonyms or guessing offsets. Missing clauses or invented values
remain rejected. Legacy proposal validators are retained for trusted callers;
the real Ollama response is restricted to the new semantic schema.

The existing compiler assigns outcome IDs, ordered dependencies, effect scopes,
registered capability/predicate contracts and artifact bindings. Graph validation
retains topology and full-outcome invariants. Unsupported inputs remain blocked.
An executable semantic proposal still requires GOAL_INTERPRETATION review before
device discovery/execution. Owner mode does not approve that review implicitly.

`SYNTACTICALLY_VALID`, `SEMANTICALLY_FAITHFUL`, `EXECUTABLE` and actual verified
completion are separate metadata. EXECUTABLE here means a registered compiler
contract exists, not that a named app is installed or that its UI has been verified.

### Generic Native SEARCH

SEARCH now has a real registered execution/verifier path:

1. Observe the selected application's current native UI.
2. Discover an exact search affordance, or an observed menu leading to it.
3. Uniquely identify a non-secret editable search field from semantic attributes.
4. Bind the original exact query, enter it and verify exact readback.
5. Ground an observed Search button, or submit the focused search field with IME.
6. Require a successful single submit RPC receipt.
7. Independently verify a fresh same-app query echo and result/no-result state.

These technical phases are substeps of the SEARCH Goal Graph node and are emitted
as progress, not invented user outcomes. No workflow uses a YouTube/Gallery
package, fixed coordinates or app-specific selector. No search result is opened.

The typed search scope binds device, execution, node, Session, package and exact
query. It expires after 120 seconds and is disposed on exit. Candidates are issued,
freshly regenerated/revalidated, policy checked and dispatched through single-use
effect grants. Existing locks, owner revocation, cancellation and budgets remain.
Duplicate fields/buttons, secret fields, permission overlays and dirty unrelated
fields are not bypassed. Existing text can be replaced only in the typed search
field, not in an unrelated form.

UI changes before grant/dispatch cause bounded read-only re-observation/replanning.
An uncertain dispatched action is never replayed. Completion requires actual
submit evidence, not simply typed text. An unchanged old result signature cannot
verify a new submit. Suggestions are excluded when explicitly identified as such.
The verifier requires one semantic result container with clickable descendants or
an explicit no-results message. Its `count` is clickable controls, not a reliable
article/video count or ranking claim.

## B. Files Changed for This Request

Paths below are repository-relative. The initial working tree already contained
substantial V2 work; this list is not a claim that all dirty files originate here.

| File | Change |
| --- | --- |
| `lib/android/agent/outcome-proposal.ts` | Compact semantic schema, source binding, deterministic proposal compilation |
| `lib/android/agent/outcome-spec.ts` | Shared V2 clause spans, quote/apostrophe handling, isolated V1 boundary compatibility |
| `lib/android/agent/generic-search.ts` | Issued search scope, discovery, exact query, submit receipt, result evidence |
| `lib/android/agent/search-executor.ts` | Bounded generic search loop, no uncertain replay, verification polling |
| `lib/android/agent/capability-registry.ts` | Enable registered SEARCH executor/verifier contract |
| `lib/android/agent/grounded-candidates-v2.ts` | Typed search phases and IME_SEARCH candidates/revalidation |
| `lib/android/agent/effect-grants.ts` | Exact issued search scope authorization |
| `lib/android/agent/owner-test-policy.ts` | Allow typed read-search candidate subject to downstream grants |
| `lib/android/agent/ui-affordances.ts` | Editable current values are data, not action labels; secret/destructive metadata guards retained |
| `lib/android/grounded-interactions.ts` | Native field entry/readback, focused IME submit and submit receipt |
| `lib/android/agent/evidence-predicates.ts` | Typed native search evidence/provider |
| `lib/android/agent/verification-registry.ts` | SEARCH_OUTCOME_MATCHES through issued search scope plus foreground gate |
| `lib/android/agent/goal-graph.ts` | Additive analysis/search/Session progress metadata |
| `lib/android/agent/agent-v2.ts` | Proposal review/compiler integration, SEARCH runtime, terminal metadata retention |
| `components/commands/AgentGoalPanel.tsx` | Display interpretation classification and search progress/outcome |
| `scripts/agent-v2-held-out.cjs` | Real constrained-model evaluation, fixed extended dataset, structural graph readiness |
| `scripts/agent-v2-acceptance.cjs` | Read-only SEARCH allowance, search/Session/snapshot trace, evidence outside build output |
| `tests/general-agent-v2-search.test.cjs` | New semantic, search layout, native executor and adversarial tests |
| `tests/general-agent-v2-widgets.test.cjs` | Update fake model input assertion to clauses; retain review/denial and discovery assertions |

No model was downloaded or modified. No schema/API migration was made to legacy
execution. No existing Android data was deleted or overwritten.

## C. Generalization Evidence

OFFLINE_TESTED: the same executor works with an unprofiled native toolbar layout
and a different app whose search is behind More options. Tests cover English and
Vietnamese control labels, an old search value, a quoted/data-like query,
RESULTS and NO_RESULTS, with owner mode on and off. No app profiles are loaded by
these fixtures. They are mock evidence only.

Real-device evidence: YouTube native Search completed once; Gallery reused the
same discovery/input code but safely blocked before submit. No cross-layout
real-device completion claim is made.

## D. Real Ollama Results

Actual tested model: `qwen2.5:3b-instruct`, temperature 0, `num_ctx=2048`,
`num_predict=256`, shared concurrency 1. Settings were not increased.

Final old-case evaluation evidence:
`C:/Users/TRANDU~1/AppData/Local/Temp/phone-commander-held-out-1792403717355.json`

| Request | Semantic/compiler result | Inference |
| --- | --- | ---: |
| Please bring up the calendar. | Valid LAUNCH calendar; review required | 23,228 ms |
| I'd like to visit gallery. | SAFE_BLOCKED: model chose view instead of app launch | 6,177 ms |
| Bring up calculator; then show history. | Valid LAUNCH + NAVIGATE, sequential dependency; not CALCULATE | 6,150 ms |

Fixed extended dataset evidence:
`C:/Users/TRANDU~1/AppData/Local/Temp/phone-commander-held-out-1792402816488.json`

| Held-out request | Result / root cause | Inference |
| --- | --- | ---: |
| Khoi chay Dong ho (accented Vietnamese in dataset) | Rejected invented radio value | 6,016 ms |
| Mo Gallery roi xem Albums. | Rejected omitted clause/changed value | 3,390 ms |
| Please launch Notes and search "blue sky". | Rejected loss of exact quoted source value | 5,064 ms |
| Open calculator then compute 19 * 6. | Valid two-outcome proposal and graph; review required | 4,022 ms |
| Open Clock but do not create an alarm. | Rejected omitted negated clause | 1,907 ms |
| Send a message to my friend. | Rejected invented app/search/calculation; no supported-message claim | 4,051 ms |
| Could you show that app? | Rejected source mismatch; ambiguity not resolved | 1,952 ms |
| Open Calendar then open Gallery. | Valid two-app ordered graph; review required | 2,952 ms |
| Search "never delete my data" in Notes. | Rejected invented combined query/app value | 2,459 ms |

Combined final cohorts, 12 requests:

- Structured JSON validity: 12/12; invalid/truncated JSON observed: 0/12.
- Full semantic/source validation accepted: 4/12 (33.3%).
- Safe rejection: 8/12 (66.7%); not autonomous completion.
- Accepted proposals preserve all seven requested outcomes across those four tasks.
- Interpretation review required for all 4 accepted proposals; none was implicitly approved or run.
- Unsupported-message case was safely rejected, but the model did NOT correctly
  produce an explicit faithful unsupported interpretation. Semantic unsupported
  detection quality is therefore not counted as PASS.
- No COMPLETED status was emitted by these planner-only evaluations. This is not
  an estimate of the Android false-completion rate.
- Inference range 1,907-23,228 ms; median 4,036.5 ms. Queue 0-4 ms.
- Output 17-44 tokens. Calendar's cold load was 14,421 ms; warm/cold variation and
  other local work prevent a comparable before/after speedup claim.

Earlier exploratory runs remain in their separate temporary evidence files,
including a wrong-default-model HTTP_ERROR run and a Windows CLI quoting-truncated
dataset. Those are excluded from the 12-request final cohorts above. The extended
dataset now lives inside the runner so Windows argument quoting cannot split its
embedded quoted values into separate test cases. These prompts are no longer an
unseen benchmark for future tuning and should not be reused as sole held-out proof.

The two semantic improvements are real, but 33.3% validation acceptance is not
sufficient generalized language readiness. Validators were not relaxed to make
these results look better.

## E. Supported Search States and Limits

Implemented: observed search button/tab; observed menu; unique native EditText or
AutoCompleteTextView with search semantics; exact text readback; observed submit
button; focused IME search; submitted query plus result/no-result verification;
bounded fresh rediscovery before dispatch; safe cancellation/uncertainty handling.

Not implemented: generic WebView DOM search; arbitrary multi-level navigation or
blind BACK; coordinate fallback; live-as-you-type submission proof; searches whose
hierarchy hides query/result identity; arbitrary localized labels beyond current
semantic vocabulary; opening/ranking results as part of a search-only goal.

## F. Owner-Authorized Integration

The existing OWNER_AUTHORIZED_TEST_MODE was present and reused. Each live runner
opted in for the selected Wi-Fi transport and verified physical ID. It disabled
the authorization it created in `finally`. SEARCH uses scoped READ grants; owner
mode is not a bypass around technical uncertainty or interpretation review.

The original owner-mode regression tests continue covering destructive operations,
expiry/revocation, cross-device grants, audit persistence and V1 isolation. Search
tests additionally cover wrong devices, cancellation, revoked scope, duplicate
controls, injected labels, dirty/secret fields, lost submit responses, no receipt,
stale candidates and unchanged old results. Native executor tests assert one
IME RPC at most and no replay/result click.

## G. Controlled Real-Device Results

Samsung A50s / SM-A507FN, Wi-Fi `192.168.1.17:33081`. Android identity was verified
by the runtime, with no concurrent active task before each runner. Initial
readiness read SCREEN_STATE_ON and keyguard false. One Session per execution;
each runner closed its own context and disabled its own owner authorization.

| Execution | Goal / observed result | Classification | Total |
| --- | --- | --- | ---: |
| `3e5d5ac9-7577-4217-a753-c4e012a26cda` | CLI supplied only podcast because embedded quotes were split; target changed before click | Historical FAILED, not counted as full-query acceptance | 23,017 ms |
| `8c4d6a51-8020-409f-a71a-7c80c3a7e6a6` | YouTube, podcast tieng Anh with original accents: query + submit + RESULTS verified; no video opened | REAL_DEVICE_VERIFIED for then-current search contract | 37,250 ms |
| `1eade881-8bb5-4ebb-82e9-574ae63f6173` | Gallery, flowers: search opened and exact text entered; no eligible submit control | SAFE_BLOCKED, not completed | 36,187 ms |
| `a69387a3-b781-4b19-ae4f-d34102a78afd` | Guarded revision, YouTube already showing results: search-opening interaction unverified; no replay | SAFE_BLOCKED; final revision not fully accepted live | 38,197 ms |

Successful evidence:
`C:/Users/TRANDU~1/AppData/Local/Temp/v2-acceptance-8c4d6a51-8020-409f-a71a-7c80c3a7e6a6.json`

Gallery and guarded-repeat evidence use the same directory and
`v2-acceptance-<execution-id>.json` naming. The first historical run was saved under
`.next/v2-acceptance-<id>.json` and may have been removed by the production build;
its execution journal/status was not rewritten. New evidence is outside `.next`.
The guarded-repeat report records Appium Session
`e4355c63-ef4d-4593-924c-326c7c0ca553`, native snapshot IDs, candidate IDs, current
screens and phases. Earlier successful report does not contain Session metadata;
that field was added afterwards and has not been fabricated retrospectively.

Read-only reconnaissance after the Gallery block:
`C:/Users/TRANDU~1/AppData/Local/Temp/phone-commander-recon-1792403206477.json`.
It observed the EditText query flowers, hint Tim kiem (accented), and no exact
eligible Search submit button. The search field was not a focused IME candidate
at the blocked observation. The remaining content cannot be treated as submitted
results without a submit/transition contract. No Samsung-specific workaround was added.

The final repeat's backend exception was originally summarized as dispatch
uncertainty; the exact native subcause was not retained in that report. The final
executor now retains a bounded backend cause in subsequent failure reasons.
Whether that repeat's click reached Android is UNVERIFIED; it was not resent.

No data was deleted, no photo was captured, no test record/alarm was created,
no app was uninstalled/reset, and no result video was opened during this request.

## H. Validation and Dashboard

- Observed initial baseline: 406/406 (the request's 395 was historical).
- Final full regression: **413/413 PASS**, outside the restricted sandbox for
  loopback HTTP/atomic-file tests. Earlier sandbox runs failed local sockets/file
  renames; those environmental failures were retained, not hidden by assertions.
- TypeScript: PASS.
- Scoped ESLint for changed source/scripts/tests: PASS.
- Full ESLint: FAIL, existing `components/executions/ExecutionDetailModal.tsx:130`
  no-explicit-any plus nine pre-existing unused-import warnings. Not modified.
- Production build: PASS, existing dynamic filesystem tracing warnings remain.
  One initial build retry was needed because its own redirected log was placed
  inside `.next` and Windows held it open while Next cleaned that directory.
  Corrected by moving logs outside `.next`; no framework workaround/code change.
- `git diff --check`: PASS (line-ending warnings only).

Dashboard component exposes additive interpretation/search metadata and preserves
existing version selection, graph, assistance, owner-mode, cancellation and
verification views. Existing SSR/contract tests pass. Backend acceptance used the
Dashboard's `/api/agent/runtime` path, NOT a UI-originated button click.

Interactive Dashboard: **UNVERIFIED**. Browser connector returned Transport closed.
Native Chrome automation was attempted, recovered an observation after a timeout,
then was stopped by the tool because it could not establish the current URL with
sufficient policy confidence. No further browser input was issued. Therefore no
claim is made for visual layout, browser version selection, browser cancellation,
or a complete Dashboard-to-device interaction in this request.

## I. Performance

Successful YouTube run: planning 330 ms; Session setup 6,908 ms; observation
19,565 ms; execution 16,420 ms; verification evaluator 23 ms; assistance 0;
inference 0 (rules-covered command); total 37,250 ms.

Profiler: 114 Appium RPCs / 26,252 ms; native source RPC time 7,159 ms;
element RPC time 3,432 ms; 74 ADB commands / 9,554 ms; 15 parses / 451 ms.
Grounding's separate profiler bucket was 0, not a claim that grounding was absent.
Native executor waits include observations, so these timing buckets overlap and
must NOT be summed as independent wall-clock components.

Final guarded repeat: planning 399 ms; setup 7,332 ms; observation 17,490 ms;
execution 9,758 ms; total 38,197 ms. It blocked before search completion.

Compact semantic output removes model-authored spans/IDs/graph edges and limits
generated tokens. Known rule-covered goals avoid model calls. Fresh-state and
grant checks were not reduced. No AI concurrency increase, no unverified UI cache,
no throughput/speedup claim. RAM/CPU utilization and peak memory were not measured.

## J. Remaining Work

1. Improve real Qwen semantic source copying, action labels and complete negation
   coverage without weakening validators; evaluate a new untouched dataset.
2. Resolve the native failure of search-opening from existing results with a
   retained backend subcause, then rerun the guarded final contract on Android.
3. Establish a generic evidence contract for unfocused/live-as-you-type search
   widgets before treating Gallery as a supported completed search layout.
4. Complete browser interaction acceptance when the connector/window URL policy
   permits it. Do not infer UI PASS from backend or SSR tests.
5. Add DOM/evidence adapters only when supported by actual generic evidence;
   current native-only limitations remain safe blocks.

## K. Readiness Classification

| Area | Classification |
| --- | --- |
| Semantic/compiler separation and source preservation guards | IMPLEMENTED_AND_TESTED / OFFLINE_TESTED |
| Real Qwen generalized language accuracy | PARTIALLY_IMPLEMENTED, not acceptance PASS |
| Native toolbar/menu SEARCH reuse | IMPLEMENTED_AND_TESTED / OFFLINE_TESTED |
| YouTube search on earlier contract | REAL_DEVICE_VERIFIED, one successful execution |
| Final stricter search repeatability | SAFE_BLOCKED / UNVERIFIED end-to-end |
| Gallery discovery and exact query entry | REAL_DEVICE_VERIFIED for those substeps only |
| Gallery submitted-search completion | SAFE_BLOCKED |
| Owner-scoped search and destructive denial regression | IMPLEMENTED_AND_TESTED |
| Live Dashboard interaction | UNVERIFIED |
| Generic WebView search and automatic result opening | NOT_IMPLEMENTED in this capability |

Overall: repository compiles and regressions pass; generalized acceptance remains
partial. Safe rejection is not autonomous success.
