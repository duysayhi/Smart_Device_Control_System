# Agent V2 M4b: Intent Capabilities, Observation Profiling and Model Proposals

Date: 2026-10-20. Branch: `DuyTD`. No commit/push. Existing dirty and untracked work was preserved. No sealed cohort was opened, imported or decrypted. M5 was not started.

## Verdict

Partial acceptance, not unrestricted Android autonomy.

- **REAL_ANDROID:** source-reviewed open-app, DIAL-only prefill, Settings opening, Wi-Fi/battery/brightness reads; My Files and Drive exact search-only outcomes.
- **SAFE_BLOCKED:** URL has no uniquely resolved default browser; media/ring independent read paths unavailable on this device; SMS may auto-persist a draft.
- **OFFLINE_TESTED:** 495/495 tests, including 28 new source-binding, injection, resolver, evidence, non-replay and provider tests. TypeScript and scoped ESLint pass.
- **REAL_MODEL_SIMULATED_UI / DEVELOPMENT:** 32 fresh five-choice cases per installed model. Neither model meets the required zero-false-accept bar. JSON validity is not semantic faithfulness.
- No consistent end-to-end win from 500ms idle timeout. Keep 1000ms default, V1 unchanged. No grant TTL, freshness, identity, readiness, occlusion or verification check was relaxed.

## Controls and Evidence

The operator explicitly approved only the stated open/read/prefill interpretations, and the runner forwarded approval only when the Agent's single interpretation choice matched exactly. Owner mode was device-scoped, enabled/disabled in `finally`. One owned Session at a time; post-task native readback used a separate Session only after task cleanup. No calls, sends, permission/consent acceptance, installs, deletion, settings mutation, camera capture or persistent test-record creation was issued. SMS had zero ADB/RPC calls.

Runtime digest covers sorted `lib/android/**/*.ts` paths and contents. Every batch checked unchanged digest after execution. No runtime source was edited during a batch. Initial failed/blocked results remain intact:

| Batch | SHA-256 | Evidence JSON in OS TEMP |
| --- | --- | --- |
| Initial Intent cases | `d9be06b866abce9881fae7e98b2192b3d08720372cb2ca855e1e2fa0466e3803` | `agent-v2-m4b-intents-1792488219170.json` |
| Brightness and blocked-resolution fixes, equivalence and paired searches | `c4572e052d6f62b057325f7bc1ab63680c7e4e9dc316b9e64f6e87d9297c8daa` | `agent-v2-m4b-intents-1792488698780.json`, `agent-v2-m4b-equivalence-1792488758498.json`, `agent-v2-m4b-baseline-1792488849934.json`, `agent-v2-m4b-after-1792489005018.json` |

Raw screenshots, snapshots, per-call measurements, task evidence and model responses are in OS TEMP, not source control or `.next`. Acceptance JSON includes execution IDs, native evidence, screenshot filenames, scoped owner cleanup and invalid-session probes. Every created task Session with an ID returned `invalid session id` after cleanup. Global Appium Session enumeration remains **UNVERIFIED**: protected session discovery was not enabled.

## A. Typed Intent Layer

New modules: `intent-schema.ts`, `intent-capabilities.ts`, `intent-executor.ts`.

- Closed discriminated schemas and full-clause deterministic source-slot matching. Model text never becomes a command, selector, coordinate, grant or verifier. Unknown phrasing retains existing reviewed UI/discovery routing.
- Preserve original source spans and exact values; require interpretation review for new Intent plans. Existing known package LAUNCH rules reuse their established source authorization and now use the same verified backend path when applicable.
- Immutable capability metadata describes effect class, required grants and mandatory verifier. Authenticated, device/execution/physical-bound backend approval is not a client-generated effect grant.
- Re-resolve handler, independently check readiness and physical identity, retain Session context ownership, enforce a 5-second dispatch window and consume a one-use ledger before sending. UNKNOWN/acknowledged effects are never replayed. Cancellation and budgets remain active.
- Android Intent execution uses fixed backend actions and quoted validated args. HTTP(S) only; no credentials/shell syntax; bounded safe DIAL numbers; closed Settings action list; no CALL action. Reject chooser/ambiguous handler and wrong-package app resolution.
- Screen outcome requires fresh native foreground/activity, independently resumed activity, and exact editable URL or number readback when relevant. A successful `am start` receipt alone is insufficient.
- Read-state completion requires agreement between two read-only paths. No first/newest/most-plausible value is substituted when evidence disagrees.

| Capability | Backend contract | Real-device verdict |
| --- | --- | --- |
| OPEN_APP | Installed catalog + PackageManager MAIN/LAUNCHER; native and independent resumed-activity proof | REAL_ANDROID: My Files |
| OPEN_URL | VIEW HTTP(S) via uniquely resolved handler; native URL and activity proof | SAFE_BLOCKED: no unique default browser. Offline positive/negative resolver/schema contracts tested; positive Android URL completion UNVERIFIED |
| OPEN_DIALER | DIAL `tel:5550100`, never CALL; exact native number + resumed activity | REAL_ANDROID; screenshot manually inspected, number visible, no call action issued |
| OPEN_SETTINGS | Closed action `android.settings.SETTINGS`; resolved activity readback | REAL_ANDROID; opens screen only |
| READ_STATE wifi | `settings get global wifi_on` vs `cmd wifi status` | REAL_ANDROID: `1` |
| READ_STATE battery | `dumpsys battery` level vs sysfs capacity | REAL_ANDROID: `100` |
| READ_STATE brightness | `settings get system screen_brightness` vs independently rendered display brightness | REAL_ANDROID after generic fix: `64` vs `0.2509804 * 255` |
| READ_STATE media/ring volume | `cmd media_session volume --get` vs strict audio readback | SAFE_BLOCKED: CLI returned empty output; alternative legacy `media` binary absent and `cmd audio` reports no implementation. No volume changed |
| COMPOSE_SMS | Requires proven non-auto-draft persistence behavior | NOT_IMPLEMENTED / SAFE_BLOCKED before Session or dispatch; never entered SMS |

Deferred persistent/external capabilities are **NOT_IMPLEMENTED in this Intent layer**: alarm/contact/record creation require source-scoped write grants plus unique identity/reopen/readback; sending requires explicit recipient/body and external-effect grant plus independent delivery outcome; calling requires explicit call authorization plus independent call-state outcome. None was attempted.

### Actual Root Causes and Repairs

1. Default-browser resolution ambiguity originally surfaced as FAILED despite no effect being dispatched. Runtime now classifies capability resolution failure as safe blocking. Initial execution `c877bb3c-8b3f-4157-ab7b-e1e129e7ba47` remains FAILED; new execution `6f86bafc-3807-4d5a-9aab-2d4a7af14da8` is BLOCKED. No default-browser selection was performed.
2. `dumpsys power` did not expose current brightness on this Android build. Generic independent readback now uses `dumpsys display`, accepts bounded integer/float representations and rejects inconsistent multi-display readings. It does not mistake minimum/default brightness configuration for current brightness. Initial BLOCKED brightness execution remains unchanged; new `2c55acfc-f097-4155-908f-b64e87a70084` completed with independent agreement.
3. Multiple Intent outcomes must resolve applications by the full typed request, not one shared `INTENT` map key. Runtime map keys were corrected without adding application-specific behavior.

### Intent Acceptance Timings

Milliseconds, rounded. Execution span includes Intent readback verification; `verificationMs=0` is not evidence that verification was skipped. Per-call RPC/ADB records are in the batch JSON. Post-task screenshot/reconnaissance is outside task spans.

| Case | Total | Session setup | Intent execution/readback | RPC / ADB | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| My Files open | 10729 | 6551 | 2273 | 12 / 28 | COMPLETED |
| DIAL prefill | 11546 | 5836 | 3779 | 12 / 28 | COMPLETED |
| Settings open | 10962 | 5770 | 3273 | 12 / 28 | COMPLETED |
| Wi-Fi read | 9090 | 6055 | 1028 | 6 / 25 | COMPLETED |
| Battery read | 10902 | 6880 | 1767 | 6 / 25 | COMPLETED |
| Media volume | 9201 | 6099 | 1034 | 6 / 24 | BLOCKED |
| Ring volume | 8660 | 5779 | 941 | 6 / 24 | BLOCKED |
| Brightness, new batch | 9319 | 6291 | 1066 | See raw batch | COMPLETED |
| URL, new batch | 526 | 0 | 0 | No dispatch | BLOCKED |
| SMS | 231 | 0 | 0 | 0 / 0 | BLOCKED |

## B. Observation and Session Profiling

Appium client reports per-call SOURCE, ELEMENT, SESSION, CAPABILITIES, SETTINGS, SCREENSHOT and OTHER durations. Adapter records ADB readiness/identity/discovery/other calls and XML parse durations, with bounded per-call offset records. Counts include checks; they are not reduced by excluding safety work.

Same device, same two goals, approvals and frozen source; no concurrent build/lint or model benchmark during paired runs. Actual task inference count was zero in all four executions: known rules/singleton clauses/candidates skipped inference. The warm helper also skipped its singleton choices. Thus model-warm latency is **not demonstrated by these search pairs**, and no inference speedup is inferred. The separate non-singleton model benchmark is the reasoning evidence.

| App | Idle ms | Outcome | Total ms | Setup ms | Observation ms | Execution ms | Verification ms | RPC / ADB | SOURCE count / ms | ELEMENT count / ms |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| My Files | 1000 | NO_RESULTS verified | 30593 | 5986 | 14004 | 18583 | 306 | 102 / 77 | 12 / 5786 | 19 / 2148 |
| My Files | 500 | NO_RESULTS verified | 28845 | 6048 | 12751 | 17272 | 299 | 102 / 77 | 12 / 5276 | 19 / 2045 |
| Drive | 1000 | NO_RESULTS verified | 27188 | 5596 | 12591 | 13576 | 140 | 96 / 70 | 12 / 5115 | 14 / 1123 |
| Drive | 500 | NO_RESULTS verified | 28759 | 5727 | 13478 | 15509 | 148 | 114 / 79 | 14 / 4144 | 19 / 1367 |

These spans overlap: Observation includes source/RPC/ADB work and execution includes post-action observation. Never sum columns to claim total duration. Drive at 500ms required additional observed work; lower SOURCE time did not produce a faster task.

| App / idle | ADB readiness count / ms | ADB identity count / ms | XML parse count / ms | Session POST ms | Capabilities count / ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| My Files / 1000 | 10 / 1357 | 34 / 4660 | 12 / 129 | 4622 | 6 / 32 |
| My Files / 500 | 10 / 1257 | 34 / 4545 | 12 / 96 | 4547 | 6 / 31 |
| Drive / 1000 | 8 / 1007 | 31 / 3909 | 12 / 75 | 4376 | 5 / 23 |
| Drive / 500 | 9 / 1158 | 36 / 4898 | 14 / 60 | 4432 | 6 / 30 |

Full per-call durations, including remaining discovery/other calls, are retained in `latest.measurements`, not reconstructed from averages. Appium SCREENSHOT RPC count was zero; acceptance screenshots came from the existing post-task ADB screenshot endpoint. Their per-case elapsed time was not instrumented and remains **UNVERIFIED**. Play was not revisited: prior M3d aggregate data is historical, and new per-call Play profiling is **UNVERIFIED**.

Native equivalence probe alternated 1000/500/1000/500 within one owned Session per app. All native nodes/attributes, viewport, package and activity matched exactly across each app's four snapshots (47 My Files nodes, 103 Drive nodes). Only snapshot identity/time was excluded. My Files observation durations were 548/778/788/904ms; Drive 1601/971/894/961ms. This proves equivalence for these observed screens only, not every Android state.

**Decision:** keep default 1000ms; retain explicit V2-only `AGENT_V2_OBSERVER_IDLE_TIMEOUT_MS` experiment support with the same existing 500..10000 validation. Worker was restored to 1000ms. V1/default configuration files unchanged. Grant expiry occurrences: zero in all four current pairs, but baseline already had zero; the old M3d expiry failure remains, and no eliminated-expiry claim is made.

Rejected/not applied: compressed hierarchy/ignoreUnimportantViews (no occlusion/identity equivalence proof), ADB dump replacement (no enabled/displayed/identity equivalence proof), cross-task Session reuse (ownership/isolation equivalence not proven), parallel production warm-up (not measured under identical cold/warm conditions), acknowledgement-timeout tuning (no paired evidence). No unchecked shortcut was deployed.

## C. Providers and Real Local-Model Benchmark

`reasoning-provider.ts` introduces structured proposals only. Default remains the existing local Ollama path/options and configured model. V1 behavior and source-exact auto-review policy are unchanged. Benchmark overrides are confined to the runner.

Cloud is disabled by default. Explicit `AGENT_STRUCTURED_PROVIDER=cloud-json`, enable flag, HTTPS endpoint and environment API key are required for the opt-in BYO structured JSON gateway. This is **not an OpenAI/Gemini vendor adapter**. Only closed public schema, numeric slot IDs, bounded command tags and whitelisted candidate IDs/actions/roles are sent. Raw source/system prompts, UI labels, free-text slot values, passwords and contacts/messages are not sent. Sent-field manifest is recorded. Private schema literals are rejected. Returned proposals go through the same Zod validators; the provider cannot execute, grant, verify or create evidence. Real cloud inference is **UNVERIFIED**, vendor integration **NOT_IMPLEMENTED**; no key was requested or logged.

New runner `scripts/agent-v2-m4b-benchmark.cjs` imports no old benchmark fixture or sealed data. Its 32 DEVELOPMENT cases comprise 16 plan choices and 16 next-action choices, five options each with rotated correct positions, mixed English/diacritic and unaccented Vietnamese, multi-clause/ambiguous/destructive/external-effect cases and UI distractors. Ground truth is retained. Schema always permits C1..C5, not a singleton; each measured case made an actual model call. It measures proposal choice, not Android execution or full argument-binding correctness.

Both installed models used identical prompts/schemas, temperature 0, context 2048, 256 output-token limit and keep-alive 10m. Qwen3 used `think:false`. No pulls/default switch. One unscored warm-up per model is retained separately. Corrected run kept only one model resident at a time; no Android tests/build/lint ran concurrently.

| Model | Faithful | False accepts on 16 reject cases | Invalid JSON | Median / p95 ms | Prompt / output tokens (32 calls) | Warm-up ms / load ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| qwen2.5:3b-instruct | 18/32 (56.25%) | 1 | 0/32 | 3324 / 4708 | 4143 / 293 | 23037 / 205 |
| qwen3:4b, thinking off | 20/32 (62.50%) | 3 | 0/32 | 5989 / 8260 | 4207 / 418 | 33535 / 23248 |

The required zero false accepts was **NOT achieved by either raw proposer**. These are release-blocking semantic results, not filtered away by relabelling a wrong choice. No unsafe proposal was executed on Android. Existing independent backend policy/grounding/verification remains necessary; it is not scored as model accuracy. Do not infer that 4B is suitable for unattended general execution from its slightly higher overall score.

Corrected evidence: `agent-v2-m4b-models-1792487686004.json`. Per-call load durations in milliseconds (case order 1..32):

- 3B: 87,175,18,355,100,83,54,272,22,33,19,184,68,170,47,36,49,63,17,103,27,52,78,101,18,44,180,199,24,34,1897,760.
- 4B: 84,21,52,21,108,205,21,40,44,41,76,34,192,26,87,70,18,2124,38,121,29,26,20,146,146,1045,1002,346,755,1670,19,67.

Sampled peak aggregate working set of all matching ollama/llama processes was 2,650,230,784 bytes (about 2.47GiB). Raw timestamped per-process samples are retained; working set is not model file size, VRAM or total machine RAM. Sampling at 3s can miss brief peaks.

An initial exploratory run (`agent-v2-m4b-models-1792486660280.json`) found both models resident concurrently on the 8GB host. 3B median/p95 was 17600/32362ms; 4B had four 45s timeouts after a timed-out warm-up and was interrupted, remaining cases UNVERIFIED. This confounded run is preserved and excluded from the controlled model comparison. The runner now stops after three consecutive timeouts. Large latency differences between these runs are a residency/environment effect, not an Agent code speedup. Benchmark-only 4B was unloaded after measurement.

## D. Search Evidence and Limits

- My Files source query: `fieldwork-notes-2026-zqx`. Baseline execution `6784d1c7-281e-4544-bc68-713cc2a4b96e`; 500ms execution `e08b6411-36ba-4bc0-88cf-6015434ac544`.
- Drive source query: `coastal research archive`. Baseline `7e1e08f3-a1c8-4aa4-9699-46598e13292d`; 500ms `c3011e38-dd19-411a-bfa1-862607990ef6`.
- All four independently reached SEARCH_COMPLETED / NO_RESULTS with exact query evidence and acknowledged submission. NO_RESULTS is completion of search-only, not proof of a positive record or successful selection. No result was opened. Drive screenshot was manually inspected and matched the exact query/no-results UI.
- New Intent support does not solve every app's structured widgets, unlabeled elements, URL redirects or consent UI. Positive default-browser URL completion and volume read support remain UNVERIFIED on this device. SMS is intentionally not dispatched.

## E. Validation and Reproduction

Final validation evidence prefix: `agent-v2-m4b-validation-1792489199646` in OS TEMP. Node child-process exit codes, not PowerShell stderr behavior, determine verdicts.

- Full regression: **495/495 PASS**, 39.9s test duration (467 baseline + 28 new).
- TypeScript: **PASS**, exit 0.
- Scoped ESLint over changed/new implementation/tests/runners: **PASS**, exit 0.
- Full ESLint: **FAIL**, existing unrelated `components/executions/ExecutionDetailModal.tsx:130:98` `no-explicit-any`, plus nine unused warnings. Not changed to hide failure.
- Production `next build --webpack`: **PASS**, actual Node child exit 0, about 145.6s including tracing. Existing `module.createRequire failed parsing argument` warnings remain; compilation, typechecking and static generation succeeded.
- `git diff --check`: **PASS**; Git printed existing LF/CRLF conversion warnings only.

Runners require explicit opt-in and literal arguments via Node argv. `agent-v2-m4b-evaluation.cjs` enforces idle runtime, unlock readiness, exact approvals, source digest and cleanup. `agent-v2-m4b-worker.cjs` verifies its experiment process actually owns the worker, so a raced default worker cannot be mislabeled as 500ms data. `agent-v2-m4b-validation.cjs` runs validation sequentially and writes logs outside the repo. Do not overlap benchmark/build/lint and acceptance profiling.

Final independent cleanup check: runtime digest still `c4572e052d6f62b057325f7bc1ab63680c7e4e9dc316b9e64f6e87d9297c8daa`; active tasks 0, owner modes 0, reasoning running/waiting 0/0, physical-device ownership absent. The idle worker was explicitly restored to 1000ms. Next.js remains available on the existing local Dashboard server.

Remaining work is explicitly bounded: broader Intent phrasing/argument-binding generalization, supported independent audio queries on this platform, default-browser URL completion without unauthorized consent/config changes, safe SMS non-persistence evidence, provider-specific cloud adapters if requested, zero-false-accept reasoning and more paired performance repetitions. No current block was replaced with a fabricated completion.
