# Milestone 3.1.1: Grounded Decision Making

Ngày kiểm thử: 14/10/2026. Máy thật: Samsung A50s SM-A507FN, Android 11, serial `R58MA78W6QK`. Model giữ nguyên `qwen2.5:3b-instruct`, chạy CPU. Appium/UiAutomator2 và ChromeDriver đã cấu hình được tái sử dụng; không cài/gỡ APK, tải model, đổi public Action Plan schema hoặc system prompt phân tích lệnh cũ.

## 1. Kết Luận

**Đạt tiêu chí nghiệm thu model-action end-to-end trong phạm vi Chrome đã kiểm thử:** goal tiếng Việt, snapshot thật, rules không giải quyết được native tab overview, Qwen được gọi thật và chọn candidate, policy cho phép, Executor gửi BACK, Verifier xác minh, Agent tiếp tục và goal đầy đủ COMPLETED 3/3.

Không tuyên bố toàn bộ các lượt hồi quy đều PASS. Chrome OpenAI có các lượt COMPLETED sau sửa redirect, gồm bản cuối, nhưng một lượt recheck bị BLOCKED bởi điều kiện title/content; xem mục 5. YouTube chưa giải quyết activation evidence. Không triển khai Milestone 4.

## 2. Nguyên Nhân M3.1 Chưa Thành Công

Báo cáo lịch sử [M3.1](milestone-3.1-real-reasoning-report.md) ghi các quyết định thật: WAIT_FOR_CONDITION `SEARCH_RESULTS` ngoài scope; EXPLORE_UI `search_box` nhầm ô tìm tab; REPLAN_SUBGOAL không làm UI thay đổi; REQUEST_HUMAN_ASSISTANCE dù có lớp native điều hướng được. Có cả timeout inference. Zod VALID chỉ chứng minh cấu trúc, không chứng minh đúng mục tiêu hay quyền thực thi.

Context cũ đã có tóm tắt control/target và guard, nhưng model vẫn phải liên hệ target/action trừu tượng với ngữ nghĩa màn hình. Không có danh sách candidate ID ràng buộc đầy đủ vào phần tử, snapshot, subgoal và hậu điều kiện như bản mới. Scope/policy và chống lặp đã chặn các đề xuất sai; chúng không phải nguyên nhân cần vô hiệu hóa. Ô tìm tab không được coi là thanh địa chỉ. Replan không tạo tiến độ không được tính thành công. Khi thiếu activation evidence, yêu cầu hỗ trợ vẫn đúng.

Bản mới đưa quyền tạo action về backend: model chỉ chọn phương án có bằng chứng hoặc không hành động. Không suy diễn private chain-of-thought của Qwen và không biến abstain thành BACK.

## 3. Candidate Và Luồng Thực Thi

`action-candidates.ts` dùng TypeScript/Zod strict. Manifest server gồm candidateId, snapshotId, subgoalId, fingerprint, action, semanticRole, description, expectedOutcome, targetElementId, anchorResourceId, navigation layers và evidence enabled/visible/policy. Element ID lấy từ snapshot thật; không tạo tọa độ hoặc selector từ model.

Generator chỉ nhận OBSERVED đúng foreground app, goal không sensitive, node enabled/displayed, bounds giao viewport, đúng package và action scope. Permission/installer, dialog nhạy cảm, ô nhập đang focus có nội dung chưa lưu, control nhạy cảm, target không duy nhất hoặc thiếu bằng chứng không tạo candidate. Independent policy phải ALLOW. Không đưa mọi clickable vào danh sách. Tối đa 6 candidate; trường hợp thật trong lượt này chỉ có 1.

Các phương án hỗ trợ: BACK cho lớp điều hướng có evidence; CLICK control mục tiêu đã matching duy nhất; WAIT_FOR khi có loading indicator thật, timeout tối đa 15 giây. Chrome dùng profile native đã quan sát; dialog không nhạy cảm có nhánh tái sử dụng. Rules vẫn chạy trước và không bị tắt để buộc gọi AI.

Reply nội bộ strict: `{choice, snapshotId, subgoalId, reason}`. `choice` chỉ thuộc candidate ID hiện tại, OBSERVE_AGAIN hoặc ABSTAIN. Backend mở rộng ID thành action đã lưu. Không nhận shell, raw action, target, selector hoặc tọa độ do model tự tạo. Không có candidate thì yêu cầu hỗ trợ mà không gọi model.

Agent Loop kiểm tra membership trong manifest gốc, action equality, subgoal, fingerprint và policy độc lập. Sau inference luôn đọc lại UI cho grounded action, kể cả provider không tăng reasoning counter. Observation mới phải không quá 5 giây, cùng trạng thái phù hợp; UUID mới được rebind bằng evidence tương đương, không dùng ID cũ để tap. State đổi thì bỏ quyết định. Executor tiếp tục kiểm tra trước dispatch. BACK chỉ VERIFIED khi lớp native thật biến mất, đúng app và đúng destination/control hoặc lớp còn lại; SENT không được coi là VERIFIED.

### Candidate Thật Gửi Cho Qwen

Goal: `Mở Chrome, tìm công thức nấu phở và mở kết quả đầu tiên.`

Manifest server đọc từ artifact thật:

```json
{
  "candidateId": "candidate_c7a972e2103f",
  "snapshotId": "9243839b-f5f4-452d-b699-b18bf4e439f7",
  "subgoalId": "subgoal-1",
  "action": {"type": "PRESS_KEY", "key": "BACK"},
  "semanticRole": "reversible_navigation",
  "targetElementId": "9243839b-f5f4-452d-b699-b18bf4e439f7:15",
  "anchorResourceId": "com.android.chrome:id/hub_main_container",
  "layers": ["TAB_OVERVIEW"],
  "evidence": {"enabled": true, "visible": true, "policy": "ALLOW"}
}
```

Payload candidate thực sự gửi model là bản gọn dưới đây, không phải toàn manifest/action ở trên. SnapshotId/subgoalId gửi riêng ở context/schema; backend giữ element/action/fingerprint để kiểm tra:

```json
{
  "id": "candidate_c7a972e2103f",
  "role": "reversible_navigation",
  "description": "Return from the native tab manager to the existing web page; do not select, create or close tabs.",
  "outcome": "The obstructing native layer disappears in the same app; verify this before continuing the goal.",
  "evidence": {"enabled": true, "visible": true, "policy": "ALLOW"}
}
```

Context còn có goal/subgoal, app/screen, 2 action trước với verification, 2 mã failure gần nhất, discovery anchored/count và thời gian/bước còn lại. Không gửi full XML, ảnh, giá trị ô nhập hay tên tab riêng tư.

## 4. Model Thật Và Goal Thật

Artifact trong thư mục TEMP: `phone-commander-m311-reasoning-1791967727831.json`, mode `REAL_MODEL_REAL_ANDROID`.

Qwen chọn `candidate_c7a972e2103f` với snapshot/subgoal hiện tại, Zod VALID. `reason` thực tế chỉ lặp candidate ID; không phải giải thích ngữ nghĩa phong phú. Artifact ghi quyết định đã được backend mở rộng thành EXECUTE_ACTION/BACK cùng grounding, không lưu nguyên chuỗi JSON thô trả về. Không gọi expanded server action là raw action do model tự sinh.

| Bước quan sát/thực thi | Nguồn quyết định | Kết quả |
| --- | --- | --- |
| Native tab overview, không có address bar phù hợp | Rules không có quyết định, Qwen thật chọn ID | Candidate đúng snapshot/subgoal, policy ALLOW |
| BACK thoát overview | Candidate Qwen; Executor gửi key | VERIFIED bằng navigation postcondition |
| Dialog thông tin tiếp theo | Rules, BACK | VERIFIED; không chấp nhận/đổi cài đặt |
| Click address bar | Rules | VERIFIED |
| Nhập `công thức nấu phở` | Rules | VERIFIED |
| ENTER và search results | Rules | VERIFIED |
| Click kết quả đầu tiên | Rules + DOM discovery/revalidation | VERIFIED |
| Goal cuối | Evaluator độc lập | COMPLETED 3/3 |

Selection thật: `https://www.huongnghiepaau.com/pho-bo`. DOM URL đúng selection; title/H1: `Cách Nấu Phở Bò Ngon, Nước Dùng Đậm Đà Chuẩn Vị`; readyState complete, không error/captcha. Đây là goal đầy đủ, không dùng search-only để bỏ yêu cầu mở kết quả.

6 action, 44 snapshot, 1 scroll, 1 reasoning, 0 retry/replan, 8 iteration. Nguồn đọc: NATIVE 25, DOM_OBSERVE 14, SETUP_NATIVE 2, DOM_PRECLICK 1, DOM_ACTIVATION 1, DOM_VERIFY 1, tổng 44. Session cleanup trong finally, exit 0.

Lượt độc lập trước đó: `phone-commander-m311-reasoning-1791964832863.json`, goal search-only được khai báo từ đầu, COMPLETED 2/2, candidate `candidate_79bbf58bd8b0`, BACK VERIFIED. 5 action, 33 snapshot, 0 scroll, 1 reasoning. Harness lúc đó chưa gắn source cho 2 setup read, nên source sum 31 khác total 33; đã sửa accounting ở lượt đầy đủ, không sửa artifact cũ.

`--overview` chỉ thiết lập màn hình xuất phát bằng nút tab thật hoặc giữ overview sẵn có, không tạo/đóng/chọn tab. Setup bên ngoài Agent không được tính là model action. Toàn setup/goal dùng cùng một Session; mỗi lượt kết thúc trước lượt thiết bị tiếp theo.

## 5. Chrome Verifier Và Snapshot Budget

Baseline `phone-commander-m3-chrome-1791964515478.json` hết 120 snapshot, DOM_VERIFY 92. Trace tiếp theo `phone-commander-m311-reasoning-1791966915822.json` cũng BLOCKED 120 snapshot, DOM_VERIFY 94. URL false, title/ready/changed true, pageError false. DOM thực tế đổi từ selection `https://openai.com/` sang `https://openai.com/vi-VN/`, title `OpenAI | Nghiên cứu & triển khai`, ready complete. Không phải search chưa thực hiện hoặc context không đổi.

Inspect độc lập trước khi sửa acceptance: `phone-commander-m31-inspect-1791967069580.json` cho canonical đúng URL locale, NavigationTiming redirectCount 1, type navigate, navigationUrl đúng URL thực tế, hreflang alternate chứa cả URL root đã chọn và URL cuối. Đây là bằng chứng thật, không suy đoán locale từ hostname.

`browser-destination.ts` giữ mặc định kiểm tra normalized host/port/path và HTTP(S) không credentials. Path khác chỉ được nhận khi cùng origin và đồng thời có redirect provenance, navigation URL đúng URL cuối, canonical duy nhất đúng URL cuối, alternate chứa cả expected và actual. Same hostname/title riêng lẻ không đủ. Thiếu/mơ hồ/cross-origin evidence thì từ chối. Ngữ nghĩa redirectCount dựa trên [Navigation Timing Level 2](https://www.w3.org/TR/navigation-timing-2/#dom-performancenavigationtiming-redirectcount); giá trị kiểm thử lấy từ DOM thiết bị, không lấy từ trang tài liệu.

Title/H1 matching, complete readiness, changed URL và error/captcha guards giữ nguyên. Final native fallback cũng yêu cầu path đúng, không wildcard mọi path khi expected là root; AMBIGUOUS_CONTEXT không được vượt qua bằng native fallback. Không tuyên bố mọi verifier legacy đều có mức grounding tương đương nhánh DOM này.

Polling sau click dùng DOM destination nhẹ, không enumerate toàn bộ result links. Nhịp 250/500/1000ms khi signature không đổi; reset khi trạng thái đổi. Đây là polling điều kiện, không sleep cố định thay verifier. Deadline click tối đa 30 giây thay vì sử dụng toàn exploration timeout. Global snapshot budget vẫn **120**, không tăng. Source counters phân biệt native/observe/preclick/activation/verify; ring debug tối đa 24 boolean predicates, không lưu URL/title production log.

Lượt sau sửa identity `phone-commander-m311-reasoning-1791967494641.json`: OpenAI COMPLETED 3/3 rules-only, 2 action, 23 snapshot, DOM_VERIFY 1; mọi predicate đều đạt. **Giảm 94 xuống 1 là số đo của lượt thành công này, không bảo đảm cho mọi lượt.**

Lượt recheck `phone-commander-m311-reasoning-1791972328276.json`: BLOCKED 2/3, 56 snapshot, DOM_VERIFY 25. URL/ready/changed true, titleMatches false, pageError false; click ghi FAILED, không retry tap mù, không báo COMPLETE. Session cleanup hoàn tất. Không có DOM trace chi tiết của lượt này, nên chưa xác định được chuỗi title/H1 cụ thể gây mismatch; không suy đoán nguyên nhân từ lượt thành công khác. Việc destination chưa đủ title/content evidence là hạn chế hồi quy còn lại, không che bằng nới verifier. Lần chạy ngay trước đó dừng ở lệnh ADB mở app, chưa tạo bằng chứng goal; kiểm tra ADB sau đó xác nhận thiết bị online và chạy lại được.

Lượt cuối có trace, **không sửa source hay điều kiện verifier giữa hai lượt**, `phone-commander-m311-reasoning-1791972421045.json`: COMPLETED 3/3 rules-only, 4 action, 31 snapshot, 1 scroll, 0 retry/reasoning, 6 iteration, tổng 41,737ms. NATIVE 17, DOM_OBSERVE 11, PRECLICK 1, ACTIVATION 1, VERIFY 1. Trace đọc selection `https://openai.com/`, title `OpenAI`; đích thật `https://openai.com/vi-VN/`, title `OpenAI | Nghiên cứu & triển khai`, ready complete. URL/title/readiness/changed đạt, pageError false. Cleanup hoàn tất, exit 0. Đây là PASS bản cuối, không xóa bằng chứng BLOCKED trước đó hoặc chứng minh hết mọi biến động kết quả tìm kiếm/title.

## 6. Hiệu Năng

| Lượt Qwen thật | Reasoning | Load | Input/output token | Output eval | Total goal |
| --- | --- | --- | --- | --- | --- |
| Search-only 2/2 | 43,142ms | 21,172ms | 307 / 93 | 13,193ms | 91,589ms |
| Full goal 3/3 | 33,036ms | 11,851ms | 310 / 89 | 12,020ms | 96,203ms |

Full goal: observation 39,968ms, execution 36,589ms, verification 11,980ms. Các phase inclusive/nested, không cộng thành total. Total gồm tạo Session/setup. Đây là quan sát trên máy chạy nhiều dịch vụ, không benchmark cô lập.

M3.1 có 432-561 input token và khoảng 28-36 giây cho nhiều lượt warm. Candidate context mới khoảng 307-310 token, nhưng output dài hơn (89-93 so với 31-40) do binding ID/snapshot/subgoal; cold load làm elapsed cao. Chưa chứng minh tổng latency luôn nhanh hơn. Một fingerprint/subgoal chỉ gọi một lần, không gọi AI theo từng poll; global reasoning budget 4 và deadline hữu hạn giữ nguyên. Không chạy các bài AI đồng thời. Một số kiểm tra static/unit ban đầu có chồng thời gian với hồi quy thiết bị không AI; không gọi đây là benchmark hoàn toàn tuần tự/cô lập. Các recheck cuối chạy tuần tự.

## 7. Module Tạo/Sửa

| File | Thay đổi trong M3.1.1 |
| --- | --- |
| `lib/android/agent/action-candidates.ts` (mới) | Manifest, generator, choice schema, resolve/revalidate |
| `lib/android/browser-destination.ts` (mới) | Shared destination identity với redirect evidence |
| `lib/android/agent/decision-engine.ts` | Candidate-based fallback, compact context, cache fingerprint thật |
| `lib/android/agent/schema.ts` | Grounding nội bộ và progress telemetry; không đổi public Action Plan |
| `lib/android/agent/agent-loop.ts` | Original membership, fresh read, policy và executor/verifier hooks |
| `lib/android/agent/memory.ts` | Candidate ID/snapshot và kết quả verification trong history |
| `lib/android/agent/budget.ts` | Snapshot source counters, bounded predicate telemetry |
| `lib/android/state-observer.ts` | Accounting nguồn native |
| `lib/android/hybrid-context-observer.ts` | DOM destination nhẹ, metadata identity, adaptive condition polling |
| `lib/android/action-verifier.ts` | Reversible navigation verifier, shared browser identity, stricter native fallback |
| `lib/android/condition-executor.ts` | Verify BACK qua hook, bounded DOM destination deadline |
| `tests/action-candidates.test.cjs` (mới) | 11 test grounding/policy/stale/verifier/accounting |
| `tests/agent.test.cjs`, `tests/agent-reasoning.test.cjs` | Đổi 2 mock reply sang protocol candidate, giữ mục đích cache/schema test |
| `tests/agent-reasoning.integration.cjs` | Real candidate manifest, setup accounting, mode rules-regression, optional DOM trace |
| `README.md`, báo cáo này | Hướng dẫn chạy và bằng chứng/hạn chế |

Không thêm dependency, không chỉnh model Ollama hoặc schema/prompt Action Plan cũ trong milestone này. Các file dirty từ milestone trước vẫn được giữ, không phải mọi file trong git status đều thuộc thay đổi này.

## 8. Kiểm Thử Và Mức Bằng Chứng

**Unit: 191/191 PASS sau guard cuối**, gồm 180 bài cũ và 11 bài mới. Không xóa test cũ; hai mock đổi cách trả reply để phù hợp protocol nội bộ mới. Unit kiểm tra stale/scope/ID sai/JSON action không được hỗ trợ/sensitive/no candidate/unsaved input, UI đổi sau reasoning, postcondition thiếu, device/session error/cancel, bounded loop/budget. Các negative device-disconnect/session/unsafe case ở suite là mock, không tuyên bố vừa rút cáp hay thử thao tác nhạy cảm thật.

API Agent thật **4/4 PASS**, artifact `phone-commander-m3-api-1791968231962.json`: strict/sensitive, goal Settings và cleanup, overlap 409/cancel. API Executor/Observer cũ thật **7/7 PASS**, artifact `phone-commander-api-integration-1791968442211.json`: policy, foreground, key chỉ SENT, missing target TIMEOUT dừng bước sau, overlap/cancel/cleanup. Tổng 11/11 API; không dùng API PASS thay bằng chứng model-action.

Settings thật rules-only COMPLETED: `phone-commander-m3-settings-1791967953042.json`, 3 action, 15 snapshot, 6 scroll, 1 retry, 0 reasoning. Target ngoài viewport được tìm/xác minh; initial WAIT timeout sau 4 scroll, bounded retry với state mới tìm thấy. Tổng 44,390ms; không thay đổi setting.

TypeScript `tsc --noEmit`, ESLint 15 file source/test liên quan và `git diff --check` **PASS trên bản cuối**. Git chỉ cảnh báo chuyển LF/CRLF. Lint toàn repo vẫn có lỗi tồn tại từ trước ở DeviceScreen/ExecutionDetailModal; không tuyên bố sạch toàn repo. Không chạy production build. Không phát hiện vấn đề Next.js mới đủ điều kiện feedback trong lượt này.

## 9. Chạy Lại

Khởi động Appium, Ollama và Phone Commander theo README; giữ cấu hình đã xác minh, điện thoại mở khóa. Không chạy Dashboard execution đồng thời với harness. Thay EXAMPLE_SERIAL bằng serial thật.

```powershell
node.exe tests/agent-reasoning.integration.cjs --probe
# Full goal; chỉ exit 0 khi có Qwen thật, grounded action VERIFIED và COMPLETED:
node.exe tests/agent-reasoning.integration.cjs EXAMPLE_SERIAL --overview --run
# Regression không dùng để nghiệm thu model-action:
node.exe tests/agent-reasoning.integration.cjs EXAMPLE_SERIAL --run --rules-regression --goal 'Mở Chrome, tìm OpenAI và mở kết quả đầu tiên.'
node.exe tests/agent.integration.cjs EXAMPLE_SERIAL settings --fresh
node.exe tests/agent-api.integration.cjs EXAMPLE_SERIAL
node.exe tests/android-observer-api.integration.cjs --serial EXAMPLE_SERIAL
node.exe --test tests/android-executor.test.cjs tests/state-observer.test.cjs tests/ui-exploration.test.cjs tests/milestone25-resolution.test.cjs tests/visual-grounding.test.cjs tests/agent.test.cjs tests/agent-reasoning.test.cjs tests/action-candidates.test.cjs
node.exe node_modules/typescript/bin/tsc --noEmit
```

`--search-only` là goal riêng được khai báo trước, không làm yếu goal đầy đủ. `--rules-regression` chỉ thay tiêu chí harness phân loại bằng chứng, không tắt decision engine/rules/model. `--dom-trace` opt-in lưu URL/title/H1 của tối đa 16 trạng thái từ response thật, không thêm DOM reads và không gửi model; chỉ dùng trang công khai, kiểm tra artifact trước chia sẻ. Report ở TEMP, không commit nội dung tab riêng tư.

## 10. Giới Hạn

Bằng chứng thật mới bao phủ một điện thoại, một profile Chrome tab overview và một candidate navigation. Không chứng minh model chọn giữa nhiều candidate phức tạp, hiểu mọi menu/dialog, Chrome phiên bản khác hoặc overview không có tab. Generic dialog được hỗ trợ nhưng rules thường xử lý trước; chưa có bài model thật cho app khác. Guard an toàn không đồng nghĩa general-purpose autonomy đã hoàn thiện.

Chrome OpenAI title/content mismatch vẫn có thể BLOCKED; không thêm ngoại lệ title để đạt test. YouTube không chạy lại trong M3.1.1 và activation/ordinal grounding vẫn chưa được nghiệm thu. Chưa có Vision, Dashboard human-assisted resume, Recovery Engine đầy đủ hay multi-device Agent. Không xử lý CAPTCHA, đăng nhập, đăng ký kênh, mua hàng hoặc chỉnh cài đặt nhạy cảm. Các Session thử nghiệm được đóng; dịch vụ phát triển không bị tắt.
