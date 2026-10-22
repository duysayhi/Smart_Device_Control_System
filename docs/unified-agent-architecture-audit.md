# Unified Agent Architecture Audit

Ngày 21/10/2026, Asia/Bangkok. Phone Commander, branch `DuyTD`.

## 0. Phạm Vi Và Quy Ước Bằng Chứng

[VERIFIED_BY_TEST_RUN] `git status --short --branch` được đọc trước source và báo cáo cũ: đang ở `DuyTD...origin/DuyTD`; HEAD `458f514e7b91d48a14e4db662e4930a3d752ee4c`. Working tree đã có nhiều file modified/untracked. Không reset, stage, commit hoặc push. Lượt này chỉ tạo báo cáo này; không sửa source/test/config/fixture, không mở/import sealed, không đọc hay sửa cohort `tests/holdout/*`.

[VERIFIED_IN_SOURCE] Phạm vi truy vết là call graph tĩnh của source hiện tại, gồm `app/page.tsx:16`, các route dưới `app/api`, hooks, worker và executor. Các nhãn trong tài liệu:

| Nhãn | Ý nghĩa |
| --- | --- |
| VERIFIED_IN_SOURCE | Đọc trực tiếp source và ghi file:line; không đồng nghĩa đã chạy Android thật. |
| VERIFIED_BY_TEST_RUN | Kết quả lệnh/test thực sự chạy trong lượt này; simulation không phải nghiệm thu Android. |
| INFERRED | Suy luận/rủi ro/thiết kế đề xuất từ source; chưa triển khai hoặc nghiệm thu. |
| UNVERIFIED | Chưa có đủ bằng chứng; gồm kết quả lịch sử chưa chạy lại và khoảng trống acceptance. |

[VERIFIED_IN_SOURCE] Đã đối chiếu `docs/agent-v2-m4d-report.md:15`, `docs/agent-v2-m5b-report.md:33`, `docs/agent-v2-m5c-report.md:33`, `docs/phone-commander-full-system-audit.md:1` và source audit cũ. Inventory `docs` không có tên báo cáo M6. Các kết luận kiến trúc dưới đây dựa vào source, không dùng báo cáo cũ thay chứng cứ.

[UNVERIFIED] Không khởi động task Android, không bật owner/full-control, không probe model/API thật hoặc mở Dashboard bằng browser trong lượt read-only này. Khả năng chạy production, chất lượng suy luận model thật, browser acceptance và mức độ tổng quát trên app mới không được chứng nhận lại.

## 1. Kết Luận Ngắn

[VERIFIED_IN_SOURCE] Có **ba đường điều phối cấp tác vụ**, không phải ba tên cho cùng một engine: Action Plan trong HTTP request; Goal V1 trong worker; Goal V2 trong worker. Cả ba tái sử dụng `createExecutionContext`, nhưng chỉ Action Plan có thể chọn ADB backend. V1/V2 bắt buộc Appium. Bằng chứng: `app/api/executions/route.ts:116`, `lib/android/agent/device-runtime.ts:207`, `lib/android/agent/device-runtime.ts:227`, `lib/android/condition-executor.ts:401`, `lib/android/agent/agent-loop.ts:329`, `lib/android/agent/agent-v2.ts:106`.

[VERIFIED_IN_SOURCE] UI hiện mặc định tab Goal Agent (`components/commands/AICommandPanel.tsx:70`) nhưng **engine mặc định là V1** (`components/commands/AgentGoalPanel.tsx:59`). V2 là opt-in; owner/full-control chỉ đi cùng job V2. Không có silent V2-to-V1 fallback trong nhánh dispatch hiện tại: V2 chạy rồi `return` tại `lib/android/agent/device-runtime.ts:210`.

[INFERRED] Có thể thống nhất **một input, một Execute, một lifecycle entry point** mà chưa viết lại engine. Không nên gọi việc này là đã thống nhất planner/capability/verifier. Chuyển hết sang V2 ngay sẽ mất một số hành vi legacy; tắt policy để bù cho chênh lệch là sai hướng.

## 2. Entry Points Và Request Contracts

### 2.1 Dashboard Và Public API

| Nhãn / entry | Request/schema và nguồn quyết định | Loop đích và giới hạn |
| --- | --- | --- |
| VERIFIED_IN_SOURCE: Dashboard composition | `app/page.tsx:47` dùng `useDashboardDemo`; `app/page.tsx:48` dùng `useAgentRuntimes`; truyền cả hai vào panel ở `app/page.tsx:90`. | Hai state stores song song, không phải một execution store chung. |
| VERIFIED_IN_SOURCE: Action Plan Analyze | `CommandInput.tsx:151` gọi callback; `hooks/useDashboardDemo.ts:142` POST interpret với `{prompt, deviceId?}`. Strict request ở `app/api/commands/interpret/route.ts:15`. | Chưa execute. Wi-Fi rules tại route:51; Chrome rules tại :57; còn lại Ollama structured Action Plan tại :69. |
| VERIFIED_IN_SOURCE: interpret output | `lib/validators/action-plan.schema.ts:69`: `{intent,isSensitive,actions[1..20]}`; actions là OPEN_APP/CLOSE_APP/CLICK/INPUT_TEXT/PRESS_KEY/SWIPE/WAIT_FOR/SCREENSHOT, mỗi action có trường riêng. WAIT_FOR tối đa 30.000 ms; schema ở :4. Schema plan/action dùng `z.object`, không `.strict()` như request ngoài. | `validateAndroidPlan` ở interpret:237 kiểm backend capabilities. Có device hợp lệ mới issue token tại interpret:42; không device chỉ preview, không có quyền execute. SCREENSHOT có trong schema nhưng bị capability validator/executor từ chối, không phải camera shutter. |
| VERIFIED_IN_SOURCE: Action Plan Execute/Stop | `CommandInput.tsx:177` -> `useDashboardDemo.ts:186`; POST `/api/executions` ở :219. Strict `{deviceId, actionPlan, originalRequest, authorizationToken:uuid, confirmationToken?:uuid}` tại `app/api/executions/route.ts:16`. Stop dùng AbortController ở `useDashboardDemo.ts:330`. | Route kiểm source, identity, token và policy ở executions:36/:55/:86; loop tuần tự :116 -> `execution.execute`. Không qua DeviceRuntimeRegistry. HTTP/request abort gắn vào execution signal tại :83. |
| VERIFIED_IN_SOURCE: Goal Agent single/batch | `AgentGoalPanel.tsx:76` START, UUID requestId, jobs `{deviceId,goal,agentVersion?:2,ownerAuthorizedTest?:true}`. Bỏ agentVersion nghĩa là V1, không phải auto-detect V2. Nút single/batch ở :111/:113; hook POST tại `hooks/useAgentRuntimes.ts:36`. | `/api/agent/runtime` -> worker registry -> V1 hoặc V2. `runtime-schema.ts:6` giới hạn 1..4 jobs; owner flag chỉ hợp lệ với V2. |
| VERIFIED_IN_SOURCE: runtime route | `app/api/agent/runtime/route.ts:18` dùng `RuntimeCommand` và `isLocalMutation`. GET tại :4 chỉ poll/evidence; có thể làm worker được spawn nhưng không START task. | START, SET_OWNER_TEST_MODE, CANCEL, CANCEL_BATCH, ASSIST, ASSIST_V2 đều schema strict ở `runtime-schema.ts:5`. Policy nằm backend, không tin checkbox/client flag tự cấp quyền. |
| VERIFIED_IN_SOURCE: compatibility `/api/agent` | `app/api/agent/route.ts:10`: strict `{deviceId,goal}`; route:13 tạo START không agentVersion/owner flag. | **Chỉ V1**, NDJSON viewer. Viewer disconnect không cancel execution (`route.ts:36`); khác `/api/executions`. Dashboard hiện không fetch route này (`hooks/useAgentRuntimes.ts:36`). |
| VERIFIED_IN_SOURCE: V1 assistance compatibility | `app/api/agent/assistance/route.ts:7`: CONFIRM(token,evidenceId,x,y,confirmed:true), CANCEL(token), STOP(token), strict. Local pending handler trước, nếu không có thì tìm đúng worker task và forward ở :21. | Không tạo task mới. ASSIST resume V1 cùng Session; STOP/CANCEL dừng task. Không nhận ASSIST_V2 hoặc grant JSON. |
| VERIFIED_IN_SOURCE: V2 assistance | `AgentGoalPanel.tsx:170` hiển thị backend choices; :175 gửi `{type:ASSIST_V2,executionId,deviceId,token,approved,choice}`; từ chối ở :176. Schema `runtime-schema.ts:10`. | Registry `device-runtime.ts:166` kiểm task đang WAITING_HUMAN; `human-assistance-v2.ts:23` kiểm ID, token, expiry, choice. Không chạy lại START. |
| VERIFIED_IN_SOURCE: owner/full-control switches | `AgentGoalPanel.tsx:103` bật scope đúng device/physicalId; :107 bật fullControl/rollbackOnFailure. Strict SET_OWNER_TEST_MODE ở `runtime-schema.ts:7`. | Backend `device-runtime.ts:48` kiểm device idle/identity; chỉ bind vào V2 job có ownerAuthorizedTest. Không mở rộng quyền Action Plan/V1. |

[VERIFIED_IN_SOURCE] Các effect/interpretation routes chính ở bảng trên kiểm loopback same-origin + JSON qua `lib/android/agent/request-origin.ts:12`; interpret:27, executions:25, agent:9, runtime:19, assistance:13. Worker loopback có bearer token riêng, từ chối browser Origin tại `lib/android/agent/worker-server.ts:53`. Đây không phải hệ thống multi-user authentication/deployment từ xa.

### 2.2 Worker Và Entry Phụ

| Nhãn / entry | Contract/ownership | Đích |
| --- | --- | --- |
| VERIFIED_IN_SOURCE: worker `/tasks` POST | `worker-server.ts:93` parse RuntimeCommand lại; START pause/drain catalog warmup tại :108. Registry idempotency/batch/physical-device exclusion tại `device-runtime.ts:107`. | `DeviceRuntimeRegistry.execute` ở :183. V1 gọi plan/open/runAgent; V2 gọi runAgentV2 với ownerScope. |
| VERIFIED_IN_SOURCE: worker `/reasoning` POST | Closed model/schema/options/messages ở `worker-server.ts:70`; shared scheduler tại :77. `queuedOllamaFetch` ở `worker-client.ts:52` forward sang đây. | Chỉ inference cho Action Plan interpreter, **không phải executor loop**. |
| VERIFIED_IN_SOURCE: worker `/health`, `/evidence`, `/shutdown` | `worker-server.ts:55`, :56, :64. Health/evidence không START; shutdown yêu cầu không còn active hoặc explicit cancelActive. | Evidence đúng waiting task; shutdown registry cleanup, không resume task cũ. |
| VERIFIED_IN_SOURCE: ConnectionManager | `components/devices/ConnectionManager.tsx:38` POST `/api/devices/wireless`; route schema ở :17; `lib/android/wireless-manager.ts:10` CONNECT/USB_TO_WIFI/RECONNECT/DISCONNECT. | Quản lý ADB transport, không Goal engine. Có network/local-subnet, busy/physical identity checks; không tự resume execution (:125). Phải giữ là control-plane riêng. |
| VERIFIED_IN_SOURCE: device previews/screenshots | `hooks/useDevicePreviews.ts`, `app/api/devices/[serial]/screenshot/route.ts`, được dùng tại `app/page.tsx:58`. | Quan sát preview, không phải quyền click/goal execution. Không được biến screenshot API thành endpoint camera chụp ảnh. |
| VERIFIED_IN_SOURCE: device quick actions | `app/page.tsx:83` -> callback `useDashboardDemo.ts:334`. | Chỉ thêm log “mô phỏng”; không dispatch Android. Không tính là engine thứ tư. |
| VERIFIED_IN_SOURCE: old TaskQueue | `components/executions/TaskQueue.tsx:25` nhận callbacks tùy chọn; Dashboard hiện render `AgentTaskHistory` tại `app/page.tsx:120`, không TaskQueue. `handleRerunTask` chỉ điền command ở `useDashboardDemo.ts:347`. | Không phải START path đang mounted. Không nhầm nút demo/rerun với task được thực thi. |

[VERIFIED_IN_SOURCE] CLI `scripts/agent-worker.cjs` khởi tạo worker chứ không tự nhận mục tiêu người dùng; các `scripts/agent-v2-*-acceptance/evaluation/benchmark` là công cụ kiểm thử gọi runtime hoặc exported runAgentV2, không entry point Dashboard. Không chạy các runner đó trong audit này.

## 3. Có Bao Nhiêu Loop? Cái Nào Reachable?

| Nhãn / tầng | Loop thực tế | Reachability và chủ thể điều khiển |
| --- | --- | --- |
| VERIFIED_IN_SOURCE: cấp task 1 | `app/api/executions/route.ts:116`, for từng action | Action Plan Dashboard; next = index+1, fail thì break. Không replan goal. |
| VERIFIED_IN_SOURCE: cấp task 2 | `agent/agent-loop.ts:145`, while chưa terminal | Goal V1 Dashboard và `/api/agent`; recovery/decision chọn operation kế. |
| VERIFIED_IN_SOURCE: cấp task 3 | `agent/agent-v2.ts:274` readyNode, lồng while nodeDone ở :294 | Goal V2 Dashboard; có nhánh intents/search/records và generic candidates. Không phải V1 wrapper. |
| VERIFIED_IN_SOURCE: primitive executor | `condition-executor.ts:121` switch action + waitUntil/discover; `state-observer.ts:69` polling; `exploration/ui-explorer.ts:75` bounded discovery loop | Shared substrate. ConditionExecutor không tự chọn goal, nhưng Explorer tự chọn nhịp scroll/target discovery trong action. AP/V1 dùng đầy đủ; V2 dùng observe/launch và wrappers interactV2/intentV2 ở condition-executor:115. |
| VERIFIED_IN_SOURCE: V2 search subloop | `agent/search-executor.ts:28`, tối đa 10 selection rounds, rồi verify loop :89 | Reachable từ agent-v2:322. Một node SEARCH, không một engine thứ tư. |
| VERIFIED_IN_SOURCE: V2 persistence subloop | `agent/persisted-record.ts:22` act + fields loop :57, Save/Reopen :59/:68 | Reachable từ agent-v2:359; record-specific state machine tổng quát, không arbitrary AI actions. |
| VERIFIED_IN_SOURCE: intent subloop | `agent/intent-executor.ts:93`; :129 poll native+activity sau single dispatch | Reachable V2 qua condition-executor:119; không có planner riêng trong executor này. |
| VERIFIED_IN_SOURCE: setting transaction | `agent/setting-mutations.ts:93` apply, :122 post-read loop, :142 settle ngược journal | V2 typed SET_DEVICE_STATE + fullControl; nested `reflectStrategies` không phải autonomous planner thứ tư. |
| VERIFIED_IN_SOURCE: ADB backend | `executor.ts:31` XML wait loop, :73 execute; `condition-executor.ts:454` chọn khi backend=adb | Action Plan reachable bằng config. Không gọi là dead code vì Appium path còn tái dùng ADB key dispatch tại condition-executor:349. V1/V2 từ chối backend=adb. |

[VERIFIED_IN_SOURCE] **Đếm nhất quán: 3 top-level task orchestration loops; nhiều bounded executor/subtask polling loops.** Không cộng mỗi `while/for` thành một Agent. Shared context/session nằm tại `condition-executor.ts:401`; physical/serial locks tại `appium/session-manager.ts:18`/:31, context lock tại `appium/session-operation-lock.ts`.

[VERIFIED_IN_SOURCE] Tìm callers trong app/components/hooks/lib/scripts/tests cho thấy `adb.ts:128` (`executeAndroidAction`) và :138 (`preflightAndroidPlan`) chỉ còn definitions, không production caller trong phạm vi này. `human-assistance.ts:15` registerAgentCancellation được tests dùng nhưng không production registration; compatibility STOP chủ yếu chuyển sang registry cancellation. `visual-review.ts` được test/integration harness dùng, không mounted Dashboard. Đây là **unused production exports/alternate harness surface**, chưa đủ cơ sở xóa.

[INFERRED] Registry reservation và context lock là hai tầng bổ sung, không nên gộp bằng cách xóa một lock: planning reservation giữ device trong thời gian AI/catalog; context lock bảo vệ native/web RPC và từng Session. Khi đưa AP vào worker phải tránh acquire reservation hai lần và phải giữ cross-transport exclusion.

## 4. Ai Quyết Định Bước Tiếp?

| Nhãn / đường | Quyền quyết định thực tế | Phần model được làm |
| --- | --- | --- |
| VERIFIED_IN_SOURCE: AP | interpret Wi-Fi/Chrome rules trước model (`interpret/route.ts:51`/:57); HTTP route sau đó cố định action order (:116). Executor/Explorer chọn cách locate/scroll và kiểm postcondition. | Sinh ActionPlan JSON cho request không khớp rules; không có AI chọn lại next sau mỗi action. |
| VERIFIED_IN_SOURCE: V1 plan | `goal-planner.ts:84`: clearGoal/genericSpec trước, reasoner fallback :95; `buildGoal` :40 tự tạo subgoals/criteria và source coverage. | Sinh GoalSpec trong closed schema khi rules miss; không được tự tạo executor/verifier. |
| VERIFIED_IN_SOURCE: V1 next | `agent-loop.ts:166` RecoveryManager trước; :174 dùng recoveryDecision nếu có. `decision-engine.ts:104` ruleDecision trước; :110 sinh candidates; :115 gọi model nếu cần. | Chọn backend-issued candidate ID hoặc abstain/observe; loop tự kiểm completion và fresh revalidation, :176/:190. |
| VERIFIED_IN_SOURCE: V2 plan | `agent-v2.ts:116` compileOutcomes; :187 typed intent proposals; :204 reviewed phrasing; :213 primitive/outcome decomposition fallback. `goal-compiler.ts:56` nối dependencies tuần tự; `primitive-decomposition.ts:99` singleton tự chọn không gọi model. | Chọn primitive/source slot/semantic proposal trong schema; approval và bindings do backend kiểm. Nhãn MODEL_REVIEWED không chứng minh đã gọi model. |
| VERIFIED_IN_SOURCE: V2 next | `goal-graph.ts:66` deterministic readyNode; agent-v2:321/:338/:357 chọn subexecutor bằng capability; :399 tự chọn singleton; :409 mới gọi chooseGroundedNext. Search cũng tự chọn singleton (`search-executor.ts:51`). | chooseGroundedNext qua compatibleReasoner, không trực tiếp model toàn quyền. |
| VERIFIED_IN_SOURCE: compatibility filtering | `compatible-choice.ts:14` rules rankCompatible; :58 zero -> ABSTAIN, :59 singleton -> local; :63 model chỉ còn reduced candidates, :69 recheck rồi có thể đổi answer thành ABSTAIN. | Chỉ giải quyết nhiều lựa chọn compatible; không được nới capability hoặc tự cho quyền. |
| VERIFIED_IN_SOURCE: provider routing | `reasoning-provider.ts:65` local default, opt-in Groq/local fallback; `ollama.ts:14` định nghĩa structured reasoner. | Provider fallback không phải engine V2->V1 fallback. Grants/journal/verifier không do provider cấp. |

[VERIFIED_IN_SOURCE] `open-world-plan.ts:44` chuẩn bị original goal, outstanding nodes, world, verified history và budget; nhưng wrapper `compatible-choice.ts:63` chỉ gửi request, commandRef và reduced candidate fields tới model. Các trường world/history không đi qua wrapper này. **Hai tầng cùng quyết định next**: caller singleton/chooseGroundedNext và rankCompatible; V1 có RecoveryManager và ruleDecision cùng có khả năng dismiss/loading/restore routes (`recovery.ts:122`, `decision-engine.ts:33`).

[INFERRED] Nên tách proposal, eligibility và dispatch thành các trách nhiệm rõ ràng, nhưng không bỏ revalidation vì trông “trùng”. Chỉ một module quyết định proposal cuối cho một selection epoch; policy vẫn được kiểm nhiều lần tại trust boundaries. Deterministic shortcut cần ghi provenance RULE/MODEL/HUMAN thay vì gán mọi thành công cho AI.

[VERIFIED_IN_SOURCE] Model code fallback là `phone-commander` nếu OLLAMA_MODEL không có (`ollama.ts:20`, interpret:78). Đọc whitelist `.env.local` thấy `OLLAMA_MODEL=qwen2.5:3b-instruct`, `ANDROID_POLICY_MODE=development`; không thấy ANDROID_EXECUTOR_BACKEND/AGENT_V2_READONLY_REVIEW_MODE trong file. Provider thực tế chọn theo `AGENT_STRUCTURED_PROVIDER` (`reasoning-provider.ts:66`), không theo tên model. Không in secret.

[UNVERIFIED] Không xác minh environment của process đang phục vụ, model đang load hay tốc độ inference trong lượt này; `.env.local` không chứng minh worker đã reload cấu hình đó.

## 5. Trách Nhiệm Trùng Và Trách Nhiệm Đã Dùng Chung

| Nhãn / trách nhiệm | Source thực tế | Đánh giá hợp nhất |
| --- | --- | --- |
| VERIFIED_IN_SOURCE: observer acquisition | ConditionExecutor tạo một StateObserver (`condition-executor.ts:75`); StateObserver sở hữu HybridContextObserver (`state-observer.ts:95`), V1/V2 đọc qua context. ADB fallback có XML reader riêng (`executor.ts:19`). | AP/V1/V2 Appium không có ba independent observer implementations. Native + DOM là các evidence channels bổ sung. |
| VERIFIED_IN_SOURCE: UI interpretation | `screen-state.ts`, `agent/navigation-semantics.ts`, `agent/ui-world-model.ts:15`, `agent/ui-affordances.ts`, `ui-understanding.ts:52`, `targets.ts`. | Legacy screen/target taxonomy và V2 structural roles chồng lấn navigation/search/checkable. UI world không tự thay thế legacy YouTube/Chrome semantics. |
| VERIFIED_IN_SOURCE: verification layers | `action-verifier.ts:17` legacy selection/destination; `condition-executor.ts:270` action postconditions; V1 `evaluator.ts:16` goal criteria và `candidate-verifier.ts:12` transition; V2 `verification-registry.ts:67` predicates. | Có duplicate concepts foreground/query/state change; goal verification và action transition là hai nghĩa khác nhau, không được xóa một cách máy móc. |
| VERIFIED_IN_SOURCE: composite verification | `composite-verification.ts:9` gọi verifyPredicate cho từng predicate, trả missing; kiểm insufficient completion ở :14. | Đây là **combinator của verification-registry**, không provider cạnh tranh. Không xóa như duplicate verifier. |
| VERIFIED_IN_SOURCE: special proofs | `verification-registry.ts:19` search, :37 record, :52 media; `intent-executor.ts:47` activity/number/URL, :66 corroborate state; `setting-mutations.ts:28` setting pair. | Native setting reads chia sẻ một phần helper nhưng IntentEvidence và VerifiedEvidence là hai proof families. Cần adapter typed receipt, không cast JSON qua WeakSet/WeakMap. |
| VERIFIED_IN_SOURCE: recovery | V1 `recovery.ts:38` và ruleDecision; legacy `UIExplorer.find` tự scroll/poll; V2 `bounded-exploration.ts:8`, `navigation-graph.ts:6`, `search-executor.ts:64`, `strategy-reflection.ts:7`. | Nhiều stop/replay/loop budgets. Strategy registry hiện chỉ có INTENT handler trong setting-mutations:97; tên UI_NAVIGATION/SETTINGS_SEARCH/DISCOVERY không phải implementation. |
| VERIFIED_IN_SOURCE: grants/approval | AP `action-plan-authorization.ts:10`, `wifi-confirmation.ts:8`; V1 `policyForAgentAction` và human-assistance; V2 `intent-capabilities.ts:75`, `effect-grants.ts:30`, owner/full-control policies. | Khác scope/TTL/trust root. Không đổi tất cả thành một boolean approved. |
| VERIFIED_IN_SOURCE: discovery/cache | V1 `application-discovery.ts`; V2 `app-catalog.ts` + launcher label cache; both revalidate real launchability. Worker warmup ở `worker-server.ts:44`. | Có thể dùng chung metadata service, nhưng metadata cache không có giá trị thay thế fresh installed identity hoặc authorization. |
| VERIFIED_IN_SOURCE: progress/history/cancel | AP NDJSON + hook local state; V1/V2 registry DeviceTask + polling (`useAgentRuntimes.ts:24`), persisted restart behavior (`device-runtime.ts:67`). | Cần envelope chung và giữ raw statuses/proofs. Browser disconnect semantics khác nhau có chủ ý. |

[INFERRED] Ưu tiên hợp nhất type/envelope và ownership trước; hoãn merge observer/verifier internals. Một common observer interface đã gần có sẵn; viết observer mới lúc này chỉ nhân thêm code.

## 6. Permission Logic Và Matrix Hiện Tại

### 6.1 Các Helper Và Ranh Giới Quyền

| Nhãn / helper | Hành vi source |
| --- | --- |
| VERIFIED_IN_SOURCE: hard envelope | `safety-envelope.ts:5` forbiddenSource, :6 forbiddenControl, :10 forbiddenDispatchControl, :11 assertSafeSource/:14 assertSafeAction/:17 assertSafePlan. Registry guard ở `device-runtime.ts:200` chạy trước reservation/planning. |
| VERIFIED_IN_SOURCE: legacy classification | `security-policy.ts:34` assessPlanPolicy; :77 assertPlanPolicy; :82 assertActionNotSensitive; :85 assertObservedControlSafe; :103/:124 read/route policy. `policy-mode.ts:1` chỉ development ngoài production mới nới non-strict helpers. |
| VERIFIED_IN_SOURCE: AP ticket | `action-plan-authorization.ts:10` issue; :19 consume ràng buộc exact source/plan/device/physicalId, TTL 120s, dùng một lần; :25 assertLegacyExecutionPolicy **luôn strict=true**. Token không phải miễn policy. |
| VERIFIED_IN_SOURCE: Wi-Fi exception | `executions/route.ts:74` chỉ bounded Wi-Fi plans; bình thường ASK single-use device+plan confirmation, development bỏ ASK ở :76/:80. `wifi-confirmation.ts:8` issue/:16 consume; hook hiển thị window.confirm ở :233. Không áp dụng cho general CONFIRM. |
| VERIFIED_IN_SOURCE: V1 scope | `agent-loop.ts:42` policyForAgentAction; exact goal/app/query/action scope + candidate revalidation, observed control checks. `goal-planner.ts:49`/:68 loại unsupported effects/unsafe goals. Không đọc owner scope. |
| VERIFIED_IN_SOURCE: V1 human point | `human-assistance.ts:26` waitForHuman, :45 submitHumanChoice; visual pixel/hierarchy/geometry kiểm lại khi confirm (`condition-executor.ts:89`, `visual-grounding.ts:42`). Screenshot point confirmation không cấp sensitive-effect permission. |
| VERIFIED_IN_SOURCE: V2 effect confirmation | `agent-v2.ts:141` help auto chỉ cho EFFECT_CONFIRMATION, single choice và ownerEffectAllowed; GOAL_INTERPRETATION/APP_SELECTION/TARGET_SELECTION/DEVICE_UNLOCK/PERMISSION/USER_ACTION vẫn ask. :420 toggle, :421 capture; `persisted-record.ts:46` records. |
| VERIFIED_IN_SOURCE: owner scope | `owner-test-policy.ts:48` enable TTL30m, :60 bind execution process-issued, :26 check revocation/identity; :16 non-destructive candidate guard. `device-runtime.ts:128` không chấp nhận owner flag nếu chưa bật đúng physical V2 device. |
| VERIFIED_IN_SOURCE: helper full-control trả false | **`owner-test-policy.ts:31`: `if (scope.fullControl) return false` trong ownerEffectAllowed.** Full-control không kế thừa legacy auto-approval local writes. |
| VERIFIED_IN_SOURCE: full-control contract | `full-control-policy.ts:10` assertFullControl, hard deny ở :5. `effect-grants.ts:36` chặn LOCAL_WRITE UI grants trong fullControl; :38 ordinary owner phải có ownerEffectAllowed. `intent-executor.ts:114` typed setting chỉ fullControl; controller cấp grant+journal+inverse ở `setting-mutations.ts:111`/:142. |
| VERIFIED_IN_SOURCE: V2 interpretation auto-review | `primitive-decomposition.ts:125` canAutoReviewReadOnly: opt-in + issued exact known-app/quoted slots + OPEN_APP/NAVIGATE_TO/SEARCH only. Caller `agent-v2.ts:222` dùng env `AGENT_V2_READONLY_REVIEW_MODE=source-exact`; không áp dụng mọi interpretation branch. |
| VERIFIED_IN_SOURCE: typed intent approval | `intent-capabilities.ts:75` issue process-owned source approval; :79 kiểm exact binding/TTL180s và persist contract. `agent-v2.ts:190` asks typed interpretation trước issue; :279 có thể issue OPEN_APP binding đã nằm trong graph mà không hỏi typed interpretation lần nữa. Không xem helper tự nó là human confirmation. |
| VERIFIED_IN_SOURCE: V2 technical grants | `effect-grants.ts:30` issue/:65 consume/:70 revoke; native executor kiểm lại fresh/identity/TTL (`grounded-interactions.ts:29`). Intent replay ledger tại `intent-executor.ts:107`. Setting grants/journal là family riêng. |
| VERIFIED_IN_SOURCE: search/artifact subgrants | `generic-search.ts:121` searchCandidateAllowed, :30 confirmSearchActivation, :167 beforeSearchDispatch và :240 searchCommitState ràng buộc exact phase/query, không phải user auto-approval. `artifact-store.ts:35` issueView/:6 consumeMediaViewGrant, :30 read kiểm consumer/execution/physical identity; không cấp quyền tìm ảnh khác. |
| VERIFIED_IN_SOURCE: navigation/transport eligibility | `navigation-semantics.ts:127` goalPackageAllowed/:168 safeNavigationOwner; `native-navigation.ts:21` nativeContextSafe; `wireless-store.ts:29` wirelessIdentityAllowed và `wireless-endpoint.ts:7` addressAllowed. Đây là technical eligibility guards, không được bypass bằng owner mode. |
| VERIFIED_IN_SOURCE: cloud command opt-in | `cloud-command.ts:2` issueCloudCommand chỉ tạo process-owned source reference; :7 cloudCommandText chỉ trả text nếu env opt-in và không sensitive/editable/secret. Đây là consent/data-projection gate cho provider, không cấp quyền effect hoặc full-control. |
| VERIFIED_IN_SOURCE: external effects | `full-control-policy.ts:15` designatedRecipient helper có tồn tại nhưng không làm call/send thành executable. `intent-capabilities.ts:16` COMPOSE_SMS implemented=false; `intent-executor.ts:21` block trước dispatch. |

### 6.2 Path x Mode -> ALLOW / ASK / DENY

[VERIFIED_IN_SOURCE] Matrix là **permission gate khi đã đủ grounding/identity/capability**, không bảo đảm task hoàn thành. Normal = không ownerScope; Owner = ordinary scope; Full = ownerScope.fullControl. Engine AP/V1 không nhận các mode V2, nên cột Owner/Full không tăng quyền của chúng. Các cell đa trạng thái ghi rõ điều kiện; mọi mode đều DENY destructive/foreign/stale/replayed/unimplemented effects qua guards nêu trên.

| Path / operation | Normal | Owner | Full-control | Nhãn / source |
| --- | --- | --- | --- | --- |
| AP proven navigation/read | ALLOW | ALLOW, mode ignored | ALLOW, mode ignored | VERIFIED_IN_SOURCE: executions:87; action-plan-authorization:25 |
| AP generic UNKNOWN / CONFIRM / sensitive data change, không Wi-Fi exception | DENY, không có generic confirmation UI | DENY | DENY | VERIFIED_IN_SOURCE: assertLegacyExecutionPolicy dùng strict và đòi ALLOW; classification CONFIRM không đồng nghĩa user có thể approve |
| AP bounded Wi-Fi on/off/SSID | ASK -> ALLOW; development -> ALLOW không ASK | Tương tự normal | Tương tự normal, không journal full-control | VERIFIED_IN_SOURCE: executions:74, hook:225; accounting flags tại :89 |
| V1 safe supported goal/next action | ALLOW; ambiguity thường BLOCKED với non-resumable assistance | Như normal | Như normal | VERIFIED_IN_SOURCE: agent-loop:138/:212; owner chỉ V2 runtime-schema:6 |
| V1 coherent ordinal human activation point | ASK -> revalidate -> ALLOW | Như normal | Như normal | VERIFIED_IN_SOURCE: agent-loop:270; condition-executor:89 |
| V1 create/capture/toggle/state mutation goal | DENY unsupported goal scope | DENY | DENY | VERIFIED_IN_SOURCE: goal-planner:49/:51; không nâng quyền bằng owner checkbox |
| V2 direct complete rules/read navigation/search | ALLOW nếu không phát sinh review; ambiguous -> ASK | Tương tự | Tương tự | VERIFIED_IN_SOURCE: agent-v2:116/:204/:321/:416 |
| V2 reviewed phrasing/typed intent interpretation | ASK; chỉ nhánh source-exact opt-in đủ điều kiện mới auto | ASK như normal | ASK như normal | VERIFIED_IN_SOURCE: agent-v2:190/:210/:222/:236; owner không bỏ interpretation review |
| V2 generic UI toggle / one-photo / new record | ASK EFFECT_CONFIRMATION -> ALLOW với contract | ALLOW không hỏi effect lại nếu ownerEffectAllowed; ambiguity vẫn ASK | ASK, rồi **DENY UI LOCAL_WRITE grant**, không có journaled UI adapter tương ứng | VERIFIED_IN_SOURCE: agent-v2:142/:420; persisted-record:46; effect-grants:36 |
| V2 calculator exact local expression | ALLOW theo typed candidate/value contract | ALLOW | DENY LOCAL_WRITE UI grant | VERIFIED_IN_SOURCE: effect-grants:44/:48; owner-test-policy:33; full-control không phải superset |
| V2 READ_STATE / OPEN_DIALER / OPEN_URL typed | ASK interpretation -> ALLOW khi readback contract có | Như normal | Như normal | VERIFIED_IN_SOURCE: intent-capabilities:10; agent-v2:190; intent-executor:47/:119 |
| V2 typed SET_DEVICE_STATE | ASK interpretation rồi DENY thiếu fullControl | ASK interpretation rồi DENY | ASK interpretation -> ALLOW có journal/pre-post/undo; không hỏi effect riêng từng write | VERIFIED_IN_SOURCE: intent-executor:114; setting-mutations:93 |
| V2 consent/permission/unlock/ambiguous target | ASK người xử lý/chọn; không tự accept permission | ASK | ASK | VERIFIED_IN_SOURCE: agent-v2:169/:298/:416; help chỉ auto EFFECT_CONFIRMATION |
| Any unsupported or destructive operation | DENY | DENY | DENY | VERIFIED_IN_SOURCE: safety-envelope:11; capability-registry:13; full-control-policy:5 |

[INFERRED] UI nên giải thích full-control là **journaled setting-test contract**, không phải “mạnh hơn owner ở mọi tác vụ”. Việc bật nó hiện có thể làm camera/record/calculator đang chạy trong ordinary mode bị chặn. Không sửa behavior này trong một UI consolidation release nếu chưa có migration tests và thiết kế quyền riêng.

## 7. Capability Map Và Verifier Thực Sự

[VERIFIED_IN_SOURCE] “Có implementation” dưới đây chỉ là source reachability. Không có real-device acceptance mới. AP/V1/V2 dùng tên cột rút gọn; MISSING = thiếu contract hoàn chỉnh trong đường đó, không phải Android không thể làm.

| Capability người dùng | Action Plan | Goal V1 | Goal V2 | Verifier / giới hạn source |
| --- | --- | --- | --- | --- |
| VERIFIED_IN_SOURCE: mở app | OPEN_APP, alias/package; strict policy có thể chặn package UNKNOWN | Generic discovery + GoalSpec OPEN_APP | AppCatalog LAUNCH hoặc typed OPEN_APP intent | `condition-executor.ts:177` foreground; V1 evaluator:22; V2 verifyAll/FOREGROUND hoặc native resumed activity `intent-executor.ts:47`. Không reset app state. |
| VERIFIED_IN_SOURCE: tìm kiếm | YouTube/Chrome target-specific plan; generic focused input không tự tạo query outcome proof cho mọi app | SEARCH chỉ YouTube/Chrome (`goal-planner.ts:69`) | Generic SEARCH nhiều app có observed roles/query contract | Legacy `action-verifier.ts:52`, `evaluator.ts:24`; V2 `search-executor.ts:92`, `verification-registry.ts:19`, `generic-search.ts:206` committed exact query + result/empty surface. |
| VERIFIED_IN_SOURCE: YouTube ordinal/video/playback | video_card_N + Explorer/video filtering + postconditions | OPEN_RESULT ordinal, destination/title/playback goal | Search-only có; **MISSING ordinal selection/playback capability end-to-end** | Legacy `UIExplorer.find` :36, `action-verifier.ts:17`, `media-playback-verifier.ts:41`, `evaluator.ts:33`; V2 primitive SELECT_ITEM implemented=false (`primitive-decomposition.ts:18`). Predicate MEDIA_PLAYBACK_PROGRESS có ở verification-registry:95 nhưng không có goal compiler/candidate path cho playback selection. |
| VERIFIED_IN_SOURCE: Chrome/Google bài thứ N | `capabilities.ts:34` planChromeCommand + hybrid DOM clickOrdinal | OPEN_RESULT browser giữ ordinal | Generic SEARCH có thể dùng native; typed OPEN_URL có; **MISSING tương đương organic article ordinal** | `hybrid-context-observer.ts:138` revalidate/click/verify destination; `action-verifier.ts:34` URL/title/H1/canonical checks. V2 world web.actionable=false (`ui-world-model.ts:12`). Không chuyển browser success sang chỉ foreground. |
| VERIFIED_IN_SOURCE: Wi-Fi workflow/SSID chưa lưu | Bounded wifi plan đặc biệt + confirmation; user nhập credential và Connect trên điện thoại | **MISSING mutation/SSID workflow**, có read navigation | Typed SET_DEVICE_STATE wifi on/off full-control; **MISSING SSID credential workflow tương đương AP** | `wifi-plan.ts:18`, `wifi-network.ts:23` exact SSID + cmd wifi status; `wifi-control.ts:54` UI switch + wifi_on. V2 setting pair/journal độc lập; không chứng minh Internet. |
| VERIFIED_IN_SOURCE: settings toggles | Wi-Fi special path; generic unknown changes bị strict entry deny | **MISSING state mutation** | Observed labeled boolean SET_STATE (ordinary/normal); typed SET_DEVICE_STATE full-control | `state-target.ts:4`, `verification-registry.ts:87` ITEM_SELECTED; typed `setting-mutations.ts:28` independent state pair + exact inverse. UI checked-state proof không bằng native state pair. |
| VERIFIED_IN_SOURCE: typed setting contracts cụ thể | Wi-Fi only special contract | MISSING | settingCommand có wifi/bluetooth/brightness/dnd/rotation; **MISSING executor** media/ring volume/flashlight/airplane | `setting-mutations.ts:48` closed command mapping; :25 missing read pair; :98 network changes yêu cầu USB, :100 manual brightness; source có command không chứng minh OS/device hỗ trợ. Bluetooth không được thử lại. |
| VERIFIED_IN_SOURCE: đọc pin/Wi-Fi/brightness/volume và state khác | Không có typed native READ_STATE API trong ActionPlan | Hẹp read-location/storage UI, không general state-read contract | READ_STATE có typed native pair | `intent-executor.ts:59`/:66 hai independent read paths; extended settingPair ở setting-mutations:17. Một enum state không bảo đảm provider có mặt; mismatch -> block. |
| VERIFIED_IN_SOURCE: dial prefill, không gọi | MISSING capability/safe exact-number verifier | MISSING | OPEN_DIALER, ACTION_DIAL, không CALL | `intent-capabilities.ts:13`; `intent-executor.ts:23`/:55 exact observed number + independent resumed activity. Emergency/unsafe numbers bị schema giới hạn, `intent-schema.ts`. |
| VERIFIED_IN_SOURCE: alarm | MISSING | MISSING | SET_STRUCTURED_STATE + persisted new record, **partial** | `record-forms.ts:14` hour/minute/enabled; :39 đòi 24h, AM/PM bị loại; `persisted-record.ts:70` identity-bound reopen; `verification-registry.ts:45`. Spinner class recognition (`widget-semantics.ts:11`) không chứng minh mọi spinner/TimePicker có executor. |
| INFERRED: timer/countdown | MISSING | MISSING | MISSING registered goal/candidate/persistence/verifier | Đã tìm timer/countdown trong agent/capabilities; chỉ thấy host timers. Registry `capability-registry.ts:3`, requestedRecord `record-forms.ts:11` chỉ note/alarm. Mở app Clock không đồng nghĩa tạo timer. |
| VERIFIED_IN_SOURCE: camera chụp một ảnh | OPEN_APP camera/package có thể mở nhưng không shutter/save outcome contract | Chỉ mở camera; capture goal bị coverage guard từ chối | CAPTURE_MEDIA one observed shutter + MediaStore delta, normal ASK/ordinary auto | `state-target.ts:10`, `agent-v2.ts:445`, `verification-registry.ts:52`, `media-evidence.ts`. **MISSING** multiple photos/video recording generalized contract. Full-control UI-write incompatibility giữ nguyên. |
| VERIFIED_IN_SOURCE: tạo note/record | MISSING persisted proof | MISSING | CREATE_RECORD title/body có new-draft + persistence strategy registry + reopen | `record-forms.ts:18`; `record-persistence.ts:9` stable ID/post-Save ID/exact fields+createdAt; `persisted-record.ts:51` không sửa existing editor. Thiếu identity/inventory/time thì block; không generic form completion bất kỳ. |
| VERIFIED_IN_SOURCE: Gallery/artifact | Không có typed artifact dataflow | Không có typed artifact dataflow | FIND_ARTIFACT chỉ exact captured URI có producer; **MISSING generic Gallery UI find** | `goal-compiler.ts:54`, `agent-v2.ts:338`, `verification-registry.ts:29` active viewer receipt; báo EXACT_URI_VIEW, không GALLERY_UI_FIND. |
| VERIFIED_IN_SOURCE: calculator | Không có arithmetic final-oracle contract | MISSING | CALCULATE exact expression/keypad/locale result | `goal-compiler.ts:12` bounded AST oracle; `grounded-candidates-v2.ts:65`; `verification-registry.ts:94`. Không overwrite biểu thức cũ; full-control UI grant vẫn deny. |

[INFERRED] V2 là hướng mở rộng phù hợp nhưng **không phải superset V1/AP**. Đặc biệt thứ tự video/bài viết, browser semantic destination và SSID workflow là các compatibility islands phải giữ sau adapter trước deadline.

## 8. Failure Handling Và Chỗ Mất Thông Tin

| Nhãn / đường | Hard deny / retry / unknown effect | Chỗ collapse và rủi ro khi unify |
| --- | --- | --- |
| VERIFIED_IN_SOURCE: AP interpret | 400 input; 409 device; 422 capability/JSON; 502 model; 504 timeout; 503 catch-all (`interpret/route.ts:244`). | Hard source safety failure ném trong try:41 cũng có thể bị báo chung “không thể kết nối Ollama” ở :255; cần phân loại lỗi trong migration, không sửa tại audit. |
| VERIFIED_IN_SOURCE: AP execute | Source guard 403/422; context/permission lỗi 409 Session hoặc 422; step AndroidErrorCode được stream; break first failure, cleanup always (`executions/route.ts:132`/:146/:151). | `asAndroidError` biến plain Error thành BACKEND_ERROR (`errors.ts:26`); policy Error có thể mất typed category. Dispatch không verified -> SENT, không SUCCESS (:131/:159). Hook abort hiển thị FAILED + CANCELLED step (`useDashboardDemo.ts:301`), không dedicated AP CANCELLED aggregate. |
| VERIFIED_IN_SOURCE: V1 | Recovery bounded trước next; fresh discard; no blind repeat. Device/session/backend failure -> FAILED; ambiguity/config/scroll limit -> block; timeout có thể observe lại để tìm late evidence (`agent-loop.ts:258`). | `block()` :138 emit non-resumable assistance rồi BLOCKED, dù category khác nhau. Policy catch :213 thay thông điệp gốc bằng generic deny. Outer unexpected decision error :309 generic FAILED. Chỉ coherent visual ordinal tap có resumable exception (:270). |
| VERIFIED_IN_SOURCE: V2 | SafeBlocked/SearchBlocked/AgentLimitError/NavigationBlocked -> BLOCKED; other -> FAILED; timeout -> BLOCKED; user abort -> CANCELLED (`agent-v2.ts:475`). Wrong capture/record proof không retry. | Many causes thành SafeBlocked và current node SAFE_BLOCKED. Terminal reason cắt 180 ký tự ở :487; không có common typed root-cause/dispatchState trên mọi failure. Không được suy BLOCKED = zero device effect. |
| VERIFIED_IN_SOURCE: search interaction | `grounded-interactions.ts:15` NOT_SENT/UNKNOWN/ACKNOWLEDGED + issued receipt. `search-executor.ts:68` chỉ consume receipt NOT_SENT để renew một lần; ACKNOWLEDGED observe, UNKNOWN không replay. | Đây là phân loại mạnh hơn legacy error codes; common wrapper phải giữ diagnostic và receipt authority, không retry chung mọi TIMEOUT/BLOCKED. |
| VERIFIED_IN_SOURCE: intents | Source approval/exact resolution/readiness/physical check, ledger ghi trước dispatch (`intent-executor.ts:107`). Không replay span/binding; dispatch ack không proof, independent readback bắt buộc. | `agent-v2.ts:283` wrap mọi intent failure thành SafeBlocked message; structured subtype có thể mất khỏi aggregate. |
| VERIFIED_IN_SOURCE: settings | PREPARED -> UNKNOWN trước send -> ACKNOWLEDGED -> independently verified, journal flushed (`setting-mutations.ts:113`); only NOT_SENT strategy fallback (`strategy-reflection.ts:14`). | Missing handlers -> generic exhausted message (:19), nhưng reflection records còn. Unknown/intervening undo -> MANUAL_REQUIRED, không báo restored nếu chỉ thấy baseline (:149). |
| VERIFIED_IN_SOURCE: worker lifecycle | Restart đổi unfinished task thành BLOCKED, không tự resume (`device-runtime.ts:67`); disconnect abort đúng device (:98); post failure outer -> FAILED/CANCELLED (:230). | Registry có DISCONNECTED riêng; graph/capability root cause có thể chỉ còn reason/failure string. Compatibility route viewer không sở hữu execution. |

[INFERRED] Common result nên giữ ít nhất outcome status, stage, rootCause, retryability, dispatchState, effectMayHaveOccurred, evidence type/IDs, engine và raw legacy status. Hard-policy-denied trước dispatch, missing capability, model unavailable và unknown-after-click không được gộp thành cùng một “hãy thử lại”. Không nâng SENT/PARTIAL thành COMPLETED.

[INFERRED] Revoke/expiry owner scope trong lúc settle có thể khiến exact undo không chạy: `device-runtime.ts:49` revoke trước cancel; `setting-mutations.ts:148` read cleanup vẫn gọi check -> assertFullControl. Đây là rủi ro source, không kích hoạt mutation để tái hiện. Migration lifecycle phải giữ journal/manual-restoration result, không hủy Session/đổi engine để che settlement failure.

## 9. Coverage Hiện Có Và Khoảng Trống

### 9.1 Map Test Files -> Behavior

[VERIFIED_IN_SOURCE] Có 46 file `tests/*.test.cjs` trong baseline. Bảng là test intent/assertions đã đọc hoặc truy vết, **không cam kết từng file đều PASS trong lượt này**. Chưa chạy các `.integration.cjs` vì có thể tác động thiết bị thật. Test fixtures mô phỏng không phải sealed/user cohort.

| Nhãn / nhóm | Test files và evidence anchor | Hành vi được bảo vệ |
| --- | --- | --- |
| VERIFIED_IN_SOURCE: AP/ADB | `tests/android-executor.test.cjs:85`, :109, :147; `chrome-command-planning.test.cjs:25`, :78 | Capability validation, ordinal bounds, fresh WAIT_FOR, Unicode keyboard cleanup, Chrome address activation/query/order. |
| VERIFIED_IN_SOURCE: shared observer/exploration | `state-observer.test.cjs:36`, :54; `ui-exploration.test.cjs:68`, :73; `milestone25-resolution.test.cjs:29`; `visual-grounding.test.cjs:38` | Presence/late/timeout, ad filtering/ordinal rewind, target activation/occlusion, pixels + single-use human point. |
| VERIFIED_IN_SOURCE: browser/media | `browser-organic-results.test.cjs:12`, :37; `browser-title-evidence.test.cjs:8`; `media-playback-verifier.test.cjs:20` | Organic result vs ad, redirects/canonical/title, exact selected video and advancing playback clock, not preview/paused. |
| VERIFIED_IN_SOURCE: V1 core | `agent.test.cjs:70`, :107, :156, :181; `agent-reasoning.test.cjs:61`, :77; `action-candidates.test.cjs:56` | Goal criteria, incomplete/dishonest completion rejected, stale reasoning, no replay, budgets/cancellation, issued candidate IDs. |
| VERIFIED_IN_SOURCE: V1 navigation/recovery | `multi-application.test.cjs:43`; `multi-candidates.test.cjs:23`; `state-aware-navigation.test.cjs:105`; `dynamic-recovery.test.cjs:33`; `autonomous-task.test.cjs:107` | Discovery multiple apps, evidence-based navigation from playback/fullscreen, bounded recovery and same-Session human resume. |
| VERIFIED_IN_SOURCE: Dashboard legacy/policy | `dashboard-live-device-selection.test.cjs:13`; `dashboard-execution-logs.test.cjs:31`; `development-policy.test.cjs:16` | Live selection not demo IDs, log uniqueness/order, strict/production vs development behavior, geometry still enforced. |
| VERIFIED_IN_SOURCE: Wi-Fi/transport | `wifi-confirmation-route.test.cjs:41`, :54, :87; `wifi-control.test.cjs`; `wifi-network.test.cjs`; `wireless-api.test.cjs`; `wireless-connectivity.test.cjs`; `wireless-preview.test.cjs` | Exact device/ON/OFF/SSID tokens, switch+native state checks, manual credentials boundary, endpoint CIDR/busy/identity/reconnect and previews. |
| VERIFIED_IN_SOURCE: multi-device worker | `multi-device-runtime.test.cjs:54`, :81, :149, :232, :247, :331 | Per-device exclusion/isolation, shared reasoning queue, idempotency, cancel, restart journal, Human Assistance ownership and uncertain Session ports. |
| VERIFIED_IN_SOURCE: V2 basic contracts | `general-agent-v2-contracts.test.cjs:8`, :25; `general-agent-v2-runtime.test.cjs:45`, :64, :74; `general-agent-v2-widgets.test.cjs:40`, :137 | Exact source coverage, graph effects, typed grants/replay, arithmetic/locale, toggle and unique new media proof. |
| VERIFIED_IN_SOURCE: records/structured/artifacts | `general-agent-v2-persisted.test.cjs:99`, :114, :129, :204, :233, :251, :288 | Three persistence strategies, new vs existing form, exact fields/reopen, constrained 24h alarms, exact-URI identity, single Session/capture. |
| VERIFIED_IN_SOURCE: open-world verification | `general-agent-v2-open-world.test.cjs:83`, :90; `general-agent-v2-discovery-execution.test.cjs:38` | Bounded candidates, missing contracts, composite predicates, transition not outcome, synthetic initial-state variation. |
| VERIFIED_IN_SOURCE: V2 search | `general-agent-v2-search.test.cjs:49`, :60, :77; `general-agent-v2-search-reliability.test.cjs:16`, :92, :131 | Multiple generic layouts, exact query, no result click, no replay, live search stability, SSR analysis/search status. |
| VERIFIED_IN_SOURCE: V2 M2b/M3c/M3d | `general-agent-v2-m2b.test.cjs:13`, :37; `general-agent-v2-m3c.test.cjs:20`, :47; `general-agent-v2-m3d.test.cjs:22`, :89, :169 | Slots/opt-in review, NOT_SENT-only renewal, native focus/password/keyboard provenance, old-query clearing, consent not auto-accepted. |
| VERIFIED_IN_SOURCE: intents/full-control | `general-agent-v2-m4b.test.cjs:35`, :45, :65; `general-agent-v2-m4d.test.cjs:45`, :64, :82, :86 | Exact intent handler/number/state read, no SMS draft, bounded strategies, journal/readback/inverse, unknown baseline not restored, ordinary owner cannot typed mutate. |
| VERIFIED_IN_SOURCE: provider/phrasing/security | `general-agent-v2-m4e.test.cjs:44`; `groq-router.test.cjs:30`, :78; `general-agent-v2-m5b.test.cjs`; `general-agent-v2-m5b-security.test.cjs:28`, :36, :52 | Rule singleton/model reduced IDs, provider redaction/fallback, source values, all public mutation boundaries and worker source guard. |
| VERIFIED_IN_SOURCE: owner/caching | `owner-authorized-test-mode.test.cjs:46`, :63, :109, :169; `agent-v2-catalog-cache.test.cjs:18`, :91, :106 | Ordinary owner auto-effect/revoke/device scope, V1 default SSR, persistent label invalidation, warmup no competition, runner stale-deadline cancel guard. |

### 9.2 Những Gì Chưa Được Bảo Vệ Đầy Đủ

| Nhãn | Gap cụ thể và cách xác định |
| --- | --- |
| INFERRED | **Chưa có adapter parity test giữa AP/V1/V2** cho cùng request/outcome/event/cancel; hiện chưa có unified adapter để test. Các unit từng engine không chứng minh parity. |
| INFERRED | **Chưa tìm thấy automated browser click-through** của hai tabs, chọn V1/V2, owner/full-control, confirm/reject/resume rồi Android readback. Tests Dashboard đọc hook source hoặc render SSR (ví dụ `general-agent-v2-search-reliability.test.cjs:92`, `owner-authorized-test-mode.test.cjs:169`), không browser E2E. |
| INFERRED | **Chưa thấy full matrix test** chứng minh camera/record/calculator dưới full-control bị UI-grant deny sau effect confirmation, hoặc UI giải thích chính xác sự khác ordinary/full. M4d tests có ordinary typed-mutation rejection, không phải bằng chứng tất cả UI combinations. |
| INFERRED | **Không có end-to-end V2 equivalents** bảo vệ YouTube ordinal/playback, Chrome organic article ordinal, AP SSID workflow hoặc timer; source contracts còn MISSING ở mục 7. Không thể lấy legacy helper tests làm chứng nhận V2 có các feature này. |
| INFERRED | **Chưa tìm thấy integration test hợp nhất lifecycle** cho AP request abort -> worker cancellation và ngược lại V1 viewer detach -> task tiếp tục, cùng physical-device exclusion lúc chuyển engine. Multi-device tests bảo vệ registry, chưa có AP-in-worker parity. |
| UNVERIFIED | Không chạy coverage instrumentation nên không tuyên bố “mỗi dòng chưa được test”. Các gap trên là thiếu scenario/contract được tìm trong inventory 46 files, không phải thống kê branch coverage. Các `.integration.cjs` còn là manual/live harness, chưa chạy lại. |
| UNVERIFIED | Model thật trên câu hoàn toàn mới, app UI mới, multi-device thật, grant expiry trong latency dài và production packaging không được các mock PASS chứng minh. |

## 10. Baseline Chạy Trong Lượt Này

[VERIFIED_BY_TEST_RUN] Dùng Node executable thật `C:\nvm4w\nodejs\node.exe`, không dùng extensionless `node` trong System32. Full regression chạy **một lần**: lấy danh sách 46 `tests/*.test.cjs`, truyền từng path cho `node --test` bằng spawnSync. Không import `tests/sealed` hoặc `tests/holdout`. Typecheck bắt đầu sau khi regression đã kết thúc; ESLint bắt đầu sau typecheck. Không đo Android/inference song song.

| Nhãn / lệnh | Kết quả thực tế | Thời gian |
| --- | --- | ---: |
| VERIFIED_BY_TEST_RUN: full regression, 46 files | **681 PASS / 707 total; 26 FAIL**, 0 cancelled/skipped/todo, exit 1. Không báo 707/707 theo tài liệu cũ. | Node TAP 63.556 s; wrapper wall 63.709 s |
| VERIFIED_BY_TEST_RUN: `tsc --noEmit --incremental false` | PASS exit 0, không diagnostics | 20.672 s wall |
| VERIFIED_BY_TEST_RUN: full ESLint `eslint .`, không fix/cache flag | FAIL exit 1: `components/executions/ExecutionDetailModal.tsx:130:98` no-explicit-any; 9 unused warnings | 43.871 s wall |
| VERIFIED_BY_TEST_RUN: `git diff --check` trước ghi report | PASS exit 0, chỉ LF/CRLF warnings | Không benchmark |
| UNVERIFIED: production build/runtime/Android | Không chạy vì scope điều tra kiến trúc và chỉ yêu cầu regression/typecheck baseline; không dùng build cũ làm PASS hiện tại | N/A |

[VERIFIED_BY_TEST_RUN] Một **targeted diagnostic riêng**, không chạy lại full suite: `node --test --test-name-pattern='OFFLINE_TESTED M5c persistent hit/miss' tests/agent-v2-catalog-cache.test.cjs`. Kết quả 0/1 PASS, exit1, TAP 1.192 s; lỗi `EPERM: operation not permitted, rename ... labels.<uuid>.tmp -> labels.json` trong sandbox TEMP, stack `LauncherLabelCache.save` (transpiled stack line 59; source rename thật ở `lib/android/agent/launcher-label-cache.ts:48`). Đây là evidence trực tiếp về môi trường cho test đó, không là root-cause proof cho cả 26 failures.

| Nhãn / failure bucket của full run | Số fail | Tên/scenario được TAP ghi nhận |
| --- | ---: | --- |
| VERIFIED_BY_TEST_RUN: label cache | 8 | persistent hit/miss; version; update time; missing update time; device/alias isolation; bounded cache; partial extraction; fresh metadata invalidation |
| VERIFIED_BY_TEST_RUN: route hints | 1 | M3 issued independently verified transitions / physical-device/package-version isolation |
| VERIFIED_BY_TEST_RUN: worker security | 1 | M5b worker API source/grant spoofing and device owner |
| VERIFIED_BY_TEST_RUN: Groq/router mocked HTTP | 12 | success; 429; 500; timeout; invalid; foreign; grant; Retry-After; circuit; process rate budget; M4e richer opt-in; M4e sensitive/editable projection |
| VERIFIED_BY_TEST_RUN: worker HTTP/lifecycle | 3 | detached viewers/journal restart; evidence polling isolation; owner HTTP audit/restart |
| VERIFIED_BY_TEST_RUN: wireless simulation | 1 | USB conversion/reconnect/busy-disconnect/no raw command resume |

[UNVERIFIED] Full-suite wrapper chỉ giữ TAP failure titles và totals, không giữ toàn bộ nested diagnostics ra file. Ngoài cache diagnostic nêu trên, root cause từng failure còn chưa xác định. Network/listen/TEMP restrictions là giả thuyết hợp lý trong sandbox, **không được đánh dấu đã chứng minh**. Không chạy lại full regression ngoài sandbox vì yêu cầu baseline một lần, không chỉnh test/assertion để che failure.

[VERIFIED_BY_TEST_RUN] Warnings ESLint: ActionPlanPreview có FileJson/cn; DeviceFilters có Maximize2; ExecutionDetailModal có CheckCircle2/AlertCircle/PlayCircle/Clock/Layers; TaskQueue có Play. Đây là lỗi/cảnh báo hiện tại được chạy lại, không chỉ copy từ M5c.

[INFERRED] Migration gate phải bắt đầu bằng chẩn đoán môi trường và lấy baseline có thể tái lập; **chưa được gọi baseline hiện tại green**. Không dùng tổng 707 tests để suy mức tự chủ model hoặc device acceptance.

## 11. Đề Xuất Hợp Nhất Tối Thiểu

### 11.1 Đích Đến Và Action Plan Adapter

[INFERRED] Đích phase đầu: **một entry point và một task owner, nhiều engine adapters**. Input/Execute chung không đồng nghĩa ngay lập tức chỉ còn một loop. Default engine ban đầu giữ V1 để không đổi behavior âm thầm; V1/V2 selector chỉ ở internal/debug setting. Sau parity acceptance mới đổi default hoặc dùng capability router phía server.

[INFERRED] Request envelope mới, ví dụ `UnifiedCommandRequest`, nên phân biệt input là goal text hoặc legacy Action Plan reference; chứa requestId/deviceId/originalRequest và **server-issued interpretation reference**. Không nhận grant, proof, selectors hoặc full-control authority từ model/client. Mode lấy từ backend scope hiện có, không từ một boolean client “allow all”. Internal engine preference được allowlist; không cho provider chọn policy/engine bằng free text.

[INFERRED] `LegacyActionPlanAdapter` giữ nguyên ActionPlanSchema và hai public APIs. `/commands/interpret` tiếp tục trả `{success,actionPlan,authorizationToken?}`; không đổi rules/prompt để “hợp nhất”. `/executions` vẫn nhận đúng fields và trả NDJSON progress/complete như cũ. Backend consume exact device/source/plan ticket một lần; Wi-Fi challenge phải xảy ra trước consume như source hiện tại, token binding/TTL không đổi.

[INFERRED] Adapter không đơn giản convert từng CLICK/WAIT_FOR thành V2 NAVIGATE/SEARCH. Nó đóng gói **opaque ordered legacy task** với action indexes + original outcome/verification contract, chạy bằng primitive context cũ. AP plan order, maximum actions, exact targets, Wi-Fi accounting và SENT semantics giữ nguyên. Generic action “dispatch succeeded” không được tạo VerifiedEvidence V2 giả bằng cast/JSON.

[INFERRED] Một facade `UnifiedAgentService` nhận request, chọn adapter **trước effect đầu tiên**, đặt execution identity, ownership, budget, cancellation và event sink. V1Adapter gọi planGoal/runAgent; V2Adapter gọi runAgentV2; PlanAdapter gọi ordered loop tương đương executions route. Chỉ một adapter sống trong mỗi execution. Không nested START V1 trong V2 hoặc tạo thêm Session để fallback.

[INFERRED] Đưa PlanAdapter vào worker là bước riêng sau UI facade: thêm internal validated job variant/discriminant có server-issued plan reference, không nhét raw JSON plan vào goal string. Legacy API vẫn là compatibility transport. Chuyển source/plan token từ Next process-global Map sang worker-owned hoặc authenticated single-use transfer cần thiết kế rõ; không serialize WeakMap grants/ownerScope qua HTTP và không kéo dài ticket TTL chỉ để né lỗi.

[INFERRED] Event adapter chung giữ `engine`, `stage`, raw status, verified/total outcomes, dispatchState/effect uncertainty, evidence provenance, assistance category và mutation settlement. AP SUCCESS chỉ khi mọi step VERIFIED như route cũ; V1 COMPLETED vẫn do criterionSatisfied; V2 COMPLETED vẫn allOutcomesVerified + settlement. Compatibility NDJSON mapping không được làm SENT thành SUCCESS hoặc gọi URI handoff là Gallery search.

[INFERRED] Cancellation compatibility là contract bắt buộc: AP viewer/request abort hiện cancel execution; `/api/agent` viewer detach hiện **không** cancel. Unified coordinator nhận explicit cancel intent từ từng transport adapter, không dùng một onDisconnect handler cho mọi client. Cancel phải đợi cleanup/settlement xong; UI hiển thị CANCELLING nếu còn inverse/manual restoration, không cho chạy task kế sớm.

[INFERRED] Với một input/Execute: Execute tự thực hiện interpret nếu cần, hiển thị inline approval/clarification rồi tiếp tục **cùng execution**. Preview giữ là phần mở rộng/diagnostic, không nút bắt buộc cho người dùng phổ thông. V1/V2 chỉ ở debug; UI luôn hiển thị engine thực tế trong diagnostic/history. Device selection, group run, explicit Cancel và owner/full-control scope phải còn.

### 11.2 File Map: KEEP / MODIFY / ADD / REMOVE LATER

| Nhãn / cũ -> mới | Hành động đề xuất | Trách nhiệm giữ lại |
| --- | --- | --- |
| INFERRED: `lib/validators/action-plan.schema.ts`, `lib/android/capabilities.ts`, `wifi-plan.ts` -> compatibility contracts | **KEEP** ban đầu | API/plan vocabulary, Chrome/Wi-Fi rules, ordinal semantics. |
| INFERRED: `condition-executor.ts`, `executor.ts`, `state-observer.ts`, `hybrid-context-observer.ts`, `exploration/*`, `appium/*`, `grounded-interactions.ts` | **KEEP** | Existing Session/context/grounding/native/DOM/ADB implementations, no new device executor. |
| INFERRED: V1 `goal-planner.ts`, `agent-loop.ts`, `decision-engine.ts`, `evaluator.ts`, `recovery.ts` | **KEEP** behind V1Adapter | Criteria, playback/article ordinal, recovery and human visual activation. |
| INFERRED: V2 `agent-v2.ts`, `search-executor.ts`, `persisted-record.ts`, `intent-executor.ts`, `setting-mutations.ts` | **KEEP**, later narrow adapter hooks only if needed | Goal Graph, typed effects, exact proof contracts and restoration. Không rewrite loop. |
| INFERRED: `verification-registry.ts`, `composite-verification.ts`, `action-verifier.ts`, `candidate-verifier.ts`, `media-playback-verifier.ts`, `artifact-store.ts`, `record-persistence.ts` | **KEEP**; receipt bridge chỉ gọi existing verifier | Không gộp action transition/outcome; không đổi evidence authority. |
| INFERRED: `owner-test-policy.ts`, `full-control-policy.ts`, `effect-grants.ts`, `intent-capabilities.ts`, `safety-envelope.ts`, `wifi-confirmation.ts` | **KEEP** policies/TTL; chỉ facade accessors sau tests | Không mở rộng mode hoặc cấp owner quyền V1/AP. |
| INFERRED: `app/api/commands/interpret/route.ts`, `app/api/executions/route.ts`, `app/api/agent/route.ts`, `app/api/agent/runtime/route.ts`, `assistance/route.ts` | **MODIFY từng route một**, thành compatibility transports | Preserve schemas/status codes/stream/disconnect/confirmation behavior; không xóa route cũ. |
| INFERRED: `agent/device-runtime.ts`, `runtime-schema.ts`, `worker-server.ts`, `worker-client.ts`, `runtime-storage.ts` | **MODIFY sau facade parity** | One coordinator, typed legacy job variant, persisted engine kind, one reservation; hash/schema compatibility and restart non-resume. |
| INFERRED: `components/commands/AICommandPanel.tsx`, `AgentGoalPanel.tsx`, `CommandInput.tsx`, `hooks/useDashboardDemo.ts`, `hooks/useAgentRuntimes.ts`, `app/page.tsx` | **MODIFY incremental** | One goal field/Execute/event store; reuse graph/assistance/journal views and live device selection. |
| INFERRED: `lib/android/agent/unified-command.ts`, `unified-agent-service.ts`, `engine-adapters.ts`, `legacy-plan-adapter.ts`, `execution-receipt.ts` | **ADD tối thiểu**, tên gợi ý, chưa tạo | Envelope/facade/three adapters/typed result translation; không thêm planner/provider mới. Có thể gộp files nếu scope nhỏ. |
| INFERRED: `hooks/useUnifiedAgent.ts`, internal debug setting component; `tests/unified-agent-compatibility.test.cjs`, `tests/unified-agent-policy-matrix.test.cjs`, `tests/unified-agent-lifecycle.test.cjs`, browser acceptance specs | **ADD khi triển khai được cho phép** | Contract/permission/cancel/parity/browser gates; không dùng held-out cohort làm fixtures. |
| INFERRED: unused exported ADB wrappers, TaskQueue/demo callbacks, `visual-review.ts`, local cancellation registration | **REMOVE LATER ONLY AFTER tests + external-caller review** | Repo call-site absence không chứng minh không có external consumer/manual harness. |
| INFERRED: old tabs/version radios, duplicate hook state, direct route orchestration | **REMOVE LATER ONLY AFTER facade parity** | Chỉ bỏ UI/state đã được thay; không xóa V1 engine, verification hoặc compatibility endpoints để giảm số file. |

### 11.3 Các Bước Nhỏ Và Gate Trước/Sau

| Thứ tự / nhãn | Bước nhỏ | Gate trước và sau | Rollback cụ thể |
| --- | --- | --- | --- |
| 1 / INFERRED | Khóa behavior inventory, làm rõ 26 baseline fails trong môi trường có quyền phù hợp; characterization AP statuses/stream/cancel và full matrix modes. | Trước: giữ kết quả 681/707 hiện tại. Sau: baseline regression tái lập, TS pass; ghi riêng known ESLint error, không sửa assertions để green. | Chưa có runtime delta; chỉ bỏ tests characterization mới nếu sai, không reset unrelated work. |
| 2 / INFERRED | Add envelope + adapters/facade chưa đổi routes/UI. No-op wrapper delegating old functions. | Existing 46 files + new parity tests: same actions/order, completion criteria, no extra model/device RPC effect, exact ticket replay/expiry. | Xóa/bỏ dùng adapter mới; old paths nguyên vẹn. |
| 3 / INFERRED | One Dashboard input/Execute dùng facade, engine routing vẫn explicit preselected và V1 default. Không migration worker AP ngay. | UI hook/SSR cũ trước; sau browser test input/device/group/execute/cancel/assistance + same raw terminal statuses. Test switching debug engine không khởi động duplicate task. | Feature flag trở lại old panel; pending tasks vẫn do old owner hoàn tất, không cancel/restart chỉ vì rollback UI. |
| 4 / INFERRED | Move AP task ownership vào worker qua validated PlanAdapter, giữ APIs bằng transport adapter. | `multi-device-runtime`, `wifi-confirmation-route`, M5b security + new lifecycle tests; add AP/V1 busy collision, USB/Wi-Fi same physical, restart, requestId and two disconnect semantics. Real-device read-only AP/V1/V2 acceptance riêng. | Chỉ route **new admissions** về old path khi idle; giữ worker đọc được old/new history schema. Active tasks không đổi owner, không replay authorization. |
| 5 / INFERRED | Chuẩn hóa failure/evidence envelope, không đổi verifier internals. | Legacy SENT unknown-click, V1 human activation + late playback, V2 NOT_SENT/UNKNOWN, owner revoke/settlement and exact URI tests phải giữ. Manual screenshot/native false-completion checks. | Giữ raw events để revert mapper, không rewrite persisted FAILED/BLOCKED thành status mới. |
| 6 / INFERRED | Capability router có version; chỉ chọn engine theo complete supported contract **trước dispatch**. | Paired source-faithful tasks gồm YouTube ordinal, Chrome ordinal, generic search, SSID, typed state and ordinary camera. No silent fallback tests; real-device compatibility gated. | Pin engine trước task về V1 hoặc explicit legacy plan; nếu task đã có effect, stop/cleanup, cần task/grant mới để thử cách khác. |
| 7 / INFERRED | Dần đưa legacy special capabilities vào typed V2 adapter, rồi mới deprecate obsolete UI/hooks. | Mỗi capability có policy/candidate/executor/verifier parity + old regression + real-device outcome/latency comparison. Không đổi cohort độc lập để tune. | Retain old capability adapter sau flag; chỉ remove khi parity và rollback window đã được chấp nhận. |

[INFERRED] Mọi gate bao gồm TS và no-source-drift ngoài scope. Test simulation bảo vệ contracts nhưng không thay Android/browser acceptance. Không cần đổi model để có unified entry point; model/proposal benchmarking là công việc riêng sau khi lifecycle và fidelity ổn định.

## 12. Rủi Ro, Ưu Tiên Và Điều Không Được Tuyên Bố

| Nhãn / ưu tiên | Rủi ro | Khuyến nghị |
| --- | --- | --- |
| INFERRED: trước deadline | “V2 mới hơn” bị hiểu thành thay toàn bộ legacy, mất ordinal/browser/SSID semantics. | Giao diện/facade chung trước, giữ compatibility islands; hiển thị actual engine/unsupported capability. |
| INFERRED: trước deadline | Full-control bị coi là auto-allow superset; ordinary camera bị regression. | Matrix UI/backend tests và text rõ scope; không bỏ journal/grants hoặc blanket auto-approve. |
| INFERRED: trước deadline | AP-in-worker làm đổi cancellation, token process ownership, source hash/history compatibility. | Ship UI facade trước; worker migration chỉ sau characterization và có rollback admission-only. |
| INFERRED: trước deadline | Unknown-after-click bị retry hoặc engine fallback gây double effect. | Preserve dispatch state/single-use receipt, one engine per execution, independent final verifier. |
| INFERRED: trước deadline | Báo “baseline green” theo tài liệu cũ, che sandbox failures/lint. | Ghi đúng 681/707 + targeted EPERM; điều tra môi trường trước migration. Không coi failures là tự động unrelated. |
| INFERRED: hoãn | Viết universal observer/verifier mới, học workflow tự sinh, rewrite toàn V1 thành V2. | Tái dùng interfaces/contracts hiện có; chỉ port từng capability có bằng chứng. |
| INFERRED: hoãn | Chứng nhận model generalization/multi-device throughput từ unit PASS hoặc 0-call rules successes. | Independent held-out và real-device/browser acceptance riêng, không mở sealed hoặc tune user cohort trong architecture work. |

[INFERRED] **Các claim “unified agent” sẽ sai nếu:** chỉ giấu tabs nhưng vẫn có hai task owners không phối hợp; âm thầm V2 thất bại rồi V1 báo SUCCESS; đổi query/ordinal/drop outcome để chạy được; gán dispatch/SENT hay empty foreground thành goal completion; bỏ technical gates để giảm ASK; gọi exact-URI viewer là Gallery search; hoặc gọi singleton/rules execution là suy luận AI thực sự.

[VERIFIED_IN_SOURCE] Nền tảng dùng chung đã tồn tại: createExecutionContext/StateObserver/Appium locks, shared scheduler, worker registry cho V1/V2 và per-goal verifiers. Source không yêu cầu viết lại hệ thống để gộp entry point; source cũng chưa chứng minh V2 thay được toàn bộ AP/V1.

[INFERRED] **Khuyến nghị cuối:** thống nhất trải nghiệm và lifecycle admission qua facade + explicit adapters; giữ behavior/proof của từng engine; chỉ chọn engine trước effect; giữ V1/V2 trong debug và actual-engine provenance trong audit. Trước deadline ưu tiên correctness/compatibility/cancellation/permissions hơn “một loop duy nhất”. Hợp nhất sâu chỉ sau parity tests và real acceptance.

## 13. Kiểm Tra Chỉ Ghi Báo Cáo

[VERIFIED_BY_TEST_RUN] Trước ghi báo cáo, hash 250 file `.ts/.tsx/.cjs/.json` đã đọc trong `app`, `components`, `hooks`, `lib`, `tests`, `scripts` (loại trừ toàn bộ `tests/sealed` và `tests/holdout`) là `a9b8815faa6301c8ada1972f786b928a983caefabed2f582ad14135ba9de7705`. Đây là source manifest phục vụ kiểm tra không đổi khi viết report, không phải frozen held-out benchmark và không bao gồm mọi root config. Không tạo manifest file khác trong repo.

[VERIFIED_BY_TEST_RUN] Sau ghi, cùng manifest 250 files vẫn có hash `a9b8815faa6301c8ada1972f786b928a983caefabed2f582ad14135ba9de7705`. Báo cáo không có trailing whitespace. `git status --short --untracked-files=all -- docs/unified-agent-architecture-audit.md` ghi nhận đúng file báo cáo untracked. Không có phát triển feature hoặc tiếp tục nghiệm thu M5c trong lượt này.
