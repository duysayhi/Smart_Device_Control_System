# Milestone 3.2: Multi-Candidate Decision Making

Ngày: 14/10/2026. Samsung A50s SM-A507FN, Android 11, serial `R58MA78W6QK`. Appium 3.8.0, UiAutomator2 8.7.0, helper APK hiện có được kiểm chứng trước `skipServerInstallation=true`. Model giữ nguyên `qwen2.5:3b-instruct`, chạy CPU.

## 1. Nghiệm Thu

**PASS điều kiện multi-candidate Android thật:** Qwen chọn giữa ít nhất hai candidate hợp lệ khác nhau về ý nghĩa, action được thực thi và VERIFIED, goal Settings COMPLETED 2/2. Có hai trạng thái lựa chọn thật trong cùng một Session, không dùng mock làm bằng chứng nghiệm thu.

Chrome Python và Chrome OpenAI COMPLETED 3/3 rules-only; Settings cũ COMPLETED. **Không báo mọi goal/ứng dụng PASS:** YouTube BLOCKED vì mất ordinal continuity. Multi-candidate với Qwen trong Chrome/YouTube là **NOT TESTED**, không tạo candidate giả hoặc thay UI để ép lựa chọn. Phạm vi đã chứng minh là flow Android dựa trên candidate với Settings và các profile đọc liên quan, không phải mọi ứng dụng Android.

## 2. Đánh Giá Generator Cũ

M3.1.1 đã binding snapshot/subgoal/fingerprint, có policy/fresh read và verification, nhưng chủ yếu trả một BACK trong Chrome native tab overview. CLICK/WAIT chỉ xoay quanh target hiện hành; manifest chưa có precondition/verification/safety/goalRelation tường minh. Agent scope chỉ cho click search/current target, chưa cho chọn navigation đọc từ UI. FIND_ELEMENT cũ chỉ tìm label literal, không diễn giải yêu cầu tìm nơi đọc thông tin.

| Tình huống | Bản 3.2 và giới hạn |
| --- | --- |
| Nhiều phương án cùng scene | Search, direct information/category và scroll nếu UI thật có bằng chứng; tối đa 6 |
| Nhãn tương tự/trùng tên | Matching thuộc tính quan sát được; breadcrumb/summary không cấp quyền tap; nhãn không phân biệt được, kể cả khác casing, bị loại |
| Menu/tab | Có thể dùng read-navigation khi label/resource/owner chứng minh liên quan goal và an toàn; không click menu/tab bất kỳ chỉ vì clickable |
| Vùng cuộn | Dùng detector và ScrollController hiện có, unique region, clipping và verification content change |
| Search | Unique observed control, focused search input và literal phrase trong yêu cầu; Settings Search có profile package riêng |
| Dialog/tab overview | Giữ rules/dialog và native navigation profile đã có; không vô hiệu hóa rules để buộc gọi Qwen |
| Loading | OBSERVE_AGAIN khi có ProgressBar; WAIT hiện có vẫn hữu hạn, không tạo selector cho phần tử chưa quan sát |
| Khác tác dụng | goalRelation/semanticRole/outcome giúp phân biệt đọc thông tin, mở search, khám phá qua scroll và reversible navigation |

Observer, Explorer, Executor và Agent Loop được tái sử dụng; không viết Action Plan cố định hoặc click theo tọa độ dự đoán.

## 3. Manifest Và Guard

Manifest strict TypeScript/Zod gồm candidateId, snapshotId, subgoalId, fingerprint, action, semanticRole, description, expectedOutcome, targetElementId/anchor/layers, UI evidence, preconditions, safety, verification và goalRelation.

Precondition phải có đúng package, unique target, không có input người dùng chưa lưu và nằm trong scope. Query do Agent vừa nhập được nhận diện riêng bằng nội dung đúng literal user goal; không dùng ngoại lệ này cho BACK. Verification kinds: NAVIGATION_LAYER_REMOVED, TARGET_TRANSITION, TARGET_VISIBLE, FOCUSED_SEARCH, READ_NAVIGATION, SCROLL_CHANGED.

Generator không đưa mọi clickable vào manifest. Node/owner phải enabled, hiển thị trong viewport, matching duy nhất, đúng foreground/package family và có semantics đọc/tìm kiếm liên quan. Policy đọc quan sát được được tính độc lập, không tin `evidence.policy` do caller cung cấp. Switch/checkbox/toggle, control nhạy cảm hoặc owner có descendant thay đổi dữ liệu bị chặn. Không cấp read-navigation cho nội dung WebView chỉ dựa label. Chặn dọn dẹp/reset/clear data và không bấm các nút đó.

`observed:` là tham chiếu kết hợp resource-id, text và className thực sự đọc được, parse bằng JSON/Zod strict. Nó phân biệt title `Bộ nhớ` với breadcrumb cùng tên. Không phải XPath/CSS do Qwen tự sinh. Locator, clickable owner, bounds và fresh validation vẫn do Observer/Resolver hiện có thực hiện. Hai entry không phân biệt được vẫn không được đưa vào lựa chọn ngẫu nhiên.

Model chỉ trả candidate ID hiện tại hoặc OBSERVE_AGAIN/ABSTAIN với snapshotId/subgoalId và reason ngắn. Payload gọn gồm goal/subgoal, app/screen, tối đa 6 candidate với ID/role/relation/description/outcome/evidence/verification kind, hai action trước, hai failure code, discovery summary và budget. Manifest đầy đủ/action/element binding ở backend, không gửi full XML, screenshot hoặc tên tab riêng tư.

Backend kiểm tra manifest gốc, action equality, subgoal, fingerprint; đọc lại sau reasoning; revalidate snapshot không quá 5 giây; policy và preconditions chạy lại trước gửi action. Candidate thất bại không được đề xuất lại khi chưa có evidence mới; mutating action thiếu verification vẫn dừng an toàn. Action trong cùng execution không được chạy chồng nhau. Completion chỉ do evaluator độc lập, không do decision của Qwen cấp quyền.

## 4. Goal Settings Mới

Goal nguyên văn: `Mở Cài đặt và tìm nơi xem dung lượng bộ nhớ.` Planner tạo internal FIND_PLACE/READ_LOCATION, giữ subject `dung lượng bộ nhớ`; query `bộ nhớ` lấy nguyên văn từ yêu cầu. Không đổi public Action Plan schema/prompt/model cũ.

Profile package giới hạn: Settings, Settings Search `com.android.settings.intelligence`, và Samsung Device Care `com.samsung.android.lool` chỉ cho storage/memory read goal. Các package này được quan sát thực tế trong bài thử; không có quyền chuyển sang app tùy ý. FOREGROUND đầu tiên vẫn phải xác minh Settings đúng package, không bỏ criterion khi bắt đầu ở Search/Device Care.

READ_LOCATION không hoàn thành khi chỉ thấy search row. Phải ở app được phép, không còn search input/dialog/loading, có nhãn thông tin memory/storage, số dung lượng có cấu trúc (ratio hoặc caption dung lượng) và caption usage định lượng. Không dùng tên app chứa chữ `tổng`, kích thước app riêng lẻ hoặc title gần giống làm proof. Bài thật mở màn hình **RAM 4 GB**, không chứng minh dung lượng bộ nhớ lưu trữ flash của điện thoại.

### Manifest Thật Trên Bản Cuối

Artifact TEMP: `phone-commander-m32-settings-1791977601683.json`, mode REAL_ANDROID_M32. Không chuẩn bị tab/dialog/test UI ngoài Agent. Máy giữ trạng thái sau các hồi quy trước; các lựa chọn sinh từ UI thật, không force-stop để tạo multi-candidate.

| Snapshot | Candidate | Action backend | Ý nghĩa / verification | Qwen |
| --- | --- | --- | --- | --- |
| `5b358e6f-394b-4be2-ae86-a358ffe14638` | `candidate_63757aaa01f3` | CLICK `accessibility_id:Tìm kiếm` | SEARCH_ROUTE, FOCUSED_SEARCH | Chọn |
| Cùng snapshot | `candidate_655187169360` | SWIPE up | DISCOVERY_ROUTE, SCROLL_CHANGED | Không chọn |
| `7a068579-b34a-4c86-8aec-ee16aa090f08` | `candidate_5f319f07c52c` | CLICK title `Bộ nhớ` bằng observed attribute conjunction | DIRECT_INFORMATION, READ_NAVIGATION | Chọn |
| Cùng snapshot | `candidate_c6d32fb521cf` | SWIPE up | DISCOVERY_ROUTE, SCROLL_CHANGED | Không chọn |

Binding: subgoal-1; root search element `5b358e6f-394b-4be2-ae86-a358ffe14638:13`, scroll region `com.android.settings:id/recycler_view`; result title element `7a068579-b34a-4c86-8aec-ee16aa090f08:51`, resource `android:id/title`, class `android.widget.TextView`; result scroll region `com.android.settings.intelligence:id/list_results`. Mỗi candidate có enabled/visible/policy ALLOW, package precondition, safety READ_NAVIGATION và condition xác minh tương ứng.

Choice được adapter validate là hai ID đánh dấu chọn ở trên, đúng snapshot và subgoal. Reason lượt đầu thực tế chỉ là `candidate_63757aaa01f3`; lượt hai là `candidate_5f319f07c52c 直接提供关于内存容量的信息，符合目标需求。`. Không suy diễn chain-of-thought. Artifact lưu quyết định đã mở rộng phía server thành EXECUTE_ACTION cùng grounding, không lưu chuỗi JSON thô của model; raw Android action không do Qwen tự tạo.

### Thực Thi Và Kết Quả

1. Settings foreground đã có sẵn, criterion được xác minh; không cần OPEN_APP ở lượt cuối.
2. Qwen chọn Search thay vì scroll; Executor nhấn control thật. Search package/input focus được xác minh, action VERIFIED.
3. Rules nhập đúng `bộ nhớ` vào `com.android.settings.intelligence:id/search_src_text`, password=false được Executor kiểm tra; input VERIFIED.
4. Qwen chọn title Bộ nhớ thay vì scroll; Resolver phân biệt title/breadcrumb, fresh policy/locator/owner checks, click thật, READ_NAVIGATION VERIFIED.
5. Postcondition snapshot `714f3b68-4442-4dc6-9317-520e3879c966`, package Device Care: `Bộ nhớ`, `Đã dùng 55%`, `2,2 GB / 4 GB`. Evaluator READ_LOCATION VERIFIED, **COMPLETED 2/2**. Không dọn RAM, đổi cài đặt hoặc dữ liệu tài khoản.

3 action, 14 snapshot NATIVE, 0 scroll, 2 reasoning, 0 retry/replan, 4 iteration, total 85,639ms. Hai action chọn bởi Qwen đều có candidateId và verification VERIFIED trong history. Session cleanup finally, exit 0, multiCandidate PASS.

Recheck trước đó sau reconnect: `phone-commander-m32-settings-1791975990615.json`, COMPLETED 2/2, hai lựa chọn multi thật, 4 action/22 snapshot/2 reasoning, total 99,877ms. Lượt cuối là proof chính. Sau proof cuối có thêm deny-only guard normalize duplicate label/casing và không suy ra memory từ riêng chữ dung lượng (ví dụ dung lượng pin). Goal thật có bộ nhớ tường minh và không có read-label duplicate, nên các guard không thay manifest trên; được kiểm tra bằng unit regression, không tính là lần gọi Qwen mới.

## 5. Các Lượt Chưa Thành Công

| Artifact TEMP | Kết quả và xử lý |
| --- | --- |
| `phone-commander-m32-settings-1791974020032.json` | Qwen chọn Search giữa hai lựa chọn; verifier same-package cũ không nhận Settings Intelligence, BLOCKED. Quan sát package/input thật trước khi thêm profile |
| `phone-commander-m32-settings-1791974184141.json` | Bắt đầu ở Search, FOREGROUND chưa xác minh; NOT TESTED multi. Sửa rules để thiết lập đúng Settings foreground, không bỏ criterion |
| `phone-commander-m32-settings-1791974254669.json` | Search/input VERIFIED, title và breadcrumb Bộ nhớ chưa phân giải, không có activation candidate, BLOCKED |
| `phone-commander-m32-settings-1791974520133.json` | Model chọn scroll ở result list nhưng guard package chưa được nối vào scroll adapter, BLOCKED trước gesture. Sửa adapter trong scope profile và bổ sung goalRelation, không ép chọn ID |

Các lần sau `1791974753824`, `1791975093000` đã COMPLETED và giúp đối chiếu data/caption. Chúng là lịch sử debugging trước guard evidence/caption cuối, không thay proof chính và không sửa JSON artifact cũ. Caption được siết về usage định lượng/ratio để tránh lấy từ tên app khác; raw inspect đầu giai đoạn có nhãn UI/history riêng tư, chỉ ở TEMP, cần kiểm tra trước chia sẻ. Không commit raw hierarchy, ảnh màn hình máy hoặc log Appium vào repo.

## 6. Chrome Và Title/Content Mismatch

Goal: `Mở Chrome, tìm hướng dẫn cài Python trên Windows và mở kết quả đầu tiên.`

Baseline `phone-commander-m311-reasoning-1791976177718.json`: BLOCKED 2/3, 50 snapshot, DOM_VERIFY 13. URL/ready/changed true, pageError false, titleMatches false. Selection DOM thật là `Cài đặt Python trên Windows - Viblo.asia`, URL `https://viblo.asia/p/cai-dat-python-tren-windows-x7Z4Dn71LnX`; trang thật title/H1 `Cài đặt Python trên Windows`.

Inspect trước sửa acceptance `phone-commander-m31-inspect-1791976323036.json` chứng minh canonical duy nhất đúng URL thật, navigationType navigate, navigationUrl đúng URL thật, title/H1 chính xác như trên, ready complete.

Shared `matchesBrowserResultTitle` giữ matching title đầy đủ trên từng field, không ghép các mảnh title/H1 thành giả proof. Ngoại lệ hậu tố chỉ cho literal hostname của URL đã chọn, sau delimiter; phải đồng thời khớp destination URL, canonical duy nhất, navigation provenance, article title và H1 bằng đúng phần còn lại. Không xóa branding tùy ý, không chấp nhận tên bài gần giống, không hardcode Viblo, không bỏ URL/readiness/error/captcha guard.

Sau sửa: `phone-commander-m311-reasoning-1791976539756.json`, **COMPLETED 3/3 rules-only**, 4 action, 31 snapshot (NATIVE 17, DOM_OBSERVE 11, PRECLICK 1, ACTIVATION 1, VERIFY 1), 1 scroll, 0 reasoning/retry, total 55,548ms. Trace vẫn đúng selection URL/title và article title/H1; tất cả predicate đạt. Không dùng sửa title để coi tìm kiếm xong là hoàn thành mở kết quả.

OpenAI regression `phone-commander-m311-reasoning-1791976663197.json`: **COMPLETED 3/3 rules-only**, 4 action, 31 snapshot, DOM_VERIFY 1, 0 reasoning/retry, total 58,058ms. Locale redirect proof của M3.1.1 giữ nguyên. Không tăng global budget 120 hoặc deadline 240 giây; snapshot accounting và bounded destination polling giữ nguyên.

Các native menu/tab có thể hiện diện nhưng rules đã có address/search control duy nhất, nên không ép Qwen chọn hai control khác để lấy PASS. Multi-candidate Chrome NOT TESTED ở các lượt này. Những title/branding khác không có canonical/H1/identity evidence vẫn có thể BLOCKED; không tuyên bố hết mọi mismatch.

## 7. YouTube Và Settings Hồi Quy

YouTube `phone-commander-m32-youtube-1791976846067.json`: goal podcast tiếng Anh/video thứ hai **BLOCKED 2/3**, reason `No overlap with remembered results; ordinal continuity was lost.` Search/query đã VERIFIED; 6 action attempt, 59 snapshot, 8 scroll, 1 retry, 0 reasoning, total 87,626ms. Không gửi tap đoán cho video thứ hai sau khi mất continuity. Ordinal discovery dừng trước khi có proof activation đúng mục tiêu; activation vẫn chưa nghiệm thu. Multi-candidate Qwen NOT TESTED, không đăng nhập/like/subscribe hay thêm Vision.

Settings cũ `phone-commander-m3-settings-1791976978318.json`: `Mở Settings và tìm mục Thông tin điện thoại.`, **COMPLETED rules-only**; 3 action, 13 snapshot, 6 scroll, 1 bounded retry, 0 reasoning. Không thay đổi setting. Initial WAIT 15 giây hết deadline, fresh retry tiếp tục từ UI mới và tìm thấy target; không mở rộng timeout vô hạn.

## 8. Mất Kết Nối Và Cleanup

Một lần Chrome preparation bị `unknown error`; Appium log và `adb devices` xác nhận instrumentation dừng/device mất kết nối. Cleanup DELETE không thành công, lock được giữ đúng thiết kế. Không coi `/status ready` là proof không có Session, không tự mở thêm Session.

Người dùng cắm lại USB. Kiểm tra device online, process owner test đã kết thúc, server Appium không còn nghe cổng và không còn ADB forwards. Sau kiểm tra/approval, chỉ xóa owner file và thư mục khóa rỗng đúng serial, không recursive delete. Khởi động lại Appium đã cài bằng process nền loopback; kiểm tra phiên bản/driver và health. Không cài/gỡ APK, tải driver hoặc thay model. Các lượt tiếp theo hoàn tất và cleanup; API overlap/cancel cũng PASS. Đây là xử lý thủ công phục vụ test, không phải Recovery Engine hoặc auto-resume mới.

## 9. Hiệu Năng Qwen

Lượt proof cuối:

| Decision thật | Elapsed | Load | Input/output token | Output eval |
| --- | --- | --- | --- | --- |
| Search vs scroll | 36,176ms | 14,225ms | 405 / 88 | 10,977ms |
| Memory vs scroll | 22,703ms | 42ms | 423 / 108 | 15,257ms |

Tổng reasoning 58,879ms; observation 14,797ms, execution 13,336ms, verification 4,986ms, total 85,639ms. Phase inclusive/nested, không cộng thành total. Source counters là actual read attempts; hai inference, không gọi AI sau mọi thao tác/poll. Không chạy AI tests đồng thời; bộ kiểm tra cuối chạy sequential theo nhóm. Một cặp TSC/unit trong debugging có chồng thời gian, không dùng làm benchmark inference.

M3.1.1 có một candidate, khoảng 307-310 input token; 3.2 có hai candidate với semantics/verification, khoảng 405-423 ở proof cuối. Context tăng có giới hạn để phân biệt ý nghĩa, không tuyên bố giảm token hoặc tổng latency luôn nhanh hơn. Cold load giải thích một phần chênh lệch; không đo RAM/CPU isolation. Giữ model, hữu hạn reasoning budget/deadline và cache fingerprint/subgoal. Không gửi XML/ảnh vào Qwen text-only.

## 10. File Tạo/Sửa

| File | Nội dung |
| --- | --- |
| `lib/android/agent/navigation-semantics.ts` (mới) | Observed target, read-location/search semantics, clipping, bounded package profiles và capacity evidence |
| `lib/android/agent/candidate-verifier.ts` (mới) | Verification riêng theo candidate/search/scroll/read destination |
| `lib/android/agent/action-candidates.ts` | Manifest preconditions/safety/verification/goalRelation, nhiều lựa chọn, ambiguity filtering |
| `lib/android/agent/decision-engine.ts` | New information goal decisions, compact multi-candidate context, failed-choice filtering |
| `lib/android/agent/schema.ts`, `goal-planner.ts`, `evaluator.ts` | Internal FIND_PLACE/READ_LOCATION; completion evidence, không đổi public Action Plan |
| `lib/android/agent/agent-loop.ts` | Independent runtime policy, grounded execution hook, serial action guard và authorized package profiles |
| `lib/android/condition-executor.ts` | Hooks trước dispatch, outcome verification và package-aware read navigation/scroll |
| `lib/android/security-policy.ts` | Observed read policy, sensitive cleanup/reset guards, chống WebView/data-changing owner |
| `lib/android/ui-understanding.ts` | Strict observed attribute conjunction, không đoán XPath/coordinate |
| `lib/android/browser-destination.ts` | Evidence-based literal hostname title suffix helper |
| `lib/android/action-verifier.ts`, `hybrid-context-observer.ts` | Shared title evidence trong poll và final evaluator, giữ URI/readiness/error guards |
| `tests/multi-candidates.test.cjs` (mới) | 10 unit cho lựa chọn, stale/scope/ambiguity/policy/postcondition/goal |
| `tests/browser-title-evidence.test.cjs` (mới) | 4 unit branding identity positive/negative/captcha |
| `tests/agent-candidates.integration.cjs` (mới) | Real UI inspect/goal, actual multi-choice manifest/history/telemetry/capacity evidence |
| `tests/agent-reasoning.integration.cjs` | Opt-in backend error trace để chẩn đoán Session lỗi |
| `README.md`, báo cáo này | Hướng dẫn và phân biệt các mức bằng chứng |

Không thêm dependency, sửa Modelfile/Ollama model, public Action Plan schema, prompt phân tích cũ, Session Manager/Observer/Explorer implementation hoặc frontend. Không tự commit/push bản 3.2 trong yêu cầu này.

## 11. Unit / API Và Chạy Lại

**205/205 unit PASS**, gồm 191 bài giữ lại + 10 multi-candidate + 4 title-evidence. TypeScript `tsc --noEmit` và ESLint phần source/test sửa PASS; không tuyên bố lint toàn repo sạch (lỗi cũ DeviceScreen/ExecutionDetailModal chưa thuộc phạm vi). Chưa chạy production build.

API Agent thật **4/4 PASS**, `phone-commander-m3-api-1791977187129.json`: strict injection/sensitive rejection trước Session, completion/cleanup, overlap409/cancel. API cũ thật **7/7 PASS**, `phone-commander-api-integration-1791977325176.json`: policy, foreground SUCCESS, key chỉ SENT, TIMEOUT dừng bước sau, overlap/cancel/cleanup. Tổng 11/11; không lấy chúng thay proof Qwen thật. Các negative JSON/stale/unsafe/session/error cases trong unit là mock; disconnect ở mục 8 là sự cố thật, không cố tình rút cáp để ép test.

```powershell
# Giữ services ở README; một máy mở khóa, không chạy Dashboard execution đồng thời:
node.exe tests/agent-candidates.integration.cjs EXAMPLE_SERIAL settings --run --require-multi
node.exe tests/agent-candidates.integration.cjs EXAMPLE_SERIAL chrome --run
node.exe tests/agent-candidates.integration.cjs EXAMPLE_SERIAL youtube --run
node.exe tests/agent.integration.cjs EXAMPLE_SERIAL settings --fresh
node.exe tests/agent-api.integration.cjs EXAMPLE_SERIAL
node.exe tests/android-observer-api.integration.cjs --serial EXAMPLE_SERIAL
node.exe node_modules/typescript/bin/tsc --noEmit
node.exe --test --test-concurrency=1 tests/android-executor.test.cjs tests/state-observer.test.cjs tests/ui-exploration.test.cjs tests/milestone25-resolution.test.cjs tests/visual-grounding.test.cjs tests/agent.test.cjs tests/agent-reasoning.test.cjs tests/action-candidates.test.cjs tests/multi-candidates.test.cjs tests/browser-title-evidence.test.cjs
```

`--require-multi` yêu cầu goal COMPLETED và action chọn từ manifest có ít nhất hai role khác nhau được VERIFIED. Không có tình huống đó thì NOT TESTED hoặc BLOCKED, không coi rules-only/mock là multi PASS. Script không thay UI để dựng candidate. `--inspect --current` đọc UI hiện tại bằng một Session rồi đóng; output mới lọc nhãn, nhưng vẫn kiểm tra TEMP artifacts trước chia sẻ. `--dom-trace`/`--backend-trace` ở harness reasoning là opt-in diagnostics local cho trang công khai, không gửi model, không đưa raw error trace vào production UI.

## 12. Giới Hạn Và Dừng

Chưa chứng minh multi-candidate reasoning trên các ứng dụng độc lập ngoài Settings flow, mọi menu/tab, ngôn ngữ/phiên bản OEM khác hoặc goal đọc thông tin bất kỳ. Information completion hiện có verifier định lượng memory/storage; các topic khác cần verifier tương ứng, không tự COMPLETE khi chỉ thấy label. Profile Samsung là adapter read-only có giới hạn, không action sequence hardcoded và không quyền mở mọi app.

YouTube mất overlap và activation chưa được giải quyết; không tăng quãng cuộn/timeout để che ordinal ambiguity. Title mismatch không có identity/H1 evidence vẫn BLOCKED. Chưa có Vision, full Recovery Engine, multi-device Agent, Dashboard human-assisted resume, đăng nhập/CAPTCHA hoặc sensitive action support. Các Session test đã đóng, services phát triển giữ chạy. Dừng ở Milestone 3.2; không triển khai Milestone 4. Không quan sát vấn đề Next.js mới đủ điều kiện feedback trong lượt này.
