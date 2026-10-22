# M6c - Alarm / Timer UI Evidence

## Task A: REAL_ANDROID, read-only survey

Branch: DuyTD. No commit/push. Survey used one owned USB Appium Session,
closed in finally. No Save, Start, permission grant or private database access.

Evidence directory:
`C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6c-survey-nT9OEj`.

| Source | Actual result | Proves | Does not prove |
| --- | --- | --- | --- |
| settings next_alarm_formatted | Readable, empty | Setting can be read | No usable alarm identity or time |
| dumpsys alarm | Readable; next-alarm section and RTC_WAKEUP entries | Scheduled system wakeups | RTC_WAKEUP can be unrelated; not new-only Clock identity |
| dumpsys notification | Readable; next-alarm metadata | System scheduling corroboration | Not a Clock record inventory |
| dumpsys statusbar | Readable; no matching indicator | No usable indicator returned | Absence does not prove no alarm |
| Clock alarm UI | Three rows: 00:15 OFF, 06:00 OFF, 07:30 OFF | Displayed times and switch states | Alone not database identity or exhaustive inventory |
| Clock timer UI | Three NumberPicker EditTexts, unit labels, Start | Editable duration affordances | Not proof of running timer |

`time_12_24=null`; timezone `Asia/Ho_Chi_Minh`. Format cannot be assumed
from the absence of an AM/PM control. Notification output retained only
alarm-related metadata, not notification bodies. Survey profiling: 42 Appium
RPCs and 37 ADB calls; these counts overlap wall-clock spans and are not summed
as elapsed task time.

## Root Causes

1. M6b deliberately required a readable complete provider inventory. That cannot
   verify creation on the previously observed permission-denied provider; a UI
   transition or successful Intent receipt must not masquerade as persistence.
2. Actual NumberPicker inputs share resource IDs and include units in their
   accessible text. An ID-only locator or raw string equality cannot uniquely
   bind hour/minute/second or verify their values.
3. Showing a matching alarm time or timer preset does not prove a NEW alarm or
   RUNNING timer. Baseline/delta checks and independent repeated reads are needed.
4. A transport failure after Save/Start leaves an uncertain effect, not permission
   to retry. Per-step grants alone also need a commit-attempt ledger across
   replacement scopes within the same execution/node.

## Implementation

The M6b provider path remains first choice. Only
`TEMPORAL_PROVIDER_UNAVAILABLE` from the read-only inventory preflight permits
the new UI path. A failed or uncertain native dispatch never falls back to UI.

| Tier | Contract | Strength / limitation |
| --- | --- | --- |
| PROVIDER_READBACK | Existing independently queried provider inventory and persisted identity | Strongest existing contract; unchanged |
| SYSTEM_STATE_READBACK | Unique next-alarm-clock trigger time consistent with requested local time | Additional corroboration ONLY, not new-item identity; arbitrary RTC_WAKEUP or DND notification time is not accepted |
| UI_LIST_READBACK | Complete baseline plus two distinct fresh complete list inventories, exactly one new enabled row, unchanged old times/switches | Weaker than provider; accessibility representation, not database identity |
| UI_RUNNING_READBACK | Exact duration form before one Start; two fresh running UI reads with decreasing remaining time | Timer-specific UI tier; not a provider identity claim |

### Generic Contracts

- `temporal-ui.ts`: reviewed VN/EN semantic labels, NumberPicker parent/unit
  roles, numeric readback including unit-decorated text, 12h selected AM/PM,
  observable 24h picker-range evidence, source-bound backend scopes, single-use
  steps, independent UI deltas and timer proof. JSON copies cannot mint scopes,
  candidates, inventories or proof.
- `temporal-ui-inventory.ts`: native top/bottom scroll termination, bounded
  scans, continuity/progress checks, old-row state consistency, unique times,
  readable switch states and freshness. It never clicks an alarm row/switch.
  Unknown termination, duplicate identities, occlusion or stale scans block.
- `temporal-ui-runner.ts`: preflight, fresh baseline after confirmation, create
  new editor, exact field values, one Save/Start, read-only outcome verification.
  Uncertain commit only permits bounded observation, not another commit.
- Existing candidate/grant/native-interaction plumbing is reused. Each field or
  mutating press still obtains a five-second single-use grant, is re-observed,
  re-bound to its native target and checked for occlusion. No coordinate/selector
  fallback and no vendor package/resource-ID literals were added to runtime.
- Full-control writes still require M6a authorization and durable journal
  records; ordinary owner and normal confirmation behavior remain unchanged.
  UNKNOWN is not rewritten into ACKNOWLEDGED even if late readback proves the
  result. New records are never automatically removed or restored by deletion.
- Commit-attempt protection also spans newly issued UI scopes for the same
  device/execution/node. Expired/uncertain/acknowledged Save/Start is not replayed.
- New progress fields and the existing Dashboard/history completion reason
  disclose the tier and LEFT-IN-PLACE identity. The Goal Agent panel displays
  the explicit tier. No unified entry point or planner redesign was attempted.

### Natural Phrasing

The source-exact parser also recognizes `báo thức lúc 6 rưỡi sáng` and
`báo tôi sau 5 phút`, including unaccented forms. Vietnamese, English and mixed
duration units preserve typed hour/minute or seconds through the graph.
`đặt báo thức 3:30` asks one AM/PM question with two options and a suggested AM
label; the suggestion is NOT an approval or default execution. Existing
structured-form syntax remains separate and unchanged. Unsupported date/repeat
qualifiers are retained as unsupported, and cross-device-timezone scheduling is
blocked rather than silently converted. These are deterministic interpretation
rules, not evidence of new LLM reasoning.

## Android Acceptance Status

**UNVERIFIED: no M6c alarm or timer creation has run.**

The initial read-only survey really ran on unlocked USB Samsung A50s. Before
the subsequent new-inventory probe, `adb` returned
`device 'R58MA78W6QK' not found`. A further `adb devices -l` returned an empty
list. This readiness failure is not a counted acceptance task. The owner's
latest instruction is **develop code first, test the device later**. Therefore
no more real-device probes, creation tasks or acceptance runs are performed in
this turn. No substitute device/transport was selected.

| Goal | Status | Counted runs | Evidence tier achieved |
| --- | --- | ---: | --- |
| New 07:00 alarm | UNVERIFIED, USB unavailable | 0 | None |
| New 600-second timer | UNVERIFIED, USB unavailable | 0 | None |
| Ambiguous 3:30 on real runtime | UNVERIFIED | 0 | Offline clarification test only |

No success rate is calculated with zero real creation tasks. No false-completion
rate can be inferred; there are zero real claimed completions to audit.
No new alarm/timer is claimed LEFT-IN-PLACE. In particular the existing
00:15/06:00/07:30 alarms and the ten-minute preset are NOT M6c-created artifacts.
No Save/Start was sent, no permission was granted, no private DB was read and
no existing alarm/timer was edited or removed during M6c.

`scripts/agent-v2-m6c-acceptance.cjs` prepares the Dashboard-facing runtime path,
checks an idle worker/source hash and USB identity, freezes the Android runtime
digest, forwards interpretation only for the exact authorized typed outcome,
uses device-scoped full-control and cancels/settles/disables scope in finally.
It captures screenshot/native XML for manual audit, per-task timing/RPC/ADB/model
metrics and journal excerpts. This runner's presence is NOT proof that the
Dashboard or data-creation flow has passed on Android. There is no frozen
creation-run hash or creation latency to report because the run has not begun.

## Validation

First validation: 841/841 tests in 50 files (803 baseline + 38 M6c), TypeScript,
scoped ESLint, webpack production build, diff check and source secret scan PASS.
Known full ESLint failure is unchanged:
`components/executions/ExecutionDetailModal.tsx:130:98`,
`@typescript-eslint/no-explicit-any`, with nine pre-existing warnings.
That unrelated file was not edited.

First wrapper evidence:
`C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6c-validation-ItAKcI\summary.json`.
Regression 223.90 s; typecheck 13.09 s; scoped lint 49.02 s; full lint 19.40 s;
webpack build 204.84 s, true child exit 0. Secret scan: 327 text files, zero
matches. These are separate tool intervals, not inference/device latency.

Additional focused inventory tests: 43/43 PASS, including native top/bottom
termination, missing termination, bounded exhaustion, foreign overlay and
keyguard; all use fake adapters and are OFFLINE_TESTED, not REAL_ANDROID.

### Final Validation

Final wrapper evidence:
`C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6c-validation-XLMmhW\summary.json`.

| Check | Actual result | Interval |
| --- | --- | ---: |
| Full regression | 846/846 PASS, 50 files = 803 existing + 43 M6c | 326.30 s |
| TypeScript, no emit / no incremental | PASS, exit 0 | 9.75 s |
| Scoped ESLint | PASS, exit 0 | 8.22 s |
| Full ESLint | Known unrelated 1 error / 9 warnings only | 17.93 s |
| next build --webpack | PASS, actual child exit 0 | 99.89 s |
| git diff --check | PASS, only existing LF/CRLF warnings | Not a latency benchmark |
| Source secret scan | 327 text files, zero matches | Not a latency benchmark |

After the final source/value and action-widget assertions, focused M6c was run
again: 43/43 PASS, exit 0, test-runner interval 3.797 s. No runtime source was
changed after the final build. These measurements are not added to each other
or to device time. The earlier full run and repeated focused run are not extra
independent samples of Android success.

Secret-scan exclusions: environment files, dependencies, build output, Git,
sealed/holdout and external logs/tool transcript. No key value is printed.
Configured non-secret fields were read back: model `qwen2.5:3b-instruct`,
provider `ollama`, cloud reasoning OFF, Groq command-text tier OFF. No provider,
model or configuration was changed; no sealed/holdout access, commit or push.

Android-source SHA-256 for the final offline source (NOT a real acceptance run):
`d6c78f256eabed7578553894682d36b81c474767a9ce4beca20f04a98ab1b830`.

Last read-only Dashboard cleanup check before the deferral: HTTP 200, active
tasks 0, owner modes 0, inference running 0 / waiting 0, devices empty. No M6c
creation owner scope was enabled. The survey's owned Session was already closed.

## Files Touched In M6c

New: `lib/android/agent/temporal-ui.ts`, `temporal-ui-inventory.ts`,
`temporal-ui-runner.ts`; `tests/agent-v2-m6c.test.cjs`;
`scripts/agent-v2-m6c-survey.cjs`, `agent-v2-m6c-validation.cjs`,
`agent-v2-m6c-acceptance.cjs`; this report.

Modified: `lib/android/agent/temporal-contract.ts`, `agent-v2.ts`,
`goal-graph.ts`, `grounded-candidates-v2.ts`, `effect-grants.ts`,
`local-effect-journal.ts`; `lib/android/grounded-interactions.ts`,
`lib/android/condition-executor.ts`; `components/commands/AgentGoalPanel.tsx`.
All pre-existing uncommitted work is preserved.

## Limits

- Real-device UI alarm/timer execution, screenshot false-completion audit and
  Dashboard/history rendering of an actual temporal result remain UNVERIFIED.
- Without visible AM/PM selection or observed 24h picker-range evidence, the
  alarm form blocks. `time_12_24=null` and two numeric inputs alone are NOT
  evidence of the intended period. The surveyed default form may hit this
  blocker; that is an inference, not an acceptance result.
- Unlabelled/custom wheels, single opaque AM/PM spinners, radial-only pickers,
  ambiguous control roles, inaccessible list rows and very long lists whose
  complete fresh scan exceeds five seconds remain unsupported / SAFE_BLOCKED.
- Empty collections without a provable structural inventory are conservatively
  blocked. Duplicate-time rows cannot be disambiguated by latest item or title.
- Timer proof requires a uniquely readable colon-format countdown and an
  observed Pause control, no editable picker and no running/paused timer at
  preflight. Other visual representations are not guessed.
- UI_LIST_READBACK does not prove a private provider ID, future audible ringing,
  OS process-restart durability or arbitrary Clock application compatibility.
- System clock evidence can be absent or unrelated. This is why the survey's
  DND/RTC metadata is not used as new-only evidence.

## What This Does And Does Not Demonstrate

The implementation connects existing typed outcomes, grounded actions,
permissions/journals and explicitly weaker independent UI proofs without a
Samsung workflow or new model prompt. Offline tests demonstrate those contracts
against controlled fixtures; the survey demonstrates actual read access to
Samsung Clock and system metadata. Neither demonstrates that an alarm has been
created or a timer has run successfully. Until the authorized USB acceptance
and manual audits pass, M6c must not be advertised as completed on real Android,
nor as general autonomous LLM support for arbitrary applications.
