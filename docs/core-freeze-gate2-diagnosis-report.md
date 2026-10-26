# Core Freeze: Cổng 2 / C18, Bước 1 Chẩn Đoán

Ngày 26/10/2026, branch `DuyTD`. **Chỉ hoàn tất bước 1; Cổng 2 chưa hoàn tất.**
Kết luận duy nhất cho hiện tượng C18 tái hiện: **[browser/transport tự retry]**, không phải ứng dụng gọi hai lần hoặc proxy tự phát lại API.
Một click Phân tích = một lần app gọi fetch, nhưng hai POST đến proxy sau fault đóng socket trước response headers; fetch trực tiếp cũng tái hiện.
Không sửa runtime/test/config, chưa thêm idempotency EXECUTE; giữ nguyên 69/69 test cũ theo SHA-256. Dừng chờ duyệt bước 2.
Browser chỉ dùng cho chẩn đoán cô lập sau khi người dùng cho phép riêng, không chạy browser acceptance, Android hoặc backend thật.

## 1. Kết Quả

| Đối chứng | Số thao tác / lời gọi phía client | POST ANALYZE proxy nhận | Kết quả | Mức chứng minh |
|---|---:|---:|---|---|
| Dashboard thật, một click Phân tích | 1 click, 1 app fetch | 2 | Socket đầu đóng trước headers; request sau nhận 200 | BROWSER_DIAGNOSTIC_OBSERVED, API fixture |
| Fetch trực tiếp trong cùng trang, không đi qua analyze/operation | 1 click, 1 direct fetch | 2 | Cùng lỗi và kết quả 200 | BROWSER_DIAGNOSTIC_OBSERVED, API fixture |
| Node HTTP, connection mới | 1 http.request | 1 | ECONNRESET; không có request thứ hai tự động | HTTP_CONTROL_OBSERVED |
| Node HTTP, connection keep-alive đã warm | 1 http.request, reusedSocket=true | 1 | ECONNRESET; không có request thứ hai tự động | HTTP_CONTROL_OBSERVED |
| Node, gọi lại chủ động sau từng đối chứng | 1 lời gọi riêng cho mỗi đối chứng | 1 mỗi lần | 200 ở cả hai | Kiểm tra fault là one-shot; không tính là auto-retry |
| EXECUTE idempotency / key khác | Chưa triển khai, chưa chạy | Không có EXECUTE | PENDING_APPROVAL_STEP_2 | Không tuyên bố PASS |
| Regression trong lượt này | 0 targeted, 0 full | Không áp dụng | NOT_RUN do điểm dừng bước 1 | Baseline Cổng 1: 1385 PASS /0 FAIL /6 TODO, không phải kết quả chạy mới |

Evidence mới: `coverage/core-freeze-gate2-diagnosis-gnHkPo/`. Các mốc thời gian bên dưới dùng UTC (`Z`).

## 2. So Sánh Hai Request

### Dashboard: Một Click, Một Fetch, Hai Request

Client log ghi một click Phân tích và đúng một lần fetch có type=ANALYZE, lúc `14:51:41.549Z`.
Stack: `onClick -> analyze -> operation -> api -> window.fetch`.

| Thuộc tính | Request 184 | Request 185 |
|---|---|---|
| Server timestamp | 2026-10-26T14:51:41.555Z | 2026-10-26T14:51:41.558Z |
| Connection ID do harness gán để quan sát | 28 | 29 |
| Socket accepted | 14:51:32.213Z | 14:51:41.558Z |
| Client TCP source port | 62471 | 52741 |
| Số POST start-line trên socket | 1 | 1 |
| Headers đã gửi trước khi socket đóng | Không | Có; HTTP200 |
| Khoảng cách monotonic giữa hai request | Mốc đầu | +3.4201 ms |

Hai request có **toàn bộ header được ghi nhận giống nhau**, gồm Content-Type=application/json, Content-Length=75, Connection=keep-alive, Origin/Referer cùng localhost:50193, Accept=*/*, các sec-fetch/sec-ch-ua và User-Agent Chrome/155.0.0.0 trên Windows. Không có Authorization/Cookie trong cặp này; observer vẫn che các header nhạy cảm nếu xuất hiện.

Body hai request giống hệt: `{"type":"ANALYZE","input":{"source":"Mở YouTube","deviceId":"C1_FAKE_A"}}`.
SHA-256 body: `4b9e14eb48db0cffa0295e527d20ab270d915ea026a655fc0b50fbe959bae694`.

**Không có request ID, timestamp hoặc idempotency header/body field do app tạo trong ANALYZE hiện tại.**
App chỉ tự đặt Content-Type; các header còn lại trong capture thuộc browser/HTTP stack.
`localLogId` trong client log và `id`/`connectionId` trong server log là **nhãn của instrumentation**, không chèn vào request.
Không được hiểu các nhãn này là tính năng correlation/idempotency đã có của ứng dụng.

### Fetch Trực Tiếp

Lời gọi lúc `15:01:53.891Z`; stack chỉ có `button.onclick -> window.fetch`, không qua handler của app.
Proxy nhận request 842 lúc `15:01:53.893Z` trên connection95, rồi request843 lúc `15:01:53.894Z` trên connection94, cách nhau **1.3894 ms**.
Hai header/body giống nhau, cùng body hash phía trên. Connection95 bị đóng trước headers; connection94 trả200.
Connection94 đã tồn tại trước đó: **không khẳng định lần retry luôn tạo connection mới**; chỉ chứng minh chuyển sang socket khác trong hai ca đã đo.
Client log tổng cộng có hai ANALYZE fetch: một APP và một DIRECT_CONTROL, không phải hai APP fetch.

`allFetchCalls` trong ảnh/log còn bao gồm polling GET của Dashboard, không phải bộ đếm ANALYZE. Chỉ dùng `analyzeCalls`, method/type/path và case marker để đối chiếu.

Evidence: `browser-app-client-log.json`, `browser-final-client-log.json`, `browser-console.json`, `browser-http-observations.json`, `diagnosis-result.json`, hai file `browser-*-dom.txt`, `browser-diagnostic.png`.

## 3. Nguồn Và Cách Cô Lập

**VERIFIED_IN_SOURCE:**
- `components/commands/UnifiedAgentPanel.tsx:40-42`: helper api gọi fetch một lần, không retry loop/catch gọi lại.
- `UnifiedAgentPanel.tsx:62-68`: analyze có một chỗ gọi api với ANALYZE; `:129` gắn một onClick vào nút Phân tích.
- `UnifiedAgentPanel.tsx:44-50`: effect chỉ poll GET, không tự POST ANALYZE khi render/mount lại.
- `coverage/dashboard-browser-c1-final-Kn6YYV/c1-final-proxy.cjs:143-148`: đọc/reset lỗi one-shot, đóng incoming req.socket, return trước response headers.
- Proxy cũ `:151-159`: phaseA trả fixture; phaseB gọi route trực tiếp trong tiến trình, không HTTP-forward API. Các GET root/static và HMR mới đi tới Next frontend.

Giữ nguyên source proxy cũ, SHA-256 `dda83b4b4b34d5c7dc90bb12d68d0c6cf76535a867f8423b181c19b73d178d0c`; nạp nguyên văn trong bộ nhớ với thư mục evidence mới để không ghi đè capture cũ.
Wrapper chẩn đoán chỉ thêm passive incoming-request/socket observer, chèn fetch counter vào HTML **của harness** trước app scripts và thêm nút direct-fetch. Nó gọi native fetch đúng một lần, không đổi URL/body/header của ANALYZE, không retry.
Node và browser dùng **cùng instance proxy, cùng endpoint, cùng nhánh fault** trong lượt đo hợp lệ. Node đo cả connection mới và connection keep-alive đã warm.
Không dùng server giả khác để suy ra hành vi của proxy này.

Dashboard/assets lấy từ Next đang chạy; mọi API ở gateway giả. Không restart/kill Next hoặc worker. HMR101 được ghi nhận với Origin/query giữ nguyên; app đã hydrate và stack đi qua component thật. Đây **không phải** nghiệm thu toàn Dashboard hoặc production route/worker.
Các probe mới đều phaseA; phaseB cũ chỉ được đọc như evidence lịch sử, không chạy lại.

### Vì Sao Phân Loại Browser/Transport

**OBSERVED:** một native fetch invocation tạo hai incoming HTTP request trên hai TCP socket khác nhau; direct control bỏ qua app logic vẫn giống vậy. Observer ở đầu server và raw POST start-line xác nhận đây không chỉ là logger ghi hai lần.
**OBSERVED:** Node http.request không tự phát lại trong cùng fault; proxy không phát request API outbound và không gọi worker.
Vì vậy phân loại ở ranh giới đã đo là **browser/transport tự retry**, loại trừ app gọi hai lần và harness tự replay request trong thử nghiệm này.
Không có browser network-internals trace để chỉ tên nhánh thuật toán bên trong Chromium/IAB; không kết luận riêng về mọi browser, mọi kiểu lỗi hoặc mọi double-click ngoài hai ca này.

### Lịch Sử C18 Và Lượt Đối Chứng Chưa Hợp Lệ

Evidence C1-Final cũ: A1006/1007 cách2.2674ms, B1837/1838 cách1.4186ms; request đầu CONNECTION_CLOSED, request sau200. Capture cũ không lưu header/connectionId/client fetch count, nên **chỉ capture cũ chưa đủ kết luận**. `historical-disconnect.json` giữ phần trích, không sửa verdict/file cũ.

Lượt Node đầu chạy từ PowerShell stdin biến `Mở YouTube` thành `M? YouTube`; socket-fault vẫn xảy ra nhưng explicit recovery bị fixture409. Giữ nguyên `http-controls.json`, không dùng lượt này làm positive recovery proof.
Chạy lại với Unicode escape trong harness: payload đúng75byte, recovery200; kết quả hợp lệ nằm trong `browser-http-observations.json` / `diagnosis-result.json`.
Một yêu cầu chạy lại bằng stdin bị hệ thống duyệt công cụ hết thời gian trước CreateProcess: **không khởi chạy, không tính là probe**. Sau đó chạy file harness cục bộ; không vô hiệu hóa sandbox hoặc sửa app để né lỗi.

## 4. Thuộc Tính An Toàn -> Test / Evidence Phủ

| Thuộc tính | Test hoặc evidence | Trạng thái trong lượt này |
|---|---|---|
| Một click Phân tích = một app fetch | browser-app-client-log + console stack; server requests184/185 | OBSERVED cho một thao tác; chưa thêm regression mới |
| Tách app call khỏi transport retry | direct-fetch control + Node fresh/warm + incoming socket/start-line log | OBSERVED, không suy từ mock PASS |
| Không thực thi Android/model khi chẩn đoán | Gateway chỉ fake API; counters START/EXECUTE/ADB/Appium/model/owner/grant =0 | OBSERVED trong harness |
| Không sửa 69 test cũ | final-source-integrity.json đối chiếu SHA với Cổng1 và Cổng0 | 69/69 nguyên vẹn |
| Plan/device/source/rights không do client ghi đè | test cũ unified-agent-m7a:59; C17 panel-route:242,253,263,272 | Test hiện có, không sửa/không chạy lại hôm nay |
| Replay/UNKNOWN_EFFECT không dispatch lại | engine-merge-single-path:152,193; unified-agent-m7a:120; unified-agent-m7a-fixes:96 | Test hiện có, không nâng thành idempotent result-cache |
| EXECUTE trùng clientRequestId trả execution cũ, fake worker START đúng1 | Chưa có test mới trong bước1 | PENDING_STEP_2 |
| EXECUTE key khác thực thi độc lập khi plan/scope hợp lệ | Chưa có test mới trong bước1 | PENDING_STEP_2 |
| Browser tab / server của lượt đo được đóng | Tab8 đóng; own /__c1/shutdown; final-integrity serverClosed=true; exec exit0 | Đã dọn tài nguyên chẩn đoán, không dọn dữ liệu người dùng |

Không query trạng thái worker thật trong lượt này; fakeActiveTasks=0/fakeOwnerModes=0 là trạng thái harness, **không dùng để tuyên bố đã kiểm toàn bộ tác vụ trên máy người dùng**.

## 5. File Và Hash

**Chỉ thêm tài liệu này vào các file không bị ignore:** `docs/core-freeze-gate2-diagnosis-report.md`.
Chỉ thêm harness/evidence tự sinh trong `coverage/core-freeze-gate2-diagnosis-gnHkPo/` (ignored); không sửa source/test/config hoặc evidence cũ.
Mọi thay đổi có sẵn đầu lượt, kể cả các file đã xóa từ trước, được giữ nguyên; không commit/push/stash/reset/checkout.

Đối chiếu **319 file đã chụp đầu lượt** (source/test/script/types/config và một tài liệu có sẵn), không file nào đổi. 69 test baseline khớp cả Cổng1 và Cổng0.
Aggregate SHA-256 của JSON map path->SHA (cùng cách sắp thứ tự đầu/cuối):
`135772325555095f271b44b9f30ab5eb8c4c5ae59ce7cfda95956a900036b122` **trước = sau**.
Đây là digest tập319 file của lượt chẩn đoán, không đánh đồng với digest runtime311 file ở giai đoạn cũ.

Panel SHA: `5e25acf8ec55a70e8864fd24a247632a3d7644976a60a5939dcff5a81cd68ec6`.
Route SHA: `f119ddabb5b04d849a0fa1fa6eaa01504027636e32313091a5b5939a71c28315`.
Chi tiết: `preflight.json`, `integrity-result.json` (lượt Node đầu), `final-integrity.json`, `final-source-integrity.json`.

Proxy lượt hợp lệ nhận1079 API request: **1071 GET +8 POST ANALYZE**, gồm4 POST của Node (2 fault +2 explicit recovery) và4 POST từ2 native browser fetch. Không gọi EXECUTE.
33 frontend GET,2 kết nối HMR101; real API forward/worker/START/Appium/ADB/model/owner change/grant đều0.

## 6. Lệnh / Số Lần

| Nhóm | Số lần và kết quả |
|---|---|
| git status --short --branch | 4 lần, gồm kiểm tra sau khi ghi báo cáo: giữ DuyTD và working tree có sẵn; chỉ thêm tài liệu chẩn đoán vào các file không bị ignore |
| Đọc source/report, rg, đọc/trích/hash JSON | Nhiều truy vấn chỉ đọc; không chạy test suite |
| Node diagnostic qua stdin | 1 lượt chạy xong,2 đối chứng có payload mất dấu, không dùng làm positive fixture proof |
| Node chạy lại qua stdin | 1 lần yêu cầu, hết hạn duyệt trước khi tạo tiến trình; không chạy |
| Node diagnostic-proxy.cjs | 1 lần khởi chạy,2 đối chứng HTTP hợp lệ; cùng instance dùng cho browser; tự đóng qua shutdown, exit0 |
| Browser chẩn đoán riêng | 1 tab,1 app Analyze click,1 direct fetch click; không nhấn Execute hoặc bật owner/full-control |
| HTTP điều khiển bằng PowerShell | 2 arm fault (app/direct),2 save evidence,1 shutdown; đều endpoint harness |
| Regression targeted / full | **0 /0**: dành cho khi được duyệt làm tiếp bước2 và kết thúc Cổng2; chưa tiêu thụ lần full duy nhất |
| tsc / ESLint / build / browser acceptance / Android / Ollama / cloud | **0** |

Một lệnh Node đọc JSON ban đầu bị lỗi quoting của PowerShell trước khi đọc file; đã chuyển sang stdin, không có tác động source/backend.

## 7. Điểm Dừng Và Hướng Đề Nghị

**Chạm điểm dừng bắt buộc sau bước1** vì kết luận không phải ứng dụng gọi hai lần. Không thêm AbortController, không chỉnh helper fetch/button hoặc retry logic trong lượt này.

Đề nghị duyệt bước2 riêng: thêm clientRequestId cho EXECUTE ở client và Unified route/service trong phạm vi cho phép; key gắn plan/reference, trùng key trả cùng kết quả/in-flight operation mà không START lần2; không tái dùng key để đổi plan/device/rights. Không đụng worker/security/parser chung.
Giữ anti-replay hiện có: `service.ts:99-106` consume plan và chặn replay; `:123` giữ UNKNOWN_EFFECT/no replay. **Replay bị409 hiện tại không đồng nghĩa cơ chế idempotency trả kết quả cũ đã tồn tại.** `contracts.ts:28`, route`:64` và panel`:91` hiện chưa nhận/gửi clientRequestId.
Ở bước2 mới thêm test app-level một click/một fetch, fake-worker duplicate-key/concurrent-key và key khác; chạy targeted rồi đúng một full regression ở cuối. Không đổi 69 test cũ.
Không bắt đầu Cổng3, browser acceptance toàn bộ, Android hoặc chức năng khác.
