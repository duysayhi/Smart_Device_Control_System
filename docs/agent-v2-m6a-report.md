# Phone Commander M6a: quyền có nhật ký và chụp ảnh trên Android thật

Ngày kiểm tra: 2026-10-21. Branch: `DuyTD`. Không commit/push. Giữ working tree có sẵn; không mở sealed, không chỉnh/chạy holdout, không đổi model hoặc cấu hình cloud, không bật Bluetooth và không chạy tác vụ ghi khác.

## 1. Kết luận và nhãn bằng chứng

| Phạm vi | Kết quả |
| --- | --- |
| OFFLINE_TESTED: baseline trước sửa behavior | **711/711 PASS**, 47 test files, ngoài sandbox, real Node child riêng cho từng file |
| OFFLINE_TESTED: regression cuối | **745/745 PASS**, 48 files: giữ 711 baseline và thêm 34 test M6a |
| REAL_ANDROID: một lần qua Dashboard-facing API | **PASS / COMPLETED**, Samsung A50s USB `R58MA78W6QK`, 2/2 outcomes verified |
| REAL_ANDROID: ảnh mới | MediaStore **590 → 591**, đúng một URI mới, kích thước **2.022.586 bytes**, `image/jpeg`, timestamp mới và owner package khớp camera được Android phân giải |
| REAL_ANDROID: cleanup | 0 active tasks, 0 owner modes; Session của execution trả `invalid session id` sau đóng; không còn device ownership |
| OFFLINE_TESTED: TypeScript / scoped ESLint / webpack build | PASS; full ESLint vẫn FAIL vì lỗi unrelated đã có, xem phần validation |
| UNVERIFIED: fallback phím Camera trên máy thật | Lượt thật dùng shutter bình thường, **0 retry**, không ép chụp thêm để thử fallback |
| UNVERIFIED: full-control record/calculator trên Android thật | Đã kiểm thử contract offline; không tạo note/tính toán/báo thức trên máy trong lượt này |

Quyền người dùng: cho phép **chụp đúng một ảnh thử**, giữ lại trên điện thoại, không xóa và không gửi ảnh lên AI. Một lần START được thực hiện; các probe trước START chỉ đọc và không được tính thành lần chụp. Sau khi được nhắc, người dùng đã cắm USB và mở khóa.

## 2. Baseline có thể tái lập

Task A được chạy trước mọi thay đổi behavior M6a. Real binary: `C:\nvm4w\nodejs\node.exe`. Mỗi file `tests/*.test.cjs` chạy trong child riêng, tuần tự; lưu nguyên stdout/stderr, child exit và nested TAP diagnostics. Không dựa vào exit của PowerShell.

Baseline hiện tại là 711, không phải 707: có thêm bốn test connection history từ công việc trước. Không sửa assertions cũ để làm green.

Evidence baseline:

`C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6a-baseline-1792586781100\summary.json`

Các file `.test.cjs.log` cùng thư mục chứa output đầy đủ.

| Bucket thất bại trong audit cũ | Số cũ | Task A ngoài sandbox | Phân loại bằng chứng hiện có |
| --- | ---: | --- | --- |
| Label cache | 8 | PASS | ENVIRONMENT đã có bằng chứng atomic TEMP rename EPERM; không bỏ atomic rename |
| Route hints | 1 | PASS | Không tái hiện; chưa có nested diagnostics cũ để khẳng định từng root cause |
| Worker security | 1 | PASS | Không tái hiện ngoài sandbox |
| Groq/router mock HTTP | 12 | PASS | Không gọi Groq thật; loopback HTTP mocks chạy được ngoài sandbox |
| Worker HTTP/lifecycle | 3 | PASS | Không tái hiện ngoài sandbox; lượt kiểm tra trong sandbox ở M6a vẫn gặp `fetch failed` |
| Wireless simulation | 1 | PASS | Không tái hiện ngoài sandbox; không thao tác wireless thật |

Không có SOURCE DEFECT được tái hiện trong baseline ngoài sandbox. Với 18 failure không thuộc cache, **không đủ evidence để gán chính xác từng failure lịch sử cho TEMP/loopback hay race**: lần cũ còn khác cách chạy đồng thời/tuần tự. Không gọi toàn bộ 26 là lỗi môi trường đã được chứng minh. Không chỉnh test để né môi trường.

Trong quá trình triển khai, một full run có **738/743 PASS, 5 FAIL**. Đó là regression thật do sửa M6a, đã sửa nguồn và giữ nguyên test cũ:

1. Hai test natural search: keyword đã fold `mùa` thành `mua`, gây hard deny nhầm. Kiểm tra hành động mua theo đầu clause/verb boundary; mua hàng vẫn bị chặn, query “hải lưu mùa xuân” giữ nguyên.
2. Hai test capture cũ: adapter fixture dùng metadata reader cũ không cung cấp complete summary. Giữ interface đọc cũ cho adapter cũ; **adapter Android thật luôn dùng reader complete mới**, full-control yêu cầu issued complete pre-state. Không nới verifier hoặc làm giả summary.
3. Một test discovery: bỏ mất kiểm tra unique enabled launcher. Đã khôi phục kiểm tra này, đồng thời giữ component của still-image intent để launch đúng action.

Evidence thất bại được giữ trong `phone-commander-m6a-validation-SthU4E\*.log`; run sau `phone-commander-m6a-validation-zOztk0\summary.json` đạt 743/743; final thêm hai test fallback đạt 745/745, không che lịch sử thất bại.

## 3. Permission: decision chung và các contract vẫn độc lập

`lib/android/agent/permission-decision.ts:27` trả `ALLOW | ASK | DENY` với typed reason. Không nhận quyền từ model/client JSON. Các entry dùng chung source hard-deny; semantics/technical contracts của từng engine vẫn là điều kiện bổ sung, không biến V1/AP thành V2.

### Helper và call sites

Các line dưới đây tham chiếu source sau sửa; đây là inventory về quyền và eligibility, không coi mọi helper là một user-confirmation prompt.

| Helper / trách nhiệm | Call sites / hành vi |
| --- | --- |
| `decidePermission` | `safety-envelope.ts:13`; `action-plan-authorization.ts:29`; `agent/device-runtime.ts:200`; `agent-v2.ts:151/:156`; `owner-test-policy.ts:32`; `local-effect-journal.ts:44/:95` |
| `assertSafeSource`, `assertSafePlan`, `assertSafeAction` | AP interpret `app/api/commands/interpret/route.ts:41`; AP issue/consume source-plan ticket; V1 `agent-loop.ts:43/:143`; V2 preflight; executor before dispatch. Mixed destructive source is refused before effect |
| `assessPlanPolicy`, `assertPlanPolicy`, `assertActionNotSensitive`, observed-control/read/route helpers | Legacy classifiers remain in `security-policy.ts`; AP strict wrapper maps into the shared decision; V1 `policyForAgentAction` retains action/goal/query and observed-control checks. Classifier results do not mint a grant |
| AP issue/consume authorization | `action-plan-authorization.ts:11/:20`: exact source, plan, physical device, 120-second single-use ticket; client cannot replace source/plan |
| Wi-Fi issue/consume confirmation | `wifi-confirmation.ts`; bounded exception in `app/api/executions/route.ts:76/:80`, UI confirmation in `useDashboardDemo`. Kept as before; owner/full-control do not bypass its technical contract |
| V1 human point | `human-assistance.ts` wait/submit; `agent-loop.ts:270` and `ConditionExecutor.confirmVisualTap`: original Session, fresh hierarchy/pixels/point policy. Not an effect permission escalation |
| Owner enable/bind/check/disable | `owner-test-policy.ts`: frozen backend-issued scope, exact device/physical/execution, revocation and 30-minute expiry. `device-runtime.ts` requires V2 opt-in and verified selected device |
| `ownerEffectAllowed` | Still callable for ordinary owner from `effect-grants.ts:45`; now delegates to shared decision. Under full-control, **without journal authorization it still returns false intentionally**. Runtime no longer treats that legacy helper as the route for journaled capture |
| V2 `help` | `agent-v2.ts:150`: shared EFFECT decision with the current node's issued journal authorization; one choice only for auto effect. Other technical assistance remains blocking |
| Read-only interpretation auto helper | `primitive-decomposition.ts:125`, called from V2 decomposition: existing issued known-app/quoted-slot opt-in preserved. Not general-purpose effect approval |
| New full-control auto review | `owner-test-policy.ts:48` reads server env when enabling mode; `agent-v2.ts:151` calls shared INTERPRETATION decision and durable journal before continuing |
| Intent source approval | `intent-capabilities.ts:75` / `assertIntentApproval`: source spans, exact binding, expiry, process ownership and implemented executor; invoked by V2 and `intent-executor.ts`. Not proof that a human has approved arbitrary model output |
| Effect grant issue/consume/revoke | `effect-grants.ts:33/:73`: typed values, issued candidate, Session, device, unchanged 5-second TTL, single use. Full-control LOCAL_WRITE requires an authentic local-effect ticket |
| Full-control setting contract | `full-control-policy.ts` and `setting-mutations.ts`: exact-source intent, independent state pairs, pre/post, durable journal and captured inverse. **Setting mutation/inverse code unchanged** |
| Local-effect journal and fallback permit | `local-effect-journal.ts`, `camera-fallback.ts`: source-exact new artifact/new record/calculation, write-ahead dispatch record, issued outcome proof, no replay and no auto deletion |
| Search / artifact subgrants | `generic-search.ts`, `artifact-store.ts`: issued query/phase/candidate and exact URI/consumer/device evidence; not a human approval shortcut |
| Transport/navigation eligibility | `navigation-semantics.ts`, `native-navigation.ts`, `wireless-store.ts`, `wireless-endpoint.ts`: remain independent technical guards |
| Cloud projection / external effects | `cloud-command.ts` opt-in remains separate from effect authority. `designatedRecipient` does not implement calls/SMS; unsupported external actions remain blocked |

### Matrix trước → sau

ALLOW means eligible **only after** readiness, grounding, Session/grant and verifier checks; never “click anything”. ASK does not imply the engine implements a missing capability.

| Path / operation | Normal | Ordinary owner | Full-control trước | Full-control sau |
| --- | --- | --- | --- | --- |
| AP proven navigation/read | ALLOW | unchanged | ALLOW, mode ignored | unchanged |
| AP unknown/sensitive, outside bounded Wi-Fi | strict DENY | unchanged | DENY | unchanged |
| AP bounded Wi-Fi | existing ASK/confirmation; development behavior unchanged | same | same | unchanged, no new setting test run |
| V1 safe supported goal | ALLOW / ASK for supported human point | mode ignored | mode ignored | unchanged |
| V1/AP photo creation contract | unsupported, no fake completion | unsupported | unsupported | unsupported; AP typed error points to Goal Agent |
| V2 one-photo capture | ASK effect | ALLOW allowed local effect | ASK then DENY LOCAL_WRITE | **ALLOW with CREATE_ARTIFACT journal** |
| V2 source-exact new record | ASK effect | ALLOW allowed local effect | ASK then DENY LOCAL_WRITE | **ALLOW with CREATE_RECORD journal**, persistence identity/readback still mandatory |
| V2 exact calculation | existing typed calculation contract | ALLOW | DENY LOCAL_WRITE | **ALLOW with EXACT_LOCAL_CALCULATION journal**, no overwrite of existing expression |
| V2 typed reversible setting | DENY without full scope | DENY | journaled ALLOW after review | unchanged setting/journal/inverse contract |
| V2 arbitrary UI LOCAL_WRITE / generic setting without journal | existing normal contract only | existing allowed scope only | DENY | **DENY**, not blanket authorization |
| Interpretation needing review | ASK | ASK | ASK | ASK by default; exact eligible plan can auto only with new opt-in |
| Ambiguous app/target/field, permission/consent, unlock | ASK or unsupported safe block | same | same | no manufactured permission/identity/target, no automatic consent |
| Delete/uninstall/reset/overwrite/security/purchase or mixed source | DENY | DENY | DENY | DENY before effects |

### Config chính xác

```dotenv
AGENT_V2_FULL_CONTROL_AUTO_REVIEW=true
```

Không tự thêm dòng này vào `.env.local`. Mặc định OFF. Sau khi người dùng tự bật, restart **idle** worker để nạp env; bật full-control cho đúng device để cấp scope mới. Flag chụp vào frozen scope tại enable, hết hiệu lực khi mode hết hạn/tắt; không nhận field `autoReview` từ request body. Không ảnh hưởng V1/AP hay ordinary owner.

Auto chỉ cho plan backend chứng minh source-exact bằng parser hiện có hoặc typed intent reconstruction, không negation/ambiguity, không hard deny và có contract đã đăng ký. Không coi source spans đơn thuần là đủ chứng minh model hiểu đúng. Model-only interpretation chưa chứng minh được vẫn ASK; không tự chọn app/giờ/giá trị thiếu. Interpretation vẫn emit và append `SOURCE_EXACT_AUTO_REVIEW` vào journal trước hiệu ứng. Lượt chụp thật không dùng flag này; là direct rules graph, trước đây cũng không cần interpretation prompt.

## 4. Target identity và failure classification

### Tái hiện trước sửa

Test fixture có cùng app, preview và shutter. Chỉ đổi text không liên quan của SurfaceView từ `frame 1` sang `frame 2`. Trước sửa, whole-hierarchy geometry fingerprint khác → lỗi chính xác **`V2 target changed before interaction; no action sent.`**, zero click. Sau sửa, cùng fixture gửi đúng một shutter click.

Evidence trước sửa: `phone-commander-m6a-target-repro-before.log` trong sandbox TEMP ban đầu; nội dung fail được ghi trong tool output. TEMP sandbox có thể tự hủy, không hứa đường dẫn đó tồn tại lâu dài. Test tái hiện được giữ trong `tests/agent-v2-m6a.test.cjs`.

Root cause được chứng minh là **so sánh toàn hierarchy cho dispatch**, không phải bitmap camera preview: fingerprint không đọc pixel ảnh. Không có cặp snapshot lịch sử của lỗi người dùng để khẳng định pixel animation là nguyên nhân duy nhất trên máy lúc đó.

`target-identity.ts:7` rebind theo device/package, class, resource-id, description, text/label/hint/roles, enabled/clickable, focus/checked/selected, unique match, không overlay/occlusion, bounds sai lệch tối đa **4 native pixels cho mỗi cạnh**. Tìm native element lại từ snapshot mới; không dùng tọa độ đoán hoặc giữ index cũ. Keypad/value/form/search guards vẫn độc lập.

Đây là logical accessibility identity; Android không cho chứng minh một widget instance không bị thay thế nếu nó được dựng lại với **toàn bộ** attributes/bounds giống hệt và không có stable instance ID. Không tuyên bố giải quyết giới hạn đó.

| Typed classification | Điều kiện | Hành vi |
| --- | --- | --- |
| HARD_DENY | Policy/grant/foreign scope/secret/unsupported contract | Không dispatch; không retry để né policy |
| SOFT_RETRYABLE_NOT_SENT | Authentic executor receipt cho TARGET_CHANGED, TARGET_LOCATE hoặc GRANT_EXPIRED, chưa RPC hiệu ứng | Tối đa 2 refresh trong budget có sẵn; observe → ground → new single-use grant; TTL vẫn 5 giây |
| UNKNOWN_EFFECT | Đã gửi RPC nhưng mất phản hồi, hoặc acknowledged rồi verifier/transition thất bại | Không replay; typed reason và reflection giữ trong terminal V2 payload |

Receipt dùng WeakMap, bound đúng issued grant/candidate và hết hạn sau 5 giây; clone/foreign/replay không được coi NOT_SENT. Retry không được làm mới TTL của grant cũ. Camera phải poll metadata trước khi có quyền gửi lần tiếp; unreadable hoặc thấy media mới thì dừng, không chụp tiếp.

Một regression mới còn phát hiện navigation visit counter đếm refresh NOT_SENT thành vòng lặp điều hướng. Chỉ lượt refresh có receipt thật được miễn ghi **navigation transition visit**; step/iteration/retry/time budget vẫn chạy. Tests xác nhận hết 2 retry thì dừng với zero click khi không locate được. Search giữ contract retry riêng đã có, không nâng ngân sách tìm kiếm.

Giới hạn: failures trước khi phát hành grant hoặc trong persisted form vẫn có các safe-block reasons riêng; không phải mọi exception legacy đã được chuyển thành typed reflection chung. Không rewrite toàn bộ failure architecture.

## 5. Camera contract

1. App category được Android `resolve-activity` cho `android.media.action.STILL_IMAGE_CAMERA`; reject resolver/chooser/ambiguity, vẫn xác minh unique enabled launcher. Runtime không chứa package Samsung hay selector/vendor workflow mới.
2. Launch component đã được backend khám phá bằng still-image action, không reset app. Explicit package requests vẫn theo existing verified-package path.
3. `MediaStoreReader.readCapture` đọc metadata global `_id:date_added`, count/max ID/max date và device clock; đọc recent metadata size/mime/owner; kiểm tra physical identity, incomplete/error và thay đổi giữa hai summary reads. Không đọc `_data`, mở file ảnh hoặc truyền bytes ảnh cho provider.
4. Full-control yêu cầu complete issued metadata pre-state rồi tạo journal. Candidate shutter phải có preview, unique observed capture role, native interactability và fresh target identity.
5. PREPARED trước grant; DISPATCH_ATTEMPT flushed trước RPC, ACKNOWLEDGED riêng; ambiguous/UNKNOWN không replay.
6. Chỉ sau authentic NOT_SENT mới cấp permit cho fixed backend **KEYCODE_CAMERA=27**. Permit không phải key tự do từ model; cùng owner/execution/Session/node, một lần, 5 giây; resolver và metadata được kiểm tra lại trước key. Grant mới vẫn cần candidate và journal riêng. Nếu grant/permit hết hạn trong bước kiểm tra thì block, không tăng TTL.
7. Success cần registered MediaStore delta đúng một ảnh mới, global count +1, max ID tăng, không mất ID cũ, thời gian mới, size >0, mime image và owner khớp. Delta 0, delta nhiều/removed, stale timestamp hoặc provenance/metadata lỗi giữ reason riêng, không thành completion.
8. Ảnh **LEFT_IN_PLACE**; không xóa ảnh để “undo”. Journal tạo mới ghi rõ giữ artifact, khác inverse restoration của setting. Không phát sinh quyền sửa/xóa dữ liệu cũ.

Legacy alias không hợp lệ trả `LEGACY_APP_DISCOVERY_REQUIRED` và hướng sang Goal Agent (`capabilities.ts`), không đoán package. Không thêm Camera alias trỏ Samsung.

OFFLINE_TESTED: preview động; moved/replaced/disabled/non-clickable/duplicate shutter và overlay; no shutter; ordinary/normal/full scope; clone/revoked/cross-device; VN có dấu/không dấu và “take a photo”; exact calculator/new-record ticket; delta 0/1/2/stale; NOT_SENT success/exhaustion; UNKNOWN không replay; fixed key đúng 27 và media đã thay đổi thì zero key.

## 6. Một controlled Android acceptance

Request: **“Mở Camera và chụp 1 tấm ảnh”**.

- Dashboard-facing transport: HTTP POST `/api/agent/runtime`, START `agentVersion:2`, `ownerAuthorizedTest:true`; owner/full-control enabled cho exact USB physical identity, tắt trong `finally`.
- Execution: `d8c27952-c85a-424e-b9e9-f710011444f1`.
- Session duy nhất thuộc execution: `8cd25103-4f01-493b-ad12-557a4a8e6c0e`.
- Frozen `lib/android/**/*.ts` digest **trước = sau = sau validation**: `d79551e71eebfaf4c24d79e7f214dc354fd01d248ccbcfde50fdd76fcbcabdb5`.
- Local configured model: `qwen2.5:3b-instruct`; structured provider local, cloud/command-text OFF. **0 model calls**: analysis source RULES, not LLM planning.
- Không EFFECT_CONFIRMATION lặp lại; không assistance khác, 0 retry/replan/scroll. Hai steps: launch và shutter, 9 snapshots.

### Metadata và false completion

| Evidence | Trước | Sau |
| --- | ---: | ---: |
| Global image count | 590 | 591 |
| max `_id` | 2260 | 2264 |
| max `date_added` | 1792546893 | 1792596213 |
| device clock ở inventory bên ngoài task | 1792596168 | 1792596223 |

Ảnh mới: `content://media/external/images/media/2264`, `20261021_222330.jpg`, `image/jpeg`, **2022586 bytes**, `date_added=1792596213`. Native readback owner là `com.sec.android.app.camera`: đây là **kết quả quan sát**, không package hardcode trong runtime. ID không bắt buộc liên tiếp; chỉ tăng và artifact URI khớp proof.

Screenshot cuối được kiểm tra bằng mắt: Camera ở chế độ **ẢNH**, shutter hiện, viewfinder tối. Screenshot **không tự chứng minh đã lưu ảnh**; kết luận dùng thêm độc lập MediaStore readback URI/count/time/size/owner, đối chiếu artifact registry và journal. Không mở/read bytes file JPEG mới. Screenshot UI không gửi vào Ollama/Groq. Native activity probe nhiều phút sau thấy Launcher, ghi nguyên trạng trong assessment; không suy đoán vì sao hoặc dùng trạng thái muộn đó thay snapshot xác minh trong execution.

**False completion: 0 / 1 claimed completion** trong đúng một task. Không phải tỷ lệ tổng quát cho mọi camera/app/device.

### Thời gian và RPC

| Span / counter | Giá trị |
| --- | ---: |
| Runner wall time, gồm API enable/START/poll/disable, chưa gồm post-inspection ngoài task | 50.953 s |
| Agent total | 45.509 s |
| Planning | 7.331 s |
| Session setup | 7.822 s |
| Observation | 12.857 s |
| Execution | 9.138 s |
| Assistance / inference | 0 / 0 s |
| Verification counter | 0.008 s |
| Appium RPC | 67, cumulative RPC service 16.914 s |
| ADB trong adapter task | 82, cumulative service 26.523 s |
| XML parse | 9, 0.307 s |

Không cộng các spans thành tổng: observation nằm trong execution; MediaStore/metadata polling được tính trong adapter ADB và ngoài counter verification CPU. RPC/ADB trong runner preflight, post-readback, screenshot API, warmup và polling transport không nằm trong 82/67; không gọi chúng là total hệ thống. Không đo inference throughput/RAM model từ task có zero inference.

### Journal excerpt

File host TEMP `phone-commander-local-effects\145e5abe-6409-4894-8555-b6dd3b7c56c6.jsonl`:

```text
1792596205349 PRE_STATE                count=590, maxId=2260, deviceTime=1792596201
1792596210259 PREPARED_SINGLE_USE      CREATE_ARTIFACT, dispatch=NOT_SENT
1792596211817 DISPATCH_ATTEMPT         dispatch=UNKNOWN
1792596211939 DISPATCH_ACKNOWLEDGED    dispatch=ACKNOWLEDGED
1792596220926 INDEPENDENT_OUTCOME_VERIFIED
              URI=content://media/external/images/media/2264
              disposition=LEFT_IN_PLACE
```

Sau completion: 0 active task / 0 owner mode, `readDeviceOwnership=false`, GET riêng Session đã đóng trả 404 `invalid session id`. Appium 3.8.0 bỏ `/sessions`; `/appium/sessions` cần insecure `session_discovery` đang tắt. **Không bật nó** để benchmark. Global inventory các external Appium clients là UNVERIFIED; runner kiểm tra project ownership và không có UiAutomator2 process trước START, giữ một owned Session, không tạo song song. Không tuyên bố kiểm soát client ngoài dự án.

Evidence thực tế:

`C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6a-camera-XtoYEu\acceptance.json`

Cùng thư mục: `assessment.json`, `after.jpg`. Ảnh mới vẫn chỉ nằm trên điện thoại; không đặt ảnh/log/cache vào repo.

## 7. Validation cuối

| Check | Kết quả |
| --- | --- |
| Full regression | **745/745 PASS**, exit 0; 48 child processes, 0 skipped/cancelled; final run 2026-10-21T15:36:12.879Z → 15:38:13.692Z |
| TypeScript `--noEmit --incremental false` | PASS, actual child exit 0, 17.917 s |
| Scoped ESLint | PASS, 0 errors/warnings, 8.075 s; final scan gồm runtime và scripts/tests M6a |
| Full ESLint | FAIL exit 1, 50.442 s: lỗi cũ `components/executions/ExecutionDetailModal.tsx:130:98` `no-explicit-any`, 9 unused warnings. Không sửa unrelated file |
| `next build --webpack` | **PASS**, actual child exit 0, 173.102 s |
| Build warning | Hai `module.createRequire failed parsing argument` tại dynamic Appium dependency resolution; không sửa unrelated bundler/config; không coi warning là runtime deployment acceptance |
| `git diff --check` | PASS exit 0; chỉ Git LF/CRLF warnings, không whitespace error. Scoped untracked whitespace được kiểm tra riêng |
| Secret scan | PASS: 977 files, 0 matches, 0 oversized files; source/build và evidence M6a, exclude env/dependencies/.git/sealed/holdout/binary images/unrelated TEMP; không in keys. Byte count chính xác nằm trong final audit JSON vì report tiếp tục được bổ sung |

Regression final logs:

`C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6a-validation-eMGQYw\summary.json`

Build logs:

`C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6a-build-BdHsXV\build.log`

Một số static validation log ban đầu nằm trong sandbox TEMP tự hủy: không dùng các đường dẫn đó làm retained evidence cuối. Host-TEMP validation cuối và final audit artifact được lập để giữ chẩn đoán bền vững. Validation Android đã kết thúc trước build; không chạy tác vụ mới để đổi kết quả cũ.

Host-TEMP static logs cuối: `C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6a-final-checks-CbTWdo\summary.json`, cùng `typecheck.log`, `scoped-eslint.log`, `full-eslint.log`.

Final audit: `C:\Users\TRANDU~1\AppData\Local\Temp\phone-commander-m6a-final-audit.json`: digest vẫn khớp acceptance, 0 active tasks / 0 owner modes, secret scan và diff check nêu trên. Scanner không thể kiểm toán toàn bộ lịch sử tool transcript; không coi 0 match là chứng minh không còn bất kỳ loại secret nào.

Một lần final API check timeout 30 giây sau validation. Kiểm tra trực tiếp worker sau đó: `/health` và `/tasks` HTTP 200, queue 0 running/0 waiting, 0 active tasks/owner modes; Dashboard `/` HTTP 200. Chạy final audit lại thành công, runtime API trả lại dữ liệu. **UNVERIFIED root cause** của timeout đơn lẻ; không suy ra Appium/capture failure hay tự restart server/Session. Không loại bỏ lần timeout khỏi lịch sử.

Scoped whitespace scan: 27 file M6a (gồm source/test/runner/report), **0 trailing-whitespace finding**; không dựa riêng `git diff --check` vì nhiều file còn untracked. Script final-audit mới cũng qua ESLint riêng. Không giảm validators hay sửa unrelated lint để lấy green.

### File thuộc thay đổi M6a

- Policy/journal: `lib/android/agent/permission-decision.ts`, `local-effect-journal.ts` (mới); `owner-test-policy.ts`, `effect-grants.ts`, `full-control-policy.ts`, `device-runtime.ts` trong cùng thư mục; `lib/android/safety-envelope.ts`, `action-plan-authorization.ts`.
- Identity/dispatch: `lib/android/agent/target-identity.ts`, `camera-fallback.ts` (mới), `grounded-candidates-v2.ts`, `ui-affordances.ts`; `lib/android/grounded-interactions.ts`, `condition-executor.ts`.
- Contract/runtime: `lib/android/agent/agent-v2.ts`, `goal-graph.ts`, `media-evidence.ts`, `persisted-record.ts`, `outcome-spec.ts`, `application-discovery.ts`, `app-catalog.ts`; `lib/android/capabilities.ts`.
- Tests/runner/report: `tests/agent-v2-m6a.test.cjs`; `scripts/agent-v2-m6a-validation.cjs`, `agent-v2-m6a-acceptance.cjs`, `agent-v2-m6a-final-audit.cjs`; tài liệu này. Không chỉnh test cũ/fixtures/holdout hoặc setting-mutations/inverse implementation.

Các thay đổi có sẵn ở Dashboard, README, worker/security/connection history và những file untracked từ các lượt trước được giữ nguyên, không được ghi nhận thành feature M6a mới. Không có commit/push.

## 8. Giới hạn và những gì không triển khai

- REAL_ANDROID chỉ một Samsung A50s, một ảnh, một direct rules goal. Không chứng nhận AI tự khám phá Camera mới, universal planning, multi-device throughput hoặc ứng dụng bất kỳ.
- OFFLINE_TESTED: journal tạo record/calculator, auto-review flag, camera-key fallback. Chưa real acceptance những nhánh này; không cần/không được chụp ảnh thứ hai trong scope đã cấp.
- Auto-review là conservative, source-exact backend opt-in, không phải bỏ mọi review. Unsupported semantics vẫn block; ambiguity/permission/technical assistance không được biến thành ALLOW.
- Các engine vẫn có classifier/verifier riêng sau source gate chung. Không hợp nhất Action Plan/V1/V2 hoặc thay compatibility semantics. Không mọi exception legacy/form đã có typed receipt chung.
- Record persistence vẫn cần unique new draft/persisted identity và exact reopen/readback; app không expose đủ evidence vẫn SAFE_BLOCKED. Không dùng title trùng hoặc newest item để thay proof.
- Vẫn chặn arbitrary UI writes không có journal, video/multiple-photo capture, unsupported timer/alarm extension và missing media-provider contract. Không cài/gỡ APK hay bật accessibility.
- Metadata count/ID/time/owner không chứng minh nội dung/chất lượng bức ảnh, cũng không tự chứng minh causal attribution nếu có bên ngoài đồng thời tạo ảnh. Lượt này yêu cầu người dùng không thao tác, không có competing project task; không stress-test external writers/providers.
- Không tạo undo bằng cách xóa artifact. Ảnh thử **LEFT_IN_PLACE**. Setting inverse/journal giữ nguyên và không được chạy lại.
- Calls/SMS/purchases/consent không được thử; designated-recipient helper không tạo ra executor còn thiếu. Không nới hard-block list để làm demo qua.

### Điều này chứng minh và không chứng minh

Hệ thống đã thực sự nhận một lệnh qua API của Dashboard, mở Camera do Android phân giải, chụp đúng một ảnh, xác minh artifact bằng nguồn metadata độc lập, rồi giải phóng Session/quyền. Full-control không còn tự chặn capability chụp ảnh chỉ vì dùng nhánh LOCAL_WRITE cũ.

Điều đó **không chứng minh AI tự nghĩ ra thao tác mới**: task này được parser/rules và capability đã lập trình thực hiện, không gọi model. Unit PASS bảo vệ contracts, không thay Android acceptance. Không đổi các BLOCKED/FAILED cũ thành SUCCESS. Không commit/push; dừng sau M6a.
