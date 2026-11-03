# Git audit và kiểm chứng branch chia sẻ

Repository: https://github.com/duysayhi/Smart_Device_Control_System. Default branch xác minh bằng remote HEAD và GitHub API: `main` tại `a960f86cff3dde4194fc9aa9cc63d6194bf80815`. Fetch `origin --prune` thành công. GitHub xác nhận tài khoản hiện hành có quyền push. Repository là public, vì vậy báo cáo/evidence riêng không được đưa lên branch.

Branch bàn giao: `integration/teach-mode-2026-11-03`. Source nền: `0706a4afc4267d0046185df5d79800f6a3f742c4`. Validated source commit: **`6564d2410bce8094c575f7eecaf5e7912c5cf095`**. Commit chứa báo cáo này mới hơn source commit; dùng `git rev-parse HEAD` để xác định checkout chính xác. Kiểm chứng hoàn tất 2026-11-04, giữ tên branch theo yêu cầu ngày 03/11.

Thống kê sau khi thêm báo cáo: **162 file thay đổi so với source nền G3**, **552 file tracked toàn branch**. Draft PR so với remote `main` có **461 file thay đổi**, vì bao gồm cả các commit Dashboard/Android DuyTD đã có trước lượt tích hợp này. Không gọi toàn bộ diff PR là code mới viết trong lượt này.

## Worktree và lịch sử

| Checkout gốc | HEAD | Tracked WIP | Untracked files | Xử lý |
|---|---|---:|---:|---|
| DuyTD | `0706a4a` | 0 | 2 | Giữ nguyên; không cutover Dashboard đang chạy |
| G3–G6 | `0706a4a` | 24 | 143 | Nguồn chính; sao chép 152 file source/config/test qua allowlist, giữ toàn bộ WIP gốc |
| G2.2 / feature-next-capability | `f77b65e` | 6 | 49 | Đối chiếu nội dung với bản G3 phát triển tiếp; không chép đè bản mới bằng bản cũ |
| Orphan readiness (detached) | `0706a4a` | 22 | 105 | Bổ sung pure evaluator và 20 test riêng; giữ SQL v2 mới hơn của G3 |

Worktree tích hợp là checkout riêng do ứng dụng quản lý. SHA-256 của 152 file nguồn G3 đã đối chiếu lại sau khi copy: source gốc không đổi. Không reset, clean, stash, force-push, xóa worktree hoặc thay branch của đồng đội.

`DuyTD`, branch G3 và local `main` nằm trên ancestry của source nền. `origin/DuyTD` là ancestor; source nền có một commit mới hơn nó. `origin/Develop`/G2.2, các core-freeze snapshots, teach-gate0 và teach-gate2 **không phải ancestor đã merge**; không suy luận ngược từ tên branch. Diff tree và WIP đã đối chiếu: các file ứng dụng tương ứng đã có trong source G3 hoặc bản phát triển tiếp. Các branch cũ vẫn giữ nguyên để truy vết.

Không chạy merge/cherry-pick tự động. Những phần chồng lấn đã giải quyết theo nội dung:

- Dashboard/router/Unified Android giữ bản DuyTD `0706a4a`; không hồi sinh TaskQueue/ExecutionDetailModal đã bị thay trong nền này.
- Skills G2.2 giữ extensions/schema validation, compiler parser và PostgreSQL/TLS improvements của G3; bố cục TeachWorkspace mới thay entry panel cũ.
- Administrative SQL ở worktree orphan cũ chỉ mô tả quarantine; bản G3 đã phát triển clearance/reauthorization/continuation. Giữ migrations G3 và đưa evaluator cũ vào như module thuần chưa nối production.
- `pnpm-workspace.yaml` thử nghiệm chỉ chứa placeholder allowBuilds, không phải cấu hình workspace dùng được; không đưa vào branch npm. Giữ các bản local nguyên trạng.
- Các báo cáo lịch sử chưa commit có đường dẫn cá nhân, định danh thiết bị/session và evidence riêng được giữ ở worktree gốc. Thay bằng hai tài liệu bàn giao đã lọc dữ liệu; không đính kèm bản tổng hợp của chủ dự án như một kết quả audit mới.

## Thay đổi riêng để bàn giao được

1. Thêm script regression offline, npm scripts test/typecheck và cấu hình mẫu không chứa credentials.
2. Launcher Owner yêu cầu fingerprint nhánh riêng, bỏ fingerprint hardcoded của môi trường chủ dự án; không bỏ các gate native/source/Passkey.
3. Admission diagnostics gọi method service trực tiếp, bỏ workaround prototype cho singleton dev cũ; thêm test không tiết lộ capability và không retry native stage.
4. Expose baseline History ở `db/history` nguyên byte bản DDL đã dùng trong fixture. Không auto-migrate, import dữ liệu hoặc grant consent.
5. Git attributes giữ SQL nguyên byte trên mọi nền tảng, kể cả CRLF của v4 đã duyệt. Có kiểm tra SHA-256 staged trước commit.
6. Sửa kỳ vọng SQLSTATE ở test FK deletion từ `23001` sang lỗi quan sát `23503`; không sửa DDL baseline. Dọn biến test không dùng và khoảng trắng cuối dòng trong giấy phép font.
7. Loại thư mục build Companion và local drivers khỏi Next tracing. Kiểm tra build đầu thấy generated APK/classes/debug keystore trong các NFT manifests; build sau phải không còn tham chiếu đó. Không có artifact này trong staged/Git.

## Gates

| Gate | Kết quả |
|---|---|
| Install mới từ npm lockfile | PASS — `npm.cmd ci --no-fund --no-audit`, 408 packages; không copy node_modules từ worktree khác |
| Dependency graph | PASS — `npm.cmd ls --depth=0` exit 0; hai WASM optional packages bị npm gắn nhãn extraneous nhưng có sẵn trong lockfile (`optional: true`), không có missing/invalid dependencies được báo |
| TypeScript | PASS — `tsc --noEmit`; build cũng chạy TypeScript thành công |
| Targeted integration | PASS — 52/52: continuation, orphan readiness, Owner UI và Worker admission |
| Relevant full regression | PASS — 2.180 PASS / 0 FAIL / 6 TODO; tổng 2.186 tests, 707,52 giây; TODO legacy không được tính PASS |
| Teach baseline install/uninstall/reinstall | PASS — 121/121 trong PGlite memory-only, sau khi sửa assertion SQLSTATE |
| Migration order v1→v2→v3→v4 | PASS trong các continuation/reauthorization fixtures; rollback v4 chưa dùng và ledger bất biến cũng được kiểm tra; không chạy migration trên Neon trong lượt tích hợp |
| Scoped ESLint | PASS — modules/routes/UI/runtime/tests thay đổi và scripts tích hợp; không khẳng định toàn repository legacy lint sạch |
| Production build | PASS — Next 16.4.0, isolated output; còn 5 cảnh báo dynamic filesystem tracing, không lỗi compile/type |
| Build artifact privacy | PASS — kiểm tra cả 28 NFT manifests sau build cuối, 0 tham chiếu APK/keystore, local drivers, coverage, dữ liệu Owner hoặc env private |
| Companion | PASS — javac/d8/aapt/zipalign/apksigner verify; APK/key chỉ trong ignored build directory, không cài hoặc bật quyền thiết bị trong lượt này |
| Git diff whitespace | PASS — staged diff check; CR tại EOL của SQL được nhận diện bằng attribute, không thay hash đã duyệt |
| Source integrity | PASS — không có khác biệt ngoài các thay đổi tích hợp liệt kê; WIP gốc giữ nguyên |
| API contracts | Targeted/full tests dùng route/service thật với fixture/mocks; production build nhận đủ routes Owner/History/Skills/Recorder/Teach; không dùng fixtures làm live admission |

Các log/manifest/tripwire chạy mới ở ignored `coverage/team-integration`; không đưa lên Git vì có thể chứa metadata môi trường. Test offline chặn network tới dịch vụ thật và đọc env/sealed/held-out cohorts; chỉ cho phép server fixture do cùng process tạo. Tổng 114 tripwires: 1.099 fixture network calls, 0 lần chạm network bị cấm, 0 process thiết bị/model bị cấm, 0 protected reads. Sáu TODO thuộc gate SSID, record, Gallery, URL, Maps, Bluetooth của Stage 3.4 lịch sử.

### SQL byte integrity

| File | SHA-256 |
|---|---|
| V4 continuation | `08a9b0144fdde72af361cc368a6418288965a380c32ac33a8b17f363395250b5` |
| V4 rollback | `704b6029c6b877371e0c8a590d7fcb5152d300dba77dbc4d97cce13a84f3649e` |
| History baseline và fixture | `d33c407007202c279f01394a4ccd2db02d2d01a7d1166b9f7ad39f3aa4fa3365` |

## Secrets và publication

Gitleaks 8.30.1 portable lấy từ release chính thức, checksum archive đối chiếu với release checksums. Đã scan toàn ancestry source nền, staged changes và cả 9 commits ancestry của source commit với redaction: sạch sau phân loại false positives. Một cảnh báo prose lịch sử đã kiểm tra là false positive, được loại theo đúng fingerprint trong `.gitleaksignore`. Hai input giả dành cho kiểm tra privacy được đánh dấu `gitleaks:allow` tại đúng dòng; không tắt rules chung hoặc loại cả thư mục tests. Commit tài liệu này cũng được scan trước lần push tiếp theo.

Allowlist không có `.env`/`.env.local`, database credentials, Owner store/issuer keys, Worker journal, browser capabilities, APK/build keys, raw screenshots/XML thiết bị, coverage, DB dumps, node_modules hoặc Next output. `.env.example` đã tracked chỉ có cấu hình mẫu và tên biến. Không rewrite lịch sử chung hoặc sửa remote branches có sẵn.

Publication: source commit **đã push thường** lên `origin/integration/teach-mode-2026-11-03`, `git ls-remote` readback khớp `6564d2410bce8094c575f7eecaf5e7912c5cf095`. Draft PR **[#1](https://github.com/duysayhi/Smart_Device_Control_System/pull/1)** đã được GitHub trả về với `draft=true`, base `main`, head đúng source commit. Báo cáo này được bổ sung bằng commit tài liệu và push thường tiếp theo; SHA HEAD cuối được công bố trong bàn giao sau readback. Không merge PR hoặc thay main/Develop/DuyTD remote.

## Giới hạn và bước tiếp theo

- Đọc `TEAM_INTEGRATION_GUIDE.md` để setup nhánh Neon/secret/Owner/Worker/Appium riêng. Git checkout không chuyển dữ liệu hoặc consent từ máy chủ dự án.
- Real Android G3→G6 chưa đạt; physical annotations vẫn chưa tự trở thành native receipts. Cần nghiệm thu record → clarify → compile → Save/readback → supervised replay và thiết bị thứ hai theo scope riêng.
- Lượt native continuation cuối bị chặn vì điện thoại không còn unlock-ready; không được coi Passkey thành công hay tab mở là native OPEN/cleanup proof. Không retry grant đã consumed.
- History incremental Worker → Neon và full Dashboard/cutover vẫn cần nghiệm thu sau cấu hình đúng môi trường; không tái import journal cũ như một bước clone thông thường.
- Các cảnh báo tracing filesystem và TODO legacy được giữ rõ trong kết quả; không tuyên bố production-ready. Review Draft PR trước merge vào `main`, không deploy trong lượt này.
