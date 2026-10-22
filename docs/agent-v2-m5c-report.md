# Phone Commander M5c: catalog cache và runner lifecycle

Ngày: 21/10/2026, timezone client Asia/Bangkok. Branch `DuyTD`. Không commit/push, giữ các thay đổi/untracked đã có. Đã đọc source, status, M5b, M5 và full-system audit trước triển khai.

## 1. Phạm Vi Và Provenance

**Không chạy held-out M5c:** `tests/holdout/user-tasks-v2.json` không tồn tại khi kiểm tra. Không tự tạo/thay file đó, không dùng lại cohort M5, không đọc/import sealed hoặc tìm khóa. Theo điều kiện của yêu cầu, chỉ thực hiện A/B và validation/báo cáo D; không chuyển sang feature khác.

Các lượt Drive/YouTube dưới đây là **REAL_ANDROID / DEVELOPMENT paired measurements**, không phải held-out. Người dùng xác nhận đúng hai câu lệnh, mỗi câu hai lần, search-only, không mở kết quả. Model mặc định giữ `qwen2.5:3b-instruct`, provider local Ollama/cloud OFF; V1 default/V2 opt-in giữ nguyên.

Nhãn: OFFLINE_TESTED = mô phỏng; REAL_MODEL_SIMULATED_UI = model thật/UI giả; REAL_ANDROID = thiết bị thật; NOT_IMPLEMENTED/UNVERIFIED = chưa triển khai/chưa chứng minh. Không có model benchmark mới hoặc cloud calls trong scope này.

## 2. Profile Đường Cũ

Chạy chính helper M5b trên 37 launcher entries, từng package để không bị batch budget 60 giây dừng âm thầm; không sửa source helper trong process đã load. Instrument host exec/ADB, ghi per-package query/pull/aapt2 và wall time. Không cài helper APK, không mở ứng dụng trong reconnaissance.

| Phần việc | Tổng quan sát |
| --- | ---: |
| `pm path` | 5.416 ms / 37 package |
| Pull APK | 85.072 ms |
| `aapt2 dump badging` | 23.732 ms |
| Launcher/verbose queries | 305 ms |
| Wall toàn scan | 115.939 ms |

36/37 entries có labels. Một entry không đọc được do `aapt2` timeout sau pull ~11,4 s; không suy label từ tên package. Phần chênh wall so tổng stage là lookup tool/temp/filesystem/parse và overhead, **không được gọi riêng là parse đã đo**. Profile mới có stage parse riêng.

Root cause của planning M5b 132–138 s: foreground scan bị chặn trên APK transfer/aapt2 và `AppCatalog.resolve()` lại gọi planningInventory, có thể lặp một scan partial khác. Cache cũ process-local theo serial/component/APK path có TTL 5 phút, không bền qua worker restart, không có package revision. Không phải Qwen chậm: hai task M5b có 0 model call.

### Nguồn Chỉ Đọc Rẻ Hơn

- `cmd package list packages --show-versioncode`: ~25.742 byte, 203,8 ms, nhưng không có update time/label đầy đủ.
- `dumpsys package packages`: ~1.697.870 byte, 221,9 ms trên Samsung. Dùng để lấy versionCode + lastUpdateTime **metadata**, không dùng làm nguồn label. Parser bỏ disabled system originals, thiếu/broken revision thì không nhận cache hit.
- Verbose `cmd package query-activities`: 87.455 byte, 61 trường nonLocalizedLabel, **61/61 null**. Không tái tạo được 36 label sets từ aapt2; **REJECTED làm label provider**, không gán null/resource ID thành tên app. Đây là đánh giá một nguồn thực tế, không khẳng định mọi phương pháp rẻ khác đều bất khả thi.

Đối chiếu cache sau đo với baseline: **36/36 label sets đọc được từ aapt2 giống nguyên vẹn**, 0 khác. Đây là equivalence của cache với nguồn resource cũ, không phải chấp nhận nguồn Package Manager null làm nguồn thay thế.

## 3. Cache Và Warmup Tổng Quát

`launcher-label-cache.ts` lưu `labels.json` trong OS TEMP `phone-commander-label-cache-v1`, ngoài repo:

- Key gồm physical identity, package, versionCode, update time nếu có, và launcher component (không gộp alias khác nhau). Mỗi lần dùng đọc fresh physical identity và package revisions; đổi version/time hoặc thiếu time so với entry cũ đều miss.
- Tối đa 500 entries, 8 thiết bị, 1 MiB. Schema/range validation; absent/corrupt/oversized file bỏ qua. Write unique TEMP sibling + atomic rename; không ghi JSON dở vào file chính.
- Chỉ cache display-name metadata, **không** cache grant, installed/launchable authority, foreground, readiness hoặc Session proof. `discoverApplication()` vẫn gọi Package Manager resolve-activity mới; execution vẫn dùng verified application và fresh observer/verifiers cũ.
- Entry chưa đọc được chỉ có negative backoff tối đa 5 phút cùng identity/revision; labels rỗng **không** thành tên app, không thành bằng chứng unique/permission. Khi hết backoff hoặc đổi revision sẽ thử lại.
- Cache hits được lấy trước; chỉ unresolved entries thực hiện APK work, có exact-package priority option từ backend. Không suy alias từ thương hiệu/package tokens. Unknown/ambiguous vẫn clarification; `Google Drive` không tự biến thành `Drive`.
- Sau scan đầu trong một planning transaction, các lần đọc tiếp recheck identity/revisions/cache nhưng không lặp APK scan partial 60 s. Metadata dump riêng có buffer cap 4 MiB; mặc định các lệnh ADB khác vẫn 1 MiB. AbortSignal đi đến child process, không tăng timeout/grant TTL.

`catalog-warmup.ts` + worker: background queue một device tại một thời điểm, budget 30 s, non-blocking timer khi có verified device; không chạy khi có active registry task hoặc owner scope. START/enable-owner abort và drain warmup trước admission. Session/reservation bên ngoài worker được kiểm tra trước background ADB reads; gặp owner thì yield, không lấy Session mới. Metadata partial được lưu để foreground lazy resolution tiếp tục. Chưa có kiểm thử tải nhiều device thật.

Các gate freshness, identity, occlusion, grants, replay, policy, review, budgets, full-control journals/inverse và cancellation của runtime không bị nới. Không sửa prompts/model/fixtures để làm measurement qua.

## 4. Runner Deadline

`scripts/agent-v2-runner-lifecycle.cjs` dùng chung cho acceptance/M4d/M5 runner:

1. Khi chạm deadline, primary runner đọc lại đúng execution/device; terminal thì thu nhận kết quả thay vì ném lỗi/hủy từ poll cũ.
2. Cleanup đọc lại ngay trước CANCEL. Nếu terminal hoặc task missing/foreign: không gửi CANCEL. Ghi request/check timestamp, observed status, finishedAt; nếu còn active ghi thêm cancel request/response timestamp và accepted.
3. Poll cleanup bounded; primary runner ghi báo cáo kể cả deadline/error, thay vì mất toàn bộ terminal evidence. Không sửa runtime cancel semantics; backend terminal guard cũ vẫn là ranh giới atomic nếu trạng thái đổi giữa HTTP GET và POST.

Không thể làm GET/POST thành giao dịch atomic chỉ ở runner. Claim chính xác: **không gửi CANCEL khi lần re-read mới nhất đã xác nhận terminal**; cửa sổ completion sau GET vẫn do backend từ chối cancel terminal. Không tuyên bố mạng loại bỏ được mọi race.

OFFLINE_TESTED: near-deadline completion sau stale RUNNING poll, mọi terminal status, active/missing/foreign task và timestamps. Không dùng test mock làm bằng chứng Android hoàn tất.

## 5. Paired Android DEVELOPMENT

Samsung A50s USB `R58MA78W6QK`, một Session tại một thời điểm. Một readiness probe báo locked trước START: xin người dùng mở khóa, **không tính task/rerun**. Owner mode đúng physical device được bật và tắt trong `finally` mỗi lượt. Không bật full-control setting mutation.

Freeze trước task:
`2b1753c87683ec690b80577cdc3c8c9781a9da32289b776f75280a153e6eccda`.
Digest là sorted path/content `lib/android/**/*.ts`, không phải Git commit. Kiểm tra sau mỗi lượt và sau validation; không sửa runtime trong chuỗi đo.

Cold: bỏ đúng metadata cache của physical device này, không đụng Android/dữ liệu người dùng hoặc cache thiết bị khác; verify 0 cached entries trước START. Warm: nạp/kiểm đủ 37 entries (36 resolved, entry unresolved vẫn không có label), preparation timing nằm riêng ngoài task. Fresh package existence/identity vẫn chạy trong task. Không xóa app/data để tạo “cold”.

| Câu lệnh / condition | Outcome | Planning / Session / total (s) | RPC / ADB |
| --- | --- | --- | --- |
| `Vào Drive tìm giúp mình tài liệu tên báo cáo thực tập` / cold | COMPLETED, exact query, NO_RESULTS; screenshot/native đã kiểm | 61,580 / 7,320 / 92,208 | 114 / 143 |
| Cùng câu Drive / warm | COMPLETED; screenshot exact query + explicit no-results | 1,999 / 6,891 / 27,982 | 95 / 69 |
| `Ghé YouTube để tìm giúp mình hải dương học nhé` / cold | COMPLETED; query exact, RESULTS, search screen | 62,017 / 5,822 / 95,801 | 96 / 134 |
| Cùng câu YouTube / warm | COMPLETED; screenshot/native search results, không watch-page | 2,446 / 9,359 / 36,794 | 95 / 69 |

Drive cold profile: pull 44,441 s / 20 calls, aapt2 9,259 s / 20 calls, path 2,823 s / 20 calls, parse 1,551 ms / 19 successful parses, metadata 505 ms / 2 reads; đây là stage đo riêng, không cộng các span lồng nhau vào total. Không suy “parse XML nhanh hơn” từ số parse resource label này.

YouTube cold: pull 44,736 s / 20 calls, aapt2 8,504 s / 19 calls, metadata 502 ms / 2 reads. Trong **mỗi warm task**: 74 entry hits (hai lần kiểm metadata cho 37 entries), **0 pull / 0 aapt2**, fresh identity 2 reads, metadata 2 reads (Drive 463 ms; YouTube 519 ms). Cached entry rỗng không thành resolved label.

Observed paired planning giảm 61,580 → 1,999 s (Drive) và 62,017 → 2,446 s (YouTube). Observed total tương ứng 92,208 → 27,982 s (~3,30x) và 95,801 → 36,794 s (~2,60x). Đây là **số đo một cặp cho từng goal**, không phải tốc độ bảo đảm hoặc confidence interval về latency.

Không coi warmup miễn phí: các stage preparation được đo riêng trước warm task cộng tuần tự lần lượt ~66,730 s và ~67,114 s; không có wall-time span đầy đủ của toàn preparation/API/filesystem, nên không gọi đó là total preparation. Profile prep giữ từng package/stage. Background prewarm được tạm dừng trước owner scope; foreground cache preparation làm lúc không có task/Session. First-use cost vẫn tồn tại, warm cache dời công việc ra khỏi task chứ không xóa chi phí đọc label.

Observation / execution / verification (s): Drive cold 13,674 / 17,430 / 0,150; warm 10,917 / 13,364 / 0,220. YouTube cold 16,333 / 17,924 / 0,178; warm 15,121 / 17,305 / 0,216. Các span lồng nhau/overlap và không cộng với planning/Session để suy total.

Kết quả **4 task / 4 COMPLETED**, 0 BLOCKED/FAILED; 0 false completion quan sát trong bốn claims sau khi xem bốn ảnh và native activity. Cả bốn có **0 model call**, không gán success cho Qwen reasoning. Native foreground đúng Drive/YouTube; mọi owned Session probe trả 404 `invalid session id`. Sau từng lượt 0 active tasks / 0 owner modes, hash khớp. Không enumerate hoặc tuyên bố về Session của bên thứ ba.

Mỗi câu chỉ có một cặp cold/warm, không phải randomized benchmark. Initial app state/Session/network/OS file cache không được reset bằng thao tác ghi; end-to-end total có confound, còn cache hit/miss và APK-work counters cho biết trực tiếp phần catalog đã tránh được. Không dùng M5b historical runs làm paired baseline hiện tại.

Không mở kết quả; YouTube inline autoplay preview (nếu có) không được gọi là watch-page/playback acceptance. Thống kê completion chỉ theo contract tìm kiếm, không có claim đã tìm thấy một tài liệu cụ thể khi NO_RESULTS.

## 6. Validation Và Hạn Chế

Preflight full regression, TypeScript và scoped ESLint PASS; nhóm cache/lifecycle mới PASS 27/27 ngoài sandbox. Lượt đầu trong sandbox có EPERM ở atomic TEMP rename (8 test fail); cùng tests ngoài sandbox PASS, không bỏ atomic rename hay nới assertion để che lỗi. Test warmup chờ state condition thay vì phụ thuộc một sleep cố định để tránh timing flake khi full regression chạy đồng thời nhiều process.

Validation cuối sau cả bốn lượt, không overlap với phép đo Android. Wrapper lấy actual child `close(exitCode, signal)`, không suy từ outer PowerShell exit:

| Check | Kết quả | Child elapsed |
| --- | --- | ---: |
| Full regression | **707/707 PASS**, exit 0, 0 skipped/cancelled; giữ 680 cũ + 27 mới | 56,136 s |
| TypeScript noEmit, incremental=false | PASS exit 0 | 9,812 s |
| Scoped ESLint, 15 file TS/CJS | PASS exit 0, không warning mới | 8,128 s |
| Full ESLint | FAIL exit 1: lỗi cũ `components/executions/ExecutionDetailModal.tsx:130:98` no-explicit-any, 9 unused warnings | 21,536 s |
| `next build --webpack` | PASS exit 0; còn dynamic dependency warning createRequire, chưa là packaged-deployment acceptance | 145,921 s |
| Default `next build` | FAIL exit 1, Turbopack CSS child process thoát trước khi kết nối, child code 0; cùng signature cũ | 4,103 s |
| `git diff --check` | PASS exit 0; chỉ Git LF/CRLF warnings, không whitespace errors | Không đo riêng |

Không đổi bundler config để làm default build qua. Không sửa lỗi lint unrelated. Không sửa assertion cũ để che failure. File mới cũng được kiểm trailing whitespace riêng: 0 issue.

Secret scan: **PASS**, 890 file / 138.156.797 byte, 0 match, 0 file vượt cap 10 MB. Gồm source, build JS/maps/HTML, evidence M5c, bốn primary acceptance reports và host label cache. So exact configured keys và key-like formats; không in key. Exclude environment files, dependencies, .git, sealed/holdout, binary screenshots, unrelated TEMP. Không chứng minh mọi loại secret đều vắng mặt hoặc quét được lịch sử tool transcript. Không có finding cần redact mới trong lượt này.

Final API HTTP 200, frozen digest khớp, **0 active tasks / 0 owner modes / 0 running / 0 waiting inference**. Owner modes tắt sau mỗi task, owned Sessions đóng 4/4. Không có setting mutation, Bluetooth, delete/uninstall/data clear, consent, purchase/send/call hoặc result opening.

### Failure Taxonomy Trong Scope A/B

| Hiện tượng | Category / kết luận | Evidence |
| --- | --- | --- |
| APK pull/aapt2 chiếm planning cũ | Catalog I/O, không model inference; persistent cache và không lặp scan đã giảm phần này trong paired data | baseline per-package + bốn paired JSON |
| Một app không đọc được label | Resource extraction timeout; negative backoff giữ unknown, không đoán tên | baseline và cache equivalence assessment |
| Cold scan chưa đủ catalog | Budget/partial metadata, không phải goal thất bại; warm prep/lazy continuation thu đủ 37 cached entries, 36 resolved | cacheBefore và CATALOG stage events |
| Một probe trước START gặp khóa | External readiness; không counted attempt, người dùng mở khóa trước task | runner preflight output và approval trong chat |
| Sandbox test rename EPERM | Test environment permission, không sửa atomic implementation để né | targeted ngoài sandbox PASS; failure ban đầu trong tool output |
| Deadline stale poll | Runner lifecycle; offline near-boundary PASS, không ép tạo race Android mới | lifecycle unit tests; primary runner reports không gặp deadline |
| Full lint/Turbopack fail | Known unrelated build/lint issues, chưa sửa root cause | final validation logs |

Các script M4d/M5 được cập nhật logging/cleanup, nhưng **không chạy lại các batch mutation/held-out cũ** để nghiệm thu chúng. Chỉ shared lifecycle helper được OFFLINE_TESTED và primary runner được dùng trong bốn task thật.

UNVERIFIED/remaining: held-out M5c, literal thương hiệu không trùng installed label, global uniqueness khi app không expose label, cache metadata quá 4 MiB/SDK không có, packaged worker với devDependencies bị prune, multi-process cache contention/performance, multi-device Android thật, recovery/UI/mutation ngoài scope. Atomic metadata writes tránh JSON dở, không phải transactional multi-writer store; last-writer cache loss có thể gây miss, không được nhận là shared authorization. Cache không phải authentication và không chống attacker đã có quyền sửa local files.

Worker admission bảo đảm warmup đã drain trước task trong registry; check filesystem ownership còn bảo vệ các Session/reservation có sẵn ở bên ngoài. Không có transaction toàn hệ thống cho external client xuất hiện ngay giữa một ownership read và read-only RPC; chưa làm stress test inter-process cạnh tranh hoặc tuyên bố kiểm soát thao tác từ công cụ bên ngoài. Không bỏ Session lock hay fresh execution verification để đổi lấy tốc độ.

## 7. Điều Này Chứng Minh Và Không Chứng Minh

Mục tiêu là giảm công việc label discovery lặp lại và làm báo cáo deadline đúng lifecycle, không nâng “trí thông minh” model. Success không gọi AI vẫn chỉ chứng minh rules/capability/observer/verifier hoạt động cho goal đó. Cache names không giúp tạo executor/verifier mới cho app chưa được hỗ trợ.

Không có cohort M5c do người dùng viết nên **không có kết luận held-out/generalization mới, không có tỷ lệ hay Wilson interval cho M5c**. Không đổi FAILED/BLOCKED cũ thành SUCCESS. Không commit/push.

## 8. Evidence Index

TEMP cục bộ `C:\Users\TRANDU~1\AppData\Local\Temp`, không đưa logs/cache/ảnh vào Git:

- `agent-v2-m5c-label-baseline-1792568721095.json`: per-package cũ và cheap-source rejection.
- `agent-v2-m5c-targeted-1792569918379.log`, `agent-v2-m5c-targeted-final-1792571049812.log`.
- `agent-v2-m5c-preflight-1792570536661.json` và logs.
- `agent-v2-m5c-freeze-1792571124165.json`: frozen runtime/runner hash, cohort absence, worker refresh.
- `agent-v2-m5c-paired-cold-1792571297493.json` / `.png` / `-runner.log`.
- `agent-v2-m5c-paired-warm-1792571587752.json` / `.png` / `-runner.log`.
- `agent-v2-m5c-paired-cold-1792571806628.json` / `.png` / `-runner.log`.
- `agent-v2-m5c-paired-warm-1792572193956.json` / `.png` / `-runner.log`.
- `agent-v2-m5c-assessment-1792572681695.json`: external manual review, screenshot hashes, native/session/counters và 36/36 resource-label equivalence. Raw runner fields `PENDING` được giữ, assessment là kết luận kiểm tra riêng, không sửa lịch sử thu thập.
- `agent-v2-m5c-final-validation-1792572854350.json` và sáu log cùng prefix: actual child exit/timings.
- `agent-v2-m5c-secret-scan-1792573637821.json`: scope/limits, zero matching paths.
- `agent-v2-m5c-final-1792573537869.json`: post-validation hash, API, zero-active/mode/queue và whitespace.

## 9. File Trong Phần Thay Đổi Này

- Cache/catalog: `launcher-label-cache.ts` (mới), `launcher-labels.ts`, `app-catalog.ts`, `catalog-warmup.ts` (mới) trong `lib/android/agent/`.
- Worker/profiling: `lib/android/agent/worker-server.ts`, `agent-v2.ts`, `budget.ts`.
- ADB plumbing: `lib/android/adb.ts`, `executor.ts` (read buffer cap/AbortSignal options, không thêm shell capability).
- Runners: `scripts/agent-v2-runner-lifecycle.cjs` (mới), `agent-v2-acceptance.cjs`, `agent-v2-m4d-acceptance.cjs`, `agent-v2-m5-evaluation.cjs`, `agent-v2-m5c-paired.cjs` (mới).
- Tests/report: `tests/agent-v2-catalog-cache.test.cjs` (mới), báo cáo này.

Danh sách này không nhận các file dirty/untracked đã có từ các lượt trước là thay đổi M5c. Không có cache/APK/log/screenshot được thêm vào repo; không commit/push.
