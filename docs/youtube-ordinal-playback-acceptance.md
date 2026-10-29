# YouTube ordinal/playback — nghiệm thu và độ tin cậy

Bắt đầu 28/10/2026, cập nhật 29/10/2026. Branch DuyTD, HEAD 01525d92412eb1779855beec0e359037a79873d0.

**Chưa đạt nghiệm thu tổng thể; không READY.** 28 lần thử: 21 BLOCKED; 1 INVALID; 3 PREFLIGHT_OR_ANALYZE_BLOCKED; 2 COMPLETED; 1 CANCELLED. Có 2 claimed completion; chỉ các dòng có registered proof và đối chiếu độc lập bên dưới được gọi REAL_ANDROID_VERIFIED. Không loại lịch sử BLOCKED để tạo tỷ lệ 3/3. Báo cáo mốc cũ được giữ tại coverage/youtube-playback-acceptance-KZunA6/report-before-resume.md.

## 1. Phạm vi và provenance

- Unified HTTP API → worker thật → Android/Appium thật → V2. Không fallback V1/Action Plan. Browser IAB đã được thử nhưng chưa chứng minh tương tác Dashboard; **không có browser acceptance PASS**.
- Cùng Samsung SM-A507FN, hardware serial R58MA78W6QK. Physical identity android:6969fbb5174360a83525adac4613e7a681048071f9d32a2355c7b0600a7d757c. Hai transport Wi-Fi lịch sử 192.168.1.43:43933 và :45289; cuối lượt USB R58MA78W6QK. Mỗi lần đổi transport đều đối chiếu cùng physical identity, không tự chuyển sang máy khác.
- Owner/full-control giữ TẮT. Chỉ search/navigation/selection/play được chủ thiết bị cho phép. Không thay setting, consent/account, không cài/gỡ/xóa/clear data. Không gửi ảnh lên model/cloud.
- Worker chỉ thay khi idle qua POST /shutdown **body rỗng**, không force kill. Một lần GET preflight timeout được kiểm tra lại: worker còn sống, 0 task/mode, rồi mới gửi shutdown có thời hạn dài hơn. Đây là sự cố tooling, không tính thành task Android.
- Runtime cuối b0282366a25a7d5d6d6a303942f6f0dc3dd2d6a31b2f9be9a5f20b33cebb0870; worker khớp source: true. Mỗi attempt lưu hash trước/sau; các revision cũ được báo riêng trong JSON, không gộp thành repeatability của revision cuối.
- Toàn bộ câu chuẩn dùng RULES + grounded singleton + registered verifier. Tổng model calls ghi nhận: 0. Không có provider gọi thành công trong tập này; kết quả không chứng minh LLM tự suy luận workflow mới.

## 2. Chẩn đoán và thay đổi

| Thành phần | Trước sửa / evidence | Thay đổi, mức chứng minh |
|---|---|---|
| Channel/card identity | BASELINE-N1-native-readback.json: navigation channel và verified badge cùng OpenAI bị coi mâu thuẫn | Đồng thuận nhãn mới được gộp; nhãn khác nhau vẫn ambiguous. OFFLINE_TESTED + N1 có bằng chứng thật |
| Native player | CHANNEL-FIX-N1-player-readback.json: player lồng, thiếu title accessibility, có channel/SeekBar | Collapse player lồng; UI title/channel hoặc composite channel/duration/progress + MediaSession title/channel/advance độc lập |
| Loading wrapper | BINDING-DIAG-N1-READY-after-nodes.json | Không coi video_info_loading_layout có nội dung là spinner; actual ProgressBar vẫn chặn |
| Numeric title | Offline reproduction trong test mới | Duration chỉ nhận toàn trường; không nuốt prefix title số |
| Identity warmup | identity-abort-before.json / identity-abort-after.json | Abort không tạo negative cache hoặc giữ positive stale; lần sau bắt buộc fresh identity read. Không bỏ admission guard |
| Search từ player | STABLE-N2-A.json: REVEAL → Thu nhỏ ACK, cuối vẫn player | Sửa postcondition quá rộng: pause/buffering/fullscreen change không phải navigation. 7 test mới; reset-before-targeted.log 3 FAIL tái hiện, reset-after-targeted.log 110 PASS. **Chưa chứng minh đây là nguyên nhân duy nhất của native minimize không tác dụng** |
| XML/native label | NATIVE-LOCATE-N2-USB.json: selector chứa &#127911;, native lookup 0 | targets.ts bật numeric entity decoding của parser hiện có. ENTITY-READBACK-USB-AFTER-READY.json: exact emoji label native khớp, selector có đúng 1 match. Không fallback chọn phần tử đầu từ structural matches |
| XML regression | entity-before-targeted.log: 2/4 FAIL trước sửa | Decimal/hex supplementary Unicode, XML named entities, và escaped literal không bị double-decode. entity-after-targeted.log 200/200 PASS gồm consumers parser |
| Ad/ended overlay | RESUME-APP-QUALIFIED-N2.json, SKIP-FIX-N1-A-after-nodes.json | Chỉ exact native Skip descriptor, hoặc Cancel có end-card + ended clock + Play-now companion scoped. Mỗi scope một lần; không CTA/Play-now tùy ý. OFFLINE_TESTED; xem bảng real cho mức thực tế |
| NOT_SENT selection | ENDED-FIX-N1-A.json native locate chưa gửi click | Chỉ authentic consumed NOT_SENT receipt được fresh-reground một lần, cùng scope/query/ordinal/Session và grant mới, tiêu budget. UNKNOWN/ACK không replay |
| API/source divergence | VARIANT-OPEN-FIRST.json dùng catalog cũ; RESUME-OPEN-FIRST.json sau user restart | Sau restart API nhận đúng V2 graph. Không quy lỗi framework: có concurrent startup-script change, thiếu đối chứng nguyên nhân |
| Scroll/discovery | DISCOVERY-N3-PROBE.json và nhiều end-of-list BLOCKED | Budget discovery hữu hạn 60s thay fixed30s; vẫn cần origin/overlap/identity. Không coi canScrollMore=false là bằng chứng N không tồn tại trong mọi UI |

Source thay hash so với preflight: `lib/android/agent/video-result-contract.ts`, `lib/android/agent/video-result.ts`, `lib/android/agent/agent-v2.ts`, `lib/android/agent/device-runtime.ts`, `lib/android/agent/effect-grants.ts`, `lib/android/agent/evidence-predicates.ts`, `lib/android/agent/generic-search.ts`, `lib/android/agent/goal-compiler.ts`, `lib/android/agent/goal-graph.ts`, `lib/android/agent/grounded-candidates-v2.ts`, `lib/android/agent/outcome-spec.ts`, `lib/android/agent/search-executor.ts`, `lib/android/exploration/element-memory.ts`, `lib/android/grounded-interactions.ts`, `lib/android/targets.ts`, `lib/android/transport-identity.ts`. Thêm youtube-state.ts, video-metadata.ts và tests/youtube-reliability.test.cjs. Phân loại trách nhiệm: element-memory/metadata = identity; generic-search/youtube-state/search-executor = normalization/search; video-result/grounded-candidates/effect-grants/grounded-interactions = typed primitive; agent-v2 = tích hợp vào loop cũ; graph/compiler/evidence = giữ outcome/proof; transport-identity = cache abort; targets = XML labels; device-runtime = diagnostic admission. Không thêm engine hoặc pipeline.

Parser dùng option htmlEntities của fast-xml-parser **đang cài**, không nâng dependency. Option có deprecation trong typings hiện tại; không thêm custom decoder/dependency hoặc thay entity security defaults trong lượt này. Bốn test bảo vệ one-pass label semantics. Consumers trực tiếp đã đọc: StateObserver và Android executor; targeted bao gồm android-executor, state-observer, general-agent-v2-persisted, general-agent-v2-m3d. Integration thật không được giả lập thành bằng chứng thiết bị.

## 3. Contract và an toàn

1. Exact query, physical device, execution, owned Session, search commit, current result surface và freshness gắn scope. Origin/overlap bắt buộc; không đếm ads/Shorts/channel/playlist/current live/duplicate như video thường.
2. Chọn đúng N trong memory liên tục, revalidate native trước dispatch. Không chọn N khác hoặc fallback item đầu khi thiếu bằng chứng.
3. UI_TITLE_CHANNEL hoặc UI_CHANNEL_DURATION_PROGRESS. Composite chỉ khi unique native player/metadata, channel subscriber khớp, SeekBar duration sai số ≤1s, UI clock tăng, MediaSession exact title/channel PLAYING tăng qua hai fresh reads và đồng bộ UI/media ≤3s. Không coi receipt clone là proof.
4. PAUSED/buffering/ad không COMPLETED. Play admission cần identity độc lập; Play/Skip/Cancel không được lặp khi outcome UNKNOWN. ACK chưa có postcondition vẫn BLOCKED.
5. Mini X bị che không được click. Search chỉ được dùng exclusive native point đã có primitive/independent rect; không tọa độ cố định hoặc bỏ occlusion. Không thêm state-only BACK/HOME.
6. Minimize cần Search affordance hoặc mini thật. Chỉ explicit Exit fullscreen mới được kết thúc ở normal player, có geometry loại fullscreen còn sót. Không coi pause là exit.
7. Source grammar bảo toàn span/query: ba clause tạo bốn node; app-qualified hai clause tạo SEARCH/SELECT/VERIFY. “mở video đầu tiên” nghĩa playback; “mở video thứ hai” không được âm thầm mở rộng. Ordinal >3 không hỗ trợ.
8. Budget: discovery60s (bounded1–90s), video wait45s/12 observations/poll500ms; outer goal240s, search/video scope120s, native freshness5s. Không tăng vô hạn hay bỏ cancellation/ownership/journal/anti-replay.

## 4. Kết quả thực tế

26 positive attempts không gồm INVALID/cancel: 21 BLOCKED; 3 PREFLIGHT_OR_ANALYZE_BLOCKED; 2 COMPLETED. Trong đó 20 đã tới worker thật: 18 BLOCKED; 2 COMPLETED. Các lỗi trước START giữ trong bảng, không được tính là native click thất bại. Diagnostic read/scroll không phải completion.

| Ordinal | Positive attempts | Số lượng theo verdict | Đã START worker |
|---|---:|---|---:|
| 1 | 12 | 9 BLOCKED; 2 COMPLETED; 1 PREFLIGHT_OR_ANALYZE_BLOCKED | 9 |
| 2 | 12 | 2 PREFLIGHT_OR_ANALYZE_BLOCKED; 10 BLOCKED | 9 |
| 3 | 2 | 2 BLOCKED | 2 |

Mục tiêu 3/3 độc lập cho N1/N2/N3 **chưa được chứng minh**; không bỏ failure cũ. Mẫu nhỏ, một thiết bị, nhiều source revision. 2/2 claimed completions có MediaSession audit độc lập khớp identity và tăng tiến; screenshot từng claimed completion phải được đọc thủ công, không chỉ dựa vào script.

| Claimed completion | Target | Tier native | Registered progress | Audit độc lập | Ảnh đã đối chiếu |
|---|---|---|---|---|---|
| [FINAL-N1-A](../coverage/youtube-playback-acceptance-KZunA6/FINAL-N1-A.json) | OpenAI DevDay 2026 Keynote (FULL) / OpenAI | UI_CHANNEL_DURATION_PROGRESS | 1397600 → 1399750 ms | Khớp title/channel; clock tăng | [screenshot](../coverage/youtube-playback-acceptance-KZunA6/FINAL-N1-A-after.png) |
| [NOT-SENT-FIX-N1-A](../coverage/youtube-playback-acceptance-KZunA6/NOT-SENT-FIX-N1-A.json) | OpenAI DevDay 2026 Keynote (FULL) / OpenAI | UI_CHANNEL_DURATION_PROGRESS | 2263858 → 2265698 ms | Khớp title/channel; clock tăng | [screenshot](../coverage/youtube-playback-acceptance-KZunA6/NOT-SENT-FIX-N1-A-after.png) |

False-completion: **0/2 claimed completions**, sau đối chiếu screenshot và independent MediaSession/clock; không suy từ test mock. Hai completion lịch sử FINAL-N1-A và NOT-SENT-FIX-N1-A đã được đọc ảnh thủ công, khớp OpenAI title/channel. Không có bằng chứng chọn video khác để thay target; các ca chưa đủ identity giữ BLOCKED. Real cancellation USB-CANCEL-SEARCH: CANCELLED, 0 task/mode/ownership sau cleanup; không cộng vào positive playback success. Assistance resume cùng Session qua Dashboard vẫn UNVERIFIED; không tự confirm token để tạo PASS.

### Toàn bộ attempt, không lọc thất bại

A/E/V là analyze HTTP / engine total / verification span, đơn vị giây. Engine total đã bao hàm nhiều span; **không cộng các span chồng nhau**. Execute HTTP chỉ admission, không phải thời gian hoàn thành; giá trị riêng nằm trong JSON. RPC/ADB là Appium / ADB execution; analyze và audit được ghi riêng. “—” là không đo được, không phải 0. Đo trên máy phát triển, không phải benchmark hiệu năng cô lập.

| Evidence | Request | State ban đầu | N | Engine plan | Verdict | A/E/V s | RPC/ADB | Model calls | Lý do |
|---|---|---|---:|---|---|---|---|---:|---|
| [BASELINE-N1](../coverage/youtube-playback-acceptance-KZunA6/BASELINE-N1.json) | Mở YouTube, tìm OpenAI và phát video đầu tiên | APP_NOT_OPEN | 1 | V2 | BLOCKED | 40.99 / 59.97 / 0.21 | 148 / 94 (+21 analyze, 13 audit) | 0 | VIDEO_CHANNEL_IDENTITY_AMBIGUOUS |
| [CHANNEL-FIX-N1](../coverage/youtube-playback-acceptance-KZunA6/CHANNEL-FIX-N1.json) | Mở YouTube, tìm OpenAI và phát video đầu tiên | SEARCH_RESULTS | 1 | V2 | BLOCKED | 19.08 / 58.95 / 0.35 | 172 / 103 (+15 analyze, 19 audit) | 0 | VIDEO_DESTINATION_UNVERIFIED_NO_REPLAY |
| [CORE1-A](../coverage/youtube-playback-acceptance-KZunA6/CORE1-A.json) | Mở YouTube, tìm OpenAI và phát video đầu tiên | APP_NOT_OPEN | 1 | V2 | BLOCKED | 37.41 / 69.26 / 0.33 | 145 / 93 (+18 analyze, 13 audit) | 0 | End of list reached without the requested ordinal. |
| [MINI-FIX-N1](../coverage/youtube-playback-acceptance-KZunA6/MINI-FIX-N1.json) | Mở YouTube, tìm OpenAI và phát video đầu tiên | APP_NOT_OPEN | 1 | V2 | BLOCKED | 34.47 / — / — | — / — (+18 analyze, 7 audit) | 0 | Plan device, permission, expiry or replay binding changed. |
| [MINI-FIX-N1-B](../coverage/youtube-playback-acceptance-KZunA6/MINI-FIX-N1-B.json) | Mở YouTube, tìm OpenAI và phát video đầu tiên | APP_NOT_OPEN | 1 | V2 | BLOCKED | 3.73 / — / — | — / — (+13 analyze, 6 audit) | 0 | Plan device, permission, expiry or replay binding changed. |
| [BINDING-DIAG-N1](../coverage/youtube-playback-acceptance-KZunA6/BINDING-DIAG-N1.json) | Mở YouTube, tìm OpenAI và phát video đầu tiên | UNVERIFIED | 1 | — | INVALID | — / — / — | — / — (+— analyze, 3 audit) | 0 | INVALID_DEVICE_LOCKED |
| [BINDING-DIAG-N1-READY](../coverage/youtube-playback-acceptance-KZunA6/BINDING-DIAG-N1-READY.json) | Mở YouTube, tìm OpenAI và phát video đầu tiên | APP_NOT_OPEN | 1 | V2 | BLOCKED | 5.43 / 114.08 / 0.22 | 257 / 153 (+13 analyze, 13 audit) | 0 | VIDEO_DESTINATION_UNVERIFIED_NO_REPLAY: PLAYBACK_IDENTITY_UNVERIFIED |
| [CORE2-A](../coverage/youtube-playback-acceptance-KZunA6/CORE2-A.json) | Mở YouTube, tìm podcast tiếng Anh và phát video thứ 2 | UNVERIFIED | 2 | — | PREFLIGHT_OR_ANALYZE_BLOCKED | — / — / — | — / — (+— analyze, 14 audit) | 0 | fetch failed |
| [CORE2-B](../coverage/youtube-playback-acceptance-KZunA6/CORE2-B.json) | Mở YouTube, tìm podcast tiếng Anh và phát video thứ 2 | VIDEO_PLAYER_PAUSED | 2 | V2 | BLOCKED | 4.46 / 76.29 / 0.25 | 176 / 106 (+13 analyze, 19 audit) | 0 | End of list reached without the requested ordinal. |
| [RECOVERY-N2](../coverage/youtube-playback-acceptance-KZunA6/RECOVERY-N2.json) | Mở YouTube, tìm podcast tiếng Anh và phát video thứ 2 | UNVERIFIED | 2 | — | PREFLIGHT_OR_ANALYZE_BLOCKED | — / — / — | — / — (+— analyze, 14 audit) | 0 | fetch failed |
| [RECOVERY-N2-B](../coverage/youtube-playback-acceptance-KZunA6/RECOVERY-N2-B.json) | Mở YouTube, tìm podcast tiếng Anh và phát video thứ 2 | SEARCH_RESULTS | 2 | V2 | BLOCKED | 3.83 / 26.59 / 0.00 | 49 / 48 (+13 analyze, 19 audit) | 0 | SEARCH_NOT_SENT_TARGET_LOCATE: no replay. V2 native target cannot be uniquely grounded. |
| [CLEAR-VIEW-N2](../coverage/youtube-playback-acceptance-KZunA6/CLEAR-VIEW-N2.json) | Mở YouTube, tìm podcast tiếng Anh và phát video thứ 2 | SEARCH_RESULTS | 2 | V2 | BLOCKED | 3.89 / 23.49 / 0.00 | 49 / 48 (+13 analyze, 19 audit) | 0 | SEARCH_NOT_SENT_TARGET_LOCATE: no replay. V2 native target cannot be uniquely grounded. |
| [OCCLUSION-N3](../coverage/youtube-playback-acceptance-KZunA6/OCCLUSION-N3.json) | Mở YouTube, tìm nhạc piano và phát video thứ 3 | SEARCH_RESULTS | 3 | V2 | BLOCKED | 21.01 / 74.96 / 0.27 | 186 / 100 (+15 analyze, 19 audit) | 0 | Result lacks enough stable identity evidence. |
| [FINAL-N1-A](../coverage/youtube-playback-acceptance-KZunA6/FINAL-N1-A.json) | Mở YouTube, tìm OpenAI và phát video đầu tiên | SEARCH_RESULTS | 1 | V2 | COMPLETED | 35.93 / 71.92 / 4.45 | 190 / 118 (+18 analyze, 19 audit) | 0 | All requested outcomes have registered device-bound verification evidence. |
| [FINAL-N2-A](../coverage/youtube-playback-acceptance-KZunA6/FINAL-N2-A.json) | Mở YouTube, tìm podcast tiếng Anh và phát video thứ 2 | UNVERIFIED | 2 | V2 | BLOCKED | 4.58 / 23.47 / 0.00 | 48 / 42 (+13 analyze, 19 audit) | 0 | SEARCH_AFFORDANCE_UNAVAILABLE_OR_AMBIGUOUS: no search control was guessed. |
| [FINAL-N2-B](../coverage/youtube-playback-acceptance-KZunA6/FINAL-N2-B.json) | Mở YouTube, tìm podcast tiếng Anh và phát video thứ 2 | VIDEO_PLAYER_PAUSED | 2 | V2 | BLOCKED | 19.90 / — / — | — / — (+15 analyze, 19 audit) | 0 | Plan device, permission, expiry or replay binding changed. VERIFIED_DEVICE_UNAVAILABLE |
| [FINAL-N2-C](../coverage/youtube-playback-acceptance-KZunA6/FINAL-N2-C.json) | Mở YouTube, tìm podcast tiếng Anh và phát video thứ 2 | VIDEO_PLAYER_PAUSED | 2 | V2 | BLOCKED | 19.39 / 60.99 / 0.24 | 151 / 91 (+15 analyze, 19 audit) | 0 | End of list reached without the requested ordinal. |
| [FINAL-N3-A](../coverage/youtube-playback-acceptance-KZunA6/FINAL-N3-A.json) | Mở YouTube, tìm nhạc piano và phát video thứ 3 | SEARCH_RESULTS | 3 | V2 | BLOCKED | 4.08 / 51.17 / 0.22 | 132 / 82 (+13 analyze, 19 audit) | 0 | End of list reached without the requested ordinal. |
| [VARIANT-OPEN-FIRST](../coverage/youtube-playback-acceptance-KZunA6/VARIANT-OPEN-FIRST.json) | Mở YouTube, tìm hải dương học và mở video đầu tiên | SEARCH_RESULTS | 1 | — | PREFLIGHT_OR_ANALYZE_BLOCKED | — / — / — | — / — (+— analyze, 19 audit) | 0 | {"httpStatus":409,"error":"CAPABILITY_DISABLED: Chưa hỗ trợ trong danh mục demo. Chua ho tro trong danh muc demo: YouTube chon video thu N (P2 chua port)"} |
| [RESUME-OPEN-FIRST](../coverage/youtube-playback-acceptance-KZunA6/RESUME-OPEN-FIRST.json) | Mở YouTube, tìm hải dương học và mở video đầu tiên | APP_NOT_OPEN | 1 | V2 | BLOCKED | 34.40 / 90.44 / 0.18 | 233 / 150 (+18 analyze, 13 audit) | 0 | VIDEO_DESTINATION_UNVERIFIED_NO_REPLAY: AD_PLAYING |
| [RESUME-APP-QUALIFIED-N2](../coverage/youtube-playback-acceptance-KZunA6/RESUME-APP-QUALIFIED-N2.json) | Tìm nhạc không lời trên YouTube và phát video thứ hai | UNVERIFIED | 2 | V2 | BLOCKED | 53.18 / 15.93 / 0.00 | 17 / 26 (+17 analyze, 19 audit) | 0 | SEARCH_AFFORDANCE_UNAVAILABLE_OR_AMBIGUOUS: no search control was guessed. |
| [SKIP-FIX-N1-A](../coverage/youtube-playback-acceptance-KZunA6/SKIP-FIX-N1-A.json) | Mở YouTube, tìm OpenAI và phát video đầu tiên | VIDEO_PLAYER | 1 | V2 | BLOCKED | 26.99 / 17.88 / 0.00 | 23 / 30 (+18 analyze, 19 audit) | 0 | SEARCH_AFFORDANCE_UNAVAILABLE_OR_AMBIGUOUS: no search control was guessed. |
| [ENDED-FIX-N1-A](../coverage/youtube-playback-acceptance-KZunA6/ENDED-FIX-N1-A.json) | Mở YouTube, tìm OpenAI và phát video đầu tiên | APP_NOT_OPEN | 1 | V2 | BLOCKED | 52.84 / 56.72 / 0.18 | 149 / 96 (+20 analyze, 13 audit) | 0 | VIDEO_CLICK_UNVERIFIED_NO_REPLAY: V2 native target cannot be uniquely grounded. |
| [NOT-SENT-FIX-N1-A](../coverage/youtube-playback-acceptance-KZunA6/NOT-SENT-FIX-N1-A.json) | Mở YouTube, tìm OpenAI và phát video đầu tiên | SEARCH_RESULTS | 1 | V2 | COMPLETED | 36.01 / 59.92 / 3.64 | 178 / 111 (+18 analyze, 20 audit) | 0 | All requested outcomes have registered device-bound verification evidence. |
| [STABLE-N2-A](../coverage/youtube-playback-acceptance-KZunA6/STABLE-N2-A.json) | Mở YouTube, tìm podcast tiếng Anh và phát video thứ 2 | UNVERIFIED | 2 | V2 | BLOCKED | 4.36 / 21.77 / 0.00 | 55 / 48 (+13 analyze, 19 audit) | 0 | SEARCH_AFFORDANCE_UNAVAILABLE_OR_AMBIGUOUS: no search control was guessed. |
| [USB-CANCEL-SEARCH](../coverage/youtube-playback-acceptance-KZunA6/USB-CANCEL-SEARCH.json) | Mở YouTube, tìm podcast tiếng Anh và phát video thứ 2 | APP_NOT_OPEN | 2 | V2 | CANCELLED | 5.09 / 23.51 / 0.01 | 32 / 39 (+13 analyze, 13 audit) | 0 | Execution cancelled. |
| [USB-N2-HOME](../coverage/youtube-playback-acceptance-KZunA6/USB-N2-HOME.json) | Mở YouTube, tìm podcast tiếng Anh và phát video thứ 2 | YOUTUBE_HOME | 2 | V2 | BLOCKED | 4.00 / 62.00 / 0.26 | 139 / 79 (+13 analyze, 19 audit) | 0 | Remembered item failed fresh native validation. |
| [USB-ENTITY-FIX-N2](../coverage/youtube-playback-acceptance-KZunA6/USB-ENTITY-FIX-N2.json) | Mở YouTube, tìm podcast tiếng Anh và phát video thứ 2 | YOUTUBE_HOME | 2 | V2 | BLOCKED | 34.88 / 29.62 / 0.00 | 78 / 59 (+18 analyze, 20 audit) | 0 | SEARCH_ACKNOWLEDGED_TRANSITION_UNVERIFIED: no replay. Timed out waiting for V2 grounded effect verified after 10031ms. |

Router-vs-engine: plan có engine V2, worker progress v2.version=2; không có engine switch sau dispatch. Các request không tạo plan/task được ghi “—”. Lượt INVALID lock và probe NOT_READY không được tính thành execution thành công hoặc lỗi thuật toán.

## 5. Ma trận trạng thái nghiệm thu

| Ca | Offline | Android thật / giới hạn |
|---|---|---|
| Y01 chưa mở YouTube | OFFLINE_TESTED | USB-CANCEL-SEARCH mở app rồi hủy trước search; không phải full playback PASS |
| Y02 Home | OFFLINE_TESTED | USB-N2-HOME search đúng; trước decoder fix BLOCKED native locate |
| Y03 query cũ | OFFLINE_TESTED | Có N1 completion; xem từng attempt/nguồn revision |
| Y04 player đang phát khác | OFFLINE_TESTED | STABLE-N2-A BLOCKED; postcondition mới chưa đủ để tuyên bố hết native navigation bug |
| Y05 fullscreen | OFFLINE_TESTED | REAL_DEVICE_NOT_REPRODUCED đầy đủ |
| Y06 mini-player | OFFLINE_TESTED | Occlusion thật; chưa full E2E PASS |
| Y07 ads kết quả | OFFLINE_TESTED | Ads có trong capture, không tính organic |
| Y08 Shorts kết quả | OFFLINE_TESTED | Không tuyên bố mọi layout Shorts đã nghiệm thu |
| Y09 #2 / Y10 #3 / Y11 scroll | OFFLINE_TESTED | Xem attempt table; không thay BLOCKED thành PASS |
| Y12 pre-roll + Skip | OFFLINE_TESTED | Pre-roll thật đã gây BLOCKED; chưa mặc định Skip real verified |
| Y13 đúng target paused | OFFLINE_TESTED | Một Play có admission + native readback; chỉ completion table là outcome verified |
| Y14 buffering/mạng chậm | OFFLINE_TESTED fault injection | REAL_DEVICE_NOT_REPRODUCED có kiểm soát; không đổi mạng để tạo lỗi |
| Y15 thiếu N / Y16 unavailable | OFFLINE_TESTED | Real list end giữ BLOCKED; unavailable/private không bypass |
| Y17 overlay | OFFLINE_TESTED | Có capture end-card; không gọi mọi popup là safe |
| Y18 device/Session đổi | OFFLINE_TESTED | Reconnect cùng physical identity; không tự chuyển thiết bị |
| Y19 hủy | OFFLINE_TESTED | REAL_ANDROID_VERIFIED cancellation/cleanup qua Unified HTTP API |
| Y20 lệnh sau khi video phát | OFFLINE_TESTED | Chưa đạt repeatability; xem các state ban đầu từng lượt |

## 6. Validation

| Check | Kết quả |
|---|---|
| Baseline targeted trước lượt | 101/101 PASS |
| Full mốc giữa lượt | 1483 PASS /0 FAIL /6 TODO |
| Full trước Skip/end-card/NOT_SENT/reset/entity | 1503 PASS /0 FAIL /6 TODO; final-full-result.json |
| Test mới reset trước/sau | 3 FAIL tái hiện trước sửa; sau sửa 110/110 targeted PASS |
| Test entity trước/sau | 2/4 FAIL tái hiện trước sửa; sau sửa 200/200 targeted PASS |
| Full cuối manifest74, concurrency1 | **1532 PASS /0 FAIL /6 TODO**, 1538 total, exit 0, 446381ms; current-full-result.json/current-full-regression.log |
| TypeScript --noEmit cuối | entity-tsc.log, exit0 |
| Scoped ESLint | entity-lint.log, exit0; kiểm lại toàn bộ source/test đổi ở resume-scoped-lint.log |
| git diff --check | Exit0, resume-diff-check.log; chỉ có LF→CRLF warnings |
| Old tests/helpers | 92 file SHA-256 đối chiếu: 0 đổi |
| HEAD/index | HEAD như đầu lượt; index unchanged=true; không commit/push |
| Secret scan | 0 pattern hits, chỉ changed source/test/report; không đọc .env/secret/benchmark |
| Full ESLint / production build | NOT_RUN trong lượt YouTube; không tuyên bố lỗi cũ đã được sửa |

Một test **mới** về Skip từng FAIL vì assertion đếm cả benign-dialog BACK có sẵn; chỉ đổi assertion của test mới thành không có SKIP_AD. Không sửa engine dialog policy hoặc test cũ. Sáu TODO vẫn TODO. Không dùng mock PASS làm bằng chứng autonomy/Android PASS.

## 7. Cleanup, giới hạn và bước tiếp theo

Audit cuối: active tasks=0, owner modes=0, inference running/waiting=0/0, serial ownership=false, physical ownership=false. Các worker Session thuộc transport lịch sử và USB được kiểm tra riêng: 21/21 closed, 0 active, 0 unknown. GET /sessions không được Appium hỗ trợ; không tuyên bố đếm được mọi Session khác trên server. Diagnostic Session có close receipt trong từng JSON; không in Session IDs/tokens.

- Native player minimize không tác dụng: ROOT_CAUSE_UNVERIFIED ở tầng native; postcondition false-positive đã tái hiện/sửa offline. Không thêm BACK hoặc selector fallback theo suy đoán.
- USB-ENTITY-FIX-N2: sau decoder fix, bước OPEN Search được ACK nhưng postcondition timeout 10s, fresh observation vẫn YOUTUBE_HOME; không replay. Native menu bounds [954,0,1080,126], screenshot cho thấy toolbar chồng vùng status bar sau unlock. Liên hệ inset/occlusion là **INFERRED**, chưa có bằng chứng native input routing; không sửa theo phỏng đoán. Không chạy lặp cùng click để đủ quota. Các query khác chưa được nghiệm thu lại trên digest cuối qua trạng thái này.
- Scroll/list end, clipped card và continuity vẫn có thể BLOCKED. Entity decoding đã có native proof; không gán mọi failure lịch sử cho cùng root cause.
- Fullscreen/Shorts exit, network fault thực, private/age restriction và assistance resume chưa được nghiệm thu E2E trên mọi state. Dùng fault injection và nhãn REAL_DEVICE_NOT_REPRODUCED tương ứng.
- Không có bằng chứng YouTube videoId canonical ở mọi layout; composite identity vẫn cần nhiều nguồn độc lập.
- package.json đã bị thay đổi song song ở dev scripts (package-parallel-change.json). Dependencies/devDependencies không do lượt sửa này thay đổi. Giữ nguyên; không quy thay đổi đó vào agent fix.
- Không đưa ordinal vào demo chính thức như tính năng đã hoàn tất. Catalog vẫn gắn EXPERIMENTAL/UNVERIFIED cho phạm vi1–3; không đổi sang ENABLED/READY hoặc dùng parser recognition làm bằng chứng. Các ordinal chưa có full real proof không được quảng bá đã hỗ trợ.

## 8. Điều này chứng minh gì và không chứng minh gì

Các completion trong bảng đã đi qua Android thật, đúng identity và independent advancing playback; không chỉ là CLICK/SENT. Numeric entity root cause được đối chiếu native, và lỗi postcondition pause-as-exit có regression tái hiện. Hệ thống giữ BLOCKED khi bằng chứng chưa đủ, và cancellation thật nhả task/ownership.

Điều này không chứng minh N1/N2/N3 đạt 3/3 trên cùng source, mọi UI/video đều chạy, Dashboard đã PASS browser, hoặc LLM tự hiểu ứng dụng mới. Đây là một thiết bị, ít query, nhiều source revision; các success chủ yếu đến từ deterministic rules/capability/grounding/verifier. Không có cloud call hoặc benchmark held-out trong lượt này.
