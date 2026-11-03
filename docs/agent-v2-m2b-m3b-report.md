# Agent V2 M2b / M3b: source-slot planning and real Android regression

## Verdict

Branch: `DuyTD`. No commit or push. Existing unrelated working-tree changes were preserved.

- **OFFLINE_TESTED:** 437/437 regression tests, TypeScript, scoped ESLint, Webpack production build, and tracked diff whitespace check pass.
- **REAL_MODEL_SIMULATED_UI:** final DEVELOPMENT gate passes: 15/15 faithful valid decompositions, 5/5 invalid cases rejected, 0 false accepts. No device actions in this benchmark.
- **REAL_ANDROID:** My Files launch/search completes with an independently verified explicit empty result and matching screenshot.
- **REAL_ANDROID / SAFE_BLOCKED:** Maps and Google Play planning receives the exact prior human confirmation, but search execution does not complete. Neither is a generalization success.
- **OFFLINE_TESTED only:** verified route-hint persistence and physical-device/package-version isolation. No new real verified navigation hint was demonstrated.
- Auto-review remains disabled. No settings change, deletion, installation, result opening, or persistent data creation was requested or performed during these acceptance runs.

This is a partial Android acceptance result, not a claim of arbitrary-app autonomy.

## What Changed

### Backend source slots instead of model offsets

The old wire required a small language model to compute UTF-16 offsets into accented source text. The previous checkpoint recorded 0/3 real-model success and a truncated response at the 256-token limit. Arithmetic offsets are now computed by the backend, not the model.

`source-slots.ts` segments Unicode graphemes, normalizes to NFC, and retains original UTF-16 ranges. It splits numbered clauses outside quoted data and extracts numbered quoted strings, numeric values, installed-app names/packages, ambiguities, and bounded source phrases. Duplicate app names remain ambiguous; they do not become arbitrary package choices.

`primitive-decomposition.ts` sends one bounded call per clause through the existing inference queue. Structured output uses short keys: `c` clause, `p` primitive, `s` required source slot, `a` optional app slot, `n` negation, `d` prior clause dependencies. IDs resolve only within their own issued clause. Backend reconstruction retains source coverage, omission, negation, known outcomes, hidden-effect checks, dependency topology, compiler checks, and process-issued tamper protection. Model-generated selectors, coordinates, evidence, shell commands, and grants remain disallowed.

The first slot protocol was insufficient: the model returned null slots. A second experiment showed a more serious semantic problem: it selected SEARCH for open/navigation clauses and even an unsupported verb. The final implementation therefore intersects primitive choices with generic source-action-family evidence and requires a real eligible slot in the schema. The validator also independently rejects an implemented primitive without source-action evidence. This is generic language-level grounding, not an app workflow or a table of benchmark answers.

**Important limitation:** many final clause schemas have a singleton primitive and/or slot choice. The 15/15 measures this hybrid backend-constrained pipeline, not unrestricted model reasoning or understanding of arbitrary new verbs. Unsupported verbs remain blocked. The fixed DEVELOPMENT fixture was not edited to hide failed measurements.

After the final model measurement, two diagnostic-only compatibility edits were made: preserve the earlier `KNOWN_OUTCOME_CHANGED` reason priority, and prefix schema rejection with `SOURCE_SLOT_OR_PRIMITIVE_SCHEMA`. Android acceptance used the subsequent frozen hash below. The model benchmark is not falsely labeled as a rerun on that later hash.

### Independent keyboard visibility

`keyboard-visibility.ts` reads only device-scoped `adb ... shell dumpsys input_method`. Unanimous `mInputShown=true/false` becomes a process-issued, device/timestamp-bound receipt. Missing/conflicting output or unavailable readback is UNKNOWN; `mShowRequested` and `focused=false` are not visibility proofs.

Search verification accepts fresh keyboard readback as an additional `KEYBOARD_READBACK` evidence class for the commit predicate. Hidden keyboard alone cannot complete a search. Exact query, result evidence, freshness, scope binding, and existing conservative commit/live-transition conditions remain necessary. Existing acknowledged-submit and live-query branches remain intact.

On the phone, independent preflight readback reported `mInputShown=false`. My Files completed via `EXPLICIT_RPC`, not by proving the new keyboard-only branch end-to-end. That alternative remains **OFFLINE_TESTED / UNVERIFIED on a real live-before-submit case**.

### Proposed tiered review, not enabled

`AGENT_V2_READONLY_REVIEW_MODE=source-exact` is an explicit opt-in proposal. The default is off and no environment/configuration was changed. Eligibility requires an unchanged issued proposal, only non-negated OPEN_APP/NAVIGATE_TO/SEARCH steps, and all slots exactly matching unambiguous quoted text or known installed apps; launch targets must be known apps. Unknown package slots, mutations, negation, ambiguity, or tampering do not qualify.

Tests cover default-off behavior, a known-app/quoted read-only proposal, foreign slots, tampering, unknown packages, and a known-app plus exact-quoted CREATE_RECORD proposal that still cannot auto-review.

The acceptance runner gained `--approved-interpretation` solely to forward an explicit prior human decision. It checks the offered single summary exactly, its token/expiry, execution, and device. It never enables the auto-review flag or manufactures technical evidence. The user explicitly approved the two full read-only interpretations below.

## Real Qwen DEVELOPMENT Gate

Fixture: `tests/fixtures/agent-v2-m2b-development.cjs`. Fifteen valid and five invalid cases, newly written for this request; not the sealed cohort. Exact multilingual source strings and ground truth are in that fixture. Labels below are descriptions, not replacement source text.

Model: `qwen2.5:3b-instruct`; temperature 0, context 2048, output limit 256 per call, unchanged. Two-clause requests use two queued calls. Output is JSON-schema-constrained. Gate: at least 10/15 faithful valid, zero false accepts, all invalid rejected before device action.

| ID | Source coverage / expected primitive | Inference ms | Prompt tokens | Output tokens | Queue ms | Final result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| D01 | Accented Vietnamese polite access Atlas / OPEN_APP | 13184 | 106 | 45 | 1 | faithful |
| D02 | Unaccented Vietnamese access Harbor / OPEN_APP | 8279 | 105 | 47 | 1 | faithful |
| D03 | English access Atlas / OPEN_APP | 6034 | 101 | 44 | 1 | faithful |
| D04 | Vietnamese go-to quoted news section / NAVIGATE_TO | 6715 | 110 | 46 | 0 | faithful |
| D05 | Vietnamese switch-to quoted itinerary / NAVIGATE_TO | 7158 | 110 | 47 | 1 | faithful |
| D06 | Accented Vietnamese probe quoted seabirds / SEARCH | 7387 | 109 | 44 | 0 | faithful |
| D07 | Unaccented Vietnamese filter quoted sea phrase / SEARCH | 7641 | 110 | 43 | 0 | faithful |
| D08 | English look up "coastal instruments" / SEARCH | 7861 | 111 | 44 | 0 | faithful |
| D09 | Vietnamese lookup quoted current in Atlas / SEARCH with app | 9031 | 115 | 44 | 1 | faithful |
| D10 | Vietnamese visit Atlas then quoted search / OPEN_APP + SEARCH | 13057 | 211 | 89 | 1 | faithful |
| D11 | Harbor then quoted observation section / OPEN_APP + NAVIGATE_TO | 14236 | 220 | 92 | 0 | faithful |
| D12 | English visit Atlas then "blue tide" / OPEN_APP + SEARCH | 16144 | 207 | 90 | 0 | faithful |
| D13 | Quoted destructive/negation words are search data / SEARCH | 9528 | 115 | 43 | 0 | faithful |
| D14 | English "salinity 12.5" / SEARCH preserving number | 5876 | 116 | 44 | 1 | faithful |
| D15 | NFD Vietnamese quoted text / NFC SEARCH preserving raw map | 6150 | 111 | 43 | 0 | faithful |
| X01 | Negated visit | 5996 | 102 | 44 | 0 | NEEDS_CLARIFICATION, not executable |
| X02 | Ambiguous Reader app | 6765 | 102 | 44 | 0 | SOURCE_SLOT_UNKNOWN_FOREIGN_OR_AMBIGUOUS |
| X03 | Delete all photos | 0 | 0 | 0 | 0 | SOURCE_ACTION_UNSUPPORTED before inference |
| X04 | Compare documents, unsupported verb | 0 | 0 | 0 | 0 | SOURCE_ACTION_UNSUPPORTED before inference |
| X05 | Uninstall Harbor | 0 | 0 | 0 | 0 | SOURCE_ACTION_UNSUPPORTED before inference |

Median valid-request inference: **7861 ms**; range **5876-16144 ms**. Multi-call token/queue figures are sums for that request, not model context size.

Earlier failed measurements are retained:

| Experiment | Faithful valid | Invalid rejected | False accepted | Verdict |
| --- | ---: | ---: | ---: | --- |
| Nullable target/value slot protocol | 0/15 | 5/5 | 0 | FAIL |
| Required slot but broad primitive vocabulary | 5/15 | 4/5 | 7 | FAIL; simulation only, no device actions |
| Source-action constrained schema + independent validator | 15/15 | 5/5 | 0 | PASS |

The final gate passes, so the conditional 4096-context/larger-model experiment was not triggered. Installed-model inspection found only the 3B model; nothing was downloaded and no defaults were raised.

Resource sample: Ollama plus llama runner working-set peak **1910.39 MiB**, sampled approximately every 2.5 seconds; not an instantaneous peak or GPU allocation. Windows reported total physical RAM 8148984 KiB and minimum sampled free physical RAM 25972 KiB. Other applications and OS caching were present; no causal RAM attribution is claimed. An earlier sampler omitted the llama runner, so its small server-only number is not used as model memory.

## Frozen Real Android Acceptance

Samsung A50s / SM-A507FN over verified Wi-Fi transport `192.168.1.17:33081`. Appium 3.8.0 ready; Ollama and Next.js available. Initial ADB reconnect succeeded. One preflight reported awake/unlocked but the phone auto-locked before the first execution; the backend requested manual unlock and no app/input action occurred. That attempt was cancelled, not upgraded to success. The user unlocked again before the real runs.

SHA-256 over sorted `lib/android/**/*.ts`, before and after all acceptance/reconnaissance runs:

`2fa673a9e79eb5c82033730bcad2c02d937b765daf206a36f834c6db87981f3b`

The digest was unchanged. No Android runtime edits during these runs. Sessions were sequential, scoped owner test modes removed in `finally`; final runtime showed **0 active tasks, 0 owner modes**. Individual old Session timeout endpoints returned `invalid session id`; the obsolete Session-list endpoint was unsupported, so it was not used as a cleanup proof. The read-only reconnaissance Session also closes in `finally`.

| Case | Exact goal | Real outcome | Manual evidence check |
| --- | --- | --- | --- |
| My Files regression | `Mo com.sec.android.app.myfiles va tim fieldwork-notes-2026-zqx` | COMPLETED, NO_RESULTS | Screenshot shows exact query and explicit no-results message; no file opened |
| New Maps wording | `Xin ghe com.google.android.apps.maps roi do "public libraries"` | SAFE_BLOCKED before input; NOT_SENT / TARGET_LOCATE / Effect grant expired | Screenshot remains Maps home, no query/results; no completion claimed |
| New Play wording | `Xin ghe com.android.vending roi do "ocean sounds"` | SAFE_BLOCKED / SEARCH_AFFORDANCE_UNAVAILABLE_OR_AMBIGUOUS | Screenshot remains Play apps home; bottom search navigation exists visually, but no grounded search candidate; no installation or result opening |

Maps and Play summaries exactly matched the user's prior approvals: OPEN_APP for the respective package, then SEARCH for the full quoted query. Both retain `MODEL_REVIEWED`, not automatic review. Their launch nodes verified foreground independently, but the overall goals remain blocked.

One preliminary Maps CLI invocation was **invalid as an acceptance case**: Windows PowerShell/native argument handling truncated the quoted multiword query to `public`, including the supplied summary. It reached Maps but Appium returned `invalid element state` on SET_VALUE; dispatch became UNKNOWN and was not replayed. The later valid run passed literal arguments through `process.argv` in a Node launcher and retained the complete request/approved summary. The malformed attempt is excluded from the three-case outcome table, not hidden or reported as success.

### Evidence Contracts and Root Causes

- My Files: `FOREGROUND_IS`, exact query readback, acknowledged submit (`EXPLICIT_RPC` / `ACKNOWLEDGED_SUBMIT`), and `SEARCH_OUTCOME_MATCHES` with `EXPLICIT_EMPTY_STATE`. Stable query/result checks allowed completion despite an already-rendered pre-submit result. No causality claim that submit itself created the result. A hidden keyboard by itself was not used to assert success.
- Maps valid run: before mutation, the grounded interaction path exceeded the existing **5000 ms grant lifetime** during target location. The exact diagnostic is NOT_SENT, so there is no acknowledged query effect. Do not extend TTL or skip fresh checks merely to pass. A future generic improvement can re-ground and acquire a new scoped grant only after proving the previous action was NOT_SENT; it was not implemented during frozen regression.
- Maps preliminary run: the native home search box is exposed as an `android.widget.EditText` with clickable/editable roles, but SET_VALUE returned invalid element state. Class-based editability alone is insufficient to prove the widget accepts direct input before activation. Click-to-edit transition/focus support needs a generic independently verified contract, not a Maps selector.
- Play: world reconstruction sees navigation roles, but current search candidate generation does not bind the observed bottom navigation to an entry transition. There are no editable fields in that observed home snapshot. Visual search text alone is not permission to click a guessed coordinate. Multi-hop navigation-to-search remains unverified on this UI.

Follow-up observation-only recon used one new Session, launching Play then Maps, without input or content selection. Play: READY, 117 widgets, 3 groups, roles including navigation, 3 unique identities. Maps: READY, 154 widgets, 5 groups, roles including editable, 29 unique identities. These are hierarchy observations, not successful searches. No app/package/label-specific branch was added to the runtime.

### Android Latency / RPC Measurements

All numbers below are reported spans. They overlap: planning contains inference, execution can contain observation/RPC, and RPC totals contain source/element calls. **Do not sum columns.** My Files ran partly while build/lint were active, so these are controlled functional measurements under contention, not isolated performance benchmarks.

| Span / count | My Files | Maps valid | Play |
| --- | ---: | ---: | ---: |
| Total wall ms | 57162 | 51557 | 38844 |
| Planning ms | 987 | 24518 | 19262 |
| Session setup ms | 13330 | 7101 | 6391 |
| Human-assistance span ms | 0 | 1114 | 940 |
| Observation ms | 27424 | 12642 | 8982 |
| Inference ms | 0 | 22401 | 17398 |
| Execution ms | 26295.69 | 9138.48 | 5301.28 |
| Verification ms | 444.66 | 10 | 3 |
| Appium RPC count | 121 | 40 | 42 |
| Appium RPC ms | 35997.69 | 15803.42 | 12206.62 |
| Source RPC ms (subset) | 6319.16 | 3630.51 | 3796.71 |
| Element RPC ms (subset) | 3517.52 | 930.04 | 0 |
| ADB calls | 84 | 37 | 42 |
| ADB ms | 17077.55 | 8803.43 | 7143.81 |

Queue wait on these sequential real-model tasks was approximately 0-1 ms per call. No new performance shortcut, reduced freshness check, grant relaxation, or evidence relaxation was applied.

## Validation and Evidence Locations

- Full regression **437/437**, final run 50876 ms. Includes original route-hint tests and four new M2b tests. An initial sandbox-only route-hint atomic rename returned EPERM; the unchanged tests passed outside the sandbox. This was not fixed by weakening assertions.
- `tsc --noEmit`: PASS.
- Scoped ESLint across changed runtime, runners, fixture and tests: PASS. The augmented mutation-review assertion also passes.
- Full ESLint: known unrelated `components/executions/ExecutionDetailModal.tsx:130` no-explicit-any error and 9 unused-variable warnings. Not fixed or hidden.
- `next build --webpack`: PASS. Existing dynamic `module.createRequire` parsing warnings remain. Build compilation 8.0 s, TypeScript 25.1 s, static generation 7.9 s; these are component spans, not full build wall time.
- `git diff --check`: PASS; line-ending conversion warnings only. Untracked files are not covered by that Git command.
- No browser Dashboard interaction acceptance in this request: **UNVERIFIED**. Real actions were submitted through the controlled runtime API, not claimed as browser E2E.
- Sealed cohort not opened, imported, decrypted, or used. No M4/M5 development. No commit/push.

Raw local evidence remains under the OS temporary directory, not added to Git:

- `agent-v2-m2b-1792431567306.json`: first failed model measurement.
- `agent-v2-m2b-1792431938749.json`: semantic false-accept measurement.
- `agent-v2-m2b-1792432262693.json`: final passing model measurement; source hash `85af738bffe4b8ef1a8ff130744c4d0265edefd278d9a2c38c428cce1d34d6e3` before diagnostic-only compatibility edits.
- `v2-acceptance-0d9b123c-40b0-49dc-8578-e2745806141f.json`: My Files.
- `v2-acceptance-5cfa2598-776b-404c-97e4-864a6b785fe4.json`: valid Maps.
- `v2-acceptance-b945193f-3002-45a8-9d60-7c7c40d3ac79.json`: Play.
- `v2-acceptance-64d7bb17-0ddc-4470-9b03-42d0dd48ecb8.json`: malformed CLI Maps attempt, excluded from acceptance.
- `agent-v2-world-evaluation-1792433821966.json`: observation-only recon and frozen hash.
- `phone-m2b-myfiles.jpg`, `phone-m2b-maps.jpg`, `phone-m2b-play.jpg`: manually inspected screenshots. These can contain private screen content and were not copied into repository documentation.
- `phone-m2b-regression-final.log`, `phone-m2b-build.log`, `phone-m2b-eslint.log`: validation logs.

## Remaining Scope

**NOT_IMPLEMENTED:** SET_VALUE / SELECT_ITEM / READ_VALUE / CONFIRM general primitive executors and complete contracts; M4 and M5. Their presence in a closed primitive catalog is not executable support. Search's scoped internal SET_VALUE action is not a general user-goal SET_VALUE executor.

**UNVERIFIED:** arbitrary new verb interpretation, sealed-cohort performance, Maps/Play completed searches, real multi-hop search-route learning, real keyboard-only commit alternative, live route-hint reuse across device/version changes, and browser Dashboard acceptance in this request.

Do not replace any older BLOCKED outcome with SUCCESS. The next decision belongs to the owner: address the generic pre-activation editability / grant timing / navigation-to-search gaps in a separate scoped request, or retain current conservative blocking.
