# Core Freeze: Cổng 1 C17 (STOP)

Ngày 26/10/2026, branch `DuyTD`. **Cổng 1 chưa đạt; đã DỪNG do hai test an toàn/compatibility cũ FAIL.**
Đã sửa riêng helper giữ selection và thêm 9 regression test mới; **chưa triển khai phần UI/plan** vì nhóm đầu chưa qua kiểm thử.
Một lượt targeted offline: **19 PASS / 2 FAIL / 0 TODO**, trong đó test mới9/9 PASS, test cũ10 PASS/2 FAIL.
Không sửa hoặc skip test cũ, không đổi worker/security/parser/schema, không làm C18; không chạy full regression sau STOP.
Patch helper hiện vẫn là thay đổi chưa commit, chưa đủ điều kiện demo hoặc nghiệm thu C17 hoàn chỉnh.

## Kết quả và điểm dừng

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| Helper selection khi A OFFLINE/B READY | OFFLINE_TESTED: giữ A và trạng thái OFFLINE | tests/core-freeze-c17-selection.test.cjs:16 |
| Auto-select ban đầu | OFFLINE_TESTED: chỉ khi serial trống và đúng một READY | test mới:41,48 |
| Transport đang chọn mất kết nối | OFFLINE_TESTED: không thay bằng alias READY khác | test mới:53 |
| Regression mục tiêu | **19 PASS / 2 FAIL, exit1**; 21 tests, 3 files | targeted-regression-result.json / log |
| Test cũ bất biến | 69/69 file trong manifest giữ nguyên SHA-256; không đổi input/assert/skip | gate1-stop-result.json |
| Client plan validity/recovery latch | **NOT_IMPLEMENTED_STOP** | UnifiedAgentPanel.tsx không đổi |
| Route Execute với plan A/device B | Schema hiện reject field override, service giữ reference/device binding (đọc source); **chưa thêm/chạy test mới cho ca này** | contracts.ts / route.ts / service.ts không đổi |
| Nhãn TTL vs đổi/mất thiết bị | **NOT_IMPLEMENTED_STOP** | Không thay UI |
| Nút Phân tích lại khi device unavailable | **NOT_IMPLEMENTED_STOP** | Không thay UI |
| Full regression cuối | **NOT_RUN_STOP, 0 lần** | Không dùng baseline cũ như run mới |
| Browser/tsc/lint/build/Android/model | **NOT_RUN, 0 lần** | Tuân thủ giới hạn cổng |
| Chuyển Cổng 2 | **NOT_STARTED** | Chờ quyết định xử lý xung đột test |

Evidence root: `coverage/core-freeze-gate1-HJNHg1/`: `preflight.json`, `device-selection-before.ts.txt`, `targeted-invocation.json`, `targeted-regression.log`, `targeted-regression-result.json`, `gate1-stop-result.json`, preload và counter tripwire. Lượt targeted chạy ngoài sandbox ngay lần đầu; hai failure là assertion hành vi, **không phải EPERM/network sandbox hay Android**. Duration Node4.665s, wrapper4.777s là spans lồng nhau, không cộng.

## Hai failure nguyên trạng

| Test cũ / vị trí | Expected cũ | Actual sau patch | Nguyên nhân và phạm vi |
|---|---|---|---|
| `tests/dashboard-live-device-selection.test.cjs:29`, assert:32 | `resolveLiveDeviceSelection([], 'dev-001')` trả selectedDeviceIds=[], sau đó selectedAndroidSerial='' | Assertion đầu nhận ['dev-001']; helper giữ explicit serial dù discovery rỗng | Patch áp dụng giữ serial cho mọi giá trị trước đó, chưa phân biệt serial thiết bị từng được xác minh với ID demo chưa được biết. Đây là giới hạn của patch đang dở, không tuyên bố việc giữ ID demo là đúng. Không đổi assertion |
| `tests/wireless-connectivity.test.cjs:59`, assert:65 | USB không còn trong list, chỉ Wi-Fi READY -> selected serial tự chuyển sang Wi-Fi endpoint | Giữ serial USB cũ; ba assert dedup/giữ Wi-Fi trước đó vẫn PASS | Kỳ vọng auto-fallback cũ xung đột trực tiếp với yêu cầu mới không đổi selection khi người dùng chưa chủ động chọn. Không thêm compatibility flag/nhánh dành cho test |

Theo điều kiện người dùng, **dừng ngay sau targeted run**, chỉ đọc log/hash và viết báo cáo; không tiếp tục sửa nguồn hoặc chạy full regression. Không chỉnh assertion cũ để ép PASS.

Test thứ nhất chưa chắc cần đổi kỳ vọng: có thể giữ việc loại ID demo bằng lịch sử selection đã được xác minh trong Dashboard thay vì coi mọi serial đầu vào là lựa chọn hợp lệ. Cần thiết kế/duyệt riêng, chưa triển khai. Test thứ hai cần người dùng xác nhận migration chính sách alias auto-fallback trước khi thay test; nếu được cấp quyền sửa, phải giữ ba assertion dedup hiện có và so AST trước/sau chính xác.

## Thuộc tính an toàn -> test phủ

| Thuộc tính | Test / assertion | Thực đo |
|---|---|---|
| A OFFLINE không tự chuyển B READY; A vẫn được biểu diễn OFFLINE | test mới:16, ba assert serial/status/selectedDeviceIds | PASS |
| A unauthorized không tự chuyển B | test mới:23 | PASS |
| A biến mất hoặc discovery rỗng không tự chọn B/không tạo live device giả | test mới:29,35 | PASS ở helper; xung đột ID demo trong test cũ vẫn FAIL |
| Không chọn tùy tiện trong hai READY, không chọn khi không READY | test mới:41 | PASS |
| Tự chọn đúng một READY khi chưa có selection | test mới:41,48 | PASS |
| Dedup cùng physicalId nhưng giữ transport đã chọn dù OFFLINE | test mới:53 | PASS; alias auto-fallback cũ chưa tương thích |
| A hồi phục vẫn giữ serial A | test mới:63 | PASS **chỉ cho serial**, không chứng minh plan cũ bị thu hồi |
| Người dùng chủ động chọn B được tôn trọng | test mới:69 | PASS |
| Không tạo hierarchy/action sau identity mismatch | test cũ wireless-connectivity:22 | PASS |
| Public/LAN/shell injection endpoint bị từ chối | test cũ wireless-connectivity:32 | PASS |
| USB/Wi-Fi cùng physical identity không mở Session thứ hai | test cũ wireless-connectivity:46 và các case Session kế tiếp | PASS (simulated) |
| Không gửi Execute/ANALYZE tới B khi A OFFLINE, Execute disabled, recovery không hồi sinh plan | Cần offline component/route tests, **chưa thêm do STOP** | UNVERIFIED |
| plan reference A không bị client retarget sang B | Contract strict/server binding có sẵn; test mới dự kiến | UNVERIFIED trong lượt này |
| Nhãn mất/đổi thiết bị khác nhãn hết TTL, reanalyze disabled đúng | Chưa sửa hoặc test UI | UNVERIFIED |

Không coi test helper PASS là browser acceptance hoặc C17 end-to-end PASS. Không dùng mốc Cổng0 **1358/0/6** để che kết quả targeted hiện tại. Không gọi test mock là bằng chứng Android.

## File đã đổi

| File | Thay đổi trong lượt này |
|---|---|
| `lib/android/device-selection.ts` | Giữ transport explicit khi grouping aliases; giữ previousSelectedSerial dù OFFLINE/missing; chỉ initial auto-select nếu đúng một READY |
| `tests/core-freeze-c17-selection.test.cjs` | File mới, 9 offline test, không thay các file test cũ |
| `docs/core-freeze-gate1-report.md` | Báo cáo STOP này |
| `coverage/core-freeze-gate1-HJNHg1/*` | Preflight, pre-image helper, harness/log/results offline; không application source |

So hash với preflight: chỉ `device-selection.ts` đổi trong 309 safe source/test/script được theo dõi; 7 config không đổi; 69 test cũ byte-identical. Không đọc sealed/holdout/open-world hoặc env/secret. Không commit/push/tag/reset/checkout/stash, không xóa/archive, không sửa worker/security/parser/permission/grants/journal/locks/cancellation. Các thay đổi có sẵn từ trước giữ nguyên.

Vì không sửa test cũ, **AST assert before/after không có delta được cấp phép để phân tích**; kiểm tra toàn-file SHA-256 chứng minh chúng không bị sửa. Không tuyên bố đã chạy một bộ AST comparison riêng. Coverage mapping nằm ở bảng trên.

## Lệnh và số lần

| Lệnh / nhóm | Số lần |
|---|---:|
| `git status --short --branch` | 1 đầu lượt |
| `git status --porcelain=v1 -uall` + đọc branch/HEAD trong preflight | Mỗi lệnh1 |
| Targeted Node test run (3 file, concurrency1, TAP, offline preload) | **1**, exit1 |
| Full regression | **0, NOT_RUN_STOP** |
| Browser acceptance / tsc / lint / build | **0** |
| Android/ADB/Appium/Ollama/Groq/cloud thật | **0** |
| Commit / push | **0** |

Targeted files: `tests/core-freeze-c17-selection.test.cjs`, `tests/dashboard-live-device-selection.test.cjs`, `tests/wireless-connectivity.test.cjs`. Invocation chính xác ở `targeted-invocation.json`. 4 process counter files có0 blocked network/process và0 real fetch được cho phép; simulated adapters không thực thi thiết bị thật.

## Đề xuất bước kế tiếp

**Chưa duyệt chuyển Cổng 2.** Cần xác nhận cách xử lý hai kỳ vọng selection cũ, đặc biệt quyền migration duy nhất assertion alias fallback nếu vẫn giữ yêu cầu không auto-switch; đồng thời giữ bảo vệ loại ID demo qua selection provenance thay vì nới assertion đó. Sau khi được cho phép, tiếp tục Cổng1 để hoàn thiện availability/plan latch/UI và test route, rồi targeted và một full regression cuối. Không sửa C18 ở lượt này.

Patch hiện tại là **partial/uncommitted có regression đã biết**, không dùng làm bản demo hoặc coi core đã freeze.

