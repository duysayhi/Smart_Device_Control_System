# Hybrid Connectivity Implementation Report

Date: 2026-10-18. Real-device acceptance deferred at the user's request.

## Product Status

| Area | Status | Evidence / scope |
| --- | --- | --- |
| USB and Wi-Fi selection | IMPLEMENTED | Existing Dashboard, Action Plan and Agent paths accept verified wireless transports. |
| Android 11+ without USB | IMPLEMENTED, NOT TESTED REAL | Interactive `adb pair` terminal fallback, then Dashboard Connect. No API or storage accepts pairing codes. Requires vendor Wireless Debugging support. |
| USB to TCP/IP | SIMULATED PASS | Correct USB serial, allowed phone IP/port, shared ownership guard, hardware identity comparison. Not exercised on Samsung. |
| Connect / disconnect / reconnect UI | IMPLEMENTED | Wi-Fi tab, typed forms, mDNS discovery, bounded reconnect, actual errors and Session/execution ownership display. |
| Appium over Wi-Fi | SIMULATED PASS | Endpoint UDID, existing independent port leases, no APK installation and no duplicate Session. Real Session NOT TESTED. |
| Agent / cancellation / recovery isolation | SIMULATED PASS | Existing runtime/Agent reused; alias exclusion, cancellation, disconnect and no implicit replay/fallback checked with fake adapters. |
| USB unplugged operation | NOT TESTED | No unplugged Samsung execution, screenshot or verification claimed. |
| Identity / duplicate transports | SIMULATED PASS | Hardware-based identity, physical locks and planning reservations. Dashboard collapses verified aliases to one physical card. |
| Two real devices | NOT TESTED | Second-device isolation uses fake adapters; not a real multi-device PASS. |
| Dashboard rendering | PASS | Desktop 1440x1000 and narrow 450px viewport; connection region has no horizontal overflow. |

## Verification

- Full suite: **310 tests passed**, zero failed/skipped, approximately 21.1 seconds.
- TypeScript `tsc --noEmit`: PASS.
- ESLint over changed/new TS, TSX and CJS files: PASS.
- `git diff --check`: PASS (normal Windows line-ending warnings only).
- Local Dashboard and wireless state API: HTTP 200.
- API tests cover same-origin checks in development mode, strict input validation,
  rejection of raw commands/pairing-code payloads and mutation rate limiting.
- Source report: ignored `.next/hybrid-tests.tap`.
- Screenshots: ignored `.next/hybrid-dashboard-desktop.png` and
  `.next/hybrid-dashboard-mobile.png`.

## Ownership and Reconnection

The existing executor still owns Session creation, action dispatch and cleanup.
Shared serial/hardware/physical locks prevent USB/Wi-Fi aliases opening competing
Sessions. The existing runtime additionally reserves ownership while planning,
so connection changes cannot interrupt an Agent before Session creation.

Disconnect aborts that transport's execution; another USB alias is not selected
as an execution fallback. Reconnect is restricted to trusted endpoints, with
three finite attempts and exponential backoff. It restores ADB only and never
replays an action, resets budgets, resumes an execution or creates a new Session.

If physical identity disappears or changes, no new action or screenshot is
accepted. Cleanup that might affect a replacement phone is refused; Session,
ports and device ownership are retained for explicit inspection, not silently
discarded. This is a deliberate blocked/uncertain-cleanup state, not a claim of
successful cleanup.

## Real Timing Matrix

| Measurement | USB | Wi-Fi |
| --- | --- | --- |
| ADB connection / health | NOT MEASURED | NOT MEASURED |
| Appium Session creation | NOT MEASURED | NOT MEASURED |
| Screenshot | NOT MEASURED | NOT MEASURED |
| UI hierarchy | NOT MEASURED | NOT MEASURED |
| Simple verified action | NOT MEASURED | NOT MEASURED |
| Execution stability and real reconnect count | NOT TESTED | NOT TESTED |

No USB/Wi-Fi performance comparison or WIRELESS REAL ANDROID PASS is claimed.
`tests/hybrid-android.integration.cjs` records these probe timings later and can
require USB to be absent. Real Dashboard Agent acceptance remains a separate test.

## Main Files

- `lib/android/transport-identity.ts`: transport classification and physical evidence.
- `lib/android/wireless-endpoint.ts`: LAN/private-address and port validation.
- `lib/android/wireless-store.ts`: shared endpoint metadata, never pairing codes.
- `lib/android/wireless-manager.ts`: connect, conversion, reconnect and disconnect.
- `lib/android/appium/session-manager.ts`: alias-aware ownership and safe cleanup.
- `lib/android/state-observer.ts`: verifies physical identity around live snapshots.
- `lib/android/agent/device-runtime.ts`: physical scheduling and planning reservations.
- `app/api/devices/wireless/route.ts`: typed, same-origin, rate-limited API.
- `components/devices/ConnectionManager.tsx`: integrated USB/Wi-Fi controls.
- `lib/android/device-selection.ts`: physical deduplication and transport selection.
- Existing execution, preview, Dashboard and Agent selection paths were extended,
  not replaced. No new AI model, reasoning queue or recovery engine was introduced.

## Remaining Limits

- Pairing is interactive terminal-only, not a Dashboard PIN-submission API.
- Managed endpoints are private IPv4 only; IPv6-only LANs are not supported yet.
- Unknown/inconsistent hardware identity is blocked rather than guessed or merged.
- Reconnect/disconnect controls manage explicitly registered endpoints. A manually
  paired auto-connected ADB transport can be used after identity verification;
  register its IP/connection port through Connect for managed reconnect controls.
- A changed Wireless Debugging port needs discovered or manually entered details.
- Stale/uncertain ownership needs explicit inspection; no automatic lock deletion.
- A successful ADB connect is not proof of real Appium or complete Agent acceptance.

See [setup and acceptance instructions](hybrid-connectivity.md).
