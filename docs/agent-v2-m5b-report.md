# Phone Commander M5b: ngôn ngữ tự nhiên và quyền thực thi

Ngày kiểm thử: 21/10/2026. Branch `DuyTD`. Không commit/push. Giữ nguyên các thay đổi có sẵn; báo cáo này chỉ mô tả phần M5b, không nhận toàn bộ working tree là thay đổi mới.

## 1. Phạm vi và nguồn dữ liệu

- Đã đọc source, M5, full-system audit và M4e trước khi sửa. Không mở/import sealed material, không tìm khóa, không sửa cohort user-authored M5.
- U01/U02 cũ chỉ còn là **DEVELOPMENT regressions**. Bộ mới `tests/fixtures/m5b-development.cjs` do coding agent viết để phát triển: 65 câu, không phải held-out độc lập.
- Nhãn bằng chứng: **OFFLINE_TESTED** = kiểm thử mô phỏng; **REAL_MODEL_SIMULATED_UI** = Qwen thật với catalog giả lập, không Android/grant; **REAL_ANDROID** = Samsung thật; **UNVERIFIED** = chưa nghiệm thu; **NOT_IMPLEMENTED** = chưa triển khai.
- V1 mặc định/V2 opt-in giữ nguyên. Model mặc định vẫn `qwen2.5:3b-instruct`, provider local Ollama; không bật cloud. Không thay TTL/context/output budget, grant policy, full-control journal, inverse restoration hoặc verifier để làm test qua.

## 2. Root Cause Được Báo Trước Khi Sửa

1. `source-slots.ts`/`outcome-spec.ts` chưa tách được enter-app-search không có liên từ quen thuộc; `vào` chưa nằm trong đường diễn giải đã biết. Vì vậy qualifier app và SEARCH bị gộp, bỏ mất LAUNCH.
2. `source-value.ts` xử lý courtesy hẹp và chủ yếu cuối câu; `giúp mình tài liệu tên` bị coi là dữ liệu. Sửa bằng bảng từ và giới hạn span nguyên văn, không bằng literal U01.
3. Catalog package không đồng nghĩa launcher display name. Không có label nguồn từ thiết bị thì suy từ token package/tên thương hiệu dễ chọn sai app.
4. Legacy interpret/executions thiếu ranh giới Origin nhất quán, source gốc không gắn với plan/quyền thiết bị. Development preference toàn cục không phải authorization theo thiết bị; V2 owner mode không tự bảo vệ route cũ.

## 3. Thay Đổi Tổng Quát

### Ngôn ngữ và catalog

- `natural-phrasing.ts`: bảng VN/EN courtesy/enter/search/descriptor; cắt cả hai biên giá trị, giữ span nguồn, quote và negation. Descriptor chỉ bỏ khi có cấu trúc introducer, không bỏ noun tùy ý.
- `source-value.ts`, `source-slots.ts`, `outcome-spec.ts`, `primitive-decomposition.ts`: tách compound, giữ app/value/dependency; bảo vệ app spans khỏi trùng động từ; phân biệt từ nằm trong data với mutation verb. Không mở rộng primitive execution catalog.
- `reviewed-phrasing.ts`: proposal chỉ chọn ID backend; kiểm exact/normalized installed label, unknown/ambiguous -> clarification. Không cho model tạo package/selector/command/grant/evidence.
- `launcher-labels.ts`, `app-catalog.ts`: đọc package-proven APK resources bằng SDK `aapt2` có sẵn và `adb pull` tới TEMP máy tính; không cài helper. Exact activity label được ưu tiên; alias thiếu label dùng application-label resources cùng package. Cache có hạn và budget scan 60 giây; danh mục có thể chưa đầy đủ.
- `agent-v2.ts`: giữ review đầy đủ `OPEN_APP: ...; SEARCH: ...`, yêu cầu human approval đúng cả hai bước và exact value. Không chuyển mọi câu quen thuộc sang review mới hoặc bỏ validation cũ.

Không hardcode Drive/YouTube/Samsung/package/tên query trong runtime. Catalog thực tế cung cấp **Drive**, không phải thương hiệu **Google Drive**. U01 với label giả lập Google Drive là regression offline; Android dùng biến thể Drive đã được người dùng duyệt. Chưa chứng minh literal Google Drive được alias đúng trên máy này; không đoán alias để báo PASS.

### Backend authorization

- `safety-envelope.ts`: shared source/action/observed-control exclusions trước effect; bảo vệ quotes như data, giữ chặn destructive/security/external effects ở dispatch.
- `action-plan-authorization.ts`: vé opaque backend cấp sau interpret, bind source nguyên văn + serialized plan + serial + physical identity, TTL 120 giây, một lần dùng. Expiry/replay/source/plan/cross-device/physical mismatch fail closed.
- `commands/interpret`, `executions`, `agent`, `agent/runtime`, `agent/assistance`: same-loopback-origin/Host/JSON và strict request schema; client không tự gán source/approval/full-control. Interpret không có device chỉ trả plan, không có execution ticket.
- `hooks/useDashboardDemo.ts`: giữ và gửi vé cùng source gốc/selected device. Re-analysis xóa vé cũ. Nối `request.signal` vào interpret cancellation.
- `device-runtime.ts`, V1 planner/loop, ConditionExecutor và ADB execution context: dùng shared guard; không chỉ bảo vệ route V2. Legacy gọi policy strict, không lấy global development preference làm quyền effect.
- Wi-Fi legacy giữ confirmation trong normal mode; development chỉ bỏ **xác nhận thứ hai** sau vé source/plan/device hợp lệ. Executor vẫn cần bounded Wi-Fi confirmation accounting. Không thử đổi Wi-Fi thật trong lượt này.
- Worker health/client thêm feature `source-policy-v2` và runtime digest: START/enable-owner từ worker source cũ bị chặn. Cancel/revoke vẫn được phép để cleanup. Không tự kill Session đang hoạt động.

Lưu ý: helper policy development cũ còn giữ output tương thích ở nơi chỉ phân loại; **không được dùng làm dispatch authorization**. Vé process-local không phải identity đăng nhập và chưa là shared store cho multi-process deployment. Origin chống browser cross-origin không chống chương trình độc hại đã có quyền trên máy.

## 4. Security Matrix

Tất cả probe nguy hiểm dùng fixture/offline, không thử trên Android thật.

| Đường kiểm tra | Bằng chứng và invariant |
| --- | --- |
| V1/V2 runtime | 8 nhóm destructive/overwrite/uninstall/clear/reset/password/purchase/replace; V2 owner full-control bật. BLOCKED trước reserve/plan/open, effect counter = 0. |
| Direct V1 planner | Cùng 8 nhóm bị từ chối trước model/discovery. |
| Action Plan + interpret | Source nguy hiểm dù plan giả là OPEN_APP vẫn bị chặn trước ADB; extra source/owner/fullControl/approved bị strict schema từ chối. |
| Dashboard 5 POST boundaries | Missing Origin, foreign Origin, non-JSON bị 403 trước dispatch. |
| Worker HTTP | Bearer thật của worker fixture; owner không vượt hard-block, source spoof không parse, quyền A không dùng cho B; zero effects. |
| Vé legacy | Unit tests source/plan/serial/physical mismatch, expired và replay; không mở execution. |
| Observed controls/ADB/Appium | Shared action guard + observed-control guard. Regression offline, không phải proof mọi cách diễn đạt nguy hiểm đều được nhận diện. |

Các assertion hiện có không bị nới. Hai test route cũ chỉ cập nhật request setup có Origin/content-type và source/physical-bound ticket hợp lệ. Không đổi expected rejection/confirmation/isolation để che lỗi.

## 5. Kết Quả Model Và Byte/Token

**REAL_MODEL_SIMULATED_UI**, cùng bộ DEVELOPMENT 65 câu, catalog giả lập, không Android/grant; một lần mỗi condition, không best-of hoặc rerun. SHA-256 fixture trước/sau và sau từng row đều khớp:
`7643138b3f67f5c141f0009a13c84cb927b43bac50325b6e93f413b37187386e`.
Runtime trước/sau và sau từng row khớp freeze ở mục 6.

| Condition | Faithful positive | Rejected positive | Negative không được chấp nhận | False accept | Calls / task không gọi model |
| --- | ---: | ---: | ---: | ---: | ---: |
| Default pipeline, singleton skips bật | 43/43 (100%) | 0/43 | 22/22 | 0/65 | 3 / 62 |
| Forced-model diagnostic, không phải default | 41/43 (95,35%) | 2/43 | 22/22 | 0/65 | 70 / 14 |

95% Wilson cho fidelity: 43/43 khoảng 91,8–100%; 41/43 khoảng 84,5–98,7%. Zero false-accept ở 22 negative không chứng minh xác suất thật bằng 0 (Wilson upper khoảng 14,9%). Không suy tỷ lệ tổng quát từ fixture DEVELOPMENT được dùng để sửa code.

Default có 68 singleton-clause skips; **toàn bộ 43 positive không gọi model**. Vì vậy fidelity 43/43 của default chủ yếu chứng minh parser/rules/guards, không chứng minh Qwen hiểu tất cả. Forced pass bỏ deterministic skip nhưng giữ nguyên source validation/schema/app resolution, không nới runtime. Mỗi call ghi provider `ollama`, model `qwen2.5:3b-instruct`; tổng 73 measured calls, không cloud.

22 negative mỗi condition gồm 13 HARD_BLOCKED, 7 NEEDS_CLARIFICATION rõ ràng, 2 internal validation rejections (`KNOWN_OUTCOME_CHANGED`, `SOURCE_SLOT_UNKNOWN_FOREIGN_OR_AMBIGUOUS`). Hai loại cuối an toàn vì không sinh effect nhưng **chưa phải clarification UX chuẩn**. Không có negative được tính đạt nhờ TIMEOUT. Refusal do backend guard không được gán là model tự suy luận.

| Latency, nearest-rank percentile | Default | Forced diagnostic |
| --- | ---: | ---: |
| Task median / p95 | 3,05 / 104,94 ms | 8.230,19 / 20.691,01 ms |
| Task max, giữ cả outlier | 39.104,76 ms | 6.127.191,12 ms |
| Model-call median / p95 | 9.745 / 39.063 ms | 7.793 / 12.374 ms |
| Model-call max | 39.063 ms | 6.115.820 ms |

Default percentile rất thấp vì 62/65 task không gọi AI, không được quảng cáo là tốc độ suy luận model.

Hai rejected positive ở forced pass:

- C10: call thứ hai TIMEOUT, tổng 6.127.191 ms (~102 phút), dù scheduler deadline 45 s. Chuỗi lấy mẫu process cũng có gap **6.193.500 ms**. Không đủ dữ liệu phân biệt host suspend, timer/event-loop stall hay lỗi dịch vụ. Giữ raw measurement, **không quy thành model trả lời sai**, không loại outlier, không rerun.
- C11: TIMEOUT 46.141 ms/call, task 47.367,79 ms. Không có proposal được phép chạy.

Ollama aggregate working set lớn nhất **đã lấy mẫu**: 2.001.711.104 byte (~1,86 GiB), 170 samples, nominal interval 3 s, gồm các process Ollama/runner được phát hiện. Không phải GPU VRAM, không phải riêng một model; vì gap rất dài, **peak toàn khoảng benchmark UNVERIFIED**. Không dùng lifetime peak làm số đo benchmark.

### UTF-8 bytes và tokens

40 completed model calls của request có dấu ghi nhận `prompt_eval_count` thật: min/median/max **103/108/129 tokens**. Byte upper-bound tương ứng **712/750/903 byte**; upper-bound bao gồm system/content/schema, không đồng nhất với cách Ollama tính prompt tokens. Không đổi 1 byte thành 1 token hoặc suy tuyến tính cho câu dài từ mẫu này.

Guard hiện tại **1536 byte** trong budget context 2048, output 256 và framing reserve 256 vẫn giữ nguyên. Boundary tests 1535/1536/1537 byte, cả ASCII/diacritics, chứng minh vượt guard thì zero fetch; đây là **OFFLINE_TESTED**, không đo sát context bằng model thật. Không tăng num_ctx/num_predict.

Đề xuất an toàn tiếp theo: tokenizer đúng model và chat template để preflight toàn prompt, giữ byte cap phòng resource abuse và output/framing reserve; bounded semantic context rồi kiểm lại coverage. Khi chưa có tokenizer/framing proof, giữ guard hiện tại dù có false rejection, không dùng tỷ lệ bytes/token trung bình để nới quyền/context.

## 6. Nghiệm Thu Android DEVELOPMENT

Freeze sorted `lib/android/**/*.ts` theo helper runtime digest:
`d961426a9130cddf52fd46cc27bd146ac752c3de69457bd07f4f445ecaf490e2`.
Đối chiếu sau từng task: khớp. Một Samsung A50s `R58MA78W6QK`, mở khóa, hai task tuần tự, không concurrent Session. Người dùng đã duyệt exact interpretation cho từng bài; runner chỉ forward khi cả summary khớp và token còn hạn.

| Bài | Kết quả thật | Tổng / planning / Session | RPC / ADB |
| --- | --- | --- | --- |
| Drive: `Vào Drive tìm giúp mình tài liệu tên báo cáo thực tập` | **REAL_ANDROID, COMPLETED**, hai node VERIFIED. Query exact, NO_RESULTS. Screenshot thấy query và “Không có kết quả phù hợp”; native resumed activity thuộc Drive. Không mở tài liệu. | 177,784 / 137,966 / 8,930 s | 96 / 163 |
| YouTube: `Ghé YouTube để tìm giúp mình hải dương học nhé` | Backend **COMPLETED** sau 180,496 s, RESULTS/SEARCH_COMPLETED; screenshot/native xác minh search thật. **Runner exit 1** do deadline 180 s, gửi CANCEL trong race với completion. Không đổi trạng thái cũ, không rerun; harness deadline FAIL, outcome thật verified. | 180,496 / 131,592 / 8,465 s | 108 / 165 |

YouTube screenshot có preview tự phát **trong danh sách kết quả**, không phải watch-page: query ở trên, nhiều result cards và bottom navigation. Trace kết thúc IME_SEARCH/verify, không click result. Không tuyên bố video playback đã nghiệm thu.

Drive: observation 17,448 s, execution 20,729 s, verification 0,188 s, assistance 0,589 s; YouTube tương ứng 23,858 / 21,831 / 0,443 / 0,389 s. Đây là các span lồng nhau/có thể overlap, **không cộng thành total**. ADB/RPC counters chỉ trong profiler, không gồm mọi probe screenshot bên ngoài runner. Cả hai có **0 model call**, 2 singleton-clause skips và 3 singleton-candidate skips; `MODEL_REVIEWED` trong analysis không phải bằng chứng có LLM inference.

Độ trễ chính nằm ở planning/catalog discovery, không phải Qwen ở hai bài này. Recon catalog 37 launcher entries, scan budget chỉ thu được 18 labels trong ~60,57 s; fallback application resources giải quyết alias label rỗng nhưng APK pull vẫn tốn thời gian. Không cache bỏ identity/freshness để che chậm. Tối ưu catalog metadata incremental là việc tiếp theo, chưa được thực hiện sau freeze.

Sau runner `finally`: 0 active tasks, 0 owner modes; đọc timeouts hai Session trả 404 `invalid session id`. Không có reset/delete/install/Bluetooth/setting mutation. Đây là kiểm thử qua API/worker của Dashboard, **không phải browser-click acceptance mới**.

## 7. Validation

Child-process wrapper chạy tuần tự bằng Node binary thực, lấy `close(exitCode, signal)` từng process, không tin outer PowerShell exit. Không thay bundler config. Validation cuối trên đúng frozen source:

| Kiểm tra | Kết quả / thời gian |
| --- | --- |
| Full regression | **680/680 PASS**, 0 fail/cancel/skip; child exit 0, 61,970 s. Baseline audit 577; M5b thêm 103 test, gồm 65 phrasing cases và guards/provenance/security. |
| TypeScript `--noEmit --incremental false` | PASS, exit 0, 26,438 s. |
| Scoped ESLint, 31 file M5b TS/CJS | PASS, exit 0, 23,264 s. |
| Full ESLint | FAIL, exit 1, 17,089 s: lỗi cũ `components/executions/ExecutionDetailModal.tsx:130:98` (`no-explicit-any`) và 9 unused warnings. Không sửa unrelated source. |
| `next build --webpack` | **PASS**, child exit 0, 143,557 s. Còn dynamic dependency warning ở session-manager/createRequire; không chứng minh packaged production worker chạy khi prune TypeScript. |
| Default `next build` | **FAIL**, child exit 1, 14,457 s: Turbopack CSS child process thoát trước khi kết nối, code 0 của child; build vẫn exit 1. Cùng failure signature audit cũ, chưa có root cause được chứng minh. |
| `git diff --check` | PASS, exit 0. Git cảnh báo LF/CRLF, không whitespace error. Kiểm tra riêng file M5b untracked được ghi ở bằng chứng cuối. |

Failure trung gian được giữ lại: lần đầu 666/678 PASS; một full run bị chủ động dừng sau ~290,768 s do test cũ bị ép chờ review mới; tiếp đó 679/680 PASS do English `and do a dance` không còn bị xem là unresolved compound. Sửa implementation/source boundary và setup transport/ticket, không nới assertion. Lượt cuối 680/680 chạy lại đầy đủ sau sửa; không thay số cũ bằng PASS. Targeted trước lượt cuối có 115/115 PASS.

Secret scan cuối **PASS**, exit 0: 884 file / 139.196.912 byte, 0 match; gồm source, compiled JS/maps/HTML trong build và bằng chứng M5b TEMP. So exact configured secrets và common key formats, không in giá trị. Exclude env files/dependencies/.git/sealed/binary screenshots/unrelated TEMP; cap 10 MB/file (0 file bị cap), không quét được tool transcripts. Đây không phải proof tuyệt đối mọi loại secret đều vắng mặt.

Lần scan đầu phát hiện key-like strings trong **hai native dumpsys TEMP do chính lượt này tạo**, mỗi file 2 matches, **0 match configured keys**; chưa đủ để gọi đó là credential bí mật của người dùng. Đã redact cơ học đúng chuỗi match, giữ activity evidence; scan lại sạch. Không đưa raw native diagnostics vào Git. Không xóa/sửa dữ liệu Android hoặc source để xử lý finding này. Giữ scan FAIL đầu và redaction manifest để audit, không nhận là chưa từng có finding.

Kiểm tra cuối: API HTTP 200, runtime hash khớp freeze, **0 active tasks / 0 owner modes / 0 running / 0 waiting inference**; 10 file M5b mới không có trailing whitespace. Không commit/push.

## 8. Audit Items Còn Lại

- **P1 F01**: hardening source/origin/device/effect paths đã triển khai và test offline; chưa chứng minh classifier an toàn với mọi paraphrase hoặc browser exploit thực. Vé local còn hạn chế deployment nhiều process.
- **P1 F02**: sửa các root cause phrasing/app/value/compound cụ thể theo abstraction. Reference resolution/semantic intent tổng quát vẫn chưa được bảo đảm; bộ DEVELOPMENT không phải benchmark tổng quát.
- **P1 F03**: worker runtime vẫn require TypeScript devDependency; chưa sửa packaging vì ngoài scope, chưa nghiệm thu prune-devDependencies.
- **P1 F04**: chưa sửa nguyên nhân build Turbopack; ghi kết quả build mới ở mục 7, không đổi bundler config.
- **P2 F05**: START stale worker đã có hash/feature gate; idle drain/restart tự động chưa triển khai. Vận hành phải refresh worker idle, không giết task đang chạy.
- **P2 F06**: chưa giải quyết context bị co trong compatible reasoner; byte budget giữ nguyên, token metrics không biến thành bypass.
- **P2 F07/F08**: generic field/record/selection/vision/recovery contracts thiếu vẫn giữ nguyên; không thêm workflow/capability để qua test.
- **P2 F09**: cancellation propagation interpret đã sửa; legacy partial outcome omission/coverage toàn ngữ nghĩa chưa có proof tổng quát.
- **P2 F10/F11**: revoke/inverse cleanup risk và heavy polling/history chưa sửa để tránh đổi full-control policy/journals trong lượt này.
- **P3 F12**: full-lint/deployment warnings ghi riêng; không sửa unrelated modal.
- **P2 mới**: display-label discovery partial/chậm, thiếu SDK hoặc alias label không đọc được dẫn clarification; deadline harness có thể race completion như YouTube.

## 9. Điều Này Chứng Minh Và Không Chứng Minh

Có bằng chứng giữ đúng app và exact search value cho các dạng courtesy/descriptor/compound mới, chặn source nguy hiểm nhất quán hơn, và hai query thật trên hai app. Chưa chứng minh Agent tự hiểu mọi app mới, tự tạo workflow/verifier mới, hoặc suy luận tổng quát tốt: phần lớn success có thể hoàn toàn do rules và deterministic skips. Việc chặn đúng là thuộc policy/validator, không mặc nhiên là “AI hiểu nguy hiểm”.

Không biến FAILED/BLOCKED cũ thành SUCCESS, không tuning sealed/held-out, không dùng mock PASS thay cho Android/LLM thật. Chưa nghiệm thu lại toàn bộ UI Human Assistance hoặc mutation/journal/recovery.

## 10. Bằng Chứng Cục Bộ

Trong `C:\Users\TRANDU~1\AppData\Local\Temp` (không commit; TEMP có thể bị dọn):

- `agent-v2-m5b-android-freeze-1792548016261.json`.
- `v2-acceptance-cd634dce-37c5-4d69-a5b6-37cfda8354d8.json`.
- `agent-v2-m5b-drive-observation-1792548379208.png` / `.txt`.
- `agent-v2-m5b-youtube-observation-1792548631854.json` / `.png` / `.txt`, task `2ab97a90-e6ef-4181-affb-48e21647a75d`.
- `agent-v2-m5b-labels-1792547637430.json`: actual resource labels, partial scan.
- `agent-v2-m5b-model-1792548673681.json`: 130 raw rows, provider/call/token/timing và memory samples; `agent-v2-m5b-model-summary-1792556343036.json` giữ cả outlier.
- `agent-v2-m5b-validation-complete-1792556566434.json` và sáu log cùng prefix: true child exit của regression/TS/scoped lint/full lint/Webpack/Turbopack.
- `agent-v2-m5b-regression-1792546572948.*`, `agent-v2-m5b-validation-1792547213483.json`, `agent-v2-m5b-final-validation-1792547802564.*`: failure/interruption trung gian, không xóa.
- `agent-v2-m5b-secret-scan-1792557018243.json`: finding ban đầu chỉ ghi paths, không key; `agent-v2-m5b-native-redaction-1792557173631.json`; `agent-v2-m5b-secret-scan-final-1792557280787.json`: scan lại sạch.
- `agent-v2-m5b-final-1792557236795.json`: freeze, zero-active/owner/queue và whitespace check cuối.
