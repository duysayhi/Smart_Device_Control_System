# Core Freeze: Cổng 0 Preflight

Ngày 26/10/2026. **Cổng 0 PASS; dừng chờ chủ dự án xác nhận Cổng 1.**
Đang ở `DuyTD`, HEAD `01525d92412eb1779855beec0e359037a79873d0` (2026-10-22 07:14:05 +07:00, `feat: add Agent V2 capabilities and temporal UI evidence`).
Đã sao lưu working tree thực tế, không chỉ HEAD: 41 sửa, 2 xóa có sẵn, 49 untracked không ignore; không thay đổi index/HEAD/nhánh đang làm việc.
Baseline chạy mới **1358 PASS / 0 FAIL / 6 TODO**, đúng mốc yêu cầu; không sửa test hoặc assertion.
Chưa sửa C17/C18/UI, chưa chạy browser acceptance, TypeScript/lint/build hoặc Android; chưa đóng băng core/tag.

## Kết quả

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| Branch / HEAD | PASS: DuyTD / 01525d92412eb1779855beec0e359037a79873d0 | preflight.json |
| Inventory trước sửa | 92 path: 41 M, 2 D, 49 ??; danh sách đầy đủ bên dưới | preflight.json |
| Backup riêng | PASS: `codex/backup-freeze-core-gate0-2026-10-26` | backup-result.json |
| Commit snapshot local | `d4f11c754e07b9a3f543e811a1b8cec3e6e78d23` | tree `3304637aa7452400b182b6da318e65dc9529e236` |
| Snapshot so HEAD cũ | 92 files changed, 8607 insertions, 1043 deletions; gồm nội dung untracked | git diff --shortstat |
| HEAD/index/branch hiện tại | PASS: không đổi, không checkout/stash/reset | backup-result.json; gate0-result.json |
| Full regression mới | PASS: 1364 entries, 1358 pass, 0 fail, 6 todo, 0 skip/cancel, exit0 | full-regression.log / full-regression-result.json |
| Thời gian | Node182.214s; wrapper182.342s, hai span lồng nhau không cộng | full-regression-result.json |
| Integrity sau test | 309 safe source/test/script +7 config so C1-Final không drift; 92 path đầu lượt nguyên hash/tình trạng | gate0-result.json |
| Secret scan trước backup | 0 high-confidence finding trong file ứng viên; không đọc .env/key | backup-result.json |
| Device/model acceptance | NOT_RUN, không được phép trước Cổng 4 | Không chạy adb/Appium/Ollama/cloud |
| Các cổng 1-5 | NOT_STARTED | Dừng theo yêu cầu, không coi backup là core-freeze |

## Phạm vi backup và file lượt này

Snapshot dùng **temporary Git index**, `read-tree HEAD` để giữ blob cũ, rồi stage đúng 92 path dirty/untracked, `write-tree`, `commit-tree`, `update-ref` tạo branch backup; không đưa thay đổi vào index thật hoặc commit trên DuyTD. Hai deletion có sẵn được giữ đúng trạng thái, không phải xóa mới. Không push và không tag. Snapshot không chứa báo cáo Cổng 0 được tạo sau snapshot.

Theo .gitignore, không thêm node_modules, .next, coverage/evidence, logs/data bị ignore hoặc secret vào Git. Những file bị ignore vẫn giữ nguyên tại máy; snapshot Git **không phải backup toàn bộ ổ đĩa**. Sealed/holdout/open-world không được đọc; blob HEAD không đổi được tái dùng. Không sửa env/config/provider/dependency.

**File application/test/config sửa mới trong lượt: không có.** Chỉ tạo báo cáo này và evidence/harness offline tại `coverage/core-freeze-gate0-Zq2c16/`:
- `backup-working-tree.cjs`: snapshot local với temporary index, kiểm tra index/HEAD/working tree.
- `offline-tripwire.cjs`: preload chặn fetch ngoài loopback do chính test mở và process ADB/Appium/Ollama/agent-worker; không đổi env ứng dụng.
- `run-baseline.cjs`: runner dùng đúng manifest69, concurrency1, TAP, log đầy đủ.
- `preflight.json`, `backup-result.json`, `regression-invocation.json`, `full-regression.log`, `full-regression-result.json`, `gate0-result.json`, các `tripwire-<pid>.json`.

68 counter files thu được ghi 0 blockedNetwork/blockedProcesses, 71 lượt fetch loopback được guard cho phép tới mock server test. Đây là telemetry của test harness, **không phải đo global state của dịch vụ/điện thoại người dùng hoặc đo model-call production**. Baseline dùng fake adapters/providers; không khởi chạy worker/device/inference thật.

Không sửa test, nên AST assertion before/after và bảng coverage cho thay đổi test **không áp dụng** ở Cổng 0. Không loại sáu TODO hoặc dùng TODO làm PASS. Không nâng kết quả browser/Android từ báo cáo lịch sử.

## Lệnh và số lần

| Nhóm lệnh | Số lần trong cổng | Ghi chú |
|---|---:|---|
| `git status` | 3 trước báo cáo; thêm 1 kiểm tra cuối | short branch, porcelain đầy đủ và snapshot preflight; không sửa index |
| `git log -1` | 2 | Kiểm tra trực tiếp và metadata snapshot |
| Script backup | 1 | Bên trong read-tree/add/write-tree/commit-tree/update-ref mỗi lệnh1; local, index tạm |
| `git show --no-patch` / `git diff --shortstat` backup | Mỗi lệnh1 | Xác nhận commit/parent và snapshot chứa dirty tree |
| Full regression | **1** | Ngoài sandbox ngay từ đầu để fake HTTP loopback hoạt động; không có run sandbox lỗi rồi retry |
| Integrity/evidence checks | Sau snapshot và sau test | Không thay core |
| Browser acceptance / tsc / ESLint / production build | **0** | Để đúng các cổng sau; không chạy build sớm |
| Android/ADB/Appium/model/cloud | **0 lần chủ động chạy** | Không có acceptance thật, không tạo mode/grant |

Lệnh regression thực tế trong invocation JSON:

```powershell
& 'C:\nvm4w\nodejs\node.exe' coverage/core-freeze-gate0-Zq2c16/run-baseline.cjs
```

Runner gọi Node `--require <evidence>/offline-tripwire.cjs --test --test-concurrency=1 --test-reporter=tap` với 69 đường dẫn rõ ràng từ manifest đã duyệt ở `coverage/engine-merge-b-final-QNztNa/source-before.json`; không glob tests hoặc import excluded cohorts.

## Điểm dừng và bước kế tiếp

Không chạm điều kiện STOP do baseline khác mốc: số thực đo khớp chính xác. **Đã tới điểm dừng bắt buộc sau Cổng 0**, chờ xác nhận rồi mới Cổng 1.
C17/C18 và hai nhãn/nút UI chưa sửa; không coi bước sao lưu/regression này là hoàn tất nền Unified V2. Kết quả build/Android lịch sử không được tính là validation mới. Chưa tạo tag `core-freeze-2026-10-26`.

## Inventory nguyên trạng đầu lượt

M = file đã sửa, D = deletion có sẵn, ?? = untracked lúc snapshot. Tất cả dưới đây thuộc thay đổi đã tồn tại trước Cổng 0, không phải thay đổi do lượt này tạo.

| Trạng thái | File |
|---|---|
| M | `app/api/agent/route.ts` |
| M | `app/api/agent/runtime/route.ts` |
| M | `app/api/commands/interpret/route.ts` |
| M | `app/api/executions/route.ts` |
| M | `components/commands/AICommandPanel.tsx` |
| M | `components/commands/AgentGoalPanel.tsx` |
| D | `components/executions/ExecutionDetailModal.tsx` |
| D | `components/executions/TaskQueue.tsx` |
| M | `lib/android/action-verifier.ts` |
| M | `lib/android/agent/agent-v2.ts` |
| M | `lib/android/agent/capability-registry.ts` |
| M | `lib/android/agent/cloud-command.ts` |
| M | `lib/android/agent/device-runtime.ts` |
| M | `lib/android/agent/effect-grants.ts` |
| M | `lib/android/agent/evidence-predicates.ts` |
| M | `lib/android/agent/generic-search.ts` |
| M | `lib/android/agent/goal-compiler.ts` |
| M | `lib/android/agent/goal-graph.ts` |
| M | `lib/android/agent/goal-planner.ts` |
| M | `lib/android/agent/grounded-candidates-v2.ts` |
| M | `lib/android/agent/intent-capabilities.ts` |
| M | `lib/android/agent/intent-executor.ts` |
| M | `lib/android/agent/launcher-label-cache.ts` |
| M | `lib/android/agent/launcher-labels.ts` |
| M | `lib/android/agent/outcome-spec.ts` |
| M | `lib/android/agent/owner-test-policy.ts` |
| M | `lib/android/agent/reviewed-phrasing.ts` |
| M | `lib/android/agent/search-executor.ts` |
| M | `lib/android/agent/temporal-contract.ts` |
| M | `lib/android/agent/temporal-ui-inventory.ts` |
| M | `lib/android/agent/temporal-ui-runner.ts` |
| M | `lib/android/agent/temporal-ui.ts` |
| M | `lib/android/agent/verification-registry.ts` |
| M | `lib/android/agent/worker-client.ts` |
| M | `lib/android/agent/worker-server.ts` |
| M | `lib/android/condition-executor.ts` |
| M | `lib/android/grounded-interactions.ts` |
| M | `lib/android/hybrid-context-observer.ts` |
| M | `lib/android/media-playback-verifier.ts` |
| M | `tests/chrome-command-planning.test.cjs` |
| M | `tests/multi-device-runtime.test.cjs` |
| M | `tests/owner-authorized-test-mode.test.cjs` |
| M | `tests/wifi-confirmation-route.test.cjs` |
| ?? | `app/api/unified-agent/route.ts` |
| ?? | `components/commands/CommandEngineControl.tsx` |
| ?? | `components/commands/UnifiedAgentPanel.tsx` |
| ?? | `docs/alarm-command-localized-discovery-fix.md` |
| ?? | `docs/dashboard-bootstrap-diagnosis.md` |
| ?? | `docs/dashboard-browser-acceptance.md` |
| ?? | `docs/demo-capabilities.md` |
| ?? | `docs/engine-merge-report.md` |
| ?? | `docs/safe-refactoring-report.md` |
| ?? | `docs/unified-agent-m7a-acceptance-report.md` |
| ?? | `docs/unified-agent-m7a-fix-report.md` |
| ?? | `docs/unified-agent-m7a-report.md` |
| ?? | `lib/android/agent/browser-result-contract.ts` |
| ?? | `lib/android/agent/browser-result.ts` |
| ?? | `lib/android/agent/prepared-v2.ts` |
| ?? | `lib/android/unified-agent/capability-router.ts` |
| ?? | `lib/android/unified-agent/clarification.ts` |
| ?? | `lib/android/unified-agent/contracts.ts` |
| ?? | `lib/android/unified-agent/demo-catalog.ts` |
| ?? | `lib/android/unified-agent/legacy-entry.ts` |
| ?? | `lib/android/unified-agent/legacy-execution-handler.ts` |
| ?? | `lib/android/unified-agent/legacy-interpret-handler.ts` |
| ?? | `lib/android/unified-agent/service.ts` |
| ?? | `pnpm-workspace.yaml` |
| ?? | `scripts/unified-agent-m7a-acceptance.cjs` |
| ?? | `scripts/unified-agent-m7a-clock-probe.cjs` |
| ?? | `scripts/unified-agent-m7a-fix-acceptance.cjs` |
| ?? | `tests/command-engine-controls.test.cjs` |
| ?? | `tests/engine-merge-boundaries.test.cjs` |
| ?? | `tests/engine-merge-catalog-gate.test.cjs` |
| ?? | `tests/engine-merge-p1-v2.test.cjs` |
| ?? | `tests/engine-merge-single-path.test.cjs` |
| ?? | `tests/engine-merge-source-characterization.test.cjs` |
| ?? | `tests/helpers/internal-legacy-router.cjs` |
| ?? | `tests/helpers/internal-legacy-unified-service.cjs` |
| ?? | `tests/launcher-localized-labels.test.cjs` |
| ?? | `tests/media-playback-postcondition.test.cjs` |
| ?? | `tests/read-state-execution.test.cjs` |
| ?? | `tests/read-state-semantics.test.cjs` |
| ?? | `tests/read-state-session-binding.test.cjs` |
| ?? | `tests/safe-refactoring-planning.test.cjs` |
| ?? | `tests/safe-refactoring-ui.test.cjs` |
| ?? | `tests/temporal-command-boundary.test.cjs` |
| ?? | `tests/temporal-m7a-editor-protocol.test.cjs` |
| ?? | `tests/temporal-m7a-fixes.test.cjs` |
| ?? | `tests/temporal-m7a-scroll-grounding.test.cjs` |
| ?? | `tests/unified-agent-m7a-fixes.test.cjs` |
| ?? | `tests/unified-agent-m7a.test.cjs` |
| ?? | `tests/unified-engine-coverage.test.cjs` |

