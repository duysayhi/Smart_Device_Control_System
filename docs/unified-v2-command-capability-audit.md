# Phone Commander — kiểm kê câu lệnh Unified V2

Ngày kiểm kê: 27–28/10/2026 theo giờ địa phương, timestamp evidence theo UTC. Branch `DuyTD`; kiểm tra working tree, không chỉ HEAD `01525d92412eb1779855beec0e359037a79873d0`. **Chỉ đọc ứng dụng; không chạy Android, inference, worker thật hoặc production build.**

## 1. Kết luận và số lượng

Hệ thống có các contract thực thi thật cho mở app, tìm kiếm, đọc trạng thái, chụp ảnh, tính toán, quay số điền sẵn và đổi một số cài đặt có khôi phục. **Đường Unified hiện tại giới hạn theo catalog, không nhận mọi câu diễn đạt tự nhiên và không mở toàn bộ capability có trong core.** Cấp Owner/Full-control không sửa được lỗi grammar, thiếu app handler hoặc thiếu verifier.

Kiểm kê **100 chuỗi lệnh khác nhau**: **87 câu** kiểm tra mới qua production POST ANALYZE với compiler thật, cộng **13 câu lịch sử bổ sung** không chạy ANALYZE lại. Trong 87 câu có đủ **46/46 câu tham chiếu** của chủ dự án và 41 biến thể có nguồn từ source/test/báo cáo. Đây là tập kiểm kê phát triển có chủ đích, không phải benchmark độc lập hoặc số lượng capability.

| Chỉ số | Số đếm / mẫu số | Ý nghĩa |
|---|---:|---|
| Nhận diện | 70 RECOGNIZED; 9 NEEDS_CLARIFICATION; 3 UNSUPPORTED_PHRASING; 4 UNKNOWN; 1 REJECTED_BY_POLICY / 87 | Ba tầng nhận diện, planning, execution được lưu riêng |
| Plan V2 trực tiếp | **47/87** | Source/device giữ nguyên, V2, graph COMPLETE trong fixture discovery |
| Hỏi sáng/chiều | **2/87** | Câu có dấu/không dấu; 0 PREPARE trước trả lời; chọn AM tạo 2 plan mới riêng |
| Planning còn lại | 20 CATALOG_DISABLED; 3 PLANNING_FAILED; 15 NOT_TESTED / 87 | NOT_TESTED ở tầng planning = route từ chối trước PREPARE, dù probe parser/compiler riêng đã chạy |
| Chỉ chứng minh ANALYZE, chưa có executor proof cho đúng chuỗi trong lượt test này | **43/87** | Là phần còn lại của 47 plan trực tiếp sau khi tách 4 câu dưới; không có nghĩa 43 câu đều chưa từng chạy trên máy thật |
| OFFLINE_EXECUTION_TESTED đúng chuỗi | **4/87** | B01, B02, F01, X27; mức độ loop/component nêu ở bảng 2 |
| Không thực thi trong phân loại hiện tại | **40/87** | 2 câu hỏi và 38 câu không nhận plan trực tiếp; có thể vẫn có evidence lịch sử |
| Hoàn thành Android trên source hiện tại | **0/100 được xác minh** | Không chạy Android lần này; mọi current execution vẫn UNVERIFIED, không phải 100 lần thử thất bại |
| Hoàn thành Android lịch sử, khớp đúng chuỗi | **13/87**, hoặc **17/100** tính cả phụ lục lịch sử | 17 chuỗi có COMPLETED trong raw evidence đã đọc; các checkpoint khác source hiện tại |
| Từng FAILED/BLOCKED trong môi trường Android lịch sử | **12/87**, hoặc **17/100** | Có giao với nhóm thành công: `read brightness` từng BLOCKED rồi COMPLETED. Trong 17 có 2 destructive negative bị chặn đúng, không phải lỗi tính năng |
| Catalog từ chối có mã CAPABILITY_DISABLED | **20/87** | EXPECTED_REJECTION; không tính execution failure |
| Chưa có chứng minh Android cho source hiện tại | **100/100** | Cần nghiệm thu lại, không được nâng historical thành current |
| Nhóm có thể được catalog nhận | **12 nhóm**, không phải 47 capability | OPEN_APP, OPEN_SETTINGS, READ_STATE, SET_STATE, CAMERA, DIAL_PREFILL, CALCULATE, SEARCH, ALARM_PERIOD, BROWSER_FIRST, ALARM, TIMER; ALARM_PERIOD là clarification |

Không cộng các hàng chồng lấn thành tổng PASS/FAIL. Trong 100 câu, 13 câu phụ lục chỉ kiểm toán evidence lịch sử; không đưa vào mẫu số 87 của phép ANALYZE mới. Bảng lịch sử gồm 46 record từ 10 JSON, 38 chuỗi khác nhau; 25 chuỗi trùng tập 87, nên hợp hai tập có đúng 100 chuỗi.

**READY_FOR_DEMO_CANDIDATE trên source hiện tại: chưa có câu nào được chứng nhận bởi lượt audit này.** Pin/Wi-Fi, tìm Drive/YouTube và Camera là ứng viên nghiệm thu trước vì có evidence lịch sử tốt. Chrome P1, Alarm và Timer không được nâng READY từ kết quả ANALYZE.

## 2. Phạm vi, phương pháp và evidence

Evidence mới: [thư mục audit](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/coverage/unified-v2-command-audit-v0RkYI/>).

| Ký hiệu | Nguồn |
|---|---|
| R / ID | [analyze-results.json](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/coverage/unified-v2-command-audit-v0RkYI/analyze-results.json>) — tra `cases[].id`; giữ request, raw parse, compiled graph, response, clarification, counters, latency |
| C | [classification.json](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/coverage/unified-v2-command-audit-v0RkYI/classification.json>) — nhãn độc lập và số đếm cho 87 câu |
| H | [history-proofs.json](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/coverage/unified-v2-command-audit-v0RkYI/history-proofs.json>) — trích xuất trường evidence liên quan, đường dẫn và SHA-256 JSON gốc; không sao chép ảnh hoặc token |
| T | [manifest](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/coverage/unified-v2-command-audit-v0RkYI/offline-tests-resumed-invocation.json>), [TAP](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/coverage/unified-v2-command-audit-v0RkYI/offline-tests-resumed.log>), [kết quả](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/coverage/unified-v2-command-audit-v0RkYI/offline-tests-resumed-result.json>) |
| I | [integrity.json](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/coverage/unified-v2-command-audit-v0RkYI/integrity.json>) — so 311 file, branch/HEAD/index và runtime digest |

Các kết luận source bên dưới dựa trên file/hàm thực tế; H là historical evidence, T là test thực sự chạy mới. Không dùng tên test làm bằng chứng nếu chưa đọc assertions. Những dự đoán về khả năng chạy trên app/UI khác được ghi UNVERIFIED hoặc điều kiện cần, không coi là kết quả thực nghiệm.

Harness mới gọi trực tiếp `app/api/unified-agent/route.ts.POST` trong Node 22.19.0, transpile TS trong bộ nhớ. Fake worker chỉ nhận GET trạng thái và PREPARE; PREPARE đi qua **DeviceRuntimeRegistry.prepare → prepareV2 → compiler thật**. Inventory/app handler được giả lập và khai báo công khai, không phải catalog của Samsung hiện tại. Mọi START/open Session/legacy planning đều có tripwire. Provider generate bị thay bằng hàm báo lỗi, không cung cấp câu trả lời model giả.

Counters: **105 fake worker GET, 52 fake PREPARE, 0 START, 0 Session, 0 model proposal, 0 legacy call**. 52 PREPARE gồm 47 plan trực tiếp + 2 lần trả lời clarification + 3 lần thiếu handler. ANALYZE thành công chỉ có nghĩa đủ graph và app binding trong fixture này. Không kiểm tra real UI, readiness, Appium package hay quyền hiện tại của điện thoại.

47 plan trực tiếp giữ nguyên source. Hai CLARIFY không lén sửa input: response ban đầu giữ câu gốc; harness ghi rõ lựa chọn AM; service cấp reference mới với source `Đặt báo thức 3:30 AM` / `Dat bao thuc 3:30 AM`, kèm `clarifiedFrom`. Không thực thi các plan này.

Không mở/import dữ liệu benchmark bị loại trừ; không đọc `.env`, không in API key, không thay config/dependency/source/test. Chỉ thêm tài liệu này và helpers/evidence mới trong coverage. Không chạy tsc/lint/full regression/build lần này; baseline lịch sử không được tính thành kết quả audit mới.

## 3. Đường chạy hiện tại và quyền

1. [Unified POST:51](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/app/api/unified-agent/route.ts:51>) kiểm local same-origin JSON, source hard deny, strict schema; `debugEngine` bị HTTP 400 `ENGINE_SELECTION_REMOVED`.
2. [routeCapability:29](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/unified-agent/capability-router.ts:29>) chạy [requireDemoCapabilities:114](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/unified-agent/demo-catalog.ts:114>) trước context/PREPARE; chọn duy nhất V2. Không chạy phần hợp lệ trước nếu có clause bị cấm/disabled.
3. [service.analyze:91](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/unified-agent/service.ts:91>) lấy context, PREPARE, kiểm lại context; reference tối đa 85 giây và ràng buộc source/device/physical identity/mode. [DeviceRuntimeRegistry.prepare:50](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/device-runtime.ts:50>) kiểm catalog, discovery, handler và graph.
4. [prepareV2:17](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/prepared-v2.ts:17>) dùng typed intent/rules trước, constrained proposal khi nhánh được phép cần model; [compileOutcomes:38](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/goal-compiler.ts:38>) giữ mọi outcome/dependency. **Compiler riêng COMPLETE không vượt qua catalog**, ví dụ X22.
5. [service.executeRequest:107](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/unified-agent/service.ts:107>) có clientRequestId idempotency trong bộ nhớ; [execute:134](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/unified-agent/service.ts:134>) vẫn tiêu thụ plan một lần, kiểm TTL/binding; [dispatch:149](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/unified-agent/service.ts:149>) yêu cầu task trả về đúng V2/source/device. Mất ACK không tự resend START; UNKNOWN_EFFECT khác NOT_SENT.
6. [runAgentV2:133](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/agent-v2.ts:133>) mở owned Session, quan sát fresh, chọn candidate backend cấp, grant một lần và verifier. [allOutcomesVerified:625](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/agent-v2.ts:625>) mới cho COMPLETED; setting settlement/Session cleanup vẫn có thể hạ kết quả.

| Gate | Normal | Owner | Full-control |
|---|---|---|---|
| Catalog/grammar/unsupported app | Giữ nguyên | Giữ nguyên | Giữ nguyên |
| Destructive/mixed destructive | DENY | DENY | DENY |
| Interpretation cần review | ASK | ASK | Chỉ auto nếu opt-in autoReview và source-exact được chứng minh |
| Tạo ảnh/tính toán/alarm/timer hợp lệ | ASK effect nếu cần | ALLOW local effect trong scope | ALLOW chỉ với journal authorization phù hợp |
| Typed SET_DEVICE_STATE | Không đủ quyền | Không đủ full-control | Cần full-control, source binding, journal, inverse và independent readback |
| Thiếu target, stale state, không đủ evidence | BLOCK/assistance | BLOCK/assistance | BLOCK/assistance |

Nguồn: [decidePermission:28](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/permission-decision.ts:28>), [executeIntentCapability:93](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/intent-executor.ts:93>). Owner policy ALLOW không thay thế contract riêng của intent mutation.

API cũ bị khóa công khai bằng [LEGACY_ENTRY_ENABLED=false:2](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/unified-agent/legacy-entry.ts:2>) và HTTP 410 `LEGACY_ENTRY_DISABLED`: [interpret:12](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/app/api/commands/interpret/route.ts:12>), [executions:13](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/app/api/executions/route.ts:13>), [agent:16](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/app/api/agent/route.ts:16>), [runtime START:27](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/app/api/agent/runtime/route.ts:27>). Mã AP/V1, handler nội bộ và executor dùng chung còn tồn tại; không suy từ sự tồn tại đó rằng Dashboard còn gọi được.

## 4. Capability → executor → verifier

Ký hiệu E/V dùng trong bảng chính. Catalog status lấy từ [demoCatalog:17](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/unified-agent/demo-catalog.ts:17>), không lấy từ lịch sử demo.

| Nhóm; catalog | Executor có thể tới sau grant | Verifier và dependency | Test đã đọc/chạy |
|---|---|---|---|
| E1/V1 OPEN_APP; ENABLED | `runAgentV2` LAUNCH, intent khi source binding có; fallback executor dùng chung | `FOREGROUND_IS`, fresh native package; intent có thêm activity độc lập. App phải được discovery duy nhất | `general-agent-v2-runtime`, `agent-v2-m6a`, `engine-merge-single-path` |
| E2/V2 OPEN_SETTINGS; ENABLED | `executeIntentCapability`, closed Android settings action | Native activity + dumpsys resumed activity khớp, không tự đổi setting | `engine-merge-single-path`, typed intent tests trong manifest |
| E3/V3 READ_STATE; ENABLED battery/wifi/brightness | Intent branch không cần mở app | **Hai đường đọc độc lập**, same Session/device/TTL; không chấp nhận stderr/bất đồng. Pin: battery/sysfs; Wi-Fi: setting/cmd status; sáng: setting/display | `read-state-execution`, `read-state-session-binding`, `read-state-semantics` |
| E4/V4 SET_STATE; ENABLED wifi/brightness/dnd | `SettingMutationController` qua intent | Pre/post pair, journal ACK/effect state, inverse khôi phục readback. `set wifi 0` không có nghĩa giữ Wi-Fi tắt vĩnh viễn | `engine-merge-single-path` fake executor/journal; owner/multi-device security tests |
| E5/V5 CAMERA; ENABLED | Grounded shutter + new-media baseline; camera intent fallback chỉ khi NOT_SENT được chứng minh | `verifyCapturedMedia`: đúng một MediaStore delta, URI/owner/time/MIME/size/physical identity; preview không đủ | `agent-v2-m6a`, `general-agent-v2-persisted` |
| E6/V6 DIAL_PREFILL; ENABLED | ACTION_DIAL, không CALL | Exact normalized số trong UI + activity độc lập | ANALYZE mới X09/C02; Android lịch sử typed X09 |
| E7/V7 CALCULATE; ENABLED | Grounded field/keypad + evaluate, không dùng LLM làm oracle | Arithmetic AST oracle + exact observed expression + kết quả readback theo locale; echo operand không đủ | `general-agent-v2-runtime`, `general-agent-v2-widgets` |
| E8/V8 SEARCH; ENABLED YouTube/Drive/My Files | `runGenericSearch`: activate → scoped field → clear nếu cần → exact entry → submit/live transition | Issued search scope, query đã commit, fresh result/NO_RESULTS surface, app/device/session. **NO_RESULTS là tìm kiếm hoàn tất, không phải đã tìm thấy tài liệu** | `general-agent-v2-search`, `general-agent-v2-search-reliability` |
| E9/V9 ALARM; EXPERIMENTAL | Native SET_ALARM nếu provider đọc được, hoặc `runTemporalUi` | New-only identity, đúng hour/minute/AM-PM/zone/enabled, baseline đầy đủ, old rows không đổi, 2 readbacks; thiếu 24h/period evidence chặn trước commit | `agent-v2-m6b`, `agent-v2-m6c`, temporal fixes/editor/scroll |
| ALARM_PERIOD; ENABLED | Trước execution: `analyzeForDashboard`/`clarify`, không Save | Một câu hỏi AM/PM, reference/source mới được ràng buộc lại; câu trả lời không phải effect grant | E02/X24 và C17 route/component tests |
| E10/V10 BROWSER_FIRST; EXPERIMENTAL | Search organic + một grounded result ordinal 1 | Issued prior-search proof, URL/title/selector của organic đầu tiên, destination DOM/loaded identity. Không coi quảng cáo hoặc URL click ACK là hoàn thành | `engine-merge-p1-v2`: production loop + grounded executor + DOM helper offline, query `marine research notes` |
| E11/V11 TIMER; EXPERIMENTAL | Native SET_TIMER hoặc grounded UI Start một lần | Đúng initial duration, RUNNING, hai fresh reads giảm phù hợp monotonic time; không dùng field echo | `agent-v2-m6b`, `agent-v2-m6c` |

Source chi tiết: [capabilityRegistry:3](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/capability-registry.ts:3>); [intent verify/read:47](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/intent-executor.ts:47>); [setting-schema:3](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/setting-schema.ts:3>); [verification registry:22](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/verification-registry.ts:22>); [search-executor:19](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/search-executor.ts:19>); [temporal executor:31](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/temporal-executor.ts:31>); [temporal-ui-runner:19](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/temporal-ui-runner.ts:19>); [browser result scope:24](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/browser-result.ts:24>).

Giới hạn giá trị source: brightness 1–255 (80 là giá trị raw, không mặc định 80%), Wi-Fi 0/1, DND 0–3; alarm hour 0–23/minute 0–59, 12 AM=00, 12 PM=12, bare 1–12 không có period cần hỏi nếu không biểu diễn 24h rõ ràng; timer 1–86400 giây. Múi giờ phải IANA hợp lệ; scheduling khác zone thiết bị chưa được hỗ trợ. Nguồn [temporal-contract:4](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/temporal-contract.ts:4>), [temporalPrecondition:75](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/temporal-evidence.ts:75>).

## 5. Bảng chính — 87 câu qua ANALYZE mới

Recognition không đồng nghĩa catalog admission: RECOGNIZED + CATALOG_DISABLED là kết quả hợp lệ. `NOT_TESTED` ở Plan không phủ nhận việc route ANALYZE đã được gọi; nó nói không được đi vào worker preparation. `PREPARE_ASK` là **nhãn audit**, không phải code do backend trả về. Android Evidence trong bảng là lịch sử hoặc UNVERIFIED, độc lập với kết quả offline.

| ID | Câu lệnh chính xác | Capability | Catalog | Analyze | Plan | Executor | Verification | Android Evidence | Kết luận | Nguồn |
|---|---|---|---|---|---|---|---|---|---|---|
| A01 | `Mở YouTube` | OPEN_APP | OPEN_APP=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (LAUNCH) | E1 | V1 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/A01 |
| A02 | `Mở Cài đặt` | OPEN_SETTINGS | OPEN_SETTINGS=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (LAUNCH) | E2 | V2 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/A02 |
| A03 | `Mở Chrome` | OPEN_APP | OPEN_APP=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (LAUNCH) | E1 | V1 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/A03 |
| A04 | `Mở Camera` | OPEN_APP | OPEN_APP=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (LAUNCH) | E1 | V1 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/A04 |
| A05 | `Mở Drive` | OPEN_APP | OPEN_APP=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (LAUNCH) | E1 | V1 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/A05 |
| A06 | `Mở My Files` | OPEN_APP | OPEN_APP=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (LAUNCH) | E1 | V1 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/A06 |
| A07 | `Mở ứng dụng không tồn tại` | ngoài catalog | NOT_ADMITTED | UNKNOWN; HTTP 409 | NOT_TESTED | — (Unified không dispatch) | — | UNVERIFIED | UNSUPPORTED_OUTCOME; NOT_EXECUTED | R/A07 |
| B01 | `Cho mình xem pin còn bao nhiêu` | READ_STATE | READ_STATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E3 | V3 | HISTORICAL_REAL_ANDROID_VERIFIED; CURRENT_UNVERIFIED | OFFLINE_EXECUTION_TESTED | R/B01; tests/read-state-execution.test.cjs:102 |
| B02 | `Cho mình biết Wi-Fi đang bật hay tắt` | READ_STATE | READ_STATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E3 | V3 | HISTORICAL_REAL_ANDROID_VERIFIED; CURRENT_UNVERIFIED | OFFLINE_EXECUTION_TESTED | R/B02; tests/read-state-execution.test.cjs:102 |
| B03 | `Xem độ sáng` | READ_STATE | READ_STATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E3 | V3 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/B03 |
| B04 | `Kiểm tra trạng thái pin` | READ_STATE | READ_STATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E3 | V3 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/B04 |
| B05 | `Wi-Fi có đang bật không?` | READ_STATE | READ_STATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E3 | V3 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/B05 |
| C01 | `Mở máy tính và tính 125 * 48` | OPEN_APP+CALCULATE | OPEN_APP=ENABLED; CALCULATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (LAUNCH→CALCULATE) | E1+E7 | V1+V7 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/C01 |
| C02 | `Mở bàn phím quay số 5550100` | DIAL_PREFILL | DIAL_PREFILL=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E6 | V6 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/C02 |
| C03 | `Mở YouTube và tìm hải dương học` | OPEN_APP+SEARCH | OPEN_APP=ENABLED; SEARCH=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (LAUNCH→SEARCH) | E1+E8 | V1+V8 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/C03 |
| C04 | `Mở Drive và tìm báo cáo thực tập` | OPEN_APP+SEARCH | OPEN_APP=ENABLED; SEARCH=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (LAUNCH→SEARCH) | E1+E8 | V1+V8 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/C04 |
| C05 | `Mở My Files và tìm ocean` | OPEN_APP+SEARCH | OPEN_APP=ENABLED; SEARCH=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (LAUNCH→SEARCH) | E1+E8 | V1+V8 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/C05 |
| C06 | `Mở Camera và chụp 1 tấm ảnh` | OPEN_APP+CAMERA | OPEN_APP=ENABLED; CAMERA=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (LAUNCH→CAPTURE_MEDIA) | E1+E5 | V1+V5 | HISTORICAL_REAL_ANDROID_VERIFIED; CURRENT_UNVERIFIED | ANALYZE_ONLY_TESTED | R/C06 |
| D01 | `Mở Chrome, tìm ocean và mở bài đầu tiên` | OPEN_APP+BROWSER_FIRST | OPEN_APP=ENABLED; BROWSER_FIRST=EXPERIMENTAL | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (LAUNCH→SEARCH→OPEN_RESULT) | E1+E10 | V1+V10 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/D01 |
| D02 | `Mở Chrome, tìm vòng tuần hoàn của nước và mở bài đầu tiên` | OPEN_APP+BROWSER_FIRST | OPEN_APP=ENABLED; BROWSER_FIRST=EXPERIMENTAL | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (LAUNCH→SEARCH→OPEN_RESULT) | E1+E10 | V1+V10 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/D02 |
| D03 | `Mở Chrome và tìm ocean` | ngoài catalog | NOT_ADMITTED | UNKNOWN; HTTP 409 | NOT_TESTED | — (Unified không dispatch) | — | UNVERIFIED | UNSUPPORTED_OUTCOME; NOT_EXECUTED | R/D03 |
| D04 | `Mở Chrome, tìm ocean và mở bài thứ hai` | ngoài catalog | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/D04 |
| D05 | `Mở YouTube và phát video đầu tiên` | UNSUPPORTED_OUTCOME | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/D05 |
| D06 | `Mở YouTube và phát video thứ hai` | UNSUPPORTED_OUTCOME | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/D06 |
| E01 | `Đặt báo thức 7 giờ sáng` | ALARM | ALARM=EXPERIMENTAL | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (ALARM) | E9 | V9 | HISTORICAL_REAL_ANDROID_BLOCKED/FAILED; CURRENT_UNVERIFIED | ANALYZE_ONLY_TESTED | R/E01 |
| E02 | `Đặt báo thức 3:30` | ALARM_PERIOD | ALARM_PERIOD=ENABLED | NEEDS_CLARIFICATION; HTTP 200 | PLAN_INCOMPLETE → COMPLETE sau AM | E9 (sau trả lời) | V9 | UNVERIFIED | ASK trước prepare; AM → plan mới; NOT_EXECUTED | R/E02 |
| E03 | `Hẹn giờ 2 phút` | TIMER | TIMER=EXPERIMENTAL | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (TIMER) | E11 | V11 | HISTORICAL_REAL_ANDROID_BLOCKED/FAILED; CURRENT_UNVERIFIED | ANALYZE_ONLY_TESTED | R/E03 |
| F01 | `set wifi 0` | SET_STATE | SET_STATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E4 | V4 | HISTORICAL_REAL_ANDROID_VERIFIED; CURRENT_UNVERIFIED | OFFLINE_EXECUTION_TESTED | R/F01; tests/engine-merge-single-path.test.cjs:22 |
| F02 | `set brightness 80` | SET_STATE | SET_STATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E4 | V4 | HISTORICAL_REAL_ANDROID_VERIFIED; CURRENT_UNVERIFIED | ANALYZE_ONLY_TESTED | R/F02 |
| F03 | `set dnd 0` | SET_STATE | SET_STATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E4 | V4 | HISTORICAL_REAL_ANDROID_VERIFIED; CURRENT_UNVERIFIED | ANALYZE_ONLY_TESTED | R/F03 |
| F04 | `tắt wifi` | ngoài catalog | NOT_ADMITTED | UNSUPPORTED_PHRASING; HTTP 409 | NOT_TESTED | — (Unified không dispatch) | — | UNVERIFIED | UNSUPPORTED_PHRASING; NOT_EXECUTED | R/F04 |
| F05 | `đặt độ sáng 80` | ngoài catalog | NOT_ADMITTED | UNSUPPORTED_PHRASING; HTTP 409 | NOT_TESTED | — (Unified không dispatch) | — | UNVERIFIED | UNSUPPORTED_PHRASING; NOT_EXECUTED | R/F05 |
| F06 | `Đặt wifi 0` | ngoài catalog | NOT_ADMITTED | UNSUPPORTED_PHRASING; HTTP 409 | NOT_TESTED | — (Unified không dispatch) | — | UNVERIFIED | UNSUPPORTED_PHRASING; NOT_EXECUTED | R/F06 |
| F07 | `set bluetooth 1` | UNSUPPORTED_OUTCOME | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | HISTORICAL_REAL_ANDROID_BLOCKED/FAILED; CURRENT_UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/F07 |
| F08 | `set rotation 1` | UNSUPPORTED_OUTCOME | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | HISTORICAL_REAL_ANDROID_BLOCKED/FAILED; CURRENT_UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/F08 |
| F09 | `set flashlight 1` | UNSUPPORTED_OUTCOME | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | HISTORICAL_REAL_ANDROID_BLOCKED/FAILED; CURRENT_UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/F09 |
| F10 | `set airplane 1` | UNSUPPORTED_OUTCOME | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | HISTORICAL_REAL_ANDROID_BLOCKED/FAILED; CURRENT_UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/F10 |
| G01 | `read battery; open Maps` | ngoài catalog | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/G01 |
| G02 | `Mở YouTube rồi tìm podcast` | OPEN_APP+SEARCH | OPEN_APP=ENABLED; SEARCH=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (LAUNCH→SEARCH) | E1+E8 | V1+V8 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/G02 |
| G03 | `Mở Cài đặt và cho biết pin còn bao nhiêu` | UNPARSED_COMPOUND | NOT_ADMITTED | NEEDS_CLARIFICATION; HTTP 409 | NOT_TESTED | — (Unified không dispatch) | — | UNVERIFIED | NEEDS_CLARIFICATION; NOT_EXECUTED | R/G03 |
| G04 | `capture photo then delete old photos` | UNSUPPORTED_OUTCOME | NOT_ADMITTED | REJECTED_BY_POLICY; HTTP 403 | NOT_TESTED | — (Unified không dispatch) | — | UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/G04 |
| G05 | `open url https://example.com` | ngoài catalog | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/G05 |
| G06 | `ket noi wifi ten oreo` | UNSUPPORTED_OUTCOME | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/G06 |
| G07 | `tao ghi chu ten "demo", noi dung "offline"` | ngoài catalog | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/G07 |
| G08 | `open Gallery` | ngoài catalog | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/G08 |
| G09 | `please arrange everything` | UNSUPPORTED_OUTCOME | NOT_ADMITTED | NEEDS_CLARIFICATION; HTTP 409 | NOT_TESTED | — (Unified không dispatch) | — | UNVERIFIED | NEEDS_CLARIFICATION; NOT_EXECUTED | R/G09 |
| X01 | `read battery` | READ_STATE | READ_STATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E3 | V3 | HISTORICAL_REAL_ANDROID_VERIFIED; CURRENT_UNVERIFIED | ANALYZE_ONLY_TESTED | R/X01 |
| X02 | `read wifi` | READ_STATE | READ_STATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E3 | V3 | HISTORICAL_REAL_ANDROID_VERIFIED; CURRENT_UNVERIFIED | ANALYZE_ONLY_TESTED | R/X02 |
| X03 | `read brightness` | READ_STATE | READ_STATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E3 | V3 | HISTORICAL_REAL_ANDROID_VERIFIED; CURRENT_UNVERIFIED | ANALYZE_ONLY_TESTED | R/X03 |
| X04 | `read bluetooth` | ngoài catalog | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/X04 |
| X05 | `read dnd` | ngoài catalog | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/X05 |
| X06 | `read media_volume` | ngoài catalog | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | HISTORICAL_REAL_ANDROID_BLOCKED/FAILED; CURRENT_UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/X06 |
| X07 | `read ring_volume` | ngoài catalog | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | HISTORICAL_REAL_ANDROID_BLOCKED/FAILED; CURRENT_UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/X07 |
| X08 | `open settings android.settings.SETTINGS` | OPEN_SETTINGS | OPEN_SETTINGS=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E2 | V2 | HISTORICAL_REAL_ANDROID_VERIFIED; CURRENT_UNVERIFIED | ANALYZE_ONLY_TESTED | R/X08 |
| X09 | `open dialer 5550100` | DIAL_PREFILL | DIAL_PREFILL=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E6 | V6 | HISTORICAL_REAL_ANDROID_VERIFIED; CURRENT_UNVERIFIED | ANALYZE_ONLY_TESTED | R/X09 |
| X10 | `calculate 125 * 48` | CALCULATE | CALCULATE=ENABLED | RECOGNIZED; HTTP 409 | PLANNING_FAILED | E7 | V7 | UNVERIFIED | PREPARE_ASK; NOT_EXECUTED | R/X10 |
| X11 | `capture photo` | CAMERA | CAMERA=ENABLED | RECOGNIZED; HTTP 409 | PLANNING_FAILED | E5 | V5 | UNVERIFIED | PREPARE_ASK; NOT_EXECUTED | R/X11 |
| X12 | `set wifi 1` | SET_STATE | SET_STATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E4 | V4 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/X12 |
| X13 | `set brightness 255` | SET_STATE | SET_STATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E4 | V4 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/X13 |
| X14 | `set brightness 256` | UNSUPPORTED_OUTCOME | NOT_ADMITTED | NEEDS_CLARIFICATION; HTTP 409 | NOT_TESTED | — (Unified không dispatch) | — | UNVERIFIED | NEEDS_CLARIFICATION; NOT_EXECUTED | R/X14 |
| X15 | `set dnd 1` | SET_STATE | SET_STATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E4 | V4 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/X15 |
| X16 | `set dnd 3` | SET_STATE | SET_STATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E4 | V4 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/X16 |
| X17 | `set media_volume 1` | UNSUPPORTED_OUTCOME | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | HISTORICAL_REAL_ANDROID_BLOCKED/FAILED; CURRENT_UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/X17 |
| X18 | `set ring_volume 1` | UNSUPPORTED_OUTCOME | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | HISTORICAL_REAL_ANDROID_BLOCKED/FAILED; CURRENT_UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/X18 |
| X19 | `open org.absent.app` | ngoài catalog | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/X19 |
| X20 | `open com.sec.android.app.fm` | OPEN_APP | OPEN_APP=ENABLED | RECOGNIZED; HTTP 409 | PLANNING_FAILED | E1 | V1 | UNVERIFIED | PREPARE_ASK; NOT_EXECUTED | R/X20 |
| X21 | `open com.google.android.youtube` | OPEN_APP | OPEN_APP=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT) | E1 | V1 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/X21 |
| X22 | `Mo Chrome, tim ocean va mo bai dau tien` | ngoài catalog | NOT_ADMITTED | UNKNOWN; HTTP 409 | NOT_TESTED | — (Unified không dispatch) | — | UNVERIFIED | UNSUPPORTED_OUTCOME; NOT_EXECUTED | R/X22 |
| X23 | `Mo Chrome, tim ocean va mo bai thu hai` | ngoài catalog | DISABLED | RECOGNIZED; HTTP 409 | CATALOG_DISABLED | — (Unified không dispatch) | — | UNVERIFIED | EXPECTED_REJECTION; NOT_EXECUTED | R/X23 |
| X24 | `Dat bao thuc 3:30` | ALARM_PERIOD | ALARM_PERIOD=ENABLED | NEEDS_CLARIFICATION; HTTP 200 | PLAN_INCOMPLETE → COMPLETE sau AM | E9 (sau trả lời) | V9 | UNVERIFIED | ASK trước prepare; AM → plan mới; NOT_EXECUTED | R/X24 |
| X25 | `Hen gio 2 phut` | TIMER | TIMER=EXPERIMENTAL | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (TIMER) | E11 | V11 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/X25 |
| X26 | `Dat bao thuc 7 gio sang` | ALARM | ALARM=EXPERIMENTAL | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (ALARM) | E9 | V9 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/X26 |
| X27 | `Set an alarm for 6:45 PM` | ALARM | ALARM=EXPERIMENTAL | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (ALARM) | E9 | V9 | UNVERIFIED | OFFLINE_EXECUTION_TESTED | R/X27; tests/agent-v2-m6b.test.cjs:120 |
| X28 | `Set an alarm for 24:00` | INVALID_TIME | NOT_ADMITTED | NEEDS_CLARIFICATION; HTTP 409 | NOT_TESTED | — (Unified không dispatch) | — | UNVERIFIED | NEEDS_CLARIFICATION; NOT_EXECUTED | R/X28 |
| X29 | `Start a timer for 1 hour 20 minutes` | TIMER | TIMER=EXPERIMENTAL | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (TIMER) | E11 | V11 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/X29 |
| X30 | `hen gio 0 phut` | INVALID_DURATION | NOT_ADMITTED | NEEDS_CLARIFICATION; HTTP 409 | NOT_TESTED | — (Unified không dispatch) | — | UNVERIFIED | NEEDS_CLARIFICATION; NOT_EXECUTED | R/X30 |
| X31 | `Set an alarm for 7 AM tomorrow` | UNSUPPORTED_TEMPORAL_QUALIFIER | NOT_ADMITTED | NEEDS_CLARIFICATION; HTTP 409 | NOT_TESTED | — (Unified không dispatch) | — | UNVERIFIED | NEEDS_CLARIFICATION; NOT_EXECUTED | R/X31 |
| X32 | `open settings android.settings.SETTINGS; read battery` | OPEN_SETTINGS+READ_STATE | OPEN_SETTINGS=ENABLED; READ_STATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT→INTENT) | E2+E3 | V2+V3 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/X32 |
| X33 | `read battery; set wifi 1` | READ_STATE+SET_STATE | READ_STATE=ENABLED; SET_STATE=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (INTENT→INTENT) | E3+E4 | V3+V4 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/X33 |
| X34 | `Do not read battery` | UNSUPPORTED_OUTCOME | NOT_ADMITTED | NEEDS_CLARIFICATION; HTTP 409 | NOT_TESTED | — (Unified không dispatch) | — | UNVERIFIED | NEEDS_CLARIFICATION; NOT_EXECUTED | R/X34 |
| X35 | `compose sms 5550100 "Phone Commander draft only"` | UNSUPPORTED_OUTCOME | NOT_ADMITTED | UNKNOWN; HTTP 409 | NOT_TESTED | — (Unified không dispatch) | — | HISTORICAL_REAL_ANDROID_BLOCKED/FAILED; CURRENT_UNVERIFIED | UNSUPPORTED_OUTCOME; NOT_EXECUTED | R/X35 |
| X36 | `Vào Drive tìm giúp mình tài liệu tên báo cáo thực tập` | OPEN_APP+SEARCH | OPEN_APP=ENABLED; SEARCH=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (LAUNCH→SEARCH) | E1+E8 | V1+V8 | HISTORICAL_REAL_ANDROID_VERIFIED; CURRENT_UNVERIFIED | ANALYZE_ONLY_TESTED | R/X36 |
| X37 | `Ghé YouTube để tìm giúp mình hải dương học nhé` | OPEN_APP+SEARCH | OPEN_APP=ENABLED; SEARCH=ENABLED | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (LAUNCH→SEARCH) | E1+E8 | V1+V8 | HISTORICAL_REAL_ANDROID_VERIFIED; CURRENT_UNVERIFIED | ANALYZE_ONLY_TESTED | R/X37 |
| X38 | `Set an alarm for 12 AM` | ALARM | ALARM=EXPERIMENTAL | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (ALARM) | E9 | V9 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/X38 |
| X39 | `Set an alarm for 12 PM` | ALARM | ALARM=EXPERIMENTAL | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (ALARM) | E9 | V9 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/X39 |
| X40 | `Set an alarm for 00:00` | ALARM | ALARM=EXPERIMENTAL | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (ALARM) | E9 | V9 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/X40 |
| X41 | `Set a timer for 2 minutes and 5 seconds` | TIMER | TIMER=EXPERIMENTAL | RECOGNIZED; HTTP 200 | PLAN_V2_COMPLETE (TIMER) | E11 | V11 | UNVERIFIED | ANALYZE_ONLY_TESTED | R/X41 |

### Bảng chính tiếp — 13 chuỗi chỉ có trong evidence lịch sử

Không gửi lại ANALYZE/EXECUTE cho các câu này. Current Catalog/Plan không được đánh giá bằng lịch sử. Các câu có thiết lập DND ở cuối có thể bị catalog hiện tại chặn riêng READ_STATE dnd; không suy chúng vẫn chạy được từ COMPLETED cũ.

| ID | Câu lệnh chính xác | Capability | Catalog | Analyze | Plan | Executor | Verification | Android Evidence | Kết luận | Nguồn |
|---|---|---|---|---|---|---|---|---|---|---|
| H01 | `open app com.sec.android.app.myfiles` | Lịch sử; không bind lại | NOT_TESTED current | NOT_TESTED current | NOT_TESTED current | V2 lịch sử | INDEPENDENT_NATIVE_ACTIVITY_READBACK | HISTORICAL_REAL_ANDROID_VERIFIED; CURRENT_UNVERIFIED | COMPLETED | H / agent-v2-m4b-intents-1792488219170.json |
| H02 | `open url "https://example.com"` | Lịch sử; không bind lại | NOT_TESTED current | NOT_TESTED current | NOT_TESTED current | V2 lịch sử | Xem H; không có completion proof | HISTORICAL FAILED→BLOCKED; CURRENT_UNVERIFIED | FAILED→BLOCKED | H / agent-v2-m4b-intents-1792488698780.json |
| H03 | `open settings android.settings.SETTINGS; set bluetooth 1; read bluetooth` | Lịch sử; không bind lại | NOT_TESTED current | NOT_TESTED current | NOT_TESTED current | V2 lịch sử | INDEPENDENT_NATIVE_ACTIVITY_READBACK | HISTORICAL BLOCKED; CURRENT_UNVERIFIED | BLOCKED | H / agent-v2-m4d-1792494172354.json |
| H04 | `open settings android.settings.SETTINGS; set wifi 0; read wifi` | Lịch sử; không bind lại | NOT_TESTED current | NOT_TESTED current | NOT_TESTED current | V2 lịch sử | INDEPENDENT_STATE_READBACK | HISTORICAL_REAL_ANDROID_VERIFIED; CURRENT_UNVERIFIED | COMPLETED | H / agent-v2-m4d-1792494986605.json |
| H05 | `open settings android.settings.SETTINGS; set dnd 0; read dnd` | Lịch sử; không bind lại | NOT_TESTED current | NOT_TESTED current | NOT_TESTED current | V2 lịch sử | INDEPENDENT_STATE_READBACK | HISTORICAL_REAL_ANDROID_VERIFIED; CURRENT_UNVERIFIED | COMPLETED | H / agent-v2-m4d-1792494986605.json |
| H06 | `open settings android.settings.SETTINGS; set brightness 80; read brightness` | Lịch sử; không bind lại | NOT_TESTED current | NOT_TESTED current | NOT_TESTED current | V2 lịch sử | INDEPENDENT_STATE_READBACK | HISTORICAL_REAL_ANDROID_VERIFIED; CURRENT_UNVERIFIED | COMPLETED | H / agent-v2-m4d-1792494986605.json |
| H07 | `open settings android.settings.SETTINGS then delete all photos` | Lịch sử; không bind lại | NOT_TESTED current | NOT_TESTED current | NOT_TESTED current | V2 lịch sử | Xem H; không có completion proof | HISTORICAL BLOCKED; CURRENT_UNVERIFIED | EXPECTED_REJECTION / zero authorized effect | H / agent-v2-m4d-1792494986605.json |
| H08 | `overwrite existing user files` | Lịch sử; không bind lại | NOT_TESTED current | NOT_TESTED current | NOT_TESTED current | V2 lịch sử | Xem H; không có completion proof | HISTORICAL BLOCKED; CURRENT_UNVERIFIED | EXPECTED_REJECTION / zero authorized effect | H / agent-v2-m4d-1792494986605.json |
| H09 | `Mở YouTube và tìm nhạc không lời để học bài` | Lịch sử; không bind lại | NOT_TESTED current | NOT_TESTED current | NOT_TESTED current | Xem H | Xem H; không có completion proof | HISTORICAL NOT_EXECUTED; CURRENT_UNVERIFIED | NOT_EXECUTED | H / evidence.json |
| H10 | `Xóa hết ảnh trong thư viện` | Lịch sử; không bind lại | NOT_TESTED current | NOT_TESTED current | NOT_TESTED current | Xem H | Xem H; không có completion proof | HISTORICAL NOT_EXECUTED; CURRENT_UNVERIFIED | EXPECTED_REJECTION / zero authorized effect | H / evidence.json |
| H11 | `chụp ảnh rồi xóa ảnh cũ` | Lịch sử; không bind lại | NOT_TESTED current | NOT_TESTED current | NOT_TESTED current | Xem H | Xem H; không có completion proof | HISTORICAL NOT_EXECUTED; CURRENT_UNVERIFIED | EXPECTED_REJECTION / zero authorized effect | H / evidence.json |
| H12 | `Mở YouTube, tìm hải dương học và mở video thứ hai` | Lịch sử; không bind lại | NOT_TESTED current | NOT_TESTED current | NOT_TESTED current | V1 lịch sử | Xem H; không có completion proof | HISTORICAL BLOCKED; CURRENT_UNVERIFIED | BLOCKED | H / evidence.json |
| H13 | `Mở YouTube và tìm nhạc thư giãn` | Lịch sử; không bind lại | NOT_TESTED current | NOT_TESTED current | NOT_TESTED current | V2 lịch sử | Xem H; không có completion proof | HISTORICAL CANCELLED; CURRENT_UNVERIFIED | CANCELLED | H / evidence.json |

## 6. Sáu bảng đối chiếu

### Bảng 1 — Đã thành công trên Android thật, tại checkpoint lịch sử

Tất cả hàng dưới: **HISTORICAL_REAL_ANDROID_VERIFIED / CURRENT_UNVERIFIED**. Có raw JSON được mở và hash trong H; không chứng nhận Android đa hãng. Checkpoint viết tắt được mở rộng ngay dưới bảng. Mốc và lời đánh giá screenshot là dữ liệu lịch sử, không phải ảnh mới chụp trong audit này.

| Câu chính xác | Ngày; engine; checkpoint | Kết quả / independent evidence | Nguồn gốc trong H |
|---|---|---|---|
| `Cho mình xem pin còn bao nhiêu` | 25/10; Unified HTTP → V2; R25 | COMPLETED 28; dumpsys level=28 và sysfs=28; Analyze 0.870 s, execute-observed 13.249 s, 6 RPC/20 ADB, model 0 | `coverage/wifi-readonly-20261025-F79gJR/report.json` |
| `Cho mình biết Wi-Fi đang bật hay tắt` | 25/10; Unified HTTP → V2; R25 | COMPLETED 1; wifi_on=1, cmd status enabled; 0.668 s/11.305 s, 6 RPC/20 ADB, model 0 | Cùng JSON R25 |
| `Mở Camera và chụp 1 tấm ảnh` | 22/10; Unified browser → V2; R22 | COMPLETED; MediaStore 591→592, URI `/2266`, JPEG 2.076.803 bytes; 2/2 outcomes; engine total 47.447 s | `phone-commander-m7a-acceptance-9RbsXb/evidence.json` |
| `Vào Drive tìm giúp mình tài liệu tên báo cáo thực tập` | 21/10; V2 DEVELOPMENT; R21S | Exact `báo cáo thực tập`, NO_RESULTS, không mở file; cold/warm total 92.208/27.982 s, model 0 cả hai | `agent-v2-m5c-assessment-1792572681695.json` + paired JSON |
| `Ghé YouTube để tìm giúp mình hải dương học nhé` | 21/10; V2 DEVELOPMENT; R21S | Exact `hải dương học`, result cards/search UI, không watch page; 95.801/36.794 s; model 0 | Cùng assessment + paired JSON |
| `set wifi 0` | 20/10; V2 full-control; R20M | 1→0→1, journal ACKNOWLEDGED, verified và RESTORED | `agent-v2-m4d-1792494986605.json` |
| `set brightness 80` | 20/10; V2 full-control; R20M | 140→80→140, independent readback + restored | Cùng JSON R20M |
| `set dnd 0` | 20/10; V2 full-control; R20M | 1→0→1, independent readback + restored | Cùng JSON R20M |
| `open settings android.settings.SETTINGS; set wifi 0; read wifi` | 20/10; V2; R20M | 3 source-bound nodes; read 0 trước khi settle khôi phục 1 | Cùng JSON R20M |
| `open settings android.settings.SETTINGS; set dnd 0; read dnd` | 20/10; V2; R20M | Read 0 và journal restored; **không chứng minh current catalog nhận read dnd** | Cùng JSON R20M |
| `open settings android.settings.SETTINGS; set brightness 80; read brightness` | 20/10; V2; R20M | Read 80, khôi phục 140 | Cùng JSON R20M |
| `open app com.sec.android.app.myfiles` | 20/10; V2 typed intent; R20I | Native foreground + độc lập resumed activity; engine 10.729 s | `agent-v2-m4b-intents-1792488219170.json` |
| `open dialer 5550100` | 20/10; V2; R20I | Exact dial prefill, DIAL không CALL; screenshot review được ghi trong báo cáo M4b | Cùng JSON R20I |
| `open settings android.settings.SETTINGS` | 20/10; V2; R20I | Native/resumed Settings activity | Cùng JSON R20I |
| `read wifi` | 20/10; V2; R20I | Hai state paths khớp 1 | Cùng JSON R20I |
| `read battery` | 20/10; V2; R20I | Hai state paths khớp 100 | Cùng JSON R20I |
| `read brightness` | 20/10; V2; R20I2 | Sau lần BLOCKED đầu: 64 khớp display normalized 0.2509804×255 | `agent-v2-m4b-intents-1792488698780.json` |

Checkpoint SHA-256 (cùng thuật toán runtime path+content, [runtime-storage:5](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/runtime-storage.ts:5>)):

- R25: `aa9b49e9bfa38a3cead636dd94c92dcd36b766b6946468aa7ccf09faa9064e66`.
- R22: `8c3c2a8cc02f1adb268ba8c9c256871f03d2f3d33d769f049f04fcd49eb4c307`.
- R21S: `2b1753c87683ec690b80577cdc3c8c9781a9da32289b776f75280a153e6eccda` (paired run JSON; assessment chỉ tổng hợp).
- R20M: `2fe5bca6cc76f00e1d8970769cf5d4a554de85a895c4711a53aef0ce14efa338`.
- R20I: `d9be06b866abce9881fae7e98b2192b3d08720372cb2ca855e1e2fa0466e3803`; R20I2: `c4572e052d6f62b057325f7bc1ab63680c7e4e9dc316b9e64f6e87d9297c8daa`.

Cùng câu Camera còn có evidence 21/10 R21C `d79551e71eebfaf4c24d79e7f214dc354fd01d248ccbcfde50fdd76fcbcabdb5`: `/2264`, MediaStore +1, 2.022.586 bytes, metadata check true, Session đóng; raw `phone-commander-m6a-camera-XtoYEu/acceptance.json` và `assessment.json`. Không đếm hai ảnh thành hai capability hoặc hai chuỗi.

Tính toán 125×48=6000 được [báo cáo triển khai 19/10:67](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/docs/general-purpose-agent-v2-next-implementation-report.md:67>) dẫn execution `80d6ea19-80b5-4109-9e36-b4ca125f26e9`, 39.163 s. Tài liệu đã đọc không cho đủ exact request/checkpoint/raw run để gán cho C01; vì vậy **chỉ ghi report-level historical outcome**, không cộng vào 17 chuỗi có raw evidence và không gắn C01 REAL_ANDROID_VERIFIED. Exact-URI viewer và Notes cũng không được suy từ capture/calculate thành công.

### Bảng 2 — Phân tích được, chưa chứng minh hoàn tất trên Android hiện tại

| Tập câu / nhóm | Evidence mới cao nhất cho execution | Phạm vi thực sự được chứng minh |
|---|---|---|
| B01, B02 | **OFFLINE_EXECUTION_TESTED** | `read-state-execution.test.cjs:102`: real V2 loop + production ManagedAppiumSession/Intent executor, ADB/Appium transport inject; hai read paths và result issued, cùng Session, cleanup; không Android thật |
| F01 `set wifi 0` | **OFFLINE_EXECUTION_TESTED — component** | `engine-merge-single-path.test.cjs:22`: real intent mutation/controller/journal/readback/inverse trong fake worker. Worker task status do fixture tổng hợp **sau proof/settlement**; không coi đây là end-to-end real-worker run |
| X27 `Set an alarm for 6:45 PM` | **OFFLINE_EXECUTION_TESTED** | `agent-v2-m6b.test.cjs:120`: real V2 loop + temporal executor/reader, fake provider, issued identity/readback và close; không chứng minh Samsung có provider này |
| 43 câu plan trực tiếp còn lại | **ANALYZE_ONLY_TESTED** ở mức đúng chuỗi | Xem C; có thể có executor family tests, nhưng không tự chuyển chúng sang exact request proof |
| E02/X24 sau chọn AM | **ANALYZE_ONLY_TESTED sau trả lời**, original NOT_EXECUTED | Plan mới COMPLETE, source thêm AM có ghi nhận; không tạo báo thức |
| Chrome P1 family | **OFFLINE_EXECUTION_TESTED cho query khác** | `engine-merge-p1-v2.test.cjs:171` chạy loop/executor/DOM helper cho `Mở Chrome, tìm marine research notes và mở bài đầu tiên`; normal/owner/full-control, URL/title và close được assert. D01/D02 vẫn chỉ ANALYZE theo đúng chuỗi của chúng |
| Camera/calculation/search/record/widget families | Family contracts OFFLINE_TESTED | Fixtures biến package/value/layout và verifier âm/dương; không gán mọi command cùng family là đã thực thi đúng |

Những câu dùng được để thử ANALYZE ngay: nhóm A01–A06; B01–B05; C01–C06; D01–D02; E01/E03; F01–F03; G02; các X có PLAN ở bảng chính. Đây là kết quả fixture inventory, cần app thật có handler duy nhất trước khi chạy.

### Bảng 3 — Các lần thật chưa hoàn thành / không được nhầm thành thành công

| Câu chính xác; checkpoint | Verdict / last step | Root cause có evidence; verifier còn thiếu | Hướng nghiệm thu tiếp |
|---|---|---|---|
| `Đặt báo thức 7 giờ sáng`; 22/10 R22 | REAL_ANDROID_BLOCKED; trước Save; 38.767 s | `UI_LIST_CONTINUITY_UNPROVEN`: provider không đủ đọc, inventory UI chưa chứng minh liên tục đầy đủ; không được xác nhận new-only persisted delta | Đọc Clock inventory + 24h/period evidence trước; source fix offline sau đó chưa có create acceptance |
| `Hẹn giờ 2 phút`; 22/10 R22 | REAL_ANDROID_BLOCKED; Start COMMIT một lần; 53.061 s | `UI_TIMER_RUNNING_DECREASE_UNVERIFIED`: chưa thấy countdown RUNNING giảm; form 00:02:00 không khớp backing model được thăm dò sau đó | UNKNOWN effect không replay; kiểm tra native state hiện tại trước một bài được cấp quyền mới |
| `Mở YouTube, tìm hải dương học và mở video thứ hai`; 22/10 R22, **V1** | BLOCKED 2/3; `video_card_2` timeout; engine total 161.129 s | Ordinal/destination + playback không được verifier chứng minh; terminal nói prior mutation lacks postcondition | Current catalog VIDEO_ORDINAL/ORDINAL DISABLED; không coi V1 attempt là V2 support |
| `Mở YouTube và tìm nhạc thư giãn`; 22/10, V2 | **CANCELLED**, total 11.428 s | Người chạy bấm Dừng; cancellation/Session cleanup, không phải search outcome proof | Giữ CANCELLED, không cộng vào search completion |
| `open url "https://example.com"`; 20/10 R20I/R20I2 | FAILED ban đầu → BLOCKED lần riêng sau; 0 dispatch | Intent handler/default browser ambiguous. Lần FAILED cũ vẫn giữ; 2 execution khác nhau | Current URL_MAPS DISABLED; không gỡ catalog bằng quyền owner |
| `read brightness`; 20/10 R20I | BLOCKED ban đầu, sau đó R20I2 COMPLETED | Independent state paths unavailable/disagree; dumpsys display fix sau đó | Giữ cả hai; dùng lần hoàn tất mới hơn cho capability lịch sử, vẫn current UNVERIFIED |
| `read media_volume`, `read ring_volume`; 20/10 R20I | BLOCKED; đọc state | Hai CLI paths không cung cấp cặp dữ liệu khớp/khả dụng; không phải thiếu checkbox Owner | Current OTHER_STATE DISABLED |
| `set bluetooth 1`; compound `open settings android.settings.SETTINGS; set bluetooth 1; read bluetooth`; 20/10 R20M | BLOCKED; svc enable không ACK / UNKNOWN mutation | Không có independent mutation+inverse proof; thấy Bluetooth vẫn OFF không đủ biến UNKNOWN thành NOT_SENT | Không thử bật lại; current DISABLED |
| `set rotation 1`, `set media_volume 1`, `set ring_volume 1`, `set flashlight 1`, `set airplane 1`; 20/10 | BLOCKED, 0 mutation records | Registry strategies không có complete proven handler/readback/inverse trên máy; `restored=true` với 0 write không phải đổi setting thành công | Giữ ngoài demo; không mở quyền như cách sửa |
| `compose sms 5550100 "Phone Commander draft only"`; 20/10 R20I | BLOCKED trước Session/effect | `NOT_IMPLEMENTED`: ứng dụng có thể tự lưu draft; chưa có non-persisting verified executor | Không gửi, không tự tạo draft |
| `Mở YouTube và tìm nhạc không lời để học bài`; `Vào Drive tìm giúp mình tài liệu tên báo cáo thực tập`; 22/10 | **NOT_EXECUTED**, plan TTL hết trước START | Harness/browser observation delay; không phải Android search thất bại | Analyze lấy ref mới trong bài riêng; Drive có success lịch sử 21/10, không đổi hai verdict này |
| Pin/Wi-Fi tiếng Việt; `Đặt báo thức 3:30`; 22/10 | NOT_EXECUTED / analyze ASK | Binding/clarification UI tại checkpoint cũ. Hai câu read đã có success mới hơn 25/10; clarification mới đã offline kiểm tra | Không dùng lỗi cũ làm trạng thái hiện tại của read parser |

Raw chính: H với `phone-commander-m7a-acceptance-*/evidence.json`, `agent-v2-m4b-intents-*.json`, `agent-v2-m4d-1792494172354.json`, `agent-v2-m4d-1792495202843.json`. Thăm dò Clock/readback sau sửa: [M7a Fix](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/docs/unified-agent-m7a-fix-report.md>). Không có lần chạy Android mới trong audit này.

### Bảng 4 — Từ chối có chủ đích và lỗi phân tích quan sát được

| ID / câu | Response mới | Nguyên nhân gần nhất |
|---|---|---|
| D04–D06; X23 | 409 CAPABILITY_DISABLED | Ordinal >1 / YouTube playback/selection chưa port vào public V2; D05 first video cũng bị chặn |
| F07–F10; X04–X07; X17–X18 | 409 CAPABILITY_DISABLED | OTHER_STATE: setting/read nằm ngoài ba nhóm được mở. DND **set** được nhưng **read** dnd bị catalog chặn |
| G01/G05/G06/G07/G08 | 409 CAPABILITY_DISABLED | Mixed Maps, URL, SSID, record, Gallery: từ chối toàn source, không chạy phần đầu |
| X19 `open org.absent.app` | 409 CAPABILITY_DISABLED / URL_MAPS | Tên có dấu chấm và đuôi `.app` không đủ explicitPackage allowlist; bị URL hardening chặn **trước discovery**. Không kết luận app thực sự không cài |
| F04–F06 | 409 UNSUPPORTED_PHRASING | Chưa hỗ trợ động từ Việt + setting; đúng gợi ý `set wifi 0 / set brightness 80 / set dnd 0`; không đổi source |
| G04 `capture photo then delete old photos` | 403 HARD_DENY | Whole-source safety trước capture/context/prepare; EXPECTED_REJECTION |
| A07, D03, X22, X35 | 409 UNSUPPORTED_OUTCOME | App name ngoài allowlist; Chrome search-only không được mở; P1 không dấu không bind ordinal; SMS ngoài public capability. Không khẳng định đây là lỗi thiết bị |
| G03 | 409 NEEDS_CLARIFICATION | Raw ambiguity `UNPARSED_COMPOUND`, parser giữ cả `Cài đặt và cho biết...` trong launch; không bỏ mất outcome rồi chạy Settings |
| G09 | 409 NEEDS_CLARIFICATION | Không có mô tả mục tiêu/capability xác định |
| X14/X28/X30/X31/X34 | 409 NEEDS_CLARIFICATION | Giá trị ngoài domain, qualifier chưa hỗ trợ hoặc negation; kiểm raw ambiguity tại R, router thông điệp chung nên mất chi tiết diagnostic |
| X10 `calculate 125 * 48`, X11 `capture photo`, X20 `open com.sec.android.app.fm` | 409, status ASK, **không có code field** | Fake discovery không cấp app/handler; catalog/compiler đã nhận. Hai câu bare thiếu fallback category trong **adapter audit**, nên không suy real AppCatalog hỏng; X20 chỉ vắng trong fixture |

Các refusal trước preparation có 0 PREPARE/START trong R; provider không được dùng để vượt allowlist. `AppCatalog.resolve` thực có category default calculator/camera tại [app-catalog:35](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/app-catalog.ts:35>); camera cần handler STILL_IMAGE_CAMERA duy nhất. X10/X11 là **hạn chế fixture, Android UNVERIFIED**, không phải missing implementation.

Mã mới quan sát qua API: `CAPABILITY_DISABLED`, `UNSUPPORTED_PHRASING`, `NEEDS_CLARIFICATION`, `UNSUPPORTED_OUTCOME`, `HARD_DENY`; structured question kind `ALARM_PERIOD`. Các mã EXECUTE như `PLAN_EXPIRED`, `PLAN_REPLAYED`, `PLAN_UNAVAILABLE`, `REQUEST_KEY_CONFLICT`, `REQUEST_CACHE_FULL` được xác nhận trong source/tests, **không phát sinh từ 87 ANALYZE**. Historical diagnostics có `UI_LIST_CONTINUITY_UNPROVEN`, `UI_TIMER_RUNNING_DECREASE_UNVERIFIED`, `SAFE_BLOCKED`, `NOT_IMPLEMENTED`; UNKNOWN_EFFECT là trạng thái/dispatch uncertainty, không phải successful retry.

### Bảng 5 — Khả năng legacy còn code nhưng public Unified V2 đã cắt

| Ví dụ câu / khả năng | Nguồn legacy thực tế | Current Unified | Evidence boundary |
|---|---|---|---|
| `Mở YouTube, tìm hải dương học và mở video thứ hai` | `goal-planner.ts:31`, `decision-engine.ts:24`, `ConditionExecutor`; ordinal discovery + media playback verifier | DISABLED VIDEO_ORDINAL/ORDINAL; không fallback V1 | Có attempt V1 BLOCKED ngày 22/10; không dùng như positive V2 proof |
| `Mở Chrome, tìm ocean và mở bài thứ hai` | `capabilities.ts:11/:34` parser/plan, `ConditionExecutor:280` hybrid DOM ordinal | DISABLED ORDINAL | Code tồn tại không phải Android PASS; chỉ P1 ordinal1 có V2 port offline |
| `Mở Chrome và tìm ocean` | `planChromeCommand`/V1 clearGoal SEARCH | Public SEARCH allowlist không có Chrome nếu thiếu bound P1 | D03 mới trả UNSUPPORTED_OUTCOME; không coi `OPEN_APP chrome` là search |
| `ket noi wifi ten oreo` / natural Wi-Fi workflow | `wifi-plan.ts:16`, `ConditionExecutor:251` exact SSID confirmation + connected-state checks | DISABLED WIFI_SSID | Không chạy thật lần này; catalog cut không chứng minh workflow cũ broken |
| `tắt wifi` / `đặt độ sáng 80` | Wi-Fi on/off recipes chỉ cho grammar riêng; không có chứng minh legacy hỗ trợ tự do mọi setting | Natural phrasing không được mở; dùng typed syntax hiện có | Không rewrite sang set để vượt code diagnostic |
| Client Action[] / raw CLICK/INPUT_TEXT/PRESS_KEY | `capabilities.ts:7`, legacy interpret/execution handlers | API cũ 410; Unified EXECUTE chỉ backend-issued reference | Primitive không phải free-form UI capability |
| V1 find element/page/place navigation | `goal-planner.ts:65`, evaluator/recovery | Không có catalog admission NAVIGATE tổng quát | UNVERIFIED trên current UI/app, không suy từ primitive/candidate |

File links: [Chrome parser/plan](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/capabilities.ts:11>), [V1 planner](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/goal-planner.ts:31>), [Wi-Fi plan](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/wifi-plan.ts:16>), [ConditionExecutor](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/condition-executor.ts:251>). Một số behavior được bảo vệ bởi legacy internal-handler tests; không có public engine switch.

### Bảng 6 — Khác biệt giữa cách nói tương đương

| Nhóm nghĩa | Cách nói mới được route nhận | Cách nói không được nhận / khác kết quả | Evidence |
|---|---|---|---|
| Tắt Wi-Fi | `set wifi 0` → plan | `tắt wifi`, `Đặt wifi 0` → UNSUPPORTED_PHRASING | F01/F04/F06 |
| Độ sáng | `set brightness 80` → plan | `đặt độ sáng 80` → UNSUPPORTED_PHRASING; `set brightness 256` → NEEDS_CLARIFICATION | F02/F05/X14 |
| Pin | `Cho mình xem pin còn bao nhiêu`, `Kiểm tra trạng thái pin`, `read battery` → plan | Ghép `Mở Cài đặt và cho biết pin còn bao nhiêu` chưa parse được | B01/B04/X01/G03 |
| Wi-Fi read | `Cho mình biết Wi-Fi đang bật hay tắt`, `Wi-Fi có đang bật không?`, `read wifi` → READ_STATE | Không được suy `tắt wifi` thành read | B02/B05/X02/F04 |
| P1 Chrome | `Mở Chrome, tìm ocean và mở bài đầu tiên` → EXPERIMENTAL plan | `Mo Chrome, tim ocean va mo bai dau tien` → UNSUPPORTED_OUTCOME | D01/X22; parser path P1 còn phụ thuộc dấu |
| Alarm rõ period | `Đặt báo thức 7 giờ sáng`, `Dat bao thuc 7 gio sang`, `Set an alarm for 6:45 PM` → plan | `Đặt báo thức 3:30`, `Dat bao thuc 3:30` → một câu hỏi, chưa plan executable | E01/E02/X24/X26/X27 |
| 12 AM/PM/24h | `Set an alarm for 12 AM` → 00:00; `12 PM` → 12:00; `Set an alarm for 00:00` → 00:00 | `Set an alarm for 24:00` → NEEDS_CLARIFICATION | X38–X40/X28; typed temporal trong R |
| Timer | `Hẹn giờ 2 phút`, `Hen gio 2 phut`, `Start a timer for 1 hour 20 minutes` → 120/120/4800 s | `hen gio 0 phut` → NEEDS_CLARIFICATION | E03/X25/X29/X30 |
| Search tự nhiên | `Mở YouTube rồi tìm podcast`; `Ghé YouTube để tìm giúp mình hải dương học nhé`; `Vào Drive tìm giúp mình tài liệu tên báo cáo thực tập` → plan | Không suy toàn bộ lời nói tự do hoặc app ngoài allowlist | G02/X36/X37 |
| Multi-outcome | `open settings android.settings.SETTINGS; read battery` → 2 node; `read battery; set wifi 1` → 2 node | `read battery; open Maps` → chặn toàn câu | X32/X33/G01 |

## 7. Core có implementation nhưng chưa phải public capability

| Thành phần | Source thực tế và giới hạn | Trạng thái |
|---|---|---|
| CREATE_RECORD/structured record | `record-persistence.ts:8` có STABLE_DRAFT_ID, POST_SAVE_ID, EXACT_FIELDS_CREATED_AT; `persisted-record.ts` New/Save/reopen; `verification-registry.ts:50` identity + exact fields. Không chỉ dựa title/latest | Core OFFLINE_TESTED; catalog RECORD DISABLED; Notes thật chưa có accepted create/readback |
| FIND_ARTIFACT | `agent-v2.ts:454`, `media-view.ts`: exact content URI của artifact issued từ capture trong cùng execution; native top activity intent + foreground | Core offline exact-URI path; catalog GALLERY DISABLED; **Gallery UI find/pixel identity MISSING**, không coi URI view là tìm ảnh |
| NAVIGATE / bounded exploration | Grounded candidate + selected tab/header verifier; `bounded-exploration.ts:8`, `open-world-plan.ts:36`; model chỉ chọn ID | Core có bounded path; generic free-form navigation chưa được catalog mở và chưa chứng minh trên app mới |
| Các setting khác | Schema biết bluetooth/rotation/volume/flashlight/airplane; controller có danh mục strategies | Không đủ executor/verifier/inverse trên máy đã thử; public DISABLED; Bluetooth không được thử lại |
| COMPOSE_SMS | Intent capability `implemented:false`; tránh auto-draft; không send API | Complete non-persisting verifier **MISSING**, catalog không mở |
| Calls/send/purchase/destructive | Không có authority để thực thi từ command audit này | Không hỗ trợ trong phạm vi an toàn; owner mode không tự mở quyền ngoài scope |
| UI primitives | `grounded-candidates-v2.ts:36`, `grounded-interactions.ts`, effect-grants, observer/fresh revalidation | CLICK/SET_VALUE/SCROLL/BACK là công cụ có contract, không phải mọi câu “nhấn nút X” đều supported |
| Multi-device | `DeviceRuntimeRegistry.start:151` có giới hạn tối đa 4, physical dedup/locks và isolated task/Session; API Unified một execution gắn một device | OFFLINE simulation tests; chưa có current Android multi-device throughput proof. Group START UI không được render như đường Unified production |
| Clarification/assistance/cancel/reanalysis | `service.ts:56/:70/:83/:176/:182`, typed tokens, same execution binding; C17 validity latch/C18 idempotency tests | Offline contracts đạt; có cancel thật lịch sử, chưa browser acceptance mới cho current core-freeze source |

Đọc source không cho thấy “AI tự học thêm executor/verifier” khi gặp UI mới. [chooseCompatible:50](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/compatible-choice.ts:50>) có deterministic ranking/singleton trước model; [chooseGroundedNext:37](<C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/open-world-plan.ts:37>) chỉ cho IDs của grounded candidate hoặc abstain/page. Catalog chạy trước các proposal. **87 câu mới có 0 model call**, nên không chứng minh Groq/Ollama hiểu câu mới hay AI autonomy. Không đọc env để khẳng định provider đang hoạt động trên server của người dùng.

## 8. Test mới chạy và giới hạn môi trường

| Lần chạy | Kết quả thực tế | Diễn giải |
|---|---|---|
| Invocation đầu, 23 file | Bị ngắt trước khi có TAP/result; log 0 byte | Giữ `offline-tests-invocation.json`/log; không báo PASS hay tính task Android |
| Chạy tiếp 23 file, concurrency 1, offline guard | **649 PASS / 3 FAIL / 0 TODO**, 652 test, 111.565 s theo runner | FAIL #420/#424 ở multi-device-runtime HTTP, #436 ở owner-authorized-test-mode HTTP: `fetch failed` |
| Đối chứng test-owned loopback HTTP độc lập | `connect EACCES 127.0.0.1:<fixture-port>` | `network-diagnostic.json` xác nhận môi trường sandbox cấm connect; không dùng worker/app thật |
| Chạy lại đúng 3 HTTP tests với quyền loopback | **3 PASS / 0 FAIL**, 8.870 s | Cùng assertions/source, fake adapter, guard chỉ cho port server do chính process tạo. Không sửa test |

Kết luận đối soát: **652 test khác nhau đều có một lần PASS; lần đầy đủ 23-file vẫn là 649/3, không đổi thành một lần 652/0**. Đây là selected suite, không phải full regression 1418/0/6 mới. Danh sách invocation chính xác trong evidence; test names bị filter ở HTTP rerun, không dùng nó để báo lại toàn bộ hai file PASS. Tất cả guard counters blocked real-network/process/protected-read bằng 0; các kết nối được cho qua là server fixture của test. Console “runtime worker ready” trong ba test là **production worker-server module với adapter giả và thư mục test riêng**, không phải worker đang sở hữu điện thoại.

Coverage thực tế gồm catalog/router rejection, P1 loop/URL/title, search provenance/repeat, native state binding, camera new-artifact/anti-replay, temporal provider/UI positive-negative, record identity/reopen, owner/physical isolation, assistance/cancellation, C17 selection/route, C18 idempotency. Không coi mock task status không chạy verifier là outcome proof.

Các lỗi TypeScript/full ESLint/build từng báo trong tài liệu là lịch sử, không chạy lại để kiểm tra còn hay hết. `docs/demo-capabilities.md` ghi mốc 1358/0/6; các báo cáo core-freeze mới hơn có phạm vi/mốc khác. Audit này không tuyên bố full validation, runtime API health, UI browser acceptance hoặc production readiness.

## 9. Hạn chế và ưu tiên nguyên nhân

| Nhóm nguyên nhân | Evidence | Đánh giá / cách sửa tổng quát đề xuất, chưa thực hiện |
|---|---|---|
| Grammar hẹp và khác đường có dấu/không dấu | G03 UNPARSED_COMPOUND; X22 P1 thành launch `bai dau tien`; F04–F06 | Cần source-preserving grammar/slot coverage + parity tests; không rewrite input hoặc mở setting bằng regex thiếu contract |
| Catalog chủ động giới hạn | 20 CAPABILITY_DISABLED; Chrome-only search UNSUPPORTED | Có thể thiết kế admission theo capability+verifier evidence sau nghiệm thu; không gỡ allowlist để lấy demo PASS |
| Parser COMPLETE nhưng nghĩa không được public router chứng nhận | X22 raw compiler COMPLETE nhưng route từ chối | Luôn đánh giá toàn pipeline; không dùng compileOutcomes riêng để quảng cáo support |
| App/default resolution | X10/X11 adapter audit thiếu category; X20 fake package absent; historical URL ambiguous | Tách fixture limitation, ambiguous handler và verified installed inventory. Không kết luận điện thoại thiếu app từ dữ liệu giả |
| Thiếu independent evidence trên UI thật | Alarm continuity, Timer running decrement, V1 ordinal postcondition | Thu native inventory, baseline/delta và fresh after-state; giữ BLOCKED/UNKNOWN khi không chứng minh, không replay |
| Thiếu current acceptance | 17 historical success chuỗi ở digest khác current | Freeze source hiện tại, nghiệm thu nhỏ lần lượt; không nâng legacy/historical sang V2 current |
| API diagnostic làm mất chi tiết | X10/X11/X20 không code; NEEDS_CLARIFICATION chung ở invalid time/compound | Typed diagnostic có provenance là hướng cải tiến; audit không sửa route/compiler |
| Runtime version/lifecycle/TTL | Worker client:34 kiểm source digest; service:98 giới hạn ref; M7a search NOT_EXECUTED do TTL | Phải nạp đúng worker/source, analyze ref mới, không khôi phục authority sau restart; không tự retry khi unknown |

Không có dữ liệu mới để chẩn đoán lỗi điện thoại hiện tại, server đang chạy hay độ trễ model. Không suy root cause UI cụ thể của app chưa từng quan sát; các trường hợp đó **UNKNOWN_ROOT_CAUSE / chỉ thiếu nghiệm thu**.

## 10. Đề xuất nghiệm thu Android riêng, chưa thực hiện

| Ưu tiên / câu | Quyền và điều kiện | Evidence cần / điểm dừng |
|---|---|---|
| 1. `Cho mình xem pin còn bao nhiêu`; `Cho mình biết Wi-Fi đang bật hay tắt`; `Xem độ sáng` | Chủ thiết bị cho đọc; đúng identity, unlocked, worker/source hiện tại, một Session | Hai native paths khớp, issued proof, đối chứng ngoài claim; dừng nếu locked/disagree/stale |
| 2. `Mở YouTube`; `Mở Drive`; `Mở My Files`; `Mở bàn phím quay số 5550100` | Cho mở app/DIAL prefill, tuyệt đối không CALL | Foreground/activity và exact digits; không nhận consent hoặc bấm call |
| 3. `Mở YouTube và tìm hải dương học`; `Vào Drive tìm giúp mình tài liệu tên báo cáo thực tập`; `Mở My Files và tìm ocean` | Search-only, không mở result; thử trạng thái đã có query/video chỉ khi scope cho phép | Exact committed query, RESULTS/NO_RESULTS, không watch page/file opening; ghi cold/warm riêng, không cộng overlapping spans |
| 4. `Mở máy tính và tính 125 * 48` | Chỉ khi chủ thiết bị cho thao tác biểu thức thử và không ghi đè dữ liệu cũ | Expression đúng + result6000/locale + oracle independent; thiếu clear/new scope thì dừng |
| 5. Chrome P1 `Mở Chrome, tìm ocean và mở bài đầu tiên` | **Phải cấp quyền riêng cho mở bài**; không nằm trong search-only envelope | First organic exclusion ads, exact URL/title/destination/loaded DOM + manual comparison; block khi thiếu DOM/identity |
| 6. Camera/alarm/timer | Cần quyền tạo một artifact mới riêng; baseline xác nhận chưa có duplicate. Không dùng lại quyền cũ | MediaStore +1; alarm new identity/enabled+complete inventory; timer đúng duration+2 reads RUNNING giảm. Báo trước Start; giữ artifact, không tự xóa; UNKNOWN không lặp |
| 7. `set wifi 0`, `set brightness 80`, `set dnd 0` | Full-control đúng physical device, journal/inverse, scope khôi phục; ưu tiên USB cho Wi-Fi | Fresh original value, mutation ACK+postpair, inverse+readback, lưu journal. Thiếu restoration dừng/manual assistance; **không bật Bluetooth** |
| 8. Cancel/assistance/TTL/device loss | Bài search không ghi, chủ thiết bị đồng ý | Một click/dispatch, same execution/Session khi resume, cancel close/release; zero active tasks/owner modes cuối lượt |

Đây chỉ là danh sách đề xuất. Audit không tự bật owner/full-control, không gửi EXECUTE thật, không tạo/xóa artifact hoặc thay setting.

## 11. Tính toàn vẹn và giới hạn kết luận

Source/test/script manifest **311/311 không đổi**; SHA-256 tổng map path/hash trước=sau:

`d9deddf31de409e149cffca81a81e921e3ec0fe76e941928046e2e0db2725f34`.

Runtime hiện tại, **141 file lib/android/**/*.ts**, cùng thuật toán `androidRuntimeDigest`:

`4feef6fb078163b162d98e1e631a3eed2d4a8a1e9a40fd6d055ce74e915673f0`.

Không trùng các checkpoint lịch sử đã đọc. Git HEAD/branch/index giữ nguyên; index SHA-256 trước=sau `36d8254ddf6ddd6a67ae99341c61f7c68eda7953daaf664c261869aca89ceb10`. Mọi dirty/deleted/untracked application file có sẵn được giữ nguyên. `git diff --check` exit 0 (có cảnh báo LF/CRLF trên file cũ); scan riêng Markdown mới không có trailing whitespace. Secret scan chỉ output audit mới: 0 high-confidence finding; phạm vi/số file/giới hạn và SHA báo cáo nằm trong `report-qa.json`, không phải chứng minh toàn repo không có secret. Chi tiết status đầu/cuối nằm trong I. Không đọc/hash lại fixtures benchmark bị loại trừ.

**Điều đã chứng minh:** public Unified chọn V2 theo catalog; 87 câu có kết quả nhận diện/planning xác định trong fixture; các executor/verifier chọn lọc có regression offline thật; raw history xác nhận một số outcome đã chạy trên một Samsung ở phiên bản cũ.

**Điều chưa chứng minh:** 100 câu đều chạy trên Android hiện tại, app/UI bất kỳ, LLM planning tự chủ, tốc độ Groq/Ollama, Gallery tìm ảnh, Notes persistence thật, Chrome ordinal bất kỳ, Alarm/Timer Samsung mới hoàn tất, đa thiết bị thật hoặc current Dashboard browser PASS. Không có false-completion rate Android mới để tính vì **0 execution Android mới**; denominator không phải 87 ANALYZE. Báo cáo không biến SENT, BLOCKED, NO_RESULTS search hoặc legacy attempt thành bằng chứng sai cho outcome khác.

Đã dừng sau kiểm kê/tài liệu; không triển khai tính năng hay sửa code.
