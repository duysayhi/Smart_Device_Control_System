# Phone Commander - Safe Refactoring

Ngày: 23/10/2026. Branch: `DuyTD`. Không commit/push.

## 1. Kết luận và phạm vi

Đã thực hiện hai nhóm thay đổi nhỏ: loại một cụm UI không có consumer và gom hai utility thuần đang trùng giữa V2 preparation/execution. Không hợp nhất các engine, executor, verifier hoặc policy khác ngữ nghĩa. Production giảm ròng **2 file, 462 dòng, 18.956 byte**. Không thêm/xóa/nâng cấp dependency.

Đã giữ nguyên các thay đổi M7a/M7a Fix có sẵn, bao gồm giao diện tab Action Plan/Goal Agent và điều khiển nhóm. Chỉ bốn module production được chỉnh và hai component không được sử dụng được xóa trong yêu cầu này. Thêm hai file characterization test; không sửa test cũ.

**Không khẳng định full regression xanh:** baseline hiện tại có 27 failure và sau thay đổi vẫn đúng 27 failure đó. 26 test mới PASS. TypeScript, scoped/full ESLint và production webpack build đều exit 0; lint còn 3 warning và build có cảnh báo `createRequire`.

Không gọi Android, API worker sống hoặc cloud AI; không chạy acceptance/benchmark. Không mở cohort sealed/holdout. Một test phụ thuộc fixture có tên holdout được loại khỏi cả hai lượt regression; chi tiết mục 7. Không sửa dữ liệu người dùng, cấu hình bí mật, logs/evidence có sẵn hoặc lockfile.

## 2. Audit trước thay đổi

Đã đọc source entry points và báo cáo M7a, M7a Acceptance, M7a Fix mới nhất; không chỉ dùng kết luận báo cáo cũ. Working tree ban đầu đã dirty. Danh sách nguyên trạng nằm tại `coverage/safe-refactor-K0ftQv/baseline/working-tree.txt`.

Audit AST toàn bộ inventory source được phép trong `app`, `components`, `hooks`, `lib`, `types`, `scripts`, `tests`: **296 file TS/TSX/JS/CJS/MJS**, trong đó **178 module production**; **1.624 literal import/require edges**. Có đọc các entry point framework, script spawn và cấu hình build để không đánh đồng zero-inbound với dead code. Đây là inventory toàn bộ phạm vi, không phải chứng minh ngữ nghĩa bằng cách đọc thủ công từng hàm.

Không thấy production `import()`/`require()` với argument phi literal trong scanner. Vẫn kiểm tra riêng đường dẫn script tạo bằng `join`, framework routes, string references và CSS source scanning. Đồ thị chứa cả type-only edges; không phải runtime trace hoặc bằng chứng mọi nhánh đã chạy.

Evidence inventory trước/sau, export names, hashes và phân loại từng file:

- `coverage/safe-refactor-K0ftQv/dependency-before.json`
- `coverage/safe-refactor-K0ftQv/dependency-after.json`
- `coverage/safe-refactor-K0ftQv/classifications.json`
- `coverage/safe-refactor-K0ftQv/final/source-safety-check.json`

Phân loại 296 file ban đầu: **KEEP 238 / MERGE 4 / REMOVE 2 / REQUIRES_REVIEW 52**. MERGE nghĩa là gom trách nhiệm trùng, không xóa các module caller. REQUIRES_REVIEW không có nghĩa file bị lỗi hoặc không được dùng.

## 3. Luồng và dependency graph

Luồng trước và sau giữ nguyên:

```text
Dashboard -> AICommandPanel -> UnifiedAgentPanel / CommandEngineControl
  -> /api/unified-agent -> UnifiedAgentService -> capability-router
       Action Plan -> /api/commands/interpret + /api/executions
                   -> createExecutionContext -> ConditionExecutor / legacy adapter
       V1 / V2     -> worker-client -> scripts/agent-worker.cjs
                   -> worker-server -> DeviceRuntime
                      V1 -> runAgent -> grounded execution context
                      V2 -> prepareV2 / runAgentV2 -> capabilities / intent / temporal execution

Old HTTP APIs /api/agent, /api/executions, /api/commands/interpret vẫn tồn tại.
Observer, grants, permission, journals và independent verifiers giữ nguyên đường gọi.
```

Bằng chứng: `app/page.tsx:8,120` dùng AgentTaskHistory; `components/commands/AICommandPanel.tsx:156` dùng UnifiedAgentPanel; `app/api/unified-agent/route.ts:36,38,44,47` nối worker preparation/start/cancel/assistance; `app/api/executions/route.ts:88,123` tạo execution context và dispatch; `lib/android/agent/device-runtime.ts:254,271` dispatch V2/V1.

Thay đổi cục bộ trong graph:

```text
Trước: TaskQueue -> ExecutionDetailModal        [không có inbound từ app]
Sau:   bỏ cả hai; Dashboard -> AgentTaskHistory [không đổi]

Trước: prepareV2 và runAgentV2 mỗi nơi tự bọc source reference,
       mỗi nơi tự tính cùng một phrasing-review predicate.
Sau:   cả hai -> cloud-command.bindCommandSource
       cả hai -> reviewed-phrasing.needsPhrasingReview
```

| Chỉ số | Trước | Sau | Chênh lệch |
|---|---:|---:|---:|
| Production modules | 178 | 176 | -2 |
| Production -> production literal edges | 924 | 918 | -6 |
| Mọi literal edges, gồm tests/scripts | 1.624 | 1.623 | -1 |
| Source/test/script file trong inventory | 296 | 296 | 0: xóa 2 UI, thêm 2 tests |

Các nhóm strongly-connected components vẫn giữ kích thước `37,5,3,2,3` (có type edges). Không tuyên bố đã loại cycle hoặc giảm độ phức tạp toàn bộ các engine. Evidence: `cycles.json` trong thư mục audit.

## 4. KEEP / MERGE / REMOVE / REQUIRES_REVIEW

| Phân loại | File/nhóm | Lý do và hành động |
|---|---|---|
| REMOVE | `components/executions/TaskQueue.tsx` | Zero inbound từ source/API/hooks/scripts/tests; không có runtime path loader; Dashboard không mount component này. Xóa 275 dòng. |
| REMOVE | `components/executions/ExecutionDetailModal.tsx` | Consumer duy nhất là TaskQueue trong cụm vừa chứng minh không reachable. Xóa 189 dòng. |
| MERGE | `lib/android/agent/cloud-command.ts:7` | Thêm `bindCommandSource`, gom wrapper tương đương từ hai caller, không đổi provider hoặc cloud opt-in. |
| MERGE | `lib/android/agent/reviewed-phrasing.ts:9` | Thêm `needsPhrasingReview`, giữ nguyên biểu thức, precedence, masking và normalization. |
| MERGE | `lib/android/agent/prepared-v2.ts:18,22` | Gọi hai helper; không thay planning/review contract. |
| MERGE | `lib/android/agent/agent-v2.ts:132,234` | Gọi hai helper; không đổi vòng lặp hoặc thứ tự security checks. Giữ các sửa M7a Fix trước đó. |
| KEEP | Next API routes/layout/page; `scripts/agent-worker.cjs` | Framework roots / worker spawn là consumer runtime dù có thể không có import inbound. Worker-client spawn script tại `worker-client.ts:17`. |
| KEEP | Unified panel, CommandEngineControl, AgentTaskHistory, DeviceScreen | Có luồng Dashboard hiện hành; không quay về UI cũ hoặc xóa hỗ trợ nhóm. |
| KEEP | LegacyAICommandPanel, các type/mock-data/hook export còn lại | Không xóa chỉ vì ít named imports. Giữ rollback API và các consumer hook/type đang dùng. |
| KEEP | Validators, permissions, grants, journals, locks, cancellation, provider config | Không có chứng minh các semantics có thể gộp; byte hashes giữ nguyên. |
| REQUIRES_REVIEW | ConditionExecutor, agent-loop, phần còn lại agent-v2/device-runtime, intent/temporal runners | Trách nhiệm chồng lấn nhưng khác contract, freshness, ownership và recovery. Không tách/gộp ở lượt này. |
| REQUIRES_REVIEW | action-verifier, verification-registry, composite-verification, legacy postconditions | Đều xác minh nhưng khác evidence/outcome. Không thay thế chéo dựa trên code nhìn giống nhau. |
| REQUIRES_REVIEW | StateObserver/hybrid observer/grounded interactions/UIExplorer | Freshness, source và quyền đọc khác nhau; chưa đủ characterization để gộp. |
| REQUIRES_REVIEW | CJS TypeScript loaders trong scripts/tests | Khác alias resolution, filename, transpilation options và module side effects; giữ CLI/runtime contracts. |

`app/globals.css` có source scan cho thư mục components: đó là build-time utility discovery, không phải runtime component loader. Xóa cụm dead UI có thể bỏ utility CSS chỉ dùng bởi cụm đó; không claim CSS bundle byte-identical. Không có package export công khai trỏ hai file bị xóa. Các type `TaskQueueItem` còn consumer nên được giữ.

Dependency audit giữ toàn bộ package: zod cho schema; fast-xml-parser cho UI XML; sharp cho ảnh; lucide-react cho UI; clsx/tailwind-merge cho `cn`; Next/React cho framework. TypeScript còn được import thực ở `goal-compiler.ts:2` cho arithmetic parser và được dùng bởi worker CJS loader, không phải dev-only code có thể xóa tùy ý. Tailwind loader được tham chiếu bằng string ở `next.config.ts:13`; type packages qua compiler. Không kết luận package unused chỉ bằng tìm import TS.

## 5. Hai nhóm refactor và bằng chứng bảo toàn

### Nhóm 1: dead UI island

Thêm `tests/safe-refactoring-ui.test.cjs` **trước** khi xóa. Hai characterization tests PASS trước/sau:

1. Toàn bộ initial Dashboard SSR byte-identical, fetch bị cấm trong test; markup 32.936 byte, SHA-256 `6712b6546cc578ca373826b5120a6f27bc35bdd10bd5d63ace81bc06766bd781`. Có AgentTaskHistory, không có queue cũ.
2. Không có external source/script references đến hai component ngoài cụm hai file.

Nhóm 1: **17/17 test liên quan PASS**, TypeScript PASS, scoped ESLint PASS, diff check PASS rồi mới chuyển nhóm tiếp theo. SSR không chứng minh toàn bộ tương tác browser/mobile; không báo browser acceptance PASS từ test này.

### Nhóm 2: exact planning utilities

Thêm `tests/safe-refactoring-planning.test.cjs`, xác nhận thiếu helper trước implementation, sau đó gom code:

- 15 biến thể câu lệnh so predicate mới với nguyên biểu thức cũ; không mutate outcome graph.
- 7 biến thể input kiểm tra primitive/null/object/array, clone semantics và chống thay source reference từ payload giả.
- Kiểm tra lazy provider call, một reference cho mỗi wrapper, giữ `this`, schema/system/budget/signal và exact promise/error identity.
- Kiểm tra command-text opt-in, authenticated source và sensitive withholding bằng provider giả, không có network call. Env chỉ thay tạm trong process test rồi restore, không sửa file cấu hình.

Nhóm 2: **258/258 test liên quan PASS**, TypeScript PASS, scoped ESLint PASS, diff check PASS. `issueCloudCommand`, WeakMap và cloud redaction logic không bị thay. Import `JsonReasoner` là type-only, không thêm provider runtime dependency/call khi tạo wrapper.

Hai test file mới có **26 test, 97 dòng**. Chúng bổ sung bảo vệ hành vi, không thay kỳ vọng test cũ. Cùng pipeline regression, all existing test names/failures/pass counts trước/sau khớp nhau: `regression-parity.json`, `existingTestChanges: []`.

## 6. Số dòng và phạm vi thay đổi thực tế

| Production file | Dòng trước -> sau | Byte chênh lệch |
|---|---:|---:|
| agent-v2.ts | 621 -> 614 | -681 |
| cloud-command.ts | 19 -> 26 | +379 |
| prepared-v2.ts | 46 -> 40 | -659 |
| reviewed-phrasing.ts | 20 -> 28 | +595 |
| TaskQueue.tsx | 275 -> 0 | -10.962 |
| ExecutionDetailModal.tsx | 189 -> 0 | -7.628 |
| **Tổng production** | **-462** | **-18.956** |

Số dòng tính cùng một phương pháp trước/sau, gồm dòng trống. Tính cả 97 dòng tests mới: net source/test giảm 365 dòng; không tính tài liệu/generated evidence. Giảm ít dòng ở helper là chấp nhận được: mục tiêu là chỉ còn một implementation được kiểm tra, không ép giảm số file bằng abstraction thừa. Số dependency thay đổi: **0**.

Hash comparison xác nhận mọi source file ban đầu ngoài sáu file trên giữ nguyên, kể cả API routes, schemas, Unified service/router/UI, worker, policy/grants/journals, providers, observers/verifiers và tests có sẵn. Không dùng `git diff HEAD` để gán nhầm các sửa trước đó cho refactor này.

## 7. Validation và baseline thật

Báo cáo M7a Fix ghi lịch sử **1107/1107** và lưu ý đã bổ sung tests sau lượt đó. Inventory hiện tại khác mốc lịch sử; không dùng 1107 làm kết quả chạy mới.

Full regression được chạy với phạm vi an toàn: enumerate direct `tests/*.test.cjs`, lần lượt `node --test`, giữ nguyên test contents; **loại `general-agent-v2-open-world.test.cjs` (6 tests)** vì test đó import fixture có tên holdout. Không đọc/chạy fixture đó, không chạy benchmark/cohort. Không tuyên bố đây là full suite không ngoại lệ.

| Validation | Kết quả thực |
|---|---|
| Baseline trước production edits | 60 file; **1097 PASS / 27 FAIL / 1124 tổng** |
| Final regression cùng phạm vi + tests mới | 62 file; **1123 PASS / 27 FAIL / 1150 tổng** |
| Existing test parity | 60/60 file giữ nguyên pass count và failure names; không có regression mới quan sát được |
| Tests mới | **26/26 PASS** |
| TypeScript `tsc --noEmit --incremental false` | PASS, 22,75 s ở lượt cuối |
| Scoped ESLint, 4 module + 2 test file | PASS, 73,42 s |
| Full `eslint .` | PASS/exit 0, **0 errors / 3 warnings**, 44,76 s |
| `next build --webpack` | PASS/exit 0, 109,44 s; compile/TS/prerender/traces xong, có warning nêu dưới |
| `git diff --check` | PASS cả sau khi tạo báo cáo; còn cảnh báo Git LF/CRLF, không có whitespace error |
| Secret scan | 7 file thay đổi còn tồn tại, không có token/private-key pattern độ tin cậy cao; không đọc secret config, không phải kiểm toán secrets toàn repo |
| Android / live cloud inference / browser acceptance | **UNVERIFIED**, không thực hiện trong yêu cầu refactor |

27 failures đều có từ baseline và tái hiện cùng test names:

| Nhóm test | Số FAIL | Triệu chứng / phạm vi kết luận |
|---|---:|---|
| agent-v2-catalog-cache | 8 | EPERM khi atomic rename file tạm |
| general-agent-v2-discovery-execution | 1 | EPERM atomic rename route-hint |
| wireless-connectivity | 1 | EPERM atomic rename simulated wireless store |
| general-agent-v2-m5b-security | 1 | `fetch failed` với mock HTTP worker |
| multi-device-runtime | 2 | `fetch failed` với mock HTTP worker |
| owner-authorized-test-mode | 1 | `fetch failed` với mock HTTP worker |
| unified-agent-m7a | 1 | `fetch failed` với loopback worker |
| groq-router | 12 | Mock loopback transport không trả expected mock choice/status; local ABSTAIN/fallback. Không phải real Groq calls |

Các triệu chứng phù hợp hạn chế filesystem/loopback của môi trường nhưng chưa xác minh nguyên nhân hệ điều hành ngoài sandbox. Không sửa runtime/test để biến chúng thành PASS, không suy ra ứng dụng đã hoàn toàn không có lỗi. First baseline log từng ghi ở TEMP không được bảo toàn qua tool invocation; đã chạy lại baseline trên source chưa sửa và lưu evidence trong workspace, cùng kết quả 1097/27.

Full ESLint cũ trong M7a Fix: 1 error/9 warnings, error `no-explicit-any` ở modal cũ. Error biến mất vì **component dead bị xóa có bằng chứng**, không phải sửa active logic hay tắt rule. Còn warning unused `FileJson`, `cn` trong ActionPlanPreview và `Maximize2` trong DeviceFilters; giữ ngoài phạm vi nhóm refactor này.

Build EPERM lịch sử **không tái hiện ở lượt build cuối**. Cảnh báo còn lại: webpack `module.createRequire failed parsing argument`, tại `lib/android/appium/session-manager.ts:80`, import trace qua API devices. Module không đổi ở lượt này; build PASS không chứng minh Appium thật khởi tạo được. Không đổi cấu hình để giấu cảnh báo. Feedback pass theo AGENTS đã thử nhưng CLI không kiểm tra được feedback-enabled do network, kể cả retry có network permission; không gửi source/key.

## 8. Capability, API và security preservation

- Action Plan interpret/execute, V1, V2, Unified analyze/execute/cancel/assistance routes giữ nguyên source hash và contract.
- YouTube ordinal/playback, Chrome/Google, Wi-Fi workflows, state reads/settings, dial prefill, camera, alarm/timer, record persistence không bị di chuyển/xóa/gộp; tests tương ứng thuộc existing parity. Không coi mock PASS là real-device verification cho các capability này.
- Không thêm fallback engine sau dispatch; `actionPlanCompletion` vẫn yêu cầu mọi step VERIFIED mới thành COMPLETED (`service.ts:34`).
- Permission M6a, full-control/ordinary owner scope, grants, journal, freshness/revalidation, identity/session ownership, locks, cancellation và anti-replay giữ nguyên byte hash trong inventory.
- Không đổi file data/history/cache format hoặc model/provider config. Không kích hoạt warmup/Android khi audit. Các thay đổi env trong tests được restore và không ảnh hưởng server process.

Đây là bằng chứng source/hash + offline behavioral parity, **không phải chứng minh hình thức tất cả runtime behaviors**. Những failure môi trường và excluded tests giới hạn độ chắc chắn; cần chạy lại suite đầy đủ trong môi trường được phép trước release.

## 9. Chưa đủ bằng chứng để refactor

Không tách các module lớn chỉ theo số dòng. agent-v2 còn 614 dòng, ConditionExecutor khoảng 540 dòng, useDashboardDemo 386 dòng; cần characterization về mutation boundaries, unknown-effect và cancellation interleavings trước khi di chuyển logic.

Không gom verification-registry/composite/legacy postconditions; không đổi observer provenance; không gộp các API schemas trông giống nhưng khác trust boundary; không đổi mock-data/hook exports khi còn consumer. Không xóa scripts vì không có production import: worker và acceptance tooling là runtime roots riêng. Không giảm dependency bằng cách thay parser/schema/image stack bằng code tự viết.

Rollback riêng thay đổi lượt này: dùng snapshot `coverage/safe-refactor-K0ftQv/source-before/<path>.before` để khôi phục đúng sáu file về trạng thái đầu lượt; hai file test mới có thể giữ để kiểm tra hoặc bỏ trong rollback có chủ đích. Không dùng reset/checkout HEAD vì có thể mất M7a Fix chưa commit. Snapshot/evidence mới nằm trong `coverage/` đã được ignore; không dọn dữ liệu cũ.

Sau thay đổi source, server/worker đang chạy trước đó có thể vẫn mang runtime hash cũ. Lượt này không restart hoặc tác động process thật; trước nghiệm thu Android lần tới phải reload worker khi idle theo protocol hiện có.

## 10. Evidence index

Thư mục evidence mới: `coverage/safe-refactor-K0ftQv/` (ignored, chỉ tại máy).

- `baseline/summary.json`, `baseline/*.log`: baseline test names/counts/errors.
- `group-1/`, `group-2/`: targeted tests, typecheck, scoped lint theo từng nhóm.
- `final/regression.json`, `final/*.test.cjs.log`: kết quả final và triệu chứng từng failure.
- `regression-parity.json`: so failure names/pass counts trước/sau.
- `final/validation.json`, `final/typecheck.log`, `final/eslint-scoped.log`, `final/eslint-full.log`, `final/webpack-build.log`, `final/diff-check.log`: validation cuối.
- `dependency-before.json`, `dependency-after.json`, `classifications.json`, `metrics.json`, `cycles.json`, `final/source-safety-check.json`: inventory, graph và thay đổi đo được.
- `final/final-safety-check.json`: kiểm lại hashes các file không thuộc refactor, secret scan giới hạn và diff check sau báo cáo.
- `dashboard-before.html`, `source-before/`: characterization snapshot và bản nguồn đầu lượt của các file được sửa/xóa.

Không commit/push; không triển khai thêm tính năng hoặc Agent version/pipeline mới.
