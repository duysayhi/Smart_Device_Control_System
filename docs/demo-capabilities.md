# Phone Commander: danh mục demo sau phần B, chưa nghiệm thu

Ngày 26/10/2026, branch `DuyTD`. **Unified một đường V2 theo catalog: OFFLINE_TESTED.** Full regression **1358 PASS / 0 FAIL / 6 TODO**, B5 **68/68 PASS**. TypeScript và scoped ESLint PASS; full ESLint 0 lỗi / 4 warning. Production webpack build chạy đúng một lần: compile/typecheck/static generation xong nhưng **exit 1 SecurityFatalError**, không tính là build PASS. Chi tiết ở mục 22 của `engine-merge-report.md`. Chưa nghiệm thu Dashboard bằng trình duyệt hoặc Android mới; không dùng tài liệu này như chứng nhận production hay quyền thực thi tác vụ ghi dữ liệu chưa được chủ thiết bị cho phép.

## Phạm vi bằng chứng

Các câu dưới đã đi qua hàm POST thật của `/api/unified-agent`, với worker/adapter giả, compiler thật, fetch fail-on-call. Đây là **ANALYZE OFFLINE_TESTED**, không phải worker thật, Android thật, inference hay tương tác trình duyệt. Không có model call, ADB, Appium hoặc Session thật. Catalog ENABLED chỉ là admission, không phải grant hay bảo đảm COMPLETED.

Nguồn hiện tại: `coverage/engine-merge-b-final-QNztNa/full-regression.log`, test `tests/engine-merge-single-path.test.cjs`. Các failure và probe trước sửa giữ ở các thư mục B2/B3 (`engine-merge-b2-TjT5xo`, `engine-merge-b3-ixPuep`), không bị ghi đè. Pin/Wi-Fi có thêm bằng chứng **lịch sử** ngày 25/10 ở mục 18 của báo cáo, không phải lần chạy lại trên source B.

## Những câu đã ANALYZE được

Mỗi plan thành công chỉ chọn **V2**, không tự chuyển engine. Các câu tiếng Việt giữ nguyên dấu trong test; ba câu setting typed cuối bảng cố ý dùng cú pháp đã kiểm tra, không dịch thành biến thể chưa hỗ trợ.

| Câu | Khả năng | Catalog | Nhãn bằng chứng | Outcome mong đợi nếu được phép EXECUTE |
|---|---|---|---|---|
| Mở YouTube | OPEN_APP | ENABLED | ANALYZE OFFLINE_TESTED | App foreground được xác minh |
| Mở Cài đặt | OPEN_SETTINGS | ENABLED | ANALYZE OFFLINE_TESTED | Trang Settings được xác minh |
| Cho mình xem pin còn bao nhiêu | READ_STATE | ENABLED | ANALYZE OFFLINE_TESTED; REAL_ANDROID_VERIFIED lịch sử 25/10 | Hai đường đọc pin độc lập khớp |
| Cho mình biết Wi-Fi đang bật hay tắt | READ_STATE | ENABLED | ANALYZE OFFLINE_TESTED; REAL_ANDROID_VERIFIED lịch sử 25/10 | Hai đường đọc Wi-Fi độc lập khớp |
| Xem độ sáng | READ_STATE | ENABLED | ANALYZE OFFLINE_TESTED; Android mới UNVERIFIED | Readback độ sáng đủ bằng chứng |
| Mở Camera và chụp 1 tấm ảnh | CAMERA | ENABLED | ANALYZE OFFLINE_TESTED; Android B UNVERIFIED | Đúng một ảnh mới, independent artifact evidence |
| Mở bàn phím quay số 5550100 | DIAL_PREFILL | ENABLED | ANALYZE OFFLINE_TESTED; Android B UNVERIFIED | Điền đúng số, tuyệt đối không gọi |
| Mở máy tính và tính 125 * 48 | CALCULATE | ENABLED | ANALYZE OFFLINE_TESTED; Android B UNVERIFIED | Kết quả 6000 được đọc lại |
| Mở Drive và tìm báo cáo thực tập | SEARCH | ENABLED | ANALYZE OFFLINE_TESTED; Android B UNVERIFIED | Đúng query và trạng thái kết quả; không mở kết quả |
| Mở YouTube và tìm hải dương học | SEARCH | ENABLED | ANALYZE OFFLINE_TESTED; Android B UNVERIFIED | Đúng query và trạng thái kết quả; không phát video |
| Mở My Files và tìm ocean | SEARCH | ENABLED | ANALYZE OFFLINE_TESTED; Android B UNVERIFIED | Đúng query và trạng thái kết quả; không mở file |
| Mở Chrome, tìm ocean và mở bài đầu tiên | BROWSER_FIRST | EXPERIMENTAL | ANALYZE OFFLINE_TESTED; Android UNVERIFIED; P1 PENDING | Engine phải chứng minh organic ordinal 1 và trang đích; chưa dùng làm demo đã nghiệm thu |
| Đặt báo thức 7 giờ sáng | ALARM | EXPERIMENTAL | ANALYZE OFFLINE_TESTED; Android UNVERIFIED | Báo thức mới 07:00 bật và persisted readback; thiếu bằng chứng phải BLOCKED |
| Hẹn giờ 2 phút | TIMER | EXPERIMENTAL | ANALYZE OFFLINE_TESTED; Android UNVERIFIED | RUNNING và hai lần đọc fresh có thời gian giảm |
| set wifi 0 | SET_STATE | ENABLED | ANALYZE OFFLINE_TESTED; fake execute/journal/readback/restore OFFLINE_TESTED | Full-control hợp lệ, readback độc lập và khôi phục chính xác; normal mode không có quyền ghi |
| set brightness 80 | SET_STATE | ENABLED | ANALYZE OFFLINE_TESTED; Android B UNVERIFIED | Original permission/journal/readback/restore phải đạt |
| set dnd 0 | SET_STATE | ENABLED | ANALYZE OFFLINE_TESTED; Android B UNVERIFIED | Original permission/journal/readback/restore phải đạt |

`Đặt báo thức 3:30` chỉ tạo câu hỏi sáng/chiều, chưa prepare/start. Chọn sáng tạo plan V2 EXPERIMENTAL mới; không cấp quyền bằng câu trả lời và không tái dùng plan cũ.

## Những câu bị từ chối

Các nhóm dưới có test route thật + fake worker chứng minh **0 context / prepare / start / Session / network**. Không chạy một phần câu có mục tiêu DISABLED hoặc bị cấm.

| Câu/nhóm | Mã/thông điệp |
|---|---|
| `ket noi wifi ten oreo` | CAPABILITY_DISABLED: Chưa hỗ trợ trong danh mục demo; kết nối Wi-Fi theo SSID |
| `tao record title "demo"`, `tao ghi chu ten "demo", noi dung "offline"` | CAPABILITY_DISABLED; ghi chú/tạo record |
| `open Gallery` | CAPABILITY_DISABLED; Gallery/tìm ảnh |
| `open url https://example.com`, `open Maps` | CAPABILITY_DISABLED; mở URL/Maps |
| `set bluetooth 1`, `set rotation 1`, `set media_volume 1`, `set ring_volume 1`, `set flashlight 1`, `set airplane 1` | CAPABILITY_DISABLED; setting ngoài danh mục |
| YouTube phát video thứ hai; Chrome mở bài thứ hai | CAPABILITY_DISABLED; ordinal/P2 chưa port |
| `please arrange everything` | NEEDS_CLARIFICATION: Yêu cầu ngoài danh mục hoặc chưa rõ nghĩa; hãy nêu rõ từng mục tiêu |
| `read battery; open Maps` | CAPABILITY_DISABLED cho toàn câu, không đọc pin trước |
| `capture photo then delete old photos` | HARD_DENY: yêu cầu chứa hành động bị cấm; không chụp trước |
| Input chứa `debugEngine`, kể cả `null` | HTTP 400 ENGINE_SELECTION_REMOVED, không gọi worker |

## Cách nói được hỗ trợ cho đổi cài đặt

Chỉ dùng cú pháp typed đã được kiểm tra: `set wifi 0`, `set brightness 80`, `set dnd 0`. ANALYZE trả SET_STATE ENABLED V2 và giữ nguyên source. Đây không phải grant: khi EXECUTE vẫn phải đủ full-control đúng thiết bị, binding, freshness, journal, readback độc lập và khôi phục theo chính sách gốc. Normal mode không được tự nâng quyền.

## Cách nói chưa hỗ trợ

`tắt wifi`, `đặt độ sáng 80`, `Đặt wifi 0`, `Đặt brightness 80`, `Đặt dnd 0`, các biến thể `chỉnh/bật/tắt` + setting chưa được nhận làm tác vụ typed. Catalog chỉ trả **HTTP 409 UNSUPPORTED_PHRASING**, với thông điệp:

> Chưa hỗ trợ cách diễn đạt này. Hãy dùng: set wifi 0 / set brightness 80 / set dnd 0

Không còn nhãn ghi chú/record cho các câu này. Không chuẩn hóa, viết lại hoặc tự thực thi source bằng cú pháp gợi ý. Toàn câu bị từ chối trước context/prepare/start/Session, kể cả `read battery; tắt wifi`. Câu có xóa/gỡ/ghi đè vẫn **HARD_DENY**, ưu tiên cao hơn nhãn mới; không thực hiện mệnh đề hợp lệ trước.

Gợi ý cú pháp không mở thêm quyền/capability: Bluetooth, âm lượng, xoay màn hình, đèn pin, chế độ máy bay vẫn DISABLED. Chrome chỉ tìm kiếm không có P1 first-result cũng không được suy ra là hỗ trợ từ bảng demo.

## Chuẩn bị khi được phép nghiệm thu sau

- Chủ thiết bị xác nhận đúng phạm vi và thiết bị; màn hình mở khóa vào hẳn ứng dụng/launcher, không vượt keyguard.
- Worker/Next dùng source hiện tại, idle; thiết bị identityVerified, đúng transport, Appium và package hỗ trợ sẵn sàng.
- Owner/full-control có scope thiết bị và hạn dùng đúng tác vụ; không tự bật mode hoặc chấp nhận consent/permission trên điện thoại.
- Luôn ANALYZE lại lấy reference mới khi source/device/mode đổi hoặc plan hết hạn; EXECUTE không nhận plan/grant do client tự sửa.
- Giữ independent verification, one-shot, cancellation và journal; không replay UNKNOWN_EFFECT, không coi SENT/BLOCKED là thành công.
- Không tự tạo/xóa ảnh, báo thức, timer hoặc dữ liệu khác để chuẩn bị demo. Lượt B này không thực hiện bất kỳ thao tác Android thật nào.

**Unified một đường V2 theo catalog (OFFLINE_TESTED); mã V1/Action Plan còn nguyên, chưa archive/xóa; chưa kiểm Dashboard bằng trình duyệt thật; P1 chưa nghiệm thu Android.** Legacy chỉ qua handler nội bộ; cách nói tự nhiên cho đổi cài đặt chưa hỗ trợ. Không có bằng chứng AI tự suy luận ứng dụng mới từ các test fake/markup này. Kết quả regression/TypeScript/lint/build và giới hạn môi trường được ghi riêng tại mục 22, không đổi nhãn UNVERIFIED của Android thành PASS.
