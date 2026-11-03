# Phone Commander — bàn giao source tích hợp

Kiểm kê bắt đầu 2026-11-03, kiểm chứng hoàn tất 2026-11-04. Repository đã xác minh: https://github.com/duysayhi/Smart_Device_Control_System (public). Nhánh mặc định: `main`. Nhánh chia sẻ: `integration/teach-mode-2026-11-03`.

Đây là branch để review và phát triển chung, chưa merge hoặc triển khai production. Commit source nền: `0706a4afc4267d0046185df5d79800f6a3f742c4`. SHA bàn giao được ghi trong `docs/TEAM_INTEGRATION_VALIDATION.md`; kiểm tra bằng `git rev-parse HEAD` sau khi checkout. Báo cáo hiện trạng do chủ dự án cung cấp chỉ là nguồn tham khảo; trạng thái dưới đây dựa trên audit source và kiểm tra thực tế.

## Phạm vi và mức hoàn thành

| Thành phần | Source | Trạng thái |
|---|---|---|
| Dashboard DuyTD | `app`, `components`, `hooks`, Unified Android runtime | Giữ nền DuyTD và tích hợp Skills/History; không thay bản đang chạy trên máy chủ dự án |
| G2.2 | `lib/skills/teach-dashboard.ts`, repository, `components/skills/TeachModePanel.tsx` | Source đã được G3 phát triển tiếp; hỗ trợ draft Save/readback và PostgreSQL |
| G3 Recorder/Preview | `live-teach-*`, `teach-session.ts`, `LiveTeachRecorder.tsx` | Có lease/lifecycle, frame stream và cleanup; chưa nghiệm thu ghi thao tác vật lý xuyên suốt |
| Android Observer | `android/teach-observer`, `companion-transport.ts` | Source và build ký debug; đã cài/bật Accessibility ở môi trường chủ dự án; chưa nghiệm thu MediaProjection/pairing/FPS thật |
| Human Action Clarification | `live-teach-service.ts`, Recorder UI | Annotation thao tác do người dùng khai, có trạng thái chưa xác minh; không tạo native receipt hay tự phát lại thao tác |
| G4 Compiler | `skill-compiler.ts`, `recorded-skill-compiler.ts`, skill DSL | Compiler/validator và kiểm tra offline; chưa có skill mới được chấp nhận từ lần ghi Android thật này |
| G5 Replay | `skill-replay*`, Android replay adapter | Source replay có kiểm chứng; replay có thao tác thật mặc định tắt, chưa nghiệm thu vòng mới trên thiết bị |
| G5.1 Console | `SkillReplayConsole.tsx`, replay API | Console và test UI/API; không đồng nghĩa với replay thật đã đạt |
| G6 Portability | `skill-portability.ts`, portability API/UI | Phân tích/đánh giá offline; chưa nghiệm thu replay trên thiết bị thứ hai |
| Owner Authentication | `lib/owner-auth`, `app/owner`, owner API | Passkey có purpose/binding/expiry, chống lặp; cần mỗi máy tự bootstrap/enroll |
| Neon Teach | `lib/skills/db`, `db/teach` | Baseline và migrations v2/v3/v4; application không tự chạy migration |
| History | `lib/history`, History UI/API, `db/history` | Projection có lọc dữ liệu và branch/TLS check; chưa nghiệm thu toàn bộ incremental Worker → Neon → Dashboard sau cutover |
| Orphan readiness | `lib/skills/orphan-disposition.ts` | Pure evaluator bổ sung từ worktree phụ, chưa gắn production; không cấp quyền native |

**Chưa đạt real Android acceptance G3→G6.** Lượt continuation mới nhất bị chặn trước native OPEN vì thiết bị không còn ở trạng thái mở khóa sẵn sàng. Passkey thành công hoặc tab Recorder hiển thị không phải bằng chứng đã ghi/Save/Replay thành công. Không có skill mới được Save/Replay từ lượt này; chưa đo FPS thật. Các bài kiểm tra PGlite và mock Android không thay thế nghiệm thu thiết bị hay PostgreSQL MVCC thật.

## Checkout và dependencies

Windows là môi trường đã sử dụng cho bootstrap Owner và companion. Cần Git, Node.js 22.19+ (có `process.loadEnvFile`), npm; dùng lockfile npm đã commit. Không dùng file pnpm workspace thử nghiệm của các worktree cũ.

```powershell
git clone https://github.com/duysayhi/Smart_Device_Control_System.git
cd Smart_Device_Control_System
git fetch origin --prune
git switch --track origin/integration/teach-mode-2026-11-03
git rev-parse HEAD
npm.cmd ci
Copy-Item .env.example .env.local
```

`npm.cmd` tránh trường hợp Windows có executable `npm` khác che CLI chuẩn. Linux/macOS dùng `npm`. Không copy `node_modules`, `.next`, coverage, dữ liệu Owner hoặc runtime journal từ máy khác.

## Dashboard, Worker, Appium

Dashboard offline không cần Neon/Android. Ví dụ chạy riêng web trên loopback:

```powershell
npm.cmd run dev:web -- --hostname localhost --port 3000
```

Chạy `npm.cmd run dev` khi muốn launcher quản lý web/Worker như Dashboard nền. Với Teach acceptance, dùng các launcher riêng để tải cùng cấu hình private và tắt cloud reasoning:

```powershell
$env:PHONE_COMMANDER_ENV_FILE = (Resolve-Path .env.local).Path
node scripts/teach-worker.cjs
```

Ở terminal web riêng, cũng đặt `PHONE_COMMANDER_ENV_FILE`, rồi chạy:

```powershell
node scripts/teach-web.cjs dev --hostname localhost --port 49861
```

`scripts/teach-owner-web.cjs` là launcher acceptance loopback cố định cổng 49861: yêu cầu fingerprint nhánh đã cấu hình, tắt History và supervised replay. Nó không tự chuẩn bị database/Owner hay tạo một native OPEN. Không trỏ launcher vào database production.

Worker và web cần chạy từ cùng checkout/source/env. Source digest thay đổi thì phải restart đúng Worker đang kiểm thử; không tái sử dụng Worker của worktree khác. Runtime journal nằm trong thư mục temp theo hash đường dẫn checkout; checkout mới không tự kế thừa journal hoặc authority cũ. Giữ lại journal riêng của môi trường cũ khi cần điều tra/reconciliation.

Android cần platform-tools/ADB đã được operator cấu hình và thiết bị được người dùng chấp thuận USB debugging. Appium là dịch vụ bên ngoài; bản đã dùng khi kiểm thử là 3.8.0 với UiAutomator2. Cài driver riêng rồi chạy dịch vụ loopback:

```powershell
appium driver install uiautomator2
appium --address 127.0.0.1 --port 4723
```

Preflight quản trị cần API discovery session của Appium. Chỉ khi operator đã review và cấp scope đó, chạy dịch vụ kiểm thử với `--allow-insecure=*:session_discovery`; không bật relaxed security/adb_shell. Scope này chỉ phục vụ kiểm kê session, không cấp phép Android action. `APPIUM_URL`, `ADB_PATH`, `APPIUM_HOME` có thể cấu hình private. Không chạy acceptance scripts lịch sử có hardcoded thiết bị trên máy đồng đội.

## Database và migrations

Git push **không đồng bộ dữ liệu Neon**. Mỗi thành viên dùng secret/nhánh test riêng. Lưu `DATABASE_URL` private trong `.env.local` hoặc secret manager, không đưa vào command history/chat/log. Đặt `TEACH_STORAGE_MODE=POSTGRESQL`, `TEACH_DATABASE_SCHEMA=teach_mode`; History chỉ bật với `HISTORY_STORAGE_MODE=POSTGRESQL` khi schema tương ứng đã sẵn sàng.

Recorder/replay và History kiểm tra `neondb` và fingerprint của `current_setting('neon.branch_id', true)`; PostgreSQL thường không có Neon branch identity sẽ bị chặn. Tính SHA-256 của đúng chuỗi branch ID đã xác minh và cấu hình private `TEACH_EXPECTED_BRANCH_SHA256`/`HISTORY_EXPECTED_BRANCH_SHA256`. Không bỏ branch/TLS checks để làm cho môi trường mới chạy được.

Trên nhánh test mới, DBA review và áp từng migration một theo thứ tự sau; kiểm tra catalog/readback và grants sau mỗi bước. Không chạy lại trên schema có sẵn, không chạy uninstall trên dữ liệu cần giữ.

| Thứ tự | File | Chức năng |
|---|---|---|
| Teach baseline | `db/teach/10_install_teach_schema.sql` | Schema Teach v1; `12_verify_install.sql` dùng kiểm tra catalog |
| Teach v2 | `db/teach/proposals/20_admin_orphan_quarantine.sql` | Administrative audit/clearance và scoped fresh admission |
| Teach v3 | `db/teach/proposals/21_clearance_reauthorization.sql` | Reauthorization của clearance |
| Teach v4 | `db/teach/proposals/22_g3_continuation.sql` | Ledger continuation bất biến, không sửa parent audit |
| History độc lập | `db/history/10_install_history_schema.sql` | Baseline `phone_commander`, 15 bảng; byte-identical bản DDL tham chiếu dùng trong tests |

Các file `proposals` là migrations cần review có chủ đích, không auto-install. V4 rollback `22_g3_continuation_rollback.sql` chỉ dùng trước lần ghi ledger đầu tiên; khi có evidence thì rollback từ chối xóa. Baseline `11_uninstall_teach_schema.sql` là thao tác phá hủy để kiểm thử, không phải quy trình nâng cấp. Các hàm administrative revoke quyền PUBLIC: DBA phải cấp quyền hẹp cho role phù hợp; không dùng blanket grant. Consent lưu trữ Teach phải được owner/operator cấp riêng qua quy trình đã review, không giả bằng fixture và không suy từ Git checkout.

Baseline History dùng `IF NOT EXISTS` nên **không nâng cấp** bảng tồn tại khác cấu trúc. Preflight read-only của ứng dụng sẽ chặn nếu catalog/constraints/TLS/branch/privileges không đúng. `scripts/history-store.cjs` hỗ trợ `dry-run`, `preflight`, `reconcile`, import có `--apply` riêng. Không import journal cá nhân hoặc dữ liệu fixture vào Neon của nhóm; quản trị dữ liệu là bước riêng, không nằm trong push source này.

## Owner và Companion

Owner bootstrap chỉ chạy trên Windows user của operator, từ checkout kiểm thử, sau khi review local effects:

```powershell
node scripts/owner-bootstrap.mjs --origin http://localhost:49861 --open
```

Người dùng tự đăng ký Passkey/Windows Hello trong Chrome/Edge. Sau enrollment, tạo issuer cục bộ bằng `node scripts/owner-bootstrap.mjs --origin http://localhost:49861 --prepare-issuer`, rồi restart đúng web/Worker để đọc state. Không copy `data/teach-mode/owner-auth` hoặc issuer-private key sang máy khác. Review continuation có hạn 10 phút; ceremony/approval vẫn chỉ 60 giây. Tích chấp thuận nội dung rồi dùng nút kết hợp xác thực và mở đúng một lần. UNKNOWN/lost response phải reconciliation, không click retry OPEN. Giữ thiết bị mở khóa và Appium ready cả trước lẫn trong ceremony.

Companion cần JDK có `javac`, `jar`, `keytool`, Android SDK platform `android-37.0` và build-tools `36.0.0` ở `%LOCALAPPDATA%/Android/Sdk` theo build script hiện tại:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File android/teach-observer/build.ps1
```

APK, debug keystore và classes chỉ nằm trong ignored `android/teach-observer/build`. Mỗi build tạo debug key riêng, vì vậy hash APK có thể khác. Build/signature verification không chứng minh cài/chạy trên Android. Cài APK vào đúng thiết bị chỉ sau review riêng; người dùng tự bật Accessibility và tự cấp MediaProjection. Token pairing nằm RAM, hết hạn 10 phút; observer chỉ phát metadata YouTube, không tự thao tác UI. Preview thực tế còn cần kiểm tra pairing, foreground/privacy filters, reconnect và FPS trước khi nghiệm thu.

## Kiểm tra và quy trình PR

```powershell
npm.cmd run typecheck
npm.cmd run test:teach
npm.cmd run test:integration
node db/teach/teach-db-install.test.mjs
$env:TEACH_ISOLATED_BUILD = '1'
npm.cmd run build
git diff --check
```

Runner offline chọn các test top-level, bỏ cohort open-world/held-out/sealed, xóa cấu hình live kế thừa và chặn network tới dịch vụ ngoài fixture của chính test process, cùng process ADB/Appium/model/Worker thật. Kết quả/tripwire nằm trong ignored `coverage/team-integration`. Các test migration chạy PGlite trong memory; không áp SQL lên Neon. Build không cần database/Owner private store. Chỉ chạy các operator acceptance scripts khi có scope riêng.

Xem `docs/TEAM_INTEGRATION_VALIDATION.md` để biết gates thực sự đã chạy, số test và giới hạn. Một số test TODO của tính năng Dashboard lịch sử vẫn chưa triển khai; không báo chúng là PASS.

Phát triển tiếp bằng branch riêng từ branch chia sẻ. PR nhỏ nêu hành vi, test, migration/rollback và trạng thái nghiệm thu thật. Review PR tích hợp vào `main` trước; không merge/force-push branch của người khác hoặc tự cutover database. Scan secrets cả commit range lẫn file staged; `.gitignore` không bảo vệ file đã tracked. Không đính kèm coverage/evidence riêng, raw screenshot/XML, browser capabilities, Passkey store hoặc DB dumps vào PR. `.gitleaksignore` chỉ chứa các fingerprint cảnh báo giả đã kiểm tra, không tắt rule chung.
