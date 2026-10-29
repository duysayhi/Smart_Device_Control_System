# Core Freeze: Cổng 2 / C18, Bước 2 - EXECUTE Idempotency

Ngày 26/10/2026, branch `DuyTD`. **Cổng 2 hoàn tất ở mức OFFLINE_TESTED; dừng chờ xác nhận Cổng 3.**
EXECUTE bắt buộc clientRequestId UUID; trùng key dùng cùng operation/kết quả, không START lần hai; key khác vẫn chịu anti-replay plan cũ.
Client khóa Execute khi chờ, sinh UUID mới cho mỗi click hợp lệ; không retry tự động và không thêm AbortController cho ANALYZE.
Targeted **188/188 PASS**; đúng một full regression: **1418 PASS /0 FAIL /6 TODO**, tăng33 PASS so1385 của Cổng1.
Migration đúng hai helper đã được chủ dự án duyệt; **170 assertion nguyên AST**, 68/69 file test cũ nguyên SHA, một file cũ đổi SHA có kiểm soát. Không browser/tsc/lint/build/Android.

## 1. Lịch Sử Điểm Dừng

Lượt trước dừng trước triển khai vì strict key bắt buộc xung đột fixture API không có key trong `engine-merge-single-path.test.cjs:154-194` và `core-freeze-c17-panel-route.test.cjs:258-278`.
Không có test FAIL đã chạy ở lượt đó; đó là xung đột được xác định bằng source. Evidence giữ nguyên tại `coverage/core-freeze-gate2-step2-preflight-Q4ZzW6/preflight-stop.json`.
Người dùng sau đó trả lời **“Duyệt migration fixture hẹp, giữ mọi assertion”**. Lượt tiếp tục này chỉ thêm key vào hai helper, không đổi input mục tiêu, status, START count hoặc assertion.
Chẩn đoán browser/transport retry đã được chấp nhận; `docs/core-freeze-gate2-diagnosis-report.md` và evidence cũ giữ nguyên.

## 2. Thay Đổi Và Đường Chạy

| File | Thay đổi |
|---|---|
| `components/commands/UnifiedAgentPanel.tsx:20,88-99` | Ref lock đồng bộ trước await; vẫn dùng pending để disable nút; `crypto.randomUUID()` trong mỗi Execute hợp lệ; gửi reference + clientRequestId đúng một lần |
| `lib/android/unified-agent/contracts.ts:24-29` | Key bắt buộc, `z.string().uuid().length(36)`; EXECUTE vẫn strict, không nhận device/source/engine/grants từ client |
| `app/api/unified-agent/route.ts:64,70` | Forward reference/key tới service; trả409 cho REQUEST_KEY_CONFLICT / REQUEST_CACHE_FULL; validation lỗi vẫn400 |
| `lib/android/unified-agent/service.ts:14-17,53,107-133` | Map trong bộ nhớ, reserve trước await; cache shared operation và snapshot phản hồi; clone cho từng caller |
| `tests/engine-merge-single-path.test.cjs:85` | Chỉ thêm key UUID mới cho mỗi request EXECUTE qua helper api |
| `tests/core-freeze-c17-panel-route.test.cjs:237` | Chỉ thêm key UUID mới cho mỗi request EXECUTE qua helper post |
| `tests/core-freeze-c18-idempotency.test.cjs` | 33 regression mới, fake worker và component JSX handlers offline |
| `docs/core-freeze-gate2-step2-report.md` | Báo cáo này, cập nhật kết quả và giữ lịch sử STOP ngắn |

Đường HTTP: **client -> strict UnifiedCommand -> route -> executeRequest(reference,key) -> execute(reference) -> dispatch -> adapter START_PREPARED cũ**.
`executeRequest` chỉ bọc admission; không có execution loop/engine mới. Hàm `execute(reference)` cũ giữ nguyên để các consumer nội bộ hiện có tiếp tục dùng; **HTTP không có fallback thiếu key**.
Các method service cũ analyzeForDashboard/clarify/reanalyze/analyze/execute/dispatch/list/cancel/assist/confirm giữ nguyên AST.
Các hàm UI api/analyze/operation/clarify/reanalyze/changeMode giữ nguyên AST. Không thêm retry hoặc AbortController cho ANALYZE.
Worker, shared security/parser/permission/grants/journal/locks/cancellation/ConditionExecutor/schema, provider và cấu hình không đổi theo snapshot hash.

## 3. Contract Idempotency

| Tình huống | Kết quả đã kiểm thử |
|---|---|
| Thiếu key, sai kiểu/ký tự/độ dài/UUID | HTTP400 trước context/PREPARE/START |
| Key mới + plan hợp lệ | Chạy các kiểm tra binding/expiry/busy/consume cũ trước dispatch |
| Trùng key đang chờ context | Cùng underlying operation; không đọc context hoặc START lần hai; hai caller nhận cùng snapshot |
| Trùng key đã trả lời | HTTP200, JSON response byte-identical với lần đầu, không START lại |
| Cùng key, khác reference (kể cả plan cho thiết bị B) | HTTP409 REQUEST_KEY_CONFLICT, không context/START thêm |
| Client cố gửi deviceId/source/engine/plan/grants | HTTP400 theo strict schema, kể cả key hợp lệ |
| Key khác + plan consumed | HTTP409 PLAN_REPLAYED, không START lại |
| Key khác + hai plan hợp lệ cho A/B | Hai execution độc lập, đúng device binding và START tổng2 |
| Context admission bị lỗi rồi phục hồi | Cùng key trả lại rejection cũ, không âm thầm thử lại |
| Dispatch UNKNOWN_EFFECT | Trạng thái thật vẫn UNKNOWN_EFFECT; duplicate không START; key mới vẫn bị anti-replay |
| Plan bị prune sau lần dùng | Cùng key trong TTL vẫn trả snapshot cũ từ cache |
| Cache đầy | Key mới409 REQUEST_CACHE_FULL trước admission; duplicate cũ vẫn được trả |
| Cache hết TTL | Không đảm bảo trả kết quả cũ; plan consumed vẫn chặn dispatch lại |

Một entry chứa `{reference, deviceId, state, expiresAt, promise}`. State IN_FLIGHT/RESOLVED/REJECTED là **trạng thái lời gọi admission HTTP**, không phải trạng thái hoàn thành goal Android.
Promise dùng chung giữ kết quả/rejection đầu tiên; mỗi caller nhận structuredClone để không sửa cache qua object đã trả về.
Response ban đầu có thể là QUEUED. Duplicate vẫn trả đúng QUEUED ban đầu dù GET polling sau đó báo RUNNING/BLOCKED/COMPLETED; không biến snapshot cũ thành claim COMPLETED.
Anti-replay và UNKNOWN_EFFECT cũ không bị thay thế bởi cache. Key chỉ deduplicate một lời gọi, không tự tạo quyền hoặc sửa plan/device.

## 4. Thuộc Tính An Toàn -> Test Phủ

Các dòng dưới thuộc `tests/core-freeze-c18-idempotency.test.cjs` nếu không ghi tên khác. Tất cả đã PASS trong cả targeted và full.

| Thuộc tính | Test / dòng |
|---|---|
| Missing/malformed key bị chặn trước worker/context | 11 ca ở84-91 |
| Key hợp lệ không mở quyền override source/device/engine/plan/grants | 6 ca ở93-100; bổ sung bằng chứng strictness độc lập với lỗi thiếu key |
| Duplicate tuần tự, response byte-identical, START1 | 102 |
| Duplicate đồng thời lúc context pending, context chỉ đọc1, START1 | 112 |
| Key khác + consumed plan vẫn409 PLAN_REPLAYED | 122 |
| Cùng key khác reference trên cùng A hoặc sang B | 129, hai ca |
| Key khác, plan/device riêng, thực thi độc lập | 138 |
| Caller mutation / tiến độ sau đó không sửa snapshot cache | 148 |
| Plan prune không làm mất cache trong TTL | 157 |
| Admission rejection không tự retry khi context phục hồi | 163 |
| UNKNOWN_EFFECT không START lại / không thành COMPLETED giả | 169 |
| TTL không phá anti-replay | 177 |
| Hard cap100, duplicate được giữ, prune entry settled đã hết hạn | 183 |
| Pending không expire/evict kể cả vượt TTL, fail closed khi đủ100 | 195 |
| Restart/service mới không coi key là execution authorization | 209 |
| Một thao tác Execute chỉ1 fetch + UUID; stale same-turn handler không bypass ref lock | 263 |
| Transport error không auto-retry; click tay mới có UUID khác | 274 |
| Plan binding, replay, journal/permission, cancellation cũ | engine-merge-single-path:152,159,171,175,181,193; C17 panel-route:242,253,263,272 |

Hai file migration: **100 +70 =170 call assertion nguyên AST**; toàn bộ file ngoài đúng một expression trong helper của mỗi file khớp trước/sau sau chuẩn hóa CRLF/LF. Không xóa/skip/đổi kỳ vọng test.
Fixture cũ tạo **key khác cho từng request mới**, nên các test replay cũ tiếp tục kiểm anti-replay của plan, không bị đổi thành test duplicate-key trả200. Duplicate same-key có test mới riêng.

## 5. Test Và Số Lần Chạy

Evidence lượt này: `coverage/core-freeze-gate2-step2-resume-VMLK7r/`.

| Lệnh / kiểm tra | Số lần | Kết quả thật |
|---|---:|---|
| git status --short --branch | 2 (đầu/cuối lượt) | DuyTD; giữ thay đổi có sẵn |
| Đọc source / guide Next cục bộ / rg / hash / AST | Các truy vấn chỉ đọc và artifact evidence | Không chạy tsc hoặc dịch vụ thật |
| Node run-regression.cjs targeted | **1** | 6 file, **188 PASS /0 FAIL /0 TODO**, exit0; wrapper33.042s, Node32.834s |
| Node run-regression.cjs full | **1** | 72 file =69 manifest +2 C17 +1 C18; **1418 PASS /0 FAIL /6 TODO**,1424 entries, exit0; wrapper255.740s, Node255.554s |
| Browser / tsc / lint / build / Android / model/cloud | **0** | NOT_RUN theo ràng buộc Cổng2; không suy ra browser/Android/build PASS |
| Commit/push/stash/reset/checkout | **0** | Không thực hiện |

Hai suite chạy tuần tự, targeted xong mới full. Wrapper duration bao gồm Node duration, **không cộng hai span chồng nhau**. Full runner có guard không cho ghi đè/chạy lại full-invocation.
So baseline Cổng1 **1385/0/6**: thêm33 C18 PASS, không giảm số test hoặc đổi6 TODO. Không chạy lại full sau khi có kết quả.
`targeted-invocation.json`, `full-invocation.json`, hai log TAP và hai result JSON giữ command/file list/count/duration/exit code.

### Tripwire Và Giới Hạn Offline

Tổng79 file counter của targeted/full:77 lần fetch tới mock loopback do test sở hữu,0 blocked process, **4 blocked network attempts**, bị chặn trước native fetch/network I/O.
Stack mới xác nhận cả4 phát sinh từ **test cũ** `autonomous-task.test.cjs:92,97,99,104 -> app/api/agent/assistance/route.ts:25 -> runningWorkerTasks -> worker-client.address`.
Đây là các nhánh assistance negative/replay còn thử dò worker; không liên quan idempotency mới. Cổng1 đã ghi nhận4 attempt nhưng khi đó chỉ suy luận nguồn; lần này có stack cụ thể.
Không tuyên bố “zero attempted network” hoặc đã sửa khoảng trống isolation cũ. Không đổi test/route đó ngoài phạm vi; guard ngăn request tới worker thật. Evidence: `tripwire-summary.json`, `tripwire-26996.json`.
Không mở browser, không gọi Android/ADB/Appium/Ollama/Groq, không cấp owner/full-control hoặc execution grant thật trong lượt này.

## 6. Hash Và Migration Baseline

Snapshot319 file có sẵn (source/tests/scripts/types/config và một tài liệu) trước/sau: đúng6 file đã duyệt đổi; không có file ngoài phạm vi,0 config change. Test C18 mới và báo cáo được liệt kê riêng, không giấu vào mẫu snapshot cũ.

| Fixture | SHA trước | SHA sau |
|---|---|---|
| engine-merge-single-path (thuộc69 cũ) | `998856cd2b3a285ad0efe471e1bf8f715870210457f53816f93330d188700e00` | `a4ca5ef5c41e44503fa97d0e7bf01e71dd813876486f1cbe0c560a120abb2f10` |
| core-freeze-c17-panel-route (ngoài69 cũ) | `515bf8cc04140ddd8d527765060660e5d107ecb53cf7a53a539b139df8221848` | `272a8606d48768e28ebc5ce4da58513504f98c8bf2f90e0e644b2ea81c1576ac` |

**68/69 file cũ byte-identical**, một file đổi theo migration được duyệt; không tiếp tục tuyên bố69/69 nguyên SHA.
Aggregate map path->SHA của319 file: trước `135772325555095f271b44b9f30ab5eb8c4c5ae59ce7cfda95956a900036b122`, sau `8ab69cd734861d50185c23441973902d34da36ef676693d316d96b1d179a5a7e`.
Aggregate riêng69 test: trước `fb35bafaf1e7e1b15d59e4a300a3a609e2b10478bc25817aaf1425ea91f6d874`, sau `e65a2d6dc7054ab370e00eca62bbd14a5b10c84c421ad8066a299c2130bdffdf`.
Full hash map mới nằm trong `postflight.json`; pre-images và old hashes giữ trong `before/` / `preflight.json`, không ghi đè baseline cũ.
Test mới SHA-256 `f88f2aa3e22650960e2dbd251abdd57f989e7e379f7580686b7286f3e3e3bf44`.
`assertion-preservation.json` chứng minh expression-only migration,170 assertion và các method/hàm cũ không đổi; `integrity-result.json` ghi allowed/unexpected/config changes.

## 7. Hạn Chế Và Điểm Dừng

- Cache **chỉ trong bộ nhớ của một UnifiedAgentService/process**, không persist, không đồng bộ giữa process/instance. Không tuyên bố exactly-once xuyên restart hoặc multi-node; single-use plan/worker checks vẫn là lớp bảo vệ độc lập.
- Tối đa100 entry, không đẩy entry chưa hết hạn ra để nhận key mới. TTL300000ms bắt đầu khi admission resolve/reject; prune lười ở request EXECUTE kế tiếp. Không gia hạn TTL khi duplicate.
- Pending không bị expire/evict kể cả context treo;100 operation treo sẽ làm mọi key mới bị409 cho tới khi operation kết thúc hoặc service được khởi động lại. Không thêm timeout/retry để né unknown effect.
- Duplicate trả **snapshot admission ban đầu**, không phải tiến độ cuối mới nhất. Poll GET như cũ để xem kết quả engine. Hết TTL/restart có thể chỉ nhận409/unavailable thay vì snapshot cũ; không tự retry START.
- Nút pending khóa tại UI và handler ref; không thể cấm browser/transport phát lại packet. Idempotency xử lý duplicate EXECUTE cùng key, không đổi retry behavior của ANALYZE.
- HTTP callers cũ phải gửi key; service.execute(reference) nội bộ giữ tương thích, không mở API thiếu key.
- Browser và Android cho bản sửa này **UNVERIFIED**; tsc/lint/build chưa chạy theo lệnh. Không gọi API thật để kiểm chứng runtime đang chạy đã nạp code mới.
- Service singleton ở globalThis có thể còn instance cũ trong Next dev HMR. Trước nghiệm thu Cổng3 cần preflight nạp source hiện tại, khởi động lại Next an toàn khi rảnh nếu cần; không tự kill/restart trong cổng này.

Không còn test FAIL hoặc điểm dừng an toàn mới trong lượt được phép. **Dừng chờ người dùng xác nhận Cổng3**, không tự chạy browser acceptance/validation/Android hoặc triển khai thêm tính năng.
