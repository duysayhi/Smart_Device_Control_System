# Dashboard Browser Acceptance C1: lượt thử lại

Ngày 26/10/2026, branch DuyTD. **BLOCKED ở interactive bootstrap; chưa đủ điều kiện sang Android Acceptance.** Không sửa source/test/config/provider/dependency, không commit/push. Chỉ C1.

## 1. Kết quả mới, không gộp lịch sử

| Lớp | PASS | FAIL | BLOCKED | NOT_RUN | Mẫu số |
|---|---:|---:|---:|---:|---|
| A: browser thực + backend giả | 0 | 0 | 1 | 19 | A00 bootstrap và C01-C19 |
| B: browser thực + route thật/fake worker | 0 | 0 | 0 | 19 | C01-C19, lớp tùy chọn chưa chạy qua browser |

Riêng **API-only C15: 1/1 kiểm tra hợp lệ PASS**, với hai probe được lưu: lần đầu lỗi encoding phía CLI, lần sau giữ đúng source UTF-8. Không cộng API-only vào browser PASS. Không cấp nhãn BROWSER_UI_MOCKED_BACKEND_TESTED hoặc BROWSER_REAL_ROUTE_FAKE_WORKER_TESTED cho các ca chưa chạy.

Evidence mới: **coverage/dashboard-browser-c1-retry-GWeUKg/**. Lượt trước coverage/dashboard-browser-c1-tAo3QG/ giữ nguyên; bản báo cáo trước được giữ byte-identical tại previous-acceptance-report.md trong evidence mới. Mục 23.1-23.4 của engine-merge-report.md giữ nguyên lịch sử; kết quả lần này thêm ở 23.5-23.8.

## 2. Preflight và isolation

Đã đọc AGENTS.md, source Dashboard/Unified, tests/engine-merge-single-path.test.cjs, demo-capabilities.md và report mục 18/22/23. Git status xác nhận DuyTD, nhiều modified/untracked và hai deleted có sẵn, không reset/checkout/stash/stage/khôi phục. preflight.json lưu status và hash 309 source/test/script trong phạm vi; không đọc/hash lại hai path open-world bị loại trừ.

Read-only inventory: Next.js listener 3000/PID 13476; Appium 4723/PID 28268; Ollama 11434/PID 1640; một PID 4476 được phân loại possible-worker, **không kiểm tra health/tasks hoặc tuyên bố idle**. Không in raw command lines, đọc .env hoặc gọi các API dịch vụ thật. Không khởi động/dừng/restart dịch vụ của người dùng.

Dùng browser in-app Chromium đã có, **tab tạm mới**, không tái sử dụng tab lỗi của lượt trước. Không cài package/browser, không dùng raw CDP hoặc thay công cụ để vượt policy. Browser giữ background.

Harness mới c1-proxy.cjs tại loopback **58747**, tạo từ harness cũ bằng apply_patch, capture trong bộ nhớ từ đầu. Chỉ proxy GET trang gốc/static/favicon và HMR tới Next 3000; mọi /api/* bị chặn/intercept. Các lệnh không thuộc ANALYZE/CLARIFY/REANALYZE hoặc đường legacy/owner/EXECUTE/START bị 403 trước upstream. Không sửa CSP hay security của ứng dụng; CSP giới hạn kết nối chỉ áp dụng ở proxy thử.

- **A:** API/device/runtime đều giả, mỗi source C01-C14 có fixture riêng; source lạ không tự PASS. Device C1_FAKE_A không có screenshot URL. Không owner/full-control/grant.
- **B:** giữ hàm GET/POST production app/api/unified-agent/route.ts, Unified service/catalog/compiler; alias worker-client sang fake GET/PREPARE, runtime digest sang test digest. ADB/child process/fetch ngoài scope có tripwire. Không đổi source route.
- **Giới hạn B:** harness gọi route functions, không kiểm Next HTTP adapter hoặc worker thật. Trong lượt này chỉ C15 đi qua POST thật; bị reject trước context/PREPARE/compiler, nên không tuyên bố compiler đã được nghiệm thu lại.
- Mọi request API thật tới Next/worker đều bằng 0 trong harness; không mở Dashboard trực tiếp ở 3000 để bấm Analyze.

## 3. Browser thực: bằng chứng và rào cản

**A00 BLOCKED:** mở http://127.0.0.1:58747/ trong tab mới. Dashboard ban đầu render được, có một input Unified, dropdown chưa có device giả, Analyze/Execute/Stop disabled, owner/full-control tắt. Chờ option device giả không thành công. Click tab Wi-Fi chuyển focus nhưng USB vẫn selected, nội dung vẫn USB: **chưa xác minh được event handler/state React hoạt động**. Không click Thực thi hoặc bật mode.

Proxy ghi **320 frontend HTTP responses đều 200**, gồm **10 GET trang gốc**. Chỉ có một điều hướng mở trang do agent chủ động; không tự gán nguyên nhân các GET lặp lại là HMR, lỗi Next hoặc lỗi ứng dụng. **0 browser API request**, nên không có browser ANALYZE để chấm. React DevTools info xuất hiện nhiều lần; đó không phải bằng chứng Dashboard hydrate thành công.

Lượt này **không gặp lại chặn URL policy trên tab lỗi**: đã đóng tab khi proxy còn chạy, rồi shutdown proxy. Vì thế blocker được tái quan sát ngay trên tab mới, không thể quy toàn bộ kết quả trước cho stale error tab. Root cause vẫn **UNVERIFIED**, chưa tách được frontend hydration, server/build state, proxy/HMR hoặc browser instrumentation. Không sửa source để làm test xanh.

Evidence thực:
- screenshots/bootstrap.jpg: ảnh browser thật, không phải SSR render hoặc ảnh tạo.
- bootstrap-dom.txt: DOM sau click Wi-Fi, USB vẫn selected, Analyze disabled.
- browser-console.log: export JSON của **6 entries info, 0 error/0 warning trong phần thu được**. Không coi thiếu error entry là đã chứng minh mọi JavaScript/promise hoạt động.
- network-bootstrap.json và network-summary-final.json: request capture; network-summary.json tóm tắt.

![Initial Dashboard chưa hydrate](../coverage/dashboard-browser-c1-retry-GWeUKg/screenshots/bootstrap.jpg)

## 4. Bảng từng ca

A/B là lớp browser; N nghĩa chưa gửi ANALYZE qua UI do A00. Engine/source/catalog/loading/rejection chưa được nghiệm thu chỉ vì fixture đã được soạn. C15 là kiểm tra API riêng, không có field debugEngine trên UI.

| ID | Browser | Route | Expected | Actual | Verdict A / B | Evidence |
|---|---|---|---|---|---|---|
| A00 | In-app Chromium, tab mới | A backend giả | React hydrate, device giả, tương tác được | Device không tải, click Wi-Fi không đổi state đã xác minh, 0 browser API | BLOCKED / không áp dụng | bootstrap.jpg, bootstrap-dom.txt, network-summary.json |
| C01 | Chưa chạy ca | A mock / B production route + fake worker | Mở YouTube: OPEN_APP ENABLED V2 | N | NOT_RUN / NOT_RUN | test-matrix.json C01; result JSON |
| C02 | Như trên | Như trên | Mở Cài đặt: OPEN_SETTINGS ENABLED V2 | N | NOT_RUN / NOT_RUN | C02 |
| C03 | Như trên | Như trên | Cho mình xem pin còn bao nhiêu: READ_STATE ENABLED V2 | N | NOT_RUN / NOT_RUN | C03 |
| C04 | Như trên | Như trên | Cho mình biết Wi-Fi đang bật hay tắt: READ_STATE ENABLED V2 | N | NOT_RUN / NOT_RUN | C04 |
| C05 | Như trên | Như trên | Mở máy tính và tính 125 * 48: CALCULATE ENABLED V2 | N | NOT_RUN / NOT_RUN | C05 |
| C06 | Như trên | Như trên | Mở YouTube và tìm hải dương học: SEARCH ENABLED V2 | N | NOT_RUN / NOT_RUN | C06 |
| C07 | Như trên | Như trên | Mở Chrome, tìm ocean và mở bài đầu tiên: BROWSER_FIRST EXPERIMENTAL V2 | N | NOT_RUN / NOT_RUN | C07 |
| C08 | Như trên | Như trên | Đặt báo thức 7 giờ sáng: ALARM EXPERIMENTAL | N | NOT_RUN / NOT_RUN | C08 |
| C09 | Như trên | Như trên | set wifi 0: SET_STATE ENABLED, không grant ghi | N | NOT_RUN / NOT_RUN | C09 |
| C10 | Như trên | Như trên | tắt wifi: 409 UNSUPPORTED_PHRASING, giữ source | N | NOT_RUN / NOT_RUN | C10 |
| C11 | Như trên | Như trên | open url https://example.com: CAPABILITY_DISABLED | N | NOT_RUN / NOT_RUN | C11 |
| C12 | Như trên | Như trên | capture photo then delete old photos: HARD_DENY toàn câu | N | NOT_RUN / NOT_RUN | C12 |
| C13 | Như trên | Như trên | read battery; open Maps: từ chối toàn câu | N | NOT_RUN / NOT_RUN | C13 |
| C14 | Như trên | Như trên | Đặt báo thức 3:30: sáng/chiều, plan mới, không grant | N | NOT_RUN / NOT_RUN | C14 |
| C15 | API-only, không có UI field | Production POST function dưới harness | debugEngine: null -> 400 ENGINE_SELECTION_REMOVED | Đúng 400, không plan/context/PREPARE; browser không chạy | NOT_RUN / NOT_RUN; API-only PASS | api-only-engine-selection-utf8.json |
| C16 | Chưa hydrate | A mock / B fake context | Không device: hạn chế controls | Initial disabled nhìn thấy; chưa test dynamic state | NOT_RUN / NOT_RUN | result JSON C16 |
| C17 | Chưa chạy | Như trên | Device unavailable: không silent switch | Chưa browser repro; source risk phần 6 | NOT_RUN / NOT_RUN | result JSON C17 |
| C18 | Chưa chạy | Error/delay fixture | Loading/error/timeout kết thúc, không replay/EXECUTE | Chưa Analyze được | NOT_RUN / NOT_RUN | result JSON C18 |
| C19 | Chỉ initial DOM | Dashboard | Không engine/group START/version/legacy Task Queue | Initial DOM không thấy controls cũ; chưa đủ interactive assertion | NOT_RUN / NOT_RUN | bootstrap-dom.txt, result JSON C19 |

Không plan/COMPLETED từ browser, không kiểm false-completion hoặc engine fallback bằng execution. Không biến initial DOM/SSR thành browser PASS.

## 5. API-only và safety counters mới

POST tới harness với debugEngine: null, Origin loopback đúng scope:
1. Probe đầu bị PowerShell CLI thay ký tự tiếng Việt trong source thành dấu hỏi; **giữ riêng artifact**, không tính là kết quả exact-source.
2. Probe dùng Unicode escape truyền đúng **Mở YouTube**, nhận HTTP **400 ENGINE_SELECTION_REMOVED**, không plan/execution. Đây là **1/1 API-only check PASS**, không phải C01 hoặc browser acceptance.

Hai request đều reject trước worker: fake GET/PREPARE **0/0**, real worker **0**. Evidence api-only-engine-selection.json và api-only-engine-selection-utf8.json; không ghi UUID/grant/token ra screenshot/log.

| Counter của lượt mới | Số |
|---|---:|
| Frontend HTTP / root GET | 320 / 10, đều 200 |
| Browser API requests / CLI API probes | 0 / 2 |
| API forwarded tới Next / real worker calls | 0 / 0 |
| Fake worker GET / PREPARE | 0 / 0 |
| START / Appium Session / ADB | 0 / 0 / 0 |
| Model calls / external fetch attempts trong harness | 0 / 0 |
| Process attempts / owner changes / execution grants | 0 / 0 / 0 |

**Có network loopback thật** lấy frontend/static/HMR và gọi harness. Không có Android/Ollama/Groq/cloud call do C1 gửi qua đường cô lập đã kiểm tra. Không suy counters thành kiểm toán toàn bộ hoạt động các dịch vụ của người dùng.

## 6. Findings và đề xuất, chưa sửa

| Mức / loại | Vấn đề | Bằng chứng / tái hiện | Hướng xử lý cần duyệt |
|---|---|---|---|
| P1, TEST_INFRA_BLOCKED | Interactive bootstrap tiếp tục không đạt trên tab mới, chặn C01-C19 | Mở proxy cô lập, chờ device giả, click Wi-Fi; DOM không đổi state, 0 browser API; screenshot và network đầy đủ | Điều tra frontend/build state và proxy/HMR/browser; chưa đủ bằng chứng chỉ định patch source. Có thể kiểm tra lại sau một lần chủ dự án khởi động lại Next dev; chưa thực hiện, chưa chứng minh sẽ sửa lỗi |
| P1, VERIFIED_IN_SOURCE / BROWSER_UNVERIFIED | Selection có thể chuyển sang máy READY khác khi máy cũ không READY, trái C17 | lib/android/device-selection.ts:43-49 fallback; hooks/useDashboardDemo.ts:50-53 áp selection. Chưa thực thi nhầm máy hoặc browser repro | Bản vá riêng ở device-selection và tests selection: tách initial auto-select khỏi selected-device unavailable; giữ/clear selection và yêu cầu chọn lại. Thêm browser offline-with-other, giữ identity/plan binding |
| P2, EVALUATION_LIMIT | Chưa kiểm error/timeout, AM/PM, experimental labels, no duplicate/replay và final success UX | Toàn bộ browser ca nghiệp vụ NOT_RUN | Rerun C1 khi bootstrap đạt; không tính mock data hoặc baseline test thay bằng chứng |

Source xác nhận đường dự kiến: UnifiedAgentPanel.tsx:28,52 gửi Analyze; :115-116 gate Analyze/Execute; :126-141 render clarification/catalog/reanalyze. app/api/unified-agent/route.ts:55-61 chặn engine selection trước service; :71 map 400. Đây là source evidence, không thay browser assertions.

Không đề xuất sửa catalog/parser/planner/worker/security vì chưa có bằng chứng cần thiết; không triển khai bản vá Dashboard hoặc selection trong lượt này.

## 7. Bảo toàn và validation

- **309 source/test/script hash so trước-sau không đổi**, 7 config/AGENTS/package/lock không drift; không đọc/hash lại excluded open-world paths. Không tuyên bố digest 311 lịch sử là phép đo mới.
- Giữ nguyên toàn bộ report trước lượt này qua prefix byte hash; append 23.5-23.8, không sửa mục 0-22 hoặc lịch sử BLOCKED. Bản báo cáo C1 trước được bảo toàn trong evidence. demo-capabilities.md **không đổi**, chưa có bằng chứng nâng nhãn.
- git diff --check **exit 0**; scan hẹp các file C1 viết không có high-confidence secret/trailing whitespace. Không đọc .env/secret/cohort, không gọi đây là full secret audit.
- **Không rerun regression/TypeScript/lint/production build**, vì không sửa source. Baseline lịch sử mục 22: 1358 PASS / 0 FAIL / 6 TODO, B5 68/68, TS/scoped lint PASS; full lint 0 errors/4 warnings; build exit 1 SecurityFatalError. Không nâng cấp hoặc bypass guard.
- Tab thử đã đóng **trước** shutdown; proxy duy nhất do lượt mới tạo kết thúc graceful, session 39420 exit 0. Không force-kill hoặc đụng dịch vụ người dùng. Fake active tasks/owner modes **0/0**; C1 không tạo real Session/grant/mode. Không truy vấn cuối worker thật để tuyên bố global active tasks bằng 0.
- File sửa: docs/dashboard-browser-acceptance.md và phần append docs/engine-merge-report.md. File thêm: harness/evidence ignored trong directory mới. Runtime/test/config không đổi, giữ mọi dirty/deleted có sẵn. final-safety-check.json ghi git status trước/sau, hash, diff và cleanup.

## 8. Điều chứng minh và chưa chứng minh

Lượt mới chứng minh initial Dashboard thực render trong browser, asset requests có phản hồi 200, tab mới vẫn chưa đạt interactive bootstrap, và production POST function từ chối debugEngine: null trước worker bằng một probe UTF-8 đúng. Có screenshot/DOM/console/network thật; không còn phải dựa vào ghi chú không export được như lượt trước.

**Không chứng minh** browser Analyze/plan/clarification/errors thành công, Android capabilities hoặc AI generalization, cũng không chứng minh hệ thống production-ready. Browser PASS vốn cũng không đồng nghĩa Android COMPLETED; lượt này chưa có browser case PASS.

**Chưa đủ điều kiện sang Android Acceptance.** Dừng C1, không C2/P1 Android, P2 YouTube, temporal acceptance, sửa SecurityFatalError, archive/xóa legacy hoặc Teach Mode.

## C1-Final (2026-10-26): Browser Acceptance sau C1-D

### F1. Kết quả và phạm vi

**A00 PASS; C1-Final tổng thể FAIL, chưa đủ điều kiện chuyển Android Acceptance.** Không sửa application source, tests, config hoặc dependencies. Không thực thi Android, inference, owner/full-control hoặc grant. Lịch sử C1/C1 retry phía trên được giữ nguyên; kết quả mới chỉ nằm trong phần append này.

| Lớp | PASS | FAIL | BLOCKED | NOT_RUN | Phạm vi |
|---|---:|---:|---:|---:|---|
| A: browser + backend fixtures | 16 | 2 | 0 | 1 | 18 browser cases; C15 không có UI field |
| B: browser + production route functions/fake worker | 16 | 2 | 0 | 1 | 18 browser cases; C15 báo riêng |
| C15 API-only | 1 | 0 | 0 | 0 | Không cộng vào browser PASS |

Không cộng A+B thành tỷ lệ thành công chung. PASS ở đây là UI/admission/analysis đúng kỳ vọng, **không phải task COMPLETED**.

Evidence root: `coverage/dashboard-browser-c1-final-Kn6YYV/`. Mỗi dòng dưới có DOM/screenshot tại `cases/<layer>-<ID>.json`, `screenshots/<layer>-<ID>.jpg`, và đối chiếu request/response/assertions tại `cases/<layer>-<ID>-network.json`. C15 chỉ có JSON, không dựng screenshot giả. Network đầy đủ: `browser-network.json`; tổng hợp: `test-matrix.json`, `final-acceptance.json`; console: `browser-console.log`.

### F2. A00 và harness

Tab IAB mới, URL **http://localhost:63396/**. HMR `/_next/hmr` nhận **HTTP/1.1 101 Switching Protocols**, Origin nguyên `http://localhost:63396`; query được chuyển nguyên theo req.url, không sửa Origin. Console có "[HMR] connected". React gọi API fake, dropdown chọn được C1_FAKE_A; Analyze enabled/Execute disabled lúc chưa có plan; click Wi-Fi hiện IP/Connection port và click USB trở lại danh tính fake. Evidence `bootstrap-result.json`, `screenshots/A00.jpg`.

Harness chỉ forward GET root, `/_next/static/`, favicon, đúng font DevTools `/__nextjs_font/geist-latin.woff2`, và hai HMR path exact hiện hành/legacy. 33 frontend GET, đều 200 với content-type JS/CSS/HTML/font tương ứng; không HTML fallback cho JS. Không wildcard API proxy. Không rerun D1/D2 hoặc chỉnh Next config. Lần launch trong sandbox đầu tiên có listener nhưng browser/HTTP không truy cập được; dừng riêng process thử đó, launch harness ngoài sandbox rồi A00 mới PASS. Đây là chuẩn bị môi trường, không tính thêm browser case. Next/worker người dùng không restart hoặc force-kill.

Lớp A dùng fixture riêng cho từng source, từ chối input ngoài danh sách. Lớp B gọi trực tiếp production functions `app/api/unified-agent/route.ts:51`/GET, không fixture plan frontend. Worker-client, runtime digest và ADB boundary bị mock; backend/context là giả, không phải Next HTTP production adapter hoặc worker/Android thật. Request Host/Origin localhost gốc được giữ. Fake PREPARE chỉ nhận engine V2, gọi thật `proposeIntentOutcomes`, `registerReviewedOutcomes`, `compileOutcomes`; yêu cầu graph COMPLETE rồi mới trả prepared reference giả. Không chạy prepared-v2 worker pipeline hoặc model.

Tripwires: global fetch, child_process spawn/exec/fork, http/https requests và net.connect ngoài allowlist; ADB discovery/runAdb ném lỗi; mọi API không thuộc fake GET hoặc ANALYZE/CLARIFY/REANALYZE bị deny. Không bấm Execute để chứng minh an toàn.

### F3. Lớp A: browser + mocked backend

| ID | Input / Expected | Actual | Verdict | Evidence |
|---|---|---|---|---|
| C01 | Mở YouTube; OPEN_APP ENABLED V2 | Plan đúng source/device/catalog, V2 | PASS | A-C01 |
| C02 | Mở Cài đặt; OPEN_SETTINGS ENABLED V2 | Plan OPEN_SETTINGS | PASS | A-C02 |
| C03 | Cho mình xem pin còn bao nhiêu; READ_STATE | READ_STATE ENABLED | PASS | A-C03 |
| C04 | Cho mình biết Wi-Fi đang bật hay tắt; READ_STATE | READ_STATE ENABLED | PASS | A-C04 |
| C05 | Mở máy tính và tính 125 * 48; CALCULATE | CALCULATE ENABLED | PASS | A-C05 |
| C06 | Mở YouTube và tìm hải dương học; SEARCH | SEARCH ENABLED | PASS | A-C06 |
| C07 | Mở Chrome, tìm ocean và mở bài đầu tiên; BROWSER_FIRST | EXPERIMENTAL / UNVERIFIED nhìn thấy | PASS | A-C07 |
| C08 | Đặt báo thức 7 giờ sáng; ALARM | EXPERIMENTAL / UNVERIFIED nhìn thấy | PASS | A-C08 |
| C09 | set wifi 0; SET_STATE ENABLED, không grant | Plan đúng; Execute có thể enable, không click, 0 grant | PASS | A-C09 |
| C10 | tắt wifi; UNSUPPORTED_PHRASING | 409, thông điệp gợi ý typed, input không đổi, không plan | PASS | A-C10 |
| C11 | open url https://example.com; CAPABILITY_DISABLED | 409, không plan | PASS | A-C11 |
| C12 | capture photo then delete old photos; HARD_DENY toàn câu | 403, không partial plan | PASS | A-C12 |
| C13 | read battery; open Maps; CAPABILITY_DISABLED toàn câu | 409, không partial plan | PASS | A-C13 |
| C14 | Đặt báo thức 3:30; hỏi sáng/chiều | Một câu hỏi hai radio; chọn sáng qua UI; plan mới 3:30 AM, giữ original source, 0 grant | PASS | A-C14 và A-C14-question |
| C15 | debugEngine: null; 400 | Không UI field; không giả thành browser PASS | NOT_RUN | A-C15.json; API-C15.json |
| C16 | Không device; controls bị hạn chế | Analyze/Execute/owner/full-control disabled, selection trống | PASS | A-C16 |
| C17 | A+B READY, chọn A, plan A, A OFFLINE/B READY; không auto-switch | **Tự chọn B**; A plan còn hiển thị, Execute disabled, Analyze enabled | FAIL | A-C17, A-C17-before |
| C18 | Loading/error/timeout, không replay | Delay/503/504 đúng; đóng kết nối tạo 2 ANALYZE từ một click | FAIL | A-C18 và bốn variant |
| C19 | Một command surface, không engine/group START/legacy queue | Một command textbox, một device select; không engine radios; history còn | PASS | A-C19 |

### F4. Lớp B: browser + production route functions + fake worker

| ID | Expected | Actual | Verdict | Evidence |
|---|---|---|---|---|
| C01 | OPEN_APP ENABLED V2 | 200; OPEN_APP, V2 | PASS | B-C01; request 1120 |
| C02 | OPEN_SETTINGS ENABLED V2 | 200; OPEN_SETTINGS, V2 | PASS | B-C02; 1123 |
| C03 | READ_STATE ENABLED V2 | 200; READ_STATE, không SET_STATE/navigation | PASS | B-C03; 1125 |
| C04 | READ_STATE ENABLED V2 | 200; READ_STATE, không SET_STATE/navigation | PASS | B-C04; 1127 |
| C05 | CALCULATE ENABLED | 200; OPEN_APP + CALCULATE; mọi catalog row hiện đúng | PASS | B-C05; 1131 |
| C06 | SEARCH ENABLED | 200; OPEN_APP + SEARCH | PASS | B-C06; 1135 |
| C07 | BROWSER_FIRST EXPERIMENTAL | 200; OPEN_APP + BROWSER_FIRST, cảnh báo UNVERIFIED | PASS | B-C07; 1138 |
| C08 | ALARM EXPERIMENTAL | 200; ALARM, cảnh báo UNVERIFIED | PASS | B-C08; 1194 |
| C09 | SET_STATE ENABLED, chưa grant | 200; SET_STATE, 0 grant; không click Execute | PASS | B-C09; 1196 |
| C10 | tắt wifi -> UNSUPPORTED_PHRASING | 409, source nguyên, 0 PREPARE, không plan | PASS | B-C10; 1199 |
| C11 | URL disabled | 409 CAPABILITY_DISABLED, 0 PREPARE | PASS | B-C11; 1203 |
| C12 | Mixed destructive HARD_DENY | 403 HARD_DENY toàn câu, 0 PREPARE | PASS | B-C12; 1205 |
| C13 | Mixed unsupported disabled toàn câu | 409 CAPABILITY_DISABLED, không partial plan, 0 PREPARE | PASS | B-C13; 1209 |
| C14 | Một AM/PM clarification, plan mới sau trả lời | 200 question, 0 PREPARE; UI chọn AM; CLARIFY -> 1 PREPARE, reference mới, original source giữ lại, 0 grant | PASS | B-C14-question, B-C14; 1211/1237 |
| C15 | debugEngine: null ->400 | API-only 400 ENGINE_SELECTION_REMOVED; không browser field | NOT_RUN | B-C15.json; API-C15.json |
| C16 | Không device | Main Analyze/Execute/owner/full-control disabled; selection trống | PASS | B-C16 |
| C17 | Không silent switch A->B | **Tự chọn B**; stale A plan không executable, chỉ 1 ANALYZE cho A | FAIL | B-C17-before, B-C17; 1446 |
| C18 | Không replay sau lỗi/timeout | 8s delay/503/504 đúng; đóng kết nối ->2 ANALYZE, request thứ hai đi route thật/fake PREPARE | FAIL | B-C18; 1600/1703/1766/1837/1838 |
| C19 | Không legacy launchers | Cấu trúc một input/device select, không engine/group launcher; history còn | PASS | B-C19 |

Cùng source C01-C14 của bảng A được nhập nguyên ở B. Đã đối chiếu text value với request source và plan source từng ca, engine V2, device/physicalId fake, catalog status và từng label trong DOM. Không có Action Plan/V1 fallback. Sidebar "Hàng đợi" chỉ là navigation, không phải Task Queue launcher.

**C15 API-only PASS mới:** production POST nhận debugEngine:null trả 400 ENGINE_SELECTION_REMOVED, counter PREPARE không tăng. Không tính lại probe lịch sử.

### F5. Chứng cứ production call path và counters

Browser POST -> harness tái dựng Request cùng Host/Origin -> production POST `app/api/unified-agent/route.ts:51-63` -> `UnifiedAgentService.analyzeForDashboard` (`service.ts:48`) -> catalog/router `capability-router.ts:29` -> context fake -> `service.ts:87` prepare V2 -> production worker adapter `route.ts:30` -> fake PREPARE -> goal compiler thật. Clarification đi `service.ts:62-74`, không prepare trước chọn period. Fake runtime digest chỉ chứng minh binding với context giả cố định, không chứng minh hash validation của worker thật.

| Counter | Thực đo |
|---|---:|
| API requests tất cả | 1972 |
| Browser API / API-only | 1971 / 1 |
| GET polling/bootstrap / POST | 1929 / 43 |
| A API / POST | 1100 / 21 |
| B API / POST (gồm C15 API-only) | 872 / 22 |
| Production route GET / POST | 530 / 19 |
| Fake worker GET / PREPARE | 28 / 13 |
| Real compileOutcomes calls | 13 |
| API forward tới Next / real worker | 0 / 0 |
| EXECUTE/START / Appium Session / ADB | 0 / 0 / 0 |
| Ollama/Groq/model / owner changes / grants | 0 / 0 / 0 |
| Fetch/process/outside-network tripwire attempts | 0 / 0 / 0 |

GET nhiều do polling trong thời gian quan sát, không phải 1929 tasks hoặc AI calls. B có 9 plan bình thường +1 sau clarification +1 C17 +1 C18 delay +1 retry transport =13 PREPARE/compile; không tính request bị đóng/503/504 là route invocation. Counters ở `api-isolation-counters.json`; individual counter deltas và request seq nằm trong `browser-network.json`. 13 graph coverage đều COMPLETE nhưng không có outcome Android được thực thi.

Server-side thời gian ANALYZE B C01-C09 lần lượt **118.99 / 8.50 / 11.67 / 9.19 / 31.21 / 14.93 / 26.25 / 22.07 / 11.72 ms**. C14 question **7.14 ms**, CLARIFY **9.63 ms** (không cộng các spans). C18 delay A/B **8009.21 / 8009.36 ms**, gồm 8000 ms injection. Đây không phải inference latency hoặc Android latency; UI tool timing khác được ghi riêng trong case JSON, không cộng chồng. Một locator wait ở A-delay hết deadline trước khi lần đọc DOM sau thấy plan; không bấm/gửi lại, network chỉ một request.

### F6. Lỗi thực tế và giới hạn kết luận

| Mức / Loại | Expected -> Actual và evidence | Root cause / hướng sửa riêng, chưa thực hiện |
|---|---|---|
| P1, UI/source, C17 FAIL cả A/B | A+B READY, chọn A/plan A; A OFFLINE làm dropdown chọn B. A plan giữ nhưng Execute disabled; không request cho B, không mis-execution | `lib/android/device-selection.ts:43-49` chỉ giữ selection READY, nếu không chọn READY đầu; `hooks/useDashboardDemo.ts:50-53` áp selection đó. Tách initial auto-select khỏi explicit selection mất kết nối; giữ/clear selection và yêu cầu chọn lại, test offline-with-other |
| P2, UI label, đi cùng C17 | UI ghi "Kế hoạch hết hạn" cho device mismatch; cần reanalyze | `UnifiedAgentPanel.tsx:25,140-141` gom source/device/TTL invalid thành một nhãn hết hạn. Phân biệt nguyên nhân và invalidate khi đổi external device; không nới binding |
| P2, transport/harness contract, C18 FAIL cả A/B | Một click; A seq1006 CONNECTION_CLOSED ->1007 200; B1837 CONNECTION_CLOSED ->1838 200. Không UI alert cuối, plan được trả lại | Browser HTTP retry là giả thuyết; chưa trace tầng transport để kết luận chính xác. Source `UnifiedAgentPanel.tsx:27-30` chỉ một fetch, không loop retry. Harness fault one-shot đóng socket trước headers cho phép request kế tiếp; không đổi fixture để ép PASS. Kiểm tra transport + fault có response headers và correlation/idempotency cho ANALYZE trong lượt riêng |
| P3, UI observation bổ sung | B-C16 giữ stale plan, "Phân tích lại kế hoạch" vẫn enabled trong khi main Analyze/Execute/owner bị khóa | `UnifiedAgentPanel.tsx:141` không xét device availability cho reanalyze button. Không click, chưa xác minh request/result; không suy ra dispatch hoặc quyền được cấp |

C18 PASS từng variant delay/503/504: pending và Execute disabled khi chờ; lỗi 503/504 hiện, pending kết thúc, không tự gửi lại. 504 là **server timeout giả**, không chứng minh client deadline; source không có timeout client riêng. Disconnect không đạt assertion no-replay ở mức HTTP, không đủ bằng chứng gọi đây là application-source retry bug hoặc mutation replay. Isolation vẫn được giữ nên tiếp tục độc lập, không sửa source.

Console export có HMR/Fast Refresh, không warn/error trong tập captured; không suy ra toàn browser không có network errors. Screenshot full-page B-C17 đã xem trực tiếp, cho thấy A OFFLINE/B READY, B selected và stale plan disabled; case DOM/network xác nhận state cùng thời điểm.

### F7. Bảo toàn, validation và dọn harness

- **309 source/test/script +7 config/AGENTS/package/lock không đổi hash**, drift so C1-D trước chạy cũng rỗng. Aggregate 309 safe paths (sort localeCompare, path-NUL-SHA join LF) trước/sau **f251db7d343b3748570b00309dd72646ff19ac0be43ef9ead06f1d42aa873d2a**. Không gọi đây là aggregate 311 cũ: hai excluded open-world paths không đọc/hash.
- Chỉ thêm harness/evidence trong coverage và append hai reports này. Giữ `docs/demo-capabilities.md` nguyên hash; chưa đủ bằng chứng nâng readiness hoặc nhãn Android.
- Harness session ngoài sandbox **60189 exit 0** qua POST riêng `/__c1/shutdown`; tab nghiệm thu đóng trước shutdown. Process thử sandbox trước đó dừng riêng, không chạm dịch vụ người dùng. Fake active tasks/owner modes cuối đều0; **global state worker thật UNVERIFIED**, vì không query real backend. Không tạo real task/Session/grant/mode để cần cleanup.
- `git diff --check` **exit0**, chỉ có cảnh báo LF/CRLF của working tree có sẵn; hai báo cáo cũ giữ byte-prefix nguyên vẹn. Scoped high-confidence secret scan **0 finding**, whitespace scan0; kết quả ở `validation-result.json`/ `final-safety-check.json`. Không đọc env hoặc in secret.
- Không rerun full regression/TypeScript/lint/build vì không sửa application source. **1358 PASS/0 FAIL/6 TODO, B5 68/68, TS/scoped lint PASS, full lint0errors4warnings, build exit1 SecurityFatalError chỉ là baseline lịch sử**, không phải PASS mới.

### F8. Điều chứng minh và chưa chứng minh

Đã chứng minh Dashboard tương tác trong browser thật; source tiếng Việt không bị viết lại; route/catalog/compiler V2-only hoạt động trong boundary fake; rejected clauses không sinh partial plan; clarification có reference mới và không grant. Không chứng minh thực thi Worker/Next HTTP production adapter/Android, independent outcome verification ngoài đời, AI reasoning, Groq calls hoặc generalization. Most plan construction ở đây là deterministic rules/compiler, model calls0.

**C1-Final chưa đạt do C17 và tiêu chí no-replay C18.** Đề xuất patch/diagnostic riêng rồi chạy lại ca lỗi trước Android Acceptance. Không mở P1 Android/P2 YouTube, temporal acceptance, Teach Mode hoặc sửa build. Dừng tại C1-Final, không commit/push.

