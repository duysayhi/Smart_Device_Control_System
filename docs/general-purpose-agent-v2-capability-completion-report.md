# Agent V2 Capability Completion Report

Date: 2026-10-19. Branch: `DuyTD`. Baseline: existing uncommitted V2 implementation on top of `458f514`. Existing audit/implementation reports were read and were not rewritten.

**Overall: PARTIALLY_IMPLEMENTED, not full capability completion or production acceptance.** This continuation adds executable keypad, approved boolean transitions, saved-media verification and constrained reviewed planning. General record persistence, alarm creation and Gallery identity navigation remain blocked.

## Implementation And Changed Files

New files in this continuation:

| File | Implementation |
| --- | --- |
| `lib/android/agent/math-keypad.ts` | Per-key expression transitions, glyph/spoken-label normalization from observed controls, locale-bound result readback |
| `lib/android/agent/state-target.ts` | Explicit boolean target and single-photo request binding |
| `lib/android/agent/media-evidence.ts` | Read-only Android MediaStore metadata, physical identity checks, issued inventories and unique new media identity |
| `lib/android/agent/outcome-proposal.ts` | Constrained model source-span/dependency proposals, backend coverage checks and reviewed graph compilation |
| `scripts/agent-v2-acceptance.cjs` | Explicit opt-in API/worker live runner for launch/read/calculation; refuses persistent effects and concurrent active tasks |
| `tests/general-agent-v2-widgets.test.cjs` | Offline positive/negative widget, media, locale, grant and reviewed-decomposition tests |

Modified existing V2 files:

- `grounded-candidates-v2.ts`: actual keypad buttons, boolean controls, shutter candidates, parameter binding and regeneration on fresh state.
- `effect-grants.ts`: authorize only bound arithmetic keys, requested toggle state or an explicitly requested single-photo shutter.
- `agent-v2.ts`: per-key trace/readback, locale observation, effect confirmation, media readiness/baseline/polling, typed artifacts, reviewed fallback and progress.
- `verification-registry.ts`, `evidence-predicates.ts`: localized math evidence, unique checkable target verification and backend-issued MediaStore evidence.
- `artifact-store.ts`: typed SAVED_MEDIA references, metadata provenance, duplicate evidence/URI rejection and UI summaries.
- `capability-registry.ts`, `goal-compiler.ts`: executable narrow boolean/photo contracts with readiness checks; unsupported structured writes remain blocked.
- `app-catalog.ts`: photo capability can resolve the standard Android camera intent when no app is explicitly named.
- `outcome-spec.ts`: retain exact validated human-reviewed interpretation provenance without accepting arbitrary JSON as reviewed outcomes.
- `ui-affordances.ts`: retain actual text alongside accessibility description, avoiding localized spoken labels hiding mathematical glyphs.
- `goal-graph.ts`, `components/commands/AgentGoalPanel.tsx`: interpretation/effect assistance, candidate/snapshot references and verified artifact metadata.
- `lib/android/grounded-interactions.ts`: per-key exact readback, desired-state readback and one-shot shutter dispatch followed by independent persistence verification.

All earlier uncommitted files and unrelated package-manager changes were preserved. No commit/push, dependency/model installation, APK installation/removal, secret dump or global policy-mode change was performed.

## Capability Matrix Before / After

| Capability | Before | After / actual boundary |
| --- | --- | --- |
| LAUNCH / cross-app execution | Offline-tested | Verified on Samsung through the Dashboard HTTP API/worker, 2/2 outcomes |
| CALCULATE editable field | Supported only on suitable editable layouts | Retained; keypad preferred when every requested key is uniquely observed |
| CALCULATE keypad | Blocked | Implemented, per-key readback and no blind clearing/replay; localized operator/result handling added from actual failures |
| SET_STATE | Always blocked | Explicit labeled checkable boolean transition with human approval and exact readback; not generic alarms/date-time/option widgets |
| CAPTURE_MEDIA | Always blocked | Explicit one-photo shutter + preview evidence + approval + MediaStore readiness + unique new owned nonempty media URI |
| CREATE_RECORD | Blocked | Still blocked: no trustworthy generic save/reopen/persisted-record identity workflow |
| FIND_ARTIFACT in another app | Blocked | Still blocked: native Gallery UI is not automatically bound to a content URI; latest thumbnail is never assumed correct |
| Artifacts | OBSERVED_STATE metadata only | Adds SAVED_MEDIA URI/id, MIME, size, owner and date provenance; no image bytes sent to AI |
| Planning fallback | Bounded rules only | Constrained LLM proposals for launch/read-navigation/arithmetic, mandatory human interpretation review before discovery/effects |

This is not support for arbitrary write actions. A complete graph contract does not prove that a selected phone exposes the required provider or controls. Runtime readiness can still block before capture.

## Verifiers And Effect Grants

### Arithmetic

The backend derives the requested result using the existing bounded TypeScript numeric AST oracle. Native keypad input is generated only when the full requested symbol set is uniquely observed as actual buttons and an expression field is identifiable. Each key must produce the expected expression prefix before the next key. Nonempty unrelated expressions are not automatically erased. Entry methods do not switch to SET_VALUE after keypad input starts.

Samsung exposed both symbolic button text and spoken accessibility labels. The implementation retains both, and can normalize expression words using the observed button text/description pairs rather than an app/language-specific selector dictionary. Result formatting uses `persist.sys.locale` read from the selected device; it does not assume that `6.000` always means 6000. Completion still requires the original expression trace and the evaluated result.

### Boolean state

Only a uniquely labeled checkable control with an observed current state is eligible. The requested desired boolean is bound into the candidate. EFFECT_CONFIRMATION retains the execution/Session and is followed by fresh candidate revalidation. Denial sends no click. Both immediate post-action and the next observation must show the desired state. Duplicate labeled controls cannot satisfy the verifier.

This proves current observed boolean state, **not persisted alarm creation**. Time pickers and alarm storage are not implemented.

### Saved media

MediaStore reads are restricted to a fixed images collection and numeric recent-time window. The query reads metadata only: `_id`, `date_added`, `_size`, `mime_type`, `owner_package_name`. It does not read image bytes, paths, filenames or upload content. SQL/shell syntax is fixed by the backend; no model/user shell text is accepted.

Each inventory is issued by the reader after checking the physical identity before and after the query. Permission denial, malformed/oversized results, missing owner metadata, duplicate identities or identity changes block execution. A baseline is taken before the single authorized shutter action. The verifier requires exactly one new URI, matching app owner, positive size and bounded creation time. Missing/ambiguous media never triggers another shutter click. UI change or a thumbnail alone is insufficient.

SAVED_MEDIA references preserve device, physical identity, execution, node, provider and evidence. Duplicate evidence/URI is rejected, wrong-device/consumer access fails and references expire. This is metadata-level saved-media evidence, not byte-content inspection or a Gallery match.

### Planning

The model can propose only supported outcome kinds, original source spans, verbatim value spans and topological dependency indices. Strict schemas reject selectors, shell, predicates, invented values, missing known outcomes and unsupported write kinds. Arithmetic cannot omit operands/operators. Dangerous action words cannot be reinterpreted as read/calculation outcomes. Source coverage is checked, then GOAL_INTERPRETATION requires explicit human approval before app discovery or effects. Sequential app/effect ordering is retained even if the model proposes fewer edges.

This is an assisted fallback, not fully autonomous open-world understanding. Unknown language cannot be proven semantically equivalent by span checks alone; human review remains mandatory. Real Ollama fallback inference was not exercised during acceptance.

## Real Android Evidence

Device: Samsung A50s / SM-A507FN, connected through `192.168.1.17:33081`. Hardware identity was verified by the existing runtime. Only one Session was used at a time; temporary observation Sessions were closed before the next test. Worker reloads inspected tasks and refused to stop a busy worker.

Environment probes: ADB detected the device. Appium `/status`, Ollama `/api/tags` and Next.js `/api/agent/runtime` returned HTTP 200. This establishes service availability, not inference accuracy or UI acceptance.

| Test | Actual result |
| --- | --- |
| Natural app name, open Calculator then Settings | BLOCKED before Session: Android did not expose a default calculator category handler and the catalog did not invent a display label |
| Same flow using launcher components read from PackageManager | **COMPLETED 2/2**, execution `6f37f698-dff0-4dcd-8fe1-42ea38c4c6d1`; 18,504 ms total, 7,262 ms setup, 7,447 ms observation, 0 model inference |
| First T3 attempt | BLOCKED, 14,003 ms; spoken label hid the equals glyph; no input sent |
| Editable input attempt | BLOCKED, 22,634 ms; native field did not read back SET_VALUE; no retry |
| Initial keypad attempt | BLOCKED, 27,275 ms; expression field was mistakenly counted as another digit button, then input method changed; fixed and regression-tested |
| Next keypad attempt | BLOCKED, 34,129 ms; accessibility expression used the observed spoken operator rather than a glyph; fixed and regression-tested |
| Keypad through equals | Actual six keys and equals sent/read back; fresh UI showed `6.000 Kết quả tính toán`; execution `477a7e48-a2ce-441f-b050-9a376c1e375e` remained BLOCKED at the old result verifier, 40,480 ms, no equals replay |
| Fresh T3 acceptance after localized-result fix | **COMPLETED 2/2**, execution `80d6ea19-80b5-4109-9e36-b4ca125f26e9`; six keypad clicks and one equals click, both LAUNCH and CALCULATE VERIFIED; 39,163 ms total, 5,940 ms setup, 26,703 ms observation, 17,937 ms execution, 79 ms verification, 0 model calls |
| MediaStore readiness | **REAL_DEVICE_VERIFIED read access**; recent inventory contained zero rows. No photo was captured during this probe |

The localized-result verifier was subsequently implemented and tested offline, then verified in the fresh T3 run above after the user cleared the previous test result. Both graph nodes have backend evidence references. This establishes **T3 REAL_DEVICE_VERIFIED through the Dashboard API/worker path**, not visual browser acceptance or arbitrary calculator compatibility. Earlier BLOCKED executions retain their original status. The runtime API confirmed the new task COMPLETED and zero active tasks after cleanup.

Live trace files are generated under ignored `.next/v2-acceptance-<executionId>.json` and contain goal, graph/evidence IDs, candidate/snapshot/action references, result/reason, total and inference timing. They contain no screenshot or full private UI XML. No real-device visual browser test is claimed: acceptance used the Dashboard HTTP API and the real worker/device path, not browser clicking.

## T1-T5 Status

| Task | Source/offline status | Real device status |
| --- | --- | --- |
| T1 capture saved photo | Implemented and offline-tested positive/denied/identity cases; provider gating executable | MediaStore read access verified; actual shutter-to-saved-URI acceptance UNVERIFIED |
| T2 07:00 enabled alarm | Not implemented; CREATE_RECORD/structured time remains SAFE_BLOCKED | NOT RUN; no alarm created |
| T3 125 x 48 | Editable/keypad execution plus localized result verification offline-tested | **REAL_DEVICE_VERIFIED: COMPLETED 2/2 in 39.163 s** on Samsung, execution `80d6ea19-80b5-4109-9e36-b4ca125f26e9`; six keypad clicks, equals, independent result verification |
| T4 persisted note title/body | Not implemented; SAFE_BLOCKED rather than writing without persisted readback | NOT RUN; no note created |
| T5 capture then find same image | Typed media identity implemented, but Gallery matching unavailable; full compound graph remains SAFE_BLOCKED | NOT RUN; no latest-thumbnail guess |

## Tests And Negative Cases

New tests cover keypad sequences, stale/foreign/duplicate targets, wrong input readback, uncertain responses without replay, localized text/description differences, locale ambiguity, approval/denial, failed toggles, permission overlays, wrong/empty/duplicate media, physical mismatch, artifact provenance/duplicates and constrained planning omission/injection/review.

The unchanged existing suite also exercises worker recovery, cancellation and simulated device isolation. This run does not claim new live concurrent multi-phone write acceptance. Generic Save-not-persist and wrong title/body field execution tests remain unavailable because CREATE_RECORD is not executable; it is blocked before effects instead.

Validation commands:

```powershell
$files = (Get-ChildItem tests -Filter '*.test.cjs').FullName
& 'C:\nvm4w\nodejs\node.exe' --test $files
& 'C:\nvm4w\nodejs\node.exe' node_modules/typescript/bin/tsc --noEmit
& 'C:\nvm4w\nodejs\node.exe' node_modules/eslint/bin/eslint.js <changed-and-new-source-files>
& 'C:\nvm4w\nodejs\node.exe' node_modules/eslint/bin/eslint.js .
& 'C:\nvm4w\nodejs\node.exe' node_modules/next/dist/bin/next build
```

Latest validation: full regression **378/378 PASS** in 22.632 s; TypeScript PASS; scoped lint PASS. Full lint retains the unrelated `no-explicit-any` at `components/executions/ExecutionDetailModal.tsx:130` and nine existing unused-import warnings. Final production build PASS: compile 2.5 s, TypeScript 4.8 s, 12 static pages; three existing dynamic filesystem tracing warnings remain. The idle worker was reloaded with the final source and the runtime API confirmed zero active tasks.

No old assertions were relaxed to hide failures. Actual Android failures led to generic affordance/readback regression cases, not Samsung package selectors in runtime.

## Performance And Resources

No model/resource/concurrency limit was increased. All real-device runs above used rules and zero model calls; Ollama inference latency is therefore not benchmarked. Most measured latency was observation/Session setup, not inference. Media verification performs bounded condition polling after one capture, not repeated capture. Full-schema fallback may be refused by the conservative existing context budget; refusal sends no action.

## Remaining Work And Readiness

- General CREATE_RECORD needs field identity, approved multi-field editing and a trustworthy save/exit/reopen persisted-readback identity contract. It was not enabled just to click Save.
- Alarm/date-time/numeric widgets and generic selected-option state are not implemented by the boolean toggle path.
- Gallery FIND_ARTIFACT needs evidence connecting the observed destination item to the exact MediaStore URI; filename/latest position alone is not enough.
- Capture needs actual camera UI/approval/persistence acceptance on supported devices. Preview/shutter/owner metadata may be unavailable and will block safely.
- Planning fallback is human-reviewed and limited to three outcome kinds, not autonomous arbitrary writes or universal language understanding.
- OCR/Vision and external image upload were not added. Icon-only arbitrary UI remains unsupported.
- Dashboard artifact/assistance wiring is source/SSR verified, not visual desktop/mobile acceptance.

Deployment classification: **PARTIALLY_IMPLEMENTED / controlled experimental use only**. V1 remains default, V2 opt-in. Locks, cancellation, device isolation and candidate-ID model choices remain intact. This report does not claim that all requested capabilities or T1-T5 have passed.
