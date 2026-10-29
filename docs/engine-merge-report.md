# Phone Commander: kiểm kê trước hợp nhất engine

Ngày: 23/10/2026. Branch: `DuyTD`. Phạm vi lượt này: **GIAI ĐOẠN 0, CHỈ KIỂM KÊ**.

**Mới nhất 26/10/2026: lượt hoàn tất B, xem mục 22.** Đã cập nhật đúng một hash snapshot và tên test theo quyền duyệt, AST giữ nguyên mọi assertion khác. Full regression **1358 PASS / 0 FAIL / 6 TODO**, TypeScript/scoped lint PASS, full lint **0 lỗi / 4 warning**, diff check PASS. Build webpack ngoài sandbox đúng **1 lần**, compile/typecheck/static generation xong nhưng **exit 1 SecurityFatalError**, không phải production build PASS. Unified một đường V2 theo catalog đạt OFFLINE_TESTED; mã V1/Action Plan còn nguyên, chưa archive/xóa; Dashboard browser và P1 Android chưa nghiệm thu. Mục 19-21 giữ làm lịch sử, không dùng trạng thái STOP cũ thay kết quả mới.

**Mốc 24/10/2026: tiếp tục lần 2 STOP tại A1, xem mục 17.** Chỉ thay goal không thể đưa fixture Human Assistance hiện có tới WAITING_HUMAN cho câu ENABLED; cần sửa adapter fake, đang bị yêu cầu cấm tại mốc đó. Các trạng thái A2/A3 chưa làm trong mục 17 và bốn failure trong mục 18 là lịch sử, đã được xử lý ở phần A mới nhất ghi tại mục 19.1.

**Mốc trước, mục 16: Giai đoạn 3.4 đã triển khai một phần rồi STOP.** Đã tách handler và chặn public legacy START; năm test được duyệt giữ nguyên assertions. Catalog/runtime admission còn regression: full manifest + test mới **1249 PASS / 8 FAIL / 6 TODO**. Không sửa test ngoài quyền, chưa thay Unified router/UI/contracts, **chưa hợp nhất một đường chạy; working tree đang dở dang, không dùng làm bản demo đạt nghiệm thu**.

**Cập nhật 24/10/2026: Giai đoạn 3.4 DỪNG ở preflight, xem mục 15.** Source/test/config chưa đổi. Cổng legacy mặc định từ chối xung đột trực tiếp với bốn test an toàn Wi-Fi và một test API Chrome không thuộc ngoại lệ cho phép sửa. Không vượt điều kiện STOP tại mục 3.4 của yêu cầu. Đã tạo `backup-before-stage34`; chưa có catalog/router/UI mới và chưa hợp nhất một đường chạy.

**Mốc triển khai gần nhất: Giai đoạn 3.1, chỉ P1, tại mục 14.** P1 Chrome search + bài organic đầu tiên đã port vào loop V2 và đạt **OFFLINE_TESTED**: 1218 PASS / 0 FAIL / 6 TODO; TypeScript và lint PASS. Production build vẫn FAIL do SecurityFatalError đã biết. Android P1 mới **UNVERIFIED**, chưa chạy ADB/Appium/model thật. Mốc này đã dừng chờ phép nghiệm thu ba lượt; yêu cầu 3.4 mới hơn và điểm dừng của nó nằm ở mục 15. Các trạng thái “chưa port” bên dưới mục 14 là lịch sử, không phải trạng thái mới nhất.

**Cập nhật Giai đoạn 2 ngày 23/10/2026 ở mục 13.** Mục 1-12 giữ nguyên làm lịch sử Giai đoạn 0. Người dùng đã chốt V2 làm engine đích trong yêu cầu mới; chưa port hay đổi router. Kết quả mới: 1193 PASS, 0 FAIL, 6 TODO trong regression có loại trừ; build vẫn exit 1 do SecurityFatalError. Dừng chờ duyệt trước Giai đoạn 3.

**Chưa chọn engine đích, chưa port, chưa archive hoặc xóa engine. Chờ chủ dự án xác nhận trước Giai đoạn 1.** Không triển khai Teach Mode, không tạo Agent version mới.

## 1. Trạng thái đầu lượt và giới hạn bằng chứng

Đã chạy `git status --short --branch` trước khi khảo sát. Working tree có các sửa M7a/Fix, temporal, launcher, playback và refactor chưa commit; không reset, checkout, stash hay stage chúng.

Đã tạo `backup-before-engine-merge`, cùng trỏ với `DuyTD` tới:

```text
01525d92412eb1779855beec0e359037a79873d0
```

Lần tạo branch đầu bị chặn ghi `.git`; lần được cấp quyền theo yêu cầu người dùng đã thành công. **Branch backup chỉ bảo vệ commit HEAD, không chứa những file đang sửa hoặc untracked. Nó không phải bản sao đầy đủ working tree.** Không tạo commit để thay đổi điều này.

Trong Giai đoạn 0 chỉ đọc source, test source và báo cáo/evidence đã có; file nội dung mới duy nhất là báo cáo này. Không chạy Android, API execution, Appium, warmup, Ollama hoặc cloud; không đổi env/config; không đọc/import sealed, holdout hoặc tìm khóa. Không chạy lại regression/typecheck/build trong bước kiểm kê chỉ đọc. Các kết quả test và Android bên dưới là **lịch sử**, không phải nghiệm thu mới trên hash hiện tại.

Đã đọc M5c, M6a, M6b, M6c, M7a, M7a Acceptance, M7a Fix, Safe Refactoring, khảo sát kiến trúc hợp nhất và source tương ứng. Các báo cáo bổ sung được liệt kê ở mục 6. Báo cáo kiến trúc ngày 21/10 có trước temporal/READ_STATE/M7a Fix; không dùng nó để kết luận capability hiện tại còn thiếu nếu source mới đã có.

### Quy ước

- `REAL_ANDROID_VERIFIED` (`R` trong bảng): báo cáo lịch sử ghi nhận đúng outcome với bằng chứng Android thật. Ghi rõ engine, phạm vi và checkpoint; không suy ra mọi câu lệnh/UI đều chạy được hôm nay.
- `OFFLINE_TESTED` (`O`): hành vi có characterization/regression đã PASS trong evidence lịch sử. Mock PASS không chứng minh AI tự chủ hoặc Android thật.
- `UNVERIFIED` (`U`): thiếu bằng chứng hoàn thành tương ứng, chưa chạy, hoặc chỉ mới analyze/discover. Có source không tự động thành `R`.
- `FAILED` (`F`): giữ nguyên failure thật trong báo cáo/test. `BLOCKED`, `CANCELLED`, `SENT`, `NOT_EXECUTED` được ghi nguyên trạng, **không đổi thành FAILED hoặc thành công**.
- `MISSING`: không có contract thực thi + verifier hoàn chỉnh ở engine đó cho outcome đang xét. Có primitive CLICK/INPUT hoặc mở ứng dụng không được tính là capability tạo/xác minh dữ liệu.
- `m=?`, thời gian `?`, RPC/ADB `?`: không có số đo đáng tin cậy. Không điền 0 thay cho thiếu instrumentation. `m=0` chỉ áp dụng đúng run được dẫn.
- Mã `A*`, `B*`, `C*` là đường source ở mục 4; `T*` là nhóm tests ở mục 5; `E*`, `L*` là evidence và số đo ở mục 6-7. Mỗi ô capability dẫn các mã này để truy ngược, không phải đánh giá bằng tên file.

## 2. Kết luận kiểm kê: một UI chưa phải một engine

**VERIFIED_IN_SOURCE:** hiện vẫn có ba vòng điều phối cấp cao có thể tới thực thi thật:

```text
Dashboard UnifiedAgentPanel
  -> /api/unified-agent -> UnifiedAgentService -> routeCapability (trước dispatch)
     -> ACTION_PLAN -> interpret -> /api/executions -> vòng các action
     -> V1 -> Worker START_PREPARED -> DeviceRuntimeRegistry -> runAgent
     -> V2 -> Worker START_PREPARED -> DeviceRuntimeRegistry -> runAgentV2

API/hook tương thích và UI nhóm còn có thể gọi trực tiếp các nhánh cũ.
Cả ba tái sử dụng nhiều lớp Android, đặc biệt createExecutionContext/ConditionExecutor.
```

| Vòng cấp cao | Nơi điều phối | Ai quyết định bước kế tiếp | Điều kiện hoàn thành |
|---|---|---|---|
| Action Plan | `app/api/executions/route.ts:116`, gọi `execution.execute` | Plan đã phân tích; chạy tuần tự, executor chờ/ground/verify từng action | Mọi step VERIFIED mới SUCCESS; còn dispatch không chứng minh được thì SENT (`:131`, `:159`). Unified chuyển sang COMPLETED chỉ qua `actionPlanCompletion`, `service.ts:34`. |
| V1 | `lib/android/agent/agent-loop.ts:97`, vòng `:145` | `AgentDecisionEngine.decide`, rules trước (`decision-engine.ts:24`, `:104`), model cho lựa chọn có grounding nếu rules chưa đủ | Criteria của goal và selection identity, `evaluator.ts:16`; yêu cầu phát video còn cần MediaSession PLAYING và tiến triển thời gian. |
| V2 | `lib/android/agent/agent-v2.ts:130`, dependency loop `:311`, observe/action loop `:333` | Compiler + typed outcomes; intent/temporal/search/record runners; `chooseCompatible` hoặc `chooseGroundedNext` chỉ chọn candidate backend cấp | Tất cả outcome có authentic registered evidence và settlement hợp lệ; không chỉ dispatch hoặc UI thay đổi. |

`ConditionExecutor` là executor dùng chung, **không thể xóa như file chỉ dành cho Action Plan**: V1 import ở `agent-loop.ts:2`, V2 ở `agent-v2.ts:3`. Intent, temporal, search, record và setting transaction có vòng bounded riêng nhưng không phải engine thứ tư độc lập. `composite-verification.ts:9` gọi registry V2; không đồng nghĩa với evaluator criteria V1.

### Router hiện chọn gì?

`lib/android/unified-agent/capability-router.ts:9` nhận recipe Wi-Fi hoặc Chrome đầy đủ; `:18` kiểm tra source/policy trước chọn engine:

1. Debug selection nếu có, nhưng vẫn kiểm tra khả năng/policy.
2. Recipe đầy đủ -> Action Plan.
3. Goal legacy rõ, operation OPEN_RESULT/FIND_PLACE/OPEN_PAGE/FIND_ELEMENT -> V1.
4. Các trường hợp còn lại -> V2 rồi kiểm tra coverage/application binding.

Forced V2 với OPEN_RESULT bị ASK tại `:23`, không tự fallback sang V1. Backend không phải Appium không được dùng V1/V2 (`:24`). Recipe SSID không được nuốt clause tiếp theo. Đây là **router chọn engine**, chưa phải router capability của đúng một engine. Lý do router nói "existing complete recipe" là lý do source-level, không phải bằng chứng real-device mới cho recipe đó.

## 3. Entry points còn phải bảo toàn khi di chuyển

| Entry/hook/component | Input và đường chạy hiện tại | Boundary cần giữ |
|---|---|---|
| `AICommandPanel.tsx:155` -> `UnifiedAgentPanel.tsx:14` | Default Dashboard; source/device/debugEngine, ANALYZE `:53`, CLARIFY `:61`, REANALYZE `:70`, EXECUTE `:78` | `CommandEngineControl.tsx:6` vẫn có Action Plan/Goal Agent và Auto/V1/V2. Thay engine làm mất plan hiện tại, không tự thực thi. |
| `app/api/unified-agent/route.ts:58` | ANALYZE/CLARIFY/REANALYZE/EXECUTE/CONFIRM/ASSIST/CANCEL; schema `unified-agent/contracts.ts:12` | Backend reference, source/device/physical/backend/runtime digest/policy binding, TTL và single use ở `service.ts:108`, `:134`. Client không thay plan/engine qua execute. |
| Unified -> worker prepare/start | `app/api/unified-agent/route.ts:38`, worker `/planning` (`worker-server.ts:93`), `device-runtime.ts:48` | Prepare không phải effect grant. READ_STATE không phải app handler; prepared worker reference được consume trước START. |
| Unified -> Action Plan adapter | `app/api/unified-agent/route.ts` import interpret/executions POST; `service.ts:152` | Plan coverage được kiểm thêm ở `service.ts:39`. AP vẫn chạy trong request/stream, không ở worker. |
| `/api/commands/interpret` | `route.ts:26`, `{prompt, deviceId?}`; source safety, recipe Wi-Fi/Chrome, còn lại queued Ollama | Backend phát plan authorization; model không phát quyền. |
| `/api/executions` | `route.ts:17` schema actionPlan/deviceId/source/ticket và Wi-Fi confirmation; tuần tự `:116` | Same-origin, validation, ticket nguồn/thiết bị, device lock, Appium ownership; Wi-Fi confirmation riêng. |
| Export `LegacyAICommandPanel` trong `AICommandPanel.tsx:46` | Hook tương thích `useDashboardDemo.ts:132` analyze và `:186` execute; fetch `:142`, `:219` | Không phải default panel, nhưng export/hook/API còn tồn tại. Chưa đủ bằng chứng gọi là dead và xóa. |
| `AgentGoalPanel.tsx:78` | `START` batch jobs `{deviceId,goal,agentVersion?:2,...}` qua `useAgentRuntimes.ts:36` -> `/api/agent/runtime` | Group controls còn được Unified render; không đi qua capability router Unified. Bỏ ba lựa chọn ở một panel không loại hết đường chạy. |
| `/api/agent/runtime/route.ts:18` | RuntimeCommand START/CANCEL/CANCEL_BATCH/ASSIST/ASSIST_V2/SET_OWNER_TEST_MODE; GET trạng thái | Schema runtime và giới hạn jobs/physical device/session. START thiếu version dùng V1. |
| `/api/agent/route.ts:8` | API tương thích single V1 `{goal,deviceId}` -> worker START `:13` | Stream progress/history cũ; không tự trở thành V2 khi bỏ UI V1. |
| `/api/agent/assistance/route.ts:12` | CONFIRM/CANCEL/STOP với token/evidence; chuyển ASSIST/CANCEL `:25` | Token scoped, không phải approval vô điều kiện. |
| Worker CJS root | `worker-client.ts:17` spawn `scripts/agent-worker.cjs`; `worker-server.ts:71` reasoning, `:93` planning, `:116` START | Runtime digest/features guard `worker-client.ts:31`; `device-runtime.ts:254` V2, `:271` V1. Script root không được coi unused vì không có import React. |

Kết nối USB/Wi-Fi, discovery ADB, preview/screenshot và đọc lịch sử là control plane/observation, không phải goal engine riêng. Cần giữ khi bỏ engine selector sau này. Không gọi các route này trong lượt kiểm kê.

## 4. Chỉ mục đường mã và verifier hiện tại

Các đường dưới `lib/android/`, trừ nơi ghi khác. Đây là source hiện có, không phải kế hoạch viết engine mới.

| Mã | Module/function và contract |
|---|---|
| A0 | `app/api/commands/interpret/route.ts:26` -> `app/api/executions/route.ts:116` -> `condition-executor.ts:446` `createExecutionContext`, `ConditionExecutor.execute` `:120`; legacy ADB fallback chỉ có ở backend phù hợp, không nâng SENT thành VERIFIED. |
| A1 | `capabilities.ts` validateAndroidPlan; `condition-executor.ts:221` switch OPEN_APP/WAIT/CLICK/INPUT/PRESS_KEY; observer foreground/postconditions. Alias có giới hạn, exact installed package cần validation. |
| A2 | `condition-executor.ts:248` CLICK -> UIExplorer/discovered selection -> `action-verifier.ts:17` `verifyDiscoveredSelection`; playback `media-playback-verifier.ts:41`. N phải được chứng minh trên chuỗi kết quả ordinary, không đếm ad/Shorts mù. |
| A3 | `capabilities.ts:11` parseChromeRequest, `:34` planChromeCommand -> address bar/query -> `action-verifier.ts:53` browser search -> `browser-destination.ts` URL/title identity, `exploration/ui-explorer.ts:36` organic collection. |
| A4 | `wifi-plan.ts:16` SSID, `:28` navigation, `:47` on, `:54` off -> `wifi-network.ts:23` connectWifiNetwork, `:10` connectedToWifi; Wi-Fi switch/native+OS proof trong `wifi-control.ts`. Password/Connect do người dùng nhập trên máy nếu cần. |
| B0 | `agent/goal-planner.ts:13` clearGoal, `:40` buildGoal, `:84` planGoal -> `agent-loop.ts:97`; observations + rules/model candidate -> `evaluator.ts:16` criterionSatisfied; dùng shared A1/A2/A3 executor. |
| B1 | V1 search/browser/video/nav và recovery: `agent/decision-engine.ts:24`, `agent/action-candidates.ts`, `agent/memory.ts`, `agent/navigation-semantics.ts`, `agent/recovery.ts`; evaluator giữ exact query/ordinal/destination, không phải typed generic record/write engine. |
| C0 | `agent/prepared-v2.ts:17` prepareV2 -> `goal-compiler.ts:36` compileOutcomes -> `agent-v2.ts:311`. `capability-registry.ts:3` LAUNCH/NAVIGATE/SEARCH/CALCULATE/CREATE_RECORD/CAPTURE_MEDIA/SET_STATE/SET_STRUCTURED_STATE/ALARM/TIMER/FIND_ARTIFACT/INTENT; UNKNOWN không executable. |
| C1 | `agent/search-executor.ts:19` runGenericSearch -> `verification-registry.ts:19` verifySearchOutcome: field, exact committed query và fresh result/NO_RESULTS surface. `agent-v2.ts:407` gọi runner, không mở kết quả. |
| C2 | `agent/intent-capabilities.ts:101` proposeIntentOutcomes, `:34` matchReadStateSource; `intent-executor.ts:19` resolveIntent, `:47` verifyIntentScreen, `:93` executeIntentCapability. READ_STATE `:59`/`:66` hai đường đọc độc lập; activity/URL/dial readback cho các intent khác. |
| C3 | `agent/setting-mutations.ts:17` statePair, `:28` verifySettingPair, `:48` settingCommand, controller `:57`: pre-state, journal UNKNOWN trước dispatch, independent post-state, captured inverse/restoration. Network mutations yêu cầu USB `:98`. |
| C4 | `agent/record-forms.ts:11`, `record-persistence.ts:9` registry STABLE_DRAFT_ID/POST_SAVE_ID/EXACT_FIELDS_CREATED_AT; `:35` beginRecordDraft, `:90` verifyPersistenceReadback -> `persisted-record.ts:15` runPersistedRecord -> `verification-registry.ts:37`. Không title/latest-only; cần exact fields, disambiguation và reopen. |
| C5 | `agent/grounded-candidates-v2.ts:93` camera target; `application-discovery.ts:26` installed intent discovery; `media-evidence.ts` MediaStore baseline/delta -> `verification-registry.ts:52` verifyCapturedMedia. `camera-fallback.ts` chỉ retry NOT_SENT hợp lệ bằng grant mới, không UNKNOWN replay. |
| C6 | `agent/temporal-contract.ts:13` parseTemporal -> `temporal-executor.ts:30` provider path -> `temporal-evidence.ts:82` persisted readback. UI fallback trước effect khi provider unavailable: `temporal-ui-runner.ts:19`, `temporal-ui.ts:110` format evidence, `:237` verifyTemporalUi, `:216` runningTimer. ALARM đúng giờ/enabled/new row; TIMER RUNNING và giảm thực sự qua hai fresh reads. |
| C7 | `agent/artifact-store.ts` exact produced URI và consumer/TTL binding -> `media-view.ts` -> `verification-registry.ts:29` verifyMediaView. EXACT_URI_VIEW không phải GALLERY_UI_FIND. |
| C8 | `agent/grounded-candidates-v2.ts`, `candidate-verifier.ts`, `verification-registry.ts:67` verifyPredicate; CALCULATE có UI exact numeric result và journal, không giả định mọi calculator layout đều hỗ trợ. |
| S0 | `safety-envelope.ts:17` assertSafeSource; `agent/permission-decision.ts:28` ALLOW/ASK/DENY; `effect-grants.ts:39` issue / `:79` consume; owner identity/scope `owner-test-policy.ts:27`; device/session locks và cancellation dùng chung. |

`capabilityRegistry.executable: true` chỉ nói có implementation cho contract. App/UI cụ thể vẫn có thể thiếu candidate hoặc proof. `primitive-decomposition.ts:17` SET_VALUE, SELECT_ITEM, READ_VALUE, CONFIRM generic còn `implemented:false`; không lấy typed READ_STATE hoặc temporal picker làm bằng chứng thao tác tùy ý mọi widget.

## 5. Chỉ mục test liên quan

Test source đã được khảo sát, không chạy lại ở Giai đoạn 0. Số PASS dưới đây là từ `coverage/temporal-boundary-fix-cjM6GS/validated/regression.json`; những file FAIL được tách rõ ở mục 10. Khi port phải chạy lại characterization trên snapshot mới, không dùng bảng này thay baseline mới.

| Mã | Test files dưới `tests/` | Bảo vệ thực sự |
|---|---|---|
| T1 | `android-executor.test.cjs` 15; `state-observer.test.cjs` 33; `milestone25-resolution.test.cjs` 27; `state-aware-navigation.test.cjs` 21 | Dispatch, foreground/observation, activation/freshness; không chứng minh mọi app thật. |
| T2 | `agent.test.cjs` 23; `agent-reasoning.test.cjs` 12; `autonomous-task.test.cjs` 8; `action-candidates.test.cjs` 11; `dynamic-recovery.test.cjs` 15 | V1 planning/criteria, bounded next-action/recovery, source coverage. |
| T3 | `chrome-command-planning.test.cjs` 7 (`:25`, `:37`, `:70`); `browser-organic-results.test.cjs` 4; `browser-title-evidence.test.cjs` 4 | Address bar, giữ ordinal, ad/product filtering, URL/title proof. |
| T4 | `ui-exploration.test.cjs` 54; `media-playback-verifier.test.cjs` 8; `media-playback-postcondition.test.cjs` 9 | Continuity/ordinal identity, PLAYING/progress, reset khi đổi selected identity; không phải E2E video thứ N PASS. |
| T5 | `wifi-control.test.cjs` 10 (`:65` desired-state no blind toggle); `wifi-network.test.cjs` 6 (`:65` exact SSID + human credentials); `wifi-confirmation-route.test.cjs` 4 | Wi-Fi navigation/on/off/connect, unique target, exact case-sensitive SSID, confirmation expiry/device/plan/single use. |
| T6 | `general-agent-v2-contracts.test.cjs` 6; `general-agent-v2-runtime.test.cjs` 15; `general-agent-v2-widgets.test.cjs` 11; `general-agent-v2-m2b.test.cjs` 4 | Typed graphs/candidates, graph coverage, widgets/calculation/verification. |
| T7 | `general-agent-v2-search.test.cjs` 7; `general-agent-v2-search-reliability.test.cjs` 8; `general-agent-v2-m3c.test.cjs` 10; `general-agent-v2-m3d.test.cjs` 20 | Fresh query provenance, repeat search, occlusion, unsupported surface/no false completion. |
| T8 | `general-agent-v2-m4b.test.cjs` 28; `read-state-semantics.test.cjs` 60; `read-state-execution.test.cjs` 25; `read-state-session-binding.test.cjs` 20 | Typed reads/intents, độc lập hai read paths, same owned Session, cancel/expiry/mismatch; không biến read thành write/navigation. |
| T9 | `general-agent-v2-m4d.test.cjs` 45; `owner-authorized-test-mode.test.cjs` 9 PASS/1 FAIL | Journaled setting mutation, captured inverse, unknown-effect/manual-required, ordinary/full owner isolation. Không coi file có 1 FAIL là toàn PASS. |
| T10 | `general-agent-v2-persisted.test.cjs` 18, nhất là `:99`, `:114`, `:129`, `:204`, `:233`, `:251`, `:288` | 3 record identity strategies, Save một lần, reopen, old structured 24h alarm form, exact-URI handoff. Fixtures không phải Samsung Notes/Clock thật. |
| T11 | `agent-v2-m6a.test.cjs` 34 | Camera +1 MediaStore, preview/shutter grounding, full-control permission, NOT_SENT/UNKNOWN, không duplicate photo. |
| T12 | `agent-v2-m6b.test.cjs` 58; `agent-v2-m6c.test.cjs` 43 | VI/EN ALARM/TIMER/AMPM, invalid/ambiguous, provider and UI evidence, enabled, decreasing timer, duplicate/unknown no replay. |
| T13 | `temporal-m7a-fixes.test.cjs` 16; `temporal-m7a-scroll-grounding.test.cjs` 23; `temporal-m7a-editor-protocol.test.cjs` 37; `temporal-command-boundary.test.cjs` 13; `launcher-localized-labels.test.cjs` 7 | Inventory bounds/tab continuity, editor focus/Done, clause giữ đúng ALARM, generic localized discovery/cache version. |
| T14 | `unified-agent-m7a.test.cjs` 49 PASS/1 FAIL; `unified-agent-m7a-fixes.test.cjs` 21; `unified-engine-coverage.test.cjs` 11; `command-engine-controls.test.cjs` 12 | Routing/binding/replay/TTL/cancel/API, preflight clarification, forced V2 ordinal ASK trước prepare, mixed destructive DENY, selection invalidates plan. |
| T15 | `development-policy.test.cjs` 4; `general-agent-v2-m5b-security.test.cjs` 19 PASS/1 FAIL; `multi-device-runtime.test.cjs` 19 PASS/2 FAIL; `visual-grounding.test.cjs` 16 | Policy/source isolation, worker ownership/approval, device concurrency, human grounding; mock loopback failures còn tồn tại. |

## 6. Chỉ mục evidence lịch sử

Chỉ đọc báo cáo và artifact tổng hợp được dẫn, không mở cohort/fixture bị cấm. Evidence TEMP được báo cáo cũ dẫn không mặc nhiên còn tồn tại; ở đây không xác minh lại mọi raw screenshot. Tier `R` là **reported historical real-device verification**, không phải chứng nhận lại trên working tree hôm nay.

| Mã | Nguồn | Kết quả dùng cho kiểm kê |
|---|---|---|
| E1 | `docs/agent-v2-m5c-report.md` | V2 search-only Drive/YouTube cold/warm 4/4 COMPLETED, 0 model calls; không mở result, 0 false completion trên 4 claimed completions. |
| E2 | `docs/agent-v2-m6a-report.md` | Camera V2 `d8c27952-c85a-424e-b9e9-f710011444f1`, MediaStore 590 -> 591, URI id 2264; 0 model, không xóa ảnh. |
| E3 | `docs/agent-v2-m6b-report.md` | Alarm 07:00 và timer 600s BLOCKED TEMPORAL_PROVIDER_UNAVAILABLE, READ_ALARM/WRITE_ALARM SecurityException; không creation. |
| E4 | `docs/agent-v2-m6c-report.md` | UI fallback implementation/offline tests; real survey 42 RPC/37 ADB, 3 existing alarm rows; không Save/Start, creation UNVERIFIED. |
| E5 | `docs/unified-agent-m7a-acceptance-report.md`, 22/10 | Browser Unified -> USB Samsung; 12 requests, 5 dispatched: 1 COMPLETED camera, 3 BLOCKED (alarm/timer/V1 ordinal), 1 CANCELLED. Hai destructive/mixed DENY đúng, zero effect. Search plans khác NOT_EXECUTED do TTL; không gộp thành search thất bại. |
| E6 | `docs/unified-agent-m7a-fix-report.md`, 23/10 | Read-state/clarification/TTL/playback/temporal fixes; alarm inventory thật đọc được sau scroll fix; không xác minh tạo alarm mới hoặc chạy lại unknown timer. Browser reacceptance cho các fix còn UNVERIFIED. |
| E7 | `docs/alarm-command-localized-discovery-fix.md` + `coverage/temporal-boundary-fix-cjM6GS/validated/` | Clause `cài báo thức`, localized launcher labels/cache v2; REAL_API_ANALYZE 200, không execution. 20 tests mới PASS; regression 1143/1170. |
| E8 | `docs/agent-v2-m4b-report.md` | V2 typed app/Settings/dial prefill/battery/Wi-Fi/brightness reads có native/independent evidence; URL attempt FAILED rồi BLOCKED ambiguity; media/ring reads BLOCKED, SMS unsupported/blocked. |
| E9 | `docs/agent-v2-m4d-report.md` | V2 Wi-Fi/brightness/DND mutations readback và exact inverse restoration thật. Bluetooth failed/unacknowledged; rotation/volume/flashlight/airplane thiếu command/evidence. Không được bật Bluetooth để thử thêm trong audit này. |
| E10 | `docs/autonomous-task-completion-report.md` | V1 Chrome tìm/mở bài phù hợp 3/3 criteria COMPLETED; Settings storage 2/2. YouTube video thứ hai BLOCKED 2/3 criteria. Không phải Action Plan E2E proof. |
| E11 | `docs/agent-v2-m3d-report.md` | V2 My Files search NO_RESULTS và known-file result verified; repeat có cả grant-expired BLOCKED. Maps/Play/Photos/Cốc Cốc còn BLOCKED vì target/evidence/overlay/permission. |
| E12 | `docs/general-purpose-agent-v2-next-implementation-report.md` | Calculator 125 x 48 = 6000 real verified; record/structured form/exact-URI chủ yếu offline. |
| E13 | `docs/agent-v2-real-generalization-acceptance.md` | Clock LAUNCH + NAVIGATE World Clock real verified; Notes không cài ở thời điểm khảo sát, Gallery thiếu thumbnail-to-URI proof; không nghiệm thu generic record create. |
| E14 | `docs/youtube-ad-search-report.md` | Shared discovery tìm được video ordinary đầu tiên sau ads; **không click/playback**. Ordinal sâu hơn BLOCKED continuity. |
| E15 | `docs/safe-refactoring-report.md`; `docs/unified-agent-m7a-report.md`; `docs/unified-agent-architecture-audit.md` | Refactor exact helpers/dead UI, các checkpoint tests/build; facade chưa merge loops. Audit cũ không thay thế source mới. |

## 7. Độ trễ và số lần gọi model: chỉ những gì đã đo

Đơn vị giây, trừ khi ghi khác. Analyze, setup, observation, execution, verification có thể chồng nhau; **không cộng các span thành tổng mới**. Không so engine nhanh/chậm khi khác task/source/cache/UI. `m` là số model calls được report, không phải số API Android. Không đo mới ở Giai đoạn 0.

| Mã | Engine/task, evidence | Tổng/analyze/setup và RPC/ADB | Model / giới hạn |
|---|---|---|---|
| L0 | Capability chưa có run đúng engine/outcome | Thời gian/RPC/ADB `?` | `m=?`; rule recipe có thể 0 calls nhưng không gán số cho run chưa tồn tại. |
| L1 | V2 Drive cold/warm, E1 | Tổng 92.208 / 27.982; planning 61.580 / 1.999; setup 7.320 / 6.891; RPC/ADB 114/143 và 95/69 | `m=0` cả hai; cold discovery/cache cost lớn, không phải inference chậm. |
| L2 | V2 YouTube search cold/warm, E1 | Tổng 95.801 / 36.794; planning 62.017 / 2.446; setup 5.822 / 9.359; RPC/ADB 96/134 và 95/69 | `m=0`; search-only, không ordinal/playback. |
| L3 | V2 camera, E2; browser M7a E5 | E2 total 45.509, planning 7.331, setup 7.822, RPC/ADB 67/82. E5 analyze 0.955, execute 47.447; analyze 0/4, execute 67/82 | `m=0`. E5 MediaStore 591 -> 592, id 2266; 1/1 claimed completion không false completion. |
| L4 | V2 native alarm / timer, E3 | Total 15.818 / 10.805; setup 5.675 / 5.614; RPC/ADB 12/36 và 12/32 | `m=0`; cả hai BLOCKED trước write. |
| L5 | V2 UI alarm / timer, E5 | Analyze 0.329 / 0.531; execute 38.767 / 53.061; execution RPC/ADB 79/98 và 188/140 | `m=0`; alarm UI_LIST_CONTINUITY_UNPROVEN, timer UI_TIMER_RUNNING_DECREASE_UNVERIFIED. Timer có 1 commit/UNKNOWN, không được lặp như chưa chạy. |
| L6 | V1 YouTube ordinal, E5 | Analyze 0.233; execute 161.129; postcondition timeout 108.946; V1 RPC/ADB `?` | Report ghi 0 recorded model calls; không biến placeholder RPC/ADB 0 thành số đo đáng tin cậy. BLOCKED 2/3. |
| L7 | V1 Chrome bài phù hợp, E10 | 69.1 total; observation 43.6; 6 steps, 36 snapshots, 1 scroll; RPC/ADB `?` | `m=0`; request/criterion cụ thể, không chứng minh mọi article ordinal. |
| L8 | V2 typed My Files / dial / Settings / Wi-Fi / battery, E8 | Total 10.729 / 11.546 / 10.962 / 9.090 / 10.902; RPC/ADB lần lượt 12/28, 12/28, 12/28, 6/25, 6/25 | `m=0`, grammar hữu hạn; brightness run 9.319s có paired proof nhưng RPC/ADB `?`. |
| L9 | V2 Wi-Fi / brightness / DND set+restore, E9 | Total 18.433 / 17.077 / 17.242; RPC/ADB 26/86, 25/80, 25/79 | `m=0`; captured baseline tương ứng 1, 140, 1, không dùng preview cũ thay baseline. |
| L10 | V2 My Files / Maps / Play / Photos / Cốc Cốc, E11 | Known-file 33.702, 101/69. BLOCKED Maps 39.133 (55/51), Play 68.946 (161/113), Photos 22.780 (60/51), Cốc Cốc 23.652 (30/35) | Optimized runs ghi `m=0`; một số baseline trước có 2 local model calls, không trộn hai checkpoint. |
| L11 | V2 calculator, E12 | Total 39.163; setup 5.940, observation 26.703, execution 17.937, verification 0.079; RPC/ADB `?` | `m=0`; spans overlap. |
| L12 | V2 localized alarm API analyze, E7 | Analyze 61.757, 65 ADB/0 Appium; không execute | `m=0`; handler/labels được tìm đúng không chứng minh đã lưu alarm. |
| L13 | V2 search stop, E5 | Analyze 16.984, execute 11.428; execution RPC/ADB 8/21; khoảng 1.391 từ click Dừng tới cancel | `m=0`; Session đóng, ownership released. Không dùng execute total làm cancel latency. |
| L14 | Alarm inventory probe sau fix, E6 | Total 50.484; 98 RPC/97 ADB; 12 snapshots, 2 scrolls | `m=0`; setupMs=0 trong probe không được instrument riêng, không có nghĩa setup miễn phí. Không Save. |

Model call paths hiện có, không thay đổi cấu hình trong lượt này:

- AP Wi-Fi/Chrome recipe chạy rule trước (`interpret/route.ts:51`, `:57`); nhánh không recipe gọi `queuedOllamaFetch` `:69` -> worker `/reasoning` -> Ollama `/api/chat`. Không qua Groq router V2.
- V1 clearGoal/ruleDecision có thể xử lý không model; `planGoal` và `AgentDecisionEngine` fallback `OllamaAgentReasoner` khi cần. Không mặc nhiên qua `reasoning-provider.ts`.
- V2 `prepared-v2.ts:18` và candidate choice dùng `createStructuredReasoner` (`reasoning-provider.ts:65`), mặc định Ollama; opt-in GroqLocalRouter có local fallback, chỉ đề xuất IDs/schema được backend cho phép. Singleton compatible candidate có thể bỏ qua model (`compatible-choice.ts:50`).
- Không đọc key/env hoặc gọi provider để kiểm chứng live. `groq-router.test.cjs` là mock transport, không chứng minh Groq API thực sự gọi thành công. Những thành công `m=0` không phải chứng cứ khả năng LLM tự suy luận app mới.

## 8. Ma trận capability x engine

Mỗi ô gồm mức hỗ trợ hiện có, đường source/test, tier kết quả và metric. Tier hoàn thành luôn gắn đúng outcome, không lấy opening app/discovery làm creation/playback. Các hàng `MISSING` không có test hoàn thành dương cho engine đó; test source safety/router vẫn có thể bảo vệ việc từ chối.

| Capability/câu lệnh đại diện | Action Plan | Goal Agent V1 | Goal Agent V2 / Hybrid Tool-First |
|---|---|---|---|
| Mở app đã cài, exact package/label | Có giới hạn alias/package, A0/A1, T1; O, AP-specific real U, L0 | Có discovery + goal, B0/A1, T1/T2; R trong Chrome/Settings E10, latency cold launch riêng U | Có typed intent/LAUNCH + discovery, C0/C2, T6/T8; R My Files/Settings E8, L8. Label mơ hồ ASK; localized discovery fix E7 O, analyze-only L12. |
| Điều hướng native tab/page đã quan sát | A1 WAIT/CLICK target có resolver, T1; O, U outcome tùy page, L0 | B0/B1 + navigation memory/evaluator, T2; R Settings storage E10 (28.8s, m=0), không navigation tùy ý | C0/C8 affordance + predicate, T6/T10; R Clock -> World Clock E13, L0 (m/RPC tổng U). Missing semantic/target -> BLOCKED. |
| Tìm trong app (Drive/My Files/YouTube), không mở result | AP có targets search hẹp A1/A3; không generic app discovery-search contract. O T1/T3, R riêng AP U, L0 | B0/B1, Chrome/YouTube search workflows; T2/T3; search là phần của E10, Drive/My Files generic MISSING/U, L0 | C1, T7; R E1/E11, L1/L2/L10. Maps/Play/Photos/Cốc Cốc **BLOCKED** ở checkpoint E11; không tuyên bố universal search. |
| YouTube chọn/phát video thứ N | Có A2 target/continuity/MediaSession, T4; O; E14 chỉ R discovery video đầu, playback U, L0 | B0/B1 + A2, T2/T4; O; actual **BLOCKED** 2/3 E10/E5, L6. Postcondition fix E6 chưa reaccept E2E | **MISSING** OPEN_RESULT verified contract; T14 forced V2 ASK trước prepare, U, L0. Không tự chuyển V1. |
| Chrome/Google tìm query | Recipe A3 bảo đảm address bar trước input, T3; O, AP-specific R U, L0 | B0/A3, T2/T3; R trong task E10, L7 | C1 có thể search khi field/surface chứng minh được; T7; O, R Chrome-specific U, L0. Không thay ordinal engine chỉ bằng nhập query. |
| Chrome/Google mở bài viết thứ N, bỏ ad/product | A3 + A2/browser destination, T3/T4; O; không có AP E2E cùng outcome R trong bộ evidence đã đọc, L0 | B0/A3/evaluator, T2/T3/T4; O; R E10 chỉ **bài phù hợp đầu tiên**, L7. Chọn bài thứ 2/N trên current UI U | **MISSING** generic ordinal destination contract; T14 early ASK nếu OPEN_RESULT, U, L0 |
| Mở Wi-Fi settings | A4 navigation-only, T5; O; AP-specific real U, L0 | Có mở Settings/FIND_PAGE theo B0/B1, T2; O, exact Wi-Fi page real U, L0 | C2 OPEN_SETTINGS (đúng action) hoặc C0 navigation; T8; O, exact Wi-Fi page real U. Không suy từ Wi-Fi state read ra đã mở page |
| Kết nối Wi-Fi theo SSID | A4, T5; O, exact SSID OS COMPLETED verifier; R chưa tìm được cho workflow goal trong báo cáo đã đọc, U/L0. Chờ credentials trên phone nếu cần | **MISSING** source-bound SSID connect goal; shared executor tồn tại không làm V1 planner có contract. T2 coverage guard, U/L0 | **MISSING** SSID join contract; C3 chỉ enabled-state toggle, không chọn network/password. T8/T9 không chứng minh join, U/L0 |
| Bật/tắt Wi-Fi desired state | A4, T5; O, native switch + OS verification; không inverse journal M4d. AP real U/L0 | MISSING mutation goal trong V1; T2 policy/coverage, U/L0 | C2/C3 SET_DEVICE_STATE, T9; R Wi-Fi set/read/restore E9, L9. C0 generic SET_STATE là contract khác, không được coi mọi toggle có inverse journal |
| Đọc pin | AP không có typed value result; A1 mở Settings không tương đương. MISSING, T1 không bảo vệ paired read, U/L0 | Legacy criteria đọc page không phải typed battery evidence; MISSING, T2, U/L0 | C2 READ_STATE, T8; R canonical E8, L8. Natural phrasing binding fix E6/E7 O; M7a cũ ASK phải giữ lịch sử, reaccept current natural phrasing U |
| Đọc Wi-Fi bật/tắt | MISSING typed read outcome; A4 proof khi toggle không phải API read task. T5, U/L0 | MISSING typed read outcome, B0/T2, U/L0 | C2 READ_STATE, T8; R canonical E8 L8; bug M7a SET_STATE/app binding đã fix offline E6, natural reaccept U |
| Đọc độ sáng | MISSING typed contract; T1, U/L0 | MISSING typed contract; T2, U/L0 | C2, T8; R E8 paired value 64 vs display fraction, L8; không phải mọi Android đọc được cùng dumpsys |
| Đổi setting + journal + khôi phục chính xác | AP Wi-Fi có desired-state proof nhưng **MISSING inverse journal contract**; T5, O phần toggle, full contract U/L0 | **MISSING** journaled setting mutation; B0 policy, T2/T15, U/L0 | C3, T9; R Wi-Fi/brightness/DND E9 L9. Bluetooth failed/unacknowledged; rotation blocked, media/ring/flashlight/airplane chưa đủ dispatch/verifier. Không gán R cho cả enum |
| Ghi chú/tạo record mới | MISSING persistence contract; generic CLICK/INPUT không đủ; T1/T15, U/L0 | MISSING record identity/reopen goal; B0/T2, U/L0 | C4, T10; O trên varied fixture apps/fields, R U (Notes không có khi E13). Exact field + creation-time strategy cần complete baseline; thiếu identity -> SAFE_BLOCKED, L0 |
| Chụp đúng 1 ảnh mới | MISSING MediaStore +1 goal/effect contract; T1/T15, U/L0 | MISSING capture outcome/effect contract; T2/T15, U/L0 | C5, T11; R E2/E5, L3. Owner/full-control không bỏ grounding/journal/unknown rules; không tự xóa ảnh sau test |
| ALARM theo giờ, AM/PM + enabled + persisted | MISSING typed time/persistence; T1/T15, U/L0 | MISSING ALARM contract; T2/T15, U/L0 | C6, T12/T13; O. Actual E3 BLOCKED provider, E5 BLOCKED list continuity L4/L5. E6 R inventory read-only L14, E7 analyze-only L12; **creation current source U** |
| ALARM 3:30 thiếu sáng/chiều | Không typed clarification; U/L0, T14 façade có thể route sang C6 chứ không phải AP capability | Không typed clarification; U/L0, T14 | C6 + `unified-agent/clarification.ts:4`, `service.ts:71`; T12/T14 O. M7a yêu cầu hỏi đã nhận nhưng UI chưa cho trả lời; E6 fix offline. Current browser response->new plan U, zero effect trước rõ giờ |
| TIMER duration + Start + RUNNING giảm thật | MISSING typed duration/runtime proof; T1/T15, U/L0 | MISSING TIMER contract; T2/T15, U/L0 | C6, T12/T13; O. E3 provider BLOCKED, E5 UI_RUNNING decrease BLOCKED, L4/L5; editor focus fix E6 chưa Start lại, **R U**, không replay effect cũ |
| Legacy SET_STRUCTURED_STATE 24h alarm form | MISSING identity-bound form persistence, T1, U/L0 | MISSING, T2, U/L0 | C4 (khác native ALARM C6), T10 `:233`; O fixture 24h fields/enabled/reopen, R U/L0. Không lấy nó thay AM/PM evidence của form thật |
| Điền số vào dialer, không gọi | MISSING exact-number DIAL contract; T1/T15, U/L0 | MISSING typed dial prefill; T2/T15, U/L0 | C2 OPEN_DIALER/Android DIAL, T8; R E8 5550100 native number + resumed activity/manual screenshot, L8; không CALL |
| Mở link HTTP(S) / bản đồ | A3 browser query/navigation không phải generic exact-URL contract; O phần browser T3, R URL/map U/L0 | B0 FIND_PLACE là tìm nơi xem thông tin trong Settings, không phải Maps contract. T2/T3 O phần navigation/browser; arbitrary URL/Maps MISSING/U/L0, Chrome article URL E10 không chứng minh arbitrary maps | C2 OPEN_URL T8 O; E8 initial **FAILED**, rerun **BLOCKED** default handler ambiguity, R U/L0. Native Maps search E11 BLOCKED L10; geo URI ngoài HTTP(S) contract |
| Mở trang Android Settings | A1/A4, T1/T5; O, R riêng AP U/L0 | B0/B1, T2; R Settings storage navigation E10, không typed arbitrary Settings action | C2 OPEN_SETTINGS, T8; R canonical android.settings.SETTINGS E8 L8; screen verification không có nghĩa đã đổi setting |
| Tính toán exact result | MISSING numeric result contract; T1, U/L0 | MISSING general CALCULATE contract; T2, U/L0 | C8, T6/T11; R 125 x 48 E12, L11; locale numeric verifier/grounded buttons, không calculator tùy ý |
| Mở đúng artifact qua viewer / tìm trong Gallery | MISSING exact artifact identity contract; T1, U/L0 | MISSING exact artifact identity contract; T2, U/L0 | C7/T10 O EXACT_URI_VIEW + ARTIFACT_IDENTITY_VERIFIED; R U do artifact grant hết hạn E13. **GALLERY_UI_FIND MISSING**, không báo hoàn thành search chỉ vì mở content URI |
| Từ chối xóa/gỡ/reset/ghi đè; câu trộn photo+delete | S0 + source/plan guards A0, T15/T14 O; AP-specific real U/L0 | S0 + policyForAgentAction B0, T2/T15 O; V1-specific real U/L0 | S0 + M6a permission/journal, T9/T11/T15 O. **R Unified 2/2 DENY E5 trước chọn/dispatch engine**, zero effect; không tính như 3 execution riêng |
| Stop/cancel, release Session/ownership | A0 request abort/finally + Unified cancel, T14 O; R riêng AP U/L0 | B0 signal/finally + worker cancel, T2/T15 O; E10 có cancel, latency release chi tiết U | C0 worker cancel+settlement, T14/T15 O; R Unified V2 search E5, L13. UNKNOWN effect không biến thành NOT_SENT khi cancel |
| Human assistance, pre-execution clarify | AP Wi-Fi confirmation riêng A4/T5 O; không V2-style candidate assistance; R U/L0 | B0 evidence/token visual assistance, T15 O; same-Session real resume U E10 | C0 ASSIST_V2 + Unified preflight clarify/TTL, T14 O. E5/E6 same-Session resume/browser fix U; pre-execution AM/PM clarification chưa có Session nên không thể tính là resumed same Session |

### Hệ quả của ma trận, chưa phải quyết định chọn nguồn

- Không engine nào có bằng chứng hoàn thành tốt **mọi** capability được yêu cầu. V2 có typed reads/writes và độc lập evidence rộng nhất ở source, nhưng thiếu ordinal/SSID và nhiều UI thật vẫn BLOCKED; chưa được tuyên bố là superset.
- AP/V1 có logic organic ordinal, Chrome destination và SSID mà xóa engine entry trước khi port sẽ làm mất. Cũng không được đưa tính năng ordinal chưa E2E verified vào demo với nhãn thành công.
- Camera/typed reads/journaled setting readback có positive real evidence; alarm/timer **không có creation/running positive acceptance tương ứng trên current source** trong tài liệu đã đọc. Quyền đầy đủ không chữa được proof/field/continuity thiếu.
- Các primitive generic chưa implemented không thể được "hợp nhất" bằng gọi tên chung. Cần characterization của source behavior trước chuyển từng capability ở Giai đoạn 2-3.

## 9. Phần dùng chung và riêng từng engine

| Phân loại hiện tại | File/trách nhiệm | Consumer/bằng chứng và lưu ý bảo toàn |
|---|---|---|
| Shared execution substrate | `condition-executor.ts`, `executor.ts`, `adb.ts`, Appium session manager, locks, `state-observer.ts` | AP createExecutionContext; V1 createAgentExecution (`agent-loop.ts:325`); V2 androidV2Adapter (`agent-v2.ts:92`). ConditionExecutor còn gọi intent/temporal V2 bridges; dependency đi hai chiều theo trách nhiệm, không phải toàn bộ thư mục cha là legacy. |
| Shared grounding/media/browser | `grounded-interactions.ts`, `activation-point.ts`, `interaction-target-resolver.ts`, exploration, `action-verifier.ts`, browser navigation/destination, media playback verifier | AP/V1 dùng selection/postconditions; V2 dùng grounded V2 interactions và một số observer helpers. Trùng cấu trúc chưa đồng nghĩa trùng evidence contract. |
| Shared policy/physical lifecycle | `safety-envelope.ts`, device selection/identity, device lock, Session ownership, cancellation, `agent/permission-decision.ts`, owner/grant/journal modules | Nhiều lớp kiểm tra khác trust boundary, không xóa như duplicate validation. Giữ revalidation ngay trước effect và backend-issued IDs/grants. |
| AP-specific orchestration | interpret/executions routes, `action-plan-authorization.ts`, Wi-Fi plan/confirmation, Chrome recipe, `useDashboardDemo.ts`, LegacyAICommandPanel export | API và recipe còn reachable, kể cả ngoài Unified. Wi-Fi helper có thể là shared capability cần giữ, không kết luận archive chỉ vì xuất phát từ AP. |
| V1-specific orchestration/goal semantics | `agent-loop.ts`, `goal-planner.ts`, `decision-engine.ts`, `evaluator.ts`, goal/criteria/memory/recovery modules | V1 typed goals/criteria không cùng schema với OutcomeV2. Shared action candidate/discovery có consumer khác; phải kiểm import/dynamic script lần nữa trước archive. |
| V2-specific typed capability orchestration | `agent-v2.ts`, prepared/compile/outcome contracts, candidate/effect grants, capability/verification registries, search, intent/record/temporal/media/artifact runners | Có generic abstraction nhưng cũng có capability-specific adapters. C0 giữ graph integrity, runner mới không được tự tạo parallel engine/fallback engine. |
| Facade/router hiện tại | `lib/android/unified-agent/*`, unified route/panel/engine controls | Một cửa vào trên UI, còn Engine enum và branch dispatch. Giai đoạn 4 sau parity mới đổi router từ engine sang capability và loại lựa chọn engine; chưa làm bây giờ. |
| Worker/control plane | `device-runtime.ts`, worker-server/client, `scripts/agent-worker.cjs`, connection/preview/history APIs | V1/V2 cùng worker; AP request stream riêng. Group START vẫn là entry. Không bỏ runtime script chỉ vì import graph frontend không tới. |

### Quyền hiện tại không đồng nhất chỉ bằng bật owner

AP có source-plan ticket và Wi-Fi confirmation/dev policy riêng. V1 dùng `policyForAgentAction` (`agent-loop.ts:42`), không có V2 local-write journal contract. V2 dùng M6a decision + single-use grants/journals; owner mode không làm model được tự chọn shell/action ngoài catalog.

`permission-decision.ts:28`: source destructive luôn DENY; normal mode có ASK interpretation/effect theo scope; ordinary owner cho local non-destructive effects được hỗ trợ; full-control còn cần journal authorization (`:22`, `:51`). Interpretation auto-review chỉ ALLOW khi full-control `autoReview` opt-in **và** source-exact (`:47`); owner enable chụp flag backend ở `owner-test-policy.ts:48`, không phải client tự cấp. Không gộp các helper auto-review cũ thành blanket approval dựa trên tên mode.

`local-effect-journal.ts` cho dữ liệu mới không phải lệnh undo/xóa artifact. `setting-mutations.ts` mới có inverse restoration với pre-state đã đo. Không dùng "có journal" để hứa tự dọn ảnh/alarm/notes. Không restore setting bằng giá trị hardcode. Sau UNKNOWN effect chỉ verify/reconcile theo contract, không fallback engine hay retry sáng tạo.

AP prompt còn câu hướng dẫn bỏ phần ngoài danh mục ở `app/api/commands/interpret/route.ts`; direct legacy route kiểm schema/capability, không chứng minh mọi requested outcome đã được giữ. Unified thêm `checkLegacyCoverage` (`service.ts:39`). Đây là semantic debt phải có characterization khi chọn nguồn; không sao chép instruction bỏ outcome sang engine duy nhất.

## 10. Baseline thực tế và giới hạn validation

Không thực thi test nào trong Giai đoạn 0. Chỉ đọc kết quả đã có, không gọi chúng là baseline mới hay chứng minh current source toàn PASS.

| Checkpoint lịch sử | Regression/validation được ghi nhận |
|---|---|
| M5c -> M6a -> M6b -> M6c -> M7a | 707 -> 745 -> 803 -> 846 -> 896 tests PASS tại các phiên bản tương ứng; không so count thành tiến bộ real autonomy. |
| M7a Fix | 1107/1107 ở lượt full run ghi trong E6; report còn ghi bổ sung tests sau mốc đó. Không phải tổng hiện tại. |
| Safe Refactoring E15 | Baseline 1097 PASS/27 FAIL/1124; final 1123 PASS/27 FAIL/1150, 26 tests mới PASS, existing failure names giữ nguyên. Full ESLint exit 0, 0 errors/3 warnings; webpack PASS 109.44s. |
| Latest localized alarm fix E7 | 64 file, **1143 PASS / 27 FAIL / 1170 tổng**, existingTestChanges=[]; typecheck/scoped lint/diff check PASS. Không full lint/build lại sau narrow fix. |

Evidence mới nhất đọc trực tiếp: `coverage/temporal-boundary-fix-cjM6GS/validated/regression.json`, `validation.json`. Phạm vi này loại 6 tests trong `general-agent-v2-open-world.test.cjs` do import fixture có tên holdout; **không phải full suite không ngoại lệ**. Giai đoạn 0 không mở test/fixture đó. Các artifact trong coverage có thể ignored/local-only, không thay cho evidence versioned khi chia sẻ report.

| Nhóm failure giữ nguyên lịch sử | Số | Triệu chứng, chưa khẳng định root OS cause ngoài môi trường này |
|---|---:|---|
| catalog cache / discovery-execution / wireless-connectivity | 8 + 1 + 1 = 10 | Atomic TEMP rename EPERM |
| m5b-security / multi-device-runtime / owner-mode / unified-m7a | 1 + 2 + 1 + 1 = 5 | Mock loopback HTTP fetch failed |
| groq-router | 12 | Mock transport failure/fallback/ABSTAIN khác expected response; không phải 12 real Groq API failures |
| Tổng | **27** | Phải tái lập/phân loại ở baseline Giai đoạn 2, không sửa test cũ hoặc bỏ failure để đạt số đẹp |

Full ESLint lỗi cũ `no-explicit-any` ở ExecutionDetailModal đã không còn ở lần Safe Refactoring full lint vì dead component đã bị xóa có kiểm chứng; còn 3 warnings unused imports. Không ghi lỗi cũ đó là lỗi current đã tái hiện. Build EPERM `.next/server/app/api/devices` của M7a Fix không tái hiện ở Safe Refactoring webpack run; warning createRequire vẫn có. Cả hai đều chưa chạy lại trong lượt này. Không có baseline browser/Android mới cho current dirty tree.

Lần kiểm hash read-only ở Giai đoạn 0: 298 file `.ts/.tsx/.cjs/.mjs/.js` trong app/lib/components/hooks/types/scripts/tests, bỏ symlink và mọi path có sealed/holdout trước khi đọc nội dung. SHA-256 danh sách path+hash sorted (không phải thuật toán worker runtime digest):

```text
15fcc66b559657bca042a70afcf67640dae6ced8b37fc0eca21e3d3e768dc9b3
```

Đã kiểm lại sau khi ghi báo cáo: **298 file, cùng SHA-256, sourceUnchanged=true**. `git diff --check` exit 0 (có cảnh báo LF/CRLF cho file sửa sẵn). Báo cáo untracked được kiểm riêng: không trailing whitespace, không private-key/Groq-token pattern độ tin cậy cao. Scan này chỉ áp dụng báo cáo, không phải secret audit toàn repo. Việc so hash bảo vệ phạm vi source/test/script được liệt kê, không phải khẳng định toàn bộ filesystem bất biến.

## 11. Điểm yếu cần đưa vào quyết định Giai đoạn 1

Đây là câu hỏi/điều kiện phải giải quyết, **chưa chọn engine đích hoặc nguồn tốt nhất**:

1. Một engine duy nhất phải giữ ordinal/destination/SSID nếu lựa chọn capability này; không xóa entry rồi âm thầm route tới loop V1/AP còn ẩn.
2. Không chọn source chỉ vì có nhiều tests: so exact outcome, positive independent proof, failure cases và giá trị thực tế. Mốc Camera real positive không áp sang alarm/record vì cùng LOCAL_WRITE.
3. Giữ ba lớp phân biệt: parser/plan source coverage, execution authorization, independent outcome proof. Quyền owner/full-control không sửa được target sai/thiếu AMPM/continuity/countdown proof.
4. Xác định duplicate contracts thực sự: SET_STRUCTURED_STATE record form và ALARM provider/UI không tương đương; SSID connect và SET_DEVICE_STATE wifi không tương đương; EXACT_URI_VIEW và Gallery search không tương đương.
5. API compatibility, batch/group entry, streaming AP cancellation và worker lifecycle cần tests trước thay đổi. Một panel chỉ còn một Execute chưa đủ nếu API cũ vẫn khởi chạy engine cũ.
6. Không chứng minh một nguồn tốt ở bất kỳ engine nào thì đánh dấu ngoài demo ở Giai đoạn 1, không port vội hoặc bịa verifier. Hiện ordinal playback/alarm create/timer running/notes/Gallery còn thiếu positive acceptance tương ứng.
7. Current worker/Next có thể đang giữ module/hash cũ sau những sửa trước. Chỉ idle graceful reload trước acceptance đã được cho phép, không dùng stale process để kết luận source hiện tại hoạt động. Không restart process trong Giai đoạn 0.
8. Ba engine có contract model khác nhau. Không đưa ActionPlan JSON tự do thành candidate/grant V2 bằng cast; không đổi provider/model hoặc bật cloud để né coverage thiếu.

## 12. Phạm vi thay đổi và trạng thái các giai đoạn

| Giai đoạn | Trạng thái sau lượt này |
|---|---|
| 0. Kiểm kê | Báo cáo source/capability/evidence hoàn thành; chờ duyệt tiếp |
| 1. Chọn engine đích + đúng một nguồn cho mỗi capability | **CHƯA BẮT ĐẦU**; cần xác nhận người dùng |
| 2. Characterization và baseline mới | Chưa bắt đầu; cần giải thích các failure trước khi sang port |
| 3. Port từng capability | Chưa bắt đầu |
| 4. Một cửa vào/một đường chạy | Chưa bắt đầu; hiện vẫn 3 loops |
| 5. Archive rồi danh sách xóa chờ duyệt | Chưa bắt đầu; không có file được archive/xóa trong lượt này |
| 6. Validation/Android acceptance | Chưa bắt đầu; mọi thao tác thật cần scope được phép |

File source/test/config/dependency thay đổi bởi lượt này: **0**. Báo cáo tạo mới: `docs/engine-merge-report.md`. File engine đã port: **0**. Capability loại khỏi demo: chưa quyết định ở Giai đoạn 0. Không commit/push.

Hai tracked files `components/executions/TaskQueue.tsx`, `ExecutionDetailModal.tsx` đã ở trạng thái deleted **trước lượt này** (Safe Refactoring); không phải xóa do merge. Các modified sẵn gồm AICommandPanel/AgentGoalPanel, shared playback/grounding/executor và agent planner/runtime/temporal/launcher/worker. Các untracked sẵn gồm unified API/service/panel/controls/prepared-v2, M7a/refactor reports, acceptance scripts, workspace YAML và tests mới. Đã giữ nguyên chúng; backup branch không lưu những phần đó.

### Kiểm tra trên Windows đã dùng

```powershell
git status --short --branch
git branch --list backup-before-engine-merge
# Chỉ tạo khi chưa tồn tại, không checkout nhánh backup:
git branch backup-before-engine-merge
git show-ref --heads DuyTD backup-before-engine-merge
```

Đọc source bằng `rg`/PowerShell UTF-8 với đường dẫn cụ thể, loại sealed/holdout trước khi scan/hash. Node PATH alias từng bị Access denied khi gọi hash helper; dùng executable Node đã có `C:\nvm4w\nodejs\node.exe` cho thao tác đọc, không đổi PATH hay cài dependency. Đây không phải failure ứng dụng hoặc regression test.

Các lệnh regression/typecheck/lint/build và acceptance Windows sẽ được chốt ở đúng giai đoạn sau, sau khi bảo vệ tránh đọc fixture bị cấm. Không chạy lệnh xóa `.next`, dọn evidence hoặc dọn dữ liệu thiết bị để chuẩn bị merge.

**Điểm dừng: Giai đoạn 0. Cần chủ dự án xác nhận chuyển Giai đoạn 1 trước khi đề xuất engine đích và bảng chọn nguồn/port/rủi ro.**

## 13. Giai đoạn 2: baseline mới và characterization

Ngày thực hiện: 23/10/2026. Đây là kết quả chạy mới trên working tree, không sao chép kết quả lịch sử. Yêu cầu mới của chủ dự án đã chốt đích **V2/Hybrid Tool-First**, gộp mềm, giữ file/API cũ. Lượt này chỉ Giai đoạn 2; chưa thực hiện bất kỳ phần nào của Giai đoạn 3.

### 13.1 Phạm vi và bằng chứng bảo toàn

Đã đọc yêu cầu đính kèm, báo cáo Giai đoạn 0 và source/test liên quan; chạy `git status --short --branch` trước khi làm. Branch vẫn `DuyTD`, HEAD không đổi. Giữ mọi sửa/untracked/deleted có sẵn. Không commit, push, stash, reset, checkout, archive hoặc xóa file engine. Không đổi lib/components/app/scripts, config, model hay provider. Không dùng Android thật hoặc live cloud/Ollama inference; không tạo ảnh/alarm/timer/record, không đổi setting, không mở result thật. Test dùng fake adapters hoặc mock HTTP loopback/TEMP, không phải Appium/ADB thật.

Thêm đúng hai file test, cập nhật đúng báo cáo này. Evidence sinh máy nằm trong thư mục ignored `coverage/engine-merge-stage2-C6PRuq/`, viết mới, không dọn evidence/log/data cũ. Các test cũ giữ nguyên nội dung; teardown fixture tạm của test cũ không phải xóa dữ liệu người dùng/engine.

Hash dùng cùng thuật toán Giai đoạn 0: sorted path + newline + SHA-256 từng file, aggregate SHA-256; bỏ symlink và path có sealed/holdout trước khi đọc. `source-before.json` lưu 298 path/hash, test manifest, Node version và git status đầu lượt; không có env/key.

| Snapshot | File count | SHA-256 |
|---|---:|---|
| Đầu Giai đoạn 2, đúng tập Giai đoạn 0 | 298 | `15fcc66b559657bca042a70afcf67640dae6ced8b37fc0eca21e3d3e768dc9b3` |
| Cuối lượt, chỉ so lại 298 file ban đầu | 298 | `15fcc66b559657bca042a70afcf67640dae6ced8b37fc0eca21e3d3e768dc9b3` |
| Bao gồm hai file test mới | 300 | `d4c26056121882506f197abe5b368b080372ad12ef6407b44f20dae9b420e108` |

`source-check.json`: `changedOriginalFiles=[]`, added chỉ `tests/engine-merge-boundaries.test.cjs`, `tests/engine-merge-source-characterization.test.cjs`. Đây không phải worker runtime digest. Source hash không bao gồm report/generated build output; git status không phát sinh thay đổi config tracked.

### 13.2 Phạm vi loại trừ và sự cố phạm vi lint

Regression không mở/chạy `tests/general-agent-v2-open-world.test.cjs` (6 tests), do test import fixture có tên holdout. Mọi tên/path sealed/holdout bị loại trước khi đọc/khởi chạy; không tìm khóa hay mở cohort. Scan literal require/import trong manifest 64 test không thấy dependency có tên bị cấm. Hai test mới không import material đó. **Đây không phải full suite không ngoại lệ.**

**Sự cố phạm vi cần công khai:** lệnh baseline full ESLint đầu tiên là `eslint .`, chưa có ignore CLI cho sealed/holdout. Có fixture CJS mang tên holdout trong tree; ESLint có thể đã parse file đó theo mặc định. Vì vậy không thể tuyên bố lượt này tuyệt đối không đọc material đó qua công cụ lint. Không mở nội dung fixture trong hội thoại, không import/chạy fixture hoặc dùng nội dung nó để viết/tuning test. Kết quả lint đầu không được dùng làm bằng chứng tuân thủ phạm vi. Đã thông báo người dùng và chạy lại full lint với loại trừ tường minh; giữ log cả hai lần, không sửa config để che sự cố.

Full lint hợp lệ sau đó dùng `--ignore-pattern` cho `**/*holdout*`, `**/*holdout*/**`, `**/*sealed*`, `**/*sealed*/**` và test open-world nêu trên. Các lệnh regression luôn dùng manifest đã loại trừ, không glob chạy toàn bộ test directory. Không đọc sealed benchmark/cohort để đánh giá kết quả.

### 13.3 Baseline và validation chạy mới

Các lượt validation chạy tuần tự, không chồng timing các lệnh. Đọc source/bổ sung test giữa các lượt không được tính là thời gian test. Không cộng span build/TypeScript của Next thành tổng mới.

| Lượt | Kết quả thực | Thời gian và evidence |
|---|---|---|
| Baseline regression trước thêm test, môi trường restricted | 64 file, **1143 PASS / 27 FAIL / 1170 tổng**; 0 failure mới so checkpoint lịch sử | 170.128 s; `baseline/regression.json`, từng `baseline/*.test.cjs.log` |
| Chẩn đoán lại 8 file có FAIL, quyền TEMP/loopback ngoài sandbox | **165 PASS / 0 FAIL**, bao gồm cả 27 test lỗi | 24.922 s; `diagnostic-unrestricted.log`, `failure-classification.json` |
| Final regression cùng 64 file + hai file mới, ngoài sandbox, `--test-concurrency=1` | 66 file, **1193 PASS / 0 FAIL / 6 TODO / 1199 tổng**; không cancelled/skipped | 142.910 s; `final-regression-unrestricted.log` |
| Phần test cũ trong final | **1170 PASS / 0 FAIL**; không sửa test | Không trộn baseline restricted và diagnostic để bịa ra một lần chạy PASS; đây là subset thật của final run |
| Hai file test mới trong final | **23 PASS / 0 FAIL / 6 TODO**, 29 entries; TODO không tính là PASS | Xem mục 13.5-13.6; chưa có demo-cut gate |
| Baseline TypeScript | PASS / exit 0 | 13.350 s; `baseline/typecheck.log`, `baseline/validation.json` |
| Final TypeScript | PASS / exit 0 | 13.215 s; `typecheck-final.log`, `validation-final.json` |
| Scoped ESLint hai file mới | PASS / exit 0, không warning/error | 20.767 s; `eslint-scoped.log` |
| Full ESLint với loại trừ đúng phạm vi | PASS / exit 0, **0 errors / 3 warnings** | 41.808 s; `eslint-full-excluded.log` |
| Webpack build restricted | **FAIL / exit 1**, EPERM mkdir trong `.next/server/app/api/agent` | 32.977 s; `baseline/webpack-build.log` |
| Webpack build ngoài sandbox | **FAIL / exit 1**, compile/TS/prerender xong rồi SecurityFatalError | `webpack-build-unrestricted.log`; không có tổng wall time instrument đáng tin cậy cho lượt wrapper này |
| Retry đúng lệnh build, không đổi source/config/dependency | **FAIL / exit 1**, vẫn SecurityFatalError | 79.064 s; `webpack-build-retry.json`, `webpack-build-retry.log` |

Ba warning ESLint còn lại: unused `FileJson`, `cn` trong ActionPlanPreview; unused `Maximize2` trong DeviceFilters. Lỗi full ESLint cũ ở modal đã xóa **không tái hiện**. Không sửa các warning trong phạm vi Giai đoạn 2.

**Failure mới được báo ngay:** CLI Next.js báo phiên bản đang dùng có lỗ hổng và ném `SecurityFatalError` sau khi tạo route table; retry vẫn exit 1. Đây không thuộc 27 failures test và không được quy hết cho EPERM. Chưa xác minh độc lập advisory/CVE; không tự đổi dependency/env, không chạy upgrade hay bỏ security check. Production build **chưa PASS**. Cần đánh giá cảnh báo bảo mật/phiên bản vá trong một yêu cầu riêng được duyệt. Warning `module.createRequire failed parsing argument` tại session-manager còn xuất hiện, như checkpoint trước, không được xem là root cause của SecurityFatalError.

### 13.4 Phân loại từng failure lịch sử

Tất cả 27/27 tái hiện cùng tên trong baseline restricted; **tất cả PASS khi chạy lại cùng source/test ngoài sandbox**. Phân loại bên dưới là lỗi môi trường thực thi trong lần này dựa trên đối chứng, không phải khẳng định mọi cấu hình Windows đều ổn hoặc code được chứng minh không có bug. Không thay env/config/provider để đạt đối chứng; quyền thực thi của tool khác nhau, fake backends không đổi.

Evidence path ở bảng là tương đối dưới `coverage/engine-merge-stage2-C6PRuq/baseline/`. Cột dòng trỏ tới failure trong TAP. Mỗi hàng có đủ outcome đối chứng trong `failure-classification.json` và tên PASS trong `diagnostic-unrestricted.log`; file JSON còn lưu so sánh danh sách lỗi cũ/mới, cả hai differences đều rỗng.

| # | Test thất bại (tên rút gọn, tên đầy đủ trong JSON) | Restricted / đối chứng | Phân loại và evidence |
|---|---|---|---|
| 1 | M5c persistent hit/miss + restarted reader | FAIL / PASS | Môi trường TEMP rename EPERM; `agent-v2-catalog-cache.test.cjs.log:3` |
| 2 | M5c invalidates version | FAIL / PASS | Cùng nhóm TEMP; cùng log `:20` |
| 3 | M5c invalidates update time | FAIL / PASS | TEMP; cùng log `:37` |
| 4 | M5c invalidates missing update time | FAIL / PASS | TEMP; cùng log `:54` |
| 5 | M5c physical device + launcher alias isolation | FAIL / PASS | TEMP; cùng log `:71` |
| 6 | M5c cache bounded eight devices/500 entries | FAIL / PASS | TEMP; cùng log `:112` |
| 7 | M5c partial extraction prioritizes unresolved packages | FAIL / PASS | TEMP; cùng log `:141` |
| 8 | M5c fresh metadata/re-extraction on version change | FAIL / PASS | TEMP; cùng log `:164` |
| 9 | M3 verified route-hint persistence/isolation | FAIL / PASS | TEMP rename EPERM; `general-agent-v2-discovery-execution.test.cjs.log:33` |
| 10 | Simulated USB conversion/reconnect/busy disconnect | FAIL / PASS | TEMP rename EPERM; `wireless-connectivity.test.cjs.log:51`; không phải USB thật |
| 11 | M5b worker guard/source/grant/owner isolation | FAIL / PASS | Môi trường mock loopback fetch failed; `general-agent-v2-m5b-security.test.cjs.log:118` |
| 12 | Worker detached viewer/journal restart | FAIL / PASS | Mock loopback; `multi-device-runtime.test.cjs.log:82` |
| 13 | Polling hides image bytes/scoped evidence | FAIL / PASS | Mock loopback; cùng log `:118` |
| 14 | Worker owner mode HTTP identity/restart OFF | FAIL / PASS | Mock loopback; `owner-authorized-test-mode.test.cjs.log:52` |
| 15 | Worker planning bearer/reference/V1 stored goal | FAIL / PASS | Mock loopback; `unified-agent-m7a.test.cjs.log:298` |
| 16 | Groq success closed schema/projection | FAIL / PASS | Môi trường mock transport, NETWORK/fallback; `groq-router.test.cjs.log:3` |
| 17 | Groq 429 fallback | FAIL / PASS | Cùng mock transport, không nhận response fixture; cùng log `:33` |
| 18 | Groq 500 fallback | FAIL / PASS | Cùng nhóm; cùng log `:59` |
| 19 | Groq timeout fallback | FAIL / PASS | Cùng nhóm; cùng log `:91` |
| 20 | Groq invalid JSON fallback | FAIL / PASS | Cùng nhóm; cùng log `:117` |
| 21 | Groq foreign candidate ID fallback | FAIL / PASS | Cùng nhóm; cùng log `:143` |
| 22 | Groq invented grant fallback | FAIL / PASS | Cùng nhóm; cùng log `:169` |
| 23 | Groq Retry-After | FAIL / PASS | Cùng nhóm; cùng log `:195` |
| 24 | Groq circuit after three failures | FAIL / PASS | Cùng nhóm; cùng log `:219` |
| 25 | Groq process-local rate budget | FAIL / PASS | Cùng nhóm; cùng log `:243` |
| 26 | M4e richer owner command/exact manifest | FAIL / PASS | Cùng nhóm; cùng log `:315` |
| 27 | M4e sensitive/editable context withheld | FAIL / PASS | Cùng nhóm; cùng log `:332` |

Nhóm 16-27 chạy `GroqProposalProvider` bằng transport injected trỏ HTTP `127.0.0.1`, dùng mock credential và fake local reasoner. PASS không chứng minh Groq thật/Ollama thật đã được gọi hoặc model có năng lực suy luận. Chẩn đoán ngoài sandbox đầu tiên chưa chạy vì hết thời gian review quyền; retry được duyệt rồi mới có log 165/165. Không coi lần review timeout là failure của ứng dụng.

### 13.5 Test mới: chuẩn nguồn P1/P2 và giới hạn

`tests/engine-merge-source-characterization.test.cjs`: **8 PASS**. Global fetch bị chặn trong test; planner dùng reasoner fail-on-call, observer/ADB runner là fixture. Không chạm thiết bị hay gửi ảnh.

| Bắt đầu tại dòng | Input/contract | Điều được chứng minh offline |
|---|---|---|
| `:35` (2 tests) | Chrome/YouTube, query `marine research notes`, ordinal=1 | `planGoal` V1 giữ nguyên query, OPEN_RESULT, 3 criteria và target first_result/video_card_1; 0 model calls; YouTube yêu cầu playback |
| `:50` | DOM có sponsored product, video card không có article-source proof và hai articles | Chạy script READ_WEB_DOCUMENT thật trong DOM VM fixture; organic collection giữ URL/title đúng thứ tự, không đếm các thẻ được loại. Đây không chứng minh mọi product card Google thật đều được phân loại |
| `:74` | P1 destination với URL/title/ready-state, trước/sau verified search | `criterionSatisfied` và verifier thật từ chối thiếu prior search, ordinal sai, URL/title sai, loading/captcha, observation lỗi/foreground khác; chỉ title không đủ |
| `:108` | P2 ad/Shorts/ordinary video; cùng title nhưng channel identity khác | `discoveryCandidates` loại ad/Shorts; memory phải anchored trước khi đếm, identity đổi không được gộp hay đánh lại số |
| `:126` | P2 PLAYING + hai snapshot/position khác nhau | MediaSession verifier thật tạo proof khi tăng; repeated snapshot, frozen hoặc PAUSED không đạt. Final V1 criterion không nhận title-only thay playback |
| `:150` (2 tests) | V1 loop ở destination subgoal đã có search verified, một CLICK báo TIMEOUT/interactionSent | `runAgent` trả BLOCKED, đúng 1 click và 1 close, không replay, không publish COMPLETED cho cả P1/P2 |

Đây là chuẩn của các **đoạn hành vi** nguồn, không phải full task mở app -> nhập query -> click chạy trên Android. Bộ tests cũ T2/T3/T4 bảo vệ phần planner/executor/explorer còn lại và đã được chạy trong final regression. Không có 3/3 real runs hoặc 0 false completions của P1/P2 mới ở Giai đoạn 2.

`tests/engine-merge-boundaries.test.cjs`: **15 PASS / 6 TODO**:

- 4 test destructive/mixed DENY toàn câu trước prepare/start; không gọi legacy planner/executor.
- 3 test forced V2 với P1 ordinal=1, P2 ordinal=1 và video thứ 2: ASK ENGINE_CAPABILITY_UNSUPPORTED **trước prepare**. Đây là hành vi pre-port phải được đổi có chủ đích sau khi P1/P2 đạt, không âm thầm sửa kỳ vọng bây giờ.
- 6 characterization GAP (SSID, record, Gallery, URL, Maps, Bluetooth): router hiện trả V2 khi forced; nếu fake backend báo ASK thì façade giữ lỗi và không fallback. **Đây không phải chứng minh demo-cut đã được áp dụng.** Mỗi case có một TODO tách riêng về gate phải từ chối trước prepare ở bước 3.4.
- 1 test mixed Settings -> read battery/Wi-Fi/brightness -> set DND giữ đủ typed intents/dependencies/effect; read không cần app. Dùng typed-intent proposal/registration giống `prepareV2`, không giả định raw compile string đã tự thực hiện mọi stage.
- 1 test AM/PM clarification chưa có plan/effect; backend prepare error sau trả lời không làm token được replay/đổi sang câu trả lời còn lại.

Lượt đầu test mới có **21 PASS / 2 FAIL / 6 TODO** (`characterization-first.log`), đã thông báo ngay. Hai failure là lỗi test mới: bỏ bước typed-intent proposal khiến direct compiler còn NEEDS_CLARIFICATION; fixture MediaSession thiếu buffered position và đủ metadata fields. Sửa đúng hai file mới để gọi đúng stage/đưa dump hợp lệ, không đổi assertion an toàn hay runtime. Final test chứng minh cả raw compile chưa COMPLETE và typed proposal mới COMPLETE; thêm buffered/metadata không bỏ kiểm tra PLAYING/progress. Không có sửa test cũ để đạt số đẹp.

### 13.6 Các capability GIỮ: test coverage hiện có đã chạy lại

Không viết lặp thêm test chỉ để tăng số lượng khi đã có assertion tương ứng. Đây là ánh xạ input/plan/verifier/blocked case, không chỉ tên capability trong registry. Tất cả test file được dẫn có mặt trong 64-file manifest và PASS ở final outside-sandbox run.

| Capability giữ | Test bảo vệ hiện tại, đường assertion chính | Khoảng trống còn lại |
|---|---|---|
| Mở app; mở Settings | `general-agent-v2-m4b.test.cjs` source/resolve/screen/independent activity; `general-agent-v2-runtime.test.cjs:274` catalog identity/ambiguity; launcher tests | App mới/UI mới không mặc nhiên có proof; unknown app ASK |
| Đọc pin/Wi-Fi/độ sáng | `read-state-semantics.test.cjs:30`, `read-state-execution.test.cjs:103`, `read-state-session-binding.test.cjs`; exact source/device/Session, paired read mismatch/cancel/expiry | Natural phrasing trên current source chưa có lượt Android mới ở đây |
| Đổi Wi-Fi/độ sáng/DND + khôi phục | `general-agent-v2-m4d.test.cjs:30`, `:34`, `:64`, `:72`, `:77`, `:82`, `:86` | Journal + inverse/readback đã có fixture và lịch sử thật; không rộng quyền sang setting bị cắt. UNKNOWN không retry; baseline không đổi không tự tính restored |
| Chụp đúng 1 ảnh | `agent-v2-m6a.test.cjs:57`, `:111`, `:123`, `:143`, `:187` | MediaStore +1/freshness/one-shot/NOT_SENT vs UNKNOWN; không có ảnh mới ở lượt này |
| Quay số điền sẵn, không gọi | `general-agent-v2-m4b.test.cjs` canonical request/schema/exact number + activity/forged grant negatives | Không có capability CALL; không chạy dialer thật ở Giai đoạn 2 |
| Tính toán | `general-agent-v2-runtime.test.cjs:45`, `:64`; `general-agent-v2-widgets.test.cjs`; M6a `:150` | Exact result và uncertain mutation/incorrect result không complete/replay. Không universal calculator claim |
| Search trong các app có bằng chứng | `general-agent-v2-search.test.cjs:49`, `:60`, `:77`, `:127`; reliability/m3c/m3d | Exact query/provenance/result surface/NO_RESULTS; không result opening; lịch sử Drive/YouTube/My Files không mở rộng sang Maps/Photos |
| Hỏi lại AM/PM | `agent-v2-m6b.test.cjs:30`, `:159`; `unified-agent-m7a-fixes.test.cjs:24`, `:32`, `:47`; test mới boundaries `:81` | OFFLINE_TESTED; current real Dashboard answer/resume vẫn UNVERIFIED. Không lấy lời chốt phạm vi làm real acceptance mới |
| DENY xóa/gỡ/ghi đè/câu trộn | `general-agent-v2-m4d.test.cjs:13`; M6a `:74`; new boundaries `:28` | ALLOW owner/full-control không vượt whole-source DENY; destructive bị từ chối, nhưng demo-cut safe requests là gate khác còn TODO |
| Stop/cancel/release | `multi-device-runtime.test.cjs`; `unified-agent-m7a.test.cjs`; `general-agent-v2-runtime.test.cjs:100`, `:151`, `:178` | Fake sessions/owned cancellation/expired admission; lịch sử L13 là real verification cũ, không Android mới |

### 13.7 Danh mục demo đã chốt và phần chưa được enforce

| Nhóm | Trạng thái sau Giai đoạn 2 | Hành động đã làm / chưa làm |
|---|---|---|
| Capability GIỮ nêu trên | OFFLINE_TESTED mới; các R trong Giai đoạn 0 vẫn là lịch sử | Không port, không đổi executor/verifier/policy. Không biến evidence lịch sử thành nghiệm thu current source |
| P1 Chrome search + article ordinal=1 | Chuẩn V1 OFFLINE_TESTED; **chưa port V2** | V2 forced vẫn ASK đúng pre-port. Chưa có 3 lần Android được cấp phép |
| P2 YouTube video ordinal=1 | Chuẩn V1 OFFLINE_TESTED; **chưa port V2** | Chỉ được xét sau P1 đạt; chưa cho chạy song song/tiếp bước |
| Báo thức/hẹn giờ | Existing offline tests PASS; real creation/running **UNVERIFIED/BLOCKED như lịch sử** | Không chạy lại, không sửa temporal ở Giai đoạn 2; không replay unknown timer |
| SSID, record/notes, Gallery, URL/Maps | CẮT theo quyết định demo, **chưa có gate global** | 6 TODO có cả Bluetooth làm đại diện family setting; không coi fake backend ASK là policy từ chối tường minh |
| Bluetooth/rotation/volume/flashlight/airplane | CẮT khỏi demo; không bật trên máy | Chưa tạo gate cấu hình; ngoài Bluetooth chưa có TODO mới riêng cho từng state, test M4d có negative dispatch/verifier nhưng không thay demo-cut gate |
| Ordinal >1 | CẮT khỏi demo; forced V2 ASK được test | Auto/legacy API vẫn có thể route engine cũ, chưa enforce một đường V2. Không sửa router/UI/API trong Giai đoạn 2 |

**Khoảng trống của yêu cầu test từ chối:** vì không được đổi source trong Giai đoạn 2, không thể làm assertion "mọi safe capability bị cắt đều bị từ chối trước prepare" PASS một cách trung thực. Source đang có implementation record/URL và router chưa biết danh mục demo; đổi mock thành DENY không giải quyết việc đó. Giữ TODO + characterization hiện trạng, chờ gate 3.4 được duyệt. Không được dùng số 1193 PASS để tuyên bố các gate này đã xong.

P1/P2 source verifier semantics phải giữ: prior search, exact ordinal/identity và destination; P2 không được chỉ gọi title-capable `verifyDiscoveredSelection` mà bỏ `goalRequiresPlayback`/independent media clock requirement. P1 DOM collection fixtures không phủ mọi Google ad/product layout, redirect hoặc native-only fallback; real acceptance vẫn bắt buộc. Không có tính năng mới hoặc provider tuning để vượt test.

### 13.8 Lệnh Windows tái lập và evidence index

Node đang dùng: executable có sẵn `C:\nvm4w\nodejs\node.exe`, không cài dependency/đổi PATH. Chỉ chạy lệnh với danh sách đã loại trừ; không dùng `node --test tests` hoặc glob import mọi fixture.

```powershell
# Manifest được lưu trước khi thêm test, không chứa sealed/holdout/open-world test.
$m = Get-Content coverage/engine-merge-stage2-C6PRuq/source-before.json -Raw -Encoding UTF8 | ConvertFrom-Json
$files = @($m.tests | ForEach-Object { Join-Path tests $_ }) + @(
  'tests/engine-merge-source-characterization.test.cjs',
  'tests/engine-merge-boundaries.test.cjs'
)
& 'C:\nvm4w\nodejs\node.exe' --test --test-concurrency=1 $files
& 'C:\nvm4w\nodejs\node.exe' node_modules/typescript/bin/tsc --noEmit --incremental false
& 'C:\nvm4w\nodejs\node.exe' node_modules/eslint/bin/eslint.js . --ignore-pattern '**/*holdout*' --ignore-pattern '**/*holdout*/**' --ignore-pattern '**/*sealed*' --ignore-pattern '**/*sealed*/**' --ignore-pattern 'tests/general-agent-v2-open-world.test.cjs'
& 'C:\nvm4w\nodejs\node.exe' node_modules/next/dist/bin/next build --webpack
git diff --check
```

Nếu test trên bị 27 lỗi TEMP/loopback trong sandbox thì phải ghi nhận và xin đúng quyền thực thi của tool/môi trường cho đối chứng, không sửa source/test hoặc trỏ mock sang dịch vụ thật. Build hiện vẫn có SecurityFatalError cả sau đối chứng; lệnh trên không hứa PASS. Không dùng upgrade/bypass flag hoặc dọn `.next` để giấu lỗi trong phạm vi này.

Evidence dưới `coverage/engine-merge-stage2-C6PRuq/`:

- `source-before.json`, `source-check.json`, `git-status-after.txt`: manifest/hash/parity.
- `baseline/regression.json`, 64 TAP logs, `baseline/validation.json`: baseline restricted và validation đầu.
- `failure-classification.json`, `diagnostic-unrestricted.log`: từng failure cùng tên PASS ngoài sandbox.
- `characterization-first.log`: cả hai lỗi fixture/stage test mới, không xóa lịch sử thử.
- `final-regression-unrestricted.log`: 1193 PASS/0 FAIL/6 TODO trong một run, 66 file.
- `validation-final.json`, `typecheck-final.log`, `eslint-scoped.log`, `eslint-full-excluded.log`: validation sau tests mới.
- `baseline/webpack-build.log`, `webpack-build-unrestricted.log`, `webpack-build-retry.log`, `webpack-build-retry.json`: cả EPERM và SecurityFatalError, không gộp nguyên nhân.
- `final-safety-check.json`: 298 file cũ giữ nguyên hash, không đổi tracked config, diff check exit 0; ba file test/report mới/cập nhật không trailing whitespace hoặc token/private-key pattern độ tin cậy cao. Scan giới hạn các file này, không phải secret audit toàn repo.

Evidence ignored chỉ có tại máy, không được commit/push. Không có model/device calls thật trong lượt này để chứng minh autonomy; mới chỉ offline fixtures. P1/P2/temporal có **0 lượt Android mới**, latency/model performance thật mới **UNVERIFIED**.

Theo AGENTS.md, đã đọc feedback protocol cho diagnostic Next.js lặp lại (lần trong sandbox không kiểm tra được, lần có mạng đọc được). Chỉ chuẩn bị bản nháp ẩn danh về thông điệp "retry để tiếp tục" nhưng retry vẫn SecurityFatalError; không gửi feedback thay người dùng, không thực hiện upgrade theo nội dung thông báo build.

**Điểm dừng Giai đoạn 2:** characterization hiện tại chạy được, 27 lỗi test đã có đối chứng môi trường, nhưng build còn lỗi bảo mật CLI mới và 6 demo-cut gates còn TODO. Chờ chủ dự án duyệt trước khi bắt đầu **chỉ P1**; không tự tiếp P2, temporal acceptance hoặc đổi router/UI/API. Không archive/xóa engine cũ.

## 14. Giai đoạn 3.1 (P1): Chrome search và mở bài organic đầu tiên trong V2

Ngày: 23/10/2026. Chỉ thực hiện yêu cầu P1 được duyệt: **Chrome, query chính xác, ordinal = 1**. Không triển khai P2, temporal acceptance, demo-cut gate 3.4, thay UI, archive hoặc xóa engine. Đây chưa phải hệ thống một engine duy nhất.

### 14.1 Preflight, baseline và phạm vi

Đã đọc yêu cầu P1, source và mục 13; chạy git status trước sửa. Branch `DuyTD`, HEAD `01525d92412eb1779855beec0e359037a79873d0`. Tạo `backup-before-p1-port` tại HEAD: lần restricted bị từ chối ghi `.git`, lần được cấp quyền thành công. Đã nhắc người dùng: **backup branch chỉ lưu HEAD, không lưu modified/untracked; cần sao lưu working tree riêng**. Không commit/push/stash/reset/checkout; giữ những file deleted từ trước, không xóa thêm file nào.

Evidence mới: `coverage/engine-merge-p1-HkwLY2/` (ignored, chỉ tại máy). Manifest lấy đúng 66 test Giai đoạn 2, thêm một test P1 mới khi final. Loại tên/path sealed/holdout trước đọc/scan/hash; không mở/import `tests/general-agent-v2-open-world.test.cjs` vì dependency fixture bị cấm. Mọi lệnh lint đều kèm năm loại trừ CLI như mục 13.8, không chạy `eslint .` trần. Đây **không phải full regression không ngoại lệ**.

Baseline regression ngoài sandbox để giữ cùng quyền TEMP/mock loopback với final Giai đoạn 2: **1193 PASS / 0 FAIL / 6 TODO**, 1199 entries, 66 file, 152.338 s (`baseline-regression.log`). Không có failure baseline mới. TypeScript PASS 46.704 s, full lint có loại trừ PASS 169.953 s, 0 errors/3 warnings (`baseline-validation.json`). Không chạy baseline build: chỉ một build cuối lượt như yêu cầu.

Không gọi ADB, Appium, Ollama hay cloud thật; không gọi execution API lên dịch vụ thật, không mở Chrome thật. Tests dùng fake Android adapter/Appium client, DOM VM và loopback services từ manifest. Các test provider có mock HTTP không phải gọi Groq/Ollama. Không đổi env/config/provider/model/dependency. Đã đọc guide build Next.js bundled trước sửa; không làm theo hướng dẫn upgrade/retry trong diagnostic build trái phạm vi người dùng.

### 14.2 Bản đồ V1 làm gì → V2 tái sử dụng gì

| Hành vi nguồn và evidence source | P1 trong V2, không gọi loop V1/AP |
|---|---|
| `agent/goal-planner.ts:13` clearGoal dùng `parseChromeRequest`, `buildGoal:40` giữ query/ordinal và SEARCH_RESULTS → DESTINATION | `agent/browser-result-contract.ts:4` khai báo typed surface/query/ordinal, descriptor Chrome; `outcome-spec.ts:138` chỉ nâng đúng ba outcome đầy đủ thành LAUNCH → SEARCH → OPEN_RESULT; `goal-compiler.ts:52` chặn ordinal khác 1 hoặc thiếu SEARCH đúng query |
| `agent/decision-engine.ts:18` searchTarget address_bar; ruleDecision chọn click/input/submit theo state; `agent/action-candidates.ts:38` tạo candidates | `agent/search-executor.ts:19` vẫn dùng runGenericSearch; `generic-search.ts:78,211` thêm surface browser theo descriptor, commit protocol và hai DOM read độc lập. Chỉ bật nhánh browser khi SEARCH phục vụ typed OPEN_RESULT; native search cũ không chuyển sang browser |
| `agent/memory.ts:10` giữ selection/attempt; `agent/evaluator.ts:16` bắt buộc prior SEARCH và ordinal identity, không lấy title thay URL | `agent/browser-result.ts:24` authentic prior SEARCH proof + cùng device/execution/node dependency/Session/package/query; frozen first-link identity và attempted/acknowledged state. `verification-registry.ts:22` phát proof BROWSER_RESULT_V2 sau readback, không lấy SENT làm VERIFIED |
| `exploration/ui-explorer.ts:25`, organic collection và `hybrid-context-observer.ts:138` chọn DOM element đã quan sát, kiểm tra thứ tự/visibility/readiness | Dùng lại READ_WEB_DOCUMENT và clickOrdinal thật, không copy bộ đếm organic. `grounded-candidates-v2.ts:54` chỉ phát một candidate backend với unique native WebView và DOM first-link scope; không nhận selector/tọa độ do model/client gửi |
| `browser-destination.ts:14,52,68` kiểm tra redirect/URL/title; `action-verifier.ts:17,53` verifyDiscoveredSelection/verifyBrowserSearch | Tái sử dụng nguyên các helper này ở scope/readback và hybrid click; independent snapshot phải đúng URL/title/ready-state, không loading/captcha/foreground lạ/observation lỗi |
| Loop V1 có budget/decision/action/evaluation riêng | Thêm một nhánh OPEN_RESULT **bên trong** `agent/agent-v2.ts:430`, qua execution.interactV2/grant hiện có. Không tạo vòng engine mới, không gọi runAgent/ConditionExecutor để điều phối result, không cast ActionPlan JSON thành grant |

Các đường dẫn ở bảng tính từ `lib/android/`. Đã khảo sát source, không suy ra tương đương chỉ vì cùng tên helper. `ConditionExecutor` **không bị sửa trong lượt P1** (hash bằng đầu lượt; file vốn dirty từ trước).

### 14.3 Contract, routing và các ranh giới an toàn

P1 nhận source mở Chrome tường minh theo grammar Việt đang có của V1. Contract giữ `surface=BROWSER_ORGANIC`, nguyên query, ordinal. Schema biểu diễn ordinal 1..99 nhưng compiler/dispatcher **chỉ thực thi 1**; >1 dừng trước Session, không đếm mù. Chỉ chuyển outcome cuối khi đúng ba clauses, app/query khớp, không negation/ambiguity; không bỏ những clause không hỗ trợ.

Flow thực: V2 LAUNCH → scoped browser SEARCH verified → authentic prior search proof → DOM first organic link → một issued candidate/grant → fresh revalidation trong Session lock → clickOrdinal → independent DOM destination proof. Trước click, hook tái kiểm quyền/freshness và đánh dấu attempted/UNKNOWN; sau ACK mới cho phép readback. UNKNOWN/TIMEOUT không ACK hoặc không có proof thì BLOCKED, không retry effect. Cancel giữ CANCELLED và đóng Session.

`verification-registry.ts` giữ private WeakMap search provenance (Session/package/surface); scope/candidate dùng WeakMap và frozen identity. Grant vẫn single-use, device/Session-bound, TTL/freshness kiểm tra tại dispatch. Owner/full-control chỉ nhận scoped READ CLICK đã xác thực; không mở rộng generic click tùy ý, không bỏ Permission/DENY/journal/cancel/verification. Existing mutation/temporal journal không bị sửa. Không có model selector/shell/tọa độ hoặc model-issued quyền; đường quyết định xác định **m=0** trong fixture.

**Router chỉ mở ngoại lệ forced V2 + explicit Chrome ordinal 1** (`unified-agent/capability-router.ts:24`). Auto formula không đổi: câu ba clauses dùng trong test `Mở Chrome, tìm marine research notes và mở bài đầu tiên` vẫn chọn **V1**; một số recipe legacy khác có thể chọn AP như trước. Forced V1/AP giữ nguyên. Forced V2 với YouTube, ordinal 2+ vẫn ASK. Không fallback engine sau dispatch. UI vẫn có lựa chọn engine; chưa tuyên bố cổng một engine hoặc demo-cut hoàn thành.

### 14.4 File thay đổi và hash source

So với snapshot **working tree đầu P1**, không so với HEAD bẩn từ nhiều lượt trước:

| File (từ root repo) | Thay đổi P1 |
|---|---|
| `lib/android/agent/browser-result-contract.ts` | **MỚI**: typed schema/request và capability descriptor |
| `lib/android/agent/browser-result.ts` | **MỚI**: authentic scope, candidate binding, one-shot dispatch và readback |
| `lib/android/agent/outcome-spec.ts` | Typed OPEN_RESULT + chuyển parser generalized theo contract, không đổi legacy parser |
| `lib/android/agent/capability-registry.ts` | OPEN_RESULT READ/BROWSER_RESULT_MATCHES |
| `lib/android/agent/goal-compiler.ts` | Dependency/query/ordinal support gate |
| `lib/android/agent/goal-graph.ts` | Predicate và progress/result browser proof |
| `lib/android/agent/evidence-predicates.ts` | Typed evidence/predicate/provider browser |
| `lib/android/agent/verification-registry.ts` | Registered browser proof, private prior-search provenance |
| `lib/android/agent/generic-search.ts` | Opt-in browser scope, address descriptor và DOM search readback |
| `lib/android/agent/search-executor.ts` | Truyền surface qua runner hiện có |
| `lib/android/agent/grounded-candidates-v2.ts` | Backend-issued first-link candidate |
| `lib/android/agent/effect-grants.ts` | OPEN_RESULT phải có authentic browser scope, giữ grant checks |
| `lib/android/agent/owner-test-policy.ts` | Chỉ scoped non-destructive READ candidate, không rộng quyền chung |
| `lib/android/agent/agent-v2.ts` | Lưu search proof; OPEN_RESULT trong loop cũ; progress và complete đều mang proof |
| `lib/android/grounded-interactions.ts` | Bridge DOM click trong grant/Session/freshness hiện có |
| `lib/android/hybrid-context-observer.ts` | Optional hook trước clickOrdinal dispatch; callers cũ không truyền hook giữ hành vi |
| `lib/android/unified-agent/capability-router.ts` | Ngoại lệ forced V2 P1, không thay Auto formula |
| `tests/engine-merge-p1-v2.test.cjs` | **MỚI**, 25 tests offline |
| `tests/engine-merge-boundaries.test.cjs` | Chỉ thay P1 Chrome1 sau parity mới PASS; P2/2+/DENY/TODO giữ nguyên |
| `docs/engine-merge-report.md` | Cập nhật trạng thái và thêm mục 14, giữ lịch sử |

16 file có sẵn đổi hash, 3 file source/test mới, 1 report cập nhật; không file bị xóa/archive. Những file đã sửa từ trước không có thay đổi P1 ngoài danh sách này. Hash dùng lại thuật toán mục 13.1, tập source/test/scripts không gồm docs/generated/config, không phải worker digest:

| Snapshot | Số file | SHA-256 |
|---|---:|---|
| Đầu P1 (300 file từ Giai đoạn 2) | 300 | `d4c26056121882506f197abe5b368b080372ad12ef6407b44f20dae9b420e108` |
| Cuối P1, bao gồm 3 file mới | 303 | `bd830cfc410938918bad07402f65b53f7637630227374a1b444c2188a596506d` |

`source-before.json`, `source-after.json` (checkpoint trước sửa kỳ vọng test mới cuối), `source-final.json` lưu từng path/hash. Giữa checkpoint source-after và final chỉ đổi **test P1 mới** vì kỳ vọng Auto sai; không sửa runtime để đổi Auto. Trong các test đã có đầu lượt, chỉ `engine-merge-boundaries.test.cjs` đổi hash. ConditionExecutor giữ nguyên; không thay provider/config/env/model/dependency.

### 14.5 Parity và ngoại lệ test boundary

New test `engine-merge-p1-v2.test.cjs`: 25 PASS, global fetch fail-on-call và reasoner fail-on-call. Fake adapter chạy **loop V2, grounded executor, HybridContextObserver và organic extractor production thật**, không phải assertion chỉ trên mock status.

| Test/dòng | Coverage OFFLINE_TESTED | Không chứng minh |
|---|---|---|
| `:60`, `:69`, `:74` | Exact query/span/dependencies/ordinal/surface; typed prepare không gọi model; ordinal 2 chặn; forced V2 P1 và routing legacy không đổi | Không phải mọi cách diễn đạt Việt/Anh |
| `:82`, `:92` | Thiếu/clone/sai query/device/Session prior search không hợp lệ; grant ACK không tự thành proof; exact URL/title + search provenance | Không phải persisted proof qua worker restart |
| `:99` (10 cases), `:115` | URL/title sai, title-only, loading/captcha, foreground/observation lỗi, stale/same snapshot/foreign device bị từ chối; identity đổi, nhiều WebView, foreign/replayed grant không click | Không phủ mọi Google layout/redirect trên máy thật |
| `:170` (3 modes) | Normal/owner/full-control hoàn thành fake P1 trong một Session; 1 result click, close, model calls 0, owner teardown OFF | Không có consent hoặc mutation được tự cấp thêm; không chứng minh model tự chủ |
| `:185` (5 cases) | UNKNOWN/TIMEOUT đúng 1 click rồi BLOCKED; cancel/foreign device/Session fail closed, không complete và không replay, Session release | Chưa nghiệm thu cancellation Dashboard/browser thật |
| `:195` | READ_WEB_DOCUMENT thật trong DOM VM loại sponsored product và video không có article-source proof; output nối vào V2 chọn article đầu tiên | Không khẳng định mọi product/video card thật đều phân loại được |

Chạy lại 7 file chuẩn nguồn (characterization, boundary, Chrome planning, organic results, title evidence, UI exploration, media playback): **101 PASS / 0 FAIL / 6 TODO** (`source-parity-first.log`). Full final còn chạy tất cả 66 file baseline: giữ **1193 PASS / 0 FAIL / 6 TODO** sau thay P1 boundary; 25 tests mới đưa tổng lên 1218 PASS. Các tests T3/T4 và source V1 vẫn PASS. Không chỉnh test cũ để hạ verifier requirement.

Yêu cầu nói “ba test P1 boundary”, nhưng source đầu lượt thực tế gồm **một Chrome1 (P1), một YouTube1 (P2), một YouTube2**. Không đổi cả ba: chỉ thay đúng ô P1 sau khi new V2 parity 24/24 đã PASS; hai test P2 giữ nguyên ASK trước prepare. Số entries boundary không đổi (15 PASS/6 TODO).

| Boundary | Trước | Sau và lý do |
|---|---|---|
| Chrome1, tên cũ `OFFLINE pre-port forced V2 ordinal asks before prepare and cannot silently call V1/AP: …` | ASK ENGINE_CAPABILITY_UNSUPPORTED trước prepare | Test mới `OFFLINE ported P1 forced V2 reaches typed preparation, never V1/AP or execution` tại `:47`: real compiler LAUNCH/SEARCH/OPEN_RESULT, fake service chỉ analyze, không start/legacy call. Port đã có contract/verifier offline nên đổi boundary có chủ đích |
| YouTube1, cùng tên pre-port với source tương ứng | ASK trước prepare | Không sửa, P2 chưa port |
| YouTube2, cùng tên pre-port với source tương ứng | ASK trước prepare | Không sửa, P2/ordinal>1 chưa port |

4 destructive/mixed DENY giữ nguyên; 6 TODO gate demo-cut giữ nguyên TODO; các test retained reads/AM-PM giữ nguyên. Không test cũ nào khác đổi byte/hash.

### 14.6 Validation tuần tự và lịch sử failure không che giấu

Các thời gian dưới đây là wall span riêng, không cộng các span compile/TS bên trong build, không dùng chúng để suy ra tốc độ model/Android.

| Lượt | Kết quả | Thời gian / evidence dưới coverage/engine-merge-p1-HkwLY2/ |
|---|---|---|
| Baseline regression (66 file) | 1193 PASS / 0 FAIL / 6 TODO | 152.338 s, `baseline-regression.log` |
| Chuẩn nguồn 7 file | 101 PASS / 0 FAIL / 6 TODO | 20.762 s, `source-parity-first.log` |
| New P1 parity sau sửa fixture/payload, trước đổi boundary | 24 PASS / 0 FAIL | 3.645 s, `p1-offline-parity.log` |
| Full final lần đầu (67 file) | 1217 PASS / **1 FAIL** / 6 TODO | 320.783 s, `final-regression.log`; chỉ test P1 mới kỳ vọng sai Auto |
| New P1 sau sửa kỳ vọng Auto | 25 PASS / 0 FAIL | 3.972 s, `p1-router-parity.log` |
| **Full final xác minh lại**, 67 file | **1218 PASS / 0 FAIL / 6 TODO / 1224 entries**, 0 skip/cancel | **147.416 s**, `final-regression-verified.log`; chạy ngoài sandbox để TEMP/mock loopback hoạt động như baseline |
| Final TypeScript | PASS / exit 0 | 9.262 s, `final-typecheck.log`, `final-validation.json` |
| Scoped ESLint 19 file source/test P1 | PASS, 0 warning/error | 15.676 s, `final-scoped-eslint.log` |
| Full ESLint có loại trừ | PASS, **0 errors / 3 warnings cũ** | 26.865 s, `final-eslint.log` |
| **Đúng một** production webpack build trong P1 | **FAIL / exit 1, SecurityFatalError đã biết** | 60.050 s, `final-webpack-build.log/json`; ngoài sandbox |
| Diff/trailing whitespace/limited secret-pattern check | **PASS**, diff exit 0; không trailing whitespace/token pattern độ tin cậy cao; 303 hash không đổi sau final | `final-safety-check.json`; kiểm source/test P1 + report, không đọc config bí mật hoặc audit toàn repo |

Ba warning lint vẫn chỉ unused FileJson/cn trong ActionPlanPreview và Maximize2 trong DeviceFilters; full-lint lỗi modal lịch sử không tái hiện. Build compile thành công, TS xong, prerender 13/13, route table xong rồi CLI báo Next.js version có security vulnerability và SecurityFatalError. Warning createRequire/session-manager cũ còn nguyên. Không có diagnostic mới quy cho P1, nhưng **build chưa PASS**; không xác minh advisory hay đổi dependency trong phạm vi này, không retry/bypass security gate. Vấn đề phiên bản bảo mật cần yêu cầu riêng được duyệt.

Failure trong quá trình phát triển, đã báo ngay và giữ log:

1. `p1-first.log`: 21 PASS/3 FAIL trong 24 test mới; fake Appium client thiếu native-context GET/readback, HybridContextObserver không thể xác minh restore. Chỉ bổ sung context state đúng giao thức ở **test mới**, không nới production verifier.
2. `p1-parity.log`: sau sửa fixture vẫn 21/3; phát hiện bug port thật: final complete payload thiếu browserResult dù progress có. Sửa payload production để giữ registered proof; không thay assertion thành chấp nhận thiếu proof.
3. `final-regression.log`: 1 FAIL chỉ ở **test mới** kỳ vọng Auto chọn AP. Source trước port đã chọn V1 cho câu ba clauses; sửa kỳ vọng mới sang V1, giữ Auto router nguyên trạng. Tất cả test baseline PASS ngay cả run lỗi này. Rerun full suite thật cho kết quả 1218/0/6, không ghép kết quả nhiều run để gọi PASS.

Các lần review tool hết thời gian trước execution không được tính là test failure. Không có Android effect UNKNOWN thật cần dọn hoặc chạy lại. Mọi số Appium RPC giả trong tests không được báo thành RPC thiết bị; **RPC/ADB/model/latency thiết bị thật: UNVERIFIED, 0 lượt thật**.

### 14.7 Khoảng trống và kế hoạch ba lượt Android, CHƯA CHẠY

**P1 = OFFLINE_TESTED. REAL_ANDROID_VERIFIED = UNVERIFIED.** Android không được preflight trong lượt này. m=0 chỉ chứng minh đường deterministic trong fixtures không dùng model, không chứng minh hiểu ứng dụng mới hoặc suy luận tự chủ. Không có false-completion metric Android mới, không được ghi 0/3 khi chưa chạy.

Giới hạn: chỉ explicit Chrome forms grammar V1 đã khảo sát, chỉ first article; không claim English/implicit clauses tùy ý. Bắt buộc DOM_AVAILABLE, exact query/search proof, unique native WebView và first link visible/uncovered. Không có native/title-only fallback. Những layout không expose đúng address field hoặc có nhiều WebViews sẽ BLOCKED; chưa phủ mọi redirect/ad/product/video thực. Freshness/grant vẫn 5 s: DOM preflight chậm có thể chặn **trước click**, không nới freshness để qua bài. Cần đo trên máy thật mới quyết định có vấn đề hiệu năng. P2, 2+, temporal và 3.4 ngoài phạm vi; không sửa test hay workflow để làm chúng PASS.

Kế hoạch chỉ thực hiện sau khi chủ thiết bị cho phép:

1. Chuẩn bị ngoài timing: USB đúng Samsung `R58MA78W6QK`, mở khóa hoàn toàn, người dùng tạm giữ sáng/tắt tự khóa nếu đồng ý; chỉ sau cấp phép mới chạy `adb devices -l` để xác nhận `device`. Không tự vượt keyguard/đổi setting. Next/Worker idle và nạp current source qua restart graceful, không force kill. Không chấp nhận consent/login/permission.
2. Ba lượt cùng câu mẫu công khai: `Mở Chrome, tìm vòng tuần hoàn của nước và mở bài đầu tiên`. **Chọn Agent V2 rõ ràng trước Phân tích**, vì Auto chưa đổi. Kiểm plan engine=V2, đủ LAUNCH/SEARCH/OPEN_RESULT, query/ordinal1 chính xác; không đổi engine sau dispatch, không dùng result fixture để chọn sẵn URL thật.
3. Mỗi lượt ghi analyze/execute latency riêng, model calls/provider, RPC/ADB counts, Session/owner cleanup. Chỉ đọc/mở article công khai; không tải file, đăng nhập, gửi, mua, xóa hoặc chấp nhận consent. Có prompt lạ thì dừng, không tự click. Navigation history có thể phát sinh như việc duyệt web thông thường.
4. Mỗi claim COMPLETED phải có registered prior-search proof, ordered organic identity, destination URL/title/ready-state + manual screenshot/native comparison. Tiêu chí đạt: **3/3 COMPLETED, 0 false completion/3 claimed completions**. Giữ nguyên screenshot/evidence, không dọn dữ liệu.
5. Bất kỳ BLOCKED/UNKNOWN chưa giải thích được: dừng tại trạng thái đó, ghi lý do và P1 “ngoài demo” cho đến khi giải quyết; không replay effect UNKNOWN, không thử lượt thứ tư. Không đổi verifier/fallback để tiếp tục nghiệm thu. Cuối cùng Session/owner/task phải được release, owner mode của lượt thử OFF.

### 14.8 Lệnh Windows và điểm dừng

Chỉ tái lập offline theo manifest, không glob toàn bộ tests. Không cần chạy dev server/Android để kiểm thử offline. Log evidence UTF-16LE do PowerShell redirect cũ có thể cần đọc theo BOM; các JSON/Node-spawn logs mới là UTF-8.

```powershell
$dir = 'coverage/engine-merge-p1-HkwLY2'
$m = Get-Content "$dir/source-before.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$files = @($m.tests | ForEach-Object { Join-Path tests $_ }) + 'tests/engine-merge-p1-v2.test.cjs'
& 'C:\nvm4w\nodejs\node.exe' --test --test-concurrency=1 $files
& 'C:\nvm4w\nodejs\node.exe' node_modules/typescript/bin/tsc --noEmit --incremental false
$exclusions = @('--ignore-pattern','**/*holdout*','--ignore-pattern','**/*holdout*/**',
  '--ignore-pattern','**/*sealed*','--ignore-pattern','**/*sealed*/**',
  '--ignore-pattern','tests/general-agent-v2-open-world.test.cjs')
$after = Get-Content "$dir/source-final.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$changed = @($after.changed) + @($after.added)
& 'C:\nvm4w\nodejs\node.exe' node_modules/eslint/bin/eslint.js $changed @exclusions
& 'C:\nvm4w\nodejs\node.exe' node_modules/eslint/bin/eslint.js . @exclusions
# Đã chạy đúng một lần trong P1; không retry/upgrade/bypass trong lượt này:
& 'C:\nvm4w\nodejs\node.exe' node_modules/next/dist/bin/next build --webpack
git diff --check
```

Thư mục evidence giữ baseline/final/source-parity/test-development logs và JSON hash/validation/build/safety nêu trên; không commit/push hoặc dọn logs. Báo cáo cập nhật ngoài tập hash source. AGENTS feedback pass: diagnostic SecurityFatalError vẫn cùng issue đã có draft ở Giai đoạn 2, không phát sinh issue Next.js mới cần một bản feedback trùng; không thực hiện upgrade theo build output.

**DỪNG SAU GIAI ĐOẠN 3.1 P1.** Chờ chủ thiết bị cấp phép ba lượt Android nêu trên. Không tự chuyển P2, 3.3, 3.4, temporal acceptance hoặc gỡ engine; không commit/push.

## 15. Giai đoạn 3.4: DỪNG tại kiểm tra tương thích legacy entry

Ngày: **24/10/2026** (Asia/Bangkok). Đây là preflight/khảo sát chỉ đọc và báo cáo, **chưa triển khai 3.4**. Yêu cầu mới chủ động cho phép chuyển 3.4, nhưng đồng thời bắt buộc STOP nếu legacy gate làm hỏng test cũ gọi trực tiếp route. Xung đột đã có bằng chứng source; không sửa code để tạo failure rồi sửa test ngoài quyền.

### 15.1 Chuẩn bị và phạm vi bảo toàn

- Branch `DuyTD`, HEAD vẫn `01525d92412eb1779855beec0e359037a79873d0`; đã chạy git status, đọc source entry/route/contract/worker và báo cáo. Tạo `backup-before-stage34` tại HEAD, không checkout/commit. Đã nhắc chủ dự án: nhánh này **không chứa working tree dirty/untracked**, cần sao lưu riêng.
- Tham số P1_STATUS trong yêu cầu còn là placeholder. Theo bằng chứng mục 14 chưa có ba lượt Android, dùng **PENDING** làm giả định preflight, tương ứng mục tiêu **EXPERIMENTAL**, không coi là chứng nhận. Chưa ghi trạng thái này vào runtime/config.
- Không sửa source/test/config/provider/dependency; không archive/xóa file. Hai deleted components cũ vẫn là trạng thái có sẵn. Không chạm ConditionExecutor, shared executor/verifier/grounding/permission/journal/lock/cancel. Chưa thay engine selector, API schema hay group controls.
- Không chạy Android/Appium/ADB/Ollama/cloud hoặc API của dịch vụ thật; không đọc/import sealed/holdout hoặc test có dependency bị cấm. Baseline dùng manifest 67 file của P1; loại open-world test và mọi path sealed/holdout trước scan/hash. Lint luôn có năm `--ignore-pattern` như mục 13.8.
- Evidence mới, không dọn evidence cũ: `coverage/engine-merge-stage34-PRuDhP/`. Hash trước 303 source/test/script files: `bd830cfc410938918bad07402f65b53f7637630227374a1b444c2188a596506d`, khớp cuối P1. Thuật toán giữ nguyên mục 13.1; không đọc/hash env/secrets hay dữ liệu người dùng.

### 15.2 Entry audit hiện trạng, chưa áp dụng gate

Các file/dòng là source thực đọc trong lượt này. “Qua router” chỉ nói Unified capability-router, không đồng nghĩa policy/grant đã bị bỏ qua ở đường khác.

| Entry/hook/component | Ai gọi, engine/loop đích | Qua router? | Test/consumer đã tìm thấy |
|---|---|---|---|
| `app/api/unified-agent/route.ts:58` POST | Default UnifiedAgentPanel; acceptance scripts M7a/Fix; ANALYZE/EXECUTE/CLARIFY/REANALYZE, CONFIRM/ASSIST/CANCEL | Có khi analyze trong service; vẫn có ACTION_PLAN/V1/V2, không phải V2-only | unified-agent-m7a, m7a-fixes, unified-engine-coverage, P1-v2, boundaries |
| `app/api/unified-agent/route.ts:35,36,50` adapters | AP gọi interpret/executions in-process; V1/V2 PREPARE/START_PREPARED ở worker | Đã chọn engine trước adapter | service parity tests; gate AP route phải được xét cùng adapter, không chặn rồi âm thầm fallback |
| `app/api/agent/route.ts:8,13` POST | API tương thích single task, START không agentVersion → V1 `runAgent` | Không | m5b-security kiểm same-origin; chưa thấy default panel gọi route này trong scan UI/hooks/scripts, không gọi nó là dead code |
| `app/api/agent/runtime/route.ts:18` POST | useAgentRuntimes, AgentGoalPanel, scripts agent-v2-acceptance/M4d/M6a/M6c và M7a control plane; START forwarded nguyên command | Không | runtime-schema:6 cho agentVersion=2 hoặc thiếu → V1; multi-device-runtime/owner tests, m5b-security và worker integration |
| `app/api/agent/runtime/route.ts:4` GET | Poll trạng thái/evidence, owner/task state | Không khởi chạy goal loop | GET có thể gọi workerRequest để đảm bảo worker hiện hữu; không đồng nhất worker process với Session/task |
| `app/api/agent/assistance/route.ts:12` POST | CONFIRM/CANCEL/STOP cho task đã có, fallback lookup worker `:25`; không START | Không; trả choice/cancel về engine đang sở hữu | autonomous-task; m5b-security. Cần giữ để không khóa đường dừng/assistance phiên cũ |
| `app/api/executions/route.ts:24,94,116` POST | useDashboardDemo và AP adapter Unified; action-plan authorization, Wi-Fi confirmation, createExecutionContext rồi loop actions | Không nếu gọi trực tiếp | **wifi-confirmation-route gọi POST thật với fake adapter**, m5b-security, unified-agent-m7a invalid schema; dashboard-execution-logs dùng fetch stub, không phải route thật |
| `app/api/commands/interpret/route.ts:26,45,67` POST | useDashboardDemo và Unified AP adapter; Wi-Fi/Chrome rule trước queued Ollama | Không nếu gọi trực tiếp | **chrome-command-planning gọi POST thật với fake model transport**, m5b-security, unified-agent-m7a invalid schema |
| `components/commands/AICommandPanel.tsx:46,155` | Export LegacyAICommandPanel còn cho AP/AgentGoalPanel; default AICommandPanel render UnifiedAgentPanel | Legacy không qua; default qua Unified | Safe refactor/UI và dashboard tests; export không mặc định render không phải lý do để xóa |
| `hooks/useDashboardDemo.ts:142,219,236` | Legacy analyze/execute, confirmation retry qua interpret/executions | Không | dashboard-execution-logs mock fetch; không xác nhận public route đã gated |
| `components/commands/AgentGoalPanel.tsx:78` + `hooks/useAgentRuntimes.ts:36` | START batch jobs, version2 thêm agentVersion; default version thiếu là V1. Results/owner/ASSIST/CANCEL cùng component | Không | command-engine-controls group assertion; owner/multi-device tests. Unified còn render group tại `UnifiedAgentPanel.tsx:158` |
| `components/commands/CommandEngineControl.tsx:6`, `UnifiedAgentPanel.tsx:53,96` | Chọn debugEngine, không trực tiếp execute; input gửi tới ANALYZE | Qua Unified khi analyze | command-engine-controls; unified-agent-m7a Dashboard markup; component chưa bị ngừng render |
| Worker `agent/worker-server.ts:93,116`, `agent/device-runtime.ts:84,251,271` | /planning PREPARE/START_PREPARED và /tasks START, registry chọn runAgentV2 hay runAgent theo job | Raw START/PREPARE không qua Unified router | worker/runtime tests. Đây là đường bổ sung phải xét khi thực sự bảo đảm không bypass catalog; chỉ sửa panel không đủ |

`lib/android/unified-agent/contracts.ts:12` còn nhận debugEngine; `capability-router.ts:23` còn công thức chọn AP/V1/V2; `:24` chỉ có ngoại lệ P1 forced V2. Chưa có module catalog ENABLED/EXPERIMENTAL/DISABLED hoặc hằng gate legacy entry. Vì đã dừng, **không có cách bật/tắt gate mới để hướng dẫn**; không dùng env hay test-only bypass để giả vờ đã gate.

### 15.3 Xung đột bắt buộc STOP: danh sách test và bằng chứng

`tests/wifi-confirmation-route.test.cjs:25` import trực tiếp **POST public route**. Mock chỉ thay ADB/ConditionExecutor thành counters; kiểm tra route/authorization/confirmation thật, không phải chỉ router mock. Bốn test sau vừa bảo vệ an toàn vừa khẳng định route có thể chạy. Default gate trước Session/start không thể đồng thời thỏa các assertion 200 + Session tăng này.

| Test hiện có (tên nguyên văn) | Source assertion | Gate mặc định từ chối sẽ xung đột gì? |
|---|---|---|
| `enable confirmation is explicit, bound to ON and cannot authorize OFF` | `wifi-confirmation-route.test.cjs:41`, accepted status 200/Session +1 tại `:50` | Valid confirmation phải thực thi, trong khi gate đòi không dispatch. Token sai/replay vẫn cần giữ nguyên bảo vệ |
| `route never opens Session before confirmation; confirmed request runs once on the bound device` | `:54`, status 200 tại `:63`, success/2 actions/close tại `:65` | Test kiểm đúng thiết bị, one-shot và release; gate phải chặn cả valid request này |
| `connection confirmation authorizes one exact SSID, not other networks or general input actions` | `:70`, accepted join status 200/Session +1 tại `:81` | SSID mới yêu cầu DISABLED ở 3.4, test route lại bắt buộc cho phép sau exact confirmation |
| `local development skips Wi-Fi confirmation without disabling same-origin enforcement` | `:87`, dev local request status 200/Session +1 tại `:94` | Gate mặc định không phụ thuộc env phải chặn; không thể tự đặt exception development để giữ test mà vẫn đáp ứng yêu cầu |
| `interpret endpoint returns complete Chrome plan locally and rejects malformed model plans` | `chrome-command-planning.test.cjs:78`, import POST `:22`, status 200/ordinal2 tại `:83` | Legacy interpret phải default reject trước planner, test bắt buộc trả plan Chrome ordinal2. Không thuộc nhóm router/Unified engine-choice hoặc command-engine-controls được sửa |

**VERIFIED_IN_SOURCE:** các assertion/import/status trên tồn tại và route hiện có đường thực thi. **INFERRED (không giả thành test run FAIL):** nếu áp default-off gate như yêu cầu, ít nhất năm test nêu trên sẽ vi phạm expectation hiện tại. **VERIFIED_BY_TEST_RUN:** baseline chưa sửa vẫn PASS. Chưa tạo gate để cố tình làm suite FAIL; không tuyên bố đã có run gate-on để đo số failure chính xác.

Các test m5b-security và unified-agent-m7a invalid-schema cũng gọi route; mức ảnh hưởng còn phụ thuộc đặt gate trước hay sau same-origin/schema checks. Không kết luận chúng FAIL khi chưa có implementation. Các router/UI tests có thể được thay theo ngoại lệ mục 5, nhưng ngoại lệ đó **không bao trùm bốn test an toàn trên**. 6 TODO boundaries vẫn giữ nguyên; chưa có test PASS mới để nói đã phủ gate.

### 15.4 Phương án đề xuất cần duyệt, CHƯA THỰC HIỆN

Phương án khuyến nghị để giữ coverage mà không giữ API bypass:

1. Cho phép tách legacy request handler nội bộ khỏi entry public ở interpret/executions, không đổi ConditionExecutor/policy/verifier; public route dùng gate hằng số mặc định OFF và thông điệp rõ ràng. Same-origin/schema/DENY ưu tiên cần được test riêng, không lẫn với legacy capability availability.
2. **Cần mở rộng quyền sửa đúng năm test nêu trên:** chuyển đích gọi sang handler legacy nội bộ để giữ characterization engine cũ; giữ nguyên các assertion exact device/SSID, confirmation expiry/replay, no Session before confirmation, same-origin, malformed plan và cleanup. Không xóa test, không đổi expected success thành PASS giả. Test đổi target phải được mô tả trung thực là handler test, không còn là production-route test.
3. Thêm file test mới cho public route gate mặc định từ chối trước discovery/planner/Session, Unified V2-only/catalog và CANCEL/ASSIST/GET không bị chặn. New public-route tests phải gọi entry production thật, không mock gate thành ON hay nhận env/client flag. Internal handler không được có URL truy cập công khai ngoài gate.
4. Sau khi duyệt phạm vi đó mới sửa router/catalog/UI; giữ source/device/TTL/single-use và fail-closed toàn câu. Worker/raw V2 START cũng cần bị kiểm catalog để API nhóm không bypass safe-capability cut. Không đổi engine loops hay shared security modules.

Phương án khác là làm riêng Unified router/UI rồi **giữ legacy API chạy**, nhưng không đáp ứng yêu cầu “một đường chạy” và mục 3.4 default deny; chỉ thực hiện khi chủ dự án chủ động thu hẹp yêu cầu, không tự chọn phương án này. Không dùng runtime phát hiện test hoặc preloader để public gate tự mở và che regression.

Đề xuất trên chưa được cấp phép trong lượt này. **Không có hằng gate mới, catalog mới, test sửa/mới hoặc source port nào được tạo.** Không tự suy rằng mục tiêu hợp nhất cho phép bỏ qua lệnh STOP hoặc cấm sửa test an toàn.

### 15.5 Catalog mục tiêu và trạng thái thực tế sau khi dừng

Cột catalog là **yêu cầu dự kiến, chưa có runtime enforcement**. Nhãn offline áp cho capability/tests sẵn từ P1/baseline, không phải chứng minh Stage3.4 được triển khai. Không có Android mới hoặc đo model inference trong lượt này.

| Khả năng | Catalog mục tiêu (CHƯA ÁP DỤNG) | Nhãn/evidence hiện có | Engine/đường hiện còn chạy | Model calls mới |
|---|---|---|---|---|
| Mở app/Settings | ENABLED | OFFLINE_TESTED baseline, mục 13.6 | V2 có contract; legacy AP/V1 entry chưa gated | Không đo inference |
| Đọc pin/Wi-Fi/độ sáng | ENABLED | OFFLINE_TESTED read-state tests | V2 typed INTENT/READ_STATE | Không đo |
| Đổi Wi-Fi/độ sáng/DND có journal/restore | ENABLED | OFFLINE_TESTED M4d, không đổi setting thật | V2; AP Wi-Fi vẫn tồn tại ở entry cũ | Không đo |
| Chụp ảnh, quay số điền sẵn, tính toán | ENABLED | OFFLINE_TESTED M6a/M4b/runtime | V2; giữ nguyên capability hiện có | Không đo |
| Tìm trong app đã có bằng chứng | ENABLED, cần hạn chế theo evidence | OFFLINE_TESTED search suites; phạm vi thật như lịch sử, không tự mở rộng app | V2 search; legacy search entry còn nguyên | Không đo |
| Hỏi sáng/chiều | ENABLED | OFFLINE_TESTED temporal/boundary | Unified clarification → V2 prepare | Không đo |
| P1 Chrome query + first organic | EXPERIMENTAL (giả định P1_STATUS=PENDING) | OFFLINE_TESTED P1; Android current UNVERIFIED | Forced V2 nhận; Auto câu mẫu vẫn V1 | m=0 chỉ fixture P1 đã chạy, không phải real model measurement |
| Alarm/timer | EXPERIMENTAL | OFFLINE_TESTED, positive create/running Android vẫn UNVERIFIED/BLOCKED như lịch sử | V2 có contract/verifier, chưa có cảnh báo catalog mới | Không đo |
| SSID, record/notes, Gallery, URL/Maps | DISABLED | Gate 3.4 UNVERIFIED/chưa triển khai, 6 TODO cũ chưa được phủ mới | Một số legacy/V2 paths vẫn tồn tại như mục 13.7 | Không đo |
| Bluetooth/rotation/volume/flashlight/airplane | DISABLED | Gate chưa triển khai; existing setting verifier có thể BLOCKED, không phải catalog DENY | Registry/entry hiện có chưa bị gate | Không đo |
| YouTube ordinal/P2; mọi ordinal>1 | DISABLED | Forced V2 ASK hiện có OFFLINE_TESTED; **global gate chưa có** | Auto/V1/AP vẫn có thể nhận legacy ordinal | Không đo |
| Ngoài danh mục/câu trộn DISABLED | Từ chối toàn câu | Source safety cũ có DENY destructive; safe demo-cut gate chưa có | Chưa thay hành vi | Không đo |
| Xóa/gỡ/ghi đè/reset/câu trộn destructive | DENY ưu tiên cao | OFFLINE_TESTED safety/boundaries, giữ nguyên | Không được cấp quyền bởi owner/full-control | Không đo |

**Không được tuyên bố** “hợp nhất ở tầng giao diện và định tuyến” cho Stage3.4 này: UI và router còn nguyên, debug engine vẫn gửi được trong ANALYZE. Mã cũ chưa archive/xóa; chưa kiểm Dashboard bằng trình duyệt thật; không có Android nghiệm thu mới. P1 chỉ OFFLINE_TESTED, không nâng thành REAL_ANDROID_VERIFIED.

### 15.6 Validation và hash sau lượt

Baseline đã khởi chạy trước khi phát hiện xung đột; để nó hoàn tất tuần tự, không force kill. Chỉ fake adapters/HTTP loopback/TEMP theo manifest, không live device/model.

| Kiểm tra | Kết quả | Evidence |
|---|---|---|
| Baseline regression, 67 file | **1218 PASS / 0 FAIL / 6 TODO / 1224 entries**, 0 skip/cancel; khớp P1 | 201.692 s TAP (wrapper 201.815 s), `baseline-regression.log` |
| Baseline TypeScript | **PASS**, exit 0, 30.940 s | `baseline-typecheck.log`, `baseline-validation.json` |
| Baseline full lint với năm exclusions | **PASS**, exit 0, 164.824 s; 0 errors/3 warnings cũ FileJson/cn/Maximize2 | `baseline-eslint.log`, `baseline-validation.json` |
| Final regression/scoped lint/build Stage3.4 | **NOT_RUN**: STOP trước mọi sửa source/test; chưa có implementation để nghiệm thu | Không dùng kết quả P1 để báo gate PASS; không chạy build chỉ để tiếp giai đoạn đã bị yêu cầu dừng |
| Production build gần nhất (lịch sử P1, không chạy lại lượt này) | FAIL SecurityFatalError; không phải lỗi mới do 3.4 | Mục 14.6, `coverage/engine-merge-p1-HkwLY2/final-webpack-build.log` |
| Source hash sau lượt, diff/scope checks | **303 file cùng SHA-256 như trước, changed=[], added=[]; diff exit 0**, report không trailing whitespace/token pattern độ tin cậy cao | `source-check.json`; chỉ report đổi, secret-pattern scan giới hạn report, không audit config/secrets |

Lệnh baseline thực chạy ngoài sandbox để TEMP/loopback cùng môi trường P1; không đổi source/env để né failure. Không có scoped lint source mới vì không có file source/test đổi. Không upgrade/retry/bypass security check. Không phát sinh Next.js issue mới trong lượt chỉ đọc này để tạo feedback trùng.

```powershell
git branch --list backup-before-stage34
$dir = 'coverage/engine-merge-stage34-PRuDhP'
$m = Get-Content "$dir/source-before.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$files = @($m.tests | ForEach-Object { Join-Path tests $_ })
& 'C:\nvm4w\nodejs\node.exe' --test --test-concurrency=1 $files
& 'C:\nvm4w\nodejs\node.exe' node_modules/typescript/bin/tsc --noEmit --incremental false
& 'C:\nvm4w\nodejs\node.exe' node_modules/eslint/bin/eslint.js . --ignore-pattern '**/*holdout*' --ignore-pattern '**/*holdout*/**' --ignore-pattern '**/*sealed*' --ignore-pattern '**/*sealed*/**' --ignore-pattern 'tests/general-agent-v2-open-world.test.cjs'
git diff --check
```

Source/test/config sửa: **0**. Report cập nhật: **1**. Evidence generated mới: chỉ dưới coverage mới. Không sửa bất kỳ test cũ nào, không bỏ/chuyển 6 TODO, không tạo test né gate. Không commit/push hoặc triển khai P2/temporal/Teach Mode. **DỪNG chờ chủ dự án duyệt cách xử lý xung đột test trước khi triển khai Stage3.4.**

## 16. Giai đoạn 3.4 — triển khai, STOP khi runtime catalog xung đột test gốc

Ngày **24/10/2026** (Asia/Bangkok). Chủ dự án đã duyệt tách handler và chuyển đúng năm test ở mục 15.3 sang handler nội bộ, nhưng vẫn bắt buộc STOP nếu xuất hiện failure khác. Lượt này **không hoàn thành 3.4**: nhóm handler/public gate đã PASS; nhóm runtime admission phát hiện failures ngoài quyền sửa nên dừng mọi chỉnh sửa source/test. Chỉ tiếp tục validation offline đã yêu cầu để ghi nguyên trạng và báo cáo. Không tự rollback/rewrite test, không tự chuyển bước khác.

### 16.1 Chuẩn bị và nguồn baseline

Đã đọc yêu cầu tiếp tục, kiểm git status và đối chiếu mục 14/15. `DuyTD`, HEAD không đổi; `backup-before-stage34` đã có, **không tạo lại**. Giữ tất cả thay đổi modified/untracked/deleted từ trước. Không commit/push/stash/reset/checkout, xóa/archive file, đổi env/config/provider/dependency, bật cloud hoặc gọi Android/Appium/ADB/Ollama/cloud thật. Test dùng fixture, fake adapters và HTTP loopback.

Evidence mới: `coverage/engine-merge-stage34-implementation-JxyZAm/`. `source-before.json` xác minh lại **303 file** có cùng digest `bd830cfc410938918bad07402f65b53f7637630227374a1b444c2188a596506d`; không đổi so baseline mục 15.6. Dùng lại run baseline cùng hash: 1218 PASS/0 FAIL/6 TODO, TypeScript/lint PASS; không giả là vừa chạy thêm một baseline full trong lượt tiếp tục. Sau nhóm handler có một đối chứng targeted mới trên source đã sửa, ghi ở mục 16.6.

Manifest 67 file baseline + một file mới = 68. Loại sealed/holdout trước đọc/hash/scan; không import test open-world có dependency bị cấm. Lint luôn có năm exclusions CLI. Không glob toàn bộ tests. Hash không gồm docs/generated/config và không phải worker digest. Không đọc/copy API keys hoặc sửa cấu hình bí mật.

### 16.2 Nhóm handler/public gate đã thực hiện

1. Chuyển nguyên logic xử lý cũ sang `lib/android/unified-agent/legacy-interpret-handler.ts:26` (`handleLegacyInterpret`) và `legacy-execution-handler.ts:24` (`handleLegacyExecution`). Export schema tương ứng để public wrapper validate. **Thứ tự và nội dung logic nội bộ giữ nguyên**, chỉ đổi tên schema/function và export schema; không sửa prompt/planner, policy, verifier, ConditionExecutor, grant hay journal.
2. Public `/api/commands/interpret`, `/api/executions` nay là wrapper. Kiểm same-origin → schema (và serial nếu execution) → source/plan DENY → availability gate. Dùng `request.clone()` để schema kiểm không consume request body đưa cho handler. Invalid schema vẫn 400, foreign origin vẫn 403, destructive source vẫn 403, invalid plan vẫn 422; valid request bị gate trả 410 `LEGACY_ENTRY_DISABLED` **trước discovery/inference/Session/start**.
3. `/api/agent` POST và **mọi START qua `/api/agent/runtime`** (V1 lẫn V2) dùng cùng gate sau origin/schema/source checks. GET, CANCEL, CANCEL_BATCH, ASSIST_V2 và route assistance STOP/CONFIRM/CANCEL không bị gate. Không tự đổi START cũ thành V2 hoặc phát quyền thay người dùng.
4. Một hằng duy nhất ở `lib/android/unified-agent/legacy-entry.ts:2`: **`LEGACY_ENTRY_ENABLED: boolean = false`**. Thông điệp hướng về `/api/unified-agent`. Không env, client flag hoặc test detection mở gate. Cách mở lại legacy entry: chỉ sửa hằng này trong source rồi nạp/rebuild code; việc đó chủ động khôi phục đường legacy, **không** đồng nghĩa cho quyền/bỏ policy hay hoàn thành hợp nhất. Không bật hằng trong lượt này.

`handler-extraction-check.json` đối chiếu text handler với route trước sửa (chuẩn hóa CRLF/LF, chỉ áp ba đổi tên/export); cả hai **exactBodyPreserved=true**. AST so sánh **39 assert calls** trong file Wi-Fi và **32 assert calls** trong file Chrome với bản trước: tất cả giữ nguyên, không hạ expected hay thêm điều kiện bỏ test.

### 16.3 Năm test cũ được sửa có giới hạn

Trong file Wi-Fi, import `POST` được đổi thành alias `handleLegacyExecution` từ module nội bộ. File Chrome tương tự với `handleLegacyInterpret`. Không thay body/assertions ở bất kỳ test nào; chỉ đổi import và title để không gọi đây là production-route acceptance. Sáu test helper/planner khác trong file Chrome không đổi.

| Tên cũ | Tên/đích mới | Lý do và bảo vệ giữ nguyên |
|---|---|---|
| `enable confirmation is explicit, bound to ON and cannot authorize OFF` | Thêm prefix `internal legacy handler:`; `wifi-confirmation-route.test.cjs:41` | Giữ explicit ON/OFF, exact token, expiry/replay, một Session sau xác nhận; public route mới không còn cho dispatch |
| `route never opens Session before confirmation; confirmed request runs once on the bound device` | `internal legacy handler never opens Session before confirmation; confirmed request runs once on the bound device`, `:54` | Giữ same-origin, bound device, 2 actions, one-shot và close |
| `connection confirmation authorizes one exact SSID, not other networks or general input actions` | Prefix handler, `:70` | Giữ exact SSID, không authorize mạng khác/input chèn thêm, replay không chạy |
| `local development skips Wi-Fi confirmation without disabling same-origin enforcement` | Prefix handler, `:87` | Giữ fixture dev behavior của core cũ, foreign origin bị từ chối, forbidden target và cleanup; không dùng dev env để mở public gate |
| `interpret endpoint returns complete Chrome plan locally and rejects malformed model plans` | `internal legacy interpret handler returns complete Chrome plan locally and rejects malformed model plans`, `chrome-command-planning.test.cjs:78` | Giữ exact ordinal/query/address bar, 0 model cho rule và reject malformed model plan |

**Không sửa** m5b-security, owner/full-control, multi-device-runtime, read-state tests, anti-replay, 6 TODO hoặc router/UI tests khác. Chưa cần dùng ngoại lệ chỉnh router/Unified/command-engine-controls vì chưa sang nhóm đó. Public production wrappers được test riêng trong file mới, không mock gate thành ON để tái dùng năm test handler.

### 16.4 Catalog và runtime admission: có code, CHƯA ĐẠT

Thêm một module typed `lib/android/unified-agent/demo-catalog.ts`: status ENABLED/EXPERIMENTAL/DISABLED, label/message/evidence, danh sách state/app được phép, và `requireDemoCapabilities`. P1_STATUS=PENDING → BROWSER_FIRST EXPERIMENTAL/UNVERIFIED; alarm/timer cũng EXPERIMENTAL. Đây chỉ là catalog availability, **không phát execution grant**.

`DeviceRuntimeRegistry.prepare:52` kiểm catalog trước discovery/planner; `start:159` kiểm toàn bộ safe jobs trước discovery/scheduling. `startPrepared` vẫn delegate vào start với original source/device/reference, không thêm trường hay đổi wire contract. Existing hard-DENY START giữ đường tạo **zero-effect BLOCKED audit task** như trước (m5b-security đòi HTTP 200 + task BLOCKED), không cho effect; prepare hard-DENY vẫn bị từ chối trước catalog. Không sửa permission-decision/effect grants/locks/cancellation hoặc enum runtime commands. Worker-server vẫn gọi registry như cũ; chưa đổi hợp đồng worker để vượt test.

File mới `tests/engine-merge-catalog-gate.test.cjs` có **39 tests**: 13 kiểm public gate/origin/schema/DENY/control-plane forwarding; 14 kiểm raw prepare/start bị chặn cho các nhóm demo-cut/mixed/outside; 12 kiểm status/nhãn của nguồn ENABLED/EXPERIMENTAL. Test dùng production route functions với worker/ADB/model fake; fetch thật fail-on-call. Không Session thật hoặc metric Android mới.

**Kết quả runtime catalog không PASS.** 6 TODO cũ giữ nguyên. Các nhóm SSID/record/Gallery/Maps/Bluetooth trong file mới có PASS offline; **URL TODO FAIL**, nên không được nói “6 TODO đã được phủ PASS”. Rotation/volume/flashlight/airplane, YouTube ordinal, ordinal>1, outside và mixed có PASS trong new test, nhưng chưa có integration với Unified router/UI. Các assertion này không phải chứng minh router cũ đã V2-only.

### 16.5 Failure taxonomy và điều kiện STOP thực sự đã xảy ra

Evidence `runtime-catalog-parity.log` có **133 PASS/7 FAIL/140 entries**, không TODO. Bốn test gốc không thuộc năm test được duyệt bị FAIL; đã báo ngay và dừng chỉnh sửa. Full regression sau đó ghi thêm một failure gốc về diagnostic. Không sửa test để ép PASS, không hạ catalog thành allow P2/widget lạ, không cho adapter mock bypass gate.

| Nhóm / test hoặc case | Root cause có bằng chứng | Xử lý sau STOP |
|---|---|---|
| `multi-device-runtime.test.cjs:232` — `SIMULATION: Human Assistance is bound to device/execution/token; confirming A never resumes B` | Fixture START dùng YouTube video thứ hai (`:235`); raw catalog trả CAPABILITY_DISABLED ordinal>1 trước task/Session, nên không đến WAITING_HUMAN | Test giữ nguyên; cần duyệt đổi fixture sang capability ENABLED mà vẫn giữ token/device/execution/replay/cancel/close assertions |
| Cùng file `:311` — `SIMULATION HTTP: polling excludes image bytes; evidence is fetched only for the matching waiting device` | Cùng fixture P2/ordinal2 tại `:318`; không thể vào WAITING_HUMAN để kiểm fetch evidence | Test giữ nguyên; không mở P2 chỉ để test polling PASS |
| `owner-authorized-test-mode.test.cjs:109` — `runtime validates selected physical identity and V2 opt-in; restart never restores authority` | Goal chung `Mo org.unprofiled.display va bat Show labels` ngoài catalog settings; admission chặn trước khi kiểm completion của owner fixture | Không sửa test owner; không rộng owner scope hay bỏ catalog |
| Cùng file `:126` — `disabling mode cancels an active owner execution but leaves another device waiting for technical assistance` | Cùng generic switch goal ngoài catalog, bị chặn trước DEVICE_UNLOCK assistance | Không sửa test; cần duyệt fixture dùng một capability ENABLED, giữ mọi authority/identity/cancel/restart assertions |
| `read-state-semantics.test.cjs:142` — `OFFLINE an unresolved mixed clause blocks preparation without dropping the read` | Vẫn reject unresolved mixed source, nhưng lỗi mới CAPABILITY_DISABLED không khớp contract regex `UNSUPPORTED_OUTCOME\|NEEDS_CLARIFICATION` tại `:146` | Không sửa test. Đây là regression diagnostic của catalog; có thể sửa **code catalog mới** để giữ diagnostic cũ sau khi được phép tiếp tục |
| **Test mới**: URL TODO | `matchIntentSource('open url https://example.com')` trả null vì không có URL slot toàn chuỗi. `understandOutcomes` coi là LAUNCH app=`url https://example.com`; catalog fallback OPEN_APP nên **không reject như yêu cầu** | Bug catalog mới, không phải lỗi môi trường; không dựa vào downstream app discovery để gọi gate an toàn. Chưa sửa sau STOP |
| **Test mới**: `set dnd 0` | Pure intent matcher có binding SET_DEVICE_STATE đúng; classifier chọn SET_STATE nhưng guard vẫn reject ambiguity UNSUPPORTED_OUTCOME của raw UNKNOWN outcome | Bug overblocking của code catalog mới. Cần áp binding đã validate thay vì giữ ambiguity của raw parse; không sửa shared planner/security |
| **Test mới**: P1 không dấu | Test dùng `Mo Chrome, tim ocean va mo bai dau tien`; browserResultRequest hiện chỉ có explicit grammar có dấu của P1 (mục 14.7), trả null nên catalog không có typed browser-first scope | Sai kỳ vọng của test mới, không chứng minh P1 có dấu FAIL. Khi tiếp tục, dùng câu nằm trong contract P1 và ghi riêng giới hạn không dấu, không broaden parser để ép test PASS |

`catalog-failure-analysis.json` là probe **pure/read-only** cho ba case mới, lưu raw outcomes/binding/slots/browser result; không gọi model/device. Full run có **5 test gốc FAIL + 3 test mới FAIL**. Không gộp các nguyên nhân thành “cần thêm quyền chủ thiết bị”: đây là xung đột availability/test contract và bug mới trong catalog, không phải owner chưa cấp phép.

Đề xuất cần duyệt trước khi tiếp tục: cho đổi **chỉ fixture input/adapter** của bốn test Human Assistance/owner nêu trên sang nhiệm vụ ENABLED, giữ nguyên mọi assertion an toàn; không đổi test read-state, thay vào đó sửa diagnostic ở catalog mới. Sửa hai bug catalog mới và fixture P1 mới trong phạm vi code/test vừa tạo. Không đề xuất sửa permission/journal/grant hoặc hợp đồng worker để né failures. Chưa thực hiện đề xuất này.

### 16.6 Validation thực và giới hạn

Chạy tuần tự, không chồng các lệnh validation; đọc source/probe pure giữa các lượt không phải số đo engine latency. Full run gồm manifest có loại trừ, không tuyên bố full suite không ngoại lệ.

| Lượt | Kết quả | Evidence / wall time |
|---|---|---|
| Baseline cùng hash trước sửa, tái dùng mục 15.6 | 1218 PASS / 0 FAIL / 6 TODO | Evidence mục 15, xác nhận hash mới trong source-before.json |
| Nhóm handler/public gate + m5b-security + Unified (5 files, new test lúc đó 13 cases) | **94 PASS / 0 FAIL** | `legacy-entry-parity.log/json`, 10.533 s TAP |
| TypeScript/scoped lint sau nhóm handler | **PASS / PASS** | `legacy-entry-validation.json`, 14.784 s / 18.942 s |
| Nhóm runtime catalog đối chứng (5 files, test mới đủ 39 cases) | **133 PASS / 7 FAIL**, không skipped/cancelled | `runtime-catalog-parity.log/json`, 12.842 s TAP |
| Full regression current patch, 68 files | **1249 PASS / 8 FAIL / 6 TODO / 1263 entries**, không skipped/cancelled | `final-regression.log`, 140.824 s TAP (wrapper 140.934 s) |
| Phần test cũ trong full | **1213 PASS / 5 FAIL / 6 TODO** | So với 1218/0/6, đúng năm failures gốc bảng trên; giữ nguyên nội dung các test đó |
| New file trong full | **36 PASS / 3 FAIL / 39 tests** | Không dùng new tests PASS để che regression cũ hoặc failure gate URL |
| Final TypeScript | **PASS**, exit 0, 15.269 s | `final-typecheck.log`, `final-validation.json` |
| Final scoped ESLint, 12 file source/test đổi/mới | **PASS**, 0 warning/error, 19.325 s | `final-scoped-eslint.log` |
| Final full ESLint với năm exclusions | **PASS**, 0 errors/3 warnings cũ, 19.805 s | `final-eslint.log`; FileJson/cn ở ActionPlanPreview, Maximize2 ở DeviceFilters |
| Đúng một webpack production build | **FAIL**, exit 1, **SecurityFatalError đã biết**, 87.355 s | `final-webpack-build.log`; compile/TS/prerender 13/13 xong, warning createRequire/session-manager cũ còn nguyên; không có diagnostic build mới quy cho patch |
| Diff/hash/limited secret-pattern scan | **PASS**: diff exit 0; 308 hash không đổi sau STOP; không trailing whitespace/token pattern độ tin cậy cao | `final-safety-check.json`; chỉ source/test đổi/mới + report, không scan/in config bí mật |

Production build chỉ chạy **một lần** cuối patch, không baseline build/retry/upgrade/bypass. Không tự xử lý SecurityFatalError. Kết quả build/static checks không biến regression thành PASS hoặc được phép đi tiếp UI. Không chạy browser/Android acceptance.

### 16.7 File/hash và phần còn chưa triển khai

So với source-before working tree, **7 file đổi**:

- `app/api/commands/interpret/route.ts`, `app/api/executions/route.ts`: public wrappers/gate; đường dẫn route vẫn tồn tại.
- `app/api/agent/route.ts`, `app/api/agent/runtime/route.ts`: gate START, giữ control plane.
- `lib/android/agent/device-runtime.ts`: thêm catalog admission checks; không đổi runtime schema/worker protocol/security core.
- `tests/chrome-command-planning.test.cjs`, `tests/wifi-confirmation-route.test.cjs`: chỉ đúng import + năm title được phép, assertions giữ nguyên.

**5 file mới:** `lib/android/unified-agent/legacy-entry.ts`, `legacy-interpret-handler.ts`, `legacy-execution-handler.ts`, `demo-catalog.ts`; `tests/engine-merge-catalog-gate.test.cjs`. Report này cập nhật thêm mục 16. Không có file bị xóa/archive so snapshot; hai deleted components cũ vẫn giữ nguyên. `ConditionExecutor` hash không đổi.

| Snapshot | File count | SHA-256 |
|---|---:|---|
| Trước tiếp tục 3.4 | 303 | `bd830cfc410938918bad07402f65b53f7637630227374a1b444c2188a596506d` |
| Source khi STOP, giữ nguyên cho validation cuối | 308 | `519f7e043d14ebfe6eb9306741a599516c85d8659fcea853e26d3758ae0ed36b` |

`source-after-stop.json` lưu từng hash/path, changed/added/removed và changedExistingTests. Source không được chỉnh để làm test ngoài quyền PASS sau khi phát hiện STOP. Final safety check xác minh lại sau validation/build. Docs/generated không thuộc tập digest.

**Chưa sửa:** capability-router, Unified service/route/contracts (debugEngine vẫn còn), UnifiedAgentPanel/CommandEngineControl, client LegacyAICommandPanel/useDashboardDemo/AgentGoalPanel. Vì vậy **chưa thể nói “hợp nhất ở tầng giao diện và định tuyến”**: Unified vẫn chọn ba engine như cũ. Những câu Unified còn chọn AP sẽ gặp gate 410 ở interpret/executions; đây là bản sửa dở, không phải trạng thái tương đương cuối cùng. Không có silent fallback giải quyết điều này.

### 16.8 Bảng trạng thái trung thực tại điểm dừng

Status là giá trị **module catalog mới**, không phải certification; chưa xuất lên PlanView/Dashboard và còn các lỗi đã liệt kê. Engine column phân biệt có implementation V2 với routing cũ chưa đổi. Không có model/device calls thật hoặc latency/RPC/ADB thật để đo trong lượt này.

| Khả năng | Status catalog | Nhãn/evidence tại điểm dừng | Engine/đường hiện tại |
|---|---|---|---|
| Mở app/Settings | ENABLED | OFFLINE_TESTED case đơn giản; chưa browser/Android mới | V2 có contract; Unified router còn legacy choice |
| Đọc pin/Wi-Fi/độ sáng | ENABLED | OFFLINE_TESTED new pure cases và tests cũ; mixed error contract FAIL | V2 typed read; chưa API plan metadata mới |
| Wi-Fi/độ sáng/DND có journal/restore | ENABLED | **Catalog DND FAIL**, không coi metadata ENABLED là bằng chứng; verifier/journal cũ không sửa | V2 có implementation; legacy public route nay gated |
| Camera/dial prefill/calculation | ENABLED | OFFLINE_TESTED pure classifier + existing regression; không thực hiện effect thật | V2 hiện có, không port/thử lại |
| Search trong app có bằng chứng | ENABLED | OFFLINE_TESTED case Drive cơ bản; chưa chứng minh mọi phrasing cũ qua gate | V2 implementation có, router/UI chưa hợp nhất |
| Hỏi AM/PM | ENABLED | Existing offline tests giữ nguyên; chưa status UI mới | Unified clarification/V2 cũ |
| P1 Chrome first organic | EXPERIMENTAL, PENDING | Android UNVERIFIED; **case mới không dấu FAIL** vì ngoài grammar P1; P1 loop cũ tests không bị sửa | Forced V2 còn như trước; Auto không đổi |
| Alarm/timer | EXPERIMENTAL | OFFLINE_TESTED classifier, nhãn UNVERIFIED ở object catalog; **chưa hiển thị trong Phân tích** | V2 core giữ nguyên, không nghiệm thu thật |
| SSID/record/Gallery/Maps | DISABLED | OFFLINE_TESTED raw gate cases mới, không có Session | Registry reject trước prepare/start |
| URL | DISABLED trong bảng cấu hình | **FAIL**: `open url https://example.com` lọt classifier; không claim gate đạt | Cần sửa catalog trước triển khai tiếp |
| Bluetooth/rotation/volume/flashlight/airplane | DISABLED | OFFLINE_TESTED raw gate; owner generic-widget fixture bị ảnh hưởng, chưa xử lý | Registry chặn; không thay setting thật |
| P2/ordinal>1 | DISABLED | OFFLINE_TESTED rejection; **hai test assistance gốc FAIL** vì trước đó dựa vào P2 | Registry chặn, không port P2 |
| Ngoài danh mục/mixed | DISABLED | Các new cases PASS, nhưng diagnostic mixed-read FAIL và không universal phrasing claim | Chặn whole request trong raw registry; Unified chưa có pre-context catalog gate |
| Destructive/mixed destructive | Existing DENY | OFFLINE_TESTED m5b-security giữ nguyên, không nới owner/full-control | Public route từ chối; existing raw BLOCKED audit semantics giữ nguyên |

Không có lượt REAL_ANDROID_VERIFIED mới, không chụp ảnh/alarm/timer mới, không có artifact cần dọn. Mọi model call trong fixture/mock không phải inference thật. Mã engine cũ còn nguyên dưới các module/handler tương ứng, chưa archive/xóa; **chưa kiểm Dashboard bằng trình duyệt thật**.

### 16.9 Windows/evidence và điểm dừng

```powershell
$dir = 'coverage/engine-merge-stage34-implementation-JxyZAm'
$m = Get-Content "$dir/source-before.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$files = @($m.tests | ForEach-Object { Join-Path tests $_ }) + 'tests/engine-merge-catalog-gate.test.cjs'
& 'C:\nvm4w\nodejs\node.exe' --test --test-concurrency=1 $files
& 'C:\nvm4w\nodejs\node.exe' node_modules/typescript/bin/tsc --noEmit --incremental false
$exclusions = @('--ignore-pattern','**/*holdout*','--ignore-pattern','**/*holdout*/**',
  '--ignore-pattern','**/*sealed*','--ignore-pattern','**/*sealed*/**',
  '--ignore-pattern','tests/general-agent-v2-open-world.test.cjs')
$s = Get-Content "$dir/source-after-stop.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$paths = @($s.changed) + @($s.added)
& 'C:\nvm4w\nodejs\node.exe' node_modules/eslint/bin/eslint.js $paths @exclusions
& 'C:\nvm4w\nodejs\node.exe' node_modules/eslint/bin/eslint.js . @exclusions
# Đúng một lần cuối lượt, không retry/upgrade/bypass:
& 'C:\nvm4w\nodejs\node.exe' node_modules/next/dist/bin/next build --webpack
git diff --check
```

Regression chạy ngoài sandbox cho TEMP/mock loopback, không đổi root env/config. Evidence giữ đầy đủ baseline pointer, extraction/assertion check, hai targeted runs, full regression và static/build/hash/safety logs; không dọn logs cũ. **DỪNG theo điều kiện chủ dự án**: cần duyệt cách giữ coverage bốn test runtime/owner xung đột và cho tiếp tục sửa lỗi catalog mới. Không sửa các test ngoài quyền; không tự tiếp router/UI, P2, temporal acceptance, archive/xóa hoặc Teach Mode. Không commit/push.

## 17. Giai đoạn 3.4 tiếp tục lần 2: STOP tại A1 vì fixture cần đổi adapter

Ngày **24/10/2026** (Asia/Bangkok). Yêu cầu mới cho phép đổi **chỉ goal đầu vào** của bốn test, giữ mọi assertion và bắt buộc STOP nếu phải sửa adapter fake. Đã kiểm tra A1 trước khi sửa code. Kết quả: hai test Human Assistance dùng adapter buộc phải thay đổi để chạy một goal ENABLED mà vẫn vào WAITING_HUMAN. **Dừng ngay tại điều kiện này, không áp A2/A3 và không bắt đầu B.** Không đổi các fixture owner sau khi đã gặp STOP; không biến kết quả fixture COMPLETED thành PASS của A1.

### 17.1 Trạng thái và bảo toàn

Đã chạy git status, đọc source fixture/planner/loop và đối chiếu mục 14-16. Branch `DuyTD`, HEAD không đổi. Không tạo lại `backup-before-stage34`; không commit/push/stash/reset/checkout, đổi env/config/provider/dependency, xóa/archive hoặc sửa worker/runtime schema/security. Giữ nguyên toàn bộ working tree dở từ mục 16, gồm cả các lỗi catalog đã biết; không tự rollback thay đổi của lượt trước.

Evidence mới: `coverage/engine-merge-stage34-resume2-HHNZqv/`. `source-before.json` xác minh 308 file với SHA-256 **`519f7e043d14ebfe6eb9306741a599516c85d8659fcea853e26d3758ae0ed36b`**, khớp đầu lượt theo yêu cầu. Manifest ghi đủ 68 file, không chạy glob thư mục tests; sealed/holdout/open-world dependency bị loại như trước. Không đọc hoặc import material bị cấm, không đọc/in secret.

Không gọi Android, ADB, Appium server, Ollama hoặc cloud thật. Probe dùng chính fake adapter có sẵn, chặn global fetch và chỉ dùng câu `clearGoal` đã nhận bằng rules. Không mở model/server hay dashboard, không tạo dữ liệu người dùng.

### 17.2 Vì sao không thể chỉ thay goal trong hai test Human Assistance

**VERIFIED_IN_SOURCE:** `tests/multi-device-runtime.test.cjs:211` định nghĩa `humanAdapter`, chỉ được hai test mục A1 gọi tại `:233` và `:314`.

- `:214`: luôn đặt `currentSubgoal = 2`, đánh dấu `subgoals[0]` và `subgoals[1]` VERIFIED, không phụ thuộc goal đầu vào.
- `:219`: before snapshot là SEARCH_RESULTS có search query.
- `:221`: after snapshot luôn là VIDEO_PLAYER.
- `:227`: confirmVisualTap luôn trả `selection.itemType='video'`, `ordinal=2` và title video giả. Đây là dữ liệu **adapter**, không phải literal goal ở test.
- `lib/android/agent/goal-planner.ts:70-75`: V1 buildGoal tạo một criterion FOREGROUND, thêm một criterion cho SEARCH/native navigation, và chỉ **OPEN_RESULT** thêm criterion thứ ba DESTINATION. Các kiểu goal V1 không có ordinal chỉ có một hoặc hai subgoals; không thể tạo subgoal thứ ba bằng cách ghép thêm yêu cầu mà bỏ coverage validation.
- OPEN_RESULT YouTube/P2 và ordinal>1 bị DISABLED; Chrome first result là EXPERIMENTAL, không phải ENABLED theo yêu cầu A1. Cho phép chúng để giữ fixture cũ sẽ trái catalog/P1_STATUS, chưa kể evidence adapter vẫn là video thứ hai.

**INFERRED từ contract source trên, đối chứng bằng probe bên dưới:** với fixture nguyên trạng, goal ENABLED dạng mở app gây lỗi index; goal SEARCH có hai bước bị pre-verify hết, đi tới COMPLETED thay vì chờ human. Các capability V2-only như camera/typed state/alarm không phải lối hợp lệ để ép planner/adapter V1 này có criterion DESTINATION thứ ba. Không dùng câu lệnh lắt léo hoặc query chứa lệnh để lách catalog và giữ ordinal2.

### 17.3 Đối chứng offline, không sửa test hoặc adapter

`a1-unchanged-human-adapter-probe.json` ghi **OFFLINE_PROBE_NOT_REGRESSION_RUN**. Harness đọc file test được phép, nạp trong bộ nhớ với `node:test` chỉ đăng ký tên, **không chạy bất kỳ test body có sẵn nào**, và gắn export humanAdapter trong bộ nhớ để quan sát; file trên đĩa không đổi. Body của adapter vẫn nguyên trạng. Chỉ fake devices/observations/close; không real Session.

| Input thử | Catalog hiện tại | Kết quả adapter/registry giả | Đạt A1 WAITING_HUMAN? |
|---|---|---|---|
| `Mở YouTube` | OPEN_APP ENABLED | Adapter.plan lỗi `Cannot set properties of undefined (setting 'status')`; raw registry ghi FAILED, chưa có fake execution instance | **Không**: goal một bước, adapter cố ghi bước thứ hai |
| `Mở YouTube, tìm podcast` | OPEN_APP + SEARCH đều ENABLED | Hai criteria FOREGROUND/SEARCH_RESULTS; fixture đặt currentSubgoal=2 và cả hai VERIFIED; registry giả trả COMPLETED, 0 tap, 1 fake close | **Không**: không vào WAITING_HUMAN để kiểm token/confirm/polling evidence |

Global fetch bị chặn; số lần attempted network/model qua fetch là **0**. Hai câu đã được assert có clearGoal để không fallback inference. Đây không phải hai task Android thật, không phải full regression 2/2 PASS, không phải chứng nhận search/AI autonomy. Kết quả COMPLETED ở hàng thứ hai là hành vi fixture tiền xác minh, **không tính là nghiệm thu thành công**.

### 17.4 Bốn fixture và AST assertion check

**Không đổi dòng nào trong cả bốn test**, do gặp điều kiện STOP trước sửa. `a1-assertion-preservation.json` lưu từng AST assert expression trước/sau, count và SHA-256; nội dung bằng nhau **100%**, đồng thời hash toàn file không đổi. Đây là bằng chứng bảo toàn source, **không phải bằng chứng fixture đã migrate thành công**.

| Test được phép đổi input | Dòng test | Dòng goal dự kiến theo yêu cầu | Thực tế đổi / assert AST |
|---|---:|---|---|
| `SIMULATION: Human Assistance is bound to device/execution/token; confirming A never resumes B` | multi-device-runtime `:232` | Literal goal tại `:235` | **Không đổi**; 10 assert calls nguyên nội dung. Chỉ đổi literal không sửa được fixed step/video adapter |
| `SIMULATION HTTP: polling excludes image bytes; evidence is fetched only for the matching waiting device` | cùng file `:311` | Literal goal tại `:318` | **Không đổi**; 5 assert calls nguyên nội dung; cùng adapter hardcoded |
| `runtime validates selected physical identity and V2 opt-in; restart never restores authority` | owner-authorized-test-mode `:109` | Các START jobs đang dùng goal chung ở `:115` | **Không đổi**; 8 assert calls nguyên nội dung. Chưa thử thay sau khi A1 đã STOP |
| `disabling mode cancels an active owner execution but leaves another device waiting for technical assistance` | cùng file `:126` | Hai jobs tại `:131` | **Không đổi**; 5 assert calls nguyên nội dung. Không sửa global goal ảnh hưởng các test owner khác |

Tổng **28 AST assert calls** được bảo toàn; count là số call expressions trong source, không phải số lần assert thực thi. Không đổi assert trong fake confirmVisualTap, không sửa m5b-security/DENY/journal/grant/anti-replay, không đổi read-state-semantics. Source/test/config sửa trong lượt tiếp tục lần 2: **0**; chỉ cập nhật báo cáo và thêm evidence ignored.

### 17.5 Phạm vi còn dở và mapping TODO

| Phần yêu cầu | Trạng thái lượt này |
|---|---|
| A1 thay goal + giữ WAITING_HUMAN và mọi assertion | **STOP / chưa migrate**; cần thay adapter fake, hiện không được phép |
| A2 giữ UNSUPPORTED_OUTCOME/NEEDS_CLARIFICATION cho unresolved mixed | **Chưa sửa** vì A1 STOP; diagnostic regression mục 16.5 còn nguyên |
| A3 allowlist app, URL gate, DND binding, P1 grammar và positive cases | **Chưa sửa**; không thay OPEN_APP fallback hoặc sửa fixture P1 khi đã STOP |
| A4 nhóm runtime catalog phải 0 FAIL | **Chưa đạt**, không chạy lại sau một thay đổi giả hay nới catalog |
| B router V2-only, bỏ debugEngine, nhãn plan/UI, ngừng render engine selector | **Chưa bắt đầu**; không được vượt A chưa xanh |
| C full regression/TS/lint/đúng một build | **NOT_RUN trong lượt này**, STOP trước sửa code. Kết quả lịch sử ở mục 16.6 không phải validation mới |

Không thêm test mới trong lượt này. 6 TODO boundaries không đổi. Coverage hiện có vẫn như mục 16, **không có bằng chứng mới từ `/api/unified-agent`**:

| TODO cũ | Case trong engine-merge-catalog-gate hiện có | Kết quả run gần nhất (lịch sử mục 16) |
|---|---|---|
| SSID | `OFFLINE runtime catalog rejects before discovery/prepare/start/Session: SSID TODO` | PASS raw registry |
| record | Cùng prefix, `record TODO` | PASS raw registry |
| Gallery | Cùng prefix, `Gallery TODO` | PASS raw registry |
| URL | Cùng prefix, `URL TODO` | **FAIL**, vẫn chưa có gate PASS |
| Maps | Cùng prefix, `Maps TODO` | PASS raw registry |
| Bluetooth | Cùng prefix, `Bluetooth TODO` | PASS raw registry |

Không tuyên bố các TODO đã được phủ ở tầng Unified; chưa có test B5 hoặc route catalog gate Unified. Điều kiện “hợp nhất ở tầng giao diện và định tuyến CHỈ khi B xanh” **chưa thỏa**. Mã engine cũ còn nguyên, chưa archive/xóa; chưa kiểm Dashboard bằng trình duyệt thật; không có Android mới.

### 17.6 Trạng thái capability và validation tại điểm dừng

Các trạng thái catalog là định nghĩa hiện có, không phải chứng nhận. Bảng không biến mock/probe COMPLETED thành REAL_ANDROID_VERIFIED.

| Khả năng | Status catalog hiện có | Nhãn bằng chứng | Engine/đường hiện có |
|---|---|---|---|
| Mở app/Settings, đọc pin/Wi-Fi/độ sáng | ENABLED | OFFLINE_TESTED lịch sử; probe mới mở app không đạt đường fixture A1 | V2 có capability; router cũ và V1 internal test còn nguyên |
| Đổi Wi-Fi/độ sáng/DND có journal/restore | ENABLED | Catalog DND **FAIL** chưa sửa; không có thử thật mới | V2 core, không đổi grants/journal; legacy public entry gated |
| Camera/dial/calculation | ENABLED | OFFLINE_TESTED lịch sử; current Android **UNVERIFIED** | V2 core giữ nguyên |
| Search app có bằng chứng/AM-PM clarification | ENABLED | OFFLINE_TESTED lịch sử; SEARCH fixture probe không WAITING_HUMAN; không phải A1 PASS | V2 core; Unified routing/UI chưa đổi |
| P1 Chrome first result | EXPERIMENTAL, PENDING | OFFLINE_TESTED P1 cũ, current Android **UNVERIFIED**; case mới không dấu vẫn FAIL | Forced V2/Auto legacy như mục 14/16 |
| Alarm/timer | EXPERIMENTAL | OFFLINE_TESTED lịch sử / Android **UNVERIFIED** | V2, chưa status warning trên plan UI |
| SSID/record/Gallery/Maps/các setting bị cắt/P2/ordinal>1 | DISABLED | Rejection raw registry OFFLINE_TESTED lịch sử, xung đột fixture vẫn còn | Admission chặn; không port hoặc mở scope |
| URL/outside/mixed | DISABLED theo cấu hình | **URL FAIL** và mixed diagnostic FAIL chưa sửa, không claim gate hoàn chỉnh | Catalog draft; Unified chưa catalog-gated |
| Destructive/mixed destructive | Existing DENY | OFFLINE_TESTED m5b/security lịch sử, source không đổi | Permission/whole-source guard giữ nguyên |

Full regression gần nhất vẫn là run mục 16: **1249 PASS / 8 FAIL / 6 TODO**. Lượt này **không chạy lại**, không coi đó là kết quả mới hoặc nâng lên 0 FAIL vì source giữ nguyên. TypeScript/lint PASS và build SecurityFatalError ở mục 16 cũng chỉ là lịch sử; không chạy build trong preflight đã STOP, không retry/upgrade/bypass. Không có Next.js issue mới trong lượt này để tạo feedback trùng.

Đã xác minh hash sau lượt khớp trước: **308 file, `519f7e043d14ebfe6eb9306741a599516c85d8659fcea853e26d3758ae0ed36b`**, changed/added/removed đều rỗng. `final-safety-check.json` ghi diff exit 0, report không trailing whitespace/token pattern độ tin cậy cao; scan chỉ report, không đọc bí mật. Các file code/test mới/đổi/xóa/archive bởi lượt này: **0**. Report cập nhật: `docs/engine-merge-report.md`, thêm mục 17; evidence mới chỉ trong thư mục coverage nêu trên. Không tạo lại backup branch, không commit/push.

### 17.7 Quyết định cần trước khi tiếp tục

Phạm vi tối thiểu cần duyệt bổ sung: **cho phép sửa `humanAdapter()` trong tests/multi-device-runtime.test.cjs cho đúng nhiệm vụ SEARCH ENABLED**, gồm chỉ số/subgoal preconditions và fake before/after/confirm evidence phù hợp search thay vì video2. Helper chỉ phục vụ hai test Human Assistance đã nêu. Giữ nguyên 15 AST assert calls trong hai test và mọi kiểm tra evidence/token/device/execution/cancel/close; không sửa runtime/worker contract hoặc shared security. Cần đối chứng WAITING_HUMAN rồi confirm/cancel/evidence readback thật trong fixture, không chỉ đổi status fake thành PASS. Chưa thực hiện thay đổi này.

Hai fixture owner vẫn chỉ được xét đổi input trong scope đã cho, không tự đổi goal chung/adapter hoặc các test owner khác. Sau khi A1 có thể đạt mới xử lý A2/A3 và chạy A4; **không có quyền tự đi tiếp B** khi A chưa xanh.

Kiểm tra evidence trên Windows:

```powershell
git status --short --branch
Get-Content coverage/engine-merge-stage34-resume2-HHNZqv/a1-unchanged-human-adapter-probe.json -Raw -Encoding UTF8
Get-Content coverage/engine-merge-stage34-resume2-HHNZqv/a1-assertion-preservation.json -Raw -Encoding UTF8
Get-Content coverage/engine-merge-stage34-resume2-HHNZqv/final-safety-check.json -Raw -Encoding UTF8
git diff --check
```

**DỪNG TẠI A1 ĐÚNG YÊU CẦU TIẾP TỤC LẦN 2.** Chưa hoàn tất 3.4, không sửa code/test sau STOP; không tự tiếp P2, nghiệm thu thật P1/temporal, archive/xóa hoặc Teach Mode.

## 18. Kiểm thử tiếp sau gián đoạn và hai ca đọc qua Wi-Fi (25/10/2026)

### 18.1 Phạm vi và tính toàn vẹn

Chủ thiết bị đã xác nhận kết nối Wi-Fi và yêu cầu "ok test đi". Lượt này chỉ kiểm thử, không tiếp tục sửa catalog/router/UI. Không commit/push, đổi cấu hình/provider hoặc đọc sealed/holdout. Không chạy tìm kiếm, mở kết quả, chụp ảnh, tạo báo thức/timer hay thay đổi cài đặt. P1 vẫn **PENDING / EXPERIMENTAL**; B chưa triển khai.

Hai chỉnh sửa fixture từ lượt bị gián đoạn được giữ nguyên: `humanAdapter()` và goal tại hai test Human Assistance trong `tests/multi-device-runtime.test.cjs`; literal goal tại hai test owner trong `tests/owner-authorized-test-mode.test.cjs`. Không sửa tiếp hai file này trong lượt kiểm thử. So với snapshot đầu lượt trước gồm 308 file, chỉ hai file test trên khác hash; không có runtime drift.

AST đối chiếu với `coverage/engine-merge-stage34-resume3-nAFVnC/assertions-before.json`: mọi assert expression trong **31 test callbacks** của hai file vẫn nguyên nội dung. Riêng bốn test được duyệt giữ **28 calls (10 + 5 + 8 + 5)**. Search fixture đi qua đường assistance thật của registry: pending search -> WAITING_HUMAN -> token/device/execution checks -> confirm/readback hoặc cancel. Không chứng minh bằng cách gán trực tiếp trạng thái. Đây là **OFFLINE_TESTED**, không phải AI tự khám phá ứng dụng thật.

Evidence mới ở `coverage/wifi-readonly-20261025-F79gJR/`: `assertions-and-cleanup.json`, `full-regression-2.log`, `report.json`, `final-cleanup.json`. Evidence được giữ tại máy; không gửi ảnh/UI cho cloud.

### 18.2 Kết quả offline

| Kiểm tra | Kết quả thực chạy |
|---|---|
| Hai file multi-device + owner, có HTTP loopback | **31/31 PASS** |
| Catalog gate riêng | **36 PASS / 3 FAIL** |
| Full regression đúng manifest 68 file, concurrency 1 | **1253 PASS / 4 FAIL / 6 TODO**, tổng 1263; 276.483 giây theo Node test runner |
| TypeScript `tsc --noEmit --incremental false` | **PASS**, exit 0 |
| ESLint hai file test, đủ năm ignore-pattern đã yêu cầu | **PASS**, exit 0, không warning |
| Full ESLint / production build | **NOT_RUN trong lượt chỉ kiểm thử này**; không tái sử dụng PASS hoặc lỗi build lịch sử làm kết quả mới |

Lần đầu chạy hai file trong sandbox có 28 PASS / 3 HTTP `fetch failed`; chạy lại với loopback được phép đạt 31/31. Không sửa assertion để xử lý lỗi môi trường. Một lần gọi runner full bị sai đường dẫn manifest (thiếu `tests/`), chưa chạy test nào; log đầu được giữ riêng ở `full-regression.log`, không tính là run regression hoàn tất.

So với kết quả lịch sử mục 16 (**1249/8/6**), bốn failure fixture được duyệt đã hết. Bốn failure còn lại đều tái hiện, chưa sửa:

| Failure | Root cause / vị trí | Trạng thái |
|---|---|---|
| `runtime catalog ... URL TODO` | `demo-catalog.ts`: LAUNCH fallback nhận `open url https://example.com`; thiếu positive allowlist | **FAIL**, A3 chưa hoàn tất |
| `catalog status ... set dnd 0` | Binding SET_DEVICE_STATE hợp lệ bị raw ambiguity/UNKNOWN chặn | **FAIL**, A3 chưa hoàn tất |
| `catalog status ... Mo Chrome, tim ocean va mo bai dau tien` | Fixture mới không dấu nằm ngoài grammar P1 hiện có | **FAIL**, chưa sửa fixture hoặc mở rộng parser |
| `an unresolved mixed clause blocks preparation without dropping the read` | Diagnostic catalog trả CAPABILITY_DISABLED thay contract UNSUPPORTED_OUTCOME/NEEDS_CLARIFICATION | **FAIL**, A2 chưa hoàn tất; không sửa test cũ |

A4 **chưa xanh**, không chuyển B, không tuyên bố hợp nhất thành công. Sáu TODO boundaries không đổi; mapping lịch sử ở mục 17 vẫn chưa có coverage B5 Unified mới.

### 18.3 Hai ca Android thật chỉ đọc

Transport được chủ thiết bị chọn: `192.168.1.78:35853`, Samsung SM-A507FN, identityVerified. Preflight không có task/owner mode. Công cụ browser không cho phép truy cập tab, nên đường thực chạy là **Unified HTTP API -> worker thật -> Agent V2 -> Android/Appium thật**, không phải thao tác Dashboard bằng browser. Không vượt qua chặn browser bằng công cụ khác.

Catalog/compile probe xác nhận hai câu dưới có coverage COMPLETE, đúng một READ_STATE binding, trước khi gửi execution. Cả hai plan chọn V2 với reason `V2 typed outcomes, device discovery and registered predicates; coverage checked before dispatch.` Runner chỉ chấp nhận GOAL_INTERPRETATION khi graph có đúng một READ_STATE và đúng trường yêu cầu; không bật owner/full-control. Đây không phải bỏ qua kiểm tra quyền.

| Câu lệnh | Kết quả / chứng cứ độc lập | Analyze / execute quan sát | RPC / ADB trong execution budget | Model calls |
|---|---|---|---|---|
| Cho mình xem pin còn bao nhiêu | **REAL_ANDROID_VERIFIED / COMPLETED**: value 28; đọc lại `dumpsys battery` = 28 và sysfs capacity = 28 | 0.870 s / 13.249 s | 6 / 20 | **0** |
| Cho mình biết Wi-Fi đang bật hay tắt | **REAL_ANDROID_VERIFIED / COMPLETED**: value 1; đọc lại `settings get global wifi_on` = 1 và `cmd wifi status` = enabled | 0.668 s / 11.305 s | 6 / 20 | **0** |

Evidence class của engine: **INDEPENDENT_STATE_READBACK**, analysis source **INTENT_REVIEWED**, reasoningMeasurements rỗng. Đối chiếu native ngoài engine khớp **2/2 claimed completions**, false completion quan sát **0/2**. Không thu screenshot hoặc tuyên bố kiểm chứng giao diện, vì hai outcome là trạng thái hệ thống được đọc native.

Session setup lần lượt 8.434 s và 6.373 s; execution span 1.269 s và 1.182 s. Không cộng các span có thể lồng/chồng lên nhau. RPC/ADB ở bảng chỉ là counters execution budget, không gồm discovery qua API, preflight, hai ADB readback độc lập mỗi ca hoặc kiểm tra cleanup. Chưa đo peak RAM/inference vì không có model call. Provider cấu hình hiện là `groq-with-local-fallback`, nhưng **không provider nào được gọi trong hai ca này**; không thay env và không thử search có thể kích hoạt cloud.

### 18.4 Cleanup và giới hạn

Hash runtime dùng cho acceptance (141 file `lib/android/**/*.ts` theo `androidRuntimeDigest`) trước/sau từng ca và cleanup đều là `aa9b49e9bfa38a3cead636dd94c92dcd36b766b6946468aa7ccf09faa9064e66`. Hash này có phạm vi khác snapshot tổng 308 file, không thay thế digest lịch sử mục 17.

Final cleanup: **0 active tasks, 0 owner modes, 0 device/reservation locks**. GET lại hai Session IDs trên Appium trả **404 / invalid session id**: cả hai Session đã đóng. Không xóa dữ liệu/log/evidence hoặc dọn artifact trên điện thoại; không tạo artifact mới trong lượt thử.

Kết quả chứng minh hai câu đọc trạng thái tiếng Việt chạy được qua Unified API trên một Samsung qua Wi-Fi, và bốn fixture đã sửa giữ các assertion cũ. **Không chứng minh AI tự suy luận**, search trên app chưa biết, Dashboard browser PASS, P1/Camera/Alarm/Timer PASS, một engine duy nhất hoặc toàn bộ regression xanh. Chưa sửa A2/A3, chưa chạy B, không tự sang giai đoạn tiếp theo.

## 19. Phần B: DỪNG tại tương thích test an toàn, trước sửa source (25/10/2026)

### 19.1 Baseline phần A và phạm vi lượt B

Đã đọc yêu cầu B, git status, source router/service/contracts/fixtures và các mục 14-18. Branch vẫn `DuyTD`; giữ toàn bộ dirty/untracked/deleted có sẵn. Không tạo lại backup, commit/push/stash/reset/checkout, đổi config/env/provider/dependency, xóa/archive hoặc gọi Android/Appium/ADB/Ollama/cloud. Không đọc/import sealed/holdout. P1_STATUS vẫn **PENDING / EXPERIMENTAL**.

Phần A mới nhất đã sửa **chỉ** `demo-catalog.ts` và file test catalog mới: positive app allowlist và typed package binding, đóng URL fallback, dùng binding DND hợp lệ, giữ diagnostic mixed clause, positive P1 có dấu và negative không dấu. Hai fixture A1 không bị sửa thêm. Evidence `coverage/catalog-a2-a3-qX8TVC/` ghi targeted **183/183 PASS**, full manifest 68 file **1290 PASS / 0 FAIL / 6 TODO / 1296 entries**, TypeScript và scoped/full lint PASS (ba warning unused cũ). Build phần A chạy một lần trong sandbox và dừng bởi EPERM tạo thư mục dưới `.next`; không retry. Đây là **baseline lịch sử được tái dùng**, không phải full regression vừa chạy lại trong B.

Evidence B mới ở `coverage/engine-merge-stage34-b-J5HK8O/`. Snapshot 308 file source/test/script khớp hoàn toàn cuối A. Digest đầu/cuối: `a033f83c62b425ea2290b6c5f827e0b9b5ede1dfaa7f4c18302454f732e2f50b`. Thuật toán của snapshot B: `SHA256(JSON.stringify(sorted [path, SHA256(bytes)] entries))`; không so nhầm với worker digest hoặc thuật toán digest các mốc cũ. Docs/generated không thuộc tập này.

### 19.2 Xung đột đã đối chứng, không đổi assertion để che lỗi

**VERIFIED_IN_SOURCE:** `tests/unified-agent-m7a.test.cjs:15` dùng source chung `Mở Chrome và tìm công thức nấu phở`. Catalog A chỉ cho Chrome SEARCH khi có typed first-result P1, nên câu hai mệnh đề này không nằm trong phạm vi B. Fake `start` tại `:24` luôn trả request Camera và RUNNING, không phải task gắn source của một plan khác. Không thể dùng task này để chứng nhận replay test là COMPLETED cho V2 mà giữ source/device verification đúng.

Test Wi-Fi tại `:128` lại yêu cầu luồng facade legacy WAITING_CONFIRMATION -> confirm -> hai lần gọi legacy nhưng đúng một effect, rồi giữ SENT. B1 yêu cầu **không có dispatch Action Plan** và **CONFIRM legacy bị từ chối**. Đây là thay đổi của một contract confirmation/effect, không chỉ thay assertion `engine = ...`. Test cancel tại `:142` phải nhận AbortSignal của legacy dispatch và giữ raw FAILED/CANCELLED; không thể chứng minh điều này bằng V2 task không gửi legacy.

Đã chạy ba body nguyên trạng trên source hiện tại: **3 PASS / 0 FAIL**, `protected-baseline.log`. Sau đó đối chứng **chỉ trong bộ nhớ**, không sửa file: thay export router bằng phần hành vi bắt buộc DENY -> catalog production thật -> V2, giữ nguyên service và toàn bộ body/assertions. Chỉ đăng ký đúng ba test dưới; fetch thật fail-on-call. Đây là **OFFLINE_COMPATIBILITY_PROBE_NOT_PRODUCTION_PATCH**, không phải implementation B hoặc run toàn regression.

| Test nguyên văn / dòng | Baseline | Probe catalog -> V2 | Nguyên nhân |
|---|---|---|---|
| `OFFLINE replay and simultaneous execute dispatch exactly once`, `:64` | PASS | FAIL khi analyze, UNSUPPORTED_OUTCOME | Source chung là Chrome SEARCH ngoài catalog; không tới các assert one-shot/COMPLETED |
| `OFFLINE only explicit pre-dispatch Wi-Fi challenge can retry same stored plan`, `:128` | PASS | FAIL khi analyze, CAPABILITY_DISABLED | `tắt wifi` là workflow legacy; journaled typed `set wifi 0` là capability khác, không có quyền tự thay nghĩa fixture hoặc nới catalog |
| `OFFLINE cancellation of legacy execution aborts original signal and retains final evidence`, `:142` | PASS | FAIL khi analyze, UNSUPPORTED_OUTCOME | Source chung bị chặn; contract cần kiểm AbortSignal và evidence của legacy dispatch bị loại khỏi Unified |

`protected-v2-catalog-probe.log` và `compatibility-probe.json` giữ nguyên ba failure. Probe counters: **networkAttempts=0, context=3 (fake), prepare=0, start=0, legacy=0**. Không có Session thật hoặc tác động thiết bị. Probe chưa di chuyển kiểm tra catalog lên trước context trong service, nên cũng **không** là bằng chứng B5 zero-worker/zero-prepare của route thật.

**INFERRED, chưa chạy thêm sau STOP:** test `OFFLINE tampered interpreter recipe cannot obtain a reference` tại `:80` và test isolation khi legacy setup tại `:196` cũng cần được xem xét target/fixture; B loại interpreter và legacy setup khỏi Unified. Không cộng chúng thành failure đã đo. Không đưa chữ "recipe" vào lỗi catalog chỉ để khớp regex cũ, không giữ nhánh legacy ẩn, không bỏ source binding để dùng fake Camera cho plan Chrome, không đổi UNKNOWN/SENT thành COMPLETED.

### 19.3 AST assertion và bảng test sửa

Trước mọi dự kiến chỉnh test đã snapshot AST ở sáu file được phép xét trong B4. `assertions-before.json` / `assertion-preservation.json` ghi **71 định nghĩa `test()` trong source, 275 assert call expressions**, từng expression và SHA-256. Đây là số node AST, không phải tổng case mở rộng của các vòng lặp. Sau đối chứng: **100% bằng nhau**, các file giữ nguyên byte/hash.

| Test cần sửa đã thực hiện | Assertion cũ -> mới | Lý do |
|---|---|---|
| **Không có** | **Không đổi bất kỳ assertion/input/helper/import nào** | Dừng trước sửa khi đối chứng chạm nhóm bảo vệ an toàn, thay vì dùng ngoại lệ engine-choice để di chuyển test replay/confirmation/cancel |

Hai file khóa A1 `multi-device-runtime.test.cjs`, `owner-authorized-test-mode.test.cjs` nguyên hash. Permission/effect grants/journal/locks/cancellation/ConditionExecutor/worker/runtime schema và catalog A cũng nguyên hash. Không sửa test an toàn hoặc parser để hợp thức hóa source fixture cũ.

### 19.4 B1-B6 và TODO coverage tại điểm dừng

| Hạng mục | Trạng thái thực tế |
|---|---|
| B1 router/service catalog -> V2-only | **CHƯA TRIỂN KHAI trên đĩa**; chỉ có compatibility probe cần thiết để chứng minh xung đột |
| B2 bỏ debugEngine / ENGINE_SELECTION_REMOVED / plan catalog metadata | **CHƯA TRIỂN KHAI**; contracts/API cũ còn nguyên |
| B3 một ô nhập, không engine control, xử lý panel nhóm | **CHƯA TRIỂN KHAI**; không kết luận panel nhóm đã tách hoặc ẩn |
| B4 engine-choice test migration | **0 test sửa**; toàn bộ AST assertion giữ nguyên |
| B5 `engine-merge-single-path.test.cjs` | **CHƯA TẠO**, không có route B5 PASS để báo |
| B6 `docs/demo-capabilities.md` | **CHƯA TẠO** vì chưa có ANALYZE qua Unified V2-only để chứng nhận bảng demo |

Sáu TODO trong `engine-merge-boundaries.test.cjs` giữ nguyên. Mapping hiện có chỉ tới **raw registry/catalog A**, không phải route Unified B5 mới:

| TODO cũ | Test catalog A đã PASS | Coverage `/api/unified-agent` theo B5 |
|---|---|---|
| SSID | `runtime catalog rejects ... SSID TODO` | NOT_RUN / chưa có test mới |
| record | `runtime catalog rejects ... record TODO` | NOT_RUN |
| Gallery | `runtime catalog rejects ... Gallery TODO` | NOT_RUN |
| URL | `runtime catalog rejects ... URL TODO` và các biến thể URL/domain | NOT_RUN |
| Maps | `runtime catalog rejects ... Maps TODO` | NOT_RUN |
| Bluetooth | `runtime catalog rejects ... Bluetooth TODO` | NOT_RUN |

### 19.5 Capability và mức bằng chứng, không nâng nhãn sau probe

| Khả năng | Catalog hiện tại | Nhãn bằng chứng | Engine/đường hiện tại |
|---|---|---|---|
| Mở app/Settings | ENABLED | OFFLINE_TESTED phần A | V2 có capability; Unified router vẫn như trước B |
| Đọc pin/Wi-Fi | ENABLED | REAL_ANDROID_VERIFIED **lịch sử 25/10**, mục 18; không có lượt mới ở B | V2 typed READ_STATE |
| Đọc độ sáng; đổi Wi-Fi/độ sáng/DND có journal | ENABLED | OFFLINE_TESTED; nghiệm thu Android mới UNVERIFIED | V2 core/policy không đổi |
| Camera/dial prefill/calculation/search app cho phép/AM-PM clarification | ENABLED | OFFLINE_TESTED; không có effect/device run mới | Capability V2 giữ nguyên, Unified chưa một đường |
| P1 Chrome first organic | EXPERIMENTAL, PENDING | Logic OFFLINE_TESTED; **Android UNVERIFIED** | V2 đã có port; Auto/engine choice cũ chưa bỏ |
| Alarm/timer | EXPERIMENTAL | **UNVERIFIED** cho demo Android; có offline tests | V2, không nghiệm thu thật |
| SSID/record/Gallery/URL/Maps/các setting bị cắt/P2/ordinal>1 | DISABLED | Raw catalog rejection OFFLINE_TESTED; B5 Unified UNVERIFIED | Catalog/registry A; đường Unified chưa gate sớm theo B1 |

Chưa đủ bằng chứng để nói **"Unified một đường V2 theo catalog (OFFLINE_TESTED)"**. Mã V1/Action Plan còn nguyên, chưa archive/xóa; chưa kiểm Dashboard bằng trình duyệt thật; P1 chưa nghiệm thu Android.

### 19.6 Validation và điều kiện tiếp tục

| Kiểm tra | Kết quả lượt B |
|---|---|
| Baseline full 1290/0/6 | Tái dùng evidence A với source hash khớp, không gọi là run mới |
| Đối chứng ba test nguyên trạng | **3/3 PASS** |
| Compatibility probe thay riêng router trong bộ nhớ | **0 PASS / 3 FAIL**, có chủ đích đối chứng yêu cầu; không trừ ba ca này khỏi baseline source hiện tại |
| Hash/AST | **308 file không đổi, 275 assert expressions không đổi** |
| Full regression + file B5 mới, TypeScript, scoped/full lint, webpack build | **NOT_RUN sau STOP**, không có patch production hoặc file B5 để nghiệm thu; build B **0 lần**, không retry/upgrade/bypass/dọn `.next` |

Theo điều kiện dừng của yêu cầu B: **dừng trước sửa source/test**, chỉ cập nhật báo cáo và evidence ignored. Không làm B một phần rồi giữ fallback legacy để suite xanh. Không chạy build sau STOP chỉ để tạo thêm một lỗi môi trường; lỗi EPERM/SecurityFatalError cũ không được dùng làm kết quả build mới.

Phạm vi tối thiểu cần duyệt trước lần tiếp tục: cho di chuyển **target/fixture của các test bảo vệ legacy-only nêu trên**, không chỉ assertion engine-choice. Replay/cancel/isolation cần fixture V2 thuộc catalog, task đúng source/device và evidence phù hợp; confirmation/interpreter/cancel của Action Plan cần được giữ characterization ở handler nội bộ đã có, đồng thời thêm test Unified từ chối CONFIRM/legacy/debugEngine. Phải liệt kê từng test/target/input/helper được phép thay và giữ các thuộc tính one-shot, binding, no-effect-before-approval, cancellation và evidence; không xóa/skip test, không nới runtime/security/catalog.

**DỪNG SAU ĐỐI CHỨNG B.** Chưa hoàn tất hợp nhất engine, chưa tạo demo contract mới; không tự chuyển P2, nghiệm thu thật, archive/xóa hoặc Teach Mode. Không commit/push.

## 20. Phần B tiếp tục lần 2: di dời legacy, V2-only một phần, STOP tại source-slot setting (25/10/2026)

### 20.1 Preflight và phạm vi đã giữ

Đã đọc attachment tiếp tục lần 2, source và mục 17-19; chạy git status, giữ dirty/untracked/deleted có sẵn. Branch `DuyTD`. Snapshot đầu lượt **308 file**, digest **`a033f83c62b425ea2290b6c5f827e0b9b5ede1dfaa7f4c18302454f732e2f50b`**, khớp yêu cầu. Baseline full **1290 PASS / 0 FAIL / 6 TODO** được tái dùng từ phần A với source khớp; không chạy lại full trước sửa và không trình bày như run mới.

Evidence mới: `coverage/engine-merge-b2-TjT5xo/`. Không đọc/import sealed/holdout, tạo backup, commit/push/stash/reset/checkout, đổi config/env/provider/dependency, xóa/archive file hoặc gọi Android/Appium/ADB/Ollama/cloud thật. Fake worker, adapter, loopback test và journal TEMP chỉ phục vụ regression offline. Không có inference hay Session thật trong B5.

Trước chỉnh test đã lưu `assertions-before.json`: **71 định nghĩa test AST / 275 assert call expressions** trong sáu file được phép khảo sát. Trước chỉnh đã liệt kê thêm hai test legacy-only `tampered interpreter recipe` và `physical-device isolation ... legacy setup` cùng ba test bắt buộc. Không sửa tiếp hai file A1.

### 20.2 Implementation đã có trên đĩa, chưa hoàn tất validation

| Phần | File/đường mã | Hành vi đã thực hiện |
|---|---|---|
| Admission | `lib/android/unified-agent/capability-router.ts:29`, `service.ts:48`, `:83` | DENY nguồn -> locked catalog -> chỉ V2, trước context/prepare; DISABLED/unknown từ chối toàn câu, không fallback |
| Contract/API | `contracts.ts:17`, `app/api/unified-agent/route.ts:57` | Bỏ debugEngine khỏi AnalyzeInput; field có mặt kể cả rỗng/null bị 400 ENGINE_SELECTION_REMOVED; plan/clarification có catalog capability/status/label |
| Binding | `service.ts:99` | Reference backend, single-use, TTL; source/device/physical/backend/runtimeHash/policyMode/ownerId, busy được kiểm lại; chỉ START_PREPARED V2 |
| Status/cancel/assistance | `service.ts:141`, `:147`, `:154` | Chuyển cancel/assistance về cùng task; giữ raw status/evidence, lost-response không replay; CONFIRM legacy bị từ chối rõ LEGACY_CONFIRMATION_REMOVED |
| UI | `components/commands/UnifiedAgentPanel.tsx:126`, `:136`, `:155` | Một input, Phân tích/Thực thi/Dừng, catalog labels, clarification/error. Ngừng render CommandEngineControl/debugEngine và group START/version |
| Group compatibility | Cùng panel, `controlsMode="results"` | Giữ AgentGoalPanel ở chế độ kết quả khi có nativeTaskId để xem/stop/assistance; không render group launcher. Component cũ không bị xóa; không bảo đảm việc xem task nhóm cũ đầy đủ qua UI mới |
| Legacy | `tests/helpers/internal-legacy-unified-service.cjs`, `internal-legacy-router.cjs` | Test-only snapshot của facade/router trước sửa, adapter cho characterization; không production fallback. Public legacy START gate trước đó giữ nguyên, GET/CANCEL/ASSIST vẫn có test |

`legacyRecipe` và pure helper `actionPlanCompletion` còn export cho characterization/consumer cũ; Unified service không dùng chúng để dispatch. Không tuyên bố toàn codebase chỉ còn một engine: internal runtime V1 và mã Action Plan vẫn tồn tại theo giới hạn không xóa. Grep incoming references của hai helper mới chỉ có test m7a và helper-to-helper, không có app/components/lib/hooks/scripts.

### 20.3 Di dời năm test legacy: không thay body/assertions

Đổi registration sang `internalLegacyTest`, helper thêm tiền tố runtime **`internal legacy:`** và chỉ chọn adapter cũ trong AsyncLocalStorage của đúng callback. Bản A không đi qua Unified production mới. `assertion-preservation-after.json` so callback text và assert AST trước/sau (chỉ normalize CRLF/LF), **5/5 body và 17/17 assert calls bằng nhau**. Không xóa/skip/todo năm test.

Tên trong bảng bỏ tiền tố OFFLINE cho gọn; chuỗi đầy đủ và từng expression/hash có trong evidence.

| Test gốc, nhánh A | Assertion trước -> sau | Nhánh B Unified V2 mới |
|---|---|---|
| replay and simultaneous execute dispatch exactly once | 3 -> 3, nguyên body; legacy COMPLETED giữ nguyên | `simultaneous execution and replay dispatch one source-bound task`: đúng một START, source/device/physical/ref khớp, replay 409 |
| tampered interpreter recipe cannot obtain a reference | 2 -> 2, nguyên body; recipe rejection và zero dispatch giữ nguyên | Unified không gọi interpreter; strict EXECUTE contract cũ cấm source/plan/engine/grants; route mới debugEngine 400 zero worker |
| only explicit pre-dispatch Wi-Fi challenge can retry same stored plan | 8 -> 8, nguyên body; token, no effect trước confirmation, một effect, SENT/reconfirm-deny giữ nguyên | `CONFIRM cannot authorize typed Wi-Fi; full-control uses original journal and exact undo` cùng `normal mode does not gain setting permission` |
| cancellation of legacy execution aborts original signal and retains final evidence | 3 -> 3, nguyên body; AbortSignal/raw FAILED/CANCELLED giữ nguyên | `cancellation reaches original execution and retains final evidence`: fake original controller aborted, raw CANCELLED, evidence giữ nguyên |
| physical-device isolation prevents two facade executions during legacy setup | 1 -> 1, nguyên body; reject execution thứ hai giữ nguyên | `same physical device cannot have two facade executions`: start đúng một task, execution thứ hai 409 |

File m7a sau migration chạy riêng **50/50 PASS**, rồi vẫn PASS trong targeted cuối. Đây là test fake/loopback, không phải Android acceptance.

### 20.4 Thuộc tính an toàn -> test phủ

| Thuộc tính | Coverage legacy A / Unified B hoặc test cũ giữ nguyên |
|---|---|
| One-shot/concurrent/replay đúng một dispatch | Legacy replay A; B5 simultaneous/replay source-bound task |
| Source/device/physical/reference đúng task | B5 simultaneous task; changed physicalId; m7a prepared V2 graph/evidence và foreign-device fresh-observation |
| Backend/runtime/policy/owner/busy binding | m7a `execute rejects changed binding` sáu cases, assertions nguyên; B5 physicalId/runtimeHash/ownerId |
| TTL/restart/reference không do client tự tạo | m7a `expiry and restart require analysis again with zero effects`; strict execute schema; m7a-fixes reanalysis/clarification tests giữ nguyên |
| Interpreter không thể thêm effect | Legacy tampered recipe A nguyên trạng; Unified không có interpreter/legacy adapter; strict reference-only EXECUTE và debugEngine removed tests |
| Wi-Fi confirmation chỉ retry trước dispatch rõ ràng | Legacy Wi-Fi A nguyên trạng; Unified CONFIRM rejected, không có challenge legacy |
| Typed Wi-Fi không nhận quyền nhờ đổi facade | B5 normal mode zero writes/proofs; full-control dùng OwnerTestPolicy + executeIntentCapability/SettingMutationController/journal gốc, hai native readback fake, chính xác disable -> enable và RESTORED |
| Mutation không replay | B5 reference replay rejected; cùng approval được gọi lại phải reject `never replayed`, journal không có write thứ ba |
| Cancel giữ signal và evidence cuối | Legacy cancel A; B5 original controller/evidence; m7a V2 assistance/cancel và lost response assertions giữ nguyên |
| Physical isolation trong setup | Legacy isolation A; B5 hai facade executions cùng physical chỉ START một |
| UNKNOWN/lost response không START lại | m7a lost response và explicit NOT_SENT tests nguyên assert; B5 response lost/cancel reconcile cùng task |
| SENT/BLOCKED không thành COMPLETED | Pure Action Plan completion characterization nguyên assert; V2 raw evidence/foreign device tests |
| Destructive/mixed bị chặn toàn câu | Boundaries destructive nguyên assert, B5 mixed destructive zero worker/context/prepare/start/Session/network |
| Assistance đúng execution/device/token | m7a assistance test nguyên assert; B5 legacy control-plane GET/CANCEL/ASSIST fake forwarding |

Không coi fake evidence hay fake AbortController là chứng minh driver/session teardown Android thật. Một số B5 kiểm façade còn compiler thật; full-control Wi-Fi B5 đi sâu vào intent/journal thật với native fake, không thay security runtime.

### 20.5 Các assertion engine-choice/UI thay đổi

Tổng sau sửa vẫn **71 định nghĩa**, **276 assert calls**. **58 định nghĩa giữ toàn bộ assert expressions**, trong đó có năm legacy; **13 định nghĩa đổi engine-choice/admission/UI assertions** như bảng. Không nói toàn bộ 275 expressions đều nguyên trạng. `unified-agent-m7a-fixes.test.cjs` không đổi byte/hash. Chi tiết trước/sau từng expression trong `assertion-preservation-after.json`.

| File / test | Trước -> sau | Lý do; phần giữ nguyên |
|---|---|---|
| command-engine-controls / full panel | match tablist/tabpanel/group launcher -> doesNotMatch | B3 bỏ engine/group START; một device selector, no-device disabled, owner labels giữ nguyên |
| m7a / routing matrix | AP/V1 routing -> catalog refusal; supported vẫn V2 | Không chọn engine thay thế; no execution trong routing |
| m7a / unsupported debug | ASK -> ENGINE_SELECTION_REMOVED | Client không chọn engine; Appium restriction và unsafe legacyRecipe assertion giữ nguyên |
| m7a / debug Action Plan ordinal | plan.engine ACTION_PLAN -> rejects ENGINE_SELECTION_REMOVED | Zero dispatch giữ nguyên |
| m7a / Dashboard markup | 2 tabs -> 0; tab IDs present -> absent | Một textarea và ba command buttons giữ nguyên |
| unified-engine-coverage / unsupported ordinal | forced V2 ASK -> catalog CAPABILITY_DISABLED | Khả năng bị cắt, không gọi engine khác |
| cùng file / playback routing | V1 -> rejection; forced V1 -> removed | Query/ordinal/operation/V1 criterion target assertions nội bộ giữ nguyên |
| cùng file / plan/no fallback | auto V1 plan -> reject disabled; engine undefined; prepare 1 -> 0 | Admission sớm hơn theo B1; start luôn 0. Đây là thay đổi prep availability, không phải giữ nguyên expression |
| cùng file / supported V2 routing | forced V2 -> default V2 | Cùng supported source và V2 outcome |
| cùng file / debug AP + backend | AP plan -> removed; backend test dùng supported timer | Appium-only assertion còn nguyên ý nghĩa |
| boundaries / forced engine | capability ASK -> ENGINE_SELECTION_REMOVED | Exact zero prepare/start/legacy/interpret giữ nguyên |
| boundaries / characterization-gap matrix | router V2 và prepare failure -> catalog refusal trước context; prepare 1 -> 0 | B1 admission availability đổi; start/legacy/interpret luôn 0, không nới permission |
| P1 / router | auto/forced V1/AP -> default V2 và reject debug; cut ordinal -> disabled | Chỉ routing test; toàn P1 grounding/proof/stale/replay/cancel/DOM tests không đổi |

Mọi thay đổi input/helper để tạo V2 task có source/device/ref đúng chỉ nằm trong các test được phép. Không đổi assertion security chung để dùng fake Camera cho plan Chrome, không tạo fallback Action Plan ngầm cho suite xanh.

### 20.6 B5 và root cause STOP

`tests/engine-merge-single-path.test.cjs` gọi **POST/GET route thật**, fake worker-client/adapter; fetch thật fail-on-call. Negative matrix gồm 17 nhóm, deprecated engine 5 cases, supported positive ban đầu 17, các counterpart, binding/lost-response/AM-PM/control-plane và markup tests.

Lần B5 đầu: **49 PASS / 2 FAIL / 51**. Hai assert đọc status trước khi async journal hoặc cancellation poll kết thúc. Sửa **chỉ helper chờ fixture bounded** rồi đọc lại cùng assertions: **51/51 PASS** tại `single-path-final.log`. Không sửa status/evidence/journal runtime, không coi hai failure này là lỗi Android.

Tiếp theo thêm ba positive tiếng Việt `Đặt wifi 0`, `Đặt brightness 80`, `Đặt dnd 0` mà không đổi expected capability SET_STATE. Targeted bảy file cuối: **185 PASS / 3 FAIL / 6 TODO / 194 entries**, 19.574 giây, `targeted-final.log`. Riêng B5 phiên bản cuối: **51 PASS / 3 FAIL / 54**. Ba test vẫn FAIL trên đĩa, không xóa hay đổi expected để làm xanh.

| Source | Thực tế | Counters |
|---|---|---|
| Đặt wifi 0 | HTTP 409 CAPABILITY_DISABLED, nhãn Ghi chu/tao record sai nghĩa | 0 context/prepare/start/Session/network |
| Đặt brightness 80 | Cùng sai lệch CREATE_RECORD, không có typed binding | Tất cả 0 |
| Đặt dnd 0 | Cùng sai lệch CREATE_RECORD, không có typed binding | Tất cả 0 |
| set wifi 0 / set brightness 80 / set dnd 0 | HTTP 200, V2, SET_STATE ENABLED | Mỗi câu prepare 1, start/Session/network 0; chỉ ANALYZE |

**VERIFIED_IN_SOURCE + OFFLINE_PROBE:** `outcome-spec.ts:103` coi verb `dat` là CREATE_RECORD. `source-slots.ts:79` đi nhánh record, `:99` thay numeric slot bằng một SOURCE slot chứa cả `wifi 0`/`brightness 80`/`dnd 0`. Trong khi regex `intent-capabilities.ts:78` đã ghi nhận cả `set|dat`, matcher tại `:80` yêu cầu slot chỉ đúng phần số; vì thiếu slot nên không trả SET_DEVICE_STATE binding. Catalog tại `demo-catalog.ts:93` nhận raw CREATE_RECORD thành RECORD DISABLED. Đây là lỗi giao nhau source-slot/typed binding/diagnostic đã có, **không phải thiếu owner authorization** hoặc model không trả lời.

Evidence: `catalog-alias-stop-probe.json` giữ source, outcome, binding, HTTP body, counters và đối chứng typed; `slot-root-cause.json` giữ slot spans thật. Không có secret/ảnh/model output. Chưa chứng minh bản catalog sửa có thể an toàn giữ mọi source binding; **không sửa catalog hoặc shared parser** theo điều kiện STOP. Muốn hỗ trợ ba biến thể phải duyệt phạm vi sửa source-slot/typed binding rồi kiểm đặc trưng chống nuốt thêm clause, source/value binding, permissions và replay; không được chỉ đổi raw CREATE_RECORD thành setting theo từ khóa trong facade.

Đây là **ba ca mới**, không đổi lịch sử baseline 1290/0/6 thành thất bại ở phần A. Dù typed examples vẫn đạt, không bỏ các ca mới để báo phần B xanh. Dừng implementation tại đây; patch Unified/UI đã có nhưng còn dở dang và chưa full-validated.

### 20.7 Sáu TODO và capability matrix

Giữ nguyên cả sáu TODO cũ trong boundaries; không biến TODO thành PASS hoặc xóa khỏi manifest. Mỗi hàng sau có test B5 `OFFLINE Unified API denies whole request before context/prepare/start/Session: <tên>` **đã PASS**, cùng nguồn negative có trong file.

| TODO cũ | Tên case B5 |
|---|---|
| SSID | SSID TODO |
| record | record TODO |
| Gallery | Gallery TODO |
| URL | URL TODO |
| Maps | Maps TODO |
| Bluetooth | Bluetooth TODO |

| Khả năng | Catalog | Nhãn bằng chứng | Engine Unified mới |
|---|---|---|---|
| Mở app/Settings | ENABLED | ANALYZE OFFLINE_TESTED | V2 |
| Đọc pin/Wi-Fi | ENABLED | ANALYZE OFFLINE_TESTED B; REAL_ANDROID_VERIFIED **lịch sử 25/10 mục 18** | V2 |
| Đọc độ sáng | ENABLED | ANALYZE OFFLINE_TESTED; Android B UNVERIFIED | V2 |
| Typed set wifi/brightness/dnd | ENABLED | ANALYZE OFFLINE_TESTED; Wi-Fi fake journal/restore OFFLINE_TESTED | V2, security gốc |
| Ba biến thể Đặt ... | Không admit, sai RECORD DISABLED | **FAIL**, chưa hỗ trợ đúng dù regex typed có dat | Không plan/engine dispatch |
| Camera/dial/calculation/Drive-YouTube-MyFiles search | ENABLED | ANALYZE OFFLINE_TESTED, không có Android mới | V2 |
| AM/PM clarification | ENABLED | OFFLINE_TESTED: không prepare/effect trước trả lời | Plan sau trả lời là V2 |
| P1 Chrome first organic | EXPERIMENTAL, PENDING | OFFLINE_TESTED logic; **Android UNVERIFIED** | V2, không fallback |
| Alarm/timer | EXPERIMENTAL | ANALYZE OFFLINE_TESTED; **Android UNVERIFIED** | V2 |
| SSID/record/Gallery/URL/Maps/setting bị cắt/P2/ordinal>1 | DISABLED | Whole-source route rejection OFFLINE_TESTED | Không prepare/dispatch |
| Destructive/mixed destructive | HARD_DENY | Whole-source zero-effect OFFLINE_TESTED | Không prepare/dispatch |

`docs/demo-capabilities.md` liệt kê chính xác 17 source đã ANALYZE được, một clarification, câu bị từ chối, giới hạn tiếng Việt và preconditions nghiệm thu. Không quảng cáo câu chưa thử hoặc coi ENABLED là real-device verified.

### 20.8 Validation, hashes và danh sách file

| Kiểm tra | Kết quả thực tế lượt này |
|---|---|
| Full baseline 1290/0/6 | Lịch sử A, source đầu khớp; không run lại |
| m7a sau di dời | 50/50 PASS, `m7a-migration.log` |
| B5 trước ba positive bổ sung | 51/51 PASS sau sửa polling fixture; cả log 49/2 và 51/0 giữ nguyên |
| Targeted cuối 7 file, gồm B5 hiện tại | **185 PASS / 3 FAIL / 6 TODO**; không cộng thành full regression |
| Full manifest 68 + B5 (69 file) | **NOT_RUN_STOP**, không đoán số PASS sau sửa |
| TypeScript / scoped ESLint / full ESLint với 5 exclusions | **NOT_RUN_STOP**; không tái dùng PASS/unused warnings cũ làm kết quả mới |
| Production webpack build ngoài sandbox | **0 lần, NOT_RUN_STOP** do điều kiện dừng; không retry, xóa .next, nâng cấp hoặc bypass. Không nói EPERM/SecurityFatalError lịch sử là lỗi build mới |
| git diff --check | Exit 0, chỉ cảnh báo CRLF có sẵn; scan riêng 15 file tổng cộng (13 source/test + 2 docs) không có trailing whitespace |
| Secret scan giới hạn | 15 file tổng cộng (13 source/test + 2 docs), không có high-confidence token/private-key patterns; không đọc env/sealed/holdout hoặc in key. `final-safety-check.json` |
| AST legacy callbacks | 5/5 body, 17/17 calls bằng nhau; snapshot sáu file 71 definitions, 275 -> 276 calls |
| Android/browser/model thật | NOT_RUN theo phạm vi; 0 tác động Android mới |

Không tiếp tục chuỗi validation sau STOP để tạo ấn tượng phần B đã đạt. Lượt sau vẫn phải chạy **đủ** regression, TS, scoped/full lint đúng exclusions và đúng một build ngoài sandbox khi được tiếp tục; những bước chưa chạy là rủi ro mở của patch hiện tại.

Hash source/test/script cuối: **311 file**, **`aba7b71bf0ea1bff858ed0288ed9cfcdc9c15e581b10f937ec110b14a35569f5`**, cùng thuật toán `SHA256(JSON.stringify(sorted [path, SHA256(bytes)] entries))`. So với đầu lượt: **10 đổi / 3 thêm / 0 xóa**. Docs không thuộc digest. `source-after-stop.json` ghi từng hash; mọi file trong tập đầu không thuộc 10 path dưới đều không đổi byte, bao gồm permission/effect-grants/journal/locks/cancellation/ConditionExecutor/worker/runtime contracts/catalog và hai file A1. Không suy từ git status rằng các sửa cũ của người dùng là do lượt này.

| Nhóm | File đổi/thêm trong lượt |
|---|---|
| Production đổi (5) | `app/api/unified-agent/route.ts`; `components/commands/UnifiedAgentPanel.tsx`; `lib/android/unified-agent/{contracts,capability-router,service}.ts` |
| Test đổi (5) | `tests/{command-engine-controls,engine-merge-boundaries,engine-merge-p1-v2,unified-agent-m7a,unified-engine-coverage}.test.cjs` |
| Test thêm (3) | `tests/engine-merge-single-path.test.cjs`; `tests/helpers/internal-legacy-unified-service.cjs`; `tests/helpers/internal-legacy-router.cjs` |
| Docs | Cập nhật report mục 20/top pointer; thêm `docs/demo-capabilities.md` |
| Bị khóa | `demo-catalog.ts`, `device-runtime.ts`, hai fixture A1 và mọi shared security/worker/schema: **không đổi trong lượt** |

Test-only snapshots tăng số file, chưa phải bước giảm code/archive. Giữ nguyên hai file deleted có sẵn ở git status, không phục hồi hoặc xóa thêm. Không stage/commit/push.

### 20.9 Kết luận tại STOP

**Unified một đường V2 theo catalog (OFFLINE_TESTED ở các ca đã PASS); legacy chỉ qua handler/adaptor nội bộ có characterization; mã V1/Action Plan còn nguyên; chưa kiểm Dashboard thật; P1 chưa nghiệm thu Android.** Câu này chỉ nói đường Unified và bằng chứng từng ca, không chứng nhận toàn bộ phần B hay source runtime đã production-ready.

Ba ca setting tiếng Việt mới vẫn **FAIL**, full validation chưa chạy. Dừng đúng yêu cầu khi cần chạm abstraction nguồn/binding ngoài phạm vi để sửa, không nới catalog/grants, bỏ test hay giữ fallback legacy ẩn. Cần duyệt riêng việc sửa source-slot/typed binding nếu muốn giải quyết ba ca này; không tự sang P2, nghiệm thu thật, archive/xóa hay Teach Mode.

## 21. Phần B tiếp tục lần 3: sửa diagnostic hẹp, STOP tại snapshot Dashboard ngoài phạm vi (26/10/2026)

### 21.1 Preflight và phạm vi được cấp

Đã đọc source thật, git status, mục 17-20 và `docs/demo-capabilities.md`. Branch `DuyTD`, giữ mọi sửa/untracked/deleted có sẵn. Không commit/push/stash/reset/checkout, tạo backup, xóa/archive, đổi env/config/provider/dependency hoặc mở/import sealed/holdout. Không chạy Android, ADB, Appium, Ollama hoặc cloud thật. Test dùng fake adapters và các HTTP loopback của manifest đã duyệt.

Evidence: **`coverage/engine-merge-b3-ixPuep/`**. Hash đầu lượt **311 file**, **`aba7b71bf0ea1bff858ed0288ed9cfcdc9c15e581b10f937ec110b14a35569f5`**, khớp toàn bộ snapshot cuối mục 20; không có source drift. Baseline full phần A vẫn **1290 PASS / 0 FAIL / 6 TODO**, lịch sử có hash đã xác minh; kết quả targeted B2 là 185/3/6, không trộn với full run mới.

Quyền mới chỉ cho sửa diagnostic catalog, không mở thêm cách thực thi setting. Khi khảo sát phát hiện regex test routing cũ không nhận mã lỗi mới, đã hỏi phạm vi trước sửa. Người dùng xác nhận: **"Cho phép bổ sung mã vào regex, giữ nguyên kỳ vọng từ chối"** cho `OFFLINE catalog routing` trong `tests/unified-agent-m7a.test.cjs`. Không có quyền cập nhật test snapshot Dashboard.

### 21.2 Thay đổi hẹp và ba kỳ vọng được đổi

| File | Thay đổi trong lượt |
|---|---|
| `lib/android/unified-agent/demo-catalog.ts` | Sau whole-source safety guard, nhận diện riêng dạng động từ đặt/chỉnh/bật/tắt + tên setting trong clause để **từ chối** UNSUPPORTED_PHRASING. Không sửa source/outcome, không đổi ENABLED/DISABLED, không cấp binding/grant hoặc capability mới |
| `lib/android/unified-agent/capability-router.ts` | Chuyển tiếp đúng mã UNSUPPORTED_PHRASING và lời gợi ý từ catalog qua UnifiedAdmissionError, thay vì gom thành UNSUPPORTED_OUTCOME. DENY vẫn chạy trước catalog |
| `tests/engine-merge-single-path.test.cjs` | Chuyển đúng ba source từ positive loop sang negative loop riêng, giữ đủ ba case; thêm 10 ca natural/mixed whole-source và 4 HARD_DENY priority. Không skip/todo/xóa case |
| `tests/unified-agent-m7a.test.cjs` | Theo quyền bổ sung trực tiếp: thêm đúng UNSUPPORTED_PHRASING vào regex của routing matrix; vẫn assert.throws, không đổi input/expected engine hoặc assertion an toàn |
| Docs | Cập nhật report mục 21/top pointer và `demo-capabilities.md`; không sửa báo cáo lịch sử thành PASS |

Thông điệp chính xác sau code: **"Chưa hỗ trợ cách diễn đạt này. Hãy dùng: set wifi 0 / set brightness 80 / set dnd 0"**. Đây chỉ là gợi ý; không dịch câu người dùng thành lệnh khác. Whole-source có xóa/gỡ/ghi đè vẫn trả HARD_DENY trước khi xét diagnostic mới. Chỉ đọc pin/Wi-Fi hay mở app ở mệnh đề đầu cũng không được chạy khi mệnh đề sau bị từ chối.

| Test source | Kỳ vọng cũ -> mới | Lý do / kết quả run mới |
|---|---|---|
| Đặt wifi 0 | HTTP 200, SET_STATE ENABLED V2 -> HTTP 409 UNSUPPORTED_PHRASING + exact hint, không plan | Parser/typed slot không hỗ trợ; không được sửa parser. **PASS**, zero worker/context/prepare/start/Session/network |
| Đặt brightness 80 | Tương tự positive -> negative diagnostic, không record label | Cùng giới hạn; **PASS**, tất cả counters 0 |
| Đặt dnd 0 | Tương tự positive -> negative diagnostic, không record label | Cùng giới hạn; **PASS**, tất cả counters 0 |
| set wifi 0 | Giữ nguyên positive | **PASS**, V2 SET_STATE ENABLED, prepare 1, start/Session/network 0 |
| set brightness 80 | Giữ nguyên positive | **PASS**, cùng metadata, không có effect thật |
| set dnd 0 | Giữ nguyên positive | **PASS**, cùng metadata, không có effect thật |

Những case mới gồm `tắt wifi`, `đặt độ sáng 80`, `chỉnh brightness 80`, `bật bluetooth`, `tắt không làm phiền`, `chỉnh âm lượng chuông 1`, không dấu `bat wi-fi`, `tat den pin`, hai câu ghép chỉ đọc/mở app + unsupported phrasing; cả 10 PASS. Bốn câu destructive mixed chứa xóa/gỡ/ghi đè trả **403 HARD_DENY**, không mã mới và zero worker/context/prepare/start/Session/network; cả 4 PASS.

Không thêm model/planner path, không hỗ trợ tự nhiên cho đổi cài đặt, không nâng quyền normal mode. Bluetooth/volume/rotation/flashlight/airplane typed vẫn DISABLED như trước.

### 21.3 AST bảo toàn, legacy A / Unified V2 B

Snapshot trước lượt ở bảy file được phép khảo sát: **84 định nghĩa AST / 349 assert calls**; sau: **87 định nghĩa / 364 calls**. Không mất định nghĩa cũ. Chỉ một callback cũ đổi expression: routing regex được duyệt thêm mã. Các callback/assertions khác nguyên text khi normalize CRLF/LF. Ba nguồn FAIL cũ chuyển vòng lặp, không xóa case; thêm ba định nghĩa loop cho negative/priority tests. Không nhầm số định nghĩa AST với số case được Node mở rộng.

Đối chiếu thêm với snapshot **trước khi di dời ở B2**, cả năm legacy callbacks vẫn nguyên body và **17/17 assert calls**. Test helper snapshots không đổi hash, không production import; bản A vẫn đăng ký tiền tố `internal legacy:`. `assertion-preservation.json` lưu tên, counts, expression trước/sau. Hai file A1 và test snapshot gây STOP nguyên byte/hash.

| Thuộc tính | Nhánh A legacy giữ nguyên | Nhánh B Unified V2 / coverage mới |
|---|---|---|
| One-shot/replay/concurrent | replay test, 3 assert calls | B5 simultaneous/replay đúng một source/device/physical/ref-bound task |
| Interpreter không thêm effect | tampered recipe, 2 calls | strict reference-only EXECUTE; debugEngine 400 zero worker; không interpreter/fallback Unified |
| Confirmation trước effect, SENT không thành complete | Wi-Fi legacy challenge/token/reconfirm, 8 calls | CONFIRM legacy rejected; typed Wi-Fi dùng permission/journal/readback/exact restoration gốc với fake native; normal mode zero writes |
| Cancel đúng original signal/evidence | legacy cancel, 3 calls | B5 original controller aborted, raw CANCELLED/evidence giữ nguyên; lost-response cùng task, không replay START |
| Physical-device isolation | legacy setup isolation, 1 call | B5 execution thứ hai cùng physical 409, start chỉ một |
| Source/runtime/policy/owner/TTL | Mọi callback binding/expiry giữ nguyên | m7a changed binding sáu cases, expiry/restart, V2 assistance ownership, fresh foreign device và B5 binding cases PASS |
| Whole-source refusal, no partial execution | Mixed destructive assertions cũ giữ nguyên | 3 migrated negative + 10 variants + 4 HARD_DENY priority; zero context/prepare/start/Session/network |

Mọi hàng trên là **OFFLINE_TESTED** trong full run mới, không chứng nhận Session thật hoặc model tự suy luận. Không sửa `permission-decision`, effect grants, journal, locks, cancellation, ConditionExecutor, worker/runtime schema hoặc parser/planner dùng chung.

### 21.4 Full regression và điều kiện STOP mới

Chạy đúng manifest **68 file cũ + B5 = 69 file**, concurrency 1, không glob tests hoặc đọc cohort bị cấm. Kết quả **1364 entries: 1357 PASS / 1 FAIL / 6 TODO**, 0 cancelled/skip; thời gian Node **204.436 giây** (wrapper 204.625 giây, không cộng hai span lồng nhau). `full-regression.log` và `full-regression-result.json` giữ toàn run. So mốc A 1290/0/6: thêm 68 case B5, nhưng hiện có một failure trong test cũ; không tuyên bố 1358 PASS hoặc 0 FAIL.

B5 hiện tại **68/68 PASS**: 17 nhóm negative cũ + 17 positive đã giữ + 3 diagnostic được duyệt đổi + 10 variants + 4 priority + 5 removed-engine + 12 case counterpart/binding/clarification/control-plane/markup. `single-path-result.json` trích đúng khoảng file trong full log, không chạy lại rồi chọn kết quả đẹp.

Failure duy nhất:

| Test / bằng chứng | Expected | Actual / nguyên nhân |
|---|---|---|
| `tests/safe-refactoring-ui.test.cjs:9`, assertion tại `:15`: `OFFLINE characterization: removing unreachable legacy queue leaves the whole initial Dashboard byte-identical` | Whole-initial-Dashboard SHA-256 `6712b6546cc578ca373826b5120a6f27bc35bdd10bd5d63ace81bc06766bd781` | SHA-256 **`270d9f325288d05c9dbdb1f305fc8b733e95ef1c97bd5c1101939f08c3602e84`**, assertion exact hash FAIL |

**VERIFIED_IN_SOURCE:** test cố định toàn markup chụp ở đợt Safe Refactoring, không chỉ bảo vệ tính chất queue đã bỏ. `docs/safe-refactoring-report.md:102` ghi mốc đó 32.936 byte. UI Unified trong B2 đã bỏ engine tabs/group launcher theo B3; UI không đổi byte trong lượt B3 hiện tại. Catalog/router diagnostic mới không được gọi qua API trong SSR initial.

**OFFLINE_READ_ONLY_PROBE:** render initial Dashboard qua đúng transpiler/React của test, fetch fail-on-call, không sửa test/fixture: **30.290 byte**, đúng actual hash trên. Ba regex còn lại lấy **nguyên biểu thức từ test** đều thỏa: `Tác vụ Android`, `Lịch sử Agent` còn hiện diện; legacy Task Queue vắng mặt. Một input Unified, engine tab IDs/group-version selector không hiện; attempted fetch = 0. `dashboard-snapshot-stop-probe.json` ghi kết quả. Đây không đổi verdict của test FAIL và không thay browser acceptance.

**INFERRED:** invariant toàn trang byte-identical lịch sử không còn tương thích thay đổi UI có chủ đích B3, dù các dấu hiệu lịch sử/queue còn đúng. Không có HTML golden cũ đầy đủ để phân rã mọi byte khác biệt; không kết luận mọi khác biệt đều vô hại. Vì test này ngoài danh sách được sửa, **STOP ngay sau điều tra chỉ đọc**, không thay hash, bỏ assertion, skip hoặc chỉnh UI quay về engine selector để test xanh. Full regression B2 chưa chạy nên không gán mốc phát sinh failure chính xác hơn bằng suy đoán.

### 21.5 TODO, catalog và mức bằng chứng

Giữ cả sáu TODO boundaries, không đổi/xóa hay tự đánh dấu hoàn thành. Mỗi hàng có route B5 PASS trong full run mới, tên prefix `OFFLINE Unified API denies whole request before context/prepare/start/Session:`.

| TODO cũ | Case B5 phủ | Effect / metadata |
|---|---|---|
| SSID | SSID TODO | Toàn câu từ chối, zero context/prepare/start/Session |
| record | record TODO | Như trên, không tạo record |
| Gallery | Gallery TODO | Như trên, không mở Gallery |
| URL | URL TODO | Như trên, không mở URL |
| Maps | Maps TODO | Như trên, không mở Maps |
| Bluetooth | Bluetooth TODO | Như trên, không đổi Bluetooth |

| Khả năng | Catalog | Nhãn bằng chứng hiện tại | Engine |
|---|---|---|---|
| App/Settings, calculation/dial/camera/search app được cho phép | ENABLED | ANALYZE OFFLINE_TESTED; runtime fixture tests PASS; Android mới UNVERIFIED | V2 |
| Đọc pin/Wi-Fi | ENABLED | OFFLINE_TESTED mới; REAL_ANDROID_VERIFIED chỉ **lịch sử 25/10, mục 18** | V2 |
| Đọc độ sáng | ENABLED | OFFLINE_TESTED, Android mới UNVERIFIED | V2 |
| Typed set wifi/brightness/dnd | ENABLED | ANALYZE OFFLINE_TESTED; Wi-Fi fake journal/readback/restore OFFLINE_TESTED | V2, permission gốc |
| Natural đặt/chỉnh/bật/tắt setting | Không admit | UNSUPPORTED_PHRASING rejection OFFLINE_TESTED; **không có khả năng thực thi mới** | Không plan/prepare/Session |
| AM/PM clarification | ENABLED | OFFLINE_TESTED, không prepare/effect trước trả lời | Plan mới V2 |
| P1 Chrome organic đầu tiên | EXPERIMENTAL, PENDING | OFFLINE_TESTED; Android UNVERIFIED | V2 |
| Alarm/timer | EXPERIMENTAL | ANALYZE/logic OFFLINE_TESTED; Android UNVERIFIED | V2 |
| SSID/record/Gallery/URL/Maps/setting bị cắt/P2/ordinal>1 | DISABLED | Whole-source route rejection OFFLINE_TESTED | Không dispatch |
| Destructive và mixed destructive | HARD_DENY | Ưu tiên trước diagnostic mới, zero effect OFFLINE_TESTED | Không dispatch |

`demo-capabilities.md` đã thêm hai mục rõ ràng: cú pháp typed hỗ trợ và cách nói chưa hỗ trợ (`tắt wifi`, `đặt độ sáng 80`...), không tự sửa source theo gợi ý. Metadata EXPERIMENTAL/UNVERIFIED và owner/full-control/normal mode không đổi.

### 21.6 Validation còn thiếu, hashes và quyết định tiếp tục

| Kiểm tra | Kết quả lượt 26/10 |
|---|---|
| Full regression 69 file | **1357 PASS / 1 FAIL / 6 TODO**; 1 ngoài phạm vi được sửa, đã STOP |
| B5 trong full run | **68/68 PASS**, không cần rerun để đổi kết quả |
| TypeScript | **NOT_RUN_STOP**, không tái dùng PASS cũ |
| Scoped ESLint | **NOT_RUN_STOP** |
| Full ESLint đúng năm ignore-pattern | **NOT_RUN_STOP**, không coi warning/lỗi lint lịch sử là kết quả mới; không chạy eslint không exclusions |
| git diff --check | **Exit 0**, chỉ cảnh báo LF/CRLF có sẵn; kiểm riêng whitespace untracked mới trong final-safety-check |
| Production webpack build | **0 lần, NOT_RUN_STOP** vì điều kiện failure ngoài phạm vi. Không xóa .next, retry/upgrade/bypass hoặc dùng lỗi EPERM/SecurityFatalError lịch sử như lỗi mới |
| Secret scan / whitespace riêng | 16 file source/test/doc của B: **không có high-confidence secret patterns hoặc trailing whitespace**, không drift sau STOP; không đọc env/secret/cohort, không in key. `final-safety-check.json` |
| Dashboard browser / Android / model thật | **NOT_RUN**, không tuyên bố nghiệm thu |

Chưa thực hiện chuỗi TS/lint/build sau STOP, nên không đủ điều kiện nói **hoàn tất B**. Không đổi trạng thái BLOCKED/UNVERIFIED hoặc test FAIL thành SUCCESS.

Hash cuối source/test/script **311 file**, **`d8fabfe71974e0545184e6f1e4bd61f8a25ca6b90dfa8b5405725e8713276cb6`**, thuật toán như mục 20. So đầu lượt: **4 đổi / 0 thêm / 0 xóa**, 307 path còn lại nguyên hash. Cụ thể bốn file ở bảng 21.2; hai docs đổi riêng ngoài source digest. Parser/planner/security/runtime/worker, hai A1 và `safe-refactoring-ui.test.cjs` đều không đổi. AGENTS/package/lock/Next/TS/ESLint configuration trong snapshot không drift; không đọc env. Evidence `source-before.json`, `source-after-stop.json`, `assertion-preservation.json`.

**Unified một đường V2 theo catalog (OFFLINE_TESTED); legacy chỉ qua handler nội bộ; mã V1/Action Plan còn nguyên; chưa kiểm Dashboard thật; P1 chưa nghiệm thu Android; cách nói tự nhiên cho đổi cài đặt chưa hỗ trợ.** B1-B6 có code và coverage offline nêu trên, nhưng full validation chưa xanh và chưa hoàn tất B.

Phạm vi tối thiểu cần duyệt tiếp: xem xét **riêng invariant whole-page snapshot trong `tests/safe-refactoring-ui.test.cjs`** theo UI B3 đã yêu cầu; giữ nguyên fetch guard, lịch sử Android/Agent, queue-absence và các kiểm tra an toàn, không chỉ thay expected hash để ép PASS. Chưa thực hiện thay đổi này; chưa có quyền tiếp tục validation sau failure ngoài phạm vi. Dừng sau báo cáo, không tự sang P2, nghiệm thu thật, archive/xóa hoặc Teach Mode; không commit/push.

## 22. Phần B: lượt hoàn tất offline và đầy đủ validation (26/10/2026)

### 22.1 Preflight, quyền sửa và hash đo lại

Đã đọc mục 21, source test và git status; branch `DuyTD`. Giữ nguyên mọi thay đổi chưa commit, kể cả hai file deleted có sẵn. Không tạo backup, commit/push/stash/reset/checkout, đọc/import sealed/holdout, đổi env/config/provider/dependency, xóa/archive hoặc chạy Android/Appium/ADB/Ollama/cloud planner thật. Manifest 69 file được kiểm tra không chứa các path bị cấm; không chạy glob thư mục tests.

Evidence mới: **`coverage/engine-merge-b-final-QNztNa/`**. Source/test/script đầu lượt **311 file**, SHA-256 **`d8fabfe71974e0545184e6f1e4bd61f8a25ca6b90dfa8b5405725e8713276cb6`**, khớp đúng yêu cầu và cuối mục 21. `source-before.json` lưu từng path/hash, manifest và git status; không đọc env/secret để làm snapshot.

Trước sửa test, dùng chính require hook/transpiler, React `renderToStaticMarkup`, Dashboard entry point và fetch fail-on-call của file test. Đo lại **30.290 byte**, SHA-256 **`270d9f325288d05c9dbdb1f305fc8b733e95ef1c97bd5c1101939f08c3602e84`**, đúng giá trị được duyệt. Ba regex lấy nguyên từ test đều thỏa; attempted fetch **0**. `dashboard-preflight.json` ghi hash/bytes/regex checks; đây là SSR offline, không phải tương tác browser.

Chủ dự án đã duyệt mốc UI mới: B3 bỏ engine selector và group launcher, vì thế snapshot toàn initial Dashboard đổi từ **32.936 -> 30.290 byte**. Mốc cũ được ghi trong Safe Refactoring; lần này chỉ đo lại mốc mới, không giả vờ tái dựng toàn HTML cũ hoặc chứng minh từng byte khác biệt đều vô hại.

### 22.2 Bảng sửa hash và bảo toàn AST

| File / phần | Trước | Sau | Phạm vi |
|---|---|---|---|
| `tests/safe-refactoring-ui.test.cjs:15`, expected hash | `6712b6546cc578ca373826b5120a6f27bc35bdd10bd5d63ace81bc06766bd781` | `270d9f325288d05c9dbdb1f305fc8b733e95ef1c97bd5c1101939f08c3602e84` | **Đúng 1 literal hash** theo quyền duyệt |
| Test title tại `:9` | `OFFLINE characterization: removing unreachable legacy queue leaves the whole initial Dashboard byte-identical` | `OFFLINE characterization: initial Dashboard markup after unified single-path UI is stable` | Đổi tên để phản ánh UI có chủ đích đã thay đổi; không tuyên bố byte-identical với UI trước B3 |

`assertions-before.json` lưu source/callback/assert AST trước sửa; `assertion-preservation.json` so sau sửa: **2/2 test definitions**, **6/6 assert call expressions** vẫn còn. Toàn file chỉ khác hai thay đổi trong bảng sau khi normalize CRLF/LF. Callback thứ nhất bằng nhau khi thay đúng literal hash được duyệt; callback thứ hai nguyên nội dung. Không thêm comment hoặc thay helper/fixture/body khác.

Giữ nguyên **fetch guard**, `finally` khôi phục fetch, ba regex `Tác vụ Android` / `Lịch sử Agent` / không legacy Task Queue, assertion kiểm tham chiếu queue island, mọi input và vòng lặp. Không nới assertion safety, bỏ/skip/todo test, hoặc thay runtime để khớp snapshot. Năm legacy characterization callbacks cùng 17 assert calls từ B2 cũng không bị sửa trong lượt này; toàn bộ file của chúng nguyên hash và full regression PASS.

### 22.3 Validation đầy đủ, không chồng thời gian

Chạy đúng thứ tự yêu cầu, chờ mỗi process kết thúc trước khi bắt đầu bước sau. Log/result JSON riêng trong thư mục evidence. Thời gian dưới là từng command wrapper, không cộng các span lồng nhau để suy ra thời gian execution hay inference.

| Bước | Lệnh/phạm vi | Kết quả thật | Thời gian |
|---|---|---|---:|
| 1. Full regression | Node test, concurrency 1, **69 file manifest** | **1358 PASS / 0 FAIL / 6 TODO**, 1364 entries; 0 skipped/cancelled; exit 0 | 186.779 s; Node runner 186.586 s nằm trong wrapper |
| 2. TypeScript | `tsc --noEmit --incremental false` | **PASS**, exit 0, không diagnostic | 36.551 s |
| 3. Scoped ESLint | Chỉ `tests/safe-refactoring-ui.test.cjs`, đủ năm exclusions | **PASS**, exit 0, 0 warning | 117.578 s |
| 4. Full ESLint | `.`, đủ năm exclusions | **Exit 0, 0 errors / 4 warnings**, xem bảng dưới | 56.250 s |
| 5. Diff check | `git diff --check` | **PASS**, exit 0; chỉ 37 cảnh báo LF/CRLF có sẵn | 0.256 s |
| 6. Production webpack build | `node node_modules/next/dist/bin/next build --webpack`, **ngoài sandbox**, đúng **1 lần** | **FAIL / TOOLCHAIN_SECURITY_GUARD**, exit 1 **SecurityFatalError**; không retry | 125.738 s |

Năm exclusions dùng trong **cả hai** lệnh lint:

```text
--ignore-pattern '**/*holdout*'
--ignore-pattern '**/*holdout*/**'
--ignore-pattern '**/*sealed*'
--ignore-pattern '**/*sealed*/**'
--ignore-pattern 'tests/general-agent-v2-open-world.test.cjs'
```

Full regression mới thay kết quả 1357/1/6 ở mục 21 bằng **1358/0/6**, do đúng snapshot được duyệt nay PASS; không thay verdict lịch sử. So baseline A **1290/0/6**, manifest B có thêm **68 case B5**, nay đều PASS. Sáu TODO boundaries còn nguyên, không tính chúng là capability thành công. SSID/record/Gallery/URL/Maps/Bluetooth tiếp tục có B5 route rejection coverage và zero context/prepare/start/Session như mục 21.5; không bật lại khả năng bị cắt.

Các warning lint được giữ, không sửa ngoài phạm vi:

| File / dòng | Warning | Nguồn/trạng thái |
|---|---|---|
| `components/commands/ActionPlanPreview.tsx:4` | `FileJson` unused | Warning cũ, file không đổi trong lượt |
| Cùng file `:6` | `cn` unused | Warning cũ |
| `components/devices/DeviceFilters.tsx:6` | `Maximize2` unused | Warning cũ |
| `tests/helpers/internal-legacy-unified-service.cjs:7` | `@typescript-eslint/no-unused-expressions` | Warning từ snapshot helper B2, đã thấy ở run mục 22 này; không gọi là một trong ba warning cũ hoặc lỗi test mới |

### 22.4 Build: đã compile, nhưng không phải PASS

`build-attempt.json` và `build-result.json` ghi attempts **1**, outsideSandbox **true**, exitCode **1**. Build log ghi Next.js **16.4.0 / webpack**, compile thành công, TypeScript nội bộ xong, static generation **13/13**, sau đó liệt kê routes và kết thúc bằng diagnostic:

```text
> Build error occurred
Error [SecurityFatalError]: Your version of Next.js is affected by a known security vulnerability.

**We strongly recommend you upgrade Next.js.**
```

Log nguyên trạng của lượt build ở **`coverage/engine-merge-b-final-QNztNa/build.log`** (chỉ có bước redaction token nếu xuất hiện, không đọc env). CLI còn gợi ý retry/upgrade; **không thực hiện**, vì yêu cầu chỉ cho một build và cấm retry/upgrade/bypass. Không mở worktree nâng cấp hoặc chạy lệnh upgrade. Khuyến nghị nâng cấp là từ CLI, không phải kết luận đã xác minh advisory/CVE trong lượt này.

Webpack cũng ghi hai warning giống nhau **`module.createRequire failed parsing argument.`**, trace từ `lib/android/appium/session-manager.ts` tới `app/api/devices/route.ts`. Compile vẫn xong nhưng warning này chưa được sửa hay nghiệm thu real Appium; không quy thành lỗi code mới do literal test.

Phân loại kết quả: **không có regression test/type error** mới; build bị chặn bởi **toolchain security guard**, không phải EPERM dưới .next hoặc lỗi compile ứng dụng được đo. Không nói production build/deployment đã PASS. Không gặp EPERM trong lần này, nên không dừng dev/worker hoặc dọn .next; không dùng các lỗi môi trường lịch sử thay diagnostic hiện tại. Toàn bộ validation đã thực sự chạy, không còn bước NOT_RUN trong sáu bước yêu cầu.

Theo AGENTS.md, đã thực hiện reporting pass cho friction CLI cuối build; chỉ chuẩn bị thông tin ẩn danh để người dùng xem xét, không gửi feedback thay người dùng, không đưa source/log/path/secret/dữ liệu dự án vào nội dung feedback. Lệnh đọc protocol có một lần sandbox thiếu network và một lần đọc lại có network; đây **không phải** build/retry/upgrade hoặc gọi cloud planner.

### 22.5 Capability và mức bằng chứng sau B

| Khả năng | Catalog | Nhãn bằng chứng | Engine/đường |
|---|---|---|---|
| Mở app và Settings | ENABLED | OFFLINE_TESTED; chưa có Android mới | Unified -> V2 |
| Đọc pin/Wi-Fi | ENABLED | OFFLINE_TESTED mới; REAL_ANDROID_VERIFIED chỉ **lịch sử 25/10 mục 18** | V2 typed READ_STATE |
| Đọc độ sáng | ENABLED | OFFLINE_TESTED; Android mới UNVERIFIED | V2 |
| Typed `set wifi 0`, `set brightness 80`, `set dnd 0` | ENABLED | ANALYZE OFFLINE_TESTED; fake Wi-Fi journal/readback/restore PASS | V2, permission/journal gốc |
| Natural đặt/chỉnh/bật/tắt setting | Không admit | UNSUPPORTED_PHRASING rejection OFFLINE_TESTED; **chưa hỗ trợ thực thi** | Không plan/prepare/Session |
| Camera / dial prefill / calculation / SEARCH app trong allowlist | ENABLED | OFFLINE_TESTED bằng compiler/fixtures; không chứng minh Android mới | V2 |
| AM/PM clarification | ENABLED | OFFLINE_TESTED; chỉ có plan mới sau câu trả lời, không effect trước đó | V2 |
| P1 Chrome organic đầu tiên | EXPERIMENTAL, PENDING | OFFLINE_TESTED; **Android UNVERIFIED** | V2, không fallback |
| Alarm/timer | EXPERIMENTAL | OFFLINE_TESTED; **Android UNVERIFIED** | V2 |
| SSID/record/Gallery/URL/Maps/setting bị cắt/P2/ordinal>1 | DISABLED | Whole-source route refusal OFFLINE_TESTED | Không dispatch |
| Destructive/mixed destructive | HARD_DENY | Zero-effect priority tests OFFLINE_TESTED | Không dispatch |

Catalog/router, plan binding, TTL, owner/full-control, effect grants/journal, freshness, identity, locks, cancellation, Session ownership và independent verification **không thay đổi** trong lượt này. Thử nghiệm fake PASS không được dùng làm bằng chứng AI tự suy luận app mới hoặc biến SENT/BLOCKED thành COMPLETED.

### 22.6 Hash cuối và phạm vi hoàn tất

Hash source/test/script cuối **311 file**, **`a6b42179c568033e971a9c22f9507281e4e240dddce71bcede29c2aaa5d97e59`**. Thuật toán như các snapshot trước: SHA-256 của JSON entries `[path, SHA256(bytes)]` được sort theo path. So đầu lượt **d8fabfe7...76cb6**: **1 file đổi / 0 thêm / 0 xóa**, chỉ `tests/safe-refactoring-ui.test.cjs`; **310 file khác nguyên hash**. `source-after.json` ghi đầy đủ từng hash; AGENTS/package/lock/Next/TypeScript/ESLint configurations trong snapshot không drift. Hai A1, demo-catalog, shared parser/planner/security/runtime/worker và ConditionExecutor đều giữ nguyên byte.

Docs ngoài source digest: cập nhật `docs/engine-merge-report.md` mục 22/top pointer và đầu/nguồn/giới hạn trong `docs/demo-capabilities.md`; bỏ STOP khỏi trạng thái hiện tại của demo, giữ nguyên lịch sử mục 19-21. Evidence/log/generated build output không được coi là source thay đổi. Không tạo/xóa dữ liệu người dùng, không sửa hai file deleted có sẵn của working tree, không stage/commit/push.

`final-safety-check.json`: scan giới hạn **17 file** source/test/doc của B không có high-confidence secret patterns hoặc trailing whitespace; không đọc env/cohort hoặc in nội dung key. Hash source/config không drift sau validation; final diff check exit 0. B5 được trích từ full log mới đạt **68/68 PASS**, không chạy lại để chọn kết quả.

**Unified một đường V2 theo catalog (OFFLINE_TESTED); mã V1/Action Plan còn nguyên, chưa archive/xóa; chưa kiểm Dashboard bằng trình duyệt thật; P1 chưa nghiệm thu Android.** Legacy giữ ở handler nội bộ/characterization; natural setting phrasing chưa hỗ trợ. Phần sửa và regression offline B đã đạt, đủ sáu bước validation đã chạy; **production build còn BLOCKED bởi SecurityFatalError**, bốn warning lint và warning webpack được báo nguyên trạng, không tuyên bố toàn hệ thống production-ready.

Kết thúc sau B theo yêu cầu. Không tự chuyển P2, nghiệm thu thiết bị thật, archive/xóa, Teach Mode hay nâng cấp bảo mật; không âm thầm fallback engine hoặc mở thêm quyền.

## 23. Dashboard Browser Acceptance (C1, 26/10/2026)

### 23.1 Phạm vi và verdict

**BLOCKED, chưa đủ điều kiện sang Android Acceptance.** Báo cáo chi tiết: `docs/dashboard-browser-acceptance.md`. Evidence mới, không ghi đè lượt cũ: **`coverage/dashboard-browser-c1-tAo3QG/`**. Branch `DuyTD`; giữ mọi thay đổi chưa commit/deleted có sẵn. Không sửa runtime/test/config/provider/dependency, không commit/push, không sealed/holdout/open-world fixture hoặc thao tác thiết bị.

| Lớp | PASS | FAIL | BLOCKED | NOT_RUN | Cách tính |
|---|---:|---:|---:|---:|---|
| A, real browser + mocked backend | 0 | 0 | 1 | 19 | A00 bootstrap bị chặn; C01-C19 chưa chạy |
| B, real browser + real route/fake worker | 0 | 0 | 0 | 19 | Tùy chọn, C01-C19 chưa chạy qua browser |

Không cộng hai lớp. **Một API-only preflight 200 không tính browser PASS.** Không cấp nhãn browser-tested cho source/catalog/fixtures mới soạn hoặc initial DOM. Bảng đầy đủ request/expected/actual/verdict/evidence ở báo cáo C1; `browser-acceptance-result.json` có mẫu số và từng ca.

### 23.2 Browser thực, isolation và rào cản

Đã dùng in-app Chromium với URL proxy loopback 54027. Proxy chỉ lấy frontend/static/HMR từ Next.js 3000; mọi API bị intercept, không chuyển tiếp API thật, EXECUTE/START/owner/legacy routes bị chặn. Lớp A dùng fixtures phân biệt đúng source. Lớp B load hàm production Unified route/service/catalog/compiler, fake worker chỉ GET/PREPARE; không nghiệm thu Next HTTP adapter hoặc worker thật. Không cài automation package, bypass security hoặc khởi động Android/model.

Browser đã render initial Dashboard nhưng chưa xác minh được React hydration: không thấy fake device, Analyze disabled, chờ option timeout, click Wi-Fi chưa đổi trạng thái React được quan sát, không browser API request. HTTP root/static preflight 200 không thay thế tương tác browser. Khi dừng proxy v1 an toàn để chuyển harness sang in-memory capture, tab gặp ERR_CONNECTION_REFUSED; sau đó browser URL policy chặn tab đang ở generated data error page, kể cả thao tác quay về URL gốc. V2 không nhận frontend request; không chứng minh điều chỉnh harness đã sửa bootstrap.

**Chưa xác định root cause ứng dụng.** Không quy lỗi cho Next/Dashboard khi chưa tách proxy/HMR/browser instrumentation. Không xem lỗi kết nối lúc proxy dừng là regression production. Không có screenshot lưu được; console ban đầu không có warn/error được query, nhưng full console export cuối không khả dụng, không tuyên bố JavaScript-error-free. `browser-console.log` chỉ là ghi chú thu thập, không raw log. Đã trả browser hidden; tab tạm không đánh dấu giữ lại, lệnh close bị policy của trang lỗi chặn.

### 23.3 API-only preflight, safety và phát hiện source

Một request Node HTTP `ANALYZE read battery` với device giả: production route functions trả **200, V2, READ_STATE ENABLED**, giữ source, có plan không execution; fake GET **2**, PREPARE **1**, real compiler COMPLETE. Evidence `network-summary.json`; đây **không phải** browser C03 bằng tiếng Việt hoặc Android acceptance.

Tổng hai proxy: frontend HTTP **325** (gồm CLI preflight, không phải 325 browser actions), API requests **1** nêu trên; API forwarded tới Next **0**, real worker **0**, START **0**, Appium Session **0**, ADB **0**, model **0**, external fetch attempts trong harness **0**, owner changes **0**, execution grants **0**. Network thật chỉ có loopback frontend/static/HMR/harness trong scope đã kiểm tra, không gọi Android/Ollama/Groq/cloud qua test. Không suy counters thành kiểm toán toàn bộ dịch vụ của người dùng.

**SOURCE_CONFIRMED / BROWSER_UNVERIFIED:** `lib/android/device-selection.ts:43-49` fallback sang device READY khác khi selection cũ không READY; `hooks/useDashboardDemo.ts:50-53` áp kết quả. Đây là rủi ro trái yêu cầu C17, chưa browser repro và không có bằng chứng thực thi nhầm máy. Đề xuất riêng: giữ/clear selection mất kết nối, phân biệt initial auto-selection và yêu cầu chọn lại; thêm selection unit test và browser offline-with-other. **Chưa sửa.** Chưa đủ evidence để chỉ định bản vá hydration ứng dụng.

### 23.4 Bảo toàn và kết thúc

Baseline đầu C1 khớp hash lịch sử **311 file `a6b42179c568033e971a9c22f9507281e4e240dddce71bcede29c2aaa5d97e59`** ở mục 22. Fresh hash cuối: **309 file trong phạm vi so sánh không đổi**; hai path open-world không đọc/hash lại, không trình bày digest 311 lịch sử như phép đo mới. Bảy config/AGENTS/package/lock trong preflight không drift. Prefix toàn report có trước mục 23 được giữ byte-identical, gồm lịch sử failure mục 0-22. `demo-capabilities.md` không đổi vì chưa có bằng chứng đủ nâng nhãn.

`git diff --check` **exit 0**; scoped scan file C1 viết không thấy high-confidence secret/trailing whitespace, không đọc env/secret. Không rerun regression/TypeScript/lint/build theo yêu cầu C1. Số **1358/0/6**, B5 68/68, TS/scoped lint PASS, full lint 0 errors/4 warnings và build exit 1 **SecurityFatalError** là **baseline lịch sử mục 22**, không phải kết quả validation mới.

Hai proxy do C1 tạo đều shutdown an toàn, exit **0**; fake active tasks **0**, fake owner modes **0**, không Session/grant/effect tạo bởi C1. Không dừng Next/worker/Appium/Ollama của người dùng hoặc tuyên bố toàn máy không còn tác vụ bằng kết quả giả. File mới: báo cáo C1 và harness/evidence ignored; chỉ append report này, không sửa source/test. `final-safety-check.json` lưu status/hash/cleanup/counters.

**Unified vẫn một đường V2 theo catalog (OFFLINE_TESTED); chưa chứng nhận browser Analyze, Android P1 vẫn UNVERIFIED, mã V1/Action Plan còn nguyên.** C1 dừng vì interactive browser chưa khả dụng trong môi trường cô lập; không tự sang C2/P1 Android, P2, temporal acceptance, sửa SecurityFatalError, archive/xóa hoặc Teach Mode.

### 23.5 C1 thử lại: tab mới và evidence mới (26/10/2026)

Theo yêu cầu C1 được gửi lại, đã đọc source/report/status trên DuyTD, giữ nguyên dirty/deleted có sẵn, không sửa runtime/test/config, không commit/push hoặc đọc excluded material. Evidence mới **coverage/dashboard-browser-c1-retry-GWeUKg/**; mọi evidence cũ giữ nguyên. Bản docs/dashboard-browser-acceptance.md trước lượt này được giữ byte-identical ở previous-acceptance-report.md trong directory mới; báo cáo chính cập nhật kết quả mới. Mục 23.1-23.4 và toàn report cũ giữ nguyên, không đổi verdict lịch sử.

Read-only inventory thấy Next 3000, Appium 4723, Ollama 11434, một possible-worker PID; không gọi health/task/device/model API hoặc tuyên bố worker idle. Không restart/stop dịch vụ người dùng. Proxy riêng **58747**, API intercepted hoàn toàn, A dùng fixtures theo source, B giữ production route functions/service/catalog/compiler với fake worker/tripwire. Không proxy EXECUTE/owner/legacy API hoặc gửi API thật tới Next/worker; không cài dependency hoặc bypass security.

### 23.6 Kết quả browser và API-only, không gộp số

| Lớp mới | PASS | FAIL | BLOCKED | NOT_RUN | Mẫu số |
|---|---:|---:|---:|---:|---|
| A, browser + mock backend | 0 | 0 | 1 | 19 | A00 bootstrap + C01-C19 |
| B, browser + production route/fake worker | 0 | 0 | 0 | 19 | C01-C19 chưa chạy qua browser |

**API-only C15 riêng: 1/1 check hợp lệ PASS, không tính browser.** Có hai probes giữ trong evidence: lần đầu CLI encoding thay ký tự tiếng Việt thành dấu hỏi, không tính exact-source; lần sau Unicode escape truyền đúng Mở YouTube và debugEngine: null, trả **400 ENGINE_SELECTION_REMOVED**, không plan/worker/context/PREPARE. Không kiểm compiler qua câu này vì reject trước bước đó; không gọi đây là Next HTTP adapter/worker acceptance.

Browser dùng **tab tạm mới**, không tái dùng error tab. Dashboard initial render được; không thấy device giả, Analyze disabled, chờ option không thành công. Click Wi-Fi chỉ focus, USB vẫn selected, chưa chứng minh React state/event handlers hoạt động. **0 browser API request**, không có browser ANALYZE. Proxy ghi **320 frontend responses 200, gồm 10 GET root**; chỉ một điều hướng mở trang chủ động, nguyên nhân requests lặp lại chưa xác minh. Không gán thành lỗi Next/HMR hoặc ứng dụng khi chưa tách được môi trường.

Lần này lưu được **screenshots/bootstrap.jpg**, **bootstrap-dom.txt**, **browser-console.log** thật: 6 info, 0 error/warning trong capture; không coi đó là bảo đảm full JavaScript/promise execution. **Không gặp lại chặn URL policy**: đóng tab khi proxy còn chạy. Vì blocker tái hiện trên tab mới, không thể giải thích toàn bộ bằng stale error tab của lượt trước. Root cause hydration/frontend/build state/proxy/browser instrumentation vẫn **UNVERIFIED**. Không cấp nhãn browser-tested hoặc dùng initial DOM/SSR làm PASS.

Bảng từng request/expected/actual/verdict/evidence ở docs/dashboard-browser-acceptance.md và browser-acceptance-result.json. C01-C14, no-device, unavailable/no-silent-switch, error/timeout/loading, engine/group/legacy queue controls chưa đủ interactive assertions. Không tự chạy EXECUTE, không tạo plan thành COMPLETED giả, không có browser completion để chấm false-completion.

### 23.7 Safety, bảo toàn và giới hạn validation lượt thử lại

Counters mới: API **2 CLI / 0 browser**; API forwarded Next **0**, real worker **0**, fake GET/PREPARE **0/0**, START **0**, Appium Session **0**, ADB **0**, model **0**, external fetch attempts trong harness **0**, process attempts **0**, owner changes **0**, execution grants **0**. Có loopback network thật lấy frontend/static/HMR/harness, không gọi Android/Ollama/Groq/cloud qua test. Không suy counters thành kiểm toán global user services.

**309 source/test/script trong scope trước-sau không đổi, 7 config/AGENTS/package/lock không drift**; không đọc/hash lại hai excluded open-world paths, không gọi digest 311 lịch sử là phép đo mới. Prefix report trước lượt mới giữ nguyên byte; demo-capabilities.md không đổi. git diff --check **exit 0**, scan hẹp file C1 viết không có high-confidence secret/trailing whitespace; không đọc env/secret. final-safety-check.json lưu status/hash/cleanup.

Không rerun regression/TS/lint/build vì source không sửa. **1358/0/6**, B5 68/68, TypeScript/scoped lint PASS, full lint 0 errors/4 warnings, build exit 1 SecurityFatalError vẫn là **baseline lịch sử mục 22**, không phải validation mới. Không sửa security guard hoặc nâng dependency.

Tab mới đã đóng trước proxy shutdown; proxy session **39420 exit 0**, graceful. Fake active tasks/owner modes **0/0**, không real Session/grant/mode/effect được tạo bởi C1. Không force-kill hoặc tắt dịch vụ người dùng; không tuyên bố global tasks bằng 0 từ mock.

### 23.8 Findings và quyết định

**P1 TEST_INFRA_BLOCKED:** interactive bootstrap tái hiện không đạt, có ảnh/DOM/network/console; chưa đủ bằng chứng chỉ định patch ứng dụng. Bước điều tra riêng có thể kiểm trạng thái dev/build và proxy/HMR/browser, hoặc thử lại sau chủ dự án restart Next; chưa thực hiện và không tuyên bố restart sẽ sửa lỗi.

**P1 VERIFIED_IN_SOURCE / BROWSER_UNVERIFIED:** đọc lại device-selection.ts:43-49 thấy fallback sang READY device khác khi selection cũ không READY; useDashboardDemo.ts:50-53 áp selection, trái kỳ vọng C17. Chưa browser repro/dispatch nhầm máy. Đề xuất patch riêng ở helper + selection regression/browser offline-with-other, phân biệt initial auto-select với selected device unavailable, giữ identity/plan binding; **không sửa trong C1**.

**Chưa đủ điều kiện sang Android Acceptance.** Lượt mới chỉ bổ sung bằng chứng browser bootstrap và API rejection, không chứng minh browser Analyze/AI/Android hoặc production-ready. Unified vẫn V2 theo catalog OFFLINE_TESTED; Android/P1 vẫn UNVERIFIED. Dừng C1, không C2/P1 Android, P2, temporal acceptance, SecurityFatalError fix, archive/xóa hoặc Teach Mode; không commit/push.

## 24. C1-D: nguyên nhân Dashboard bootstrap đã xác minh (26/10/2026)

### 24.1 Kết luận và phạm vi

**Root cause VERIFIED: hai lỗi môi trường harness C1 nối tiếp, không cần application patch.** Báo cáo đầy đủ ở docs/dashboard-bootstrap-diagnosis.md; evidence mới **coverage/dashboard-bootstrap-diagnosis-qCSPHD/**. Giữ nguyên toàn bộ mục 0-23 và evidence cũ, không đổi lịch sử BLOCKED/NOT_RUN thành PASS. Không sửa runtime/test/config/provider/dependency, không commit/push, không C01-C19 hoặc Android execution.

Hai harness cũ tại coverage/dashboard-browser-c1-tAo3QG/c1-proxy.cjs:168-169 và coverage/dashboard-browser-c1-retry-GWeUKg/c1-proxy.cjs:168-169 chỉ cho **/_next/webpack-hmr**. Next hiện cài dùng **/_next/hmr**, được xác nhận ở node_modules/next/dist/client/dev/hot-reloader/app/web-socket.js:63 và network thật. Đối chứng instrumented legacy-only ghi **16 upgrade path mới bị từ chối, 0 browser API**.

Sửa path thôi chưa đủ: origin **127.0.0.1** bị dev origin policy hiện có từ chối. Probe original Next nhận raw **Unauthorized / HPE_INVALID_CONSTANT**; **localhost** hợp lệ nhận **101** trên current endpoint. Không đổi allowedDevOrigins, rewrite browser Origin hoặc bỏ security guard. Browser thực sự mở localhost qua proxy; same CSP/Next/source giữ nguyên.

### 24.2 Đối chứng và causal evidence

| Kiểm tra | Kết quả thật |
|---|---|
| D1 JavaScript riêng | **PASS trước/sau**: external script chạy, click count 0 -> 1, GET giả true; 2 browser probe GET tổng hai lần |
| D2 React tối thiểu | **PASS trước/sau**: SSR/hydrateRoot, useEffect GET true, useState count 0 -> 1, không recoverable hydration error quan sát; dependencies đã có, không next production build |
| D3 JS asset body/MIME | **23/23** capture JS HTTP 200, MIME JavaScript, body bằng byte với original, parse hợp lệ, **0 HTML fallback** |
| D4 proxy/original | Cùng script URLs và Flight inline payload; root request IDs động làm full root SHA khác, không phải body corruption |
| HMR legacy-only | BLOCKED; path mới bị destroy, không device/API, click Wi-Fi chỉ focus |
| HMR path sửa, origin 127 | Vẫn BLOCKED, chưa có handshake/API; original probe xác nhận Unauthorized |
| HMR path sửa + browser localhost | **101, HMR connected**, 8 text/2 binary/1 close frames; fake device hiện, Analyze enable; click Wi-Fi aria-selected đổi và form IP/port xuất hiện |
| D5/D6 | Không cần source patch hoặc restart để gỡ blocker; Next listener vẫn PID **13476**, parent 22240; không xóa .next, upgrade hoặc bypass build guard |

Framework source giải thích dependency: app-index.js:155,184 nối debug channel vào Flight decoder, :239-241 mở HMR rồi await initialServerResponse trước :290 hydrateRoot. react-server-dom-turbopack-client.browser.development.js:5365-5377 đọc cả Flight và debug stream; hot-reloader-app.js:424-436 ghi/đóng writer từ HMR frames. Mất dev transport làm HTML vẫn có nhưng React tree/hydration chưa hoàn tất; đây không đơn thuần là nút bị policy từ chối.

useDashboardDemo.ts:68 chỉ gửi /api/devices qua mount effect và refresh tại :39; ConnectionManager.tsx:52,94 dùng state tab/setTab. Trước hydrate, effect/handler chưa hoạt động; sau sửa harness cùng source chạy được cả GET và Wi-Fi transition. Không có bằng chứng cần sửa hai hook này cho blocker đã tái hiện. SecurityFatalError production lịch sử không phải nguyên nhân cần thiết ở đây: cùng server/version hoạt động khi chỉ sửa harness.

### 24.3 Network, safety và giới hạn

Stage2 sau fix ghi **284 browser API requests, đều GET giả**: devices **27**, wireless **27**, agent/runtime **54**, unified-agent **176**. Đây là traffic polling/bootstrap/Fast Refresh trong cửa sổ quan sát, không phải 284 tasks hoặc inference. Không có browser ANALYZE/EXECUTE/START/owner POST. Network có loopback thật; original server chỉ nhận GET root/static và readonly HMR probes/connection, không real control API.

Một DevTools font **/__nextjs_font/geist-latin.woff2 trả 403** do strict harness asset allowlist, giữ nguyên và không che; không ngăn hydration. Console after có HMR connected/Fast Refresh, không warn/error trong capture; không suy console API thành full network error audit. CSP production không đổi; cùng CSP proxy sau fix hoạt động, không gán CSP là nguyên nhân blocker.

**0 Android execution / real worker dispatch / ADB / Appium / Ollama / Groq / owner changes / grants.** Harness không import Android runtime, API đều fake/deny; không dựa duy nhất vào counter để tuyên bố global user-service state. Hai server chẩn đoán sessions **25771 / 23132 exit 0**, tabs đóng trước shutdown; user services không restart/force-kill. Không tạo data hoặc Session thật.

### 24.4 Bảo toàn và bước kế tiếp

**309 source/test/script + 7 config/AGENTS/package/lock không đổi hash**. Báo cáo C1 và demo-capabilities.md nguyên hash; toàn report trước mục 24 giữ byte-identical. Không đọc/import excluded material hoặc env/secret. git diff --check **exit 0**, scoped high-confidence secret/whitespace scan không finding. Không rerun regression/TS/lint/production build; **1358/0/6**, B5 68/68, TS PASS, full lint 0 errors/4 warnings và SecurityFatalError vẫn chỉ là baseline lịch sử mục 22.

Chỉ sửa harness chẩn đoán mới, không đụng hai harness cũ/evidence lịch sử. Lượt C1 kế cần đưa đúng current HMR path + URL localhost vào harness mới, giữ query/correlation và Origin thật, API isolation và mọi assertion nghiệp vụ. Bổ sung harness regression cho HMR deny/allow/origin, D1/D2, body/MIME và zero upstream control dispatch. **Application files cần sửa cho blocker này: không có.** Rủi ro selection C17 khác vẫn chưa nghiệm thu.

**Đã đủ bằng chứng quay lại C1, chưa đủ để sang Android Acceptance.** Diagnostic bootstrap PASS với backend giả không thay verdict C01-C19, AI hay Android. Dừng C1-D theo yêu cầu; không C2/P1 Android, P2, Teach Mode hoặc commit/push.

## 25. C1-Final: Dashboard Browser Acceptance sau HMR (2026-10-26)

**A00 PASS; C1-Final FAIL.** Lớp A: **16 PASS /2 FAIL /0 BLOCKED /1 NOT_RUN**. Lớp B: **16 PASS /2 FAIL /0 BLOCKED /1 NOT_RUN**. C15 riêng API-only **PASS** (400 ENGINE_SELECTION_REMOVED), không cộng vào browser PASS. Không cộng hai lớp thành một tỷ lệ. Lịch sử các mục1-24 giữ nguyên.

### 25.1 Browser và route thật

Evidence mới: `coverage/dashboard-browser-c1-final-Kn6YYV/`; chi tiết từng bảng C01-C19, root cause và giới hạn trong `docs/dashboard-browser-acceptance.md`, phần C1-Final F1-F8. `test-matrix.json` có38 row với assertions/network provenance, `final-acceptance.json`, `browser-network.json`, screenshots/ và cases/. A00 xác minh hydration, HMR101 `/_next/hmr` với Origin localhost nguyên, fake device selectable, Analyze enabled, USB/Wi-Fi state thay đổi. Không rerun D1/D2.

Lớp A fixture theo từng source. Lớp B gọi production Unified GET/POST functions -> service/router/catalog -> fake worker PREPARE -> real goal compiler, giữ source/device/V2. **Không phải Next HTTP production adapter, real worker hoặc Android acceptance.** Runtime digest/context giả; không chạy full prepared-v2/inference. C01-C14 đúng, gồm READ_STATE pin/Wi-Fi, cảnh báo EXPERIMENTAL/UNVERIFIED, whole-clause deny, typed setting không grant và UI AM/PM -> reference plan mới. C16 main controls bị hạn chế; C19 không engine selector/group START/legacy queue, sidebar Hàng đợi chỉ navigation.

### 25.2 FAIL và đề xuất riêng

| Ca | Thực tế / bằng chứng | Kết luận |
|---|---|---|
| C17 A/B | Chọn A khi A+B READY -> plan A -> A OFFLINE/B READY -> **selection thành B**. Execute stale plan disabled, Analyze enabled, không dispatch/analysis cho B. B-C17 screenshot và DOM, network seq1446 chỉ A | UI/source FAIL; `device-selection.ts:43-49` fallback READY, hook:50-53 áp selection. Đề xuất giữ/clear explicit selection khi unavailable; không sửa source lượt này |
| Nhãn C17 | Device mismatch vẫn ghi "Kế hoạch hết hạn; phân tích lại" | UI label P2 ở UnifiedAgentPanel.tsx:25,140-141; cần tách lý do invalid |
| C18 A/B | Delay8s/503/504 đúng, nhưng socket close trước headers dẫn **2 ANALYZE từ một click**, A1006/1007, B1837/1838. Retry B tới route thật/fake PREPARE | FAIL theo no-replay HTTP contract; chưa chứng minh app-source retry bug. Source api() một fetch; browser transport retry chỉ INFERRED. Harness one-shot fault được giữ nguyên, không chỉnh để ép PASS |
| C16 bổ sung | Main controls disabled, stale-plan reanalyze button còn enabled | Chưa click; request/dispatch hệ quả UNVERIFIED, không suy là có grant |

### 25.3 Counters, bảo toàn và mức sẵn sàng

**1972 API =1929 GET +43 POST**, browser1971/API-only1; A1100/B872. Production route functions530GET/19POST; fake worker28GET/13PREPARE, compileOutcomes thật13calls (coverage COMPLETE). 0 forwarded API tới Next, real worker, EXECUTE/START, ADB, Appium, model/Ollama/Groq, owner changes, grants và tripwire attempts. GET là polling, không tasks hoặc reasoning. B ANALYZE C01-C09 server spans118.99/8.50/11.67/9.19/31.21/14.93/26.25/22.07/11.72ms; clarification7.14ms và9.63ms riêng. Delay~8009ms có8000ms injection; không cộng spans và không gọi là Android/model latency.

309safe source/test/script +7config không drift; aggregate trước/sau **f251db7d343b3748570b00309dd72646ff19ac0be43ef9ead06f1d42aa873d2a**; hai excluded paths không đọc/hash. `demo-capabilities.md` nguyên. Append hai báo cáo, không sửa application source/test/config. `git diff --check` **exit0** (chỉ cảnh báo LF/CRLF có sẵn); scoped secret scan0 finding, prefix hai reports giữ nguyên, lưu `validation-result.json`. Không rerun regression/TS/lint/build: **1358/0/6, B5 68/68, TS/scoped lint PASS, full lint0errors4warnings, SecurityFatalError build exit1 vẫn là baseline lịch sử**.

Tab đóng, own harness shutdown graceful session60189 exit0. Fake tasks/owner modes0; global real-worker state UNVERIFIED vì không được query và không có real effect do harness. Không restart/force-kill user Next/worker; không đọc excluded material/env/keys.

**Đã chứng minh browser analysis/admission trong môi trường fake, chưa chứng minh Android hoặc AI tự chủ; chưa đủ điều kiện Android Acceptance.** Cần xử lý C17 và chẩn đoán no-replay C18 ở lượt riêng. Dừng sau C1-Final, không thêm features/Android/P2/Teach Mode/build work, không commit/push.

