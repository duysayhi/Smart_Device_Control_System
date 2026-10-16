# Autonomous Task Completion V1

Cập nhật offline: 15/10/2026. Không tạo Session hoặc thực thi tác vụ trên Android trong lượt cập nhật này. Các kết quả thiết bị bên dưới thuộc lượt thử trước khi ngắt kết nối, không phải nghiệm thu lại bản cuối.

## Trạng Thái Sản Phẩm

| Nhiệm vụ từ Dashboard | Kết quả thiết bị đã quan sát trước đó | Thời gian |
| --- | --- | --- |
| Tìm hướng dẫn cài đặt Python trên Windows và mở bài hướng dẫn đầu tiên phù hợp | COMPLETED 3/3, xác minh URL và nội dung trang bằng DOM; 6 bước, 36 snapshot, 1 cuộn, không gọi AI | 69,1 s; quan sát 43,6 s |
| Mở Cài đặt và xem dung lượng lưu trữ còn trống của điện thoại | COMPLETED 2/2, đọc bộ nhớ trong ở Samsung My Files, không nhầm RAM; 4 bước, 17 snapshot, không gọi AI | 28,8 s; quan sát 16,1 s |
| Tìm podcast tiếng Anh và phát video thông thường thứ hai | BLOCKED 2/3; chưa chứng minh thứ tự liên tục và vùng kích hoạt video thứ hai. Không báo đã phát | Lượt đầu 157,3 s; hai lượt sau khoảng 138,3 s mỗi lượt |
| Hủy tác vụ Chrome đang chạy | Dashboard nhận CANCELLED từ backend sau cleanup, không chỉ ngắt fetch | 27,9 s tính từ lúc bắt đầu goal, không phải độ trễ riêng của Hủy |

Lượt Chrome thực tế gặp hộp thoại ngoài dự kiến. Agent dùng BACK, xác minh lớp cản biến mất trong cùng ứng dụng rồi tiếp tục tìm kiếm. Đây là bằng chứng xử lý trở ngại thật; các kịch bản mô phỏng không thay thế bằng chứng này.

Lượt Settings đầu tiên dừng khi mục Lưu trữ chuyển sang `com.sec.android.app.myfiles`. Sau khi quan sát hierarchy thật mới bổ sung profile đọc giới hạn cho app này và chạy lại từ Dashboard thành công. Không cấp quyền mở tệp, dọn dẹp hoặc thay đổi dữ liệu.

## Giá Trị Lưu Trữ

Màn hình đã xác minh có nhãn Lưu trữ, Bộ nhớ trong, tổng 64,00 GB và đã dùng 26,00 GB. Dashboard báo **còn trống khoảng 38,00 GB**, ghi rõ tổng trừ đã dùng. Đây là phép tính từ hai giá trị UI đã làm tròn, không phải số byte trống đọc trực tiếp. Ở lần đọc chẩn đoán khác, đã dùng là 26,01 GB; không coi hai snapshot khác thời điểm là một giá trị cố định.

Verifier yêu cầu hai giá trị dùng/tổng cùng parent và cùng thẻ bộ nhớ trong, đơn vị thống nhất, tổng không nhỏ hơn đã dùng. Không dùng dung lượng RAM, phần trăm usage, kích thước app hoặc thẻ SD để hoàn thành yêu cầu này. Câu “xem dung lượng bộ nhớ” chưa nêu RAM/lưu trữ sẽ yêu cầu làm rõ trước Session.

## Hỗ Trợ Và Hủy

Dashboard đã nối luồng chọn điểm trên ảnh crop, xác nhận riêng và tiếp tục execution đang tạm dừng. Token xác nhận chỉ dùng một lần, gắn với evidence ID, TTL tối đa 120 giây và không vượt deadline goal. Backend giữ nguyên Session trong thời gian chờ, sau đó kiểm tra lại pixels, hierarchy, orientation, target và policy trước khi tap. Tap được gửi chưa có nghĩa là COMPLETED: vẫn phải xác minh đúng nội dung đích.

Token Hủy độc lập với token chọn điểm. Nút Hủy gửi STOP đến backend và giữ luồng để nhận kết quả sau cleanup. Khi kết nối trình duyệt bị ngắt trước lúc có token, giao diện không khẳng định rằng cleanup đã được xác nhận. Token sai, cũ hoặc gửi lại bị từ chối. Xác nhận vùng kích hoạt không cấp quyền cho hành động nhạy cảm; policy vẫn chặn các hành động đó.

**Chưa nghiệm thu luồng hỗ trợ tiếp tục trên Android thật.** Test mô phỏng chứng minh wiring giữ execution và kiểm tra đích; không chứng minh đã chọn/phát video thứ hai trên điện thoại. Khi ordinal continuity chưa được xác minh, không tạo xác nhận giả để vượt điều kiện này. Không cài Vision model, đổi Qwen hoặc gửi ảnh ra dịch vụ ngoài.

## Giới Hạn YouTube

Đã thử quan sát thêm, quay về đầu danh sách, loại quảng cáo/Shorts, lưu identity để chống đếm trùng và hai lượt cuộn ngược để lấy lại overlap. Hierarchy thực tế có lúc chỉ lộ một thẻ video với bounds bị cắt rất nhỏ; XML ADB chẩn đoán cũng gặp lỗi không lấy được idle state. Những lần này không đủ chứng minh các video giữa hai viewport là liền nhau, cuối cùng hết deadline Appium/exploration.

Bước cuộn có giới hạn theo anchor quan sát được, chỉ áp dụng khi còn khám phá ordinal chưa thấy, không áp dụng khi căn lại mục đã đếm. Có giới hạn chống bước cuộn nhỏ dần về không; vẫn phải kiểm thử lại thay đổi này trên máy thật. Không tăng deadline hoặc bỏ verification để báo thành công.

Không thể giải quyết chắc chắn giới hạn nhận diện bằng unit test khi không có thiết bị. Cần kết nối lại cùng điện thoại để quan sát bản YouTube hiện tại và nghiệm thu điều chỉnh. Nếu vẫn không có bằng chứng native/DOM, cần hỗ trợ con người hoặc Vision được cho phép; không tự tải hoặc sử dụng dịch vụ ảnh ngoài.

## Thời Gian

Giảm đọc trùng bằng cách tái dùng snapshot hậu điều kiện còn mới, chỉ để đánh giá criterion độc lập; thao tác tiếp theo vẫn đọc lại UI. Với mục lưu trữ tường minh và control duy nhất đã được quan sát/policy cho phép, rules chọn control trực tiếp thay vì gọi Qwen.

Telemetry có tổng thời gian, lập mục tiêu, khởi tạo Session, quan sát, reasoning, execution, verification và chờ hỗ trợ. Một số trường lồng nhau: observation/verification có thể nằm trong execution, không cộng tất cả thành tổng. Không có benchmark đối chứng cùng trạng thái ban đầu để khẳng định mức tăng tốc phần trăm. Độ trễ YouTube vẫn chưa đạt yêu cầu sử dụng thực tế.

## Xác Minh Offline

- 215/215 regression tests PASS, bao gồm 8 bài kiểm tra trực tiếp luồng goal/hỗ trợ/API mới.
- TypeScript `--noEmit` và ESLint phạm vi sửa được chạy riêng; không coi đây là production build hoặc API end-to-end trên Android.
- API hỗ trợ kiểm tra origin, strict payload, evidence binding, cancel, timeout và replay bằng Web Request thật trong tiến trình test, không gọi Appium/ADB.
- Dashboard không có thiết bị: số lượng thực tế bằng 0, lựa chọn điện thoại rỗng, Chạy Agent bị disabled; kiểm tra desktop 1440 x 900 và mobile 390 x 844.
- CSS trước đó thiếu một số utilities khi quét nguồn tự động, gây sidebar chồng lên header. Khai báo nguồn app/components tường minh sửa được hiện tượng trong ảnh và DOM thực tế.

```powershell
node.exe node_modules/typescript/bin/tsc --noEmit
node.exe --test --test-reporter=spec --test-concurrency=1 tests/android-executor.test.cjs tests/state-observer.test.cjs tests/ui-exploration.test.cjs tests/milestone25-resolution.test.cjs tests/visual-grounding.test.cjs tests/agent.test.cjs tests/agent-reasoning.test.cjs tests/action-candidates.test.cjs tests/multi-candidates.test.cjs tests/browser-title-evidence.test.cjs tests/autonomous-task.test.cjs tests/dashboard-live-device-selection.test.cjs
```

Không chạy các file `*.integration.cjs` cần thiết bị để lấy bằng chứng trong lượt offline. Dữ liệu hàng đợi/log demo cũ còn trên Dashboard không phải kết quả Agent hay bằng chứng thiết bị đã chạy.

## File Chính

- `lib/android/agent/goal-planner.ts`, `navigation-semantics.ts`, `decision-engine.ts`: hiểu kết quả yêu cầu, phân biệt lưu trữ/RAM, chọn control có chứng cứ.
- `lib/android/agent/agent-loop.ts`, `human-assistance.ts`, `memory.ts`, `schema.ts`, `budget.ts`: pause/resume, cleanup, token, lỗi gốc và đo thời gian.
- `app/api/agent/route.ts`, `app/api/agent/assistance/route.ts`: stream tác vụ và xác nhận/Hủy.
- `components/commands/AgentGoalPanel.tsx`, `app/globals.css`: chọn vùng ảnh, trạng thái, evidence, bố cục.
- `lib/android/condition-executor.ts`, `exploration/ui-explorer.ts`, `security-policy.ts`: revalidation, điều kiện cuộn và phạm vi đọc an toàn.
- `tests/autonomous-task.test.cjs`, `tests/ui-exploration.test.cjs`: hồi quy liên quan trực tiếp.

## Bằng Chứng

Ảnh `autonomous-storage-dashboard.png`, `autonomous-cancel-dashboard.png`, `autonomous-youtube-blocked-dashboard.png` thuộc lượt thiết bị trước đó. Ảnh `autonomous-offline-desktop.png`, `autonomous-offline-mobile.png` thuộc lượt offline, không phải bằng chứng hoàn thành Android. Các ảnh chỉ lưu local; cần kiểm tra nội dung trước khi chia sẻ hoặc đưa lên Git.

**Chưa đạt toàn bộ nghiệm thu Autonomous V1:** Chrome và Settings có bằng chứng Dashboard thật trước đó; YouTube và resume bằng hỗ trợ người dùng vẫn cần nghiệm thu thiết bị. Bản cuối đã được kiểm tra offline, không thay thế kiểm thử lại Android thật.
