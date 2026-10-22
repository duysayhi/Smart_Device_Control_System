# Agent V2: Groq Proposal Router

Date: 2026-10-20. Branch `DuyTD`. No commit/push. Existing dirty/untracked work retained. No sealed cohort read; M5 not started.

## Scope and Verdict

**Gate FAIL.** All 192 simulated-UI cases completed, but the router scored only 11/32 (34.4%) on the fresh set with 11 post-validator false accepts. Groq was substantially faster; speed alone does not meet the gate. Cloud remains opt-in and was not enabled in `.env.local` or the existing worker. Local default remains `qwen2.5:3b-instruct`, V1 unchanged.

Real-device conclusion: Groq completed both approved search goals; forced-failure routing reached real Qwen 3B, but both fallback goals SAFE_BLOCKED on truncated query interpretations. Therefore fallback transport is verified, fallback end-to-end task completion is not accepted. Both created Sessions were independently verified closed. No settings or Bluetooth changes occurred.

Read `agent-v2-m4b-report.md` and `agent-v2-m4d-report.md` before changes. M4d device-scoped full-control policy, grants, journal, independent verifiers and inverse restoration were not modified. No Bluetooth enable or real-device setting mutation is part of this request.

## Secret Handling Incident

The variable name found is `GROQ_API_KEY`; its value is not included here. `.env.local` is ignored by `.env*` and is not tracked. The initial `.gitignore` contained a credential-shaped comment, which was accidentally included in the first file-read tool output. The comment was removed and the owner was warned to revoke/rotate the exposed credential. That disclosure cannot be undone or certified absent from the conversation by a disk scan.

No key was written into source, tests, reports or benchmark evidence by this implementation. HTTP errors and malformed model output are normalized to closed typed codes; response bodies, fetch exceptions and Zod diagnostics are not logged. The adapter's key uses a JavaScript private field, so serializing the provider does not expose it. Scan results later in this report describe their actual coverage, not an assertion that the initial transcript had no disclosure.

## Provider and Configuration

`reasoning-provider.ts` adds fetch-only `GroqProposalProvider` and `GroqLocalRouter`. Requests use the fixed HTTPS `api.groq.com/openai/v1` host, Bearer header and `redirect: error`. No new dependency, Gemini/OpenRouter adapter, key rotation or browser-side key was added.

Runtime model discovery succeeded with this key. Exact returned IDs:

```text
allam-2-7b
canopylabs/orpheus-arabic-saudi
canopylabs/orpheus-v1-english
meta-llama/llama-prompt-guard-2-22m
meta-llama/llama-prompt-guard-2-86m
openai/gpt-oss-120b
openai/gpt-oss-20b
openai/gpt-oss-safeguard-20b
qwen/qwen3.8-27b
whisper-large-v3
whisper-large-v3-turbo
```

Selected: `openai/gpt-oss-20b`. Discovery proves availability, not remaining account quota or billing-plan status. A closed reviewed allowlist permits 20B, 120B and the listed Qwen model. `AGENT_GROQ_MODEL` chooses within it; `AGENT_GROQ_MODELS_ALLOWLIST` can narrow it. Discovery is cached for one hour. The GPT-OSS pair uses strict JSON schema; the reviewed Qwen alternative uses JSON mode plus the same local Zod validation. Temperature 0, maximum 256 completion tokens, default 12-second deadline including queue wait, cancellation honored.

API behavior was checked against [Groq structured outputs](https://console.groq.com/docs/structured-outputs), [API reference](https://console.groq.com/docs/api-reference) and [rate limits](https://console.groq.com/docs/rate-limits). Structured syntax does not guarantee semantic correctness.

Recommended active configuration remains local unless the measured gate passes:

```dotenv
AGENT_STRUCTURED_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5:3b-instruct
```

Explicit experimental opt-in, not automatically applied:

```dotenv
AGENT_STRUCTURED_PROVIDER=groq-with-local-fallback
AGENT_GROQ_MODEL=openai/gpt-oss-20b
```

Keep the existing `GROQ_API_KEY` in `.env.local`, never a `NEXT_PUBLIC_` variable. Restart the backend worker and Next.js after changing backend environment configuration. Optional knobs: `AGENT_GROQ_RPM` (default 6), `AGENT_GROQ_RPD` (200), `AGENT_GROQ_TIMEOUT_MS` (12000), `AGENT_GROQ_CIRCUIT_MS` (180000). Counters are shared per key within one process, with rolling minute and UTC-day accounting; they are not durable or account-wide across process restarts. Provider quota responses remain authoritative.

## Routing and Privacy

- Groq first, one local final attempt for unavailable key/model, private or unsupported schema, proactive rate budget, Retry-After/circuit cooldown, network/timeout, HTTP error, invalid JSON or foreign choice. No Groq retry loop for a proposal.
- Retry-After accepts seconds or HTTP-date and delays subsequent Groq admissions. Three consecutive service failures open the short circuit. Cancellation does not trigger fallback.
- Local fallback is explicitly Qwen 3B. Its load, prompt/output tokens, queue/service timing and fallback reason are retained. Groq metadata contains provider/model, bounded proposed choice, field manifest, token counts, latency and typed failure/status only.
- Deterministic rules, Intent paths and existing singleton clause/candidate skips remain before inference. No effect is replayed when a provider changes. The router imports no grant, mutation journal, verifier, full-control policy or Android executor.
- Groq sees only the closed public schema, numeric slot/clause IDs, bounded command tags and allowlisted candidate ID/action/role tokens. No raw request/system prompt, UI labels, values, contact/message/password text, selector, coordinate, shell command or device identity is sent. Unsupported open-ended output strings and contexts without usable public choices stay local.
- The existing public-schema walker incorrectly recursed into scalar enum/required arrays. Fixed array handling without relaxing literal/keyword checks; added real mocked HTTP coverage. Public projection is idempotent for fair repeated projection.
- Schema/ID validity does not establish source fidelity. Runtime source binding, interpretation review, fresh grounding, policy, one-use grants and independent verification still decide whether any proposed action can execute.

## Benchmark Method

Labels: **REAL_MODEL_SIMULATED_UI / DEVELOPMENT**, never Android outcome evidence. Reused the existing M4b 32 cases and added 32 fresh cases with retained ground truth, rotated IDs, different app/value wording, distractors and reject/destructive cases. All schemas retain five choices, not singletons. No sealed case was opened or imported.

All three variants receive the identical public projection, public system prompt and C1..C5 schema. This intentionally differs from the historical M4b raw-text local benchmark: privacy rules forbid sending its raw wording/UI actions to cloud. Raw DEVELOPMENT wording is retained locally only as ground truth. Do not compare these scores directly with the old full-text prompt scores.

The projection removes most action-sequence, ordinal, source-negation and UI-state distinctions in these fixtures. This is a measured limitation of the current privacy/semantic interface, not proof that the original question text was understood by the cloud model. Wrong but allowlisted IDs remain false accepts at proposal validation; no ground-truth oracle or test-specific validator was added to suppress them.

Runs are sequential with approximately 10.5 seconds between cloud admissions (including discovery), no Android actions/build/lint overlap, and no model download. The runner requested unloading other resident local models but did not retain a separate residency-readback record, so exact residency isolation is not independently proven. Cold first calls are included, not hidden as warm-up. Router cases divisible by four force a network failure at proposal time, exercising real local inference without disabling Wi-Fi.

Evidence: host TEMP `agent-v2-groq-benchmark-1792497472892.json`. All 192 cases ran; no early-stop or missing cases. Measurements include real local inference in every router fallback.

| Provider | Set | Faithful / 32 | Raw / post-validator false accepts | Invalid JSON | Median / p95 ms | Prompt / output tokens | HTTP / 429 | Fallbacks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Qwen 3B | M4b | 13 (40.6%) | 4 / 4 | 0 | 16028 / 26780 | 3327 / 225 | 0 / 0 | 0 |
| Qwen 3B | Fresh | 13 (40.6%) | 4 / 4 | 0 | 12209 / 24201 | 3372 / 224 | 0 / 0 | 0 |
| Groq 20B | M4b | 7 (21.9%) | 16 / 16 | 0 | 979 / 2507 | 7157 / 1699 | 0 / 0 | 0 |
| Groq 20B | Fresh | 9 (28.1%) | 15 / 15 | 0 | 1072 / 1963 | 7200 / 1678 | 0 / 0 | 0 |
| Router | M4b | 11 (34.4%) | 11 / 11 | 0 | 1517 / 18619 | 5961 / 1397 | 0 / 0 | 10 |
| Router | Fresh | 11 (34.4%) | 11 / 11 | 0 | 1229 / 22273 | 6125 / 1226 | 0 / 0 | 9 |

There were 16 reject cases per set. False accepts mean a valid but semantically incorrect non-abstain proposal on a reject case, not a real Android effect. Raw counts cover observed choice outputs; transport failures have no observable raw choice and are not assigned a fabricated answer. No invalid-JSON response was observed in this real benchmark; offline tests exercise that branch.

Router M4b: eight injected NETWORK failures plus two genuine network fallbacks. Fresh: eight injected NETWORK failures plus one genuine TIMEOUT fallback. No real HTTP errors/429 occurred; 429, Retry-After and circuit behavior were verified with HTTP mocks instead. Token totals include successful cloud/local attempts; a failed call without usage metadata is not counted as zero billable tokens.

Sampled peak aggregate Ollama/llama working set: 1,985,822,720 bytes (about 1.85 GiB), 654 samples at approximately three-second intervals. This is neither VRAM nor whole-machine usage; sampling can miss peaks. No CPU/GPU utilization claim is made.

Gate details: fresh false accepts 11 != 0, faithful 34.4% < 80%, Groq median 1072ms < local 12209ms. Only the latency condition passed. Do not recommend cloud as default. The raw request/UI labels were deliberately not sent to improve scores. A future privacy-preserving semantic interface would need separate design/evaluation; no app-specific runtime workaround was added here.

## Android, Validation and Remaining Limits

Samsung `R58MA78W6QK` was detected by ADB over USB. Read-only keyguard inspection showed `mIsShowing=false` and `SCREEN_STATE_ON`. The operator explicitly confirmed My Files search for "marine biology catalogue" and Drive search for "tidal ecology notes", without opening results. Both were then run once with Groq and once with injected proposal-time network failure. The existing Dashboard worker/configuration was not switched: the controlled runner injected the real router into Agent V2 directly.

The controlled spot-check runner refuses settings/persistent effects, only forwards an operator-approved exact interpretation, reserves the physical device through the existing lock, checks a frozen runtime digest and limits its measured inference to before Session setup so there is no live grant during cloud calls. An unsupported or changed interpretation is denied, not automatically corrected or approved.

Frozen runtime SHA-256 before/after all four runs:

`f8e0a7ca4704267562173750b9154ba03f201772b15b48e9483d2323661a3bfc`

No runtime edits during these runs. Each had one actual model decision over numeric source slot IDs 2, 3 and 4; this was not a singleton-schema skip. The primitive SEARCH was fixed, while the value slot remained ambiguous. This is not a demonstration of broader app/action semantics from redacted text.

| Case / execution ID | Provider decision | Verdict / evidence | Total ms | RPC / ADB |
| --- | --- | --- | ---: | --- |
| My Files cloud: 85fa9807-4c64-445b-8283-6839a9397ea6 | Groq 20B, VALID, 2037ms | REAL_ANDROID: COMPLETED, exact query, SEARCH_COMPLETED / NO_RESULTS | 38019 | 120 / 86 |
| Drive cloud: 449d3dfd-2ae1-49a7-922a-f5164fe7ecfc | Groq 20B, VALID, 1089ms | REAL_ANDROID: COMPLETED, exact query, SEARCH_COMPLETED / NO_RESULTS | 28765 | 114 / 81 |
| My Files forced failure: 907ec4be-ba7c-4d6a-871f-484f7bb21ab2 | Ollama Qwen 3B, NETWORK fallback, VALID JSON, 19386ms | SAFE_BLOCKED before Session: proposed "biology catalogue", missing "marine" | 19952 | 0 / 2 |
| Drive forced failure: 8a3e0b60-7a6d-4a40-9bce-5cb696fcbf3f | Ollama Qwen 3B, NETWORK fallback, VALID JSON, 19510ms | SAFE_BLOCKED before Session: proposed "ecology notes", missing "tidal" | 28981 | 0 / 2 |

Both successful runs produced device-bound OBSERVED_STATE artifacts from `NATIVE_UI_V2` and `NATIVE_SEARCH_V2`, with separate evidence IDs for foreground and search outcome. NO_RESULTS is an observed empty search outcome, not an opened article or file. No result was opened.

The forced failure is a transport exception in the proposal provider, not a change to Android/computer Wi-Fi. Fallback routing and real local inference are verified, but fallback **end-to-end goal completion FAILS** for both goals. The exact approved-summary guard rejected the truncated source slot. Terminal reason "User denied assistance" comes from this runner's mismatch denial, not a new denial by the operator. A syntactically valid slot is not necessarily the complete query; no validator/prompt was loosened and no task-specific correction or repeat attempt was used to turn these results into success.

| Case | Session setup ms | Observation ms | Execution ms | Verification ms | Queue / service ms | Local load ms |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| My Files cloud | 10365 | 15161 | 17594 | 328 | 13 / 2015 | n/a |
| Drive cloud | 5767 | 13287 | 15412 | 142 | 0 / 1085 | n/a |
| My Files fallback | 0 | 0 | 0 | 0 | 1 / 19373 | 11774 |
| Drive fallback | 0 | 0 | 0 | 0 | 24 / 19387 | 727 |

Spans overlap; do not sum them. RPC/ADB and per-call measurements are retained in each `agent-v2-groq-android-<executionId>.json` in host TEMP. All four proposal intervals ended before Session setup, so no grant for that execution existed during inference. The fallback runs had no Session, no effect grants and zero Appium RPC; their two ADB calls were read-only readiness/catalog work.

Independent post-run Appium probes returned `invalid session id` for both successful owned Sessions. The blocked runs created none. Runtime cleanup check found zero active tasks and zero owner modes; Samsung remained online. No settings, Bluetooth, consent, installation, message/call send or user-content creation/deletion occurred. Search history behavior inside the apps was not independently measured.

The original runner printed terminal BLOCKED correctly but returned process exit 0. After preserving these evidence files, the helper was tightened to exit nonzero for non-COMPLETED, changed-source or grant-window violations and to record explicit interpretation-review mismatch metadata. This was a harness-only fix; old outcomes were not relabeled and no Android run was repeated.

Validation: `node scripts/agent-v2-m4b-validation.cjs --run --groq`, after benchmark completion. Evidence: host TEMP `agent-v2-groq-validation-1792499936264.json` and per-stage logs.

| Check | Verdict | Elapsed ms |
| --- | --- | ---: |
| Full regression | OFFLINE_TESTED: PASS 559/559, 0 skipped; previous 540 retained plus 19 router tests | 48323 |
| TypeScript | PASS, child exit 0 | 14445 |
| Scoped ESLint | PASS, child exit 0 | 20198 |
| Full ESLint | FAIL, existing explicit-any at ExecutionDetailModal.tsx:130:98 plus existing unused warnings | 21763 |
| Production next build --webpack | PASS, actual child exit 0 | 131390 |

`git diff --check` passed (existing LF/CRLF conversion warnings only). Additional scoped lint passed for the final summary/scan helpers after their documentation/scan-metadata edits. No runtime source was changed after the validated production build.

Offline tests use an actual loopback HTTP server and fake transport redirecting only test requests, never the real API. They exercise success, 429/Retry-After, HTTP 503, network/timeout, invalid JSON, foreign ID, extra grant field, private literal/open-ended schema rejection, absent key, circuit/rate skips, cancellation, invalid local output and key-safe serialization. Provider imports and existing reasoning-before-grant ordering are also checked. Offline tests are not end-to-end Android verification.

Initial source scan found no remaining key matches after the credential comment removal. The final exact-secret/pattern scan, including build text and the four Android evidence files, inspected 395 files with zero matching paths; environment files, dependencies, `.git`, sealed data, unrelated TEMP files and files above 10 MB were excluded. Only this request's Groq evidence/log TEMP files were scanned, not every log on the machine. The tool transcript is outside that scan; its initial disclosure remains an explicit incident requiring credential rotation.

Dashboard progress now displays provider/model/status/latency/fallback metadata. Browser interaction acceptance is not implied by type/build checks. Full-control functionality remains as reported in M4d; this router does not implement any deferred setting/record/camera/recording capability.

Files changed for this request: `.gitignore` (credential comment removal only), `lib/android/agent/reasoning-provider.ts`, `lib/android/agent/budget.ts`, `components/commands/AgentGoalPanel.tsx`, existing M4b benchmark/validation scripts, the new Groq benchmark/summary/secret-scan/controlled-Android runners, `tests/groq-router.test.cjs`, and this report. Existing uncommitted work elsewhere was not reverted. No Android setting, Bluetooth state, owner mode, mutation journal or grant policy was changed in this pass.

Final configuration-only check: structured-provider switch remains unset (local), cloud opt-in false, OLLAMA_MODEL exactly `qwen2.5:3b-instruct`, and `.env.local` remains ignored. The controlled-Android helper's final mismatch/exit-code audit changes passed scoped ESLint; those helper-only changes did not rerun the preserved Android failures or alter runtime code.
