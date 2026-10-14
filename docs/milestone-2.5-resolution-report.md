# Milestone 2.5: Interaction Target Resolution + Hybrid UI Observation

Ngày kiểm thử: 14/10/2026. Một Samsung A50s SM-A507FN, Android 11, serial `R58MA78W6QK`. Appium 3.8.0, UiAutomator2 8.7.0; helper APK đã được xác minh tương thích, dùng `skipServerInstallation=true`. Chỉ chạy các bài thử tuần tự, đóng Session trong `finally`. Không cài/gỡ APK, đăng nhập, đăng ký kênh hoặc thay đổi cài đặt điện thoại. Driver Chrome được tải sau phê duyệt, không phải APK.

## 1. Kết luận nghiệm thu

**Chưa đủ nghiệm thu toàn bộ Milestone 2.5.** Resolver, policy độc lập và Native/Web observer đã tích hợp; Chrome và Settings có bằng chứng PASS trên máy thật. YouTube tìm được video thường thứ hai nhưng không chứng minh được điểm nhấn riêng trên card có Sản phẩm, nên vẫn BLOCKED/AMBIGUOUS. Không coi việc phát hiện card là đã mở đúng video.

Giữ nguyên model đang cấu hình, system prompt Ollama và Action Plan schema. Không xây dựng lại Dashboard, không triển khai Milestone 3-5. Chrome/Settings sử dụng action xác định sẵn, không chứng minh AI đã tự lập kế hoạch tổng quát.

## 2. Nguyên nhân gốc

### YouTube: nhận diện nội dung không đồng nghĩa xác định thao tác

Hierarchy thật có container clickable gộp tiêu đề, thời lượng, kênh, lượt xem, nhãn phát và vùng Sản phẩm. TextView tiêu đề/thumbnail riêng không luôn xuất hiện. Một điểm giữa container có thể trùng thao tác phụ; chuỗi mô tả có chữ Play video không chứng minh vị trí của nút phát. Phần tử đã phát hiện ở viewport trước cũng không được dùng để click nếu native reference/bounds đã đổi.

Phát hiện thêm hai lỗi ảnh hưởng ordinal: chuẩn hóa `Được tài trợ` trước đây thay chữ đ trước khi lowercase, làm sót chữ Đ hoa; identity dựa trên mô tả đầy đủ có thể đổi theo lượt xem/thời gian. Đã sửa thứ tự chuẩn hóa và identity có cấu trúc cho video có đủ bằng chứng title/duration/channel. Không rút gọn identity cho mọi layout một cách tùy tiện.

Cuộn dài có thể bỏ qua vùng overlap cần để nối thứ tự xuyên viewport. Bổ sung refinement cuộn ngược có giới hạn để lấy lại overlap; không tiếp tục đếm bằng suy đoán khi không khôi phục được. Giữ mặc định 90% trước khi thấy video và 60% sau đó; refinement cục bộ có thể dùng nhịp ngắn hơn.

### Chrome: native accessibility không phải DOM

UiAutomator2 đôi khi chỉ đưa toolbar hoặc một phần WebView vào native hierarchy. Lần đầu phát hiện `WEBVIEW_chrome` nhưng chuyển context thất bại vì ChromeDriver không tương thích. Native fallback không đủ để xác minh kết quả thứ ba. Chrome đang hoạt động là 155.0.8059.39, khác APK factory 87 được liệt kê cùng trong dumpsys; phải đối chiếu bản đang chạy.

Sau khi ghim ChromeDriver 155.0.8059.39 từ nguồn Google chính thức, cùng Session đọc được DOM thật. Một lần đầu vẫn BLOCKED vì CSS width 411.428 lớn hơn innerWidth 411; đã cho phép sai số clipping 1 CSS pixel, không nới lỏng kiểm tra phần tử thực sự nằm ngoài viewport hay bị che.

### isSensitive: flag từ planner được chuyển nguyên trạng

Luồng interpret nhận JSON của model, validation giữ cờ và executor cũ chặn cờ true. Không tìm thấy bằng chứng frontend tự đổi tác vụ điều hướng thành nhạy cảm. Cơ chế nội bộ khiến Qwen chọn sai flag chưa được chứng minh; không khẳng định nguyên nhân nằm trong trọng số/prompt. Thay vì sửa prompt/model hoặc bỏ guard, thêm policy độc lập và báo bất đồng có cấu trúc.

Tái sử dụng Session Manager, serial lock, snapshot/parser, matching, observer polling, verifier, scroll-region detection, native scroll controller và element memory. Không viết lại các nền tảng này.

## 3. File tạo và sửa trong lượt này

File mới:

| File | Vai trò |
| --- | --- |
| `lib/android/interaction-target-resolver.ts` | Phân giải nhãn/owner/phương thức click từ snapshot thật |
| `lib/android/hybrid-context-observer.ts` | Context inventory, đọc DOM, định vị/click liên kết và xác minh trang đích |
| `lib/android/security-policy.ts` | Chính sách độc lập và kiểm tra control tại runtime |
| `lib/android/appium/session-operation-lock.ts` | Khóa context/thao tác trong cùng Session, hỗ trợ lời gọi lồng nhau |
| `tests/milestone25-resolution.test.cjs` | Test resolver, policy, Native/Web, stale state và khóa |
| `tests/milestone25.integration.cjs` | Bài thử thật opt-in YouTube/Chrome/Settings |
| `docs/milestone-2.5-resolution-report.md` | Báo cáo hiện hành |

File đã có được sửa:

| File | Thay đổi |
| --- | --- |
| `lib/android/state-observer.ts` | Native/Web evidence, resolver, lookup/revalidation trước click, so URL tab native với DOM |
| `lib/android/condition-executor.ts` | Tích hợp resolver/policy/web click, kiểm tra app/control/password/URI |
| `lib/android/action-verifier.ts` | Xác minh browser search bằng DOM khi khả dụng |
| `lib/android/screen-state.ts` | Nhận diện player từ metadata thật trong hierarchy gộp |
| `lib/android/exploration/ui-explorer.ts` | Activation resolution, bounded overlap refinement, dùng lại ordinal memory |
| `lib/android/exploration/element-memory.ts` | Identity có bằng chứng, lọc ad và shelf không cùng loại |
| `lib/android/exploration/scroll-controller.ts` | Dùng chung khóa thao tác Session |
| `lib/android/targets.ts` | Chuẩn hóa chữ Đ hoa đúng thứ tự |
| `lib/android/appium/client.ts` | CSS locator, chẩn đoán lỗi context/driver đã sanitize |
| `lib/android/appium/session-manager.ts` | Driver path tùy chọn đã kiểm tra, attach Chrome đang chạy, close có khóa |
| `lib/android/errors.ts` | Backend reason có cấu trúc |
| `app/api/executions/route.ts` | Trả policy khi từ chối plan, không tạo Session cho plan bị chặn |
| `types/execution.ts` | Evidence Native/Web tùy chọn |
| `tests/ui-exploration.test.cjs` | Regression quảng cáo, memory, refinement và shelf |
| `tests/android-observer-api.integration.cjs` | Mở rộng từ 5 lên 7 API cases gồm policy |
| `.env.example`, `.env.local`, `.gitignore` | Cấu hình driver tùy chọn và bỏ qua driver local |
| `README.md` | Hướng dẫn chạy bài thử/config và liên kết báo cáo |

Working tree có thay đổi từ các lượt trước. Danh sách này không nhận toàn bộ `git diff` là thay đổi mới; không revert hoặc commit thay đổi của người dùng. Không sửa schema/prompt/model trong lượt này.

## 4. Interaction Target Resolver

1. Target phải thuộc snapshot OBSERVED hiện tại và đúng foreground package; kiểm tra enabled/displayed và bounds hữu hạn.
2. Tính vùng hiển thị sau viewport/ancestor clipping; target cần ít nhất 90% diện tích hiển thị để phân giải native activation.
3. Tìm clickable ancestor hợp lệ, kiểm tra parent-child, package và nhãn. Nhiều nhãn giống nhau hoặc thiếu ancestry trả AMBIGUOUS.
4. Kiểm tra control quan sát được có che tâm nhãn/điểm kích hoạt hay không. Với card có vùng Sản phẩm/preview và thiếu nhãn phát riêng, từ chối click.
5. Lookup native element duy nhất, kiểm tra displayed/enabled/clickable/rect. HTML resource-ID ngắn trong Chrome native AX dùng XPath có text/resource-id thay vì để Appium auto-complete thành Android ID sai.
6. Đọc snapshot mới ngay trước click: app/activity, nội dung, identity và bounds phải còn phù hợp; lookup lại element. Không dùng reference cũ xuyên scrolling.
7. Gửi element.click cho target tự clickable, hoặc `mobile: clickGesture` tại tâm nhãn native đã đo và có owner đã xác minh. Không lấy tọa độ dự đoán từ ảnh hay tỷ lệ card.
8. Verifier kiểm tra hậu điều kiện theo goal. Action không có verifier đủ bằng chứng chỉ được SENT, không SUCCESS.

Ordinal memory giới hạn theo app/activity/query/itemType/vùng danh sách, loại quảng cáo khi có bằng chứng và không đếm shelf ngang như video dọc. Cần continuity/overlap giữa viewport; collision hoặc thứ tự không rõ giữ AMBIGUOUS. WAIT video_list và CLICK video_N dùng lại memory phù hợp thay vì rewind vô điều kiện.

## 5. Native/Web Context và Session

Quan sát native trước, lấy context inventory rồi chỉ chọn Web Context phù hợp foreground. Nhiều context phù hợp trả AMBIGUOUS_CONTEXT; không chọn ngẫu nhiên. Khi Chrome đang nhập trong field focused, không chuyển context để đọc trang phía sau.

Hybrid observer dùng **cùng ManagedSession**, không gọi tạo Appium Session thứ hai. Khóa dùng chung giữa observe/locate/execute/scroll/close bảo đảm thao tác khác không chạy giữa lúc context đang Web. AsyncLocalStorage hỗ trợ lời gọi lồng trong một operation và vô hiệu token sau khi operation kết thúc.

Đọc DOM bằng script read-only do server sở hữu: URL/title/readyState/headings, link HTTP(S) chứa heading, CSS selector từ cây thật, href/destination, bounds, visibility, elementFromPoint và dấu hiệu quảng cáo. Không coi mọi anchor là kết quả; nhóm ad không xác định được ranh giới bị chặn. CSS selector là bằng chứng của snapshot hiện tại, không hardcode kết quả test.

Trước web click, xác minh URL trang tìm kiếm, title/href/ordinal/selector còn khớp, scrollIntoView đúng W3C element, đọc lại DOM để kiểm tra hiển thị và che khuất, rồi element.click. Trang đích phải khớp host/path mong đợi, readyState complete và title/heading phù hợp; trang lỗi/captcha không được PASS. Sau đó khôi phục NATIVE_APP, đọc lại app để xác minh. Chrome native address phải phù hợp URL DOM; lệch tab/page trả ambiguity.

Luôn restore Native trong finally và kiểm chứng context. Restore thất bại là SESSION_ERROR, không native fallback tiếp. NO_WEB_CONTEXT/CHROMEDRIVER_INCOMPATIBLE chỉ fallback khi Native đã khôi phục; evidence ghi NATIVE_ONLY và lý do. Lỗi device/session/cancellation không bị đổi thành thành công. Không fallback sau web action đã gửi để tránh click lần hai.

Cơ chế context và capability dựa trên [Appium Context API](https://appium.io/docs/en/latest/guides/context/), [UiAutomator2 Web Context](https://github.com/appium/appium-uiautomator2-driver) và [ChromeDriver Android](https://developer.chrome.com/docs/chromedriver/get-started/android). Driver executable là cấu hình được phê duyệt riêng; backend không tự tải/cài khi lỗi.

## 6. Policy độc lập

Policy phân loại NAVIGATION, READ, DATA_CHANGE, SENSITIVE, UNKNOWN và trả ALLOW/CONFIRM/BLOCK kèm risks/reasons/llmDisagreement.

- Điều hướng/đọc có semantics đã biết và AI flag false: ALLOW, vẫn kiểm tra UI runtime.
- Điều hướng/đọc nhưng AI flag true: CONFIRM và llmDisagreement=true; không rewrite cờ.
- Thao tác sensitive/data-change: BLOCK dù AI flag false. Unknown: CONFIRM, không tự chạy.
- Runtime kiểm tra target, nhãn và owner: subscribe/like/comment/login/payment/delete/send và các Switch/CheckBox/RadioButton/ToggleButton bị chặn. Ô password hoặc thuộc tính password không đủ bằng chứng bị từ chối trước nhập.
- URI javascript/data/intent/custom scheme trong Chrome bị chặn; chỉ search text/HTTP(S) được xem xét theo policy. Không dùng AI làm cơ chế cấp phép cuối.

API từ chối trước Session creation và trả `policy`. **Chưa có UI/backend human-approval workflow an toàn**: CONFIRM hiện biểu hiện bằng từ chối có lý do, không có nút bypass hay tự xác nhận. Policy dựa trên semantics đã hỗ trợ, không bảo đảm nhận diện mọi thao tác nhạy cảm của mọi ứng dụng.

## 7. Kiểm thử thật

Report JSON ở `C:\Users\Tran Duy Khanh\AppData\Local\Temp`. Các filename dưới đây là bằng chứng từng lần chạy, không chỉ là mock. File có nhãn UI/URL trang công khai; kiểm tra nội dung trước khi chia sẻ.

### YouTube: BLOCKED đúng giới hạn an toàn

Query `podcast tiếng Anh`. Report cuối `phone-commander-m25-resolution-youtube-1791926131626.json`:

| Bước | Kết quả | Thời gian |
| --- | --- | --- |
| OPEN_APP | PASS foreground YouTube | 3.615 s |
| WAIT search_button | PASS | 3.029 s |
| CLICK search | PASS chuyển sang input | 5.369 s |
| INPUT_TEXT | PASS đọc lại đúng query | 3.893 s |
| ENTER | PASS xác minh kết quả tìm kiếm | 3.322 s |
| WAIT video_list | PASS, 1 scroll / 2 snapshot | 23.634 s |
| CLICK video_card_2 | BLOCKED/AMBIGUOUS; chưa gửi click | 28.380 s |

Discovery của CLICK ghi 3 scroll / 4 snapshot, 3 identity mới và 4 duplicate. Card thứ hai có `2 sản phẩm` nhưng không có activation label riêng đủ bằng chứng. Một report trước `phone-commander-m25-resolution-youtube-1791924101301.json` ghi video thường thứ hai là `IELTS ASMR Podcast #01 - Luyện nghe thụ động | Phụ đề Anh & Việt` (15 phút 49 giây), sau video A1 của English Podcast; overlap refinement đã khôi phục continuity. Không hardcode tiêu đề này trong production resolver.

Selector/control thật: `com.google.android.youtube:id/search_edit_text`; hierarchy card gộp mô tả video và nhãn sản phẩm thay vì title node clickable riêng. Mục tiêu mở/xác minh trang video thứ hai **chưa PASS**. Session cleanup PASS.

Lần đầu `phone-commander-m25-resolution-youtube-1791923478016.json` bị lỗi lọt ad `Được tài trợ` vào ordinal và verifier thiếu modern title; không dùng lần đó làm bằng chứng chọn đúng video thứ hai. Đã thêm regression và sửa lỗi; không che giấu kết quả không hợp lệ.

### Chrome: PASS DOM + result ngoài vùng click an toàn

Query `công thức nấu phở`, context `NATIVE_APP` và `WEBVIEW_chrome`. Report cuối `phone-commander-m25-resolution-chrome-1791929819892.json`:

| Bước | Kết quả | Thời gian |
| --- | --- | --- |
| OPEN_APP | PASS | 5.704 s |
| CLICK address_bar | PASS native transition | 3.520 s |
| INPUT_TEXT | PASS đọc lại query | 3.536 s |
| ENTER | PASS search results + DOM | 7.988 s |
| CLICK result_3 | PASS scroll/revalidate/click/trang đích | 13.541 s |

Native address selector `com.android.chrome:id/url_bar`. DOM CSS selector được sinh từ anchor đang chứa heading của kết quả thứ ba. Trước scroll, bounds `[0,646.048,411.429,771.048]`, viewport CSS `411 x 756`: link chưa nằm hoàn toàn trong viewport, `visible=false`. Sau scrollIntoView và revalidation, click thành công; trang đích là bài Điện máy XANH `/vao-bep/huong-dan-chi-tiet-cach-nau-pho-bo-thom-ngon-bo-duong-00983`, title/h1 `3 cách nấu phở bò ngon chuẩn vị, nước dùng đậm đà đơn giản tại nhà`, readyState complete. Native và DOM cùng URL, cleanup PASS.

Lần trước `phone-commander-m25-resolution-chrome-1791924966210.json` có kết quả thứ ba **hoàn toàn** dưới viewport (y976..1101 so với height756), mở bài Hướng Nghiệp Á Âu và PASS. Lần `1791925354910` mở bài Netspace, có title/h1 thật. Thứ hạng provider thay đổi giữa lần chạy; code không ghim URL của bài test. Không coi ba lần PASS là bảo đảm ổn định mọi website.

Lần chưa cấu hình driver (`1791923722627`) chẩn đoán incompatibility và native fallback bị chặn; lần inspect launcher (`1791923857690`) không phải bằng chứng Chrome. Lần đầu có DOM (`1791924809381`) bị chặn clipping CSS và chưa click; đã sửa sai số có test.

### Settings: PASS hồi quy ngoài viewport

`phone-commander-m25-resolution-settings-1791924374097.json`: OPEN_APP 2.970 s; `text:Thông tin điện thoại` ban đầu MISSING, tìm được sau 6 scroll / 7 snapshot trong 26.807 s. Không nhấn mục này, không bật/tắt setting. Session cleanup PASS. Đây là bài thử thật trong lượt này trước các hardening cuối; API cuối tiếp tục kiểm tra foreground/Session trên source mới.

### Security/API

7/7 cases PASS trên API thật: AI flag true điều hướng bị CONFIRM không tạo Session; sensitive selector giả an toàn với false flag bị BLOCK không tạo Session; unknown selector bị CONFIRM; foreground SUCCESS; BACK không xác minh là SENT; WAIT thiếu target TIMEOUT và bước sau PENDING; overlap409/cancel nhả khóa. Dùng selector test không tồn tại cho sensitive/unknown để không gây thao tác nguy hiểm ngay cả khi guard hồi quy.

Report API cuối trên source đã hardening: `phone-commander-api-integration-1791930326356.json`. Thời gian tương ứng 1.423 / 0.294 / 0.148 / 15.910 / 15.837 / 14.482 / 7.608 giây. Cleanup được kiểm tra theo execution/khóa và finally của các bài thử; endpoint liệt kê toàn bộ `/sessions` không được Appium server này hỗ trợ, nên không dùng endpoint đó để khẳng định inventory toàn server.

## 8. Kiểm tra mã và giới hạn

- Unit: **129/129 PASS**, gồm các test cũ và thêm ancestor, viewport, occlusion, duplicate, stale, video ordinal, ad Đ hoa, memory continuity, web/no-web/incompatibility/restore/session error, mutex và policy. Mock không thay thế bằng chứng điện thoại.
- TypeScript `tsc --noEmit`: PASS.
- ESLint `lib/android`, API execution và execution types: PASS.
- Lint toàn repo: FAIL do 2 lỗi có sẵn (`components/devices/DeviceScreen.tsx:41` setState trong effect; `components/executions/ExecutionDetailModal.tsx:130` explicit any), cùng 22 warnings. Không sửa các file ngoài phạm vi để làm báo cáo xanh.
- Production build: NOT TESTED. Không khẳng định build/deployment hoặc Dashboard end-to-end từ Ollama đã PASS.

Hạn chế còn lại: native hierarchy không luôn cung cấp vùng phát riêng/ID nội dung bền vững; kiểm tra che khuất chỉ dựa trên dữ liệu provider quan sát được. Video title/duration/channel không là ID toàn cục, collision vẫn chặn. Hybrid app khác và nested scrolling thật chưa kiểm thử vật lý. DOM adapter chỉ xử lý link có heading và ad có bằng chứng; trang không đúng loại có thể UNKNOWN/BLOCKED. Title verification bảo thủ có thể chặn redirect hợp lệ. Driver pin cần kiểm tra lại khi Chrome cập nhật. Thời gian đo biến thiên đáng kể; chưa đo CPU để quy nguyên nhân cho máy hay backend. Chưa có workflow xác nhận người dùng để tiếp tục plan CONFIRM.

ADB giữ discovery, mở app và phím hệ thống; Appium là nguồn native state/element + context gateway, DOM bổ sung cho Chrome khi thật sự khả dụng. Không chạy hai observer độc lập cùng polling/click trên một điện thoại. ADB XML fallback vẫn là backend riêng, không giả làm DOM và không tạo Session cạnh tranh.

## 9. Cách chạy lại

Mở khóa máy, xác nhận USB debugging, chạy Appium và Next.js như README. Chỉ chạy tuần tự từ thư mục dự án:

```powershell
node.exe --test tests/android-executor.test.cjs tests/state-observer.test.cjs tests/ui-exploration.test.cjs tests/milestone25-resolution.test.cjs
node.exe node_modules/typescript/bin/tsc --noEmit
node.exe node_modules/eslint/bin/eslint.js lib/android app/api/executions/route.ts types/execution.ts
node.exe tests/android-observer-api.integration.cjs --serial R58MA78W6QK
node.exe tests/milestone25.integration.cjs R58MA78W6QK youtube
node.exe tests/milestone25.integration.cjs R58MA78W6QK chrome
node.exe tests/milestone25.integration.cjs R58MA78W6QK settings
```

Script mới tải `.env.local`; biến `APPIUM_CHROMEDRIVER_EXECUTABLE` cần đường dẫn tuyệt đối tới driver tương thích đã được phê duyệt. Backend không tự tải driver, không tự cài lại APK. Unit test không cần điện thoại; API test cần Next/Appium; bài thử thật cần mạng trên điện thoại. Mỗi script có report TEMP và cleanup riêng. Giữ Appium/Next/Ollama đang chạy để người dùng sử dụng, chỉ đóng Session thử nghiệm.

Dừng ở Milestone 2.5. Muốn nghiệm thu toàn bộ cần layout/activation evidence đủ để mở đúng video thường thứ hai và xác minh trang đích; không gỡ BLOCKED bằng click đoán.
