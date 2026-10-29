# Core Freeze: Cổng 1 Tiếp Tục (Provenance + Physical Alias + Plan UI)

Ngày 26/10/2026, branch `DuyTD`. **Cổng 1 PASS ở mức OFFLINE_TESTED; dừng chờ xác nhận Cổng 2.**
Đã giữ A OFFLINE khi B khác physicalId còn READY; chỉ fallback transport đã xác minh của cùng máy vật lý.
Đã thêm lịch sử live discovery trong Dashboard, khóa plan cũ qua mất/đổi thiết bị và phục hồi; sửa nhãn và nút phân tích lại.
Targeted **39/39 PASS**; full regression **1385 PASS /0 FAIL /6 TODO**, chạy đúng một lần, 71 file.
**69/69 test cũ nguyên SHA-256 so Cổng 0**; không sửa worker/security/parser/schema/provider/config; không làm C18, không browser/tsc/lint/build/Android.

Báo cáo STOP lần trước ở `docs/core-freeze-gate1-report.md` giữ nguyên để lưu lịch sử. Kết quả mới và phạm vi chứng minh nằm trong báo cáo này, không thay verdict cũ.

## 1. Kết Quả

| Hạng mục | Kết quả mới | Evidence |
|---|---|---|
| Physical identity đủ dùng cho alias UI | VERIFIED_IN_SOURCE trong trust model hiện tại; không coi là hardware attestation | transport-identity.ts:20-23, adb.ts:73-74 |
| Known live serial provenance | OFFLINE_TESTED: lưu tại hook Dashboard; chỉ nhớ discovery status=device, identityVerified=true, có physicalId | selection.test:71,95; panel-route.test:186,206 |
| A OFFLINE/B READY khác physicalId | OFFLINE_TESTED: A giữ selection/OFFLINE, không analyze/execute tới B | selection.test:17,30; panel-route.test:110,186 |
| USB -> Wi-Fi cùng máy | OFFLINE_TESTED: chỉ alias identityVerified, cùng physicalId; plan USB cũ không executable | selection.test:55,78,87; panel-route.test:146,198 |
| Plan không hồi sinh sau recovery | OFFLINE_TESTED: Execute vẫn disabled, explicit reanalysis lấy ref mới rồi mới enable | panel-route.test:123 |
| Nhãn TTL vs đổi/mất thiết bị | OFFLINE_TESTED: ba lý do phân biệt | panel-route.test:110,136,154 |
| Phân tích lại khi device unavailable | OFFLINE_TESTED: disabled và handler guard không gửi request | panel-route.test:110,154,167 |
| Route plan A + device B | OFFLINE_TESTED: HTTP400 trước context/PREPARE/START; giữ contract reference-only | panel-route.test:242 |
| Route A unavailable / physical replacement | OFFLINE_TESTED: HTTP409, 0 fake START | panel-route.test:253,263 |
| C17 browser / Android | **UNVERIFIED/NOT_RUN** trong cổng này | Không được nâng thành browser/Android PASS |
| C18, Cổng2 | **NOT_STARTED** | Không chẩn đoán/sửa replay hoặc thêm idempotency |

Evidence mới: `coverage/core-freeze-gate1-resume-QZwHa0/`. `gate1-result.json`, full/targeted invocation/log/result, `integrity-result.json`, `assertion-preservation.json`, preflight và source pre-images. Không ghi đè evidence cũ.

## 2. PhysicalId Và Provenance

**Đã kiểm tra trước khi sửa**:
- `readTransportIdentity` đọc getprop qua transport, yêu cầu ro.serialno=ro.boot.serialno, serial không thuộc giá trị giả phổ biến, có manufacturer/model; physicalId=android:SHA256 của [hardwareSerial,manufacturer,model] (`lib/android/transport-identity.ts:15-24`).
- `listAndroidDevices` chỉ lấy identity cho transport status=device; USB được đánh identityVerified, Wi-Fi kiểm thêm `wirelessIdentityAllowed` với record đã có (`adb.ts:72-75`, `wireless-store.ts:32-35`).
- Đây chính là nguồn khóa của dedup `device-selection.ts`, device runtime và Session ownership; không lấy IP, tên model hiển thị hoặc chữ trong command làm chứng cứ cùng máy.

Đủ để tiếp tục **UI alias selection trong cơ chế hiện tại**. Đây không phải chống giả getprop bằng attestation; không thay ranh giới tin cậy, không coi hash là quyền thực thi. Backend identity/Session/freshness checks nguyên vẹn.

Hook giữ `knownLiveSerialsRef`, là Map theo vòng đời **một Dashboard instance**, không module-global cache, không lưu secret, không biến history thành authorization. Helper nhận/trả history rõ ràng, chỉ thêm record từ live identity-verified discovery; không học ID từ ô input hoặc record OFFLINE/unverified. Khi máy đã biết biến mất hoặc discovery lỗi, tạo view OFFLINE với identityVerified=false; không dựng một thiết bị READY giả. Map input không bị mutate.

Một selected serial **đang xuất hiện trực tiếp trong discovery status=device** vẫn biểu diễn được, kể cả legacy USB record chưa có physical metadata; record đó không được đưa vào lịch sử xác minh và không đủ để alias/persist selection khi mất khỏi discovery. Availability của Unified yêu cầu identityVerified + physicalId, nên không từ record legacy đó suy thành quyền chạy.

**Điểm tương thích cần nói rõ:** bare helper call không có lịch sử và không thấy serial cũ sẽ loại serial chưa biết, rồi áp quy tắc initial auto-select đúng một READY. Vì vậy test Wi-Fi cũ (không truyền history) vẫn cho endpoint Wi-Fi như assertion cũ; riêng output đó **không chứng minh USB/Wi-Fi là cùng máy**. Trong Dashboard thật, history đã được truyền từ lần discovery trước, nên A đã xác minh không thể bị coi là unknown rồi chuyển sang B. Các test mới dùng history kiểm riêng cả cùng physicalId và khác physicalId. Đây là dữ liệu provenance, không flag/nhánh cho test hoặc gate legacy.

## 3. Plan Binding Và Hai Lỗi UI

`UnifiedAgentPanel.tsx:25-39`:
- Device available chỉ khi online, identityVerified và có physicalId.
- Plan phải cùng source/serial/physicalId, chưa hết TTL và không bị invalidation latch.
- Latch gắn với **plan reference**, giữ lý do mất/đổi thiết bị qua recovery hoặc đổi về A; chỉ reference mới xóa latch. State điều chỉnh có điều kiện trong component, không cần đổi worker/protocol.
- Đổi availability/identity/serial tăng generation để bỏ analysis response cũ đến muộn.
- TTL: "Kế hoạch hết hạn; phân tích lại".
- Offline/lost: "Thiết bị đã mất kết nối; chọn lại thiết bị và phân tích lại".
- Đổi device/physical identity: "Kế hoạch không còn hợp lệ do đổi thiết bị; phân tích lại".
- Nút và handler reanalyze yêu cầu device khả dụng, đúng serial và physicalId của plan. Đổi sang alias cũng phải Analyze mới, không đưa plan USB cũ cho Wi-Fi.

**Không sửa Execute API/schema/service**: contract strict hiện chỉ nhận reference; plan source/device/rights không do client ghi đè. Test gửi `{type:'EXECUTE',reference:A,deviceId:'B'}` bị400 tại route schema (`app/api/unified-agent/route.ts:58`) trước context/dispatch. Normal reference-only execute lấy device A từ plan map, đối chiếu current context/binding ở `service.ts:99-106`, rồi mới consume/dispatch. Các negative route tests chứng minh0 fake START khi offline hoặc physical mismatch; positive reference-only vẫn dispatch đúng A một lần. Không làm idempotency của Cổng2.

Recovery latch chứng minh **client UI** không hồi sinh plan. Route không được thêm một giao thức lưu lịch sử mất kết nối toàn cục; không tuyên bố latch được persist trên worker hoặc thay grants. Browser remount không tự phục hồi plan state để chạy lại.

## 4. Thuộc Tính An Toàn -> Test Phủ

Tên rút gọn: S=`tests/core-freeze-c17-selection.test.cjs`, P=`tests/core-freeze-c17-panel-route.test.cjs`.

| Thuộc tính | Test / dòng | Kết quả |
|---|---|---|
| A OFFLINE/B khác physicalId không auto-switch | S:17; P:110,186 | PASS |
| A unauthorized giữ selection đã biết | S:24 | PASS |
| A vắng mặt/discovery rỗng giữ view OFFLINE từ history | S:30,36; P:186 | PASS |
| Chỉ initial auto-select đúng một READY | S:43,50; P:206 | PASS |
| Unknown dev-001 không được giữ | S:71; P:206; test cũ dashboard-live-device-selection:29 | PASS, test cũ không sửa |
| Alias cùng physicalId verified được fallback | S:55,78; P:198; test cũ wireless-connectivity:59 | PASS |
| physicalId trùng nhưng alias chưa verified không được chọn | S:87 | PASS |
| History không học từ OFFLINE/unverified, không mutate Map cũ | S:95 | PASS |
| User chủ động chọn B được tôn trọng | S:103 | PASS |
| Offline không Execute/reanalyze, không request tới B | P:110 | PASS |
| A hồi phục không enable plan cũ, ref mới sau explicit reanalysis | P:123 | PASS |
| Đổi A->B->A không tái kích hoạt plan A cũ | P:136 | PASS |
| USB->Wi-Fi cũng không chuyển plan/reference/quyền | P:146 | PASS |
| Nhãn TTL không dùng nhầm cho mất/đổi thiết bị | P:110,136,154 | PASS |
| Missing/unverified/physical changed tắt Execute/reanalysis | P:154,167 | PASS |
| Response ANALYZE đến sau disconnect không được nhận làm plan | P:177 | PASS |
| Client device B không override plan A | P:242, HTTP400 trước context/dispatch | PASS |
| Route không fallback sang B khi A offline | P:253, HTTP409/0 START | PASS |
| Cùng serial nhưng đổi physical identity phải reject | P:263 | PASS |
| Valid reference-only request vẫn chỉ chạy A một lần | P:272 | PASS |
| Legacy dedup, identity mismatch, locks, permission/grants, replay/cancel và engine behavior | 69 file baseline nguyên hash, full regression | PASS/6 TODO giữ nguyên; không dùng TODO làm PASS |

Harness P chạy production component/hook trong các hook slots in-memory, duyệt JSX và gọi handler thật; production route functions dùng fake worker. Đây là **OFFLINE_HOOK_SIMULATION**, không phải React DOM/browser acceptance, không phải Next HTTP adapter hoặc Android thật. Không nhầm các trạng thái COMPLETED fixture với outcome điện thoại.

## 5. Test/AST Preservation

**69/69 file test cũ byte-identical**, kiểm cả preflight lượt này và SHA-256 Cổng0. Không đổi assertion ở hai file cũ từng FAIL, không skip/xóa/test flag. Full regression gồm 1358 pass cũ +27 test mới =**1385 pass**; 6 TODO cũ vẫn nguyên. Targeted39 là tập con, không cộng39 vào1385.

File C17 selection đã tạo ở lượt trước được phép chỉnh theo quyết định mới. AST before/after nằm trong `assertion-preservation.json`:

| Case trong file mới | Trước -> Sau | Lý do |
|---|---|---|
| A OFFLINE/unauthorized và recovery | Thêm input verified history; assertion chọn serial không đổi | Provenance đúng yêu cầu, không nhớ serial chưa xác minh |
| A biến mất | "không có A trong view" -> A trong view phải OFFLINE | Bảo toàn lựa chọn thật và hiển thị lost state rõ |
| Discovery rỗng | devices=[] -> view A OFFLINE và raw identityVerified=false | Không làm UI mất selection; placeholder không được dùng như identity hiện hành |
| Alias dedup (case cũ:53) | Giữ USB OFFLINE -> Wi-Fi READY cùng physicalId | Quyết định mới cho phép đổi transport của cùng máy; vẫn kiểm dedup1 item |
| Bốn case thêm | Demo ID, USB absent same-physical fallback, unverified alias denial, immutable verified history | Khóa lại nguồn provenance và fallback |
| File component/route mới | Thêm14 test, không có assertion cũ để thay | Phủ các thuộc tính UI/route trước đó UNVERIFIED |

Không chạy AST như typecheck; parser chỉ đọc assertions trong file test được phép chỉnh. Không chỉnh fixtures/sealed/holdout/open-world.

## 6. Lệnh Và Kết Quả Thực Đo

| Bước | Số lần | Kết quả |
|---|---:|---|
| Targeted Node regression, 4 file | **1** |39 PASS/0 FAIL/0 TODO, exit0; Node6.498s, wrapper6.609s |
| Full Node regression, 69 manifest +2 mới | **1** |1385 PASS/0 FAIL/6 TODO;1391 entries;0 skip/cancel;exit0 |
| Full latency | Trong run trên | Node172.182s; wrapper172.294s, không cộng spans lồng nhau |
| Hash/AST/integrity checks | Trước/sau sửa và sau full |69 old tests unchanged,7 config unchanged |
| Browser / tsc / lint / build | **0** |NOT_RUN theo yêu cầu cổng |
| Android/Appium/ADB/model thật, commit/push/tag | **0 chủ động chạy** |Không có acceptance hoặc dispatch thật |

Runner: `coverage/core-freeze-gate1-resume-QZwHa0/run-regression.cjs targeted`, sau đó `... full`, dùng `C:\nvm4w\nodejs\node.exe`. Args chính xác trong `targeted-invocation.json` và `full-invocation.json`: concurrency1, TAP, offline preload, không glob tests. Full runner từ chối nếu đã có full invocation; không retry full. Hai run ngay ngoài sandbox để mock HTTP loopback được phép; không đổi lỗi assertion thành lỗi môi trường hoặc ngược lại.

**Tripwire telemetry phải nói đúng:** tổng75 counter files có71 fetch loopback do test mở được cho phép, **4 fetch bị chặn trước khi gửi mạng**,0 process ADB/Appium/Ollama/worker bị gọi. Không nói "0 network attempts". Mtime counter xuất hiện trong nhóm legacy; source `tests/autonomous-task.test.cjs:86-108` có bốn unknown/replay responses qua `app/api/agent/assistance/route.ts:21` -> `runningWorkerTasks` -> worker health probe. Đây là **INFERRED** nguồn của4 blocked attempts, không có stack/URL trong counter để xác nhận tuyệt đối. Guard ném lỗi trước original fetch, nên4 lần đó không chạm worker thật. Legacy test vẫn PASS vì invalid/unavailable execution phải bị từ chối.

Giữ nguyên evidence và counter4; không sửa test cũ, không đổi worker/security hoặc rerun full để làm counter về0. Test-isolation gap của legacy health fallback là hạn chế harness cần audit riêng, không phải C17 application failure. Không query real worker/global task state để khẳng định nó idle. Model/network mock tests không chứng minh inference thật.

## 7. File Đã Sửa/Tạo

| File | Thay đổi |
|---|---|
| `lib/android/device-selection.ts` | Optional provenance data Map, bổ sung OFFLINE view của serial đã biết, cùng-physical verified alias fallback, initial one-READY rule |
| `hooks/useDashboardDemo.ts` | Giữ known-live Map trong instance, dùng enriched discovery, giữ OFFLINE view khi discovery lỗi |
| `components/commands/UnifiedAgentPanel.tsx` | Availability + reference latch, stale analysis generation, nhãn lý do invalid, reanalyze guard, missing-device option OFFLINE |
| `tests/core-freeze-c17-selection.test.cjs` |13 tests, chỉ file mới từ lượt trước được điều chỉnh theo duyệt |
| `tests/core-freeze-c17-panel-route.test.cjs` |File mới,14 component/hook/route offline tests |
| `docs/core-freeze-gate1-resume-report.md` |Báo cáo kết quả mới; STOP report cũ giữ nguyên |
| `coverage/core-freeze-gate1-resume-QZwHa0/*` |Preflight/pre-images, runner/tripwire, logs/results, AST/integrity/evidence |

Không sửa route/service/contracts vì binding hiện có đã đủ và được test offline; không đổi worker/runtime schema, permission, effect grants/journal, locks/cancel/identity/freshness. Không đổi config/env/provider/dependency. Không xóa/archive; không commit/push/stash/reset/checkout. Cổng0 backup `codex/backup-freeze-core-gate0-2026-10-26` còn nguyên.

## 8. Điểm Dừng Và Hạn Chế

Không chạm STOP do test an toàn cũ FAIL hoặc cần sửa security/parser/worker: toàn bộ đã xanh. **Tới điểm dừng bắt buộc sau Cổng1**, chờ xác nhận Cổng2. Không chẩn đoán/sửa C18 hoặc thêm clientRequestId trong lượt này.

C17 hiện **OFFLINE_TESTED**: cần browser acceptance ở cổng đã định; TypeScript/lint/build chưa chạy theo lệnh người dùng. Không tuyên bố sản phẩm production-ready, Android VERIFIED hoặc core-freeze. Build SecurityFatalError lịch sử không được xem là build mới/PASS. Latch UI không phải một journal kết nối toàn cục trên worker; known-live memory reset khi Dashboard remount. Khóa physicalId dùng trust model getprop hiện hữu, không attestation. Counter bị chặn4 giữ nguyên và cần isolation audit legacy riêng.

