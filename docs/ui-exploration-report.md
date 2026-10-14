# Milestone 2.5: UI Exploration

Đây là báo cáo giai đoạn trước resolver/hybrid. Xem [báo cáo hiện hành](milestone-2.5-resolution-report.md) cho Chrome DOM PASS, policy độc lập, 129 unit tests và 7 API cases. YouTube vẫn BLOCKED, không coi cập nhật này là nghiệm thu toàn bộ milestone.

Kiểm thử ngày 13–14/10/2026, một Samsung A50s SM-A507FN, Android 11, USB. Appium 3.8.0 / UiAutomator2 8.7.0 đã được xác minh; không cài/gỡ APK, đổi model/prompt hay Action Plan schema.

## Kết Luận

**Đã triển khai cơ chế khám phá UI và tích hợp executor, nhưng chưa nghiệm thu đầy đủ Milestone 2.5 end-to-end.** Không đánh dấu PASS cho mục tiêu mở đúng video thứ hai hoặc kết quả Chrome phía dưới khi chưa có bằng chứng hoàn tất.

- Settings: PASS tìm mục ngoài viewport qua cuộn thật, không mở trang thông tin chứa số định danh và không thay đổi cài đặt.
- YouTube: PASS tìm kiếm, phát hiện danh sách, nhớ kết quả xuyên snapshot. Goal mở video thứ hai vẫn BLOCKED: mất overlap hoặc thiếu điểm kích hoạt riêng có thể xác minh trong hierarchy. Runtime dừng AMBIGUOUS, không coi việc đã gửi tap là SUCCESS.
- Chrome: có lần đọc được card và khám phá thêm kết quả; goal thứ ba chưa PASS. Lần cuối provider trả 30 node với toolbar, không có vùng scrollable/result cards; ENTER verification TIMEOUT, không click đoán.
- Nested scrolling: unit test PASS; NOT TESTED trên giao diện nested thật của điện thoại.
- API streaming/lock/cancellation: 5/5 PASS thật. Unit tests và typecheck PASS; lint phần thay đổi PASS. Lint toàn repo còn lỗi có sẵn, không đồng nghĩa toàn repo sạch.

## File Mới

| File | Trách nhiệm |
| --- | --- |
| `lib/android/exploration/types.ts` | Goal nội bộ, status/metrics và Zod config có giới hạn. Không sửa schema plan. |
| `lib/android/exploration/scroll-regions.ts` | Scrollable/viewport/ancestor clipping, phân giải vùng liên quan, reject peer ambiguity, content fingerprint. |
| `lib/android/exploration/scroll-controller.ts` | Kiểm tra native displayed/enabled/scrollable và rect trước gesture; scrollGesture với vùng cụ thể, percent/speed; bắt buộc canScrollMore boolean. |
| `lib/android/exploration/element-memory.ts` | Candidate adapters, phân loại bằng chứng ad/video/browser/list, bộ nhớ nội dung có thứ tự và dedup/ambiguity. |
| `lib/android/exploration/ui-explorer.ts` | Observe–match–scroll–observe, kiểm chứng origin, duy trì ordinal, tìm điểm kích hoạt mới, giới hạn/cancellation/telemetry. |
| `tests/ui-exploration.test.cjs` | Unit tests và component integration với mock Observer/native client; không cần thiết bị/Internet. |
| `tests/android-exploration.integration.cjs` | Opt-in real-device cho YouTube/Settings/Chrome, report thật, finally đóng Session. |
| `docs/ui-exploration-report.md` | Báo cáo hiện tại. |

## File Sửa

| File | Thay đổi trong lượt 2.5 |
| --- | --- |
| `lib/android/condition-executor.ts` | Tích hợp explorer cho CLICK/WAIT; giữ delayed WAIT khi không có vùng cuộn; verification budget ordinal, reset/dispose memory, SWIPE tái dùng controller. |
| `lib/android/state-observer.ts` | Progress metrics; native validation điểm kích hoạt label với clickable owner, nội dung hiện tại, containment và rect. |
| `lib/android/screen-state.ts` | Watch-screen markers đọc thật; từ chối geometry lỗi hoặc center bị control khác phủ. |
| `lib/android/action-verifier.ts` | Xác minh selected title trong metadata hiện tại, không lấy mô tả mục đề xuất làm title của video; browser URL/title evidence. |
| `lib/android/ui-understanding.ts` | Canonical text giữ Unicode cho identity/validation; semantic normalization vẫn riêng. |
| `lib/android/errors.ts` | Thêm NOT_FOUND, AMBIGUOUS, SCROLL_LIMIT_REACHED và exploration metadata. |
| `lib/android/adb.ts` | Giữ cause của lỗi subprocess để phân biệt timeout/permission với mất USB thật. |
| `lib/android/appium/session-manager.ts` | Phân loại lỗi ADB; setting waitForIdleTimeout chỉ trong Session, không phải capability/cài đặt Android lâu dài. |
| `types/execution.ts` | Metadata exploration và error codes, giữ fields cũ. |
| `app/api/executions/route.ts` | Stream progress/error metrics thật, vẫn cleanup trước complete. |
| `hooks/useDashboardDemo.ts` | Dedup log theo phase/scroll/status; cancellation không giữ phase đang chạy. |
| `components/commands/AICommandPanel.tsx` | Các trạng thái khám phá, số scroll/snapshot/mới/trùng; không dựng lại Dashboard. |
| `tests/state-observer.test.cjs` | Điều chỉnh mock của executor để tách integration layer mới. |
| `.env.example`, `README.md`, `docs/state-observer-report.md` | Config/run/test và phân biệt báo cáo lịch sử với kết quả mới. |

## Kiến Trúc

1. Executor đọc target từ action cũ. `video_card_N`, `result_N`, `list_item_N` thành goal ordinal nội bộ; selector literal thành goal tìm element. Không gọi AI để tự phát shell/selector.
2. Target literal đã sẵn sàng được locate ngay, không scroll bắt buộc. Các ordinal phải xác minh đầu danh sách bằng gesture hướng ngược và canScrollMore=false; không coi viewport đầu tiên đang thấy là đầu kết quả.
3. Region detector chỉ dùng scrollable=true, package hiện tại, clipped bounds và hierarchy. Loại carousel ngang khi tìm theo chiều dọc; ưu tiên container chứa goal evidence/innermost list. Nhiều peer không phân giải được => AMBIGUOUS.
4. Controller locate lại region native, đọc scrollable/rect, cuộn trong vùng có inset. Percent mặc định 0.35, speed 700px/s; một gesture rồi quan sát, không batch swipe cố định.
5. Memory lưu snapshot/context/type/text/description/resourceId/bounds/thứ tự/duplicate/confidence. Identity là hash nội dung Unicode canonical có thật (browser thêm URL), không dùng elementId Appium xuyên snapshot. Không giả định hash nội dung là video ID ổn định.
6. Memory kiểm tra duplicate cùng viewport và suffix/prefix overlap đúng thứ tự. Không có overlap, reorder, metadata đổi với cùng title hoặc thông tin không đủ => AMBIGUOUS. List virtualized/lazy-loaded chỉ nối được khi continuity còn chứng minh được.
7. Partial geometry được kiểm tra với viewport/ancestor, và chiều cao đã thực sự thấy trong list khi provider truncate bounds. Cuộn tiếp có giới hạn để đưa mục vào vùng tương tác; không suy ra title/identity từ pixel.
8. Element được xác định lại ở snapshot mới, không dùng native reference cũ. Video yêu cầu title/thumbnail activation control cụ thể; label chỉ được delegate khi owner clickable thật, text hiện tại khớp, rect nằm trong owner và điểm không bị control khác phủ.
9. Click xong còn phải verify. Player/preview khác nhau; selected title phải có bằng chứng, không phải chỉ player_view. SENT vẫn dành cho dispatch chưa có trusted postcondition.
10. Cuối list, UI không đổi, scroll/memory/time limits, SDK/device/session error hoặc cancel đều dừng. Cleanup/serial lock và backend ADB riêng được tái sử dụng, không mở Session sau mỗi scroll.

Chrome toolbar có thể ẩn khi cuộn: anchor biến mất không được coi ngay là query đổi. Vẫn bắt buộc base serial/package/activity giữ nguyên và memory continuity; anchor mới có giá trị khác thì dừng UNKNOWN. Regression test bao phủ trường hợp này.

## Quảng Cáo và Ordinal

- YouTube adapter nhận long-video accessibility description có bằng chứng Play video và title/duration; không đếm Play short/Shorts shelf hoặc Sponsored/Được tài trợ. Không đếm thumbnail thiếu identity.
- Ad marker phải gắn được với card/group. Không biết ranh giới ad/ordinary => AMBIGUOUS, không cho AI tự đoán.
- Affiliate/product metadata không tự động đồng nghĩa sponsored ad. Video đó có thể là kết quả thường, nhưng không tap tâm card vì có thể kích hoạt Sản phẩm/preview.
- Browser dùng URL/title cards trong WebView. Generic list cần RecyclerView/ListView và row content phân biệt được. Chưa hỗ trợ tất cả ngôn ngữ, grid/order hoặc UI không có accessibility data.
- Thứ N lấy từ memory đã anchored, không từ XML index hay số card hiện tại sau scroll. Không tự tính lại từ đầu ở viewport mới.

## Kiểm Thử và Hiệu Năng

| Bài thử | Kết quả thực tế |
| --- | --- |
| TypeScript | PASS `tsc --noEmit`. |
| Unit/component integration | PASS 89 tests: ADB cũ, observer/session và UI exploration. Mock không được tính thành hardware PASS. |
| ESLint phần thay đổi | PASS. |
| ESLint toàn repo | FAIL còn lỗi có sẵn `DeviceScreen.tsx` setState-in-effect và `ExecutionDetailModal.tsx` explicit any; không sửa component ngoài phạm vi. |
| Settings offscreen, lần cuối | PASS: initial target MISSING; region `com.android.settings:id/recycler_view`, RecyclerView; 5 scroll, 6 snapshot, 1 target; 23804ms action. Observation ban đầu 1308ms. |
| YouTube discovery | Đã có trace 2 ordinary results, dedup và continuity sau scroll; ví dụ safe run 2 scroll / 3 snapshot / 2 mới / 1 trùng, 9087ms discovery. Goal activation AMBIGUOUS vì không có title/activation control riêng. Không PASS mở video thứ hai. |
| YouTube debug trước guard | Tap tâm card đã mở Sản phẩm/preview hoặc không chuyển màn hình; postcondition TIMEOUT, không SUCCESS. Đã thêm activation/occlusion guards và tests để không coi card-center là click video đáng tin. |
| Chrome, lần đọc được body | WebView scrollable thật, có 2 cards trước scroll, 3 cards sau scroll; phát hiện toolbar collapse/scope issue, đã thêm xử lý và regression test. Goal phía dưới chưa xác minh. |
| Chrome, lần cuối | OPEN/CLICK address/INPUT PASS; ENTER TIMEOUT ~20023ms. Observer 656ms, 30 nodes, NOT_FOUND scroll region; không click kết quả thứ ba. |
| API thật | 5/5 PASS: sensitive reject 1992ms; verified foreground 17039ms; SENT 13856ms; missing target TIMEOUT 12420ms; overlap reject + cancel cleanup 7384ms. Tổng gồm tạo/đóng Session, không phải chỉ WAIT latency. |
| Nested scrolling thật | NOT TESTED. Mock innermost/peer/carousel/direction tests PASS. |
| USB rút cáp / socket hang up thật | NOT TESTED lại; unit injection và session cleanup tests PASS. Không gọi deadline/SDK permission là USB disconnect. |
| CPU/RAM | NOT MEASURED. Không suy diễn mức cải thiện từ cấu hình máy 8GB. |

Đọc UI có lần ~0.7–1.3s và có lần >10s khi feed animation hoạt động. Driver cục bộ ghi default waitForIdleTimeout=10000ms; giảm xuống 1000 theo Session, nhưng vẫn phải kiểm tra native/condition, không đặt 0 để bỏ mọi chờ rồi click mù. Scroll speed/percent có config và không đảm bảo mọi app cung cấp đủ identity.

Metrics được phát từ các bước thật: scrollCount, snapshotCount, newElements, duplicateElements, elapsedMs, reason. Snapshot count trong verification cộng các snapshot đã quan sát thêm; elapsed discovery và tổng action là hai số khác nhau. AI-assisted exploration hiện **0 calls / 0ms**: thuật toán xác định xử lý rõ ràng, ambiguity giữ nguyên; không gửi XML/screenshot đến Qwen.

## Dashboard và Giới Hạn

- Ollama hiện kết nối được và đã trả plan trên Dashboard. Plan thử podcast/video thứ hai bị Qwen gắn `isSensitive=true` dù không có thao tác tài khoản; backend chặn trước Session. Không tự gỡ flag hoặc sửa prompt/model trong lượt này.
- Streaming có metrics thật và label SEARCHING/CHECKING_LIST/SCROLLING/WAITING_DATA/FOUND/VERIFYING/NOT_FOUND/AMBIGUOUS. Demo queue/logs cũ vẫn tồn tại; không tính chúng là chứng cứ thực thi thật.
- UI pipeline không thể coi PASS chỉ vì phân tích được JSON. Cần kiểm tra plan/flag, native hierarchy, continuity và activation.
- Mất vùng scrollable hoặc provider không đưa WebView/cards vào XML không thể sửa bằng tăng số swipe; engine không fallback mù sang ADB XML/screenshot coordinates.
- Title/node bounds có thể bị merge/truncate, metadata có thể đổi; exact-content identity cố ý bảo thủ, không thay thế ID vĩnh viễn của ứng dụng.
- Không có AI disambiguation, Vision/OCR, recovery popup/ad, automatic backtracking khi ordinal mất dấu, goal replanning hoặc multi-device orchestration. Controller hỗ trợ 4 hướng; ordinal exploration hiện ưu tiên list dọc, không cam kết horizontal/grid ordinal tổng quát.
- Chưa production build và chưa nghiệm thu mobile responsive mới; layout mobile cũ được ghi nhận ở báo cáo M2, không dựng lại UI ngoài yêu cầu.

## Chạy Lại

Theo setup trong README, chạy tuần tự khi Appium/ADB sẵn sàng:

```powershell
node --test tests/android-executor.test.cjs tests/state-observer.test.cjs tests/ui-exploration.test.cjs
node tests/android-exploration.integration.cjs --serial EXAMPLE_SERIAL --app youtube --adb-path "C:\Android\platform-tools\adb.exe"
node tests/android-exploration.integration.cjs --serial EXAMPLE_SERIAL --app settings --adb-path "C:\Android\platform-tools\adb.exe"
node tests/android-exploration.integration.cjs --serial EXAMPLE_SERIAL --app chrome --adb-path "C:\Android\platform-tools\adb.exe"
```

Thay serial/path đúng máy. JSON report trong TEMP, cleanup trong finally; `--inspect` không thực hiện goal click, `--diagnose` in public test evidence của title/region, không dùng kết quả inspect làm PASS. Script không tự tải `.env.local`.

Hướng tiếp theo: xác minh semantic accessibility action/title activation trên phiên bản YouTube thực tế, WebView provider/URL identity trên Chrome, policy xác nhận cho plan và sửa planner flag riêng. Vision chỉ với provider/model hỗ trợ ảnh thật và user consent; không giả định Qwen text-only đọc được screenshot. M3/M4/M5 chưa triển khai trong lượt này.
