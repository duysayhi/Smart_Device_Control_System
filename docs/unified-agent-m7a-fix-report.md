# M7a Fix Report: Unified Agent

Ngày hoàn tất báo cáo: 23/10/2026, Asia/Bangkok. Branch `DuyTD`.

## 1. Kết luận

**PARTIAL: đã sửa và kiểm thử offline; chưa nghiệm thu end-to-end toàn bộ trên Android.**

- OFFLINE_TESTED: **1107/1107 tests PASS**, 59 file; bao gồm 896 test cũ và 211 test mới. Không sửa test cũ để đổi kỳ vọng.
- OFFLINE_TESTED: TypeScript và scoped ESLint PASS.
- REAL_ANDROID: thăm dò chỉ đọc bằng adapter thật trên Samsung USB; đọc được inventory báo thức sau khi sửa cách grounding scroll. Không tạo báo thức hoặc bắt đầu timer mới.
- UNVERIFIED: đọc pin/Wi-Fi, clarification trên browser, reanalysis sau TTL, hai search, tạo báo thức 07:00, timer RUNNING, ordinal playback và cancel UI sau sửa chưa được chạy lại end-to-end.
- Build BLOCKED bởi `EPERM` khi tạo `.next/server/app/api/devices`; không ghi build PASS.
- Full ESLint vẫn FAIL với lỗi cũ ngoài phạm vi ở `ExecutionDetailModal.tsx:130:98`.

Không đổi kết quả BLOCKED cũ thành SUCCESS. Không triển khai M8; không commit/push, không đọc sealed/holdout; không thay model/provider/config.
Working tree M7a có sẵn được giữ nguyên, kể cả `pnpm-workspace.yaml`.

## 2. Source Và Evidence Đã Đọc

Đã đối chiếu source thật với `docs/unified-agent-m7a-acceptance-report.md` ngày 22/10,
`docs/unified-agent-m7a-report.md` và các contract temporal/permission hiện có.
Kết quả camera, cancellation và BLOCKED trong báo cáo cũ chỉ là lịch sử, không tính là kết quả mới.

Evidence ngoài repo, không đưa ảnh/log thật vào Git:

| ID | Thư mục / nguồn | Nội dung |
| --- | --- | --- |
| E1 | `C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m7a-clock-probe-9ox3cY` | Probe chỉ đọc đầu; XML và request Appium chứng minh scroll bằng bounds có thể đổi tab |
| E2 | `C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m7a-clock-probe-ttxtGx` | Probe cuối với native element targeting; `report.json`, XML, `ALARM.png`, `TIMER.png` |
| E3 | `C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6a-validation-kABg3q` | Full regression: `summary.json` và log từng test file; tên runner lịch sử không có nghĩa chỉ chạy M6a |
| E4 | Tool transcript của lượt sửa | TypeScript, scoped/full ESLint, webpack build, diff check, secret scan, API preflight và lỗi duyệt công cụ |

TEMP có thể bị hệ điều hành dọn; đây không phải kho evidence lâu dài.

Runtime digest `lib/android/**/*.ts` ở E2 và checkpoint trước bổ sung ở mục 8:

```text
f8a8540225d1ed773992d02c7b1f4be832966db9bf9ba3288e65b643e0163bdb
```

Digest dùng thuật toán của `runtime-storage.ts`: tên tương đối đã sort và nội dung từng file `.ts`.
E2 ghi before/after giống nhau. Không suy digest này là byte-hash bundle Next đang phục vụ browser.

## 3. Root Cause Và Bản Sửa

### 3.1 READ_STATE Không Có Application Handler

**VERIFIED_IN_SOURCE / OFFLINE_TESTED.** Hai câu tự nhiên trước đây rơi vào generic navigation
hoặc SET_STATE; quá trình prepare còn cố tìm ứng dụng xử lý cho thao tác đọc trạng thái thiết bị.
READ_STATE thực tế không cần launch app nhưng vẫn cần device-bound Session và quyền source-bound.

- `intent-capabilities.ts:34`: nhận diện whole-clause tiếng Việt/Anh theo closed typed state vocabulary; không nhận đọc trạng thái bằng cách nuốt thêm mutation hoặc search query.
- `outcome-spec.ts:88`, `goal-compiler.ts:57`: giữ READ_STATE xuyên outcome/graph; không gán package giả.
- `prepared-v2.ts:29`, `device-runtime.ts:62`, `agent-v2.ts:292`: bỏ discovery handler chỉ đối với READ_STATE; các launch/mutation khác vẫn phải resolve đúng app.
- `intent-executor.ts:100`, `:120`: thực thi hai đường đọc độc lập trong cùng owned Session, kiểm tra identity/readiness/freshness và sai lệch giá trị/stderr; không biến dữ liệu thiếu thành thành công.

Các ví dụ pin/Wi-Fi được bảo vệ bằng tests cả semantics, prepare/session binding và execution.
Đây là deterministic typed interpretation, **không phải bằng chứng LLM tự suy luận**.

### 3.2 Clarification AM/PM Trước Execution

**VERIFIED_IN_SOURCE / OFFLINE_TESTED; browser UNVERIFIED.** Trước đây parser đã phát hiện
AM_PM_REQUIRED nhưng HTTP chỉ trả lỗi; Dashboard không có câu hỏi để trả lời.

- `unified-agent/clarification.ts`: dùng outcome span và temporal parser hiện có để đưa đúng hai lựa chọn sáng/chiều, giữ nguyên các clause khác và timezone.
- `unified-agent/service.ts:71`: `analyzeForDashboard()` cấp clarification reference, **không prepare execution, mở Session hay cấp effect grant**.
- `service.ts:86`: answer single-use, TTL 120 giây; bind device/physical identity/backend/runtime/policy/owner; revalidate trước khi cấp plan mới. Chọn sáng/chiều không tự execute.
- `app/api/unified-agent/route.ts:64`: ANALYZE trả `{plan}` như cũ đối với yêu cầu đã rõ; hỗ trợ CLARIFY với strict schema.
- `UnifiedAgentPanel.tsx:117`: radio sáng/chiều không chọn mặc định; người dùng xác nhận mới tạo plan; câu hỏi hết hạn phải Analyze lại.

Giữ `.analyze()` nội bộ và API cũ không liên quan tương thích. Câu trộn destructive vẫn DENY toàn bộ.
Không báo Human Assistance resume cùng Session cho flow này: đây là clarification **trước** Session.

### 3.3 Plan TTL Và Reanalysis

**VERIFIED_IN_SOURCE / OFFLINE_TESTED; browser UNVERIFIED.** Lượt nghiệm thu trước chờ quan sát
lâu hơn TTL, không phải engine search đã chạy rồi thất bại.

- `service.ts:99`: REANALYZE consume reference cũ trước await; gọi toàn bộ analysis/prepare mới, cấp public và worker reference mới.
- `service.ts:138`: execute plan hết hạn trả PLAN_EXPIRED; plan đã dùng/không còn tồn tại không được replay.
- `UnifiedAgentPanel.tsx:131`: nút Phân tích lại kế hoạch; không tự execute hay nối dài quyền cũ.
- Giữ plan hiển thị khi Execute bị từ chối trước admission; chỉ xóa sau admission thành công. Khi phân tích mới, bỏ selection của execution cũ để tránh hiển thị kết quả cũ dưới câu hỏi mới.

Reference đã consume hoặc UNKNOWN_EFFECT **không có đường reanalysis để replay execution cũ**.
Sau process restart/pruning, reference có thể không còn; khi đó dùng nút Phân tích thông thường để tạo yêu cầu mới.

### 3.4 Alarm: UI_LIST_CONTINUITY_UNPROVEN

**Cơ chế lỗi được tái hiện trên Android thật; bản sửa inventory được REAL_ANDROID xác minh.**

E1: RecyclerView đang có ba hàng. ScrollGesture bằng bounds trả `false` nhưng sau gesture down,
tab chuyển từ Alarm sang World Clock; snapshot sau không có hàng báo thức, dẫn tới mất continuity.
Đây là một cơ chế tái hiện được phù hợp lỗi cũ, không phải bằng chứng mọi thiết bị có cùng nguyên nhân.

- `temporal-ui-inventory.ts:64`: production opt-in uniquely locate collection từ snapshot, kiểm tra native rect khớp bounds rồi dùng `elementId` cho scrollGesture; không fallback sang tọa độ khi native lookup thất bại.
- `condition-executor.ts:152`: nối production adapter vào strategy NATIVE_ELEMENT.
- Kiểm tra đúng selected temporal tab/device/package trước và sau scroll; lỗi tab thay đổi được phân biệt rõ.
- `temporal-ui-inventory.ts:108`: chỉ rebase thời điểm evidence nếu **mọi hàng đã thu đều hiện đầy đủ và không đổi trong một fresh final view**; không gia hạn bằng chứng các hàng offscreen. Native top/bottom proof vẫn bắt buộc.

E2 đọc thành công ba hàng **00:15 OFF, 06:00 OFF, 07:30 OFF**, zone `Asia/Saigon`.
Ảnh ALARM và XML phù hợp với inventory. Không có báo thức 07:00 trong baseline này.
Không Save, không sửa hoặc xóa hàng cũ. **Tạo và persisted readback báo thức mới vẫn UNVERIFIED.**
Nếu form không chứng minh được AM/PM hoặc 24h, runtime vẫn phải BLOCKED.

### 3.5 Timer: UI_TIMER_RUNNING_DECREASE_UNVERIFIED

**Mâu thuẫn UI đã quan sát thật; protocol sửa OFFLINE_TESTED, chưa nghiệm thu Start.**

E1/E2: EditText báo `00, Giờ / 02, Phút / 00, Giây`, trong khi ancestor description
và screenshot cho thấy **00:00:01**, còn nút Bắt đầu. Vì vậy chỉ đối chiếu text field có thể xác nhận nhầm duration.
Điều này chứng minh editor text không đồng nhất với backing model; chưa chứng minh đủ mọi nguyên nhân của COMMIT cũ.

- `grounded-interactions.ts:93`: protocol generic cho NumberPicker editable: grounded focus, nhập, fresh readback cùng role/native identity/value/focus, rồi IME Done đúng một lần trong cùng journaled attempt.
- Mỗi dispatch tiếp tục dùng expiry của grant gốc; không gia hạn khi đọc UI mới. Không có retry sau UNKNOWN_EFFECT.
- `temporal-ui.ts`: khi có duration model từ ancestor, bắt buộc đồng nhất với ba editor fields; field echo không đủ để cho Start hoặc xác nhận transition.
- `temporal-ui-runner.ts`: khi chưa quan sát được trạng thái RUNNING, trả `UI_TIMER_RUNNING_STATE_UNOBSERVED` trước pair-read verifier.
- Vẫn yêu cầu hai fresh observations khác snapshot, cùng device/app, thời gian còn lại giảm phù hợp monotonic elapsed; không loại `UI_TIMER_RUNNING_DECREASE_UNVERIFIED`.

Không replay timer execution cũ; không Start timer mới trong lượt sửa. Tính tương thích IME protocol,
grant TTL với latency máy thật và countdown verification vẫn cần nghiệm thu riêng.

### 3.6 V1 YouTube Ordinal Và Stale Cancel Message

**OFFLINE_TESTED; nguyên nhân end-to-end timeout cũ chưa được chứng minh đầy đủ.**

Các defect riêng biệt đã tái hiện bằng tests:

- `media-playback-verifier.ts:51`: reset samples khi selection identity/ordinal/title/origin snapshot thay đổi; không tái sử dụng proof từ video khác.
- `media-playback-verifier.ts:82`: một lần đã advance không làm các lần đọc frozen/repeated sau đó tự PASS.
- `action-verifier.ts` và `condition-executor.ts:109`: matching UI text không được override yêu cầu playback proof.
- `UnifiedAgentPanel.tsx:136`: dòng đang chờ đóng Session chỉ hiện khi execution chưa có finishedAt; terminal CANCELLED không tiếp tục hiển thị thông báo đang chờ.

Đây chủ yếu là sửa nguy cơ **false positive** trong postcondition, không phải lý do để tuyên bố
timeout ordinal cũ đã hết. Chưa có rerun chứng minh title đúng kết quả thứ hai và PLAYING progress.
Không ép click Play hoặc chuyển engine để biến BLOCKED thành COMPLETED.

## 4. Android Acceptance Và Giới Hạn Công Cụ

Chỉ có các probe đọc UI được chạy trong lượt sửa, qua real Android adapter/Appium, **không phải Unified Dashboard execution**.

| Ca | Kết quả lượt sửa | Model calls / evidence |
| --- | --- | --- |
| Alarm inventory, bounds strategy | BLOCKED an toàn; tái hiện đổi tab | 0; E1 raw XML/scroll arguments |
| Preflight sau máy tự khóa | Không tính là task; không effect | Không gọi model |
| Alarm inventory, native strategy | PASS / REAL_ANDROID, ba hàng cũ giữ nguyên | 0; E2 XML + screenshot + sealed inventory |
| Timer inventory | PASS chỉ đọc form; không RUNNING claim | 0; E2 XML + screenshot |
| Pin/Wi-Fi tự nhiên qua Unified | UNVERIFIED end-to-end | Không có execution mới; không ghi model-call count giả |
| AM/PM Dashboard, TTL reanalysis, stale cancel UI | UNVERIFIED tương tác browser | Test backend PASS không thay thế browser acceptance |
| YouTube/Drive search, V1 ordinal | UNVERIFIED rerun | Giữ lịch sử NOT_EXECUTED/BLOCKED cũ |
| Alarm tạo mới / Timer Start | UNVERIFIED | Không tạo dữ liệu thử trùng, không replay UNKNOWN |

E2 aggregate probe budget: **50,484 ms total**, observation 20,020 ms; 98 Appium RPC,
97 ADB, 12 native snapshots, 2 scrolls, 0 reasoning calls. Các counter thuộc budget đã instrument,
không phải số packet toàn hệ thống. Session setupMs=0 là probe không instrument span setup,
**không có nghĩa setup tức thời**. Không cộng các span lồng/chồng nhau thành total.
Không có analyze/execute Unified latency mới cho các ca chưa chạy.

Trong phần browser kiểm tra lại, tab IAB hiển thị 0 device và history rỗng, trong khi API đọc bằng
terminal trả đúng Samsung USB và 37 task lịch sử. Chưa xác định nguyên nhân khác biệt này;
không giả lập device, sửa config hoặc chọn máy khác để đánh dấu browser PASS.

Worker được reload qua `/shutdown` khi idle, body `{}`, để khớp source; không force-kill worker.
Lệnh tự dừng Next bị cơ chế duyệt từ chối nên không chạy; chủ dự án sau đó tự restart Next và báo xong.

Lệnh chạy batch acceptance chỉ đọc tiếp theo **không được thực thi**: hệ thống auto-review báo hết
hạn mức và không hoàn tất duyệt. Đây là blocker của công cụ, không phải task Android FAIL hay policy
DENY của Phone Commander. Không chạy lại qua một kênh khác để vượt bước duyệt.

Cleanup được ghi ở E2: Session `8e67ec98-a022-4719-98a0-8c8d6622e32b` đóng trong finally,
ownershipAfter=null. Probe chỉ chạy khi runtime 0 active tasks/0 owner modes; không bật owner mode.
Không có batch Android mới được admission sau đó. Live cleanup cuối sau blocker chưa kiểm tra lại;
không khẳng định đã đọc lại trạng thái runtime mà chưa thực hiện.
Kiểm tra filesystem cuối: journal có 37 task, 0 task chưa finishedAt; không còn lock directory
cho serial/physical identity Samsung hoặc reservation tương ứng. Đây là persisted/local evidence,
không thay thế live owner-mode poll.

**Không tạo artifact mới trong lượt sửa này.** Ảnh camera ID 2266 của acceptance cũ vẫn chỉ là
artifact lịch sử; không chụp lại, không xóa. Không tạo alarm/timer mới để dọn sau.

## 5. Files Và Tests

Các đường dẫn bên dưới tính từ repo root; source M7a có sẵn không bị rollback.

| Nhóm sửa | Files chính | Tests bổ sung mới |
| --- | --- | --- |
| Typed reads | intent-capabilities, outcome-spec, goal-compiler, prepared-v2, device-runtime, agent-v2, intent-executor, ConditionExecutor signatures | `read-state-semantics.test.cjs` (60), `read-state-session-binding.test.cjs` (20), `read-state-execution.test.cjs` (25) |
| Clarification/TTL/UI | unified-agent/contracts, clarification, service; unified route; UnifiedAgentPanel | `unified-agent-m7a-fixes.test.cjs` (21) |
| Temporal grounding/readback | temporal-ui, temporal-ui-inventory, temporal-ui-runner, grounded-interactions, ConditionExecutor production wiring | `temporal-m7a-fixes.test.cjs` (16), `temporal-m7a-scroll-grounding.test.cjs` (23), `temporal-m7a-editor-protocol.test.cjs` (37) |
| Playback | media-playback-verifier, action-verifier, condition-executor | `media-playback-postcondition.test.cjs` (9) |
| Acceptance tooling | `scripts/unified-agent-m7a-clock-probe.cjs`, `scripts/unified-agent-m7a-fix-acceptance.cjs` | Script probe thật; batch Unified chưa chạy |

Tổng test mới: 105 reads + 21 unified + 76 temporal + 9 playback = **211**.
Test offline bao gồm ambiguity, timezone, replay/concurrency, binding thay đổi, destructive mixed
request, expired references, stale/foreign UI, no-effect failures, strict timer model và playback samples.
Các test mock/session fake được đánh nhãn OFFLINE, không tính là AI hoặc Android tự chủ PASS.

Giữ executor loops, generic app discovery, M6a permission decision/effect journals, identity,
Session ownership, cancellation, grants và independent verification. Không thêm package/selector
Samsung vào runtime; selector/elementId native được sinh từ snapshot đã quan sát. Tên app/package
trong evidence là dữ liệu thăm dò, không phải workflow runtime mới.

## 6. Validation

| Lệnh / kiểm tra | Kết quả thật |
| --- | --- |
| Full regression, runner `agent-v2-m6a-validation.cjs` | PASS 1107/1107, 59 file, fail=0, exit=0; E3 |
| `tsc --noEmit --incremental false` | PASS, exit=0 |
| Scoped ESLint runtime/UI/tests/scripts sửa | PASS, exit=0 |
| Full `eslint .` | FAIL: 1 error, 9 warnings; lỗi cũ `components/executions/ExecutionDetailModal.tsx:130:98`, no-explicit-any |
| `next build --webpack` | BLOCKED/exit=1: EPERM mkdir `.next/server/app/api/devices`; không xác định đây là lỗi application compile, không báo build PASS |
| `git diff --check` | PASS, exit=0; có cảnh báo line-ending LF/CRLF, không có whitespace error |
| Secret scan modified/untracked nonignored files | PASS checkpoint cuối gồm report: 41 file, 0 matching paths; không in giá trị key |

Secret scan loại env files, dependencies/build, sealed và holdout; không tuyên bố scan toàn bộ Git
history/tool transcript hay production artifact vì build chưa hoàn tất.
Model mặc định vẫn `qwen2.5:3b-instruct`; không thay Groq/Ollama. Không có real inference mới
được chứng minh bởi các probe này.

## 7. Còn Phải Nghiệm Thu

1. Khôi phục khả năng duyệt công cụ để chạy đúng USB Samsung, không đổi transport hoặc bypass keyguard.
2. Giải thích khác biệt IAB/API và kiểm tra thật radio AM/PM, plan mới, TTL reanalysis và terminal cancellation UI.
3. Chạy typed battery/Wi-Fi và hai search bằng Unified, lưu plan/router/permission/counters và independent readback.
4. Một alarm mới và một timer mới chỉ sau fresh baseline/scope hợp lệ; báo chủ thiết bị trước Start. Không replay timer cũ và không sửa dữ liệu hiện có.
5. Rerun V1 ordinal một lần với title, ordinal identity và fresh playback samples; nếu thiếu proof vẫn BLOCKED.
6. Chạy lại webpack build trong môi trường có quyền ghi phù hợp, khi đã giải quyết blocker công cụ; không force-kill dev server hay xóa `.next` để lách lỗi.

**Điều báo cáo chứng minh:** các root cause cụ thể đã có regression và inventory grounding đã
đọc được đúng danh sách trên một Samsung thật. **Điều chưa chứng minh:** alarm/timer tạo mới thành
công, mọi lỗi M7a đã hết, Dashboard đã nghiệm thu đủ, hay AI có khả năng tự chủ tổng quát trên app mới.

## 8. Bổ Sung: Ép V2 Với Ordinal Playback

Ngày 23/10/2026, người dùng cung cấp ảnh lỗi `ambiguous unquoted clause or connector` với
`Mở YouTube, tìm OpenAI và phát video đầu tiên` và xác nhận debug engine đang là **Agent V2**.

Source hiện tại nhận đúng câu NFC này là `OPEN_RESULT`, query `OpenAI`, ordinal 1 và tự động chọn
V1. Khi ép V2, router trước đây vẫn cho đi vào V2 preparation; `phát video đầu tiên` không có
primitive/capability ordinal playback đầy đủ trong V2, nên cuối cùng source-slots trả lỗi giống
lỗi quote query. Thêm dấu ngoặc kép cho `OpenAI` không bổ sung executor/verifier bị thiếu.

- `capability-router.ts`: nếu engine bị ép là V2 mà yêu cầu legacy đã được nhận diện là OPEN_RESULT,
  trả ASK/ENGINE_CAPABILITY_UNSUPPORTED trước prepare/model/effect. Thông báo hướng dẫn chọn
  Tự động hoặc V1 rồi Phân tích lại. Không fallback trong cùng execution, không thêm capability giả.
- `UnifiedAgentPanel.tsx`: thêm trạng thái engine debug hiện ngay ngoài phần collapsed và nút
  Tự động. Nút này chỉ bỏ override/invalidate plan, không tự Analyze hay Execute.
- `tests/unified-engine-coverage.test.cjs`: 11 tests mới. Trước sửa 7 PASS/4 FAIL; sau sửa **11/11 PASS**.
  Bảo vệ exact query/ordinal, V1 auto route, no prepare/dispatch khi ép engine unsupported,
  destructive whole-source DENY và giữ nguyên các đường V2/AP đang hỗ trợ.

TypeScript, ESLint phạm vi ba file và diff check PASS. Lượt mở rộng ba test file đạt **81/82**;
test cũ `real loopback Worker /planning requires bearer...` thất bại `fetch failed` tại
`unified-agent-m7a.test.cjs:241` trong sandbox. Không sửa test này hoặc vượt kiểm soát network
để biến kết quả thành PASS. **Không chạy lại full regression sau bổ sung này**; 1107/1107 ở mục 6
là checkpoint trước bổ sung, không phải kết quả của source sau thay đổi router.

Browser thử chọn debug trong IAB nhưng không giữ được selection giữa các lần quan sát;
chưa xác định nguyên nhân, không báo banner/reset tương tác PASS. Không chạy Analyze/Execute
hoặc thao tác Android trong phần bổ sung. Cần nạp lại Next và idle worker trước lần nghiệm thu
tiếp theo vì runtime digest đã đổi; không force-kill hoặc khởi động lại khi còn Session/task.
Digest sau bổ sung: `e60796bcc2b52a398985ae00417a04998c623a11c8e28364bb722871588145c0`.

## 9. Bố Cục Gần Giao Diện Cũ Theo Yêu Cầu Chủ Dự Án

Ngày 23/10/2026, người dùng muốn bỏ hai engine dropdown cạnh nhau và thích bố cục cũ.
Chỉ sửa presentation, không rollback runtime hoặc đổi API:

- Tab Action Plan chọn override ACTION_PLAN trước Analyze; tab Goal Agent có radio Tự động/V1/V2.
- Chuyển tab/engine làm mất plan UI cũ; không tự Analyze/Execute hay chuyển engine sau dispatch.
- Giữ clarification, TTL reanalysis, progress, assistance, owner/full-control và history của Unified.
- Chạy nhóm vẫn đi đường batch cũ; nằm trong mục Nhiều thiết bị riêng, có radio Engine chạy nhóm,
  không còn dropdown thứ hai dễ nhầm. Không bỏ chức năng chạy nhóm hoặc đổi policy của nhóm.
- Ô nhập và khối thiết bị dùng bố cục gọn gần ảnh cũ; kế hoạch ngôn ngữ tự nhiên nằm trong vùng
  tối có cuộn nội bộ. Không dựng JSON Action Plan giả từ summary hoặc tiết lộ private authorization.

Files: `CommandEngineControl.tsx` mới, `UnifiedAgentPanel.tsx`, phần group-only của
`AgentGoalPanel.tsx`; test mới `command-engine-controls.test.cjs`.
OFFLINE: 12 test UI/control và 11 router tests = **23/23 PASS**; TypeScript, scoped ESLint PASS.
Test UI cũ yêu cầu 0 tab đã tái hiện FAIL (actual=2). Cập nhật duy nhất kỳ vọng hiển thị này thành
2 tab theo yêu cầu giao diện mới; giữ nguyên kiểm tra một ô nhập và các nút thực thi. Không sửa
test permission/executor/verifier hoặc đổi kết quả Android cũ. Không chạy lại full regression/build
cho thay đổi chỉ giao diện này.
Test UI cũ sau cập nhật và 12 test UI mới: 13/13 PASS. Lượt mở rộng bốn file đạt 93/94;
test loopback Worker cũ vẫn `fetch failed` tại dòng 242, không phân loại thành UI failure hay bỏ qua
trong thống kê. Log: `C:\Users\Tran Duy Khanh\AppData\Local\Packages\sandbox.{e063a59a-67df-4aa3-95b1-110f561d28df}\AC\Temp\phone-commander-classic-ui-R20wH3\focused-tests.log`.

IAB đã hiển thị bố cục mới; xác minh trực quan ở viewport hẹp. Thử click Action Plan không giữ
được selected state giữa các lần đọc của công cụ (tương tự bất thường IAB ở mục 8); chưa chứng minh
interaction/end-to-end bằng browser, không báo toàn bộ Dashboard PASS. Handler bindings/keyboard
navigation đã kiểm thử offline. Không chạy Analyze, Execute, batch hoặc đổi quyền thiết bị.
