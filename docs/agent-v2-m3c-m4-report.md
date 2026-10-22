# Agent V2 M3c / M4: grounded search recovery and paired Android measurements

## Scope and Classification

Branch `DuyTD`; no commit/push. Existing uncommitted work is preserved. The previous M2b/M3b report was read before implementation. The sealed cohort was not opened, decrypted, imported, or used. No M5 work.

This report distinguishes **OFFLINE_TESTED**, **REAL_ANDROID**, **REAL_MODEL_SIMULATED_UI**, **NOT_IMPLEMENTED**, and **UNVERIFIED**. A runtime BLOCKED result is **SAFE_BLOCKED**, never completed. No new real-model simulated-UI planning accuracy gate was claimed; the earlier 15/15 fixture remains DEVELOPMENT data.

**Overall verdict: PARTIAL, not full real-device acceptance.** The new generic contracts pass offline tests. Drive search is REAL_ANDROID verified. The other four final goals remain SAFE_BLOCKED. Strict warm-to-warm latency acceptance is UNVERIFIED because subsequent model loads were still observed. No speedup claim. V1 remains the default, V2 opt-in, and interpretation auto-review remains disabled.

## Generic Root Causes and Changes

### A1: Issued NOT_SENT receipts and bounded re-grounding

`effect-grants.ts` retains the **5000 ms** TTL. Expiration now has a typed `EffectGrantExpired` error. A weak process-local issuance ledger distinguishes authentic immutable grants from copied objects.

`grounded-interactions.ts` records a frozen failure plus a weak, single-use NOT_SENT receipt only at the actual executor boundary, before any mutation RPC has been sent. The receipt is bound by object identity to the issued grant/candidate and therefore execution, device, Session, and node. The consumer rejects unknown, acknowledged, foreign, cloned, expired, reused, or fabricated failures. Error strings alone are not a retry authorization.

`search-executor.ts` can consume that receipt once for `GRANT_EXPIRED` or `TARGET_CHANGED`, spend the existing retry/replan budgets, discard the old selection, re-observe, re-ground and issue a new single-use grant on the next iteration. Each attempt spends a step and time budget. `REGROUND_NOT_SENT` is emitted with a typed diagnostic. A second expiration, UNKNOWN reply, or acknowledged effect cannot trigger another replay. Revocation/owner checks still apply when the next grant is issued.

**OFFLINE_TESTED:** expiration then a new grant succeeds; repeated expiration stops after one renewal; TTL unchanged; UNKNOWN is not replayed; cloned/foreign/forged receipts rejected; authentic receipt single-use. **UNVERIFIED on real Android:** a successful expired-grant renewal was not forced by artificial delay on the phone.

### A2: Activation before search editing

A native editable class is no longer sufficient to dispatch search SET_VALUE. An unfocused field first offers a separately issued READ FOCUS/CLICK candidate. A fresh independent native observation must show exactly one focused search editable, either the activated identity or a distinct newly appeared search input. Unchanged focus and multiple editables fail the transition. Only then does a new ENTER candidate/grant authorize the exact user query. The executor independently requires native focus before SET_VALUE and retains exact text/password checks and readback.

Focused inputs can use the direct-settable path. `invalid element state` after dispatch is UNKNOWN, not a signal to repeat input. Failed activation sends no clear/value RPC. These changes apply to the scoped search contract, not a newly implemented general SET_VALUE user-goal executor.

**OFFLINE_TESTED:** focused/direct input, separate activation then ENTER grant, no-change activation, ambiguous inputs, distinct focused input, invalid-element-state no replay. Existing live-search test assertions are unchanged; its simulated before-typing fixture now explicitly supplies `focused: true` to satisfy the stronger activation precondition. No expected rejection/success assertion was removed or weakened.

### A3: Structural navigation to search

The semantic affordance layer can associate a unique observed search label with its clickable native owner. Evidence includes native navigation/checkable roles or a non-scrolling group of 2-8 same-class selectable peers with exactly one active selection. A unique descendant search label is required; nested clickable actions, duplicate visible labels, scrolling result collections, sensitivity and destructive controls are excluded. No app, package, target label from a fixture, ordinal coordinate, or workflow is encoded.

Search OPEN/MENU hops spend the existing bounded exploration budget, track attempted target/phase keys, and require an independent search-entry/editable transition. A search action inside an observed overflow menu takes priority over dismissing that menu. Opening a tab/menu never verifies the parent SEARCH goal; its existing query/result outcome verifier remains mandatory. Missing affordances or duplicate/looping targets remain blocked.

Real Play recon exposed a second generic issue: an unlabeled clickable item and a non-clickable decoration had identical package/class/bounds. The old fallback XPath matched both. `StateObserver.selectorForNode` now also constrains the **observed clickable attribute** in the fallback selector. This strengthens exact identity; the requirement for exactly one match, displayed/enabled state, geometry and occlusion checks is unchanged. Unique accessibility-ID/resource-ID paths remain as before.

**OFFLINE_TESTED:** bottom navigation, unlabeled selectable peers, overflow menu, independent search appearance, missing affordance, no-change/duplicate loop denial, duplicate label and nested-action denial, exact clickable-vs-decoration identity. Real outcomes are reported separately below.

Follow-up recon demonstrated a collapsed search surface without an EditText. The generic contract now recognizes a unique direct non-clickable TextView search placeholder owned by a clickable native container **outside scrolling/result collections**. Geometry and unique native element checks still govern activation; nested microphone controls are not selected as arbitrary alternatives. A new collapsed surface can acknowledge a prior navigation hop, but cannot acknowledge its own unchanged activation or complete SEARCH. Duplicate placeholders and result titles are negative test cases.

### M4: Conservative latency changes

- A just-returned post-action native observation may serve the next selection epoch **once**, only within 1000 ms. Device readiness, observation device/status/timestamp validation remain. Every actual dispatch still obtains an independent fresh native observation and revalidates grants/targets. It is not a cache across mutations or a way to count one snapshot as two stable observations.
- Structured Ollama requests retain temperature 0, context 2048 and output limit 256, with explicit `keep_alive: 10m`. No model download or default context/output increase.
- The controlled runner warms the model before Session work, preserves literal multiword argv via Node spawn, samples all `ollama*`/`llama*` processes, and captures screenshots plus frozen source hashes. Baseline and after use the same warmup procedure and task wording. Warmup time is reported separately, not hidden inside Session setup.
- Existing singleton search-candidate selection already skipped inference; that behavior remains tested. No guessed choice or compressed-away safety evidence was introduced. No unmeasured next-action prompt pruning, speculative Session overlap, or broad snapshot caching was added.

Measurements are paired observations, **not a claimed causal speedup**. Search outcomes and starting app states can differ; failed/blocked durations are not time-to-success. Empty-prompt model-load warmup is not a promise of zero subsequent load time; context preparation, paging and CPU contention from the shared 8 GB system can still appear in inference spans. No build/lint ran concurrently with the measured Android batches.

## Controlled Device Procedure

Samsung A50s / SM-A507FN, selected verified Wi-Fi transport `192.168.1.17:33081`; USB also present but never used concurrently for a second Session. Appium 3.8.0 ready, device awake/unlocked, Ollama available. Each task uses one Session and owner mode scoped to the physical device; cleanup is in `finally`. Native app launches, search entry/submission and observation only. No deletion, overwrite, installation, uninstallation, settings change or result/item opening.

Baseline was re-measured on the unchanged starting source, not copied from the historical report. Three baseline cases were valid non-aborted attempts. The original My Files app retained the earlier exact query/empty result, so this stricter repeatability case blocks both before and after rather than inheriting its historical PASS.

Maps and Play retained the exact previously approved interpretations. The owner also explicitly approved two new read-only tasks: Photos searching `20261019_154525.jpg` without opening an image, and Drive searching `coastal research archive` without opening a result. Approval is forwarded only when the Agent's offered full summary exactly matches it; auto-review stays off.

### Independent Positive-Result Oracle

Before running Photos, read-only ADB MediaStore query confirmed image row `_id=2248`, `_display_name=20261019_154525.jpg`, `date_added=1792399531`. No image bytes were read or transmitted for that oracle, no new photo was taken and no content URI was opened. The provider result proves local existence, not that Photos indexes or can search that filename. Photos presented a Gemini consent/settings screen. The Agent did not accept/decline consent or change settings. Therefore positive search-result correlation is **UNVERIFIED**, not a positive-result PASS.

The first metadata query with a remote sort argument was malformed by shell argument handling and returned usage only. It was replaced by a successful query and then a narrow `_id=2248` query before the run. This was an observation setup error, not an Android outcome or a mutation.

## Offline Validation

- Full regression after the final runtime change: **447/447 PASS** (437 prior + 10 new M3c tests), 42124.58 ms.
- TypeScript: PASS.
- Scoped ESLint: PASS on the changed files checked before acceptance; final full-scope check recorded below.
- No existing test assertion was loosened. A new duplicate-label test initially placed its second label outside the parent's visible clip; the fixture bounds were corrected so the negative test actually represented two visible labels. Its rejection expectation remained unchanged.
- New tests exercise real grant/executor functions with simulated native transports; they are OFFLINE_TESTED, not Android E2E.

## Frozen Batches and Final Results

Every measured batch checked its sorted `lib/android/**/*.ts` SHA-256 before and after; `unchanged=true`. Runtime was edited only between batches. Intermediate checkpoints are development evidence, not silent replacements for baseline failures.

| Batch | Runtime SHA-256 | Purpose |
| --- | --- | --- |
| Baseline | `2fa673a9e79eb5c82033730bcad2c02d937b765daf206a36f834c6db87981f3b` | Starting source, same three original tasks |
| Development 1 | `97ff140013c0b12af412bb61d727b41819f202b13bde547c016455258a81f3a9` | Initial receipt/activation/structural changes; Play still lacked the selected-peer evidence |
| Development 2 | `72b14b4e11707a86a604686fe99950f0059422e6732ff1cbe3b9815916659b22` | Selected-peer support; duplicate native selector still blocked Play |
| Development 3 | `b1198370889af26262bb8bc3fa1212ba3b51f8232d85c92326d1cf09ac397a19` | Clickable selector identity; Play opened its search tab but the collapsed-surface transition was not yet recognized |
| Final | `bf3d5a3620f4e799d42601ddae9eedc877f0060d1c944124a96b13d83789fb70` | Final collapsed-surface contract; five final tasks |

The final hash was checked again after all device work and matched. Baseline and final case attempts were not invalid CLI/aborted/locked cases. Earlier development batches are excluded from the final outcome and paired latency tables; they are listed rather than hidden. A separate repeated Play probe plus observation-only recon established the collapsed surface; that diagnostic probe is also excluded from the paired table.

### Final Real Android Outcome Table

| Case / exact goal | Final execution | Verdict and evidence | Screenshot comparison / false-completion check |
| --- | --- | --- | --- |
| `Mo com.sec.android.app.myfiles va tim fieldwork-notes-2026-zqx` | `0dec2fba-5535-4217-a0ba-794149c230d3` | REAL_ANDROID / SAFE_BLOCKED: `UNCHANGED_RESULT_WITHOUT_QUERY_APPLICATION_EVIDENCE`; foreground verified, but unchanged old body fails the application/commit contract | Exact old query and explicit empty state are visible. They do not prove this execution applied a fresh search; no completion asserted |
| `Xin ghe com.google.android.apps.maps roi do "public libraries"` | `d35611a6-0d42-4f97-9f6a-1a0314999e01` | REAL_ANDROID / SAFE_BLOCKED: NOT_SENT / TARGET_LOCATE; no activation click sent | Maps home remains visible, no query/results. Recon identified a large clickable map/background view covering the activation center according to the existing occlusion validator. That validator was not bypassed |
| `Xin ghe com.android.vending roi do "ocean sounds"` | `3f87a5fe-88e2-4e64-99e5-7e4fa34e7c70` | REAL_ANDROID / SAFE_BLOCKED: ACKNOWLEDGED / TRANSITION_UNVERIFIED; no replay | Native search navigation/entry can now be activated. Final screenshot shows search-input UI and keyboard, but no `ocean sounds` query. Backend could not establish its required unique semantic search editable after activation. Keyboard appearance alone is not a verified input or result |
| `Xin truy cap com.google.android.apps.photos va loc "20261019_154525.jpg"` | `0952779b-df0e-43d4-b49d-b5f75298068f` | REAL_ANDROID / SAFE_BLOCKED: no authorized search affordance on consent UI | Gemini enable/decline consent screen remains unchanged. Neither option was pressed. Local oracle exists, but positive result matching is UNVERIFIED |
| `Xin truy cap com.google.android.apps.docs va loc "coastal research archive"` | `7878d322-8361-46b2-8c2b-1eab0c97246d` | REAL_ANDROID / VERIFIED: COMPLETED / NO_RESULTS; `FOREGROUND_IS`, acknowledged `EXPLICIT_RPC` submit, exact query echo and `SEARCH_OUTCOME_MATCHES` / `EXPLICIT_EMPTY_STATE` | Full query plus an independent explicit no-matching-results message visible; no result/file opened. This is an empty-result PASS, not positive-result PASS |

Manual screenshot inspection covered all five final cases and all three baseline cases. None of the four blocked cases was reclassified based on screenshots alone. Drive was also verified in earlier development batches, including a native SET_VALUE path; the final repeat can reuse already rendered query UI and is not additional proof of every activation branch.

**Per-gap real closure:** A1 is OFFLINE_TESTED, successful real expired-grant renewal remains UNVERIFIED. A2 is OFFLINE_TESTED; a native direct-edit/search path was exercised on Drive, but Maps activation and Play semantic-input confirmation remain blocked. A3 now issues native structural navigation and collapsed-entry candidates and real Play clicks progress farther; complete Play search is still UNVERIFIED. No claim that all three gaps are fully closed on real devices.

### Paired Measured Spans

All values below are ms except counts and RAM. `B -> A` means newly measured baseline to the final after batch, with identical request wording and the same selected device. **Spans overlap; do not sum them.** Planning includes inference; execution may include observation/RPC; source/element RPCs are subsets of total RPC time.

| Measurement | My Files B -> A | Maps B -> A | Play B -> A |
| --- | ---: | ---: | ---: |
| Total task wall | 46960 -> 42240 | 54605 -> 51783 | 44978 -> 59669 |
| Planning | 578 -> 482 | 30575 -> 28336 | 25257 -> 24563 |
| Session setup | 6909 -> 6535 | 7513 -> 6796 | 6220 -> 6109 |
| Observation | 27436 -> 23434 | 11799 -> 11496 | 9233 -> 19793 |
| Inference | 0 -> 0 | 29063 -> 26568 | 23417 -> 22987 |
| Execution | 15150.41 -> 11976.59 | 8637.46 -> 8105.52 | 3371.33 -> 19804.30 |
| Verification | 2117.30 -> 2435.67 | 2 -> 1 | 1 -> 1 |
| Human-assistance span | 0 -> 0 | 417 -> 595 | 1045 -> 496 |
| RPC count | 162 -> 156 | 61 -> 55 | 42 -> 112 |
| RPC time | 28195.89 -> 24340.08 | 15344.67 -> 14449.92 | 13877.69 -> 22286.44 |
| Source RPC time (subset) | 7108.92 -> 6496.20 | 4633.69 -> 5556.65 | 4414.59 -> 7150.14 |
| Element RPC time (subset) | 702.10 -> 540.60 | 672.40 -> 0 | 0 -> 3114.70 |
| ADB count | 126 -> 125 | 51 -> 51 | 42 -> 77 |
| ADB time | 17345.93 -> 16397.53 | 8368.62 -> 7384.02 | 5868.09 -> 10070.60 |
| Warm-up outside task wall | 11233 -> 10137 | 178 -> 207 | 8761 -> 8584 |
| Ollama + llama sampled peak MiB | 1890.81 -> 1598.64 | 1970.65 -> 1965.54 | 2007.96 -> 2009.34 |

This does **not** prove faster successful searching. My Files blocks in both runs; Maps after stops before input whereas baseline attempted an invalid input; Play after performs more real navigation and waits for evidence rather than stopping at missing candidates. App/network state and result/advertisement bodies are not identical between runs. One pair per task is not a statistical benchmark.

**Warmness limitation:** an empty-prompt generate request completed before each task, but the first inference still recorded substantial loads: baseline Maps/Play 10256/7592 ms; final Maps/Play 9579/7607 ms. Later calls in the same task loaded in tens of ms. The runner did not establish an identical inference-context warm state across the initial generate/chat transition. Consequently the requested strict warm-to-warm latency validation is **UNVERIFIED**, despite the recorded paired observations. Do not subtract loads or present these figures as a clean optimization speedup. No larger model/context was selected to mask this.

Inference queue waits were approximately 0-1 ms per clause in the paired tasks: queueing is not the observed long planning bottleneck. Load plus CPU inference remains significant on this shared-memory system.

### New-App Measurements

| Span / count | Photos | Drive |
| --- | ---: | ---: |
| Total wall | 43155 | 55062 |
| Planning | 27500 | 25881 |
| Session setup | 6462 | 6970 |
| Observation | 6053 | 11880 |
| Inference | 26264 | 24307 |
| Execution | 3385.03 | 14364.91 |
| Verification | 1 | 215.62 |
| RPC count / time | 42 / 9919.10 | 78 / 17500.79 |
| ADB count / time | 42 / 5914.22 | 61 / 10675.19 |
| Warm-up outside task wall | 8008 | 8016 |
| Ollama + llama sampled peak MiB | 2006.70 | 2013.02 |

RAM sampling sums all process names starting with `ollama` or `llama`, scheduled every 3 seconds with overlapping samples suppressed. It is a best-effort resident working-set sample, not an instantaneous allocation peak, GPU VRAM, or total system usage. The final five-task sampled peak was **2013.02 MiB**, baseline three-task peak **2007.96 MiB**. The rest of the nominal 8 GB is shared with Windows, browsers, Next.js, Appium and caches. Lower resident working set can reflect paging; it does not establish that the model needs less RAM. No causal memory improvement is claimed.

## Final Validation and Cleanup

- **OFFLINE_TESTED:** full regression 447/447; TypeScript PASS; final scoped ESLint PASS across all files changed in this request.
- Full ESLint retains the known unrelated `components/executions/ExecutionDetailModal.tsx:130` no-explicit-any error and 9 unused-variable warnings. Not hidden or fixed by changing tests.
- `next build --webpack`: PASS, compilation 14.8 s, build TypeScript 16.3 s, static page generation 7.5 s. These are component spans, not summed wall time. Existing dynamic `module.createRequire` warnings remain.
- `git diff --check`: PASS, line-ending warnings only. This command does not inspect untracked files.
- **REAL_ANDROID cleanup:** 0 active tasks and 0 owner modes. All five final Session timeout endpoints returned HTTP 404 / `invalid session id`, confirming closure. Recon scripts closed their single Session in `finally` and exited successfully. No two Sessions were intentionally active concurrently.
- No settings change, new image, record creation, deletion, install, uninstall, or result/item opening. The photo oracle and UI screenshots are read-only observations.
- No browser Dashboard acceptance was requested/measured here: UNVERIFIED, not a browser E2E claim. V1 default and V2 opt-in unchanged. No commit/push.

## Files Changed in This Request

Runtime: `lib/android/agent/effect-grants.ts`, `lib/android/grounded-interactions.ts`, `lib/android/agent/ui-affordances.ts`, `lib/android/agent/generic-search.ts`, `lib/android/agent/search-executor.ts`, `lib/android/agent/agent-v2.ts`, `lib/android/agent/ollama.ts`, `lib/android/state-observer.ts`.

Tests/runners: new `tests/general-agent-v2-m3c.test.cjs`, new `tests/fixtures/agent-v2-m3c-readonly.json`, new `scripts/agent-v2-m3c-evaluation.cjs`, new `scripts/agent-v2-m3c-recon.cjs`; one focused-input fixture in `tests/general-agent-v2-search-reliability.test.cjs`. This report is new. Other pre-existing dirty files were left untouched.

## Evidence Index and Remaining Work

Raw evidence stays in the OS temporary directory, not Git. Files can contain private UI state; screenshots/native hierarchies were not copied into repository docs.

- `agent-v2-m3c-baseline-2fa673a9e79e.json`: valid baseline three tasks, full events, timings, RAM and screenshots.
- `agent-v2-m3c-after-97ff140013c0.json`, `agent-v2-m3c-after-72b14b4e1170.json`, `agent-v2-m3c-after-b1198370889a.json`: development checkpoints, not final runtime acceptance.
- `agent-v2-m3c-after-bf3d5a3620f4.json`: final five tasks and unchanged hash.
- `m3c-after-<case>-<executionId>.jpg`: screenshots matching the final execution IDs in the outcome table.
- `m3c-recon-1792436003209.json`: initial Maps/Play/Photos native recon, including selected peers and Maps occlusion evidence.
- `m3c-recon-1792450358153.json`: launch/read-only Play recon; launching returned to a different route, so it was not used as proof of the prior post-click surface.
- `v2-acceptance-cae6f3a7-87f9-4d7b-aac7-b0748b7a3833.json` and `m3c-recon-1792450504988.json`: separate Play diagnostic probe followed by **observe-only** recon without relaunch, establishing the actual collapsed surface. Not part of paired measurements.
- `m3c-full-tests-final.log`, `m3c-build.log`, `m3c-eslint-full.log`: validation logs.

**NOT_IMPLEMENTED:** general SET_VALUE / SELECT_ITEM / READ_VALUE / CONFIRM user-goal executors and complete authorization/verification contracts; M5. Internal search SET_VALUE/IME is not general arbitrary field editing.

**UNVERIFIED / still blocked:** real successful expired-grant recovery; Maps activation under the existing occlusion proof; Play's unique semantic editable confirmation after a now-acknowledged entry activation; fully repeatable My Files already-rendered same-query application evidence; Photos positive-result correlation without changing consent/settings; strict warm-to-warm speedup; arbitrary unseen verbs/apps; sealed-cohort accuracy.

The next safe improvements require stronger generic native input identity/transition evidence and a corrected, context-matched warm measurement protocol. They must not bypass occlusion, broaden an unknown editable into a search field by guess, extend the TTL, reuse an expired grant, or relabel an unchanged old result as newly verified. Work stops at this report; no M5 or silent SUCCESS conversion.
