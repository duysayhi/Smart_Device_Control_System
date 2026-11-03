# Agent V2 M3d: Generic Search Reliability and Latency

Date: 2026-10-20. Branch: `DuyTD`. No commit or push. Existing dirty/untracked work was preserved. The sealed cohort was not opened, imported, decrypted, or used. M5 was not started.

## Verdict

Partial acceptance, not a general Android completion claim.

- **REAL_ANDROID:** My Files completed three consecutive identical searches, including explicit replacement of a pre-filled query. A subsequent positive-result execution completed with a filename independently confirmed by MediaStore, native list evidence, and manually inspected screenshot. No file was opened.
- **REAL_ANDROID:** Play progressed through issued activation, newly focused unlabelled editable confirmation, exact entry, and acknowledged submission. Its final outcome remains **SAFE_BLOCKED / UNVERIFIED**: the result query is an unlabelled non-editable TextView outside the currently supported echo contract. A visually plausible result is not backend completion evidence.
- **REAL_ANDROID:** Coccoc, a new target in this acceptance cohort, returned typed `NEEDS_USER_ACTION / ANDROID_PERMISSION_SURFACE`. Android requested a default-browser change. No option was selected, no setting changed, and no query entered. Positive results in a second app remain **UNVERIFIED**.
- **SAFE_BLOCKED:** Maps and Photos activation remain blocked by observed occlusion/grounding. The exclusive-point algorithm does not authorize a point covered by another clickable view.
- **OFFLINE_TESTED:** 467/467 regression tests, including the stricter search contracts and negative cases. This is not Android end-to-end evidence.

No old BLOCKED result was edited or relabelled. New executions have different IDs, independently retained evidence, and their own source hashes.

## Source Freezes and Controls

All device batches used Samsung SM-A507FN, physical serial `R58MA78W6QK`, over USB. The previously used Wi-Fi transport was absent. Appium 3.8.0 was reachable. Own acceptance/reconnaissance Sessions ran one at a time. The acceptance runner disabled its device-scoped owner mode in `finally`; independent post-task native readback opened a separate Session only after the execution closed.

The SHA-256 input is the sorted list of `lib/android/**/*.ts` paths plus contents, calculated before each batch and checked after each case. Runtime was never edited during a device batch.

| Batch | Runtime SHA-256 | Evidence JSON in OS TEMP | Outcome |
| --- | --- | --- | --- |
| Baseline | `bf3d5a3620f4e799d42601ddae9eedc877f0060d1c944124a96b13d83789fb70` | `agent-v2-m3d-baseline-bf3d5a3620f4-1792473114806.json` | My Files completed; Maps/Play blocked |
| Initial explicit-clear implementation | `568db977e713` (full hash in JSON) | `agent-v2-m3d-after-568db977e713-1792475358674.json` | Found native placeholder/empty-value mismatch; blocked outcomes retained |
| Placeholder fix | `824822ce59b7ae578d7a2a3bc16a1a7d3f7c09ef6547ee98d066cf0dac2f490e` | `agent-v2-m3d-after-824822ce59b7-1792476616639.json` | Three repeat searches completed; positive-result verifier still blocked |
| Generic exact-record correlation | `9b9f40f351b201ccf0a94644a9b881a8c479427576d888508f40ce7efb338bc7` | `agent-v2-m3d-after-9b9f40f351b2-1792477403629.json` | Positive-result completed; one repeat safely blocked on grant expiry; Play G3 activation confirmed |
| Final hardening and permission routing | `0ba57fb4e60042bafa7bede033ce080dbfc690d46df877f48d2aafc2f063c5e0` | `agent-v2-m3d-after-0ba57fb4e600-1792478116027.json` | Coccoc typed user-action stop |

Final hardening rejects a previously focused editable even when its bounds resize, and routes a permission prompt encountered during a SEARCH prerequisite to the same typed user-action flow. The three-pass repeatability evidence belongs to the explicitly named earlier batch, not a claim that every later attempt or every final-hash case passed.

Raw JSON, screenshots, and native reconnaissance live in Windows OS TEMP, not in `.next`, source control, or the sealed cohort. Screenshot names are `m3d-after-<case>-<executionId>.jpg`. Post-task native snapshots corroborate the visible screen; they are not substituted for the execution's fresh dispatch/verification observations.

## Generic Fixes

### G1: Pre-filled Query Replacement

The old path could submit an already-present exact query without establishing new application evidence. SEARCH now issues separate FOCUS, CLEAR, ENTER and SUBMIT authorities as needed. CLEAR performs only `/clear`, then requires a fresh, unique, focused, empty native-field readback. ENTER does not clear again: it requires verified empty input, types the exact scoped query and reads it back. Submission without an issued exact-entry readback is denied.

Clear-time result signatures are retained separately from pre-submit signatures. A stable old body cannot become a new success merely because a snapshot UUID or query echo changed. If a result already appeared during entry, the verifier still requires changed clear/type-time content, commit evidence, and distinct stable committed snapshots. The independent live-update path retains its exact-summary, changed-body and two-snapshot requirements.

Real My Files exposed another generic root cause: an empty EditText reports text equal to its localized Search hint, and native `showing-hint=true`. Raw node text is preserved. The affordance's input value is treated as empty only when the explicit native showing-hint attribute corroborates it. Matching hint/text without that attribute is not an empty-value proof. Native password attributes are parsed and excluded from candidates.

Tests cover exact/different pre-filled queries, failed clear, sensitive/password fields, unchanged stale results, no-submit denial, live updates, and placeholder versus literal hint-valued text. Existing verifier fixtures now issue entry receipts instead of fabricating a submit from an unexplained pre-filled field. Existing assertions rejecting stale/foreign/suggestion outcomes remain intact.

### G2: Exclusive Activation Points

The existing center validator is unchanged. V2 search-intent OPEN may use a separate fallback: unique displayed/enabled native element, independent clickable and rect readback, exact rect equality, fresh hierarchy, ancestor/viewport clip, and partitioned cells derived only from observed target/occluder bounds. Any other clickable node covering a point, including nested microphone/clear controls, disqualifies that point. There is no model coordinate or app selector.

Tests cover partially covered center, complete coverage, nested controls, off-screen bounds and clipping. This is **OFFLINE_TESTED**, not a real Maps PASS. Maps' broad clickable view still covers every proposed point; native hierarchy does not provide independent evidence that the search target is topmost. It therefore remains NOT_SENT. Unknown z-order is not silently reinterpreted as an ignorable background.

### G3: Unlabelled Editables

A backend-issued, acknowledged OPEN search candidate records its before-state provenance. Acceptance requires exactly one visible editable, newly present or newly focused, enabled and non-sensitive; independently issued device-bound `mInputShown=true`; and native password readback exactly false. A focused widget that merely resized is not new. Keyboard alone, two editables, no editable, unchanged focus, password and forged keyboard receipts all fail.

The proven identity is scoped to the same device, execution, Session, node and SEARCH run. Existing unlabelled focused input without activation provenance is not adopted. A bounded RESET is available only through an observed, uniquely grounded back/navigation affordance with an otherwise empty, safe field; it cannot discard an unrelated draft. Play's initial retained unlabelled input correctly blocked. The owner manually returned Play to its main page before the successful activation-path test.

### G4: Typed User Action

Consent/privacy/onboarding/setup/Android permission surfaces without an authorized SEARCH candidate emit typed `NEEDS_USER_ACTION` with reason, observed snapshot ID and a current-device screenshot reference. V2 Dashboard renders this metadata. No accept, decline, default-app, permission or settings candidate is authorized by this state. Resume goes through fresh observation and normal candidate generation again; an unchanged prompt cannot become a SEARCH success.

The screenshot link is explicitly a **current-device** endpoint, not an immutable archived screenshot or an outcome verifier. Archived acceptance screenshots are separate TEMP artifacts. Existing assistance budgets, tokens, cancellation, Session ownership and freshness are retained.

Coccoc independently demonstrated this on Android's default-browser chooser. The runner's `--stop-on-user-action` declined continuation and let cleanup finish. Its terminal reason says "User denied assistance" because that is the existing denial path; the user had approved the read-only task, not a default-browser change. The retained typed SEARCH metadata is the actual reason for the controlled stop. No SEARCH interaction was dispatched. Photos no longer presented the earlier consent surface during this run; its observed tooltip/occlusion block is not falsely reported as a new consent-classification PASS.

## Real Android Evidence

Same repeat query: `fieldwork-notes-2026-zqx`.

| Placeholder-fix batch run | Execution | Initial state/path | Verdict | Total ms | RPC / ADB |
| --- | --- | --- | --- | ---: | ---: |
| 1 | `32338c6b-8ce1-4f7c-a9d5-7dd6f3ef182b` | Verified empty input; ENTER/SUBMIT | REAL_ANDROID COMPLETED, NO_RESULTS | 26816 | 83 / 65 |
| 2 | `b90128f6-ab53-437e-a4cd-efe17107ff89` | Pre-filled same query; FOCUS/CLEAR/ENTER/SUBMIT | REAL_ANDROID COMPLETED, NO_RESULTS | 28301 | 101 / 69 |
| 3 | `b822554d-5694-4a74-a42c-60472e64b06f` | Pre-filled same query; FOCUS/CLEAR/ENTER/SUBMIT | REAL_ANDROID COMPLETED, NO_RESULTS | 35944 | 107 / 72 |

These were consecutive without app-specific reset scripts. Screenshots for runs 2 and 3 were manually compared: exact query and explicit localized no-results message, not a successful positive-result claim.

Later exact-record-correlation batch, all attempts retained:

| Case | Execution | Verdict / evidence | Total ms | RPC / ADB |
| --- | --- | --- | ---: | ---: |
| Repeat 1 | `50a9889e-aa6a-4344-ab3a-67eebec02e16` | COMPLETED, NO_RESULTS | 58887 | 126 / 86 |
| Repeat 2 | `faddf735-246f-4a5f-8f92-1c040a7ea5de` | SAFE_BLOCKED, NOT_SENT GRANT_EXPIRED after one permitted re-grounding | 62867 | 106 / 69 |
| Repeat 3 | `f539cd9b-af5e-4926-bd0a-73cbf42e070d` | COMPLETED, NO_RESULTS; no claim the preceding blocked attempt completed | 24632 | 64 / 51 |
| Existing filename | `535b794a-9033-46f2-ba9b-a0e4d548a7af` | COMPLETED, RESULTS; exact record text in unique native collection + committed query + new/stable body | 33702 | 101 / 69 |
| Maps | `3943f1cc-72cb-470e-9b02-ae6a68465715` | SAFE_BLOCKED, NOT_SENT TARGET_LOCATE; no unoccluded point | 39133 | 55 / 51 |
| Play | `11f71181-21d0-4d17-a5eb-ac23a3ee88f7` | G3 activation/entry/submit REAL_ANDROID; final query echo UNVERIFIED, overall BLOCKED | 68946 | 161 / 113 |
| Photos | `3b728a8d-ce5e-4174-9eec-ccc5f411154c` | SAFE_BLOCKED, NOT_SENT TARGET_LOCATE; result search UNVERIFIED | 22780 | 60 / 51 |
| Coccoc, final hash | `1eb4fd00-41c2-484f-8799-ec411b2ef6e1` | REAL_ANDROID NEEDS_USER_ACTION; overall BLOCKED; second-app positive result UNVERIFIED | 23652 | 30 / 35 |

Before the positive-result run, read-only MediaStore query confirmed `_id=2248`, `_display_name=20261019_154525.jpg`, `date_added=1792399531`. No image bytes were read for this oracle and no new photo was taken. The post-task native list contains a non-editable exact filename under a clickable record, plus visible date/size metadata. The manually inspected screenshot shows one internal-storage result, same filename and date. This is search correlation, **not** exact content-URI artifact identity or a viewer handoff.

The generic collection extension does not depend on a package, resource ID or Samsung label: a single exact, non-editable query-valued record within one native collection may provide correlation. History/suggestion containers, editable echoes alone, substring matches, duplicate collections and unchanged old records are negative cases. No result-item click is generated.

Screenshots for the later My Files positive case, Maps, Play, Photos and Coccoc were manually inspected against the claimed states. Play visibly shows the requested query and results, but that visual observation does not replace the missing registered backend predicate. Maps remains at its home search surface; Photos retains the prompt/tooltip covering search; Coccoc retains the unselected default-browser chooser.

Initial clear-failure batch and the earlier positive-result verifier failure are diagnostic attempts, not successful repeatability runs. Their JSON remains separate. No locked-device attempt was counted as a result; the baseline started only after the owner unlocked the device. The later grant-expiry failure is a valid safety failure, not an invalid attempt to omit.

## Planning and Latency

### B1: Singleton Schemas

When the backend offers exactly one primitive and one eligible source slot, the planner constructs that single schema-conforming choice, with source negation, qualified app binding and conservative prior-clause dependencies. It still executes schema parsing, slot ambiguity checks, source reconstruction, destructive/external-effect rejection, outcome validation and capability compilation. Interpretation review remains disabled-by-default for automatic approval. No selector, grant or verifier is model-generated.

Counters are `profiling.singletonClausesSkipped` and `singletonCandidatesSkipped`. Maps, Play, Photos and Coccoc each skipped two singleton planning calls. My Files uses the existing rule path, not an invented two-call saving. `forceModel` is a diagnostic reference path that adds inference while retaining all validators; it does not authorize effects or disable review. Protocol tests use it to keep malformed/foreign model-output rejection assertions exercised.

### B2: Warm-up Parity

The M3d runner warms by invoking the production decomposition/reasoner with the same model, JSON schema format, `num_ctx=2048`, `num_predict=256`, temperature 0 and `keep_alive=10m`, rather than an empty default-context generate request. Warm inference is outside Android task timing and separately recorded.

Baseline per-call load durations (ms), including every call in these paired tasks:

| Task | Warm calls load ms | Actual calls load ms | Actual queue wait ms | Actual reasoning ms |
| --- | --- | --- | --- | ---: |
| My Files | none | none | none | 0 |
| Maps | 10186, 28 | 25, 22 | 1, 0 | 15401 |
| Play | 21, 42 | 16, 17 | 0, 0 | 13907 |

The cold 10.186 s load occurred in warm-up, not the first real Maps call. Both first-real-call assertions passed the explicit `<1000 ms` full-reload detector; small nonzero load bookkeeping remains visible. Optimized Android rows made zero inference calls, so warm/load is **N/A / NO_REAL_INFERENCE**, not a zero-load model benchmark.

### Same-goal Before/After Measurements

Spans overlap: observation includes work inside execution and RPC/ADB measurements overlap those spans. Never sum these columns. Setup/observation/reasoning/execution/verification and end-to-end totals are reported independently. Read-only post-task recon and screenshot collection are excluded from task spans.

| Task / version | Planning | Session | Observation | Reasoning | Execution | Verification | Total | RPC / ADB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| My Files baseline | 511 | 7343 | 15416 | 0 | 16758 | 294 | 33902 | 103 / 74 |
| My Files after, empty start | 435 | 5954 | 12012 | 0 | 12665 | 333 | 26816 | 83 / 65 |
| Maps baseline | 17343 | 5887 | 12483 | 15401 | 9640 | 2 | 42062 | 55 / 51 |
| Maps after | 1562 | 5775 | 11312 | 0 | 8201 | 1 | 23658 | 55 / 51 |
| Play baseline | 15460 | 6111 | 21406 | 13907 | 24840 | 1 | 55055 | 134 / 87 |
| Play after, retained unlabelled input | 1737 | 6288 | 7134 | 0 | 2881 | 1 | 18080 | 42 / 42 |
| Play after manual main-page preparation | 3998 | 7281 | 36642 | 0 | 26947 | 2018 | 68946 | 161 / 113 |

Same USB, device, goal values and explicit interpretation approvals; no concurrent build/lint or other acceptance Session. Starting UI states and successful/blocked work differ, so these are **not** controlled end-to-end throughput speedups. The Play early block is not a performance improvement. Later My Files latency spikes caused a genuine grant-expiry block; TTL was not extended and required readiness/fresh-state checks were not removed.

Baseline sampled Ollama+llama working-set peaks: Maps 1975.9 MiB, Play 1887.7 MiB. Optimized no-inference rows sampled roughly 13-27 MiB for the remaining server/app processes; this is not the loaded model's inference footprint. Measurements aggregate all matching Ollama/llama processes. Raw JSON includes RPC/source/element/ADB durations, parse counts, all actual reasoning/load/queue measurements and per-task memory peak.

### B3: Snapshot Epoch Work

Candidate revalidation reuses its already-generated first candidate page within the same immutable observation, instead of regenerating it just to walk page zero again. Existing one-use, <=1 s post-action observation carry remains, with an independent fresh native observation before every dispatch. No cache crosses a mutation, permission wait, changed foreground or stale epoch.

This is a bounded CPU-work reduction, not proof of fewer backend calls. Additional page-source/ADB RPC caching is **NOT_IMPLEMENTED** in this change: measurements do not justify removing or reusing identity, readiness or dispatch checks. Maps RPC/ADB counts remained 55/51. No general RPC or end-to-end speedup is claimed.

## Development Fixture Comparison

Both runs used final runtime hash `0ba57fb4e600...`, the unchanged 20-case DEVELOPMENT fixture, qwen2.5:3b-instruct, ctx 2048, exact production JSON format/options and separate production-call warm-up. No Android task, build or lint ran concurrently.

| Measurement | Forced-model reference | Optimized singleton path |
| --- | ---: | ---: |
| Valid faithful/executable | 15/15 | 15/15 |
| Invalid rejected | 5/5 | 5/5 |
| False acceptances | 0 | 0 |
| Actual case model calls | 20 | 0 |
| Singleton clauses skipped | 0 | 20 |
| Sum of case elapsed times, warm-up excluded | 197293 ms | 239 ms |
| Sum of case reasoning spans | 196498 ms | 0 ms |
| Separate warm-call load duration | 17996 ms | 48 ms |
| Sampled Ollama+llama working-set peak | 1889.1 MiB | 1862.8 MiB |
| Classification | REAL_MODEL_SIMULATED_UI | OFFLINE_TESTED (warm-up separately calls real model) |

This is removal of unnecessary inference for this singleton DEVELOPMENT set, not a 0.239 s general-purpose Android agent or a measured speedup for ambiguous/model-dependent clauses. App discovery, Session setup, observation, dispatch and verification remain outside this planner-only comparison. Both runs still warmed a loaded model; the optimized Android path need not load a model when no inference is needed.

Every reference case call's load duration (ms) is listed here; optimized cases have no calls. Three unsupported negatives are rejected before inference.

| Case | Reference load ms in call order | Queue wait ms | Optimized skipped clauses |
| --- | --- | --- | ---: |
| D01 | 97 | 2 | 1 |
| D02 | 36 | 0 | 1 |
| D03 | 33 | 1 | 1 |
| D04 | 171 | 4 | 1 |
| D05 | 197 | 4 | 1 |
| D06 | 157 | 1 | 1 |
| D07 | 37 | 0 | 1 |
| D08 | 29 | 1 | 1 |
| D09 | 23 | 0 | 1 |
| D10 | 39, 20 | 0, 0 | 2 |
| D11 | 59, 120 | 0, 1 | 2 |
| D12 | 217, 101 | 1, 0 | 2 |
| D13 | 60 | 1 | 1 |
| D14 | 71 | 2 | 1 |
| D15 | 121 | 1 | 1 |
| X01 | 49 | 5 | 1 |
| X02 | 39 | 1 | 1 |
| X03-X05 | none | none | 0 |

The first real reference call loaded in 97 ms, not another full model reload; every subsequent case call was <=217 ms. Source hash was unchanged during each run. Evidence: `agent-v2-m2b-1792478244002.json` (reference), `agent-v2-m2b-1792478604482.json` (optimized), both in OS TEMP. Fixture contents were not changed. Validator outcomes and expected exact bindings are unchanged across all 20 cases. No sealed data is involved.

## Validation

- Full regression: **467/467 PASS**, no skipped tests.
- TypeScript: **PASS** (`tsc --noEmit`).
- Scoped ESLint across all files edited in this request: **PASS**, no warnings/errors.
- Full ESLint: **FAIL, existing unrelated issue** at `components/executions/ExecutionDetailModal.tsx:130:98`, `@typescript-eslint/no-explicit-any`, plus 9 existing unused-import warnings. This file was not edited to conceal the failure. Log: `m3d-full-eslint.log` in OS TEMP.
- Production `next build --webpack`: **PASS, actual child exit code 0**. Compile, TypeScript, static generation and route collection completed. Known nonblocking `module.createRequire failed parsing argument` warnings remain in Session-manager imports. The first PowerShell invocation treated warning stderr as a shell failure; a Node child-process wrapper reran the same build and captured its real exit code. Verified log: `m3d-build-verified.log` in OS TEMP.
- `git diff --check`: **PASS**, exit 0; Git emitted line-ending conversion notices, not whitespace failures.
- Dashboard typed state and current-device screenshot link: **OFFLINE_TESTED**, SSR assertions; live interactive Dashboard resume is **UNVERIFIED** in this request.

Final cleanup: **0 active runtime tasks, 0 owner modes, 0 device ownership records**. All **25 distinct acceptance execution Session IDs** retained across these batches returned `invalid session id` on read-only timeout probes. Post-task recon Sessions also completed their awaited close paths before their batch results were written. Appium 3's global `/appium/sessions` enumeration is intentionally denied because `session_discovery` is not enabled; a global count across unrelated clients is **UNVERIFIED**, not falsely reported as zero. No insecure feature was enabled. Evidence: `m3d-final-cleanup.json` in OS TEMP. Final Android runtime hash remains `0ba57fb4e60042bafa7bede033ce080dbfc690d46df877f48d2aafc2f063c5e0`.

## Scope and Remaining Limits

**NOT_IMPLEMENTED:** general SET_VALUE/SELECT_ITEM/READ_VALUE/CONFIRM executors and their missing scope/verifier contracts; M5; broad RPC cache changes; general hit-test/z-order evidence for fully overlapping native controls; unlabelled non-editable post-submit query-header binding.

**UNVERIFIED:** a second-app positive result; Maps completion; Play final result verification; Photos search; user-driven live Dashboard resume after a consent prompt; generalization to arbitrary new verbs/apps; sealed-cohort accuracy. A hardening condition passing offline does not retroactively certify an earlier Android hash.

No result was opened, no consent accepted/declined on Android, no browser default changed, no app installed/uninstalled, no data deleted or replaced, and no new media/record created. SEARCH edits were scoped to observed search fields only. V1 remains default; owner mode remains device-specific and opt-in; auto-review remains disabled.

## Files Changed in This Request

- Android: `activation-point.ts`, `targets.ts`, `state-observer.ts`, `grounded-interactions.ts`.
- Agent: `generic-search.ts`, `search-user-action.ts`, `search-executor.ts`, `primitive-decomposition.ts`, `read-only-verifiers.ts`, `grounded-candidates-v2.ts`, `ui-affordances.ts`, `goal-graph.ts`, `budget.ts`, `agent-v2.ts`.
- Dashboard: `components/commands/AgentGoalPanel.tsx`.
- Runners: `scripts/agent-v2-m3d-evaluation.cjs`, `agent-v2-m3d-recon.cjs`, `agent-v2-m2b-evaluation.cjs`, `agent-v2-acceptance.cjs`.
- Tests: new `general-agent-v2-m3d.test.cjs` and `fixtures/search-protocol.cjs`; existing M2b/M3c/search/reliability/discovery-execution fixtures updated to issue the stricter entry/clear receipts. `tests/fixtures/agent-v2-m2b-development.cjs` unchanged.
- This report. Other pre-existing changes remain untouched.
