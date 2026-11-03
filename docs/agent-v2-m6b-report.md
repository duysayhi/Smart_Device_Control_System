# M6b: ALARM & TIMER

Ngày thực hiện: 21–22/10/2026. Branch `DuyTD`. Không commit/push. Giữ nguyên các thay đổi có sẵn. Không mở sealed/holdout, không đổi Groq/Ollama, không tự cấp quyền Android, không xóa dữ liệu thử.

## 1. Kết luận

**M6b mới hoàn thành phần contract và kiểm thử offline, chưa nghiệm thu tạo báo thức/timer thành công trên Samsung. Không được coi milestone này đã hoàn tất trên Android thật.**

| Phạm vi | Nhãn / kết quả |
| --- | --- |
| Diễn giải Việt/Anh, AM/PM, duration, timezone | OFFLINE_TESTED |
| Goal Graph giữ typed temporal outcome, không bỏ clause chưa hỗ trợ | OFFLINE_TESTED |
| Intent executor, new-only preconditions, scoped grant, journal, chống replay | OFFLINE_TESTED |
| Alarm persisted readback và timer RUNNING + giảm thời gian | OFFLINE_TESTED bằng provider/thiết bị giả lập trong unit/integration tests, **không phải Android E2E** |
| PackageManager Samsung phân giải SET/SHOW ALARM và TIMER | REAL_ANDROID: có handler, không đồng nghĩa có quyền gọi hoặc xác minh được outcome |
| Provider báo thức Samsung | REAL_ANDROID / BLOCKED: `SecurityException`, yêu cầu quyền READ_ALARM/WRITE_ALARM của ứng dụng |
| SHOW_ALARMS qua ADB shell | REAL_ANDROID / BLOCKED: yêu cầu `com.android.alarm.permission.SET_ALARM` |
| Timer provider tương thích schema mới | UNVERIFIED; probe đường dẫn quan sát được không cho inventory hợp lệ |
| Hai mục tiêu 07:00 và timer 600 giây qua Agent V2 trên Samsung đã mở khóa | REAL_ANDROID: **2/2 BLOCKED trước ghi**, không tạo mới; không phải COMPLETED |
| Tab Chuông báo, Đếm giờ, form báo thức và timer picker | REAL_ANDROID: quan sát được UI; UI-only execution/persistence fallback vẫn chưa hoàn thiện |

Chủ thiết bị đã cho phép đúng một báo thức mới 07:00 và một timer 10 phút, giữ lại dữ liệu. Không sử dụng quyền đó để bỏ readiness, cấp thêm permission, sửa báo thức cũ hoặc thử Intent ghi thiếu verifier.

## 2. Root Causes

1. Parser trước M6b chỉ nhận một nhánh structured alarm rất hẹp; chưa có typed TIMER, không phân biệt wall-clock với duration. Không thể sửa bằng việc chỉ đổi regex rồi tái sử dụng verifier mở ứng dụng.
2. Contract persisted form cũ yêu cầu identity và readback, chỉ chấp nhận layout 24h rõ ràng. NumberPicker/AM-PM hoặc thiếu identity không tự nhiên đáp ứng contract đó.
3. AlarmClock Intent có thể **kích hoạt lại mục đã tồn tại**. Dispatch acknowledgement không chứng minh tạo mới, đúng giờ hay timer đang chạy. Xem [Android AlarmClock API](https://developer.android.com/reference/android/provider/AlarmClock) và [AOSP AlarmClock contract](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/provider/AlarmClock.java).
4. PackageManager phân giải được component không chứng minh shell có permission gọi component. SHOW_ALARMS thật bị Android từ chối trước khi chuyển màn hình.
5. Samsung không cấp quyền đọc AlarmProvider cho shell. Không có persisted inventory đáng tin cậy thì không thể bảo đảm new-only hoặc báo COMPLETED.
6. Keyguard từng vẫn khóa dù màn hình sáng. Screenshot framebuffer xác nhận có biểu tượng ổ khóa và “Vuốt để mở khóa”; không nới readiness để vượt qua. Sau khi chủ thiết bị mở khóa hoàn toàn, đã chạy hai task hợp lệ, vì vậy nguyên nhân BLOCKED cuối cùng là thiếu readback chứ không phải khóa máy.

## 3. Contract Và Thực Thi

### Diễn giải

- `TemporalRequestSchema`: ALARM có hour 0–23, minute 0–59, device-local clock, enabled=true và IANA zone tùy chọn; TIMER có seconds 1–86400 và start=true.
- Đã kiểm thử: 7 giờ sáng → 07:00; 3 giờ 30 chiều → 15:30; 6:45 PM → 18:45; 10 phút → 600; 1 hour 20 minutes → 4800; 12 AM/PM được phân biệt.
- Giờ 1–12 không có AM/PM và không viết rõ dạng 24h có leading zero: yêu cầu `FIELD_AMBIGUITY`, hai lựa chọn AM/PM. Sau lựa chọn, giữ nguyên source span, lưu binding chỉ ở backend, giới hạn theo execution và biên dịch lại graph. Không đoán và không cần viết lại request.
- Số âm, thập phân duration chưa hỗ trợ, duration zero/quá giới hạn, phút >59, 24:00, AM/PM mâu thuẫn và qualifier chưa hỗ trợ đều không thực thi.
- Ngày cụ thể, lịch lặp và lập lịch khác múi giờ thiết bị chưa hỗ trợ. Không bỏ qua “tomorrow” để tạo báo thức hôm nay.
- Nhánh structured form cũ `dat bao thuc 07:00` được giữ để không phá regression; chưa hợp nhất nhánh này với native temporal executor. Không tuyên bố mọi cách viết giờ đều đi cùng một executor.
- Đây là diễn giải deterministic có typed validation, **không phải chứng minh LLM tự suy luận thời gian**. Không thay đổi model/prompt/router.

### Native Temporal Path

`source → OutcomeSpec → GoalGraph → verified app discovery → owned Appium Session → fresh UI + provider preflight → permission-decision → single-use temporal effect grant → write-ahead journal (full-control) → SET intent một lần → SHOW/reopen + independent provider readbacks → evidence → VERIFIED`.

- Dùng action/extras chuẩn Android; package/component được PackageManager phân giải, không chứa package/selector/tọa độ Samsung trong runtime.
- Backend tạo nhãn correlation `PhoneCommander-<UUID>` cho mục mới. Nhãn không đủ làm bằng chứng một mình.
- Trước ghi: inventory đầy đủ, đọc count aggregate đối chiếu số dòng, timezone hợp lệ; chặn alarm đã có cùng giờ kể cả đang tắt; chặn timer đang chạy hoặc timer cũ cùng duration. Không đổi/tái sử dụng mục đó.
- Snapshot 5 giây, grant 5 giây, original Session, physical-device checks, scope expiry/revocation và cancellation được giữ. Recollect inventory sau khi chờ người dùng; kiểm tra lại trước dispatch.
- Full-control dùng authorization và durable write-ahead log của M6a với kind `CREATE_ALARM`/`START_TIMER`. Ordinary owner vẫn được auto effect; normal mode vẫn hỏi effect confirmation. Không bỏ các confirmation kỹ thuật khác.
- Chống dispatch trùng ở grant và ledger theo physical device/execution/node. Trước RPC ghi UNKNOWN; transport error không replay. Không tự xóa hoặc khôi phục bằng cách xóa mục mới.
- Hai lần đọc lại phải thấy đúng **một ID mới**, đúng nhãn backend, không đổi/xóa dòng cũ; UI phải re-open và không còn là editor. Alarm phải đúng hour/minute/enabled. Timer phải đúng duration, running=true, remaining giảm phù hợp khoảng thời gian monotonic giữa hai lần đọc.
- Các lỗi preflight/readback temporal được ánh xạ BLOCKED; không dùng foreground/transition/Intent receipt làm bằng chứng hoàn thành.

### Giới Hạn Provider Compatibility

Đây **không phải** API content-provider chuẩn được mọi Clock Android cung cấp. Runtime chỉ hỗ trợ contract có thể đọc và kiểm tra đầy đủ:

- Alarm collection `/alarms`: `_id`, `hour`, `minutes`, `enabled`, `label`.
- Timer collection `/timers`: `_id`, `duration_seconds`, `remaining_seconds`, `running`, `label`.
- Authority được lấy từ metadata provider thuộc package đã phân giải; không thử URI tùy ý do model/client cấp. Projection có đơn vị rõ; không đoán cột timer vendor là giây hay milliseconds.
- Phải có count aggregate tương ứng. Provider thiếu quyền/schema/count, nhiều provider phù hợp hoặc chỉ có UI mơ hồ đều bị chặn trước ghi.
- Hai package trong tests là **fixtures tổng hợp cùng contract**, không phải hai ứng dụng Android thật đã nghiệm thu. Chưa chứng minh ứng dụng thật nào expose đủ schema này.
- Chưa có fallback UI-only mới vượt qua thiếu provider mà vẫn chứng minh inventory đầy đủ/new identity/persistence. Các generic record forms cũ được giữ nguyên, không hardcode Samsung để làm acceptance pass.

## 4. Android Reconnaissance Và Evidence

Thiết bị USB `R58MA78W6QK`, Samsung A50s; physical identity được backend đọc. Appium port 4723, Next.js 3000 và Ollama 11434 có listener khi kiểm tra. Không gọi model để thử các mục ngoài M6b.

Các probe chỉ đọc đã thực sự thực hiện:

1. `adb devices -l`, window policy/keyguard, PackageManager resolve và package/provider metadata.
2. Query provider báo thức quan sát từ metadata: bị từ chối READ_ALARM/WRITE_ALARM. Không cấp quyền hoặc truy cập database private bằng cách khác.
3. Query timer provider quan sát được: URI probe không được provider chấp nhận. Không suy ra timer không tồn tại hoặc tự đoán schema.
4. Tạo đúng một Session tại một thời điểm trong recon; SHOW_ALARMS bị permission deny; Session được đóng trong finally. Chưa thu được snapshot Clock từ lượt này.
5. Các lượt tiếp theo ban đầu bị readiness chặn trước mở Session/mutation. Ảnh framebuffer xác nhận keyguard, không chỉ dựa vào model/rules. Sau lần xác nhận mở khóa tiếp theo, đã thăm dò UI và chạy task hợp lệ như dưới đây.

Evidence cục bộ (không đưa ảnh/dữ liệu thiết bị vào Git):

- `C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6b-dcs1Me\evidence.json`: recon đầu, Session ID, ownership/task/owner cleanup bằng 0; chưa có completion.
- `C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6b-q6dATt\evidence.json`: keyguard preflight, không có task được tính.
- `C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6b-Y5HIsz\evidence.json`: sau lời xác nhận mở khóa, readiness vẫn chặn, không có mutation.
- `C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6b-lock-state.png`: framebuffer lock-screen đọc bằng screencap, **không phải ảnh mới bằng Camera**.
- `C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6b-provider-preflight.json`: chạy reader thật, chỉ đọc. ALARM 8.619 s / 8 ADB; TIMER 1.951 s / 4 ADB; đều BLOCKED, 0 Appium RPC, 0 model calls, 0 mutation. Đây không phải E2E.
- `C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6b-VFsI8K\evidence.json`: launcher mở được Clock, nhưng tab thực tế ban đầu là Giờ quốc tế. Không coi nhầm đó là màn hình báo thức/timer.
- `C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6b-1ke8ID\evidence.json`: thăm dò đúng các tab bằng label/class đọc từ UI; không nhập/lưu/bắt đầu. Có screenshot form báo thức và hierarchy timer.
- `C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6b-j7Vo6G\evidence.json`: recon cuối có hierarchy form sau chờ điều kiện, snapshot sau Back và cleanup; cả hai Session đã đóng.
- `C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6b-di0wLa\evidence.json`: hai task controlled acceptance, event stream, profiling, trạng thái cuối và cleanup.

### Controlled Acceptance Trên Máy Đã Mở Khóa

Chạy trực tiếp `runAgentV2` với Android adapter thật, cùng Session/executor/grants/owner policy; **không phải Dashboard UI E2E**. Mỗi task chạy đúng một lần; Session trước đóng xong mới mở task sau. Reasoner của runner sẽ lỗi nếu bị gọi bất ngờ: hai graph source-exact đều là RULES, 0 model calls; không đổi provider hoặc model của dự án.

| Mục tiêu | Kết quả | Runtime total | Runner interval | Session setup | Observation span | Appium RPC | ADB | Model calls |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Đặt báo thức 7 giờ sáng | BLOCKED: TEMPORAL_PROVIDER_UNAVAILABLE | 15.818 s | 15.418 s | 5.675 s | 1.191 s | 12 | 36 | 0 |
| Hẹn giờ 10 phút | BLOCKED: TEMPORAL_PROVIDER_UNAVAILABLE | 10.805 s | 10.387 s | 5.614 s | 1.055 s | 12 | 32 | 0 |

Runtime total gồm một ít chuẩn bị trước khi runner bắt đầu interval; không lấy hai đồng hồ đó làm hai task khác nhau. RPC/ADB là các counter do adapter/runtime đo, không bao gồm các probe/recon ngoài task. `executionMs=0` và `verificationMs=0` do dừng ở preflight trước mutation, không có nghĩa không chạy ADB. Preflight chưa có span riêng; không suy ra latency bằng cách cộng/trừ các span chồng nhau.

Counts: **0/2 COMPLETED, 2/2 BLOCKED, 0 FAILED, 0 mutation dispatch**. Không có evidence mới về alarm/timer persisted/running. Không gộp probe hoặc lượt keyguard vào denominator. Full-control scope được tạo và tắt trong finally từng task; cả hai localEffects rỗng vì chặn trước journal/dispatch. Hai Session trả 404 `invalid session id` sau đóng; cuối lượt 0 active tasks, 0 owner modes, ownership=null.

Sau nghiệm thu, worker Dashboard được kiểm tra là idle và còn giữ source cũ. Đã graceful restart bằng `/shutdown` với body rỗng (không `cancelActive`, không force kill), chỉ sau kiểm tra 0 task/owner/inference. Worker mới khớp runtime digest hiện tại; cuối cùng 0 task, 0 owner mode, queue running=0/waiting=0. Không đổi env/model/config và không chạy lại task ghi qua Dashboard.

### UI Thật Đã Đọc

- Nhãn tab thực tế là “Chuông báo” và “Đếm giờ”, không chỉ “Báo thức”/“Hẹn giờ”. Recon ban đầu không chọn được tab vì thiếu synonym; đã sửa **runner thăm dò**, không đưa workflow/package/selector Samsung vào runtime.
- Danh sách Chuông báo có các row thời gian và Switch checked=false cho các mục cũ. Không click các Switch hoặc sửa các mục đó.
- Form mới có picker giờ/phút, tên chuông báo và Lưu/Thoát trên screenshot. Không nhập hoặc bấm Lưu. Snapshot đầu sau click còn là UI trước chuyển màn hình, nên không dùng nó làm bằng chứng field đã sẵn sàng; runner bổ sung chờ điều kiện widget cho lần thăm dò sau.
- Lần recon cuối xác nhận `android.widget.TimePicker` → hai `NumberPicker` → `EditText` text kèm đơn vị Giờ/Phút; hai field dùng chung leaf ID `numberpicker_input`. Có field tên chuông báo. Không quan sát được AM/PM trong layout này và không suy ra chế độ 24h chỉ từ sự vắng mặt đó. Ba thời gian bản ghi cũ vẫn là 00:15, 06:00, 07:30 sau khi thoát form không lưu; không coi các row đó là dữ liệu M6b tạo mới.
- Timer có ba `android.widget.EditText` cùng resource ID `android:id/numberpicker_input`, text kèm đơn vị Giờ/Phút/Giây; có nút “Bắt đầu” và một preset 10 phút chưa chọn. Không chọn preset hoặc bấm Bắt đầu. Sự tồn tại preset không chứng minh timer đang chạy.
- Runtime chưa có complete contract từ các field-role/collection UI này đến độc lập persisted alarm identity hoặc running timer khi provider không đọc được. Không click thử để che thiếu verifier.

## 5. Validation

Node thực: `C:\nvm4w\nodejs\node.exe`. Chạy các file regression tuần tự trong child riêng, không mở/chạy sealed/holdout. Không sửa assertions cũ.

| Kiểm tra | Kết quả | Thời gian run có log |
| --- | --- | ---: |
| Full regression | OFFLINE_TESTED: 803/803, 49 files = 745 cũ + 58 M6b | 106.23 s |
| TypeScript `--noEmit --incremental false` | PASS | 10.02 s |
| ESLint các file M6b | PASS | 7.87 s |
| Full ESLint | FAIL known unrelated: 1 error, 9 warnings | 16.74 s |
| `next build --webpack` | PASS | 95.62 s |
| `git diff --check` | PASS; chỉ warning chuyển LF/CRLF có sẵn | — |
| Secret scan exact configured secret values | Lần cuối 321 text files, 0 matching paths; loại trừ env/dependencies/build/git/sealed/holdout | — |

Full ESLint: `components/executions/ExecutionDetailModal.tsx:130:98`, `@typescript-eslint/no-explicit-any`. Không sửa file unrelated này. Các warning unused imports cũ giữ nguyên.

Sau validation tổng, runner recon chỉ được bổ sung synonym tab, chờ điều kiện form và snapshot sau Back; không đổi runtime nữa. ESLint runner được chạy lại riêng. Các số validation không phải bằng chứng task Android thành công.

Evidence validation:

`C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6b-validation-vAvt2h\summary.json`

Regression child logs:

`C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6a-validation-X6ytk3\summary.json`

Sau sửa quoting component (để tên Android có `$` không bị shell nội suy), chạy full regression lại: **803/803 PASS**, evidence `C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6a-validation-GjJNyv\summary.json`. Không thay assertions cũ.

Tên prefix `m6a` do tái sử dụng regression harness cũ, không có nghĩa chỉ chạy tests M6a. Harness đọc toàn bộ `tests/*.test.cjs`, gồm M6b.

Lịch sử sửa lỗi trong lượt: run focused đầu 51/54 do hai query độc lập có timestamp cùng millisecond bị từ chối nhầm và lỗi provider sau dispatch mang message “no write sent” không đúng phase. Đã sửa nguồn, giữ fresh-state checks, phân biệt readback sau ghi là uncertain/left-in-place. Run focused tiếp theo 54/54; thêm bốn test inventory/count/grant/full-loop → 58/58. Full regression 799/799 trước bốn test mới; sau đó 803/803.

Không cộng RPC/ADB/model span với execution/observation span vì có overlap. Các thời gian bảng validation không phải benchmark latency Android; xem bảng controlled acceptance cho hai task BLOCKED thật. Không có task Android hoàn thành. Không tuyên bố Ollama/Groq đã suy luận thành công ALARM/TIMER. Build cuối có warning static analysis `module.createRequire failed parsing argument` ở module Session có sẵn; exit 0, không sửa module ngoài scope để dập warning.

## 6. File Thay Đổi Riêng Cho M6b

Tạo:

- `lib/android/agent/temporal-contract.ts`: schema, diễn giải thời gian, standard Intent extras.
- `lib/android/agent/temporal-clarification.ts`: backend-only AM/PM binding theo execution.
- `lib/android/agent/temporal-evidence.ts`: provider compatibility contract, complete inventory, new identity và verifier.
- `lib/android/agent/temporal-executor.ts`: original-Session Intent execution, fresh preconditions, no replay, reopen/readback.
- `tests/agent-v2-m6b.test.cjs`: 58 regression/unit/integration tests.
- `scripts/agent-v2-m6b-acceptance.cjs`: readonly recon hoặc đúng hai tác vụ đã được owner cho phép, cleanup finally.
- `scripts/agent-v2-m6b-validation.cjs`: regression/typecheck/lint/build/diff logs tuần tự.
- `docs/agent-v2-m6b-report.md`.

Sửa bổ sung, không ghi đè thay đổi M6a có sẵn:

- `outcome-spec.ts`, `capability-registry.ts`, `goal-compiler.ts`, `goal-graph.ts`: temporal outcome/graph/progress.
- `permission-decision.ts`, `effect-grants.ts`, `local-effect-journal.ts`: source-exact scoped temporal effects và independent proof.
- `agent-v2.ts`: discovery/clarification/preflight/permission/execution/verification integration, precise BLOCKED.
- `lib/android/condition-executor.ts`: bridge vào cùng owned Session.

Không sửa settings mutation/inverse controller, Camera M6a, Action Plan/V1 schema, Groq/Ollama, env/config, fixtures hay regression cũ. Không commit/push.

## 7. Điều Chưa Được Chứng Minh

Chưa chứng minh tạo báo thức/timer trên Samsung hoặc nhiều hãng Android. Chưa có generic UI-only persistence fallback cho spinner/AM-PM khi provider private; chưa chứng minh native permission đủ trên Android khác. Không có benchmark model tổng quát hoặc Dashboard E2E trong M6b. Contract mới chỉ được gọi là OFFLINE_TESTED cho đến khi một ứng dụng thật cung cấp evidence tương ứng và nghiệm thu đạt.

M6b không được nâng trạng thái thành REAL_ANDROID COMPLETED chỉ vì unit tests/build pass, handler có tồn tại hoặc một màn hình Đồng hồ mở được.
