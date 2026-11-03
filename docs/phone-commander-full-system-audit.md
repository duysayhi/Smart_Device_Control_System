# Phone Commander: kiểm toán toàn hệ thống và mức độ tự chủ AI

Ngày báo cáo: 21/10/2026. Branch kiểm tra: `DuyTD`. Đây là kiểm toán trạng thái working tree hiện có, không phải chỉ kiểm tra commit cuối. Các thay đổi có sẵn của chủ dự án được giữ nguyên. Không sửa runtime, prompt, validator, fixture hoặc cấu hình; không commit/push.

## 1. Kết luận điều hành

**Agent hiện chưa phải một Android agent tổng quát có thể tự bảo đảm hoàn thành câu lệnh mới trên ứng dụng bất kỳ.** Hệ thống có nền tảng thực thi khá chặt: nhận diện thiết bị, sở hữu Session, fresh observation, cấp quyền một lần và verifier độc lập. Tuy nhiên, hiểu nghĩa câu lệnh, suy ra vai trò UI mới và tìm phương án phục hồi còn phụ thuộc nhiều vào regex, danh mục capability và contract được lập trình trước.

- Regression **577/577 PASS**, TypeScript PASS. Đây chủ yếu là kiểm thử offline/mô phỏng, không chứng minh AI tự chủ.
- Kiểm thử Android mới: **3 execution; 2 COMPLETED, 1 BLOCKED, 0 FAILED**. Cả ba có **0 model call**: chứng minh đường rules/contracts thực thi thật, không chứng minh LLM tự lập kế hoạch thành công.
- Tám câu lệnh lập kế hoạch mới, Việt/Anh và nhiều bước: chỉ ba trường hợp thực sự gọi Qwen. Cả ba trả dữ liệu hợp schema, nhưng không trường hợp nào đạt toàn bộ ý nghĩa mong đợi trong phép thử này. Những trường hợp còn lại được xử lý/chặn bằng rules trước model.
- Nhánh Action Plan cũ có lỗ hổng kiểm tra nguồn request và policy development quá rộng. Không thể coi chế độ owner giới hạn theo thiết bị của V2 là bảo vệ chung cho mọi đường thực thi.
- Build mặc định Turbopack FAIL; build Webpack PASS nhưng có warning `module.createRequire`. Full ESLint FAIL với một lỗi `any` có sẵn.

Không phát hiện P0 đã được xác minh. Có các vấn đề P1 cần xử lý trước khi mở rộng quyền tự chủ hoặc dùng dự án như dịch vụ cho nhiều người.

## 2. Phạm vi và phương pháp

Đã đọc source thực tế ở các API, Dashboard/hook, worker/runtime, planner V1/V2, provider/scheduler, catalog, observer, grounded candidates, policy/grants, executor, verifier, record persistence, settings recovery và Session management. Đây là kiểm toán xuyên suốt các đường quan trọng, không phải chứng minh hình thức rằng mọi dòng code đều không có lỗi.

Quy ước bằng chứng:

- **OFFLINE_TESTED**: test hoặc gọi hàm thật nhưng không tác động Android; mock PASS không được nâng thành nghiệm thu thiết bị.
- **REAL_MODEL_PLANNING_ONLY**: model thật, chưa cấp grant/chạy executor; không tính là hoàn thành mục tiêu trên Android.
- **REAL_DEVICE_VERIFIED**: có thao tác/quan sát và independent native readback thật.
- **SAFE_BLOCKED/BLOCKED**: thiếu contract/bằng chứng hoặc bị chặn; không đồng nghĩa tất cả trường hợp đều là lỗi an toàn.
- **UNVERIFIED**: chưa nghiệm thu trong lượt này, dù có source hoặc báo cáo cũ.

Không đọc hay dùng sealed benchmark, không tuning theo sealed, không dùng bộ holdout để thay thế phép thử mới. Tám câu lệnh ad-hoc dưới đây là phép thử phát triển nhỏ, không phải bộ đánh giá độc lập đại diện cho mọi tác vụ.

Freeze: 177 file source/cấu hình trong manifest audit, SHA-256 tổng `c13d8d553b8798b9d4971709c06350385872d3366b006917256d877c59ed237b`; so sánh cuối không có file trong manifest bị thay đổi. Hash này không phải Git commit hoặc hash của toàn bộ repo. Bằng chứng sinh ra được lưu ở TEMP, không thêm script thử nghiệm vào source.

## 3. Kiến trúc và công nghệ hiện tại

### 3.1 Các thành phần

| Thành phần | Source/cấu hình thực tế | Vai trò và giới hạn |
| --- | --- | --- |
| Web | Next.js 16.4.0, React 19.3.0, TypeScript, Tailwind 4, Zod 4; `app/page.tsx`, `components/commands/*` | Dashboard thật, API routes Node; không chỉ là giao diện demo. Một số thao tác mô phỏng có nhãn riêng và chỉ tạo log. |
| Dashboard | `AICommandPanel.tsx:70`, `AgentGoalPanel.tsx:59` | Mặc định tab Agent, nhưng phiên bản Agent mặc định là V1. Phải chọn V2 để dùng Goal Graph/owner policy V2. |
| API | `app/api/commands/interpret`, `executions`, `agent`, `agent/runtime`, `devices`, `devices/wireless` | Có nhiều đường thực thi khác nhau, không phải mọi request đều đi qua V2. |
| Worker | `scripts/agent-worker.cjs`, `worker-client.ts`, `worker-server.ts` | Process Node tách Next, bind loopback, bearer token, journal/tasks, cancellation, device reservation. Transpile TypeScript ở runtime. |
| Suy luận | Ollama, `ollama.ts`, `reasoning-provider.ts`, `reasoning-scheduler.ts` | Local Qwen mặc định; có cloud/Groq router tùy chọn, nhưng không dùng cloud trong phép thử này. |
| Quan sát | `state-observer.ts`, `snapshot.ts`, `ui-world-model.ts`, `widget-semantics.ts` | Native Appium hierarchy và ADB state; có DOM/hybrid logic cho trình duyệt. Phần lớn semantics là heuristic, không phải vision model tự hiểu ảnh. |
| Thực thi | `condition-executor.ts`, `agent-loop.ts`, `agent-v2.ts`, `intent-executor.ts` | Action Plan/V1/V2 khác nhau; Appium interaction, ADB intent/readback, fresh revalidation. |
| Verification | `verification-registry.ts`, `evidence-predicates.ts`, `read-only-verifiers.ts`, `record-persistence.ts` | Bằng chứng theo contract có sẵn; không có verifier tự sinh cho một nghiệp vụ bất kỳ. |
| Kết nối | `appium/session-manager.ts`, transport identity, wireless store | Device/physical identity, USB/Wi-Fi isolation, leased ports, một Session cho mỗi thiết bị. Lượt này chỉ nghiệm thu một Samsung qua USB. |

Next config bật `cacheComponents`, `partialPrefetching`, `agentFeedback` và CSS loader `@tailwindcss/turbopack`. Đã đọc hướng dẫn CLI cục bộ của phiên bản Next đang cài trước kiểm tra build.

### 3.2 Model thực sự đang được dùng

- Cấu hình hiệu lực: **`qwen2.5:3b-instruct`**, provider **`ollama`**, backend **`appium`**.
- Có cài `qwen3:4b` nhưng không phải model được chọn. Không có bằng chứng đang chạy Qwen 7B.
- `cloud command text=false`; source-exact auto-review tắt. Không chuyển sang cloud hay thay model để làm đẹp kết quả.
- V2 dùng temperature 0, `num_predict=256`, `num_ctx=2048`; guard payload đang tính bằng **byte**, giới hạn 1536 byte trước request (`ollama.ts:29`). Byte và token không tương đương, đặc biệt với tiếng Việt.
- Action Plan interpreter có timeout cấu hình 180.000 ms; đường V2 structured reasoning có budget/queue riêng. Không nên dùng một con số timeout để mô tả mọi đường.
- Lúc đầu `/api/ps` không có model đang load: có yếu tố cold start trong số liệu.

### 3.3 Truy vết từ câu lệnh đến kết quả

**Đường Action Plan:** Dashboard → `/commands/interpret` → thử Wi-Fi/Chrome rules trước → nếu chưa khớp mới gọi queued Ollama để sinh JSON → schema/capability validation → `/executions` → policy → ConditionExecutor → quan sát/định vị → action → postcondition. Có thể kết thúc `SENT` nếu chỉ gửi được action mà chưa đủ bằng chứng; không đồng nhất với goal completion V2.

**V1:** source patterns/goal planner hoặc LLM GoalSpec → candidate/evaluator → bounded action loop → recovery có các loại được định nghĩa trước → criterion verifier. Các loại kết quả YouTube/Chrome/Settings còn chuyên biệt.

**V2:** source-bound typed intents hoặc `compileOutcomes` bằng rules → nếu còn unknown thì proposal/primitive decomposition có thể gọi model → interpretation review → Goal Graph → installed app resolution → Session → native world/affordances → backend tạo candidates → rules xếp hạng/lọc, có thể hỏi LLM chọn ID → grant một lần → fresh observation và re-ground → executor → registered independent verifier → cập nhật graph → settlement/đóng Session.

Điểm cần phân biệt:

- Model chủ yếu **chọn trong ID/slot do backend cung cấp**, không tự viết executor, selector, grant hay verifier.
- `chooseCompatible` tự chọn nếu chỉ có một candidate và tự abstain nếu không có candidate hợp rules. Các lượt này không gọi AI.
- Goal Graph có dependencies nhưng compiler mặc định nối tuần tự các outcome (`goal-compiler.ts:56`); không phải mọi dependency đều do AI suy luận.
- `coverage=COMPLETE` nói graph có capability phù hợp về cấu trúc, **không chứng minh diễn giải đúng nghĩa** và không phải trạng thái execution `COMPLETED`.
- Runtime còn có selector/resource ID riêng YouTube, logic Google/Chrome và workflow Wi-Fi. Không thể mô tả toàn bộ hệ thống là app-agnostic.

## 4. Trạng thái hệ thống và validation

### 4.1 Dịch vụ/API

| Kiểm tra | Kết quả thực tế |
| --- | --- |
| ADB | Samsung A50s `R58MA78W6QK` online qua USB; physical identity được xác minh. |
| Readiness ban đầu | Màn hình mở khóa; không cần vượt keyguard. |
| Appium | `/status` HTTP 200, ready; tạo/đọc/đóng Session thật thành công. |
| Ollama | API HTTP 200; model thật được gọi trong ba trường hợp lập kế hoạch hợp lệ. |
| Next.js | Dashboard HTTP 200; `/api/agent/runtime` HTTP 200 trước/sau kiểm thử. |
| Kết thúc | 0 active task, 0 owner mode, reasoning running=0/waiting=0. Ba Session nghiệm thu và Session recon đều được kiểm tra lại: HTTP 404 `invalid session id`. |

Không cài/gỡ APK, không bật Bluetooth, không thay cài đặt Android, không tạo/xóa dữ liệu, không chụp ảnh bằng Camera, không gọi/gửi hay mở kết quả nội dung. Ảnh screenshot chẩn đoán FM chỉ phục vụ kiểm tra UI.

### 4.2 Validation chạy mới

| Lệnh tương đương thực tế | Kết quả | Thời gian wall-clock |
| --- | --- | ---: |
| `node.exe --test tests/*.test.cjs` (mở rộng danh sách file trong runner) | **577 PASS / 0 FAIL / 0 skipped** | 58,46 s |
| `tsc --noEmit --incremental false` | **PASS** | 32,10 s |
| `eslint .` | **FAIL: 1 error, 9 warnings** | 46,50 s |
| `next build` | **FAIL: TurbopackInternalError khi xử lý CSS/tạo child process** | 16,99 s |
| `next build --webpack` | **PASS, có warning** | 116,79 s |
| `git diff --check` | **PASS**, chỉ có cảnh báo chuyển LF/CRLF ở file có sẵn | Không đo riêng |
| Secret scan source/build trước báo cáo | 428 file được quét, 0 match | Không đo riêng |
| Secret scan bằng chứng TEMP | 19 file text/JSON/log, 0 match | Không đo riêng |

Lỗi ESLint: `components/executions/ExecutionDetailModal.tsx:130:98`, `@typescript-eslint/no-explicit-any`; chín warning unused import ở các component. Không sửa lỗi hoặc test để đổi kết quả.

Build mặc định báo child Node thoát trước khi Turbopack kết nối trong pipeline CSS. Webpack cùng source build được nhưng cảnh báo `module.createRequire failed parsing argument` tại `appium/session-manager.ts`. **Chưa xác định nguyên nhân gốc của Turbopack**; không khẳng định do RAM, loader hay sandbox chỉ từ thông báo. Build được chạy ngoài sandbox hạn chế; không đổi Next config. Webpack PASS chưa phải nghiệm thu server production hoặc bản cài không có devDependencies.

Secret scan loại trừ `.env*`, dependencies, `.git`, sealed, file trên 10 MB và transcript công cụ; không phải bảo đảm toàn bộ máy không có secret. `git diff --check` không tự bao phủ file untracked; báo cáo mới được kiểm tra riêng về whitespace và secret.

## 5. Kiểm thử suy luận với câu lệnh mới

Đây là gọi **compiler/proposal thật và Ollama thật**, có catalog ứng dụng đọc từ thiết bị, nhưng không chạy grant/executor. Harness không bao phủ typed-intent prepass và toàn bộ discovery runtime. Vì vậy lỗi/khả năng ở bảng này chỉ được kết luận cho đường đã đo, không suy diễn rằng mọi đường API đều trả cùng kết quả.

| ID | Câu lệnh | Nguồn quyết định | Kết quả quan sát |
| --- | --- | --- | --- |
| P1 | Giúp tôi ghé Google Drive rồi tìm hồ sơ nghiên cứu sao biển | Qwen + source slots | `OPEN_APP: tôi ghé Google Drive`; query đúng nhưng app sai. Graph vẫn `COMPLETE`. **Sai nghĩa**. |
| P2 | Bring up Google Drive, then look for coastal geology syllabus. | Qwen + proposal | Launch Drive nhưng search thành `UNSUPPORTED`, `NEEDS_CLARIFICATION`. **Không đạt yêu cầu hợp lệ**. |
| P3 | Mở Cài đặt rồi đọc mức pin hiện tại và sau đó mở Đồng hồ | Rules, 0 AI call | Bước đọc thành `NAVIGATE: mức pin hiện tại và`. **Sai loại outcome và ranh giới câu**. |
| P4 | I need the compass application on screen, please. | Source-slot guard, 0 AI call | `SOURCE_SLOT_UNAVAILABLE_OR_OVER_BUDGET`. Chưa xác minh ứng dụng la bàn có sẵn; **không chấm thành công/thất bại theo availability**. |
| P5 | Mở com.sec.android.app.fm rồi xem mục Danh sách | Rules, 0 AI call | Phân rã LAUNCH → NAVIGATE đúng cấu trúc. UI thực tế không có target chính xác; xem A3. **Plan hợp lý không có nghĩa chạy được**. |
| P6 | Nếu đang ở màn hình kết quả thì quay lại trang chủ, rồi tìm tư liệu san hô. | Rules/guard, 0 AI call | Yêu cầu làm rõ vì clause/connector mơ hồ; không âm thầm bỏ điều kiện. **Chặn bảo thủ phù hợp phạm vi chưa hỗ trợ**. |
| P7 | Open Google Drive and search for aurora field notebook, but do not open any file. | Qwen + semantic validator | Output đúng schema nhưng bị từ chối vì thay đổi known outcome/value. **Validator bảo vệ được; yêu cầu chưa hoàn thành**. |
| P8 | Mở ứng dụng mà tôi vừa dùng rồi tìm lịch triều cường | Rules, 0 AI call | App thành chuỗi `mà tôi vừa dùng`, graph `COMPLETE`; lẽ ra cần reference/context được grounded hoặc hỏi lại. **Sai nghĩa**. |

Tổng: **8 input hợp lệ, 3 input gọi Qwen; 3/3 model response hợp schema, 0/3 đạt đầy đủ ngữ nghĩa mong đợi của phép thử**. Không gọi đây là tỷ lệ AI tổng quát hay tỷ lệ Android completion. Không có sample random/đủ lớn để ngoại suy.

Năm input tiếng Việt của lần gửi đầu bị transport PowerShell stdin mất dấu; giữ bằng chứng, đánh dấu INVALID và loại khỏi đánh giá. Đã gửi lại đúng các input đó bằng JS Unicode escapes, không sửa runtime/prompt. Có một model call trong nhóm INVALID không được tính vào ba call hợp lệ. P2/P4/P7 dùng kết quả hợp lệ của lần đầu, không chạy lại để chọn kết quả đẹp.

### 5.1 Độ trễ model

| Input/model | Tổng model call | Queue | Service | Load | Output tokens / eval |
| --- | ---: | ---: | ---: | ---: | ---: |
| P1 / qwen2.5:3b-instruct | 12.040 ms | 1 ms | 12.027 ms | 63 ms | 43 / 6.112 ms |
| P2 / qwen2.5:3b-instruct | 25.213 ms | 4 ms | 25.130 ms | 16.977 ms | 8 / 2.456 ms |
| P7 / qwen2.5:3b-instruct | 17.837 ms | 2 ms | 17.815 ms | 352 ms | 10 / 12.737 ms |

Median ba call: **17,84 s**; khoảng **12,04–25,21 s**. Queue gần như không phải nút thắt trong mẫu này. Load lạnh và service/inference chiếm phần lớn. Các span lồng nhau, không cộng queue/service/load/eval thành tổng mới.

Probe Action Plan bằng tiếng Anh `Open Chrome and search for tidal archive index`: HTTP 422 sau 23,49 s do model thiếu `CLICK address_bar` trước `INPUT_TEXT`; validator chặn đúng. Parser Chrome rules chủ yếu nhận mẫu tiếng Việt nên **không kết luận đây là bug của Chrome rules**.

Probe interpret-only `Open YouTube and translate the displayed page into French.` hết deadline client sau 90,26 s, chưa có JSON response. Không gửi execution. **Không có bằng chứng để kết luận hệ thống đã bỏ bước dịch rồi báo hoàn thành**. Rủi ro bỏ unsupported outcome được phân tích từ source ở mục 8, không biến timeout này thành proof false-completion.

## 6. Android thật và giới hạn UI mới

### 6.1 Ba execution nghiệm thu

| ID / execution | Mục tiêu | Kết quả và bằng chứng độc lập | Tổng / Session setup | Appium RPC / ADB | Model |
| --- | --- | --- | ---: | ---: | ---: |
| A1 / `876de811-29be-4277-894f-07da21ca9da6` | Mở Settings, đọc pin | **REAL_DEVICE_VERIFIED / COMPLETED**. Settings intent verified; hai đường native readback xác nhận pin `100`. | 15,82 / 7,30 s | 13 / 39 | 0 |
| A2 / `b89693d5-9479-435e-8197-b018de3c7f7b` | Mở `com.sec.android.app.fm` | **REAL_DEVICE_VERIFIED / COMPLETED**. Foreground + resumed activity `com.sec.android.app.fm/.MainActivity`. | 14,25 / 6,71 s | 12 / 28 | 0 |
| A3 / `4244c51a-12fe-4746-93a7-3218c1ab9206` | Mở FM rồi xem mục Danh sách | Launch VERIFIED, navigate **BLOCKED**: `No grounded candidate with a supported verification contract. Visual semantics may be unavailable.` | 34,97 / 15,01 s | 18 / 31 | 0 |

Số đếm trước tỷ lệ: **2/3 COMPLETED (66,7%), 1/3 BLOCKED (33,3%), 0/3 FAILED**. Mẫu chỉ ba tác vụ thuận tiện trên một máy, không phải tỷ lệ hiệu quả đại diện. Không trộn ba tác vụ này với planning-only hoặc lịch sử cũ.

Các execution chạy tuần tự bằng acceptance runner hiện có qua backend worker, owner mode đúng thiết bị và tắt trong `finally`. Approval chỉ chuyển khi interpretation khớp phạm vi mở/đọc đã định. **Không phải nghiệm thu thao tác click Dashboard qua browser**. Không thử mới Human Assistance chọn điểm ảnh, cancellation hoặc ghi dữ liệu trong lượt này.

Một input compound tiếng Anh trước A3 bị acceptance harness từ chối trước tạo task vì không khớp nhánh approval của harness. Không tính là Agent execution FAIL; không giấu việc sau đó dùng câu tiếng Việt làm smoke test khác. Không sửa harness để ép qua.

### 6.2 Recon FM và false-completion check

Đọc native hierarchy thật, xây world và kiểm tra screenshot thật bằng mắt:

- FM có 52 node, trạng thái OBSERVED/READY; **49/52 widget bị gán structural role `unknown`**.
- Có control `Tùy chọn khác`, `Nguồn`, `Yêu thích`, `Kênh`; một số không có resource ID. Screenshot cho thấy Radio đang tắt, `Kênh` được chọn, `Không có kênh`, tần số 87.5 MHz.
- Không thấy target chính xác `Danh sách`. Tab `Kênh` gần nghĩa nhưng **không đủ để tự khẳng định là đúng yêu cầu**, nên không click đoán.
- Tìm trong runtime Android không thấy package FM/profile riêng. A2 cho thấy launch generic theo exact package có thể áp dụng ngoài nhóm app chuyên biệt. Không chứng minh app chưa từng có trong lịch sử/training của model.
- Screenshot và native activity xác nhận FM thật đang mở; không bật Radio/quét kênh. A1 dựa vào registered battery readback, không có screenshot Settings riêng tại thời điểm đó.

Không phát hiện false `COMPLETED` ở hai execution được nghiệm thu theo contract. Đây chỉ là kết luận cục bộ, không chứng minh mọi verifier hoặc mọi completion trong lịch sử đều đúng.

## 7. Lịch sử lỗi và hiệu năng hệ thống

### 7.1 Cửa sổ lịch sử trước các tác vụ mới

37 task giữ lại: **16 COMPLETED, 18 BLOCKED, 2 FAILED, 1 CANCELLED**; 35 V2 và 2 V1. Không coi đây là bộ benchmark độc lập: có test policy chủ động chặn, nhiều phiên bản code và chỉ là cửa sổ history còn giữ.

| Lý do ghi trong history | Số task | Nhận định |
| --- | ---: | --- |
| Mọi outcome có registered evidence | 16 | Chưa kiểm lại từng completion cũ bằng screenshot. |
| Mọi registered strategy đã cạn, không có effect | 7 | Strategy catalog/handler chưa đủ, không phải LLM tự tìm mọi phương án. |
| Hard-block destructive/security | 4 | Có thể là chặn đúng, không phải lỗi cần bỏ policy. |
| Không có exact record/time schema và readback | 3 | Thiếu persistence/widget verification contract. |
| Tên ứng dụng thiếu hoặc mơ hồ | 2 | Catalog không có display labels đầy đủ. |
| Lệnh bật Bluetooth lỗi | 2 | **Lỗi lịch sử**, không thử bật Bluetooth lại. |
| Abort / từ chối review / destructive owner request | 1 + 1 + 1 | Không quy hết thành lỗi AI. |

### 7.2 Latency và tài nguyên

- A1/A2/A3: planning 2,51/1,73/1,10 s; observation 1,14/1,60/7,46 s; execution 4,41/4,13/8,00 s. Verification riêng 0/0/0,022 s **không có nghĩa không kiểm chứng**: intent native readback được tính trong execution.
- Session setup 6,71–15,01 s là tỷ trọng đáng kể ngay cả khi không có AI. RPC và ADB tổng cộng 43 và 98 lần cho ba task theo profiler; phạm vi counter không gồm mọi lệnh chẩn đoán bên ngoài runner.
- UI-source RPC khoảng 0,53–1,11 s/task; parse khoảng vài chục ms ở A1/A2. Không có bằng chứng parser XML là nguyên nhân chính của độ trễ ba task này.
- Scheduler shared: **concurrency=1, capacity=16**. Runtime có giới hạn bốn execution đồng thời nhưng chúng chia sẻ một hàng đợi suy luận. Không có thử tải nhiều điện thoại trong lượt này.
- Runtime JSON từng đo 492.368 byte; cuối lượt 530.511 byte. Hook poll mỗi 2 s khi có task, 5 s idle, 15 s khi tab ẩn; GET lại refresh kết nối và clone history. Nhiều tab/device có thể nhân chi phí này, chưa có load test để định lượng.
- Máy có 8.344.559.616 byte RAM (~7,77 GiB). Trong chuỗi validation, free RAM thấp nhất **40.816.640 byte (~38,9 MiB)**; cuối đo còn ~242 MiB. Đây là free memory của **toàn máy**, không phải heap của Next/Ollama; chưa đủ quy nguyên nhân build FAIL cho thiếu RAM.
- Không có lấy mẫu working-set liên tục của Ollama trong từng call, nên **peak RAM riêng model của lượt audit là UNVERIFIED**. Snapshot process sau đó và OS lifetime peak không được dùng thay cho benchmark peak.
- Chưa đo cloud-vs-local, GPU utilization, tokenization limit thực, multi-device throughput hoặc server production sau deploy. Không tự đổi model để tối ưu khi chưa có phép đo tương đương.

## 8. Danh sách vấn đề P0–P3

P0: chưa xác minh lỗi phá hủy dữ liệu hoặc xâm nhập thực tế. Các probe an toàn không dùng điện thoại thật để thử hành động nguy hiểm.

| ID / mức | Source liên quan | Bằng chứng, nguyên nhân và hướng xử lý tổng quát |
| --- | --- | --- |
| F01 **P1** | [executions/route.ts:68](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/app/api/executions/route.ts:68>), [interpret/route.ts:23](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/app/api/commands/interpret/route.ts:23>), [security-policy.ts:18](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/security-policy.ts:18>) | **Kiểm tra nguồn và quyền không đồng nhất.** Origin check ở executions chỉ trong nhánh Wi-Fi; interpret không check. Request foreign Origin/text/plain tới executions với serial không tồn tại trả **404 device not found**, không phải 403; runtime V2 tương đương trả **403**. Policy development hiện hiệu lực toàn nhánh cũ; probe hàm thật cho `Remove account`, `Replace existing file` được ALLOW cả ở observed-control check, trong khi `Xóa tất cả ảnh` bị BLOCK. Không có click/xóa hoặc exploit browser thật. Sửa chung bằng same-origin/Host/auth trên mọi endpoint có effect, device-scoped permission và phân loại destructive không thể bypass chỉ bằng từ khác; không dựa vào CORS hoặc V2 owner mode để bảo vệ route cũ. |
| F02 **P1** | [outcome-spec.ts:69](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/outcome-spec.ts:69>), [source-slots.ts:36](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/source-slots.ts:36>), [primitive-decomposition.ts:98](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/primitive-decomposition.ts:98>) | **Syntactic coverage chưa bảo đảm semantic coverage.** P1 app bị lẫn động từ; P3 READ thành NAVIGATE; P8 tham chiếu app bị coi là tên app; P2/P7 không hoàn thành diễn giải. Roots nằm cả ở source segmentation/rules/slot binding và model choice, không thể chỉ đổ cho Qwen. Cần giữ canonical app identity, role/value/negation/reference, đối chiếu coverage theo từng ý định trước grant. Các kết quả `COMPLETE` nêu trên chưa được gửi execution. |
| F03 **P1** | [package.json:32](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/package.json:32>), [agent-worker.cjs:2](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/scripts/agent-worker.cjs:2>) | **Worker cần devDependency ở runtime.** `typescript` là devDependency nhưng worker `require('typescript')` để transpile. Bản deploy prune devDependencies có thể không khởi động worker. Đây là lỗi đóng gói có điều kiện được xác định từ source, chưa thử gỡ dependency trên máy hiện tại. Nên build worker thành JS artifact hoặc khai báo/phân phối runtime dependency đúng, thêm smoke test production package. |
| F04 **P1** | [next.config.ts:10](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/next.config.ts:10>), `package.json` build script | **Build mặc định hiện FAIL.** Lệnh build thực tế lỗi Turbopack CSS child-process; Webpack PASS. Chưa xác định loader/framework/environment root cause. Cần minimal reproduction và nghiệm thu pipeline build mặc định; không gọi đây là lỗi TypeScript hoặc mặc nhiên đổi bundler là đã sửa nguyên nhân. |
| F05 **P2** | [worker-client.ts:6](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/worker-client.ts:6>), [worker-server.ts:106](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/worker-server.ts:106>) | **Worker có thể chạy code cũ sau khi source đổi.** Client kiểm PID/protocol/features nhưng không so `runtimeSha256`; worker giữ TS module cache. Current audit không quan sát mismatch, đây là rủi ro tái lập từ đường khởi động. Cần handshake version/hash và drain/restart khi idle; không ngắt Session đang có effect. |
| F06 **P2** | [open-world-plan.ts:45](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/open-world-plan.ts:45>), [compatible-choice.ts:62](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/compatible-choice.ts:62>), [ollama.ts:29](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/ollama.ts:29>) | **Context suy luận bị co hẹp và bị chặn bằng byte budget.** Caller chuẩn bị original goal, outstanding goals, world, verified history/budget nhưng compatible wrapper chỉ gửi request cùng candidate ID/action/role/effect/label. Nhiều context cần cho chọn đường tiếp bị bỏ. Guard 1536 byte không phải 1536 token. Cần bounded semantic context và đo token/latency; giữ validation và quyền lựa chọn trong backend. Đây là source finding, không có runtime context-limit failure mới để đếm trong audit. |
| F07 **P2** | [primitive-decomposition.ts:17](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/primitive-decomposition.ts:17>), [record-persistence.ts:20](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/record-persistence.ts:20>), [visual-grounding.ts:27](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/visual-grounding.ts:27>) | **Capability có tên nhưng chưa áp dụng tổng quát.** SET_VALUE/SELECT_ITEM/READ_VALUE/CONFIRM trong primitive catalog vẫn `implemented:false`; typed READ_STATE là đường khác đã có thật. Record strategies yêu cầu metadata/inventory/identity/time khá đặc thù (`record-id`, complete inventory, `record-created-at`), app thật thường không cung cấp. Vision provider chưa nối. FM 49/52 widget unknown và A3 BLOCKED là evidence thực cho giới hạn quan sát/contract, không phải bằng chứng cần bỏ verifier. Mở rộng generic roles + executor/policy/verifier đầy đủ; thiếu proof vẫn chặn. |
| F08 **P2** | [strategy-reflection.ts:11](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/strategy-reflection.ts:11>), [setting-mutations.ts:97](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/setting-mutations.ts:97>) | **Recovery registry chưa đồng nghĩa có recovery implementation.** Settings controller chỉ đăng ký handler INTENT; các strategy khác trả không có grounded executor/verifier. V1 cũng có tập recovery đóng. Bảy task cũ cạn strategy là triệu chứng phù hợp, không chứng minh cùng một root cause cho cả bảy. Chỉ thêm handler có fresh grounding/verification, không đổi strategy label để che failure. |
| F09 **P2** | [interpret/route.ts:65](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/app/api/commands/interpret/route.ts:65>), [interpret/route.ts:128](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/app/api/commands/interpret/route.ts:128>) | **Nhánh legacy thiếu cancellation propagation và outcome coverage.** Interpret chỉ dùng timeout, không kết hợp `request.signal`. Prompt còn yêu cầu bỏ phần ngoài danh mục, trong khi validator chủ yếu kiểm plan hợp capability, không kiểm toàn bộ goal gốc. Probe 90,26 s chỉ chứng minh client timeout, không chứng minh job vẫn chạy sau disconnect hoặc false completion. Cần nối abort và kiểm coverage/unsupported outcome trước execution. |
| F10 **P2** | [device-runtime.ts:49](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/device-runtime.ts:49>), [setting-mutations.ts:142](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/setting-mutations.ts:142>), [AgentGoalPanel.tsx:103](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/components/commands/AgentGoalPanel.tsx:103>) | **Revoke owner mode có thể cắt quyền undo.** UI cho tắt mode đang tồn tại; backend revoke rồi cancel. Settlement inverse vẫn `assertFullControl`, nên revoke/expiry giữa chừng có thể dẫn MANUAL_REQUIRED thay vì tự restore. Đây là conditional source risk, không thử mutation để tạo lỗi thật. Cần hai pha ngừng action mới rồi cleanup-only authorization gắn đúng journal/inverse; không tái cấp quyền rộng hoặc bỏ fresh checks. |
| F11 **P2** | [device-runtime.ts:81](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/device-runtime.ts:81>), [worker-server.ts:73](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/agent/worker-server.ts:73>), [useAgentRuntimes.ts:27](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/hooks/useAgentRuntimes.ts:27>) | **History chưa đủ bền và polling nặng.** Clone/full payload mỗi poll, refreshConnections kèm ADB; history rolling khoảng 36 task, 24 event/task, persisted bỏ events. Mất chi tiết cần phân tích lỗi cũ và tăng tải nhiều tab. Cần paginated/delta events, durable audit và bộ đo tách giai đoạn; không cache bỏ identity/fresh-state checks. |
| F12 **P3** | [ExecutionDetailModal.tsx:130](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/components/executions/ExecutionDetailModal.tsx:130>), [session-manager.ts:80](</C:/Users/Tran Duy Khanh/Downloads/smart_device_control_system/lib/android/appium/session-manager.ts:80>) | **Full lint chưa sạch và build warning chưa nghiệm thu deployment.** Một lỗi any, chín unused warnings; Webpack không phân tích được dynamic createRequire. Cần sửa type/import riêng và smoke test packaged server/worker/Appium dependency discovery. Không sửa trong audit này. |

## 9. Đánh giá tự chủ 0–5

Thang đánh giá kỹ thuật: 0 chưa có; 1 hẹp/phụ thuộc rules; 2 có tổng quát giới hạn trong contract/candidate; 3 đã chứng minh đa app/trạng thái với ít trợ giúp; 4 đáng tin trên app mới và recovery mới; 5 tổng quát mạnh đã được đánh giá rộng. Đây là nhận định theo evidence, không phải xác suất thành công.

| Năng lực | Điểm | Phần AI thực sự làm / phần lập trình trước và bằng chứng |
| --- | ---: | --- |
| Hiểu câu lệnh mới | **1/5** | Có Qwen proposal thật, nhưng P1/P2/P7 không đạt đủ nghĩa; P3/P8 sai ở rules/slot. |
| Phân rã mục tiêu nhiều bước | **1/5** | Có DAG và source-bound proposal, song tách clause/primitive whitelist và nối tuần tự chủ yếu do code. |
| Hiểu UI ứng dụng mới | **1/5** | Native hierarchy có thật; roles heuristic, chưa có vision provider; FM 49/52 unknown. |
| Chọn bước tiếp dựa trên state | **2/5** | Fresh grounding và backend candidates tốt; model chỉ chọn ID còn rules có thể loại/chọn hết trước model. A3 không tìm được target. |
| Tự tìm đường khác, recovery | **1/5** | Có bounded loop/registry, nhưng handler đóng và nhiều strategy chưa implement. Chưa có recovery novel được nghiệm thu trong lượt này. |
| Kết hợp capability thành tác vụ mới | **2/5** | Settings → đọc pin chạy thật, nhưng bằng typed intents/rules, 0 AI call. Arbitrary field/selection còn thiếu. |
| Xác minh kết quả cuối | **3/5** | Mạnh trong contract đã đăng ký: native foreground, battery readback, grants/freshness. Chưa có verifier phổ quát; record/UI mới có thể BLOCKED. |
| Tự học capability/workflow mới | **0/5** | Route/strategy hints là advisory memory; không tự sinh executor/policy/verifier mới có thể tin cậy. |

Điểm verifier cao hơn planner là chủ ý: backend an toàn và bằng chứng đáng tin **không đồng nghĩa model suy luận giỏi**. Không cộng/trung bình các điểm thành một “độ thông minh” chung.

## 10. Chức năng hoạt động, chưa hoạt động và chưa nghiệm thu

- **Đã chạy thật trong audit:** identity/Session isolation, mở Settings, đọc pin độc lập, launch app FM bằng package, hierarchy/world/screenshot, chặn khi thiếu target/contract, cleanup task/mode/Session.
- **Có source và regression offline, chưa nghiệm thu lại:** generic search nhiều app, YouTube ordinal selection/playback, Chrome DOM result filtering, Human Assistance resume, cancellation, exact-URI handoff, record strategies, structured time widgets, full-control setting journal/inverse restoration.
- **Chưa phải năng lực tổng quát hoàn chỉnh:** display-label app resolution, hiểu mọi field/collection/canvas, suy ra workflow không có contract, arbitrary record identity, arbitrary item selection, phục hồi bằng một phương thức mới do model tự nghĩ ra.
- **Chưa được đo:** iOS executor, nhiều Android đồng thời, Wi-Fi transport trong lượt audit này, cloud quality/latency, packaged production worker, peak RAM model theo call, browser interaction acceptance. HTTP 200/Dashboard source không thay thế nghiệm thu UI end-to-end.

Không đổi các trạng thái BLOCKED cũ thành SUCCESS. Không tự xóa dữ liệu thử nghiệm cũ hoặc mở rộng owner scope ra thiết bị khác.

## 11. Năm nâng cấp quan trọng tiếp theo

1. **Đồng nhất security và bản phát hành:** bảo vệ mọi effect endpoint, loại destructive bằng effect contract chứ không chỉ keyword, quyền theo device/execution; build worker artifact và kiểm tra version/hash. Ưu tiên F01/F03/F04 trước mở rộng quyền.
2. **Semantic fidelity trước tốc độ:** canonical app/value/reference/negation và outcome-coverage review; sửa lỗi segmentation/source binding tổng quát từ các root cause, rồi dùng một cohort mới độc lập để đánh giá. Không hardcode các câu trong báo cáo.
3. **Hoàn thiện generic capability contracts:** field/widget/collection semantics cùng policy, candidate, executor và independent verifier; record identity/readback thực tế, giữ SAFE_BLOCKED nếu app không cung cấp proof.
4. **Recovery thật và context có ích:** giữ goal/history/state cần thiết trong prompt bị giới hạn; chỉ đăng ký strategy khi có handler/verifier; cleanup-only inverse scope để revoke không làm mất khả năng khôi phục đã được cấp phép.
5. **Hiệu năng và vận hành dựa trên số đo:** tách cold-load/inference/queue/Session/native RPC, token budget đúng, warm model có kiểm soát, durable audit/delta polling và production smoke/load test. Không tăng tốc bằng bỏ freshness hoặc security checks.

Không triển khai các nâng cấp trên trong lượt kiểm toán này.

## 12. Chỉ mục bằng chứng cục bộ

Thư mục bằng chứng: `C:\Users\TRANDU~1\AppData\Local\Temp` (không commit; TEMP có thể bị hệ điều hành dọn).

| File | Nội dung |
| --- | --- |
| `phone-commander-audit-baseline-1792527071486.json` | Manifest 177 hash và cấu hình không chứa secret. |
| `phone-commander-audit-planning-1792527294847.json` | Input development, EN hợp lệ, các VN INVALID do transport được giữ nguyên để đối chiếu. |
| `phone-commander-audit-planning-vn-1792527517834.json` | Năm input VN đúng Unicode và model measurements. |
| `phone-commander-audit-history-1792527713709.json` | Cửa sổ 37 task trước nghiệm thu mới. |
| `phone-commander-audit-origin-1792527869954.json` | Probe foreign Origin an toàn, không có serial thiết bị thật trong request execution. |
| `phone-commander-audit-coverage-1792528417410.json` | Interpret-only timeout, không phải proof partial completion. |
| `phone-commander-audit-fm-1792528880738.json` và `.jpg` | Native world và screenshot FM đã kiểm tra bằng mắt. |
| `phone-commander-audit-policy-1792528974351.json` | Probe policy hàm thật, không device effect. |
| `phone-commander-audit-android-1792529024188.json` | Ba outcome Android, timing/counter, Session closed probes. |
| `v2-acceptance-<executionId>.json` với ba ID A1/A2/A3 | Báo cáo runner đầy đủ, không chỉ số tổng hợp. |
| `phone-commander-audit-validation-1792529117161.json` và năm log cùng prefix | Regression, TS, ESLint, Turbopack, Webpack; exit code thực. |
| `phone-commander-audit-final-1792529794277.json` | Hash không đổi, API cuối HTTP 200, 0 active/owner/queue. |
| `phone-commander-audit-secret-scan-1792529875273.json` | Quét thêm bằng chứng TEMP, 0 match. |

**Trả lời câu hỏi bắt buộc:** Nếu cài một app hoàn toàn mới và đưa câu lệnh chưa từng xuất hiện, Agent **có thể** mở exact package hoặc áp dụng capability có sẵn khi UI và verifier tương thích; **chưa thể tự bảo đảm hiểu, tìm đường thực hiện và xác minh một nghiệp vụ bất kỳ**. A2 chứng minh launch generic có giá trị; A3 chứng minh giới hạn UI/contract ngay trên app đó; P1–P8 cho thấy cả ngôn ngữ mới cũng có thể sai hoặc bị chặn trước action. Đây là nền tảng Android automation có AI hỗ trợ và kiểm chứng giới hạn, chưa phải AI tự chủ tổng quát.
