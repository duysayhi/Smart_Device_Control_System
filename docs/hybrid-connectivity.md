# Hybrid USB / Wi-Fi Android Control

## Connection Paths

- USB: existing authorized ADB device.
- Android 11+ Wireless Debugging: pair interactively in a terminal, then connect
  from Dashboard with the debugging IP and connection port. USB is not required.
- Classic ADB TCP/IP: select an idle, authorized USB device and choose
  **USB -> Wi-Fi**. This path requires USB once, not for future executions.

Android 11 alone does not prove that a vendor exposes Wireless Debugging.
Never enable Developer Options, install APKs or change firewall settings automatically.

## Wireless Debugging Without USB

1. On the phone, open Developer options and enable Wireless debugging.
2. Use a trusted private network reachable from the PC.
3. Open **Pair device with pairing code** and note its pairing IP/port.
4. In a terminal, run `adb pair <PHONE_IP>:<PAIRING_PORT>` and type the code
   at the interactive prompt. Do not put the code in command arguments or chat.
5. Return to the main Wireless debugging screen. Its **connection port** can be
   different from the pairing port.
6. Open Dashboard -> Connection Manager -> Wi-Fi, enter IP/connection port and
   press Connect. ADB mDNS connect services on the allowed LAN can also populate
   these fields. Discovery never means pairing or connection has succeeded.

The application intentionally does not accept pairing codes in its API, browser
storage or logs. Terminal pairing is the supported fallback; the UI shows the
interactive command but never asks for the code. The backend verifies ADB state
and consistent hardware serial/manufacturer/model before a wireless Session.

Official references:
- https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi
- https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/docs/dev/adb_wifi.md

## USB to Wi-Fi

1. Connect an authorized USB phone and keep it on Wi-Fi.
2. Finish all existing executions and close external Appium Sessions.
3. In Connection Manager -> Wi-Fi, choose the USB device and TCP/IP port.
   Leave IP empty to read the current `wlan0` address, or enter it explicitly.
4. Press **USB -> Wi-Fi**. This is the only path that issues `adb -s SERIAL tcpip PORT`.
5. Backend connects, verifies the same hardware identity, and selects the Wi-Fi serial.
6. Unplug USB yourself. Refresh and start a **new** execution over Wi-Fi.

Classic TCP/IP debugging exposes ADB on the local network. Only use trusted LANs.
Disconnect removes the workstation's ADB connection, not the phone's debugging
listener. Disable wireless/TCP debugging on the phone after testing if appropriate.

## Network and Ownership Rules

- Only RFC1918 IPv4 on the PC's actual local subnets is accepted by default.
- Administrators can override the subnet list with
  `ANDROID_WIRELESS_ALLOWED_CIDRS`, a comma-separated private CIDR allowlist.
  Public, loopback, link-local and multicast targets are rejected.
- Ports are validated integers 1024..65535. Only typed ADB operations are accepted;
  arbitrary shell commands, URLs and pairing-code payloads are rejected.
- Connection-changing API calls require a matching local Origin/Host and are
  limited to eight requests per minute. Development policy does not bypass this.
- Registry metadata is stored under the existing OS-temp runtime directory, not
  in Git. Atomic writes and a cross-process connection-management lock serialize updates.
- Identity is derived from matching `ro.serialno`/`ro.boot.serialno` plus
  manufacturer/model. It is not derived from IP and is not a cryptographic device
  certificate. Missing/inconsistent evidence means no automatic merge and no
  wireless execution; inspect the device through another trusted method.
- USB and Wi-Fi aliases share physical/hardware/serial locks. Runtime rejects
  two jobs for one physical phone before planning. Appium still uses the chosen
  transport as UDID and retains the original independent port allocator.
- Connection status and Session/execution ownership are visible on the Dashboard.
  A stale/uncertain lock is retained for manual inspection, never silently deleted.

## Disconnect and Reconnect

During execution, transport loss stops further work and marks that execution
DISCONNECTED; an available USB alias is **not** used as a fallback. No side-effect
action is replayed. Session cleanup is attempted by the existing executor. If
cleanup is uncertain, the lock stays held.

Reconnect uses only a previously trusted endpoint, at most three attempts with
300/600 ms exponential backoff and five-second connect timeouts. It verifies the
original physical identity and restores ADB only. It never creates a replacement
Appium Session or resumes the old execution. A retained Session may need transport
restoration and explicit inspection/cleanup before a new execution can start.
Changed ports/IP require discovery or a new explicit Connect, not a network scan.

## Regression and Real Acceptance

```powershell
node --test tests/wireless-connectivity.test.cjs tests/multi-device-runtime.test.cjs
node node_modules/typescript/bin/tsc --noEmit
node tests/hybrid-android.integration.cjs <ADB_SERIAL>
```

The integration probe records ADB health, Session setup, hierarchy, screenshot,
one Settings action and cleanup times. It never changes transport or installs APKs.
Wi-Fi evidence requires a Wi-Fi serial. `--require-unplugged` also rejects a
connected USB alias of the same phone. Screenshot artifacts go under ignored `.next/`.

For Agent acceptance after unplugging USB, select the Wi-Fi device in Dashboard
and submit `Mo Cai dat va tim muc Thong tin dien thoai` (Vietnamese diacritics
are accepted). Verify the selected transport, progress, destination, cancellation
and cleanup on that real execution. Probe/USB/unit-test success is not proof that
the real Agent scenario succeeded.

Labels: IMPLEMENTED, SIMULATED PASS, USB REAL PASS, WIFI REAL PASS, NOT TESTED,
BLOCKED. Only claim full wireless acceptance after unplugged-phone Dashboard,
Agent/verifier, screenshot and cleanup checks all pass. Two-device real isolation
requires two real phones; fake-adapter results must remain SIMULATED.
