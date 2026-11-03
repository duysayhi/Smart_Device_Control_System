# Agent V2: Persisted Actions, Structured UI and Cross-App Verification

Date: 2026-10-19. Branch: `DuyTD`. No commit or push performed.

## Scope and Verdict

This is an incremental implementation on the existing dirty V2 working tree, not an architecture replacement. V1 remains the default and V2 remains opt-in. Existing execution/device locks, approval tokens and fresh-state verification remain in place.

Overall: **PARTIALLY_IMPLEMENTED**. Capture has real-device evidence. Record persistence, a narrow structured alarm form and exact-URI media viewing have executable backend paths and positive/negative offline tests, but are not real-device accepted. Arbitrary date/time/selection widgets and general Gallery UI search are not implemented. This is not production-ready universal Android automation.

## Capability Matrix

| Capability | Implementation status | Real-device status / boundary |
| --- | --- | --- |
| CAPTURE_MEDIA | IMPLEMENTED_AND_TESTED | REAL_DEVICE_VERIFIED: one authorized Samsung capture, MediaStore identity readback |
| CREATE_RECORD | IMPLEMENTED_AND_TESTED for title/body forms; PARTIALLY_IMPLEMENTED overall | UNVERIFIED on native Notes; stable observed record identity and New/Create flow required |
| SET_STRUCTURED_STATE | IMPLEMENTED_AND_TESTED for uniquely labeled editable hour/minute plus enabled control in an explicitly 24-hour form | UNVERIFIED on Samsung Clock; arbitrary pickers/spinners/date/radio flows NOT_IMPLEMENTED |
| FIND_ARTIFACT | IMPLEMENTED_AND_TESTED for exact URI viewer handoff from the same execution's capture artifact | UNVERIFIED on Android viewer; Gallery thumbnail search NOT_IMPLEMENTED |
| CALCULATE | Existing implementation preserved and regression tested | Previous real Samsung 125 x 48 = 6000 acceptance retained; not rerun as a full calculation in this pass |
| Reviewed goal fallback | Expanded constrained proposal schema and validation, IMPLEMENTED_AND_TESTED offline | Real Ollama decomposition for the new write capabilities UNVERIFIED |
| DEVICE_UNLOCK assistance | IMPLEMENTED_AND_TESTED offline; actual locked-device gate observed | No automatic unlock or credential entry; requires fresh awake/unlocked evidence |

## Execution and Verification

### Capture

Flow: discover application -> native observed preview -> grounded shutter -> scoped approval -> MediaStore baseline -> one shutter dispatch -> new media readback -> SAVED_MEDIA artifact.

Preview detection accepts large visible non-clickable SurfaceView/TextureView or semantically identified native preview Views. No Samsung package-specific shutter selector or fixed coordinates were added. After human approval, a capture/boolean candidate can be regenerated only when its exact target attributes and bounds still match, and all current candidate conditions pass; this is not a generic stale-candidate bypass.

Media evidence checks new URI/identity, device, owner, size, time and MIME. Preview/thumbnail alone is insufficient. Uncertain mutation responses never trigger another capture.

### Persisted Record and Structured Alarm

`record-forms.ts` derives field roles from observed hints, descriptions and resource tokens, not current field contents. The supported record schema is exact title/body. The supported alarm schema is valid 24-hour HH:MM plus enabled=true. Existing boolean executor primitives are reused rather than introducing a second write backend.

`persisted-record.ts` requires an observed New/Create transition, a stable explicit draft identity, exact field binding, one-shot grants, exact readback before Save, one Save, an identity-bound list row, reopening, and exact values after reopening. A blank existing editor is not accepted as a proven new draft. Unexpected existing text is not overwritten. Missing identity blocks before field writes/Save; an app that allocates an ID only after Save is currently unsupported.

`verifyRecordReadback` uses distinct chronological snapshots, same app/device context, bounded freshness, stable identity, list evidence and exact reopened values. Provider: `NATIVE_RECORD_READBACK_V2`. This proves UI exit/reopen readback, not private database access or reboot durability. The RECORD artifact carries provenance and verified values; Dashboard summaries expose identity and field names rather than the record body.

Ambiguous fields/widgets request assistance, then regenerate candidates from fresh state. Assistance does not grant arbitrary field mapping or bypass a missing identity. Save-result assistance permits returning to the list without sending Save again. No mutation replay is performed.

### Cross-App Media

The compiler binds FIND_ARTIFACT to its earlier capture producer, including across intervening launch nodes. The artifact cannot be replaced by the latest photo or imported from another execution/device.

`media-view.ts` consumes a backend-issued single-use grant, verifies physical identity, rechecks MediaStore metadata, resolves a unique viewer activity for the fixed image content URI, then uses a fixed Android ACTION_VIEW backend operation. LLM-provided shell, URI substitution and arbitrary coordinates are not accepted.

Provider `ANDROID_MEDIA_URI_V2` requires a fresh viewer surface, expected foreground package and an unambiguous top activity intent containing the exact URI. An internal issued receipt is required; a forged JSON receipt is rejected. Unsupported or ambiguous dumpsys formats block.

The reported mode is **EXACT_URI_VIEW**. It is not Gallery UI search and not pixel-content comparison. Historical media ID 2247 is evidence of the capture only, not authority for replay in a new execution.

### Planning, Assistance and Status

Reviewed proposals now support the registered write/media capabilities as well as existing read/calculation capabilities. Source/value span coverage, supported schema checks and capture dependencies are validated. The model cannot supply selectors, coordinates, shell, permissions, verification predicates or grants. Human interpretation review remains; persistent effects require separate scoped approval.

Typed assistance covers field ambiguity, uncertain widget, save-result ambiguity, app/goal/effect review and device unlock. Approval remains expiring, single-use and device/execution bound. Existing Session is retained during assistance where available. Full-screen freshness is re-evaluated before action. Terminal result and completion level NONE/PARTIAL/ALL_VERIFIED are separate; dispatch alone is never completion.

## Real Android Acceptance

Samsung A50s / SM-A507FN, physical serial R58MA78W6QK, Wi-Fi transport `192.168.1.17:33081`. ADB, Appium, Ollama and Next.js responded during preparation. Testing used the Dashboard runtime API and the existing worker; no browser visual acceptance is claimed.

| Test | Result | Evidence / limitations |
| --- | --- | --- |
| T1 Capture | REAL_DEVICE_VERIFIED / COMPLETED | Execution `fb9c8d68-b879-436e-89f6-e82203e91bc8`, two verified nodes, exactly one shutter dispatch |
| T2 Create record | Offline positive/negative PASS; device UNVERIFIED | Two package/language fixtures and varying values; no real Notes write attempted |
| T3 Calculate | Historical REAL_DEVICE_VERIFIED retained; offline regression PASS | Prior execution `80d6ea19-80b5-4109-9e36-b4ca125f26e9`, 125 x 48 = 6000, 39,163 ms |
| T4 Alarm | Offline positive/negative PASS; device UNVERIFIED | 07:00 and 13:27 fixtures; exact enabled readback, 12-hour ambiguity and invalid values rejected |
| T5 Capture -> viewer | Offline multi-app/backend PASS; device UNVERIFIED | Same artifact and Session, exact URI, mismatch/forgery/replay rejected; no additional photo authorized |

T1 artifact metadata:

- Artifact reference: `4bfde593-7ef7-4c90-8be1-5384034437dc`.
- Evidence: `ec86edf2-fd52-40b0-844b-c17034f2b3f4`, provider `MEDIA_STORE_V2`.
- URI: `content://media/external/images/media/2247`.
- MIME: image/jpeg; size: 1,985,320 bytes; owner/time checked by the backend.
- Owner explicitly approved one test photo in chat. The runner forwarded that consent to the exact execution's single-use EFFECT_CONFIRMATION token; this was not a browser approval click. No photo bytes were sent to AI. The photo remains on the phone.

Historical failures remain failures: `2ced0c9b-627f-4040-95c5-6178e69522ab` blocked on preview recognition; `faaa6f15-9d43-4c21-81a1-2b7d2094d7d8` blocked on changed screenshot fingerprint during approval; `a2dbc1c1-2331-4927-b103-091d4269eddc` cancelled by runner polling logic, with zero shutter dispatches. The runner now tolerates repeat polling of the already-forwarded token, without forwarding approval twice.

Read-only launch profiling attempts `249f0fde-d428-4b27-b854-ae86af19164a` and `6b50dfe9-cb8a-4c5e-97db-b561183b7a8f` failed at Android activity launch. Subsequent system inspection found SCREEN_STATE_OFF and mIsShowing=true: ADB online/foreground package did not mean the device was usable. After owner unlock, an immediate read confirmed SCREEN_STATE_ON/mIsShowing=false, but the phone locked again before the next trial. Execution `975e7547-7fbb-45d4-9431-68b9ad4ed769` requested unlock assistance and the unattended runner cancelled instead of granting it. These launch runs are not successful profiling benchmarks.

The added readiness gate checks native keyguard and screen state before app discovery and fresh observations. Locked state requests manual unlock; unknown metadata blocks. Confirmation alone is insufficient: native state must be READY. No keyguard bypass or extra photo is attempted.

Follow-up after the owner unlocked again: native policy confirmed SCREEN_STATE_ON and mIsShowing=false. Execution `06b077b0-660c-47f3-9845-8ee7da269c5c` completed the Calculator LAUNCH outcome with `FOREGROUND_IS` evidence `9728406c-34fd-498c-8f5a-4f2e1c594f7f`, provider `NATIVE_UI_V2`. Total 10,761 ms; planning 487, Session setup 7,308, observation 1,341, verification 4 ms; no reasoning or persistent writes. The first observed state already had Calculator foreground, so no separate post-Session launch action was sent (executionMs=0). This verifies the requested foreground outcome through the runtime, not a cold-start launch or calculation benchmark. No extra photo was taken.

## Performance

T1 measured total: 26,217 ms. Planning 1,771; setup 5,808; assistance 133; observation 12,241; execution 5,172; verification 1; inference 0 ms. Categories may overlap and must not be summed as exclusive wall-clock slices.

Added measurements: Appium RPC count/time, source/element RPC time, XML parse count/time, grounding time, ADB count/time, alongside existing setup/observation/action/verification and reasoning timings. Metrics omit RPC parameters, selectors and tokens. Callback failures do not alter command outcomes. Instrumentation is scoped and not a claim that every internal cost has an exclusive timer.

The later failed launch sample recorded 18 RPCs / 12,724.02 ms, source RPC 1,061.36 ms, two parses / 72.88 ms, 23 measured ADB calls / 24,338.74 ms and action time 21,911.31 ms. Lock state invalidates any speed comparison with the successful calculator baseline. No before/after speedup is claimed; model concurrency was not increased and fresh validation was not removed.

The unlocked follow-up recorded 11 RPCs / 7,635.04 ms, source RPC 335.69 ms, one parse / 64.48 ms and 18 measured ADB calls / 2,757.86 ms. This smaller foreground-only goal is not comparable to the prior 125 x 48 calculation; it does not establish a performance improvement.

## Validation

- Full offline suite: **390/390 PASS**, zero failed/skipped, approximately 37.18 seconds in the final run (baseline 378).
- TypeScript `tsc --noEmit`: **PASS** after final source changes.
- Scoped ESLint, changed/untracked TS/TSX/CJS: **PASS**.
- Full ESLint: **FAIL**, unchanged baseline `no-explicit-any` at `components/executions/ExecutionDetailModal.tsx:130` and 9 unused-import warnings outside this scope.
- Production build: **PASS**, compile 4.7 seconds, TypeScript 16.2 seconds, 12 static pages. Three existing dynamic tracing warnings remain. First attempt failed because the redirected log was inside `.next` and Windows prevented cleanup; retry used a temporary log outside build output.
- Browser interactive/visual Dashboard acceptance: **UNVERIFIED** this pass; API/offline rendering is not browser acceptance.

New regression coverage includes generic forms, wrong/missing/duplicate identity, wrong field, lost mutation response, Save without persistence, ambiguous time, disabled persisted alarm, stale/forged candidates, foreign device, wrong URI, multi-activity ambiguity, one-shot grant replay, assistance expiry, capture-to-viewer transfer, rejected model omission/reinterpretation, and locked/unknown device readiness.

Fixtures vary package, field labels/hints, language and values. This demonstrates bounded generalization of the contracts, not broad compatibility with untested Android apps. Existing preview fixtures were updated to represent a real preview-sized area; compiler tests now assert supported capture-producer binding while retaining rejection of unsupported record schemas. Historical traces were not relabeled as success.

## Files in This Increment

Paths below are relative to the repository; other dirty files predate this increment and are preserved.

- New form/readiness/backend modules: `lib/android/agent/record-forms.ts`, `persisted-record.ts`, `device-readiness.ts`, `lib/android/media-view.ts`.
- Agent contracts/integration: `lib/android/agent/agent-v2.ts`, `outcome-spec.ts`, `outcome-proposal.ts`, `goal-compiler.ts`, `goal-graph.ts`, `capability-registry.ts`, `grounded-candidates-v2.ts`, `effect-grants.ts`, `artifact-store.ts`, `evidence-predicates.ts`, `verification-registry.ts`, `ui-affordances.ts`.
- Existing shared observation/execution: `lib/android/targets.ts`, `visual-grounding.ts`, `state-observer.ts`, `condition-executor.ts`, `appium/client.ts`; profiling in `lib/android/agent/budget.ts` and progress types in `schema.ts`.
- Dashboard: `components/commands/AgentGoalPanel.tsx`.
- Runner/tests: `scripts/agent-v2-acceptance.cjs`, `tests/general-agent-v2-persisted.test.cjs`, `general-agent-v2-widgets.test.cjs`, `general-agent-v2-contracts.test.cjs`.
- This report. Existing source-audit and historical implementation reports are preserved.

## Acceptance Gates and Remaining Work

- Gate A: IMPLEMENTED_AND_TESTED within the explicit title/body and 24-hour form contracts; broader generic forms PARTIALLY_IMPLEMENTED.
- Gate B: media REAL_DEVICE_VERIFIED; record/alarm readback IMPLEMENTED_AND_TESTED offline, Android UNVERIFIED.
- Gate C: exact-URI cross-app identity IMPLEMENTED_AND_TESTED offline; native viewer acceptance UNVERIFIED; Gallery UI search NOT_IMPLEMENTED.
- Gate D: scoped approvals, expiry/replay checks and recovery IMPLEMENTED_AND_TESTED; real capture approval resume verified through API. New field/widget/browser assistance remains UNVERIFIED on actual apps.
- Gate E: regression, TypeScript, scoped lint and build pass; full lint baseline fails; complete T1-T5 real-device/browser acceptance is not achieved.

Deployment readiness: development opt-in only. Next device work should inspect actual Notes/Clock identity and widget evidence without inventing selectors, validate the viewer top-intent format, and run browser assistance acceptance. Unsupported app identity or widget contracts must remain SAFE_BLOCKED, not be counted as completed capabilities. A second photo requires new owner approval.
