# Phone Commander: State Observer / Condition Executor

Báo cáo hiện hành: [Milestone 2.5 Resolution + Hybrid](milestone-2.5-resolution-report.md). Các kết quả bên dưới được giữ làm lịch sử kiểm thử.

Đây là báo cáo trước Milestone 2.5. Xem `ui-exploration-report.md` để biết thay đổi và kết quả mới; không dùng bảng này làm bằng chứng source mới đã PASS lại tất cả goal.

Ngày kiểm thử: 2026-10-13. Phạm vi: Milestone 1–2. Không triển khai Goal Planner, Recovery Engine hoặc Multi-device Agent.

## Kết luận nghiệm thu

- Milestone 1: nền tảng đã tích hợp và quan sát thật được YouTube, Chrome, Settings trên một Samsung A50s. Session/serial/cleanup được kiểm thử thật qua API; các lỗi thiết bị/instrumentation khác có unit test, không giả định chúng đã được tái hiện trên điện thoại trong lượt này.
- Milestone 2: đã triển khai matching động, precondition, polling, verifier và streaming. **Chưa nghiệm thu đầy đủ**: mục tiêu phát đúng video thứ hai còn BLOCKED, luồng Dashboard từ Ollama đến execution chưa xác minh do Ollama không kết nối, và mobile layout cũ có overflow.
- Chrome tìm kiếm và mở kết quả đầu tiên: PASS ở lần kiểm thử cuối, nhưng có lần trước TIMEOUT do provider không đưa WebView vào native hierarchy. Không coi một lần PASS là bằng chứng ổn định trên mọi phiên bản.
- Mọi Session thử nghiệm đã đóng; không cài/gỡ APK, đăng nhập, đăng ký kênh hoặc bật/tắt Wi-Fi.

## Source Code

### File mới

| File | Trách nhiệm |
| --- | --- |
| `lib/android/appium/client.ts` | REST W3C phía server, deadline/cancellation, sanitize lỗi, phân biệt Session invalid và socket hang up. Không thêm SDK lớn. |
| `lib/android/appium/session-manager.ts` | Kiểm chứng helper APK/instrumentation, một Session mỗi execution, kiểm tra udid, khóa serial dùng chung giữa process, DELETE/cleanup. |
| `lib/android/snapshot.ts` | Zod schema snapshot riêng; UUID/timestamp/serial/package/activity/elements, không bịa thuộc tính provider không cung cấp. |
| `lib/android/state-observer.ts` | Đọc Appium XML, foreground/viewport, polling tuần tự có deadline; native lookup/displayed/enabled/clickable/rect. |
| `lib/android/screen-state.ts` | Phân loại màn hình tổng quát và profile YouTube, kiểm tra viewport/ancestor clipping. |
| `lib/android/ui-understanding.ts` | Matching từ dữ liệu UI, selector cụ thể/semantic, reject ambiguity và element ID giả hoặc khác snapshot; nhận diện card URL/title trong WebView. |
| `lib/android/action-verifier.ts` | Xác minh chuyển sang ô tìm kiếm, kết quả, player, trang web và Wi-Fi; không coi lệnh đã gửi là mục tiêu đạt. |
| `lib/android/condition-executor.ts` | Preflight, backend selection, observe–act–verify cho từng action, chống thao tác nhạy cảm được nhận diện. |
| `lib/android/errors.ts` | TIMEOUT / UNKNOWN / DEVICE_ERROR / SESSION_ERROR / BACKEND_ERROR / CONFIG_ERROR / CANCELLED. |
| `tests/state-observer.test.cjs` | Unit tests không cần điện thoại/Internet. |
| `tests/android-observer.integration.cjs` | Opt-in real-device cho ba ứng dụng, report có bằng chứng metadata và cleanup. |
| `tests/android-observer-api.integration.cjs` | Opt-in API streaming, SENT, TIMEOUT, overlap và cancellation thật. |
| `.env.example` | Cấu hình Appium/backend, giữ các biến Ollama hiện có. |
| `docs/state-observer-report.md` | Báo cáo này. |

### File sửa

| File | Thay đổi |
| --- | --- |
| `lib/android/adb.ts` | Export runner dùng lại, hỗ trợ ADB_PATH; discovery/screenshot giữ nguyên. |
| `lib/android/executor.ts` | Preflight có tùy chọn keyboard và dynamic target; executor ADB cũ vẫn dùng riêng. |
| `lib/android/capabilities.ts` | Validation động chỉ cho backend mới; quy tắc System Prompt không đổi. |
| `lib/android/targets.ts` | Dùng parser XML chung cho ADB `<node>` và Appium class-name tags, giữ hierarchy/thuộc tính; video_list không chỉ dựa container. |
| `app/api/executions/route.ts` | Context/lock, deadline 5 phút, NDJSON metadata, hủy request và cleanup trước complete. Dùng Node runtime mặc định; không export runtime khi Cache Components bật. |
| `types/execution.ts` | Thêm SENT, phase, errorCode, elapsedMs, evidence, pre/postcondition, giữ fields cũ. |
| `hooks/useDashboardDemo.ts` | Hiển thị trạng thái backend thật, deduplicate progress logs, không đổi SENT thành SUCCESS; cleanup request khi unmount. |
| `components/commands/AICommandPanel.tsx` | Trạng thái Android, serial/package, thời gian và bằng chứng; giữ bố cục hiện có. |
| `README.md`, `.gitignore` | Hướng dẫn backend, Session/lock/test; cho phép theo dõi .env.example. |

Không sửa Action Plan schema, model Ollama, Modelfile, Interpret API, Discovery API hoặc Device Grid. Tái dùng Zod, fast-xml-parser, resolver package, ADB runner, phím hệ thống và executor cũ.

## Luồng Thực Thi

1. Validate request và Action Plan bằng schema cũ; chặn plan nhạy cảm được nhận diện.
2. Kiểm tra serial từ Discovery và lấy khóa atomic trên serial.
3. Chọn duy nhất Appium hoặc ADB. Không có hai XML polling cạnh tranh và không tự fallback khi Session lỗi.
4. Backend Appium kiểm tra package helper/version/instrumentation trước skipServerInstallation, từ chối external forward tới tcp:6790 và tạo một Session.
5. Observer lấy package/source/viewport/activity, kiểm tra lại foreground để phát hiện race, chuyển XML thành structured snapshot.
6. UI matching chỉ dùng các node được đọc; lookup native kiểm tra duy nhất một phần tử, enabled/displayed và clickable/viewport trước CLICK. Snapshot cũ hoặc selector mơ hồ không được dùng để đoán.
7. Executor dispatch action; verifier chờ điều kiện thực, không sleep cố định để suy ra ready. Poll interval là throttle 150ms giữa lần đọc, không phải thời gian chờ UI bắt buộc.
8. SUCCESS chỉ cho VERIFIED. Khi chỉ biết lệnh đã gửi, dùng SENT/DISPATCHED; complete không báo success khi còn SENT.
9. Hủy request dừng các bước tiếp theo. Tạo Session đang chạy được chờ để giữ ID cleanup. DELETE đóng Session rồi mới nhả khóa và gửi complete.

Nếu không chắc kết quả tạo/đóng Session, giữ khóa để kiểm tra thủ công. Crash recovery tự động, session pool và replan không thuộc lượt này.

## Kết Quả Kiểm Thử

### Kiểm tra không dùng điện thoại

| Hạng mục | Kết quả |
| --- | --- |
| TypeScript `tsc --noEmit` | PASS |
| ESLint các file thay đổi | PASS |
| Unit test ADB cũ + observer mới | PASS: 45 tests; gồm 14 tests ADB cũ |
| ESLint toàn repo | FAIL do lỗi có sẵn: `DeviceScreen.tsx` setState trong effect; `ExecutionDetailModal.tsx` explicit any. Có 22 warnings. Không sửa các component ngoài phạm vi. |
| Production build | NOT TESTED; đã xác minh route và Dashboard qua dev server. |

Unit tests bao phủ immediate/delayed condition, TIMEOUT, UNKNOWN, DEVICE_ERROR, SESSION_ERROR, cancellation, duplicate selectors, stale selection, clipping, nhập sai nội dung, CLICK chưa có verifier, APK/session lifecycle và lỗi cleanup. Các kết quả mock không được trình bày như real-device PASS.

### Thiết bị thật

Samsung Galaxy A50s, SM-A507FN, Android 11, USB; chỉ một điện thoại. Appium 3.8.0, UiAutomator2 8.7.0, Node 22.19.0, JDK 17.0.20.1. Serial lấy từ tham số test/Discovery, không hardcode vào business logic.

| Luồng | Bước và thời gian thực tế | Kết quả |
| --- | --- | --- |
| YouTube | OPEN_APP 5401ms; WAIT search 2178ms; CLICK search 3124ms; INPUT Unicode 4167ms; ENTER 4592ms; WAIT video_list 1396ms | Sáu bước PASS, xác minh query và node video thật. |
| Video thứ hai | Matching `video_card_2` ở snapshot hiện tại trả MISSING; không click đoán hoặc chọn lại ordinal sau cuộn | BLOCKED; chưa chứng minh phát video thứ hai. |
| Chrome | OPEN 3742ms; CLICK address 4459ms; INPUT 2999ms; ENTER 4386ms; CLICK first_result 6142ms | PASS ở lần cuối; truy vấn, card thật và trang đích được xác minh. |
| Settings | OPEN 3306ms; CLICK Kết nối 3502ms; CLICK Wi-Fi 2883ms | Trang Wi-Fi PASS; bước Kết nối ghi SENT vì chưa có trusted postcondition. Không toggle switch. |
| Session cleanup | DELETE trong finally, report cleanup PASS cho cả ba app | PASS |

YouTube snapshot cuối đọc mất **675ms**, Settings/Chrome có số đo read riêng trong JSON report. Thời gian action bao gồm đọc và native lookup/verification, không phải riêng network latency. Chưa benchmark riêng thời gian native locate, RAM/CPU hoặc ADB vs Appium trên cùng trạng thái. Không suy diễn hiệu năng từ spec máy 8GB.

### Selector và trạng thái thực tế

- YouTube: accessibility label `Tìm kiếm`; `com.google.android.youtube:id/search_edit_text`; `com.google.android.youtube:id/search_query`. Registry dùng label/resource thực đọc được và kiểm tra unique native element. Các trạng thái đã xác minh: SEARCH_INPUT, SEARCH_RESULTS, foreground YouTube; VIDEO_PLAYER chưa xác minh trong lượt này.
- Chrome: `com.android.chrome:id/url_bar`; card `android.view.View` có content-description gồm URL/title, nằm trong `android.webkit.WebView`. Không hardcode tọa độ hoặc resource ID động của trang Google. Trang kết quả đã có card công thức nấu phở, trang đích có hostname và tiêu đề khớp bằng chứng trước click. Generic screen: INPUT/OBSERVED.
- Settings: label `Kết nối` và `Wi-Fi`, matching label lên clickable ancestor. Trang Wi-Fi xác minh có nội dung Wi-Fi và Switch, không click Switch. Generic screen: OBSERVED.
- Không sử dụng container `results` riêng lẻ làm bằng chứng YouTube đã load.

### API thật

| Bài thử | Kết quả | Tổng thời gian request/test |
| --- | --- | --- |
| Sensitive plan từ chối, không Session | PASS | 942ms |
| Foreground + streaming SUCCESS | PASS | 8380ms |
| Phím chỉ dispatch => SENT, success=false | PASS | 11897ms |
| Target thiếu => TIMEOUT, bước sau PENDING, Session đóng | PASS | 11458ms; condition deadline 3000ms |
| Request cùng serial bị 409/SESSION_ERROR; hủy request đầu nhả khóa | PASS | 7016ms |

Các tổng thời gian trên bao gồm preflight, tạo Session và cleanup, không thay thế thời gian WAIT_FOR. Mất kết nối vật lý không thử lại bằng rút cáp; DEVICE_ERROR có unit test. Invalid-session/socket-hang-up được inject ở unit test; overlap SESSION_ERROR và cancellation được kiểm thử trên API thật.

### Dashboard và tương thích

- GET devices/ảnh và Dashboard load thiết bị thật: PASS.
- Interpret API được gọi từ Dashboard: BLOCKED, UI báo không kết nối Ollama. Không sửa cấu hình/model/prompt để tạo kế hoạch giả.
- Tiến trình backend được xác minh qua NDJSON thật; render execution panel end-to-end từ AI button chưa xác minh vì không có plan từ Ollama.
- Desktop 1440px: khu vực command và lỗi Ollama hiển thị. Mobile 390px: FAIL layout cũ, sidebar rộng cố định làm tràn header/nội dung; không đánh dấu responsive PASS.
- Dashboard/queue/logs khởi tạo vẫn chứa dữ liệu demo cũ. Chúng không phải evidence real-device và không được tính vào kết quả PASS ở đây.

## Giới Hạn và So Sánh Backend

| Tiêu chí | Appium mới | ADB cũ |
| --- | --- | --- |
| Quan sát | XML native + foreground/activity/viewport, structured snapshot | UIAutomator XML polling, không cần Appium Session |
| Định vị | Native element + displayed/enabled/clickable/rect, ambiguity refusal | Selector registry và bounds/tap |
| Unicode | Gửi trực tiếp rồi đọc lại exact text | ADB Keyboard cho Unicode, khôi phục IME |
| Xác minh | Pre/postcondition riêng; SENT khi không có trusted verifier | Giữ behavior cũ; WAIT/INPUT có verification, các action khác ghi SENT |
| Độ ổn định | Phụ thuộc instrumentation/Session; đã gặp WebView omission | Phụ thuộc dump/idle, registry; không chạy song song với Appium |
| Độ trễ | Có session setup và nhiều native commands | Có dump XML và ADB commands; chưa có benchmark ngang điều kiện |

Appium làm UI observer/element action; ADB làm Discovery, launch/close/key/screenshot. Backend ADB chỉ chọn rõ ràng khi không còn Session. Không tự đổi backend khi còn Session lỗi.

Native hierarchy không đại diện toàn bộ pixel: Chrome có lần source chỉ có toolbar, dù ảnh thật cho thấy kết quả; source không có WebView và session-only settings enableMultiWindows/ignoreUnimportantViews không khắc phục lúc đó. Lần cuối provider lại cung cấp WebView và bài thử PASS. Không persist setting điện thoại, không bật Chrome debugging hay dùng screenshot coords làm fallback.

Matching browser organic result cố ý bảo thủ: nếu thấy Sponsored/Ad mà không biết ranh giới nhóm, từ chối nhóm; redirect hoặc title thay đổi cũng có thể không verify. Chưa có CDP/WebView context, OCR, popup/ad recovery, tự cuộn tìm ordinal xuyên snapshot hoặc arbitrary goal verifier. SWIPE mới chỉ dispatch trên duy nhất một vùng scrollable đủ bounds; chưa thử thật SWIPE trong lượt này.

General matching/execution không có nghĩa AI planner đã tổng quát: System Prompt vẫn giữ phạm vi cũ, Chrome/Settings dùng plan xác định trong integration test. Sensitive guard chỉ nhận diện các control/target đã biết; không được coi đây là sandbox an toàn cho arbitrary plan trên app tài chính/tin nhắn. Chưa có confirmation flow.

## Cách Tiếp Tục

1. Hoàn thiện nghiệm thu M2 trước: khởi động Ollama hiện có để kiểm tra UI execution thật, sửa mobile layout riêng, xác minh ordinal video cùng identity/title qua các snapshot; benchmark Chrome/WebView lặp lại trên phiên bản thiết bị hiện có.
2. M3: planner/decision nhận snapshot đã validate, quyết định từ element IDs/context có thật; thêm goal verifier, không cho LLM tự phát shell/selector ngoài evidence.
3. M4: recovery có giới hạn cho loading/popups/ads, bảo toàn goal/video identity, cleanup trước khi đổi backend; không tự xử lý CAPTCHA hay cài APK.
4. M5: Device Agent/state/goal độc lập, port/session/queue riêng từng serial. Khóa hiện tại là chống xung đột, chưa phải multi-device orchestration.

Ba milestone sau chỉ là hướng tiếp theo, chưa có module placeholder hoặc implementation trong lượt này. Hướng dẫn setup/chạy/test tại README.
