# Milestone 3.1: Real Ollama Reasoning

Ngày: 14/10/2026. Phạm vi: Qwen hiện có, một Android Samsung A50s, một Appium Session/execution. Không đổi model, System Prompt luồng cũ, Action Plan schema hoặc policy; không tải Vision Model, không triển khai Recovery M4/multi-device/resume Dashboard.

## Kết Luận Nghiệm Thu

**Chưa nghiệm thu đầy đủ Milestone 3.1.** Đã khôi phục dịch vụ Ollama, chứng minh `/api/chat` thật từ backend, đưa snapshot Android thật vào Decision Engine và nhận JSON thật qua Zod. Nhưng chưa có goal COMPLETED trong đó Qwen chọn một action và action đó được thực thi/xác minh thành công. Không lấy JSON hợp lệ, rules-only hoặc mock làm bằng chứng thay thế tiêu chí này.

Qwen đã đề xuất target không được phép, replan không tạo tiến độ, và cuối cùng chọn REQUEST_HUMAN_ASSISTANCE. Tất cả dừng an toàn; không chuyển quyết định yêu cầu hỗ trợ thành BACK tự động, không bỏ policy, không lặp click. Khả năng abstain đã được kiểm chứng bằng model thật; khả năng điều hướng tự chủ có verification vẫn chưa đạt.

## 1. Nguyên Nhân Và Khắc Phục Ollama

- Trước khắc phục: process Ollama PID 18132 giữ listener `127.0.0.1:11434`. `/api/tags` và `/api/ps` đều timeout khoảng 8 giây, cả trong và ngoài sandbox. `/api/tags` không cần load model, nên đây là lỗi dịch vụ không trả lời, không phải bằng chứng model đang load.
- `server.log`/`app.log` rỗng; không có stack trace để xác định nguyên nhân nội bộ sâu hơn. Không khẳng định đã chứng minh deadlock, thiếu RAM hay process bị suspend.
- Windows từ chối đọc executable path/command line và dừng process đó ngay cả khi chạy ngoài sandbox. Khởi động `ollama serve` mới khi PID cũ còn sống bị lỗi bind cổng. Không tắt process không liên quan.
- Người dùng đã dừng PID cũ bằng PowerShell Administrator. Sau đó cổng trả ECONNREFUSED, xác nhận không còn dịch vụ nhận kết nối. Chạy bản `ollama.exe serve` đã cài bằng quyền thường, cửa sổ ẩn, giữ nguyên cấu hình/model; API hoạt động trở lại.
- Model cấu hình trong `.env.local`: **qwen2.5:3b-instruct**, 3.1B, Q4_K_M, khoảng 1,93 GB trên đĩa. Không dùng nhầm các model 7B/custom cũng có trong `/api/tags`. Probe backend trả cùng tên model và host.
- `/api/tags` sau khôi phục: HTTP 200, khoảng 165ms. `/api/ps`: HTTP 200, khoảng 10ms; lúc đầu chưa có model load, sau probe có Qwen 3B, CPU, `size_vram=0`.

RAM đo trước load: khoảng 7,77 GiB tổng, 0,94 GiB trống. Log phục vụ mới báo CPU, iGPU không được sử dụng và khoảng 869 MiB RAM khả dụng. Đây là áp lực tài nguyên, **không phải bằng chứng OOM**. Log cũng có cảnh báo quyền ghi cache/prune; không chỉnh ACL hoặc cấu hình lâu dài để xử lý chúng. API vẫn phục hồi.

## 2. Chat Nhỏ Và Backend

Probe cố định hỏi JSON `{"ready":true}`, stream thật, Zod kiểm tra kết quả và yêu cầu packet `done`. Không nhận prompt/model/URL tùy ý từ client. Đây là kiểm tra dịch vụ, không phải quyết định Android.

| Probe thật | Load | Nội dung đầu tiên | Hoàn chỉnh | Input / Output token |
| --- | ---: | ---: | ---: | --- |
| Cold, CLI Node | 13171ms | 14759ms | 15479ms | 36 / 6 |
| Warm, Next backend | 35ms | 4162ms | 4180ms | 36 / 6 |

Backend `POST /api/agent/diagnostics` trả HTTP 200 và chat VALID với đúng model. Endpoint chỉ bật ở development, local Ollama, một probe đang chạy, chat deadline 90 giây, response tối đa 64KiB. Không có Session điện thoại trong probe.

Thời gian nội dung đầu tiên là chunk chứa content đầu tiên đến client, không phải timestamp nội bộ từng token. Production reasoner vẫn dùng `stream:false`; `responseMs` là thời điểm có HTTP response, **không gọi nó là first-token latency**. Load/token/eval lấy từ metadata cuối Ollama, không tự ước lượng. Nguồn đơn vị duration: [Ollama API](https://github.com/ollama/ollama/blob/main/docs/api.md).

## 3. Snapshot Và Quyết Định Thật

Goal đầy đủ đã thử: `Mở Chrome, tìm công thức nấu phở và mở kết quả đầu tiên.` Goal tìm kiếm độc lập sau đó: `Mở Chrome, tìm công thức nấu phở.` Hai goal có tiêu chí khác nhau được khai báo ngay từ đầu; không bỏ criterion DESTINATION của goal đầy đủ để biến thất bại thành thành công.

Setup opt-in mở nút native `com.android.chrome:id/tab_switcher_button` **đã có trong hierarchy**, định vị lại bằng native element trước click. Không đóng/tạo tab, không chọn tab riêng tư, không click tọa độ. Một số lượt tái sử dụng overview đang có nên không gửi setup action. Setup không phải quyết định Qwen hoặc chuỗi action của Agent. Chờ native overview xuất hiện bằng XML condition, không sleep cố định.

Evidence native đọc thực tế:

- `com.android.chrome:id/tab_switcher_view_holder`
- `com.android.chrome:id/hub_main_container`
- `com.android.chrome:id/search_box_text`: ô tìm tab, **không phải thanh địa chỉ web**.
- Lượt đầu còn có `bottom_sheet`, `promo_title_text`, `promo_yes_button`: thông tin Chrome, không tự nhấn chấp nhận hay đổi setting.
- Thanh địa chỉ trang web thật ở `com.android.chrome:id/url_bar`; không có ở overview trong lượt reasoning.

Observer đọc snapshot thật, model nhận snapshotId, package, current subgoal, trạng thái, tối đa 12 control, metadata navigation, discovery/history/failure/budget. Không mock snapshot, không tắt rules để ép gọi model: ở native overview, address_bar MISSING nên rules không giải quyết được và reasoner được gọi.

### Các Lượt Reasoning Chính

| Report TEMP suffix | Kết quả model thật | Reasoning | Goal |
| --- | --- | ---: | --- |
| 1791960889315 | TIMEOUT; không nhận JSON quyết định hoàn chỉnh | 45128ms, 1 call | BLOCKED |
| 1791961060748 | WAIT_FOR_CONDITION `SEARCH_RESULTS`, JSON VALID nhưng target ngoài scope | 34008ms, 432 input / 38 output | BLOCKED trước action |
| 1791961205661 | EXPLORE_UI `search_box`, JSON VALID nhưng nhầm ô tìm tab với mục tiêu web | 31513ms, 508 / 34 | BLOCKED trước action |
| 1791961389085 | REPLAN_SUBGOAL `subgoal-1`, JSON VALID nhưng UI không đổi | 36243ms, 502 / 34 | BLOCKED bởi chống lặp, 1 replan |
| 1791961591812 | TIMEOUT trong lượt có cạnh tranh CPU/RAM với kiểm thử | 47004ms, 1 call | BLOCKED |
| 1791961735931 | REQUEST_HUMAN_ASSISTANCE, UNKNOWN_UI | 29611ms, 508 / 31 | BLOCKED, 0 action |
| 1791961893076 | REQUEST_HUMAN_ASSISTANCE, UNKNOWN_UI | 28227ms, 561 / 40 | BLOCKED, 0 action |

Lượt cuối: snapshotId `07adb699-04da-488f-b238-5f2a6b153430`, foreground Chrome, 70 node, 1 reasoning thật, 5 snapshot, 0 scroll/action/retry/replan, 1/2 criterion đạt. Model trả:

```json
{"type":"REQUEST_HUMAN_ASSISTANCE","category":"UNKNOWN_UI","reason":"Activation or sensitive controls require assistance. No clear navigation path to the search results."}
```

Zod VALID, decision được chấp nhận là abstain, không phải ALLOW cho action. Goal BLOCKED, tổng 42062ms; observation 5260ms, reasoning 28227ms. Metadata load 86ms, output eval 9410ms. Session cleanup finally hoàn tất. Không báo action verification PASS vì không có action từ model được gửi ở lượt này.

Report nằm ở TEMP theo tên `phone-commander-m31-reasoning-<suffix>.json`. Các lần setup thất bại/goal rules-only không được tính reasoning PASS. Report cuối bỏ image base64; artifact inspect đời đầu có thể chứa nhãn tab riêng tư, cần xem lại trước khi chia sẻ.

## 4. Thay Đổi Source

- `lib/android/agent/ollama.ts`, `budget.ts`, `schema.ts`: metadata model, token/load/eval/elapsed/HTTP-response; phân loại VALID/TIMEOUT/HTTP_ERROR/INVALID_JSON/UNAVAILABLE/CANCELLED và đưa vào progress.
- `lib/android/agent/decision-engine.ts`: context gọn, candidate có evidence, schema target theo goal, chỉ BACK trong overlay đã biết, loại completion chưa được evaluator chứng minh khỏi schema reasoning. Không cho replan không có failure trong nhánh LLM; rules vẫn replan khi foreground sai.
- `lib/android/agent/agent-loop.ts`: đọc lại UI sau reasoning; fingerprint đổi thì bỏ action và lặp observe. Runtime key guard trước dispatch; verify BACK bằng lớp native biến mất và search control/lớp còn lại có bằng chứng.
- `lib/android/agent/memory.ts`: chỉ giữ metadata lớp navigation, không lưu nội dung tab vào history.
- `lib/android/browser-navigation.ts`: nhận diện lớp native đã đọc thực tế, không tự chọn action.
- `lib/android/state-observer.ts`: không attach DOM khi native tab overview đang hiển thị. DOM một tab không đại diện cho overview và việc attach có thể kích hoạt tab. Unit kiểm tra không có lệnh web/context attach ở trạng thái này.
- `lib/android/ui-understanding.ts`: address_bar không còn dùng fallback nhận mọi EditText có chữ search; giữ nhận diện url_bar/address/omnibox. Ô tìm tab phải MISSING đối với mục tiêu address_bar.
- `lib/android/condition-executor.ts`: optional beforeKey hook; luồng cũ không dùng hook giữ hành vi cũ.
- `lib/android/agent/goal-planner.ts`: thêm goal SEARCH riêng với FOREGROUND + SEARCH_RESULTS. Từ chối hấp thụ yêu cầu chọn/mở/đóng/đổi app vào query. Không đổi Action Plan schema.
- `lib/android/agent/diagnostics.ts`, `app/api/agent/diagnostics/route.ts`: probe backend local/dev cố định, không gửi input tùy ý vào LLM.
- `tests/agent-reasoning.test.cjs`, `tests/agent-reasoning.integration.cjs`: mock safety và opt-in real snapshot/model, một Session.
- `tests/agent.integration.cjs`: cho phép `--goal` tự nhiên, giới hạn đúng app của bài thử.

## 5. Hiệu Năng Và Adaptive Cases

Context cũ thực tế 2664 input token, CPU khoảng 39 token/s, chưa hoàn tất trong deadline 45 giây. Rút gọn xuống khoảng 432–561 token, 12 control, bỏ wrapper/bounds và giá trị ô nhập không cần thiết; per-request `num_ctx=2048`, `num_predict=256`, temperature 0. Không đổi model hay cấu hình Ollama lâu dài. Snapshot đầy đủ vẫn ở backend cho policy/executor/verifier.

Một fingerprint/subgoal chỉ gọi model một lần; global budget reasoning vẫn 4 mặc định, giới hạn step/time/snapshot/retry/replan giữ nguyên. Không nới deadline để che lỗi. Deadline cấu hình 45 giây, elapsed thực tế có thể vượt nhẹ khi event loop/CPU bận; các timeout thực tế được ghi riêng. Các số đo là quan sát trên máy đang chạy các dịch vụ, không phải benchmark CPU/RAM cô lập.

| Adaptive case | Bằng chứng |
| --- | --- |
| Search control không có ở màn hình dự kiến | Snapshot Chrome thật, reasoner gọi thật; chưa tự giải quyết được |
| Hai address control tương tự | Unit mock: INTERACTION_POSITION, 0 call, không click đoán |
| Ở màn hình khác | Native overview thật thay vì web page; model đã abstain/replan, chưa điều hướng thành công |
| Failure có phương án khác | Mock guard/verification BACK PASS; model thật chưa chọn BACK thành công |
| UI đổi sau reasoning | Unit mock: action bị bỏ, không dispatch; Executor key guard đọc snapshot mới |
| Timeout hoặc JSON sai | Timeout thật 45/47 giây; JSON sai/HTTP failure dùng mock, không tự retry unsafe action |

Không đánh đồng sơ đồ BACK/candidate hoặc unit verification với BACK thật do model chọn. Các lần model đề xuất scope sai là lỗi quyết định model đã bị backend chặn, không phải thành công giải quyết goal.

## 6. Hồi Quy

TypeScript `tsc --noEmit` PASS; ESLint phần thay đổi PASS, không error/warning; `git diff --check` PASS. **180/180 unit tests PASS**, gồm 168 cũ và 12 M3.1, lần cuối chạy lại sau guard sensitive overlay. Toàn repo vẫn có lint tồn tại trước đã ghi ở M3, không tuyên bố sạch toàn repo. Chưa chạy production build.

API Agent thật **4/4 PASS**: strict payload, sensitive denial, goal Settings VERIFIED/cleanup, overlap409 và cancel nhả khóa. Report `phone-commander-m3-api-1791962422593.json` ở TEMP. API Observer/Executor cũ **7/7 PASS**, report `phone-commander-api-integration-1791963193755.json`; gồm policy guards, foreground VERIFIED, key chỉ SENT, timeout dừng bước sau, overlap409/cancel/cleanup. Tổng **11/11 API regression PASS**; không dùng chúng để tuyên bố reasoning Android end-to-end PASS.

Settings thật **rules-only COMPLETED**, 3 bước, 15 snapshot, 6 scroll, 1 retry, 0 reasoning; total 44401ms, observation 17591ms, execution 29808ms, verification 1211ms. Report `phone-commander-m3-settings-1791962344840.json`. Không thay đổi setting. Các phase inclusive/nested, không cộng thành total.

Chrome hồi quy thật `Mở Chrome, tìm OpenAI và mở kết quả đầu tiên.` **BLOCKED** ở criterion đích, 5 bước, 120 snapshot, 1 scroll, 0 reasoning; total 132825ms, lý do `Goal snapshots budget exhausted.` Report `phone-commander-m3-chrome-1791962171202.json`. Search đã VERIFIED nhưng đích chưa được xác minh. Các lượt goal công thức phở trước đó cũng BLOCKED tại postcondition đích. Không coi trang xuất hiện hoặc click sent là COMPLETE, không nới verifier hoặc tăng budget để vượt hồi quy.

YouTube không chạy lại trong M3.1; giới hạn activation/grounding ở M3 vẫn chưa giải quyết. Không báo YouTube PASS hoặc mọi app đã hồi quy PASS.

## Chạy Lại

```powershell
# Backend development-only; không nhận prompt/model tùy ý:
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/agent/diagnostics -ContentType application/json -Body '{"chat":true}'
node.exe tests/agent-reasoning.integration.cjs --probe
# Chạy riêng, tuần tự, không dùng Dashboard cùng lúc:
node.exe tests/agent-reasoning.integration.cjs EXAMPLE_SERIAL --overview --run --search-only
node.exe --test tests/android-executor.test.cjs tests/state-observer.test.cjs tests/ui-exploration.test.cjs tests/milestone25-resolution.test.cjs tests/visual-grounding.test.cjs tests/agent.test.cjs tests/agent-reasoning.test.cjs
```

Nếu endpoint tags timeout, xác định đúng process giữ cổng trước; không chạy nhiều `ollama serve`, không taskkill mọi node/process. Nếu process quyền Administrator, cần người dùng dừng đúng process đó bằng quyền tương ứng. Không tự đổi model để vượt bài thử.

## Hạn Chế Còn Lại

Chưa đạt goal có action do model chọn và verified trên Android. Qwen 3B có thể chọn target ngoài scope, replan không tạo tiến độ hoặc abstain quá bảo thủ; scope schema giảm sai nhưng không biến abstain thành action. Cần đánh giá thêm semantic context/candidate quality bằng tập trường hợp thật, không viết action sequence để giả tự chủ.

Goal Chrome mở kết quả công thức phở chưa tái nghiệm thu ở các lượt này; không nới verifier để vượt test. YouTube vẫn chưa được giải quyết activation evidence; chưa có Vision, human-assisted Dashboard resume, Recovery Engine hoặc multi-device Agent. Không gỡ BLOCKED để báo Milestone 3.1 hoàn tất.
