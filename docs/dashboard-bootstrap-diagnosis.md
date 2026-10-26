# C1-D: Dashboard Interactive Bootstrap

Ngày 26/10/2026, branch DuyTD. **Root cause: VERIFIED, thuộc harness C1 và cách chọn origin của harness.** Không sửa application source, test, config, dependency hoặc security. Không commit/push. Không chạy C01-C19 hay tác vụ Android.

Evidence mới: **coverage/dashboard-bootstrap-diagnosis-qCSPHD/**. Hai bộ evidence C1 trước và báo cáo acceptance cũ giữ nguyên; không đổi lịch sử BLOCKED thành PASS.

## 1. Kết luận

Có **hai lỗi nối tiếp** trong môi trường nghiệm thu, không phải bằng chứng Dashboard source hỏng:

1. Cả hai proxy C1 chỉ cho WebSocket path cũ **/_next/webpack-hmr** và destroy mọi upgrade khác. Next.js đang cài sử dụng **/_next/hmr**. Đối chứng ghi **16 upgrade /_next/hmr bị từ chối**, chưa có browser API nào.
2. Khi chỉ sửa path nhưng giữ origin **http://127.0.0.1:<proxy-port>**, Next dev hiện tại vẫn từ chối WebSocket theo origin policy. Probe trực tiếp nhận raw **Unauthorized / HPE_INVALID_CONSTANT**, không phải handshake 101. Với origin thật **http://localhost:<proxy-port>**, cùng endpoint được chấp nhận **101 Switching Protocols**.

Sau khi harness chuyển tiếp đúng endpoint và browser mở **localhost** hợp lệ, không rewrite Origin, Dashboard tải device giả, nút Analyze được enable và click Wi-Fi làm hiện form Wi-Fi. Không cần sửa hook, parser, engine, Next config hoặc restart Next. PID listener Next vẫn **13476**, parent **22240**, như trước chẩn đoán.

Đây là **PASS cho diagnostic bootstrap với backend giả**, không phải C01-C19 PASS, không chứng minh Android hoặc AI completion. Production SecurityFatalError lịch sử không được dùng làm nguyên nhân: cùng dev server/dependency/source hoạt động sau sửa harness, không rerun hoặc bypass production build.

## 2. Các Phép Đối Chứng

| Bước | Phương pháp | Kết quả thật | Evidence |
|---|---|---|---|
| D1, JavaScript thuần | HTML riêng, external plain.js, click và GET /probe?case=D1 | **PASS trước và sau sửa harness**: count 0 -> 1, external script executed, GET verified true; 2 GET browser tổng hai lượt | d1-dom.txt, d1-after-fix-dom.txt, screenshots/d1-pass.jpg, network-stage1/2.json |
| D2, React độc lập | React/ReactDOM 19.3.0 đã có, SSR + hydrateRoot, useState/useEffect; không Next app | **PASS trước và sau sửa harness**: count 0 -> 1, effect GET true, không recoverable hydration error quan sát được; 2 GET browser | react-control.cjs, react-client.cjs, react-bundle-result.json, d2-dom.txt, d2-after-fix-dom.txt, screenshots/d2-pass.jpg |
| D3, client assets | Decode gzip/br khi cần, so MIME/body, parse JS không execute bằng vm.Script | **23/23 JS capture 200**, JavaScript MIME, body bằng byte với original, parse hợp lệ, **0 HTML fallback** | d3-network-initial.json, d4-proxy-original-comparison.json |
| D3, Dashboard trước sửa | Legacy-only upgrade allowlist, browser thật | **BLOCKED**: USB vẫn selected sau click Wi-Fi, device chưa tải, Analyze disabled, 0 browser API | d3-before-dom.txt, screenshots/dashboard-before.jpg, hmr-before-enable.json |
| D3, chỉ sửa path | Allow /_next/hmr nhưng browser vẫn origin 127.0.0.1 | **Vẫn BLOCKED**: upgrade được proxy nhận nhưng chưa có handshake/API | hmr-after-enable-initial.json |
| D4, original vs proxy | HTTP client chỉ GET root/static; HMR probes chỉ đọc, không browser trực tiếp original | Script list bằng nhau, Flight inline payload khớp; origin localhost + current path được 101, origin 127 bị Unauthorized | d4-proxy-original-comparison.json, hmr-original-probes.json |
| D3, sau cả hai sửa harness | Cùng proxy/source/server; URL browser localhost, current HMR path | **PASS bootstrap**: HMR connected, device giả hiển thị, Analyze enabled, click Wi-Fi selected và form xuất hiện | d3-after-dom.txt, d3-after-console.json, screenshots/dashboard-after.jpg, network-stage2.json |
| D5, application | Source giải thích hook/handler/gate; không cần sửa sau đối chứng môi trường | **Không có application patch cần thiết để gỡ blocker này**; không suy ra mọi chức năng đều đúng | File:line phần 4 |
| D6, Next runtime | Đọc PID listener, đối chứng không restart | **Không cần restart**; không xóa .next, không nâng dependency, không đổi env/security | Process fact trong diagnosis-result/final-safety; PID 13476 vẫn listener 3000 |

Bundle D2 dùng compiler webpack có sẵn chỉ cho trang React control, **không phải next build của Phone Commander**: 1.310 s, errors 0/warnings 0. Không cài package hoặc tạo production build thay thế để lách security guard.

## 3. Network, CSP Và RSC

### Asset Và Header

Original GET root: HTTP 200, text/html; proxy: cùng loại/độ dài **44.323 byte**, cùng script URLs. Hai response root có SHA khác vì request ID động; không coi SHA root khác là proxy làm hỏng response. Flight-data inline script có cùng SHA trong đối chứng; bootstrap và thẻ đóng HTML hiện diện.

Đã so **23 JS assets được capture**, không chỉ status. Body sau decode bằng nhau giữa Next 3000 và proxy; không HTML fallback, redirect hoặc syntax error. Proxy thêm CSP thử nghiệm; original root không trả CSP trong capture này. CSP production không bị sửa. Cùng CSP proxy vẫn hydrate được khi HMR/origin đúng, nên CSP không phải nguyên nhân blocker quan sát được. Không khẳng định đã nghiệm thu mọi resource có thể có.

Một request **/__nextjs_font/geist-latin.woff2** của Next DevTools bị harness trả **403** do nằm ngoài frontend allowlist. Đây là giới hạn cosmetic được giữ nguyên, **không ngăn bootstrap**. Không mở rộng API/asset allowlist để che lỗi này hoặc tuyên bố tất cả tài nguyên đều PASS.

### Handshake Và Frames

| Current endpoint /_next/hmr | Quan sát |
|---|---|
| Proxy legacy-only | 16 upgrade bị destroy trước upstream, API count 0 |
| Path được phép, origin 127.0.0.1 | Chưa có handshake; direct original probe nhận raw Unauthorized |
| Path được phép, origin localhost | Browser HMR connected; proxy nhận **101**, 8 text frames, 2 binary frames và 1 close frame |

Text frame đầu là turbopack-connected, sau đó sync/build messages; binary frames được đo metadata/độ dài, không copy payload debug hoặc gửi lên cloud. Probe legacy path với localhost timeout; không suy timeout thành 404 hoặc 403. Không làm giả browser Origin hoặc nới allowedDevOrigins; browser thực sự điều hướng tới localhost.

Trong cấu hình Next dev này, HMR còn vận chuyển **React debug channel** cho Flight decode. Local framework source nối createDebugChannel vào createFromReadableStream, còn hydrate chờ initialServerResponse trước hydrateRoot. Vì transport bị chặn, HTML vẫn hiển thị nhưng khâu dựng React tree/hydration chưa hoàn tất. Khi WebSocket thông và debug stream tới, các hook/handler chạy được. Đây là kết luận từ source + đối chứng A/B, không từ việc nhìn HTTP 200 rồi đoán.

### Browser API Events

Trước sửa: **0 browser API requests**. Sau sửa, trong cửa sổ quan sát stage2:

| Đường GET giả | Requests |
|---|---:|
| /api/devices | 27 |
| /api/devices/wireless | 27 |
| /api/agent/runtime | 54 |
| /api/unified-agent | 176 |
| **Tổng** | **284, đều GET từ browser** |

Đây là polling/bootstrap/Fast Refresh traffic trong thời gian chẩn đoán, **không phải 284 task, model calls hay benchmark hiệu năng**. Không có ANALYZE/EXECUTE/START/owner POST từ browser. Endpoint bật chế độ HMR của harness là control chẩn đoán riêng, không chuyển tiếp backend.

Console trước chỉ có React DevTools info trong capture; sau có **[HMR] connected** và Fast Refresh. Capture sau không có console warn/error; không suy ra mọi lỗi network đều xuất hiện qua console API. Không có hydration mismatch được quan sát. Các font deny nói trên vẫn báo trung thực từ network.

## 4. Giải Thích Bằng Source

| Trách nhiệm | File:line thực tế | Ý nghĩa |
|---|---|---|
| Lỗi allowlist cũ | coverage/dashboard-browser-c1-tAo3QG/c1-proxy.cjs:168-169; coverage/dashboard-browser-c1-retry-GWeUKg/c1-proxy.cjs:168-169 | Chỉ cho webpack-hmr; endpoint mới bị destroy và không được log ở bản cũ |
| Client HMR URL | node_modules/next/dist/client/dev/hot-reloader/app/web-socket.js:63 | Dùng /_next/hmr và HTML correlation ID |
| Reconnect/reload | Cùng file:104 | Disconnect lặp lại có thể dẫn tới location.reload; giải thích root GET lặp, không cần gán cho file evidence watcher |
| Dev origin policy | node_modules/next/dist/server/lib/router-utils/block-cross-site-dev.js:75-105; blockRequest:48 | Localhost nằm trong policy hiện có; origin khác phải hợp lệ theo cấu hình, không được bỏ guard |
| Chờ Flight trước hydrate | node_modules/next/dist/client/app-index.js:155,184,239-241,290 | Debug channel nối vào RSC decode; mở socket rồi await initialServerResponse trước hydrateRoot |
| Hai stream của decoder | node_modules/next/dist/compiled/react-server-dom-turbopack/cjs/react-server-dom-turbopack-client.browser.development.js:5365-5377 | Khi có debug channel, đọc stream Flight và debug, close response khi cả hai hoàn tất |
| Chuyển debug frame vào writer | node_modules/next/dist/client/dev/hot-reloader/app/hot-reloader-app.js:424-436 | Ghi/đóng debug channel từ HMR frame |
| Lấy device | hooks/useDashboardDemo.ts:39,68 | useEffect queueMicrotask gọi refreshAndroidDevices -> GET /api/devices |
| Click Wi-Fi | components/devices/ConnectionManager.tsx:52,94 | React state tab mặc định USB; onClick gọi setTab(mode) |
| Analyze gate | components/commands/UnifiedAgentPanel.tsx:115 | Không có selected live device thì disabled; không phải permission đã bị từ chối |

**Vì sao không gửi /api/devices?** Hook mount chưa chạy khi hydration bị kẹt trước React tree; không phải API thật trả danh sách rỗng. Proxy không thấy request trước sửa; sau sửa source nguyên vẹn đã GET fake endpoint thành công.

**Vì sao click Wi-Fi không đổi state?** HTML ban đầu chưa có React handler hoạt động. Focus DOM không chứng minh React onClick đã chạy. Sau sửa transport, aria-selected chuyển sang Wi-Fi và form IP/port xuất hiện bằng cùng handler, không sửa selector hoặc workflow.

**Phân loại bốn khả năng:** Browser JS/React hỏng toàn cục **bị loại trừ bởi D1/D2**; proxy/origin incompatibility **VERIFIED**; dev server cần restart hoặc application lỗi hydration **không phải nguyên nhân cần thiết cho blocker đã tái hiện**. Không dùng kết luận này để phủ nhận các bug khác của application hoặc các ca C1 chưa chạy.

## 5. Sửa Nhỏ Nhất Và Test Cần Có

Đã sửa **chỉ harness chẩn đoán mới**: allow current HMR path, giữ legacy path để đối chứng; browser dùng URL localhost hợp lệ. Không chỉnh lại hai harness/evidence cũ.

Lượt C1 kế tiếp cần áp dụng vào harness mới:

1. Upgrade allowlist chính xác cho /_next/hmr, giữ request query/correlation ID khi proxy; log các upgrade bị từ chối, không mở wildcard /_next/*.
2. Advertise/mở http://localhost:<port> khi origin policy hiện có chấp nhận localhost; giữ Origin thật từ browser. Nếu môi trường khác từ chối thì dừng chẩn đoán, **không rewrite Origin để vượt guard**.
3. Giữ chặn toàn bộ API thật, EXECUTE/START/owner/legacy, một device giả, không screenshot URL thật. Chỉ xem A00 đạt khi có HMR 101 + fake device GET + React state transition.
4. Regression cho harness: legacy-only tái hiện blocked; current path/localhost đạt handshake; invalid origin vẫn từ chối; D1/D2 external script/useEffect/useState/GET; JS body/MIME không HTML fallback; không API POST/control upstream.

Các file application cần sửa cho blocker này: **không có**. Tests application hiện tại không bị đổi. finalize-diagnosis.cjs kiểm các evidence thật và assert trước-sau; đây là kiểm chứng harness, không thay assertion nghiệp vụ C01-C19. Source risk selection C17 đã ghi ở C1 vẫn ngoài phạm vi và chưa được nghiệm thu trong C1-D.

## 6. Reproduce Trên Windows

Codex đã thực hiện browser controls, không cần người dùng thao tác thay để chứng minh kết quả trên. Các bước sau là hướng dẫn tái hiện riêng, **không phải số test đã chạy thêm**:

1. Khi Next dev đang chạy trên 3000, chạy diagnostic-server.cjs trong directory evidence với stage ID mới, thí dụ manual-20261026a, để không ghi đè capture cũ. Dùng port DIAGNOSIS_PORT được in ra, không dùng lại port đã dừng của báo cáo.
2. Mở Chrome tại http://localhost:<port>/plain và /react, click counter. Mở DevTools Network/Console, xác nhận GET /probe và thay đổi count.
3. Khi harness còn legacy-only, mở trang gốc proxy và quan sát WebSocket /_next/hmr thất bại. Không bấm Analyze/Execute, CONNECT hoặc owner mode.
4. POST **rỗng** tới endpoint riêng http://localhost:<port>/__diag/hmr-enable, reload trang proxy tại localhost. Network WS phải có 101; /api/devices là JSON giả, Wi-Fi click đổi form. Không mở Dashboard 3000 trực tiếp bằng browser cho thử tương tác chưa được intercept.
5. Đóng tab, POST rỗng tới /__diag/shutdown của chính proxy. Không gọi worker /shutdown, force-kill user process, xóa .next hoặc thay cấu hình.

Không cài Playwright/package/browser mới. Không coi hướng dẫn thủ công này là một lần nghiệm thu người dùng đã thực hiện.

## 7. An Toàn, Bảo Toàn Và Cleanup

- **Zero Android execution, zero real worker dispatch, zero ADB/Appium/Ollama/Groq calls, zero owner changes/grants.** Proof: harness không import runtime Android; chỉ frontend GET/static và HMR được tới original Next; mọi /api đều fake/deny, browser API toàn GET. Counters là phạm vi harness, không kiểm toán toàn bộ hoạt động dịch vụ người dùng.
- Có network loopback thật cho frontend, assets, fake endpoints và probes HMR. Không đưa screenshot/debug payload lên cloud; screenshot là giao diện browser với thiết bị giả, không phải ảnh màn hình Android thật.
- Hai tab chẩn đoán đã đóng trước shutdown. Server stage1 session 25771 và stage2 session 23132 đều graceful **exit 0**. Không restart/force-kill Next, worker, Appium hoặc Ollama. Fake tasks/owner modes 0/0; không tuyên bố global tasks bằng 0.
- Hash **309 source/test/script** và **7 config/AGENTS/package/lock** trước-sau không đổi. Không đọc/import/hash lại excluded open-world hoặc sealed/holdout, không đọc .env/secret. Giữ mọi dirty/deleted có sẵn.
- File mới: báo cáo này; diagnostic-server.cjs, React controls/bundle builder, compare-assets.cjs, probe-hmr.cjs, finalize-diagnosis.cjs và capture/screenshots trong evidence mới. File sửa ngoài evidence: **chỉ append mục 24 của docs/engine-merge-report.md**. Báo cáo C1 và demo-capabilities.md giữ nguyên hash.
- git diff --check **exit 0**, scoped secret/whitespace scan file C1-D viết không có high-confidence findings. Source không sửa nên không rerun full regression/TypeScript/lint/production build. **1358 PASS / 0 FAIL / 6 TODO**, B5 68/68, TS PASS và build SecurityFatalError là **baseline lịch sử**, không phải run C1-D.

## 8. Điều Kiện Quay Lại C1

**Blocker A00 đã được giải thích và gỡ trên harness chẩn đoán.** Đủ cơ sở tiếp tục C1 bằng harness mới đã sửa path/origin, sau preflight isolation và A00 controls. Không tự nâng C01-C19 từ NOT_RUN thành PASS, không cấp nhãn Android hoặc tuyên bố production-ready.

Dừng C1-D tại đây. Không chạy lại toàn bộ acceptance, không chuyển C2 Android, P2, Teach Mode hoặc sửa application/security. Không commit/push.
