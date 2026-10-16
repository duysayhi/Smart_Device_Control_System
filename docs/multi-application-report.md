# Multi-Application Native Navigation

Date: 2026-10-16. Extends the existing Goal Agent, not a new milestone or replacement executor.

## Implemented

- Per-device application discovery through Android Package Manager. Standard category intents resolve Camera, Calendar, Calculator and Gallery without vendor package hardcoding. Other names require an exact package or a unique exact package-token match among enabled launcher activities. Missing/ambiguous defaults stop with an explicit error rather than choosing a phone manufacturer's package. Friendly display-label recognition is not implemented.
- Process-owned discovery evidence binds the goal to its package and serial. JSON/model flags, copied goals and another phone cannot mint that evidence. Restart still does not resume actions. Discovery reads only; it never installs/uninstalls, launches an app or accepts permissions.
- Existing Chrome, YouTube and Settings flows remain. New generic goals support opening a discovered app, finding a visible native text element and opening a bounded read-only native destination. Public Action Plan schema is unchanged; use the Goal Agent tab.
- Native read candidates use actual unique selectors, enabled/visible elements, goal-related read labels, native navigation roles, a safe clickable owner and no state-changing descendants. Switches, permission dialogs, focused editors, foreign packages/devices and WebViews cannot authorize generic clicks. Unknown controls still stop safely.
- A unique exact read destination can be chosen without Qwen. When routes compete, the existing shared reasoning queue compares only supplied candidate IDs; the model cannot invent raw selectors, coordinates or completion. Candidate identity and UI geometry are revalidated before dispatch.
- Completion requires the requested native heading, including a non-clickable heading inside a toolbar. A tab label/result row alone is not completion evidence. Intermediate read-navigation transitions are verified separately from final goal completion. Generic exploration uses bounded grounded native scroll candidates instead of the legacy opaque discovery recovery branch.

Examples:

```text
Mở camera
Mở com.sec.android.app.popupcalculator
Mở <installed.package> và tìm <exact visible text>
Mở <installed.package> và mở trang Albums
```

Exact packages in examples are device-specific examples, not hardcoded resolver mappings. On the tested Samsung the standard calculator category returned no activity, despite a valid calculator launcher; its exact package works. Not every OEM advertises every standard category.

## Verification

New automated coverage includes vendor-independent Camera intent resolution, package/name ambiguity, injection/cancellation, trusted goal binding, device isolation, scope preservation, grounded read controls, duplicates/staleness/WebView rejection, destination evidence, generic find/scroll, constrained reasoning, exact-match rules, the full simulated native loop, Recovery integration and toolbar ancestry. Mocks are not physical multi-app or multi-device proof.

**Automated PASS:** 265/265 full regression tests, including 16 new multi-app tests. TypeScript and scoped ESLint passed. The final additional unsupported-outcome assertion also passed in the focused 16-test suite. No production build result is claimed.

**Real Dashboard / Samsung A50s `R58MA78W6QK`:**

| Test | Result | Evidence |
| --- | --- | --- |
| Open installed Calculator | PASS | Execution `117b718e-a37a-4b65-ab75-556644b13c32`, COMPLETED 1/1, independently verified `com.sec.android.app.popupcalculator`, 9.901 s, 3 snapshots, 1 action, 0 AI calls. |
| Open Clock and find the phrase supplied as Alarm | BLOCKED | Execution `e8269f67-ddf8-44c1-8999-559e9dd799cf`, 1/2, 12.040 s. Exposed a legacy Recovery/policy mismatch; the integration was fixed and given a regression test. The actual UI label was different from the supplied phrase; no alarm was created or toggled. |
| Select World Clock with real Qwen | BLOCKED | Execution `d5232d23-4b2e-4455-830d-b62867b12347`, 1/2. Qwen timed out after 45.816 s; total 66.099 s, no click sent. This is not passing real AI reasoning. |
| Retry exact native destination | BLOCKED | Execution `20158175-2f2d-4b54-bb63-a1b1fa00d033`, 1/2, 10.499 s, no action sent. Read-only Appium diagnosis then showed keyguard/AOD nodes despite Clock being reported as foreground. |
| Retry after user unlock, Dashboard to World Clock | PASS | Execution `e00ad15a-6200-44a7-943d-a49536999f4c`, COMPLETED 2/2, 19.685 s, 6 snapshots, one grounded `CLICK text:Giờ quốc tế`, zero scrolls/retries/model calls. Final native heading was independently verified; task finished after cleanup. The live ADB preview also showed World Clock content with London and Hanoi. |

The keyguard finding resulted in an additional guard and regression test: a foreground package behind a lock screen or without visible app content cannot authorize actions or prove completion. After the user unlocked the phone, **the final native-click acceptance passed on this Samsung**, as recorded above. This proves exact grounded native navigation, not successful real Qwen reasoning or all Android brands. The final worker was reloaded idle to use these guards. Read-only diagnostic Sessions were closed, and the known temporary hierarchy file was removed. No alarm was created, enabled or changed.

[Dashboard evidence screenshot](multi-application-dashboard.png) displays the historical successful Calculator result, not a claim that the later Clock execution passed.

The live World Clock preview was visually inspected during this test. Saving the Clock screenshot was interrupted by browser-control timeouts, so no saved Clock screenshot is attached.

## Limits

- This is a bounded native read/navigation extension, not arbitrary autonomous app control. The read-label/navigation-role classifier is intentionally conservative; unfamiliar semantics, resource roles or languages can be blocked.
- No generic capture/photo-save verifier, message sending, alarm creation, settings mutation, login, payments, deletion or automatic permission granting was added. Human Assistance for such authorization is not enabled by this change.
- No new visual model or coordinate-click fallback. Apps exposing only canvas/image/WebView content need additional trusted observation support; do not claim they are covered.
- Generic search-input entry and arbitrary multi-app workflows are not added. Existing specialized search flows remain unchanged. Finding a label means visibility, not opening its page.
- Qwen can still time out. Model context and queue are unchanged; an unsuccessful reasoning request sends no guessed action. No new model was installed or configured.
- Only one Samsung is available. Cross-manufacturer resolution is simulated; real physical multi-manufacturer acceptance is not claimed. Rebooting the worker loses ephemeral application grants by design and never replays old operations.

## Files

- `lib/android/agent/application-discovery.ts`: Package Manager resolution and process-owned grants.
- `lib/android/agent/native-navigation.ts`: conservative native context/control/page evidence.
- `goal-planner.ts`, `schema.ts`, `device-runtime.ts` in the same directory: generic goals and selected-device planning.
- `action-candidates.ts`, `decision-engine.ts`, `candidate-verifier.ts`, `evaluator.ts`, `agent-loop.ts`, `recovery.ts`: grounded decisions, policy integration, verification and compatibility with recovery.
- `tests/multi-application.test.cjs`, `README.md`, this report: regression tests and operation notes.
- `tests/native-app.integration.cjs`: current-screen read-only Appium diagnosis; never opens an app or sends a gesture. Do not run alongside a Dashboard task on the same phone. It prints local UI labels, so inspect/redact its output before sharing.

```powershell
node tests/native-app.integration.cjs SERIAL INSTALLED_PACKAGE "Exact target text"
```

Existing dirty files from earlier work were preserved. No commit/push, APK install/removal, model change, public Action Plan schema change or Security Policy disablement was performed.
