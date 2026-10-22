# Agent V2: Real-Device Generalization and Acceptance

Date: 2026-10-19 (Asia/Bangkok). Branch: `DuyTD`. No commit/push.

## Verdict

**Partial acceptance only.** Read-only reconnaissance and resource-less native tab navigation are **REAL_DEVICE_VERIFIED**. Three record persistence strategies have executable generic paths and are **OFFLINE_TESTED**, not accepted on a real record app. Real Ollama held-out planning remains **SAFE_BLOCKED**. Browser Dashboard interaction is **UNVERIFIED** because the computer-use tools could not safely access Chrome.

V1 stays default; V2 is opt-in. The extensive pre-existing dirty working tree was inspected and retained. This increment does not rewrite V2, introduce an app workflow profile, install software, or remove security checks. The previous implementation report and historical failed executions are unchanged.

## 1. Device and Actual Screens

Samsung A50s / SM-A507FN, hardware serial R58MA78W6QK; selected ADB Wi-Fi transport `192.168.1.17:33081`. Initial native readiness was SCREEN_STATE_ON and mIsShowing=false. ADB was online. Reconnaissance used the existing managed Appium context with device ownership lock, verified preinstalled instrumentation, and cleanup in finally; no concurrent Sessions were created by these scripts.

The enabled-package/launcher catalog contained Clock, Gallery and Calendar. No Notes/Memo/Keep package was found in the inspected installed-app catalog. Nothing was installed to manufacture a passing record test. Catalog package tokens are not equivalent to user-visible application labels.

| App / screen | Actual observation | Compatibility finding |
| --- | --- | --- |
| Clock / World clock | Snapshot `debd343c-8dc3-4e2a-bb54-c409736ec488`, 50 nodes; four native ActionBar tabs | Tabs have distinct accessibility labels and selected state, but no resource ID |
| Clock / Alarm tab | Snapshot `18009843-9868-40c8-88b3-e62bb7ba6507`; Add alarm, selected Alarm tab | Navigable. No stable alarm ID or complete record inventory evidence observed |
| Clock / Empty alarm editor | Snapshot `8e6ee15f-7d6e-490a-96cc-50d2fcba82c2`, 80 nodes | Hour/minute are editable fields inside a number picker. Both share one resource ID, differentiated by accessible Hour/Minute labels. Save/Exit exist. No draft ID, explicit 24-hour marker or persisted-record enabled control observed |
| Gallery / image grid | Snapshot `acec6844-545f-4237-b1b8-51e14c5535d1`, 152 nodes | Many clickable thumbnails have identical generic labels and repeated resource IDs. Search/Back exist, but thumbnails expose no verified content URI mapping |
| Calendar / month view | Snapshot `1ac996ff-a95c-4703-9019-98a0d7000af6`, 84 nodes | Month view, menu, search, Today and Add event observed. No record editor/identity inspection or event write attempted |
| Notes equivalent | No matching installed package found | CREATE_RECORD real-device acceptance UNVERIFIED; no app was guessed |

The owner separately approved opening the empty alarm editor for inspection only. No hour/minute entry, Save, enabled toggle, new alarm, calendar event, note or photo was performed. The inspected empty editor was exited using its observed Exit control and the return to the alarm list was observed. Existing alarms were not modified.

`settings get system time_12_24` returned `null`; that is unknown format, not proof of 24-hour layout. Absence of AM/PM also does not prove 24-hour format. Sound/vibration/snooze switches are not the alarm record's enabled state.

Raw UI evidence was kept in temporary local reconnaissance JSON, not committed or sent to Ollama. The report lists structural findings instead of private calendar/gallery contents. A first post-click reconnaissance read still showed the previous screen; a subsequent native read established the editor. The diagnostic runner now polls for observed state change with a bounded deadline and never retries the click on uncertainty.

## 2. Actual Outcomes

| Capability / check | Status this request | Explanation |
| --- | --- | --- |
| Catalog/readiness/reconnaissance | REAL_DEVICE_VERIFIED | Real PackageManager and native UI reads on the selected Samsung |
| LAUNCH + NAVIGATE native tab | REAL_DEVICE_VERIFIED | Execution `9d1a6f26-68b1-433a-b197-717503c905ff`, COMPLETED, two verified nodes; Alarm -> World clock selected-state verification |
| CREATE_RECORD | OFFLINE_TESTED / real device UNVERIFIED | New strategy registry integrated into actual executor; no installed Notes app or real write permission exercised |
| SET_STRUCTURED_STATE | OFFLINE_TESTED / real device SAFE_BLOCKED readiness of evidence contract | Real widgets inspected, but no independent identity/format/enabled persistence evidence; no time write or Save attempted |
| CAPTURE_MEDIA | No new acceptance attempt | Prior authorized capture remains historical evidence; no additional photo authorized/taken |
| EXACT_URI_VIEW | SAFE_BLOCKED for historical artifact reuse | Previous execution/store ended and its short-lived artifact/grants are no longer valid; no reimport, renewal or URI-only authority fabricated |
| GALLERY_UI_FIND | UNVERIFIED / unsupported identity mapping | Generic thumbnail labels do not identify the saved media |
| ARTIFACT_IDENTITY_VERIFIED in viewer | UNVERIFIED this request | Not inferred from merely seeing a Gallery grid or a historical URI |
| New CALCULATE task | UNVERIFIED this request | Prior real calculation success preserved; current pass does not claim another calculation run |

The successful Clock goal was `Mo com.sec.android.app.clockpackage va chon Giờ quốc tế`. Runtime trace recorded the native grounded interaction and registered ELEMENT_VISIBLE verification using the unique selected tab. This was a real read-only transition, not just confirmation of an already-foreground application. Exact package/labels were supplied as diagnostic inputs from the observed catalog/UI, not inserted as runtime selectors or app-specific rules.

## 3. Root Causes and Generic Fixes

### Resource-less navigation tabs

Old eligibility required resource ID tokens such as tab/menu/title. Actual native ActionBar tabs had empty IDs, and their labels included accessibility suffixes such as `Tab 2 of 4` / Vietnamese equivalent. Generic class semantics now admit native Tab classes, normalize only that class's positional suffix, and preserve native element grounding. No screen coordinates are used.

Verification requires exactly one matching tab, enabled and selected=true; visibility alone or duplicate tab labels do not pass. Disabled candidates are not offered. Vietnamese Clock and an unrelated English reader package are covered by offline tests. Actual Samsung Clock transition passed. Equivalent transition on a second physical app remains UNVERIFIED.

### Shared-ID editable spinner fields

Actual hour and minute fields share a resource ID. A postcondition that searched only resource ID/class/value could accept a value in the wrong field. Native SET_VALUE readback now requires a unique matching semantic record field role; other fields use the bound observed index rather than any same-ID field. Existing exact form readback and fresh grounding remain.

An offline native-executor regression puts the requested hour value in the minute field and requires rejection, then verifies the correct hour field. This does not implement spinner increment/decrement sequences, AM/PM selection or rotary/date pickers. Such widgets still need their own complete candidate/grant/executor/verifier contract before support can be claimed.

### Draft identity before Save

Requiring a pre-Save ID as the only strategy unnecessarily rejects apps that allocate IDs at Save. New `record-persistence.ts` registers three explicit strategies, wired into `persisted-record.ts`, record candidates and the backend verifier:

| Strategy | Preconditions | Disambiguation and independent readback |
| --- | --- | --- |
| STABLE_DRAFT_ID | Observed newly opened draft ID, not an ID present in baseline | Unique same-ID list row, then same ID and all exact requested values after reopen |
| POST_SAVE_ID | Explicit complete baseline inventory; proven new editor; no matching pre-existing record | Exactly one newly observed ID absent from baseline with expected label, then same new ID and all exact values after reopen |
| EXACT_FIELDS_CREATED_AT | Explicit complete baseline with no full match; new editor; explicit creation timestamp within this operation | Exactly one row with every requested field plus creation time, then all fields and the same timestamp after reopen; provenance-bound composite identity |

A local `draft:` scope is not claimed as persisted identity. It is an in-process issued, integrity-checked scope bound to device/app/execution, values and the observed new-editor transition. It expires with the bounded operation and cannot be forged by JSON or reused on another execution. The final artifact uses only the resolved persisted identity and reports the strategy.

Post-Save strategies currently require an explicit machine-readable UI inventory contract (`record-collection: complete` or equivalent registered spelling) and explicit record/creation metadata. Ordinary visible rows, a scroll viewport or absence of a title do not prove a complete inventory. These contracts were NOT observed in Samsung Clock/Calendar. The registry is a real executable extension, but not a claim that native Samsung persistence is now supported.

The actual flow still requires observed New/Create, exact scoped approval, fresh per-field validation, exact pre-Save values, one Save, exit/list, one identity-bound reopen and independent readback. Existing blank editors are not silently treated as new; old IDs, incomplete lists, duplicate matches, wrong fields, wrong creation time, uncertainty and missing readback block. Save is never replayed after a lost response. Title-only/newest-item matching is not a strategy.

### Model source spans

The original held-out run showed invalid numeric source spans and a truncated JSON response. Planning now requests exact source text/value snippets. Backend resolves unambiguous UTF-16 offsets and invokes the SAME strict span/coverage/dependency/capability/effect validator. Missing, repeated or invented source fragments block; backend does not repair the model's interpretation.

The compact source schema reduces prompt-byte pressure without increasing num_ctx, concurrency, retries or removing checks. Numeric proposal validation remains covered by existing tests. The interpretation-review test fixture was updated to the new transport shape while keeping all approval-before-discovery/denial assertions.

## 4. Reuse and Safety

No Samsung package name, resource ID or screen coordinate was added to runtime logic. Actual app packages/labels appear only in diagnostic invocations and evidence. Runtime changes use native widget class, accessible labels, semantic field roles and explicit persistence metadata contracts.

Offline reuse covers stable-ID forms, post-Save-ID forms on two unrelated packages, timestamp-based persistence through the actual form executor, and resource-less tabs in two languages/packages. Wrong-device/execution, stale/forged candidates, denied approval, lost mutation responses and uncertain Save remain negative cases. This is bounded contract reuse, not proof of all Android apps or devices.

Historical artifact `4bfde593-7ef7-4c90-8be1-5384034437dc` and URI `content://media/external/images/media/2247` were not used to mint a fresh grant. ArtifactStore is execution-scoped, disposed after the previous run and has short TTLs. Metadata existence alone would not resurrect authorization. EXACT_URI_VIEW, GALLERY_UI_FIND and ARTIFACT_IDENTITY_VERIFIED remain explicitly distinct; none was newly accepted here.

## 5. Real Ollama Held-Out Results

Actual model: `qwen2.5:3b-instruct`. Sequential requests through existing scheduler, concurrency=1, num_ctx=2048, num_predict=256. Tasks were read-only, outside the T1-T5 wording:

| Task | Initial numeric-span result / elapsed | Source-text result / elapsed |
| --- | --- | --- |
| Please bring up the calendar | SAFE_BLOCKED, invalid span/dependency, 27,625 ms | SAFE_BLOCKED, absent/ambiguous source text, 19,009 ms |
| I'd like to visit gallery | SAFE_BLOCKED, invalid span/dependency, 5,942 ms | SAFE_BLOCKED, invalid coverage/dependency, 12,918 ms |
| Bring up calculator; then show history | SAFE_BLOCKED, truncated JSON at 256 output tokens, 21,988 ms | SAFE_BLOCKED, invalid coverage/dependency, 11,733 ms |

A follow-up capture of the first task's public raw proposal (22,167 ms) showed a fabricated `calendar: null` structured-state node, self-dependencies and a FIND_ARTIFACT interpretation with no capture. Validation rejected it before any review/discovery/device action. Schema status VALID means JSON shape passed, NOT that the plan was semantically accepted. Historical failed results were retained, not relabeled after prompt/schema changes.

Queue wait was 0-3 ms in these isolated samples. Load/service latency dominated; the first numeric run reported load 18,534 ms, 63 output tokens, eval 6,788 ms. The source follow-up reported load 13,709 ms and eval 6,408 ms. Cold/warm state differs, so these runs establish no speedup. Repeated testing means the later runs are diagnostics on the same held-out set, not a new independent holdout score.

Outcome coverage/decomposition/dependency validation was exercised and safely rejected bad proposals. Successful real interpretation review, model candidate choice and end-to-end held-out completion remain UNVERIFIED. No new templates were added to force these tasks through. The current model/configuration is not accepted as a reliable general-purpose planner.

## 6. Dashboard Acceptance

Browser connector failed with Transport closed. Native Windows browser access first timed out awaiting app approval, then stopped because it could not determine Chrome's current URL with sufficient confidence to enforce policy. No browser input was sent, no alternate debugging/proxy path was used to bypass that stop. Owner approval alone does not remove the tool's URL-safety requirement.

Agent V2 radio selection, visible Goal Graph, effect confirmation, Human Assistance, verified result rendering, safe-block rendering and cancellation through the browser: **UNVERIFIED in this request**. API execution and offline component tests are not browser acceptance. Dashboard source now includes the registered persistence strategy in artifact metadata; this rendering change is type/lint/build tested, not visually accepted.

## 7. Latency and Resources

Actual Clock navigation execution `9d1a6f26-68b1-433a-b197-717503c905ff`:

- Total: 25,058 ms; planning 583; Session setup 8,611; observation 10,796; execution 5,624; verification 11; reasoning/assistance 0 ms.
- Appium: 48 measured RPCs, 15,354.70 ms; source RPC 2,846.54; element RPC 1,604.15 ms.
- XML: 6 parses, 303.41 ms; recorded grounding 43.55 ms.
- ADB: 38 measured calls, 8,639.60 ms.

Categories overlap; they are not exclusive wall-time buckets. No comparable before/after benchmark exists for this transition. No security/fresh-state checks were reduced and no speed improvement is claimed.

Post-test host snapshot: total visible RAM 7,958 MiB, free 772 MiB; selected node processes (9) working set 264 MiB. The sampled Ollama launcher processes do not measure the model runner's total residency. These are point-in-time working sets, not peak RSS, GPU usage or per-execution allocation. No memory optimization or concurrency increase was attempted on this evidence.

## 8. Validation and Files

- Full regression: **395/395 PASS** including all prior 390 tests, zero skipped/failed in the completed run.
- TypeScript: **PASS**.
- Scoped ESLint: **PASS** after removing one new unused import.
- Full ESLint: unchanged baseline error `no-explicit-any` in `components/executions/ExecutionDetailModal.tsx:130`, plus 9 pre-existing unused-import warnings. A first lint pass also caught the new unused import; it was fixed, not suppressed.
- Production build: **PASS**; existing three dynamic tracing warnings retained.
- Controlled Android acceptance: read-only reconnaissance and tab transition verified; no persistent writes exercised.

Files changed in this increment (other dirty files predate it and remain intact):

- New registry: `lib/android/agent/record-persistence.ts`.
- Integration: `record-forms.ts`, `persisted-record.ts`, `verification-registry.ts`, `evidence-predicates.ts`, `artifact-store.ts`, `goal-graph.ts` under `lib/android/agent/`.
- Native targeting/readback: `lib/android/agent/ui-affordances.ts`, `grounded-candidates-v2.ts`, `lib/android/grounded-interactions.ts`.
- Constrained planning: `lib/android/agent/outcome-proposal.ts`.
- Artifact strategy display: `components/commands/AgentGoalPanel.tsx`.
- Diagnostic runners: `scripts/agent-v2-recon.cjs`, `scripts/agent-v2-held-out.cjs`.
- Regression: `tests/general-agent-v2-persisted.test.cjs`, `tests/general-agent-v2-widgets.test.cjs`.
- This report. Previous reports/history were not rewritten.

## 9. Remaining Unsupported / Unverified Work

Real Notes record creation is UNVERIFIED with no suitable app found. Samsung persisted alarm creation is SAFE_BLOCKED on missing evidence contracts; only editor inspection was approved. AM/PM, spinner button stepping, rotary/date widgets and arbitrary selections remain unsupported. Post-Save strategies require trustworthy explicit inventory/identity/time metadata; they do not magically derive it from Samsung row positions. Gallery UI identity mapping and viewer handoff of a currently authorized artifact remain unaccepted. Real Ollama held-out planning and interactive Dashboard assistance/cancellation are not accepted.

The existing generic CREATE candidate vocabulary also does not yet bind the observed localized Add-alarm label to the structured-state outcome. Diagnostic editor navigation used the exact observed label with separate owner permission, not the autonomous CREATE executor. This limitation remains alongside the identity/format/enabled evidence blockers; the read-only diagnostic success must not be presented as autonomous alarm creation.

Next controlled writes require explicit owner approval after an evidence-capable app/provider is identified. A new photo must not be taken to compensate for an expired artifact without fresh permission. Deployment readiness remains development/opt-in, not universal autonomous Android control.

Final cleanup check: updated idle worker reloaded; Dashboard runtime HTTP 200, zero QUEUED/RUNNING/WAITING_HUMAN tasks. Owned reconnaissance contexts were closed in finally. No commit or push performed.
