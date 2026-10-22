# Owner-Authorized Non-Destructive Testing

Date: 2026-10-19. Agent V2 only; V1 and ordinary V2 remain separate.

## Using the Mode

1. In Dashboard, open Goal Agent and select Agent V2.
2. Select the connected, identity-verified Android device.
3. Turn on **Che do thu nghiem chu so huu**. The backend checks serial, physical identity and idle ownership before enabling it.
4. Start a V2 goal. The Dashboard explicitly opts that job into the selected device's authorization.
5. Turn the switch off to revoke it. Active executions using that authorization are cancelled; other devices/ordinary executions are not cancelled.

The authorization lasts 30 minutes and is bound to BOTH selected transport serial and physical device ID. It does not follow another phone or automatically transfer to a USB/Wi-Fi alias. Worker restart starts with the mode OFF. Historical task metadata/audit logs never restore authority. Enabling while the selected physical phone is busy is refused; disabling remains available.

This is not a global `.env` bypass. It does not change legacy Action Plan policy or the V1 default. An ordinary V2 job without `ownerAuthorizedTest: true` retains its usual effect confirmations even if a device has an enabled authorization.

## Scope and Limits

For an opted-in execution, the registered capability contract may obtain automatic EFFECT_CONFIRMATION for one requested capture, creating an exact new record/alarm, a requested supported boolean state, or calculation. Each actual action still needs a fresh grounded candidate, a one-shot effect grant and registered verification. Automatic approval is logged; no fake human token or reply is generated.

Read-only launch/navigation/scroll uses the existing primitives and device isolation. An unfamiliar generic menu/item ID is not enough to prove a command is non-destructive in this mode: native tab/navigation evidence is required. Destructive labels, hints, resource tokens and destructive request action words are denied, including common English/Vietnamese delete, reset, clear, uninstall, format, overwrite and cleanup variants. These checks do not infer safe behavior for every possible app/language; unclassified operations remain unsupported or blocked.

Existing data is not cleared to make a test succeed. New-record execution still requires its observed New/Create transition and supported draft/persistence evidence; existing/dirty editors are not overwritten. Uncertain Save/capture/input is never replayed. There is no arbitrary model shell primitive and no deletion/uninstall/reset permission in the owner policy.

Permission dialogs, ambiguous app/field/target, unknown widgets, missing persistence/identity, locked screens, unsupported outcomes and GOAL_INTERPRETATION review are NOT automatically approved. The mode removes redundant ownership prompts, not missing evidence. It does not implement unsupported YouTube search, Notes, Calendar or Clock workflows merely by authorizing them. Communication/posting/payment/credentials remain outside automatic owner-effect approval; unsupported explicit external goals still require a separately implemented and validated capability.

## Backend Contract

- Enable: `SET_OWNER_TEST_MODE`, exact `deviceId`, current backend-verified `physicalId`, `enabled: true`.
- Disable: same device/physical identity, `enabled: false`, current `authorizationId`.
- Start: an Agent V2 job with explicit `ownerAuthorizedTest: true`; the server binds an in-process issued execution scope. Client flags alone, cloned scopes, stale IDs and historical journal entries are not authority.
- GET runtime returns `ownerTestModes` and a bounded metadata-only policy audit, plus per-task historical mode metadata.
- Same-origin/loopback checks, worker bearer ownership and strict command schemas remain in effect. Old workers reject the feature; there is no fallback to an unguarded backend.

Enable is committed only after its durable audit append. Audit failure cannot expose a usable authorization. Mode changes append metadata to `owner-test-policy-audit.jsonl` inside the worker's OS runtime directory, not Git. Existing execution journaling retains the authorization ID and automatic approval/action progress. No permission token, screenshot bytes, API key or note body is added to the policy log.

Revocation is checked when issuing/consuming effect grants and immediately before native dispatch, including between clear/value commands in an authorized new editable field. Expiry also contributes an execution abort signal. Backend Session creation compares the observed hardware identity to the authorized identity; the existing Session identity checks continue afterward. An action already sent may complete before cancellation; cancellation does not roll it back or delete its result.

## Acceptance Runner

Use the configured Node executable, for example on this workstation:

```powershell
& 'C:\nvm4w\nodejs\node.exe' scripts/agent-v2-acceptance.cjs --run --device 192.168.1.17:33081 --goal 'Mo camera va chup anh' --owner-authorized-test
```

This command creates a real photo. It is appropriate only when owner testing is authorized. The runner checks the graph and backend physical identity, enables mode explicitly if necessary, starts the opted-in job, then revokes the authorization it created in finally. An already-enabled owner authorization is not silently disabled by the runner. Technical assistance is never auto-confirmed; the unattended runner cancels rather than guessing. The old single-photo-confirmation path remains available for ordinary mode.

The runner never automatically removes test data. Newly created photos/records/alarms remain on the phone.

## Real Samsung Acceptance

Execution `9370db9f-1238-49bd-b86e-f3d2705822ba`, Samsung A50s R58MA78W6QK via `192.168.1.17:33081`:

- Owner mode enabled, backend-bound and later disabled: **REAL_DEVICE_VERIFIED**.
- Goal `Mo camera va chup anh`: **COMPLETED**, total 33,673 ms.
- One native grounded interaction/shutter dispatch; zero human-assistance events; assistanceMs=0; one automatic scoped-effect approval event.
- New media `content://media/external/images/media/2248`, image/jpeg, 3,418,948 bytes.
- Artifact `d161ff7c-8ea7-4f52-9a43-a6700a1242ed`, provider MEDIA_STORE_V2, evidence `155b283d-c373-4b59-a10f-726694df42cb`; new URI/owner/time/size validated by the existing media verifier.
- Authorization `a62399b9-9f70-418f-8925-4c438206018f`; policy trace ENABLED -> BOUND -> DISABLED. Final runtime check: no active tasks and no enabled owner modes.
- No image bytes sent to AI, no image deletion, no existing data replaced. The new test photo remains on the phone.

Timing: planning 2,098 ms; Session setup 6,188; observation 16,284; execution 13,012.91; verification 4; inference 0. Counters: 67 Appium RPCs / 20,804.61 ms, source RPC 8,194.19 ms, element RPC 1,858.21 ms, 9 XML parses / 246.21 ms, grounding 56.73 ms, 62 measured ADB calls / 12,203.51 ms. Categories overlap and do not sum to exclusive wall time; no speedup is claimed.

The photo acceptance ran before final additional fail-closed refinements to generic unknown-menu filtering, pre-Session expected-physical-ID comparison and audit-before-enable commit. The original successful trace is retained, not relabeled as a new run. Those refinements are separately regression tested; no second photo was taken just to rerun acceptance.

Dashboard control rendering and HTTP policy integration are tested offline. Real interactive browser switch acceptance is **UNVERIFIED**, not claimed from API/runner success. Real record/alarm/calendar writes and Gallery lookup were not accepted in this pass; their previously documented evidence limitations remain.

## Regression and Files

Final validation: **406/406 regression tests PASS**, TypeScript PASS, scoped ESLint PASS, production build PASS. Full ESLint still reports the baseline `no-explicit-any` at `components/executions/ExecutionDetailModal.tsx:130` and 9 existing unused-import warnings outside this increment. The first scoped lint pass caught a render-time Date.now call; the control now uses existing clock state and the final pass is clean. Three existing build tracing warnings remain. `git diff --check` passed.

New tests cover default-off and V2-only opt-in; device/physical/execution isolation; expiry, revocation and cloned-scope rejection; denial on audit failure; normal-mode confirmations; automatic owner effects; uncertain/wrong results; no existing-record overwrite; no Save replay; dangerous controls/goals; unfamiliar menu commands; pre-Session physical mismatch; active A revocation without cancelling B; HTTP origin/identity checks; durable audit/restart OFF; and explicit Dashboard control rendering.

Implementation: `owner-test-policy.ts`, runtime schema/registry, worker server/client, V2 loop and persisted-record executor, effect grants/native dispatch, candidate filtering, optional expected physical identity in Session/context accounting, Dashboard/hook, acceptance runner and owner-mode regression tests. No dependencies, model settings, APKs or global policy variables changed. No commit/push performed.
