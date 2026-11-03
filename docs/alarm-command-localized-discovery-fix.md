# Alarm Command And Localized Discovery Fix

Ngày: 23/10/2026. Branch `DuyTD`. Không commit/push.

## Triệu chứng và root causes

Câu thực tế: `Mở đồng hồ, cài báo thức 6:30 sáng`. Dashboard trả `ASK: application or capability handler is missing or ambiguous.`

1. **VERIFIED_IN_SOURCE / OFFLINE_TESTED:** grammar chỉ nhận các động từ như `đặt/tạo/set`, chưa nhận `cài/cài đặt báo thức`. Clause splitter không tách phần sau dấu phẩy; graph sai thành một LAUNCH với app `đồng hồ, cài báo thức 6:30 sáng`, coverage COMPLETE. Đây không phải lỗi quyền và không cần sửa tên ứng dụng Android để khắc phục.
2. **REAL_ANDROID, chỉ đọc:** sau khi sửa grammar, handler ALARM được xác định nhưng LAUNCH vẫn không tìm được nhãn tiếng Việt. AAPT của APK thật trả `application-label:'Clock'`, `application-label-vi:'Đồng hồ'` và launchable activity label `Clock`. `launcherLabelsFromBadging` trả sớm `[Clock]`, làm mất localized aliases. API vẫn 409 sau riêng bản sửa grammar; giữ evidence failure, không đổi thành PASS.

## Thay đổi

- `lib/android/agent/temporal-contract.ts`: nhận synonym tạo báo thức `cài/cài đặt`, có dấu/không dấu; vẫn dùng typed ALARM contract, validation giờ/phút, AM/PM và timezone hiện có.
- `lib/android/agent/outcome-spec.ts`: tách clause `cài [đặt] báo thức` thành outcome riêng, giữ span/source/dependencies; legacy coverage không được bỏ qua clause này và báo launch-only hoàn tất.
- `lib/android/agent/launcher-labels.ts`: giữ localized application labels khi verified activity dùng cùng default application label. Activity có nhãn riêng vẫn giữ nhãn riêng, không nhận translations của package khác nghĩa. Không thêm alias/package Samsung vào runtime.
- `lib/android/agent/launcher-label-cache.ts`: cache schema/path v2 để kết quả extractor cũ không tiếp tục che nhãn địa phương. V1 bị bỏ qua, không xóa file cache cũ; không thay user data/history/API schema.
- Thêm `tests/temporal-command-boundary.test.cjs` (13 tests) và `tests/launcher-localized-labels.test.cjs` (7 tests); đã quan sát RED trước sửa, GREEN sau sửa. Không chỉnh test cũ.

Permission, grants, journal, Session/identity, replay, unknown-effect và independent outcome verification không thay đổi. Không sửa provider/model hoặc bật quyền tự động. Không đọc sealed/holdout cohort.

## Validation

| Kiểm tra | Kết quả |
|---|---|
| Tests mới | 20/20 PASS, OFFLINE_TESTED |
| Targeted temporal + M6b/M7a/router trước bản sửa labels | 97/97 PASS |
| Targeted labels + command boundary + M5b | 103/103 PASS |
| Regression cuối trên source frozen, 64 file | 1143 PASS / 27 FAIL / 1170 tổng; không có thay đổi failure names hoặc pass counts của 62 test files cũ |
| TypeScript | PASS (`--noEmit --incremental false`) |
| Scoped ESLint, 4 source + 2 tests | PASS |
| `git diff --check` | PASS |
| Production build / full lint lượt này | Không chạy lại; không dùng kết quả build lượt trước làm bằng chứng mới |

Regression loại `general-agent-v2-open-world.test.cjs` (6 tests) để không chạy fixture có tên holdout, cùng phạm vi baseline. 27 failures có sẵn từ baseline: 10 atomic-rename EPERM; 5 mock worker HTTP fetch failures; 12 Groq router mock transport failures. Không có real Groq request trong lượt này; không tuyên bố full regression xanh. Evidence cuối xác nhận sáu file source/test không đổi trong lượt regression.

## Nghiệm thu Chỉ Phân Tích

- Samsung USB `R58MA78W6QK` online. `cmd package resolve-activity` xác nhận handler ALARM trong ứng dụng Đồng hồ đã cài.
- Đọc resource APK thật và làm mới nhãn qua reader/cache hiện có, có fresh device/package checks. Kết quả gồm cả `Clock` và `Đồng hồ`; chỉ đọc Android, không mở ứng dụng.
- Worker được đóng bằng `/shutdown` body rỗng khi không có tasks/inference, sau đó khởi động lại với cấu hình hiện có. Không force kill.
- Qua **Unified HTTP API**, không phải browser acceptance: ANALYZE đúng câu trong ảnh, ép V2, trả **HTTP 200** với engine **V2**, steps `Mở đồng hồ` và `cài báo thức 6:30 sáng`.
- Analysis wall time **61.757 ms**, bao gồm cold cache discovery sau đổi extractor. ADB **65** (discovery/read/pull), Appium RPC **0**, model calls **0**, execution steps **0**. Đây là rules/typed-contract path; không phải bằng chứng Groq đã được gọi hay AI tự suy luận thành công. Không cộng các timing spans chồng lấn.
- Cuối lượt kiểm tra: active tasks **0**, owner modes **0**, không gửi EXECUTE. **Không tạo báo thức mới**, không xác nhận end-to-end alarm persistence. Execution/readback trên app thật vẫn **UNVERIFIED** trong lượt này.

Cold cache có thể làm lần phân tích đầu chậm; chưa tối ưu performance trong bản sửa này. Việc phân tích PASS không bảo đảm thao tác tạo/lưu báo thức sẽ PASS nếu UI không cung cấp đủ independent evidence.

## Evidence

Thư mục ignored cục bộ: `coverage/temporal-boundary-fix-cjM6GS/`.

- `android-analysis.json`: 409 sau riêng grammar fix, trước localized-label fix.
- `real-label-readback.json`: labels lấy từ installed APK qua reader hiện có.
- `android-analysis-final.json`: HTTP 200 và full metrics của ANALYZE sau hai sửa.
- `localized-targeted.log`: 103 tests PASS.
- `validated/regression.json`, `validated/*.test.cjs.log`, `validated/validation.json`: regression cuối, hash freeze, typecheck/lint/diff check.

Không dùng API analysis như bằng chứng thực thi Android hoặc browser PASS. Người dùng cần Phân tích lại để nhận plan reference mới; không sử dụng reference trước khi restart/sửa source.
