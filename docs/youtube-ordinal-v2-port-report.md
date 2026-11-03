# YouTube ordinal trong Unified V2 — báo cáo port offline

Ngày 28/10/2026, branch `DuyTD`. Evidence: `coverage/youtube-ordinal-v2-vznlVr/`.

## Phạm vi và bằng chứng lịch sử

**SOURCE_IMPLEMENTED**: đường Unified V2 bổ sung chọn/phát video thường thứ 1–3. Không phục hồi routing V1/Action Plan, không thêm engine hoặc vòng quyết định độc lập. **REAL_ANDROID_UNVERIFIED**: không chạy ADB/Appium, model/cloud hoặc thao tác điện thoại thật trong lượt này. Không cấp nhãn REAL_ANDROID_COMPLETED.

Trước sửa đã đọc source planner, decision/candidates/memory/evaluator legacy; UIExplorer/element memory; observer, ConditionExecutor, action/media verifier; compiler/candidates/grants/verification/runtime/catalog/service V2 và các test liên quan. Các thay đổi có sẵn được ghi bằng status và SHA-256 trong `preflight.json`, không reset/stash/checkout/commit/push. Teach worktree, DB, sealed/holdout/open-world fixtures không được dùng cho implementation hay đánh giá này.

Lịch sử không chứng minh mọi ordinal đã chạy tốt. `docs/youtube-ad-search-report.md` chỉ xác nhận discovery tìm được video đầu tiên sau quảng cáo, chưa chứng minh click/playback. `docs/autonomous-task-completion-report.md` và `docs/unified-agent-m7a-acceptance-report.md` có video thứ hai BLOCKED; báo cáo M7a ghi timeout/hiệu ứng trước đó chưa xác minh. Không chuyển các kết quả cũ thành thành công mới.

## Luồng trước và sau

Legacy: câu lệnh → goal-planner → decision-engine/UIExplorer → thứ tự từ discovery memory → click → action verifier + MediaSession tiến độ phát. Các tiêu chí legacy giữ nguyên.

V2 trước sửa: catalog chặn video ordinal; graph có LAUNCH/SEARCH, chỉ OPEN_RESULT của Chrome có scope/verifier riêng. Không có contract video, search → ordinal scope/candidate, hoặc terminal playback verification cho YouTube.

V2 sau sửa: source → catalog → compiler → **LAUNCH → SEARCH exact → SELECT_RESULT N → VERIFY_PLAYBACK** → loop V2 đang có. Ba source clauses giữ nguyên span/query/N; playback là child xác minh duy nhất được compiler/schema cho phép, giữ nguyên outcome nguồn và phụ thuộc trực tiếp selection. Bỏ child, thay outcome/N hoặc nối playback bỏ qua selection bị schema từ chối. SEARCH thành công không hoàn tất toàn mục tiêu.

## Tái sử dụng và phần mới

- Tái sử dụng `UIExplorer` qua primitive WAIT_FOR của execution context, `discoveryCandidates`, memory có origin/overlap/dedup, native observer/locate, grounded interaction, existing single-use effect grant, cùng Session/lock/cancel và budget accounting. WAIT_FOR không dispatch CLICK và không chạy engine legacy.
- Tái sử dụng `createMediaPlaybackVerifier`: MediaSession duy nhất đúng package, active/PLAYING, đúng title, hai snapshot mới và position tăng; clock Android có thể được dùng như contract cũ. Parser MediaSession chỉ bổ sung trường channel, không thay hành vi verifier legacy.
- Thêm `video-result-contract.ts` và `video-result.ts`: typed ordinal/query, scope từ search proof đã cấp trong process, native candidate gắn scope, attempt/ACK tracking và receipt playback chống clone/giả payload. Không nhận tọa độ do model chọn.
- Sửa additive outcome/compiler/graph/capability/evidence registry; nối hai nhánh vào loop V2; production adapter dùng reader ADB đã có accounting; progress terminal mang title/ordinal/identity/evidence/position; plan view có bước xác minh rõ ràng.
- Catalog thêm `VIDEO_PLAYBACK` EXPERIMENTAL đúng ordinal 1–3, giữ fallback disabled ngoài phạm vi. Owner candidate guard chỉ nhận candidate có scope video hợp lệ như guard browser đã có; không tạo hoặc thay owner/full-control mode, không đổi TTL/grant kind hay mở rộng quyền phá hủy.

Candidate cần search evidence thật cùng execution/device/Session/package/query, RESULTS, còn hạn; memory anchored và identity/ordinal liên tục; card hiện tại phải duy nhất, không partial. Dispatch đọc lại query, cả thứ tự identity của viewport và native target trước click. Sai query/order, duplicate, unknown thumbnail, scope/candidate clone hoặc Session/device khác đều bị chặn.

Destination phải là VIDEO_PLAYER với đúng một player, đúng một title từ metadata player; channel phải khớp nếu có trong discovery. Ads/Shorts/loading/unavailable và metadata không đủ đều không chứng minh selection. Playback cần receipt độc lập do reader cấp; nếu channel quan sát được thì cả UI và MediaSession channel phải khớp. UI playback payload tự gán hoặc receipt clone không hợp lệ. UNKNOWN/timeout sau click không tự click lại.

## Kiểm thử và trạng thái catalog

Bảng dưới đã đối chiếu log validation cuối lượt. Mỗi câu dùng compiler, Unified service/runtime preparation, search protocol, grounded executor, UIExplorer và MediaSession verifier production với fake adapters; không mock terminal COMPLETED. **P2.1 (N=1) và P2.2 (N=2–3): OFFLINE_TESTED**, không phải nghiệm thu thiết bị thật.

| Câu lệnh | Analyze | V2 Plan | Offline Execution | Playback Verification | Catalog |
|---|---|---|---|---|---|
| Mở YouTube, tìm OpenAI và phát video đầu tiên | V2, 4 bước | LAUNCH → SEARCH OpenAI → SELECT 1 → VERIFY | OFFLINE_TESTED | Alpha/Ocean, 2 lần đọc tăng | EXPERIMENTAL |
| Mở YouTube, tìm podcast tiếng Anh và phát video thứ 2 | V2, 4 bước | Giữ query và N=2 | OFFLINE_TESTED | Bravo/Ocean, 2 lần đọc tăng | EXPERIMENTAL |
| Mở YouTube, tìm nhạc piano và phát video thứ 3 | V2, 4 bước | Giữ query và N=3 | OFFLINE_TESTED, scroll overlap | Charlie/Ocean, 2 lần đọc tăng | EXPERIMENTAL |
| Phát video thứ 4/99 sau tìm kiếm | Từ chối toàn câu | Không START | BLOCKED | Không click | DISABLED |
| Mở video thứ hai (không có contract phát), hoặc không có SEARCH | Từ chối toàn câu | Không START | BLOCKED | Không click | DISABLED |

Có test parser tiếng Việt có/không dấu, tiếng Anh; app chưa mở/Home/search cũ/video khác đang phát nhưng có search affordance; ads/Shorts exclusion; target ngoài viewport; thiếu overlap; NO_RESULTS; duplicate/không rõ loại video; sai title/channel/package/session/query; PAUSED/frozen/wrong media/loading/unavailable; stale order; UNKNOWN/timeout/cancel/session loss; click ACK mà UI không chuyển; receipt giả/clone/reused sample. Mỗi fake execution đóng Session trong finally; không có Session hoặc quyền thiết bị thật được cấp.

Một popup/menu chưa giải quyết được ở LAUNCH vẫn **BLOCKED: EXPLORATION_EPOCH_LOOP**, 0 RPC click và cleanup đầy đủ. Không sửa generic recovery để ép ca này thành PASS. Player không có search/navigation evidence cũng BLOCKED, không đoán HOME/BACK. Đây là giới hạn khả năng, không phải bằng chứng tự phục hồi mọi UI.

## Migration test cũ

Không xóa/skip test, không hạ yêu cầu verification. Chỉ bốn test file cũ đổi phạm vi availability do P2 đã port:

| File | Kỳ vọng cũ → mới | Assertion giữ nguyên |
|---|---|---|
| engine-merge-catalog-gate.test.cjs | câu video thứ hai bị disabled → câu thứ 4 bị disabled | 0 discovery/prepare/start/Session, từ chối toàn câu |
| engine-merge-single-path.test.cjs | video thứ hai bị disabled → video thứ 4 bị disabled | API không tạo plan, mọi counter tác động bằng 0 |
| engine-merge-p1-v2.test.cjs | YouTube thứ nhất bị disabled → ngoài range thứ 4 bị disabled | Chrome P1/parity/security/playback criteria giữ nguyên |
| unified-engine-coverage.test.cjs | thứ nhất disabled → EXPERIMENTAL V2; negative đầu tiên/service dùng thứ 4 | V1 criteria còn nguyên; không fallback; debug engine bị từ chối; 0 START trong các test admission |

Các test mới bổ sung positive ANALYZE/preparation cho cả ba câu, bốn graph nodes, bằng chứng playback thật từ fake native readers; không lấy thay đổi catalog làm bằng chứng hoàn thành.

## Validation, hiệu năng và tính toàn vẹn

| Bước | Kết quả thực chạy | Evidence |
|---|---|---|
| Targeted 6 file: video mới, P1, catalog, single-path, engine coverage, MediaSession | 222 PASS / 0 FAIL tại thời điểm mở catalog; sau đó bổ sung 3 test biên nữa | targeted-catalog.log |
| Regression manifest an toàn 73 file: 72 file cũ + 1 mới | **1459 PASS / 0 FAIL / 6 TODO**, exit 0, 211.318 giây | regression-invocation.json; regression-unsandboxed.log; regression-unsandboxed-result.json |
| Riêng suite video cuối trong regression | **41 PASS / 0 FAIL**; 28 fake executions: 7 COMPLETED, 20 BLOCKED đúng ca âm/giới hạn, 1 CANCELLED; 13 kiểm tra compiler/admission/provenance khác | regression-unsandboxed.log; offline-outcomes.json |
| TypeScript | `tsc --noEmit --incremental false`: PASS, exit 0 | typecheck-final.log |
| Scoped ESLint 21 source/test file thay đổi, kèm 5 ignore-pattern | PASS, exit 0, 0 warning | lint-invocation.json; lint.log; lint-result.json |
| git diff --check | PASS, native Git exit 0; chỉ warning LF/CRLF | diff-check-native.log; diff-check-result.json |
| Build/full ESLint/browser/Android/model thật | NOT_RUN trong phạm vi yêu cầu này | Không suy diễn thành PASS |

Không có baseline regression mới được chạy trước sửa; mốc 1418 PASS / 6 TODO là baseline lịch sử. Lần regression hiện tại kiểm tra đầy đủ manifest đó cùng 41 test mới. Không import suite/fixture bị loại trừ để tăng số lượng.

Lần full đầu trong Windows sandbox: **1432 PASS / 27 FAIL / 6 TODO**, exit 1, 237.627 giây. Failure tập trung ở rename file tạm EPERM, cache/route-hints bị ảnh hưởng và HTTP loopback test bị chặn (NETWORK/fetch failed). Đã xác nhận Groq/worker fixtures dùng server giả riêng trên 127.0.0.1 và credentials tổng hợp; không gọi Groq/Ollama thật. Chạy lại nguyên manifest ngoài sandbox, không đổi source/test để né lỗi, cho kết quả 1459/0/6. Log đầu và kết quả lỗi được giữ nguyên ở `regression.log`, `regression-result.json`.

Các lỗi tìm thấy trong phát triển được giữ bằng chứng: lượt video đầu 27/32 PASS (terminal progress thiếu videoResult; channel prefix dùng phép canonicalize không fold nên bỏ lỡ channel; hai fixture positive chưa có full card/search affordance). Đã sửa payload terminal và channel extraction, bổ sung kiểm tra MediaSession channel; fixture positive chỉ mô tả card đầy đủ và search affordance có thật trong snapshot giả, không giả định chúng luôn có trên máy. Lượt bổ sung test menu ban đầu 40/41 do kỳ vọng recovery quá rộng; chuyển test MỚI sang kiểm tra BLOCKED cùng 0 RPC đúng hành vi quan sát được, ghi giới hạn ở trên. Không sửa recovery/old tests để biến menu thành hoàn thành. Hai lỗi TS2339 của reader mới do control-flow sau `delete after.playback` đã sửa type flow bằng cách dùng thao tác clear đã có trong independent reader, không bỏ clear hay verifier. Các log `targeted-first.log`, `targeted-second.log`, `targeted-final.log`, `typecheck.log` không bị ghi đè bằng kết quả PASS.

| Ca positive (fake native readers) | Tổng wall ms | Execution span ms | Verification span ms | Fake Appium RPC | Fake ADB reads | Model |
|---|---|---|---|---|---|---|
| N=1, OpenAI | 318 | 7.29 | 269.93 | 5 | 4 | 0 |
| N=2, podcast tiếng Anh | 312 | 7.05 | 267.79 | 5 | 4 | 0 |
| N=3, nhạc piano | 292 | 7.17 | 258.66 | 5 | 4 | 0 |

Số liệu lấy từ `offline-summary.json`. Không cộng các span thành wall time; discovery/native observation và dispatch có accounting riêng/khác mức. Fake adapter không đo latency thiết bị/RAM; 4 ADB reads là hai MediaSession + hai uptime giả, không phải lệnh ADB trên máy thật. Analyze API/service đã test offline nhưng chưa đo thời gian Analyze trên worker/browser thật. Không dùng các số này để hứa tốc độ thực tế.

### Files và tính toàn vẹn

Hai module runtime mới: `lib/android/agent/video-result-contract.ts`, `lib/android/agent/video-result.ts`. Một test mới: `tests/youtube-ordinal-v2.test.cjs`.

Source sửa: `lib/android/agent/{agent-v2,capability-registry,device-runtime,effect-grants,evidence-predicates,goal-compiler,goal-graph,grounded-candidates-v2,outcome-spec,owner-test-policy,verification-registry}.ts`, `lib/android/grounded-interactions.ts`, `lib/android/media-playback-verifier.ts`, `lib/android/unified-agent/demo-catalog.ts`. Bốn test availability nêu ở bảng migration; docs gồm báo cáo này và ghi chú catalog trong `docs/demo-capabilities.md`. Tổng 23 paths có thay đổi/thêm so với đầu lượt. Không xóa file; không sửa ConditionExecutor, worker, providers, shared parser legacy, permission-decision, journal, locks hoặc cancellation implementation.

`file-changes.json` lưu hash từng file. 68/72 test cũ byte-identical; 4 file còn lại chỉ migration availability đã mô tả. Hai file A1 `multi-device-runtime.test.cjs` và `owner-authorized-test-mode.test.cjs` không đổi SHA-256. Các source/config còn lại đã có trong preflight không đổi.

Digest theo danh sách sorted `path + NUL + SHA256(file) + LF`: 141 file lib/android TS trước = `5c6285c74b556f30b794b7c77bef3462d5e6458b767f6a50017bcc936dccbe14`; 143 file sau = `69462c27b680f07132381c1b31e6c6cdb3f6896cbac333b680609707475393ea`. Digest thay đổi là thay đổi source được yêu cầu, không phải benchmark freeze. HEAD giữ `01525d92412eb1779855beec0e359037a79873d0`, index giữ SHA `36d8254ddf6ddd6a67ae99341c61f7c68eda7953daaf664c261869aca89ceb10`; không tạo branch/commit/push trong lượt này.

| Thuộc tính | Test bảo vệ |
|---|---|
| Không mất query/N/clause hoặc playback child | `exact source/query/ordinal graph`, parser language, Unified ANALYZE runtime preparation |
| Origin/overlap, ads/Shorts, không thay N bằng 1 | 3 production loop positives, `scroll without overlap`, duplicate/unknown-type negatives; existing ui-exploration suite |
| Search proof/candidate/grant đúng Session/device, chống clone/replay | `provenance/candidate/grant binding`, `stale order`, stale dispatch; existing C17/C18, effect-grant suites |
| Không COMPLETED bằng click ACK, UI payload hoặc frozen/paused/wrong media | `no false completion/replay`, `fabricated playback`, issued receipt test; existing MediaSession suites |
| Whole-request deny và không legacy fallback | `catalog bounds`, Unified preparation tests; 4 migrated availability tests và single-path/C18 suites |
| Session đóng khi cancel/UNKNOWN/blocked | 28 fake executions có closed=1, activeSession undefined; cancellation/session-loss assertions |
| OPEN_APP/READ_STATE/SEARCH/CAMERA/CALCULATE/SET_STATE không regression | 72-file safe manifest, tổng 1418 test cũ PASS; M6a/P1/read-state/settings/journal suites |

## Điều đã và chưa chứng minh

Đã chứng minh offline một đường V2 có thể giữ đủ mục tiêu, tìm đúng ordinal thường trong fixture có ads/Shorts, cuộn có continuity, click một lần, rồi xác minh title/channel/player và MediaSession tiến lên. Các ca thiếu bằng chứng dừng an toàn. Không chứng minh suy luận LLM tổng quát: các câu này dùng rules/contracts và candidate singleton; model calls bằng 0.

Không chứng minh layout YouTube hiện tại trên Samsung hoặc mọi phiên bản/language/layout khác. Resource/metadata formats chưa nhận diện, channel metadata thiếu/mơ hồ, ads không có marker tin cậy hoặc overlay lạ có thể BLOCKED. Ordinal >3, mở kết quả không phát, và recovery mọi popup chưa hỗ trợ trong catalog này. Hai samples chỉ chứng minh tiến độ trong khoảng quan sát, không chứng minh video sẽ phát tới cuối.

P2.1 và P2.2 chỉ được gắn OFFLINE_TESTED. Chưa đủ điều kiện tuyên bố nghiệm thu Android. C17 selection/C18 idempotency có regression offline, nhưng browser acceptance trên source mới **UNVERIFIED** (Cổng 3b đã được chủ dự án yêu cầu hoãn). Cần đóng preflight/browser blockers, cấp quyền bài nghiệm thu và dùng đúng một thiết bị/Session trước một lượt acceptance riêng. Lượt này dừng ở source + offline + báo cáo, không tự chạy acceptance.
