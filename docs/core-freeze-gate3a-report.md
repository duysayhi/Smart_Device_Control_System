# Core Freeze: Cổng 3a - Snapshot, TypeScript, ESLint

**Trạng thái hiện tại, sau phê duyệt tooling scope ngày 27/10/2026: 3a PASS, ESLint còn4 warning cũ.**
Chỉ thêm coverage vào exclude của tsconfig và globalIgnores của ESLint; không đổi rule, compiler options, source/test hoặc evidence cũ.
Lượt chạy lại được duyệt: tsc đúng1 lần exit0/0 diagnostic; ESLint đúng1 lần với nguyên5 CLI exclusions, exit0/0 errors/4 warnings.
Không sửa source nên không chạy regression. Snapshot hậu-validation dùng nhánh `codex/core-freeze-gate3a-tooling-2026-10-27`, temporary index, gồm hai cấu hình và báo cáo này; không đổi DuyTD/index/HEAD, không push.
**Dừng chờ xác nhận3b. Mục8 là kết quả hiện hành; mục1-7 bên dưới giữ lịch sử lượt đầu FAIL, không thay verdict hoặc evidence cũ thành PASS.**

## Lịch Sử Lượt Đầu

Ngày 27/10/2026, múi giờ Asia/Bangkok, branch làm việc `DuyTD`. **SNAPSHOT PASS; validation FAIL / STOP_OUT_OF_SCOPE.**
Đã tạo snapshot local trên `codex/core-freeze-gate3a-2026-10-27`, commit `f7eaaa7999c66ec46ef11601eeece2fefafeb84a`; không đổi DuyTD/index/HEAD, không push.
Tsc đúng1 lần: exit2,14 diagnostic ở bản sao evidence trong coverage. ESLint đúng1 lần với đủ5 exclusions: exit1,138 errors/1355 warnings; mọi error đều ở coverage.
Không có diagnostic TypeScript/lint error trỏ vào source C17/C18 hiện tại, nhưng **không tuyên bố typecheck/lint PASS**. Không sửa runtime/test/config/evidence cũ để né lỗi.
Dừng do lỗi nằm ngoài phạm vi sửa được duyệt; không chạy lại tsc/ESLint, không regression/browser/build/Android, chưa bắt đầu3b hoặc3c.

## 1. Bảng Kết Quả

| Hạng mục | Kết quả thật | Evidence |
|---|---|---|
| Snapshot working tree | PASS:102 path =43 sửa,2 deletion có sẵn,57 untracked không ignore | snapshot-result.json, preflight.json |
| Branch snapshot / commit | codex/core-freeze-gate3a-2026-10-27 / f7eaaa7999c66ec46ef11601eeece2fefafeb84a | Git show và integrity-result.json |
| Tree / parent | ee7656609899ba23f6f9f1f7c9d955b8fd39b380 /01525d92412eb1779855beec0e359037a79873d0 | snapshot-result.json |
| Snapshot diff với parent | 102 files changed,10054 insertions,1058 deletions | git diff --shortstat |
| Index/HEAD/DuyTD | PASS: nguyên trạng sau snapshot và validation | integrity-result.json |
| Secret/ignored | 0 high-confidence finding trong file ứng viên;0 ignored file thêm vào index tạm | snapshot-result.json |
| tsc --noEmit | **FAIL**, exit2,14 errors,26.033s; đúng1 lần | tsc-first.log / result / invocation |
| ESLint với5 exclusions | **FAIL**, exit1,138 errors/1355 warnings,98.038s; đúng1 lần | eslint-first.log / result / invocation |
| Sửa type/lint hoặc test | NOT_DONE: chạm điều kiện lỗi ngoài phạm vi | Không đổi source/config/test |
| Lượt validation thứ2 / targeted regression | NOT_RUN | Chưa có sửa trong phạm vi để cho phép lượt thứ2 |
| Browser3b / build3c / Android | NOT_RUN | Dừng sau3a |

Evidence mới: `coverage/core-freeze-gate3a-3CoWW6/` (ignored). Log gốc không bị cắt hoặc ghi đè; result JSON cũng giữ nguyên output. Đây là dữ liệu validation, không phải kết quả nghiệm thu Android.

## 2. Snapshot Và Bảo Toàn Working Tree

Dùng temporary index tại thư mục evidence, read-tree từ HEAD, git add đúng danh sách dirty/untracked lấy bằng porcelain -z, write-tree, commit-tree, update-ref nhánh mới. Không checkout, reset, stash, stage vào index thật hoặc commit trên DuyTD.
Các blob HEAD không đổi được tái sử dụng; không mở sealed/holdout/open-world. File ignored như env, node_modules, .next, coverage/evidence và dữ liệu ignored không được thêm vào Git, vẫn giữ tại máy. Snapshot này **không phải backup toàn bộ ổ đĩa**.
Quét secret theo các mẫu độ tin cậy cao trên file ứng viên mới/sửa, không in nội dung match; không phát hiện match. Không tuyên bố scanner bảo đảm phát hiện mọi loại secret hoặc đã đọc lại mọi blob lịch sử.

Index SHA-256 trước/sau: `36d8254ddf6ddd6a67ae99341c61f7c68eda7953daaf664c261869aca89ceb10`.
DuyTD HEAD vẫn `01525d92412eb1779855beec0e359037a79873d0`.
Đối chiếu320 file source/test/script/types/config/tài liệu của snapshot:0 drift;102 path working tree đầu lượt không đổi nội dung/tình trạng tới lúc kiểm tra cuối trước báo cáo.
69/69 test khớp baseline **sau Cổng2**; không đảo migration test đã được duyệt ở Cổng2.
Báo cáo3a này được tạo **sau snapshot**, nên không có trong commit snapshot. Không tạo commit thứ2 để thêm báo cáo.

## 3. TypeScript: Diagnostic Nguyên Văn

Lệnh đã chạy đúng1 lần qua Node cục bộ:

```powershell
& 'C:\nvm4w\nodejs\node.exe' node_modules/typescript/bin/tsc --noEmit
```

Exit code **2**. Output nguyên văn (không phải đường dẫn source ứng dụng hiện tại):

```text
coverage/core-freeze-gate2-step2-resume-VMLK7r/before/components/commands/UnifiedAgentPanel.tsx(7,54): error TS2307: Cannot find module './AgentGoalPanel' or its corresponding type declarations.
coverage/core-freeze-gate2-step2-resume-VMLK7r/before/components/commands/UnifiedAgentPanel.tsx(126,139): error TS7006: Parameter 'enabled' implicitly has an 'any' type.
coverage/core-freeze-gate2-step2-resume-VMLK7r/before/lib/android/unified-agent/contracts.ts(2,64): error TS2307: Cannot find module '../../../types/execution' or its corresponding type declarations.
coverage/core-freeze-gate2-step2-resume-VMLK7r/before/lib/android/unified-agent/contracts.ts(3,33): error TS2307: Cannot find module '../agent/runtime-schema' or its corresponding type declarations.
coverage/core-freeze-gate2-step2-resume-VMLK7r/before/lib/android/unified-agent/contracts.ts(41,39): error TS2307: Cannot find module '../agent/budget' or its corresponding type declarations.
coverage/core-freeze-gate2-step2-resume-VMLK7r/before/lib/android/unified-agent/service.ts(3,36): error TS2307: Cannot find module './clarification' or its corresponding type declarations.
coverage/core-freeze-gate2-step2-resume-VMLK7r/before/lib/android/unified-agent/service.ts(4,77): error TS2307: Cannot find module './capability-router' or its corresponding type declarations.
coverage/core-freeze-gate2-step2-resume-VMLK7r/before/lib/android/unified-agent/service.ts(5,33): error TS2307: Cannot find module '../agent/runtime-schema' or its corresponding type declarations.
coverage/core-freeze-gate2-step2-resume-VMLK7r/before/lib/android/unified-agent/service.ts(6,43): error TS2307: Cannot find module '../../../types/execution' or its corresponding type declarations.
coverage/core-freeze-gate2-step2-resume-VMLK7r/before/lib/android/unified-agent/service.ts(37,98): error TS7006: Parameter 's' implicitly has an 'any' type.
coverage/core-freeze-gate2-step2-resume-VMLK7r/before/lib/android/unified-agent/service.ts(38,53): error TS7006: Parameter 's' implicitly has an 'any' type.
coverage/core-freeze-gate2-step2-resume-VMLK7r/before/lib/android/unified-agent/service.ts(39,54): error TS7006: Parameter 's' implicitly has an 'any' type.
coverage/core-freeze-gate2-step2-resume-VMLK7r/before/lib/android/unified-agent/service.ts(58,39): error TS7031: Binding element 'id' implicitly has an 'any' type.
coverage/core-freeze-gate2-step2-resume-VMLK7r/before/lib/android/unified-agent/service.ts(58,43): error TS7031: Binding element 'label' implicitly has an 'any' type.
```

**Root cause VERIFIED_IN_SOURCE:** `tsconfig.json` include `**/*.ts`, `**/*.tsx` và exclude chỉ node_modules. Các pre-image do mình lưu ở Cổng2 giữ extension .ts/.tsx, nên TypeScript coi chúng là module trong project. Chúng không có toàn bộ cây sibling/relative dependency, dẫn tới8 TS2307 và6 lỗi implicit-any kéo theo. Git ignore coverage không tự loại chúng khỏi TypeScript.

Phân loại: **lỗi phạm vi tooling/evidence đã có sẵn trước lượt3a**, mới được phát hiện khi chạy tsc; không phải diagnostic trên các file runtime Cổng1-2 hiện hành. Đây không phải EPERM/EACCES, compiler không cài, hoặc bằng chứng dependency ứng dụng thực tế bị thiếu.
Không sửa import/type trong pre-image vì sẽ làm thay đổi bằng chứng; không thêm ts-nocheck, di chuyển/xóa evidence hoặc đổi tsconfig ngoài phạm vi.

## 4. ESLint: Kết Quả Và Phân Loại

Lệnh duy nhất, không --fix và không chạy eslint trần:

```powershell
& 'C:\nvm4w\nodejs\node.exe' node_modules/eslint/bin/eslint.js . --ignore-pattern '**/*holdout*' --ignore-pattern '**/*holdout*/**' --ignore-pattern '**/*sealed*' --ignore-pattern '**/*sealed*/**' --ignore-pattern 'tests/general-agent-v2-open-world.test.cjs'
```

Summary nguyên văn:

```text
✖ 1493 problems (138 errors, 1355 warnings)
```

| Nhóm đường dẫn | Errors | Warnings | Phân loại |
|---|---:|---:|---|
| Source runtime/test C17/C18 hiện tại | 0 | 0 | Không diagnostic trong lượt này, không suy thành toàn-project PASS |
| Artifact coverage có sẵn trước lượt3a | 131 | 1351 | Lỗi/warning trong harness, vendor bundle và evidence cũ; ngoài phạm vi sửa |
| Hai helper coverage mới của3a | 7 | 0 | **Mới do lượt này tạo**, không gọi là lỗi cũ: snapshot.cjs4, run-validation.cjs3; đều no-require-imports |
| Source ngoài coverage khác | 0 | 4 | Warning đã có trong báo cáo engine merge mục22 |
| Tổng | **138** | **1355** | Exit1 |

Tổng29 file có diagnostic, gồm26 file coverage và3 file ngoài coverage. Mọi error đều ở coverage; không lỗi ở worker/security/parser hoặc test nguồn hiện hành.

| Rule | Errors | Warnings |
|---|---:|---:|
| @typescript-eslint/no-require-imports | 122 | 0 |
| react-hooks/rules-of-hooks | 14 | 0 |
| @typescript-eslint/no-this-alias | 1 | 0 |
| @next/next/no-assign-module-variable | 1 | 0 |
| @typescript-eslint/no-unused-expressions | 0 | 1329 |
| @typescript-eslint/no-unused-vars | 0 | 26 |

Bundle `coverage/dashboard-bootstrap-diagnosis-qCSPHD/react.js` đóng góp16 errors/1347 warnings; đó là artifact JS của chẩn đoán browser, không phải file React ứng dụng đang được bảo trì. Harness CJS còn lại bị rule no-require-imports. Không sửa vendor bundle hoặc gắn eslint-disable hàng loạt để làm lint sạch.

Bốn warning ngoài coverage, giữ nguyên:

| File:dòng | Diagnostic |
|---|---|
| components/commands/ActionPlanPreview.tsx:4 | 'FileJson' is defined but never used; @typescript-eslint/no-unused-vars |
| Cùng file:6 | 'cn' is defined but never used; @typescript-eslint/no-unused-vars |
| components/devices/DeviceFilters.tsx:6 | 'Maximize2' is defined but never used; @typescript-eslint/no-unused-vars |
| tests/helpers/internal-legacy-unified-service.cjs:7 | Expected an assignment or function call and instead saw an expression; @typescript-eslint/no-unused-expressions |

Log toàn bộ giữ tại `coverage/core-freeze-gate3a-3CoWW6/eslint-first.log`; không rút gọn diagnostic trong file gốc. `diagnostics-summary.json` giữ từng file/line/column/message/rule và bộ đếm đã đối chiếu khớp138/1355.
Không dùng số lint0 errors của lượt engine merge cũ để thay kết quả mới: coverage hiện đã có thêm artifact và vẫn chưa được exclude khỏi lint. `.gitignore` không đủ để ESLint bỏ qua coverage với config hiện tại.

## 5. Thuộc Tính Bảo Toàn Và Phạm Vi File

| Thuộc tính | Bằng chứng | Kết quả |
|---|---|---|
| Temporary index, không thay index thật | snapshot-result / integrity-result; index hash trước/sau | PASS |
| DuyTD HEAD không đổi, chỉ nhánh snapshot mới | Git refs và integrity-result | PASS |
| Nội dung dirty/untracked được giữ, không rollback | 102 entry hashes trước/sau | PASS |
| Source/config/test không đổi trong3a | 320 source hashes;69 test hashes sau Cổng2 | PASS |
| Không thêm ignored/secret ứng viên vào Git | ignored tracked check, candidate scan, index tạm | 0 ignored,0 high-confidence secret finding |
| Không nới parser/security/verification/test | Không sửa application/test/config | PASS về bảo toàn, không phải test run mới |

Chỉ thêm `docs/core-freeze-gate3a-report.md` vào working tree không bị ignore; tạo helper/log/JSON/index tạm trong thư mục coverage mới. Không sửa hoặc xóa file/evidence cũ, env, provider hoặc dependency.
TypeScript có thể cập nhật incremental cache ignored theo cấu hình hiện có; không commit artifact đó, không coi nó là source change.

## 6. Lệnh Và Số Lần

| Lệnh/nhóm | Số lần |
|---|---:|
| Snapshot script: read-tree/add/write-tree/commit-tree/update-ref | Script1 lần, mỗi thao tác tạo snapshot1 lần; chỉ index tạm |
| tsc --noEmit | **1** |
| ESLint đầy đủ5 exclusions | **1** |
| tsc/ESLint lần2 | **0**, không có sửa type/lint được phép |
| Targeted / full regression | **0/0**, không có source fix; baseline Cổng2 1418/0/6 chỉ là lịch sử |
| Browser acceptance / build | **0/0** |
| Android/ADB/Appium/Ollama/cloud thật | **0** |
| Checkout/reset/stash/push hoặc commit trên DuyTD | **0** |

Git status/ref/hash queries chỉ đọc trước/sau snapshot và validation. Hai validation chạy tuần tự; thời gian là wrapper của từng lệnh, không cộng các span lồng nhau. Không tự restart/kill Next hoặc worker.

## 7. Điểm Dừng Và Đề Xuất Cần Duyệt

**Đã chạm điều kiện lỗi ngoài phạm vi**, vì giải quyết đúng cần điều chỉnh discovery scope của công cụ, không phải sửa type/lint của runtime C17/C18. Không tự dùng lượt rerun được dành cho source fix, không sửa test cũ.

Đề xuất duyệt một lượt xử lý tooling scope riêng trước khi tiếp tục: thêm coverage vào tsconfig.exclude và globalIgnores của ESLint; vẫn giữ nguyên5 CLI exclusions, mọi rule, source/test đang bảo trì và mọi evidence. Đây là **đề xuất chưa thực hiện**, không phải quyền đã được suy ra từ yêu cầu hiện tại.
Phương án khác là lưu pre-image với extension không được compiler quét và đặt harness/vendor artifact ngoài input lint; cần được duyệt cách bảo toàn hash/path mapping trước, không tự di chuyển/dọn evidence.
Sau khi phạm vi được duyệt mới xác định số lượt validation cho phép chạy tiếp. Chưa mở3b; 3b còn cần người dùng xác nhận Next đã restart và preflight runtime/source. Không làm3c/build trong lượt này.

## 8. Lượt Tooling Scope Đã Được Duyệt

Người dùng duyệt đúng hai bổ sung cấu hình và đúng một lượt chạy lại mỗi validation. Không dùng quyền này để sửa source, test, dependency, worker/security/parser, di chuyển/xóa/sửa evidence hoặc thêm eslint-disable.

### 8.1 Hai File Cấu Hình

| File | Trước | Sau | Phần giữ nguyên |
|---|---|---|---|
| tsconfig.json | exclude=[node_modules] | exclude=[node_modules,coverage] | Mọi compilerOptions, include và mục exclude cũ |
| eslint.config.mjs | globalIgnores với .next/out/build/next-env.d.ts | Thêm đúng literal coverage/** | Mọi import, config/rule set và mục ignore cũ |

`config-scope-proof.json` so JSON của tsconfig và text ESLint trước/sau, xác nhận chỉ append coverage;0 rule change, không thêm eslint-disable. Không thêm exclusion CLI thứ6: coverage chỉ được đưa vào globalIgnores đã duyệt.

### 8.2 Bảng Trước / Sau

| Kiểm tra | Lượt đầu, trước scope fix | Lượt chạy lại này | Số lần trong lượt mới |
|---|---|---|---:|
| tsc --noEmit | Exit2,14 diagnostic trong evidence | **PASS: exit0,0 diagnostic**,3.476s | **1** |
| ESLint với5 exclusions | Exit1,138 errors/1355 warnings | **PASS về exit code: exit0,0 errors/4 warnings**,22.159s | **1** |
| Lỗi source thật Cổng1-2 | Không có diagnostic | Không có diagnostic | Không sửa source |
| Source/test cũ ngoài phạm vi | 4 warning | Vẫn đúng4 warning cũ | Không sửa |
| Targeted C17/C18 / full regression | Không chạy ở lượt3a đầu | **NOT_RUN**, không có source fix nên được miễn theo yêu cầu | **0/0** |
| Browser3b / build3c / Android/model thật | Không chạy | **NOT_RUN** | **0** |

Không gọi warning là error hoặc tuyên bố lint không có warning. Các warning còn lại vẫn ở ActionPlanPreview.tsx:4,6; DeviceFilters.tsx:6; internal-legacy-unified-service.cjs:7, nguyên message/rule ở mục4.
Tổng cả hai lượt3a: tsc2 lần, ESLint2 lần, gồm một lần đầu FAIL và một lần chạy lại được duyệt; **không có lần thứ3**. Không có sửa source hoặc retry tự động.
Baseline regression1418 PASS/0 FAIL/6 TODO từ Cổng2 giữ nhãn lịch sử, không phải kết quả chạy mới trong3a.

Lệnh mới vẫn là:

```powershell
& 'C:\nvm4w\nodejs\node.exe' node_modules/typescript/bin/tsc --noEmit
& 'C:\nvm4w\nodejs\node.exe' node_modules/eslint/bin/eslint.js . --ignore-pattern '**/*holdout*' --ignore-pattern '**/*holdout*/**' --ignore-pattern '**/*sealed*' --ignore-pattern '**/*sealed*/**' --ignore-pattern 'tests/general-agent-v2-open-world.test.cjs'
```

Hai lệnh chạy tuần tự, không --fix. Tsc output rỗng; summary ESLint nguyên văn:

```text
✖ 4 problems (0 errors, 4 warnings)
```

### 8.3 Evidence Và Snapshot Cập Nhật

Evidence **mới**: `coverage/core-freeze-gate3a-tooling-i4n3N4/`; preflight/config-scope-proof, hai invocation/log/result JSON được tạo riêng, không ghi đè lần đầu.
Hash evidence cũ trong `coverage/core-freeze-gate3a-3CoWW6/` được so trước/sau. Không di chuyển, xóa, sửa raw log, pre-image hoặc snapshot trước.
Không đọc sealed/holdout/open-world, env hoặc nội dung secret. Không thay env/config provider/dependency, không gọi browser/ADB/Appium/Ollama/Groq hoặc dịch vụ thật.

Snapshot local sau validation/báo cáo dùng nhánh **codex/core-freeze-gate3a-tooling-2026-10-27**; snapshot trước **codex/core-freeze-gate3a-2026-10-27** / `f7eaaa7999c66ec46ef11601eeece2fefafeb84a` giữ nguyên.
Hash commit snapshot mới được lưu ở `snapshot-result.json` của evidence mới và phản hồi cuối. Không chèn self-hash vào báo cáo nằm trong chính commit; bản báo cáo trên working tree phải khớp nội dung trong snapshot.
Temporary index bao gồm toàn bộ thay đổi tracked/untracked không ignore, gồm đúng hai cấu hình mới và báo cáo3a; các deletion đã có sẵn vẫn được bảo toàn. Không checkout/stash/reset hoặc commit lên DuyTD, không push.

### 8.4 Thuộc Tính Bảo Toàn Và Điểm Dừng

| Thuộc tính | Bằng chứng / cách kiểm |
|---|---|
| Chỉ2 config + báo cáo thay đổi trong lượt | preflight beforeHashes / integrity-result, kiểm allowedChanges |
| Rules, compiler options và5 exclusions không đổi | config-scope-proof, invocation args |
| Source/test/worker/security/parser/dependency nguyên trạng | Hash các file ngoài allowedChanges;69 test so baseline sau Cổng2 |
| Evidence cũ nguyên vẹn | evidenceHashes trước/sau |
| Hai cấu hình và báo cáo có trong commit cuối | So blob Git của3 file với nội dung working tree, snapshot-result |
| DuyTD/index/HEAD và snapshot trước không đổi | Snapshot integrity checks, index checksum và Git refs |

Không có lỗi source thật phát sinh nên không dùng nhánh sửa type/lint hoặc chạy regression. **Điểm dừng3a đạt sau scope fix**; chưa làm3b/3c. Chỉ tiếp tục3b sau xác nhận của người dùng, gồm việc Next đã restart và preflight runtime/source; không tự kill/restart.
