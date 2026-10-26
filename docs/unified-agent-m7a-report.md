# M7a - Unified Agent

Ngày: 2026-10-22. Branch: `DuyTD`. Không commit/push, không đọc sealed/holdout,
không đổi model/provider/configuration. Working tree ban đầu chỉ có
`pnpm-workspace.yaml` untracked; giữ nguyên file này.

## 1. Phạm vi và kết luận

Đã hợp nhất **entry point và trải nghiệm**, không hợp nhất hay viết lại ba
execution loops. Dashboard mặc định có một câu lệnh, một thiết bị và
**Phân tích / Thực thi / Dừng**. Backend chọn engine, kiểm tra coverage, rồi cấp
reference dùng một lần. Không có fallback engine sau dispatch.

- OFFLINE_TESTED: baseline **846/846**, 50 files, trước mọi sửa đổi M7a.
- OFFLINE_TESTED: full regression cuối **896/896**, 51 files (846 baseline +
  50 M7a); TypeScript, scoped ESLint M7a và webpack build PASS. Full ESLint còn
  lỗi unrelated, không báo toàn bộ lint PASS.
- BROWSER_VERIFIED, phạm vi hạn chế: giao diện thật, nhập lệnh, debug engine,
  quay lại tự động, refresh, trạng thái disabled khi không có thiết bị;
  desktop 1440x900 và mobile 390x844.
- UNVERIFIED: Dashboard -> Android, kết quả tìm kiếm/phát video, assistance giữ
  Session và cancellation trên Android thật **trong M7a**. ADB ngoài sandbox
  trả danh sách trống. Chủ thiết bị sau đó chọn **“Kiểm thử Android sau”**;
  không thực hiện task Android nào và không bật owner mode.

Không gọi các test mô phỏng hoặc HTTP loopback với adapter giả là Android PASS.
Không lấy kết quả Camera M6a hay survey Clock M6c làm kết quả nghiệm thu M7a.

## 2. Inventory capability trước khi sửa

Đã đọc source và báo cáo M6a/M6b/M6c trước triển khai. Các mục dưới là contract
đang có, không phải cam kết mọi ứng dụng/thiết bị sẽ cung cấp đủ evidence.

| Capability thực tế | Action Plan | V1 | V2 | Verifier/contract được giữ |
| --- | --- | --- | --- | --- |
| Mở ứng dụng | Alias/exact package | Discovered app + goal | Catalog/intent handler | Foreground/native identity; V2 registered predicate hoặc intent proof |
| YouTube search và ordinal video | Target recipe + ConditionExecutor | SEARCH_RESULTS + DESTINATION | Generic SEARCH; không mặc nhiên có ordinal playback | Native search/query, exploration/interaction/postconditions và playback; V1 final criteria |
| Chrome/Google search, bài thứ N | Chrome recipe | Browser result goal | Generic SEARCH; không thay thế DOM ordinal verifier | Chrome DOM/native query/result/destination proof |
| Mở trang Wi-Fi, bật/tắt, kết nối SSID | Có workflow và xác nhận riêng | Không phải mutation engine | Typed setting path hoặc grounded state trong scope được hỗ trợ; không thay thế connect-SSID recipe | Wi-Fi page/switch/network readback gốc |
| Generic app search/navigation | AP giới hạn targets | FIND_ELEMENT/OPEN_PAGE, không phải mọi app search | Catalog, source-bound primitives, generic SEARCH | Native/DOM page criteria; search committed query + outcome proof |
| Đọc pin/Wi-Fi/độ sáng/âm lượng | Không phải API generic typed reads | Một số native information-location goal | Typed intents và independent state read | intent/state readback |
| Setting mutations | Wi-Fi-specific contract | Không | Full-control + journal/inverse | setting-mutations independent readback và restoration |
| URL, Settings action, dial prefill | Một số alias navigation | Không phải typed intent engine | Typed implemented intents | intent-executor receipts + independent verification; không gọi điện |
| Tính toán | Không có arithmetic outcome contract | Không | Arithmetic oracle + grounded widgets | Observed expression, locale-aware value verification |
| Chụp một ảnh | Không được dùng để bỏ outcome | Không được bỏ capture outcome | MediaStore baseline/delta + shutter/fallback grant | Artifact identity, owner/size/URI/time; M6a journal giữ nguyên |
| Tạo record/note | Không có persisted outcome contract | Không | Generic fields/persistence strategy registry | Stable/disambiguated identity và reopen/readback; thiếu proof thì BLOCKED |
| ALARM/TIMER | Không có temporal outcome contract | Không | M6b typed time + M6c UI fallback | PROVIDER_READBACK / UI_LIST_READBACK / UI_RUNNING_READBACK; không đổi tier |
| Exact media URI handoff | Không phải artifact pipeline | Không | Typed producer/consumer artifact | ARTIFACT_IDENTITY_VERIFIED; không gọi đó là Gallery UI search |
| Human Assistance | Legacy visual failure không tự nâng quyền | Screenshot point, retained Session | Typed choices, original Session/issued candidates | Fresh-state/token/policy/grounding checks của engine |
| Group execution | Không chuyển sang Worker | Existing START batch | Existing START batch | Registry device/physical isolation, cancel-batch; không viết lại trong M7a |

Source gốc: `app/api/commands/interpret/route.ts`, `app/api/executions/route.ts`,
`lib/android/condition-executor.ts`, `capabilities.ts`, `wifi-plan.ts`,
`agent/goal-planner.ts`, `agent/agent-loop.ts`, `agent/agent-v2.ts`,
`agent/capability-registry.ts`, `agent/verification-registry.ts`,
`agent/composite-verification.ts`, `agent/intent-capabilities.ts`,
`agent/setting-mutations.ts`, `agent/temporal-ui-runner.ts`.

## 3. Router và binding

`lib/android/unified-agent/capability-router.ts`:

| Yêu cầu | Quyết định mặc định | Điều kiện còn phải đạt |
| --- | --- | --- |
| Existing exact Wi-Fi recipe | ACTION_PLAN | Exact action recipe; policy và Wi-Fi confirmation cũ |
| Existing complete Chrome recipe | ACTION_PLAN | Không nuốt clause bổ sung; exact recipe và browser postconditions |
| Legacy ordinal result hoặc native information/page goal đã parse rõ | V1 | buildGoal coverage, discovered application và final criteria |
| Các typed/generic/multi-outcome còn lại | V2 preparation | Complete graph, implemented predicates, unique device app/handler |
| Mơ hồ sáng/chiều, app không rõ, unsupported outcome | ASK/BLOCK, không có executable reference | Người dùng làm rõ, phân tích lại |
| Mixed request có destructive/security/purchase action bị cấm | DENY toàn bộ | Không dispatch phần hợp lệ của câu lệnh |
| Debug engine | Chỉ tại analyze | Cùng coverage, backend và policy checks; không là bypass |

Router là **conservative dispatcher**, không phải model tự sáng tạo executor.
Không thử lần lượt các engine để tìm một engine chịu thực hiện. Engine được chọn
chỉ trở thành kế hoạch executable sau khi adapter chứng minh full coverage.
Không có app-specific selector/package/coordinate mới trong runtime.

`UnifiedAgentService` giữ private plan phía server. Client nhận `PlanView`,
không nhận AP authorization token, pending worker reference hay effect grant.
Sau admission, raw DeviceTask vẫn có batchId đã consume; nó không thể dùng để
replay START_PREPARED. Execute
strictly nhận reference; source/plan/engine/owner flag bổ sung bị HTTP 400.

Binding gồm source bất biến, serial, physical identity, engine, backend,
runtime digest, policy mode và current owner authorization ID. Context được đọc
lại sau analyze và trước execute. Reference được consume nguyên tử trước await
dispatch; kiểm thử concurrent replay chỉ dispatch một lần. Thời hạn facade
tối đa 85 giây, không vượt worker preparation 90 giây hoặc AP authorization cũ.
Restart làm mất reference và buộc analyze lại, không tự resume.

Reference chỉ cho phép **admission**, không thay thế Session/effect grant và
không hết hạn execution/assistance đã được engine tiếp nhận. Engine tiếp tục
áp dụng budget, owner expiry, cancellation và freshness riêng.

## 4. Facade, adapters và compatibility

- `app/api/unified-agent/route.ts`: same-origin local JSON; ANALYZE, EXECUTE,
  CONFIRM (Wi-Fi preflight), CANCEL, ASSIST; GET no-store lấy progress/history.
- AP adapter gọi lại chính `interpret.POST` và `executions.POST` trong tiến
  trình Next, đọc NDJSON gốc. **Không đưa ConditionExecutor vào Worker**.
- Worker `/planning` có bearer bảo vệ và strict schemas. PREPARE chỉ lập kế
  hoạch/catalog reads, không mở Session, không cấp effect grant. START_PREPARED
  chỉ nhận private reference; giữ source/device/owner binding và single-use.
- V1 lưu chính goal đã chuẩn bị, không gọi planner lần hai trước executor.
- V2 chuẩn bị bằng các constrained planners hiện có. Khi execute, giữ graph
  đó; không replan semantics. Model interpretation vẫn cần review theo policy
  V2; intent review, field/candidate/effect assistance và discovery vẫn chạy.
- Worker cũ/hash khác bị từ chối admission; yêu cầu restart **idle** worker,
  không tự kill task hay Session đang hoạt động.
- Các API cũ giữ schema và behavior. Default argument của engine cũ không đổi.
  Không sửa reasoning-provider, Groq Router, Ollama prompt/model hoặc environment.

Raw AP event/steps và raw DeviceTask được giữ trong ExecutionView. Chỉ map AP
SUCCESS thành COMPLETED khi **mọi step SUCCESS + VERIFIED** và final success
đồng ý; SENT vẫn SENT, FAILED vẫn FAILED. Không dùng HTTP 200/RPC receipt làm
completion. Unknown dispatch không retry/fallback. Worker response bị mất được
theo dõi bằng original batch reference và cancel cùng task, không gửi START lại.
Explicit worker pre-admission rejection là NOT_SENT/BLOCKED, không treo vô hạn
ở UNKNOWN_EFFECT.

Wi-Fi 409 confirmation là ngoại lệ đã chứng minh chưa dispatch: backend giữ
token riêng và chỉ retry cùng AP đã lưu sau confirm/binding/expiry checks.
Không retry sau lost response hoặc uncertain effect.

Assistance facade đối chiếu engine/device/physical/source và task WAITING_HUMAN,
rồi chuyển đúng token/choice hoặc screenshot point tới helper gốc. Không mint
quyền mới. Stop AP abort đúng request signal; không báo CANCELLED giả khi engine
trả actual failure/unknown. Stop Worker chuyển CANCEL tới original execution;
UI cũng giữ đường cancel task cũ sau khi reference facade bị mất.

## 5. Dashboard

- `AICommandPanel` mặc định render `UnifiedAgentPanel`; interface props cũ giữ
  nguyên. `LegacyAICommandPanel` được giữ để rollback UI, không là màn hình mặc định.
- One textarea/device + Phân tích/Thực thi/Dừng; natural-language plan, engine
  đã chọn, bước thực hiện, yêu cầu confirmation và raw verification evidence.
- Edit source/device/debug hoặc thay owner mode làm invalid reference trên UI;
  backend luôn kiểm tra độc lập, không tin trạng thái client.
- Engine select chỉ nằm trong mục Nội bộ/debug. Group dùng chính START batch
  cũ trong mục này, không thêm unified group planner.
- Owner/full-control giữ control và backend policy cũ. Không auto-enable mode.
- Giữ DeviceGrid/live preview, AgentTaskHistory và các phần graph/journal,
  artifacts, temporal proof tiers, screenshot/typed assistance của AgentGoalPanel.
- Phân tách metrics analysis và execution. Preparation giữ budget/model/provider/
  ADB measurements trong PlanView; không coi model calls execution-only là tổng
  inference của analyze + execute. AP interpreter cũ không có bộ metrics này;
  không suy ra số model calls bằng 0 khi thiếu measurement.

## 6. Validation và parity

Baseline evidence:
`C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6a-validation-qt0jct\summary.json`.

Full run trung gian: 887/887 (846 cũ + 41 M7a). Sau thêm Worker/V2 integration,
run kế tiếp 893/893. Hai test V2 tích hợp mới ban đầu dùng hierarchy trống và
thất bại vì FOREGROUND predicate yêu cầu visible node; fixture được sửa thành
hierarchy có TextView hợp lệ. Không nới verifier, không đổi expected completion.
Test foreign-device/unknown-effect vẫn phải BLOCKED, không có click.

`tests/unified-agent-m7a.test.cjs` bảo vệ:

- Router parity Wi-Fi/SSID, Chrome, YouTube ordinal, native settings, generic
  search, camera, alarm, timer, calculation và typed state/intent selection.
- Mixed destructive source kể cả debug; unsupported/missing coverage;
  ambiguity không cấp reference; non-Appium V2 không fallback.
- Client tamper, replay/concurrency, expiry/restart, identity/backend/hash/
  policy/owner changes và physical-device exclusion.
- Debug AP không được thêm HOME hay mở app ngoài yêu cầu; giữ nguyên chuỗi
  search/ordinal YouTube cũ. Đây là coverage validation của adapter, không sinh
  workflow mới hay nới quyền executor.
- Original evidence/raw assistance, SENT/FAILED mapping, lost admission,
  NOT_SENT rejection, Wi-Fi confirmation và cancel signal.
- V1 prepare-once + execute; V2 prepare + original verifier; review trước
  Session; foreign fresh observation blocked; Worker `/planning` qua loopback
  thật với adapter mô phỏng, auth/origin/strict schema/single use/cleanup.
- API cũ vẫn đòi authorization; SSR có một input và không có engine tabs mặc định.

| Validation cuối | Kết quả | Evidence |
| --- | --- | --- |
| Full regression | PASS 896/896, 51 files | `phone-commander-m6a-validation-Le28kZ/summary.json` |
| Riêng M7a | PASS 50/50 | `unified-agent-m7a.test.cjs.log` trong thư mục regression trên |
| TypeScript --noEmit --incremental false | PASS, exit 0 | `phone-commander-m7a-final-1pvjsP/typecheck.log` |
| ESLint toàn bộ file tạo/sửa M7a | PASS, 0 errors/warnings | `phone-commander-m7a-final-1pvjsP/scoped-lint.log` |
| Full ESLint | Known FAIL: 1 error, 9 warnings, không thêm lỗi M7a | `phone-commander-m6c-validation-xA332A/eslint-full.log` |
| next build --webpack | PASS, exit 0 | `phone-commander-m7a-final-1pvjsP/webpack-build.log` |
| git diff --check | PASS | Chạy lại sau cập nhật báo cáo |
| Secret scan | PASS, 335 files, 0 matching paths | `phone-commander-m7a-final-1pvjsP/secret-scan.json` |

Các thư mục evidence trên nằm dưới
`C:\Users\TRANDU~1\AppData\Local\Temp\`.
Final build/typecheck/lint manifest:
`phone-commander-m7a-final-1pvjsP/summary.json`.
Scan loại trừ env/dependencies/build/git/sealed/holdout/external tool logs;
không in giá trị key. Không cộng thời gian validation song song thành latency
Android hoặc inference benchmark.

Run `phone-commander-m6c-validation-xA332A` được giữ nguyên với exit 1: ngoài
full-lint known failure, TypeScript/build đã bắt TS2367 ở nhánh adapter so sánh
với phím SEARCH không tồn tại trong Action Plan schema. Đã bỏ nhánh ép kiểu
không cần thiết, giữ nguyên enum ENTER/BACK/HOME/volume của API cũ; rerun
TypeScript, scoped lint, build và toàn bộ regression trên source cuối PASS.
Không sửa summary thất bại hay assertions cũ để che kết quả.

Build đầu tiên thất bại do route mới export runtime/dynamic config không tương
thích Cache Components. Đã bỏ config thừa theo bundled Next docs, không đổi
next.config; build chạy lại thành công. Cảnh báo webpack createRequire trong
session-manager là cảnh báo hiện có, không tắt/bỏ dependency để che cảnh báo.
Full ESLint còn lỗi unrelated `ExecutionDetailModal.tsx:130:98` no-explicit-any
và 9 warnings; không sửa ngoài scope.

## 7. Browser và API thực tế

Đã thao tác trình duyệt thật trên `http://127.0.0.1:3000/`:
nhập câu lệnh, mở debug, chọn V2, trả về Automatic, đóng debug, refresh devices.
Main panel vẫn chỉ một command input. Không có thiết bị thì Analyze/Execute/
Stop và owner/full-control bị disable đúng. Kiểm tra ảnh ở 1440x900 và 390x844:
panel/nút/textarea không chồng hoặc tràn chữ; đã reset viewport sau thử.

Ảnh evidence (ngoài repo):

- `C:\Users\Tran Duy Khanh\.codex\visualizations\2026\10\10\01a126b9-c3fe-7b42-af37-41423958feb3\m7a-desktop.png`
- `C:\Users\Tran Duy Khanh\.codex\visualizations\2026\10\10\01a126b9-c3fe-7b42-af37-41423958feb3\m7a-mobile.png`

HTTP thực tế, không mock:

| Request | Kết quả |
| --- | --- |
| EXECUTE có client engine override | 400, invalid strict command |
| EXECUTE reference không được cấp | 409 BLOCKED, không dispatch |
| ANALYZE serial không kết nối | 409 BLOCKED, physical identity unavailable |
| GET unified | 200, no-store, 0 executions |
| GET runtime | 200, 0 active tasks, 0 owner modes |

Sau khi source chốt đã nạp lại đúng Next.js của project trong trạng thái idle,
không dừng process khác. Worker chỉ được shutdown bằng body rỗng sau khi xác
minh không có task/owner mode/inference; không dùng cancelActive. Kiểm tra cuối:
runtime HTTP 200, **0 active tasks, 0 owner modes**, worker digest khớp source.
23 historical tasks cũ vẫn được đọc lại, giữ nguyên BLOCKED/FAILED/COMPLETED/
CANCELLED; không tính chúng vào kết quả M7a. Unified có 0 executions vì chưa
admit bất kỳ task Android nào.

Đây là **BROWSER_VERIFIED empty-device controls + REAL_LOCAL_API rejection**,
không phải Dashboard-to-Android execution PASS. Browser effect confirmation,
human assistance resume và verified Android result vẫn UNVERIFIED.

## 8. File thay đổi

Tạo:
`app/api/unified-agent/route.ts`, `lib/android/unified-agent/contracts.ts`,
`lib/android/unified-agent/capability-router.ts`,
`lib/android/unified-agent/service.ts`, `lib/android/agent/prepared-v2.ts`,
`components/commands/UnifiedAgentPanel.tsx`, `tests/unified-agent-m7a.test.cjs`,
và báo cáo này.

Sửa:
`components/commands/AICommandPanel.tsx`, `components/commands/AgentGoalPanel.tsx`,
`lib/android/agent/goal-planner.ts` (export existing deterministic parser),
`device-runtime.ts`, `worker-server.ts`, `worker-client.ts`, `agent-v2.ts`.

Không sửa ConditionExecutor, agent-loop V1, settings mutation controller,
permission-decision, grants, journals, verifiers, runtime command schema cũ,
fixture/holdout/sealed, Groq/Ollama provider hoặc config.

## 9. Giới hạn và rollback

1. Chưa nghiệm thu Android M7a theo quyết định của chủ thiết bị. Không suy từ
   regression ra độ chính xác trên UI thật, generic capability hoặc AI autonomy.
2. Reference/facade AP history là memory của một Next process, tối đa 100 pending
   plans/40 finished-history target. Worker history cũ vẫn durable. Không hỗ trợ
   phân tán/multi-instance/serverless hay resume AP qua Next restart trong M7a.
   Khi chỉnh source trong development cần restart idle Next/Worker để không
   giữ singleton implementation cũ qua HMR; không migrate live executions.
3. Analysis không launch app hay mở Session để “thử trước”; full coverage và
   handler discovery không bảo đảm target UI sẽ observable. Fresh-state executor
   có quyền BLOCKED; không chuyển engine để vượt chặn.
4. Debug AP chỉ cấp reference khi chứng minh complete source coverage/recipe.
   Native find/page dùng V1, typed writes dùng V2. Không bọc arbitrary legacy
   model action list thành plan được tin cậy.
5. M7a không thêm timer/alarm/gallery verifier hay giải quyết thiếu UI evidence.
   Các giới hạn provider/UI/persistence của M6a/b/c giữ nguyên.
6. Semantic preparation adapter tái sử dụng các planner/validator hiện có, nhưng
   có nhánh eligibility tương ứng V2; cần giữ parity tests khi planner thay đổi.
   Không đổi các contract inference của engine.
7. Không tuyên bố hệ thống đã thành một autonomous general-purpose engine mới.
   Đây là facade/router trước các capability có contract sẵn; rules vẫn chiếm
   nhiều quyết định, LLM chỉ có thẩm quyền theo engine gốc.
8. Không có nghiệm thu model/Ollama/Groq thật trong M7a. Các test model-review
   dùng proposal giả có kiểm soát, không chứng minh reasoning hay tốc độ AI.

Rollback nhỏ: đổi wrapper `AICommandPanel` trở về `LegacyAICommandPanel`; API cũ
và ba engine vẫn tồn tại. Phải hoàn tất/cancel task và kiểm tra ownership trước
restart idle worker. Không reset working tree hoặc xóa thay đổi của người dùng.
