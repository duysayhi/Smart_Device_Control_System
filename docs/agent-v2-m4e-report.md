# Agent V2 M4e: Complete Source Values and Calibrated Choices

Date: 2026-10-20. Branch `DuyTD`. No commit/push; existing working-tree changes preserved. No sealed cohort was read/imported and M5 was not started. Read the M4b, M4d and Groq-router reports before editing.

## Verdict

**Bounded DEVELOPMENT gate PASS**, not acceptance of unrestricted LLM autonomy. Router scores on the two fresh sets are 30/32 (93.75%) and 32/32 (100%), with zero post-compatibility false accepts. Conditional valid-model median is 767ms for Groq command-text vs 2188ms for local 3B. Most outcomes are deterministic, and all measured non-singleton cases require abstention because the read target identity is unresolved. There is no new evidence here of correct model-driven positive selection among ambiguous UI targets.

The configured local default remains `qwen2.5:3b-instruct`. Cloud and richer command text remain disabled unless explicitly configured. The new key in `GROQ_API_KEY` was accepted by Groq's models endpoint (HTTP 200), with `openai/gpt-oss-20b` available. Its value was not printed, copied into code/evidence, or changed by this implementation.

M4d full-control policy, effect grants, mutation journal and independent verifiers were not edited. No settings/Bluetooth changes, deletes, installs, consent acceptance or sends are authorized in this pass.

## A. Root Cause and Maximal Values

The old fallback failure was an interface defect as well as a model error: source extraction offered suffixes of an unquoted query as separate valid IDs. Choosing "biology catalogue" passed the slot schema despite dropping "marine". The final exact-review guard correctly stopped execution, but avoidable inference had already selected incomplete data.

`source-value.ts`, `source-slots.ts`, `primitive-decomposition.ts` and the generalized V2 portion of `outcome-spec.ts` now:

- Extract one maximal contiguous value after a supported value-taking verb and bounded courtesy prefixes/suffixes. Cover accented/unaccented Vietnamese and English; keep NFC/grapheme-to-original offsets.
- Remove a uniquely identified application qualifier from the data boundary, retaining its own app slot. Explicit prefix qualifiers with a separator such as "in Atlas for ..." have the same canonical interpretation in the known-outcome parser.
- Do not offer suffix/number/app fragments inside an unquoted value as competing values. Quoted values retain their literal connector/quote spans and the previous source-binding contract.
- Return NEEDS_CLARIFICATION for unsupported/unknown qualifier boundaries, incomplete connectors and ambiguous unquoted connector text instead of guessing a sub-span.
- Independently reject a shortened unquoted value in direct primitive validation, not only in the model prompt. Keep coverage, known outcomes, negation, destructive/external rejection, source spans, dependency checks and exact interpretation review.

The two previous query cases now have one value slot and skip inference. V1's legacy parse path was not changed. Typed Intent parsing must still accept its own closed grammar (including setting names and SMS draft syntax); connector clarification is scoped to ambiguous multi-clause value extraction rather than globally rejecting unknown Intent verbs.

Courtesy stripping is a bounded grammar, not universal natural-language understanding. Quote data whose actual content contains a connector or courtesy suffix. Unsupported/ambiguous grammar still blocks; no app-specific workflow or test-query literal was added to runtime.

## B. Deterministic Compatibility

`compatible-choice.ts` ranks only the supplied candidate IDs using source operation/order, normalized local label match, role/phase/effect agreement, ordinal constraints and exclusion flags. Destructive/external, sensitive, disabled, sponsored, foreign, stale, covered or consent-dependent cases are excluded. Search candidates classified as persistent writes are not treated as read/search edits.

One compatible ID skips inference. No compatible ID returns an issued abstain option or clarification. Two or more plausible IDs call the selected provider with only the reduced candidate set; the original schema is still parsed and the returned ID is checked against deterministic compatibility again. A model choice among multiple unresolved read identities is not independent target evidence and is converted to ABSTAIN.

This is used in V2 search-choice and generic next-action runtime paths. Source-bound plan/primitive choices retain the existing deterministic family/known-outcome checks and now use maximal values. The shared exported plan/next-choice ranker is also evaluated on plan-choice DEVELOPMENT fixtures. It does not replace the goal compiler or become a grant/verifier.

The standalone `chooseGroundedNext` utility retains its existing context/invalid-output contract; pre-ranking is injected by the execution caller. This preserves the regression requiring original goal/outstanding outcomes/effects/budget to reach that legacy helper, while the actual runtime still skips singleton manifests.

## C. Optional Command-Text Tier

`AGENT_GROQ_SEND_COMMAND_TEXT` defaults to false. When explicitly true, `cloud-command.ts` permits at most 512 NFC characters of the owner's command, referenced through an opaque backend-issued object held in a WeakMap. A forged object or screen/request field cannot become owner-authored command text.

Known password/key/token/login/account/contact/message/recipient patterns, phone/email-like text, controls, overlong text, sensitive flags and editable contexts cause the whole command to be withheld. This is conservative filtering, not a universal PII detector: do not enable this tier for confidential owner-written commands. No UI labels, screen values, editable contents, selectors, coordinates, device identity, message/contact records or history are sent. Optional short UI-label descriptors were deliberately not implemented; only existing allowlisted ID/action/role tokens are used.

The exact data-field manifest is recorded per model attempt: `schema`, optional `c`, `slotIds`, `commandTags`, `candidates`, and `commandText` only when actually included. The opaque reference itself is not serialized. This manifest describes application data, not the fixed API envelope/authentication header. Mock HTTP tests inspect actual bodies and metadata for both tiers. The model still only proposes IDs before grants; policy, execution, journals and verification stay local.

## D. Benchmark

Evidence in host OS TEMP: `agent-v2-m4e-benchmark-1792515020883.json`. All **384 pipeline cases** completed: M4b 32, previous Groq fresh set 32, new M4e fresh set 32, across local/public Groq/command-text Groq/router. Same retained ground truth and common pre/post compatibility layer for all variants. No Android actions, downloads or concurrent build/lint during measurement. Model: `openai/gpt-oss-20b`; local: `qwen2.5:3b-instruct`.

The DEVELOPMENT fixture adapter derives local scene flags, actions and phases from fixture descriptions without reading expected answers. It separates an explicit owner-command prefix from simulated UI prose. Only that prefix can obtain a cloud command reference; scenes without a clear owner prefix withhold text. App names/query literals are not present in the runtime ranker.

New set: eight ordinary plan requests with new apps/unquoted multiword values, eight destructive/ambiguous plan rejections, eight ordinary next-action cases, and eight unresolved peer-value read cases. The last eight retain two plausible READ IDs and an abstain ID, so the schema is not a singleton. These are model-call cases with no independently identified read target; the required final outcome is abstention. This deliberately tests the post-choice check, not positive LLM UI selection.

### Pipeline Accuracy and Calls

Raw FA below counts observed model proposals before post-compatibility, not deterministic skips. A dash means no model was called. Post FA covers all final pipeline outputs. Abstains include correct rejection and conservative false abstention.

| Variant | Set | Faithful / 32 | Raw FA / post FA | Abstains | Inference skips | Actual model responses | Invalid JSON / HTTP / 429 | Fallbacks |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | ---: |
| Local 3B | M4b | 32 (100%) | - / 0 | 16 | 32 | 0 | 0 / 0 / 0 | 0 |
| Local 3B | Fresh 1 | 30 (93.75%) | - / 0 | 17 | 32 | 0 | 0 / 0 / 0 | 0 |
| Local 3B | Fresh 2 | 32 (100%) | 6 / 0 | 16 | 24 | 8 | 0 / 0 / 0 | 0 |
| Groq public | M4b | 32 (100%) | - / 0 | 16 | 32 | 0 | 0 / 0 / 0 | 0 |
| Groq public | Fresh 1 | 30 (93.75%) | - / 0 | 17 | 32 | 0 | 0 / 0 / 0 | 0 |
| Groq public | Fresh 2 | 32 (100%) | 8 / 0 | 16 | 24 | 8 | 0 / 0 / 0 | 0 |
| Groq command | M4b | 32 (100%) | - / 0 | 16 | 32 | 0 | 0 / 0 / 0 | 0 |
| Groq command | Fresh 1 | 30 (93.75%) | - / 0 | 17 | 32 | 0 | 0 / 0 / 0 | 0 |
| Groq command | Fresh 2 | 32 (100%) | 8 / 0 | 16 | 24 | 8 | 0 / 0 / 0 | 0 |
| Router | M4b | 32 (100%) | - / 0 | 16 | 32 | 0 | 0 / 0 / 0 | 0 |
| Router | Fresh 1 | 30 (93.75%) | - / 0 | 17 | 32 | 0 | 0 / 0 / 0 | 0 |
| Router | Fresh 2 | 32 (100%) | 8 / 0 | 16 | 24 | 8 | 0 / 0 / 0 | 2 |

Reject counts are 16, 15 and 16 for M4b/Fresh1/Fresh2 respectively (the earlier report's prose assumed 16 for both old sets; fixture arrays were not changed). Fresh1's two misses are conservative abstentions: implicit two-object read coordination and an underspecified fixture phase description. No code/prompt was tuned to those misses during or after this frozen run.

Rows without inference are **OFFLINE_TESTED deterministic evaluations**, even though they ran inside the real-provider benchmark suite. Fresh2's eight model-call cases per variant are **REAL_MODEL_SIMULATED_UI / DEVELOPMENT**. None is Android outcome evidence. The passing score demonstrates bounded pipeline compatibility/abstention, not 100% raw-model faithfulness.

### Latency, Tokens and Resources

| Variant / set | Pipeline median / p95 ms | Valid-model median ms | Prompt / output tokens |
| --- | --- | ---: | --- |
| Local / M4b | <1 / <1 | n/a | 0 / 0 |
| Local / Fresh1 | <1 / <1 | n/a | 0 / 0 |
| Local / Fresh2 | <1 / 2339 | 2188 | 1152 / 58 |
| Public / M4b | <1 / <1 | n/a | 0 / 0 |
| Public / Fresh1 | <1 / <1 | n/a | 0 / 0 |
| Public / Fresh2 | <1 / 10673 | 788 | 1872 / 612 |
| Command / M4b | <1 / <1 | n/a | 0 / 0 |
| Command / Fresh1 | <1 / <1 | n/a | 0 / 0 |
| Command / Fresh2 | <1 / 10603 | 767 | 1920 / 568 |
| Router / M4b | <1 / <1 | n/a | 0 / 0 |
| Router / Fresh1 | <1 / 1 | n/a | 0 / 0 |
| Router / Fresh2 | <1 / 10747 | 823 mixed providers | 1728 / 443 |

Pipeline p95 includes the conservative 10.5-second cloud pacing wait, while provider measurements exclude that outer benchmark pacing. Zero-rounded medians mean below 0.5ms, not zero execution cost. Compare conditional model medians, not the mostly-skipped pipeline median, for the speed gate. Only eight calls per direct provider were measured; no broad latency guarantee follows.

There were 22 cloud completions plus model discovery, eight direct-local calls, and two real local fallbacks. Forced-failure scheduling was configured for case IDs divisible by four, but bypassed cases did not send a fake failure request; only two forced failures reached the provider. No observed HTTP/429/invalid-JSON errors; mocks cover these branches. Cold/residency records and local load durations are retained; no warm-up was hidden. Peak sampled aggregate Ollama/llama working set: 2,051,690,496 bytes (about 1.91 GiB), 82 samples. Not whole-machine RAM or VRAM; three-second sampling can miss peaks.

### Gate and Configuration

Gate PASS for this bounded pipeline: router Fresh1 93.75%, Fresh2 100%, post FA zero on both; Groq command median 767ms < local 2188ms. Raw cloud proposals still failed all eight unresolved-read rejection cases in this run. More text did not recover missing UI identity, and this experiment does not show a richer-payload accuracy benefit. Do not remove deterministic checks or treat a model answer as evidence.

Defaults were not changed. To explicitly opt into the router without command text:

```dotenv
AGENT_STRUCTURED_PROVIDER=groq-with-local-fallback
AGENT_GROQ_MODEL=openai/gpt-oss-20b
AGENT_GROQ_SEND_COMMAND_TEXT=false
```

The experimental router benchmark used the richer tier; enable it separately only after accepting transmission of non-sensitive owner-authored command text:

```dotenv
AGENT_GROQ_SEND_COMMAND_TEXT=true
```

Disable cloud/richer text and retain local default:

```dotenv
AGENT_STRUCTURED_PROVIDER=ollama
AGENT_GROQ_SEND_COMMAND_TEXT=false
OLLAMA_MODEL=qwen2.5:3b-instruct
```

Keep the new key only in the existing ignored `.env.local`; no `NEXT_PUBLIC_` key. Restart the backend worker/Next.js after changing environment configuration. No environment switch was silently enabled by this request.

## E. Controlled Android Acceptance

**REAL_ANDROID: three COMPLETED, one SAFE_BLOCKED (terminal runtime status BLOCKED).** Samsung A50s `R58MA78W6QK`, connected over USB. The previously approved search-only goals were My Files "marine biology catalogue" and Drive "tidal ecology notes", unquoted; no results opened. The runner checked fresh readiness and physical identity, held one owned Session/reservation at a time and accepted interpretation review only on an exact match with the previously approved full summary. All four reviews matched; both full query values were retained in every run.

| App / configured mode | Terminal outcome | Search evidence | Execution ID |
| --- | --- | --- | --- |
| My Files / forced fallback | COMPLETED | Full query; SEARCH_COMPLETED, NO_RESULTS | `ca1d05b8-080a-4d2c-9ed5-bffcc4c2a18a` |
| Drive / forced fallback | BLOCKED | Full query retained; TARGET_LOCATE, NOT_SENT | `5cb08bcc-e884-4f19-ad33-518bc08548bb` |
| My Files / healthy Groq | COMPLETED | Full query; SEARCH_COMPLETED, NO_RESULTS | `3612bad3-8d6c-4484-a18e-9e33499715b4` |
| Drive / healthy Groq | COMPLETED | Full query; SEARCH_COMPLETED, NO_RESULTS | `0548ac5a-4aaa-41fb-9527-41bef4962137` |

Each report is retained in host OS TEMP as `agent-v2-groq-android-<execution-id>.json`. Completed runs have independent `NATIVE_UI_V2` launch and `NATIVE_SEARCH_V2` search artifacts. NO_RESULTS means a verified submitted search with no results, not a found/opened document. The blocked Drive run has launch evidence only; exact failure: `SEARCH_NOT_SENT_TARGET_LOCATE: no replay. Exact issued search entry has not been read back.` This is a UI readback failure, not query truncation. No code or prompt was tuned to the failure; its BLOCKED result remains unchanged even though the later, separately requested healthy-mode run completed.

### Actual Timing and RPC Counts

All spans below are milliseconds from terminal progress. Spans overlap and must not be summed; total is the recorded execution span, excluding subsequent runner cleanup.

| App / mode | Total | Planning | Session setup | Observation | Execution | Verification | Appium RPC / ADB | Source RPC / element RPC |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| My Files / fallback | 33747 | 685 | 7177 | 16306 | 17007 | 351 | 108 / 80 | 6369 / 1909 |
| Drive / fallback | 29130 | 836 | 5973 | 14960 | 14913 | 3 | 107 / 78 | 6056 / 1730 |
| My Files / Groq | 33738 | 1092 | 7098 | 16004 | 17978 | 283 | 120 / 86 | 5986 / 1947 |
| Drive / Groq | 25935 | 901 | 5879 | 10929 | 12661 | 323 | 101 / 77 | 3127 / 1717 |

Reasoning/model calls: **zero in all four runs**; two singleton clauses skipped per run. Actual planner participation was deterministic source-slot binding, not Qwen or Groq inference. The forced-failure hook was not reached. These Android runs verify full-value binding and UI outcomes, **not actual Android provider failover**; real provider/fallback measurements are in section D. `noCloudDuringGrantWindow=true` in each report is vacuous with zero calls, not additional evidence of cloud/grant concurrency safety.

The frozen SHA-256 of `lib/android/**/*.ts` was identical before/after each run and after all cleanup: `690e8aff73663f6b84e5f37f7a0cea33904800b5ef1c373c4ebf620485a02001`. No runtime edits occurred between runs. All Sessions recorded close completion; independent read-only GET-timeouts checks subsequently returned HTTP 404 / `invalid session id` for all four. Runtime returned HTTP 200, zero active tasks and zero owner-test modes. No real-device setting/Bluetooth changes, consent acceptance, sends, installs or deletes were performed.

## F. Validation and Limits

Final validation evidence: host OS TEMP `agent-v2-m4e-validation-1792515347106.json` and its named child logs. No runtime edits after this validation began.

| Check | Result | Actual child elapsed |
| --- | --- | ---: |
| Full regression | PASS, 577/577, zero skipped | 66.47s |
| TypeScript | PASS, exit 0 | 18.77s |
| Scoped ESLint | PASS, exit 0 | 13.02s |
| Full ESLint | FAIL, exit 1: existing unrelated `components/executions/ExecutionDetailModal.tsx:130:98` no-explicit-any, plus nine existing unused warnings | 15.23s |
| Production `next build --webpack` | PASS, actual child exit 0 | 93.47s |

Earlier failed exploratory validation was preserved as `agent-v2-m4e-validation-1792514221898.json`, not relabeled: an overly broad connector guard affected typed Intent parsing, and changing the legacy standalone next-choice helper broke its context contract. Both were fixed at the appropriate extraction/runtime boundary without changing old tests. An intermediate 576/576 run preceded the final additional abstention regression.

`git diff --check`: PASS, exit 0 (existing LF/CRLF conversion warnings only). Final secret scan with `--include-build`: PASS, 425 files, zero matching paths. Secret scanning excludes environment files, dependencies, Git metadata, sealed data and unrelated TEMP files; includes relevant repo/report/log/evidence files and the build, with a 10MB-per-file limit. Tool transcripts are not scannable by this script, so this is not a claim about inaccessible historical transcripts. The rotated key was not printed during this pass. Configuration recheck confirmed cloud opt-in false, command-text opt-in false, Qwen 3B configured and `.env.local` ignored. No commit or push.

Remaining limits: bounded lexical/courtesy grammar, conservative ambiguity/refusal, no evidence for positive multi-candidate LLM correctness, source-text transmission privacy risk, and unsupported broader app workflows. Existing cloud schemas with unrestricted output strings (such as a model-generated free reason) still fall back locally rather than widening the public output contract. No deferred M4d full-control creation/setting capability was added, and no Session, grant TTL, freshness, revalidation, policy or verifier was relaxed.
