# Phone Commander - Hệ thống điều khiển điện thoại

Ứng dụng web chuyển câu lệnh tiếng Việt thành kế hoạch thao tác, rồi thực thi trên Android bằng Appium State Observer kết hợp ADB cho discovery, mở app và phím hệ thống. Backend ADB cũ vẫn có thể chọn riêng. AI chạy bằng Ollama trên máy tính; giao diện và các API dự án chạy cùng một server Next.js.

Tài liệu dành cho **Windows, dùng PowerShell**. Với CMD, dùng `cd /d "ĐƯỜNG_DẪN_DỰ_ÁN"` thay cho `Set-Location`. Các đoạn có `$serial`, `$body`, `Invoke-RestMethod` cần PowerShell.

## Mục lục

USB/Wi-Fi hybrid connectivity: [Setup, security, reconnect and acceptance](docs/hybrid-connectivity.md).

- [1. Các thành phần cần tải](#1-các-thành-phần-cần-tải)
- [2. Cài Node.js và dependency](#2-cài-nodejs-và-dependency)
- [3. Cài ADB và kết nối Android](#3-cài-adb-và-kết-nối-android)
- [4. Cài ADB Keyboard](#4-cài-adb-keyboard)
- [5. Cài Ollama và model AI](#5-cài-ollama-và-model-ai)
- [6. Cấu hình môi trường](#6-cấu-hình-môi-trường)
- [7. Chạy và sử dụng dự án](#7-chạy-và-sử-dụng-dự-án)
- [8. Kiểm tra từng API](#8-kiểm-tra-từng-api)
- [9. Tắt và khởi động lại](#9-tắt-và-khởi-động-lại)
- [10. Xử lý lỗi](#10-xử-lý-lỗi)
- [11. Kiểm thử và bản build](#11-kiểm-thử-và-bản-build)
- [12. Cấu trúc và giới hạn](#12-cấu-trúc-và-giới-hạn)

## 1. Các thành phần cần tải

API không phải phần mềm cần tải riêng. Cài và chạy các thành phần dưới đây để ứng dụng truy cập được các dịch vụ tương ứng.

| Thành phần | Vai trò | Nguồn tải |
| --- | --- | --- |
| Node.js và npm | Cài thư viện, chạy Next.js | [Node.js chính thức](https://nodejs.org/en/download) |
| Android SDK Platform-Tools | Cung cấp `adb` để kết nối và điều khiển Android | [Platform-Tools chính thức](https://developer.android.com/tools/releases/platform-tools) |
| Ollama | Chạy model và API AI local | [Ollama cho Windows](https://ollama.com/download/windows) |
| `qwen2.5:7b-instruct` | Model nền trong `ollama/Modelfile` | [Model trên Ollama](https://ollama.com/library/qwen2.5:7b-instruct) |
| ADB Keyboard | Nhập tiếng Việt, Unicode trên điện thoại | [Dự án ADB Keyboard](https://github.com/senzhk/ADBKeyBoard) |
| Appium + UiAutomator2 | Quan sát UI native và thực thi theo điều kiện | [Appium chính thức](https://appium.io/docs/en/latest/quickstart/install/) |

Dự án dùng Next.js `16.4.0`, React `19.3.0`, TypeScript và Tailwind CSS. Package Next.js yêu cầu Node.js tối thiểu `20.9.0`; cài mới nên chọn bản LTS còn được hỗ trợ trên trang tải chính thức. Dependency còn lại được npm cài từ lockfile.

Cần điện thoại Android, cáp USB truyền dữ liệu và Internet để tải công cụ/model. Điện thoại cần mạng để dùng YouTube. Tốc độ AI phụ thuộc máy tính; lần tải và phân tích đầu tiên có thể lâu hơn các lần sau.

Không cần OpenAI API key, Google API key hoặc cơ sở dữ liệu riêng. Backend mặc định dùng Appium; có thể chọn backend ADB cũ bằng `ANDROID_EXECUTOR_BACKEND=adb`.

### Appium Cho Backend Mới

Nếu đã cài Appium/driver, kiểm tra và dùng bản hiện có, không cài lại chỉ để chạy dự án:

```powershell
appium --version
appium driver list --installed
appium driver doctor uiautomator2
appium --address 127.0.0.1 --port 4723 --log-level info
```

Giữ terminal Appium mở. Kiểm tra ở terminal khác:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4723/status"
```

Với máy cài mới, xem [hướng dẫn Appium](https://appium.io/docs/en/latest/quickstart/install/) và cài driver UiAutomator2 theo tài liệu. APK `io.appium.settings`, `io.appium.uiautomator2.server` và `.server.test` cần được chuẩn bị trên điện thoại với sự cho phép của người dùng. Phone Commander không tự cài/gỡ APK. Trước khi dùng `skipServerInstallation`, backend đối chiếu server APK trên điện thoại với phiên bản dependency của driver cục bộ và kiểm tra instrumentation.

Đã kiểm thử với Appium 3.8.0, UiAutomator2 8.7.0. `JAVA_HOME` cần trỏ JDK thật; trên máy kiểm thử là `C:\Program Files\Java\jdk-17.0.20.1`. Cấu hình process riêng nếu không cần thay đổi JAVA_HOME/PATH Windows lâu dài.

Appium cần Android SDK và JDK, không chỉ file adb.exe rời. Ví dụ thiết lập trong terminal chạy Appium, sửa JAVA_HOME theo bản đã cài:

```powershell
$env:JAVA_HOME = "C:\Program Files\Java\jdk-17.0.20.1"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
Test-Path "$env:JAVA_HOME\bin\java.exe"
Test-Path "$env:ANDROID_HOME\platform-tools\adb.exe"
appium driver doctor uiautomator2
```

Hai Test-Path cần trả true; không đặt JAVA_HOME vào thư mục `bin`. Giữ Appium trên loopback 127.0.0.1, không public server điều khiển điện thoại ra Internet.

## 2. Cài Node.js và dependency

1. Tải hoặc sao chép mã nguồn, giải nén nếu cần.
2. Cài Node.js từ liên kết mục 1, giữ tùy chọn thêm vào PATH.
3. Mở PowerShell mới:

```powershell
node --version
npm.cmd --version
```

4. Vào thư mục chứa `package.json`. Ví dụ dự án trong Downloads:

```powershell
Set-Location "$env:USERPROFILE\Downloads\smart_device_control_system"
Get-Item package.json
npm.cmd ci
```

`npm.cmd ci` cài dependency theo lockfile, thay thế `node_modules` nếu đã có. Nếu package và lockfile không khớp, chạy `npm.cmd install` để cập nhật và giữ `package-lock.json` mới cùng mã nguồn.

Các lệnh dự án chạy tại **thư mục gốc**, không tại `apps/web/src`. Hướng dẫn dùng npm, không cần cài thêm pnpm cho cùng lần thiết lập.

## 3. Cài ADB và kết nối Android

### 3.1. Tải ADB và thêm PATH

1. Mở [Platform-Tools](https://developer.android.com/tools/releases/platform-tools), chọn Windows.
2. Giải nén để có `adb.exe`, ví dụ `C:\Android\platform-tools\adb.exe`.
3. Tìm **Edit environment variables for your account** trong Windows. Thêm `C:\Android\platform-tools` vào **Path** và lưu.
4. Mở terminal mới; nếu Next.js đã chạy trước khi sửa PATH, tắt và chạy lại để nhận PATH mới.

```powershell
where.exe adb
adb version
adb start-server
```

Nếu đã cài Android Studio, có thể dùng `%LOCALAPPDATA%\Android\Sdk\platform-tools`. Kiểm tra `where.exe adb` để biết bản đang được dùng.

### 3.2. Kết nối điện thoại

1. Trong Cài đặt điện thoại, tìm Số bản dựng/Build number để bật Tùy chọn nhà phát triển.
2. Bật **USB debugging/Gỡ lỗi USB** trong Tùy chọn nhà phát triển.
3. Cắm cáp truyền dữ liệu, mở khóa máy và xác nhận thông báo cho phép gỡ lỗi USB.

Vị trí tùy chọn khác nhau theo hãng; tham khảo [hướng dẫn Android chính thức](https://developer.android.com/studio/run/device).

```powershell
adb devices -l
```

Mong đợi:

```text
List of devices attached
EXAMPLE_SERIAL    device product:... model:...
```

`device` là sẵn sàng; `unauthorized` là chưa cấp quyền; `offline` là kết nối chưa hoạt động. Thay `EXAMPLE_SERIAL` bằng serial thật:

```powershell
$serial = "EXAMPLE_SERIAL"
adb -s $serial shell getprop ro.build.version.release
```

Khi có nhiều máy, dùng `-s $serial` để chọn đúng thiết bị. Biến `$serial` chỉ tồn tại trong cửa sổ PowerShell hiện tại.

## 4. Cài ADB Keyboard

Công cụ này được **cài trên điện thoại**, không phải package npm. Chỉ backend ADB cũ cần nó khi nhập Unicode, tiếng Việt có dấu, xuống dòng hoặc nguyên văn `%s`. Backend Appium nhập Unicode trực tiếp và đọc lại nội dung, không cần ADB Keyboard.

1. Tải APK từ [repository hoặc Releases của ADB Keyboard](https://github.com/senzhk/ADBKeyBoard).
2. Ví dụ dưới đây giả sử APK tên `ADBKeyboard.apk` trong Downloads; sửa đường dẫn theo file thực tế.
3. Cài và bật bàn phím trên đúng máy:

```powershell
$serial = "EXAMPLE_SERIAL"
adb -s $serial install -r "$env:USERPROFILE\Downloads\ADBKeyboard.apk"
adb -s $serial shell ime enable com.android.adbkeyboard/.AdbIME
adb -s $serial shell ime list -s
```

Danh sách cần có `com.android.adbkeyboard/.AdbIME`.

Không cần giữ ADB Keyboard làm bàn phím mặc định. Executor tạm chọn bàn phím, gửi UTF-8 base64, xác minh ô nhập và khôi phục bàn phím trước đó. Nếu thiếu bàn phím, kế hoạch Unicode bị từ chối trước thao tác đầu tiên.

## 5. Cài Ollama và model AI

### 5.1. Dịch vụ Ollama

Cài [Ollama Windows](https://ollama.com/download/windows), mở ứng dụng Ollama, rồi mở PowerShell mới:

```powershell
ollama --version
Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags"
```

API trả danh sách model nghĩa là dịch vụ hoạt động, kể cả danh sách trống. Ollama Windows có thể chạy nền; không cần server thứ hai khi API đã phản hồi. Xem [tài liệu Windows của Ollama](https://docs.ollama.com/windows).

Nếu API chưa truy cập được, chạy trong terminal riêng, giữ terminal mở:

```powershell
ollama serve
```

Nếu cổng `11434` đã được dùng, kiểm tra API trước: có thể Ollama đang chạy.

### 5.2. Tải model và tạo phone-commander

Tại thư mục gốc dự án:

```powershell
ollama pull qwen2.5:7b-instruct
ollama create phone-commander -f .\ollama\Modelfile
ollama list
```

Cần thấy `phone-commander` hoặc `phone-commander:latest`, khớp `OLLAMA_MODEL` ở mục 6. `ollama/Modelfile` định nghĩa model nền và hướng dẫn AI; xem [tài liệu tạo model](https://docs.ollama.com/modelfile).

Có thể thử tương tác trực tiếp:

```powershell
ollama run phone-commander
```

Nhập `Mở YouTube`, dùng `/bye` để thoát. Khi dùng web, không cần giữ phiên `ollama run` mở; backend gọi HTTP. Sau khi sửa `ollama/Modelfile`, chạy lại `ollama create` để cập nhật model.

## 6. Cấu hình môi trường

Tạo/mở **`.env.local` ở thư mục gốc**, cùng cấp `package.json`:

```powershell
notepad .env.local
```

Lưu nội dung dưới đây đúng tên `.env.local`, không thêm `.txt`:

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=phone-commander
OLLAMA_TIMEOUT_MS=180000
ANDROID_EXECUTOR_BACKEND=appium
APPIUM_URL=http://127.0.0.1:4723
```

| Biến | Ý nghĩa | Mặc định trong mã |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | Địa chỉ gốc Ollama, không thêm `/api/chat` | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Model phân tích lệnh | `phone-commander` |
| `OLLAMA_TIMEOUT_MS` | Thời gian tối đa chờ AI, mili giây | `180000` = 3 phút |
| `ANDROID_EXECUTOR_BACKEND` | `appium` cho observer mới, `adb` cho executor cũ | `appium` |
| `APPIUM_URL` | URL server Appium | `http://127.0.0.1:4723` |
| `APPIUM_HOME` | Thư mục cài driver để kiểm chứng server APK | `.appium` trong thư mục người dùng |
| `ADB_PATH` | Đường dẫn đầy đủ adb.exe nếu không có trên PATH | `adb` |

Máy chậm có thể tăng timeout, ví dụ `300000`. Đây là timeout AI, khác `timeoutMs` của `WAIT_FOR` trên điện thoại. Sửa môi trường xong cần khởi động lại Next.js. `.env.local` đã được `.gitignore` loại khỏi Git.

## 7. Chạy và sử dụng dự án

### 7.1. Thứ tự khởi động mỗi lần dùng

| Thành phần | Lệnh/thao tác | Giữ terminal mở? |
| --- | --- | --- |
| ADB | Cắm điện thoại, `adb start-server`, `adb devices -l` | Không; server chạy nền |
| Ollama | Mở ứng dụng hoặc chạy `ollama serve` | Có nếu dùng `ollama serve` |
| Appium | `appium --address 127.0.0.1 --port 4723 --log-level info` | Có, khi chọn Appium backend |
| Web và API | `npm.cmd run dev` tại thư mục gốc | Có |
| ADB Keyboard | Đã cài và bật ở mục 4 | Không có server riêng |

```powershell
Set-Location "$env:USERPROFILE\Downloads\smart_device_control_system"
adb devices -l
Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags"
npm.cmd run dev
```

Mở [http://localhost:3000](http://localhost:3000). Nếu terminal báo cổng khác, dùng địa chỉ dòng **Local**. Không mở hai dev server trong cùng thư mục dự án.

### 7.2. Thử thao tác

1. Mở khóa điện thoại, bảo đảm YouTube đã cài và mở bình thường.
2. Chọn máy thật tại **Thiết bị Android qua ADB**, trạng thái `device`/`READY`, kết nối USB.
3. Nhập `Mở YouTube`, bấm **Phân tích**, kiểm tra Action Plan rồi bấm **Thực thi**.
4. Sau khi mở app thành công, thử `Mở YouTube, tìm nhạc lofi rồi mở video đầu tiên`.
5. Theo dõi tiến trình. Khi sửa lệnh hoặc cập nhật logic tạo kế hoạch, bấm **Phân tích** lại.

Executor kiểm tra action, target, package đã cài và bàn phím trước khi chạy. Nếu một bước lỗi, các bước sau không chạy và có thể giữ `PENDING`.

Backend Appium yêu cầu duy nhất một ô nhập được focus, xóa nội dung cũ rồi nhập và đọc lại chính xác Unicode. Backend ADB giữ hành vi thêm chữ cũ. Không dùng luồng này cho ô mật khẩu. Từ Milestone 2.5, Appium tìm `video_card_N` theo thứ tự video thường trong phiên kết quả tìm kiếm, có bộ nhớ xuyên viewport và kiểm chứng đầu danh sách; ADB cũ vẫn đếm video đang hiển thị. Phần tử chưa đủ điều kiện tương tác không được click. Trường `WAIT_FOR.timeoutMs` vẫn tối đa 30 giây theo schema cũ; riêng Appium `video_list` dùng ngân sách khám phá cấu hình bên dưới.

### 7.3. Trạng thái và Session

- `SUCCESS`: postcondition đã được xác minh, không chỉ gửi lệnh.
- `SENT`: lệnh đã gửi nhưng chưa có postcondition đáng tin cậy; không đồng nghĩa hoàn thành mục tiêu.
- `TIMEOUT`: điều kiện không đạt trong hạn; `UNKNOWN`: thiếu bằng chứng hoặc selector mơ hồ.
- `DEVICE_ERROR`: thiết bị mất kết nối; `SESSION_ERROR`: Session không hợp lệ, socket hang up hoặc thiết bị đã có tác vụ.

Mỗi execution dùng một Session cho đúng serial; đóng Session trước sự kiện `complete`. Appium đọc UI, ADB không dump XML song song. Không có fallback tự động: đổi `ANDROID_EXECUTOR_BACKEND` và khởi động lại Next.js khi không còn execution. Hành động nhạy cảm bị từ chối; chưa có luồng xác nhận để cho phép chúng.

Snapshot có serial, UUID, timestamp, foreground package/activity, nguồn dữ liệu và các phần tử được đọc thật. Target hỗ trợ `id:...`, `text:...`, `accessibility_id:...` và matching theo thuộc tính giao diện. Element ID nội bộ gắn với snapshot, không được tái dùng sau khi UI đổi. Backend kiểm tra lại phần tử native trước click.

Khóa theo serial được lưu tại `%TEMP%\phone-commander-device-locks\<SHA256(serial)>\owner.json`, dùng chung giữa các process. Nếu process bị dừng cưỡng bức hoặc không biết kết quả tạo/đóng Session, khóa được giữ. Khi đó **không xóa khóa ngay**: đọc owner, xác nhận process đã dừng và Session/port forward của serial đã được đóng qua công cụ đã tạo nó. Chỉ sau khi xác minh mới xóa đúng file owner và thư mục khóa trống. Không xóa toàn bộ thư mục khóa hoặc đóng Session của công cụ khác.

## 8. Kiểm tra từng API

### UI Exploration (Milestone 2.5)

Appium tự khám phá danh sách khi `CLICK`/`WAIT_FOR` chưa thấy mục tiêu. Mỗi lần cuộn chỉ diễn ra trên vùng `scrollable` đọc được, sau đó quan sát lại trước bước kế tiếp. Không có số lần swipe bắt buộc, không scroll mù toàn màn hình.

Backend Appium hỗ trợ `video_card_1..99`, `first_result`, `result_N`, `list_item_N`, cùng các selector text/id/accessibility đã có. Alias ordinal có giới hạn N=1..99; ADB cũ vẫn giới hạn video 1..5. Các alias mới là khả năng backend, không chứng minh AI luôn lập được plan đa ứng dụng đúng.

Ordinal bắt đầu từ đầu danh sách đã kiểm chứng qua `scrollGesture`/`canScrollMore`. Danh tính dựa nội dung có thật, không dựa Appium element ID. Nếu thiếu overlap, trùng không phân giải được, thứ tự thay đổi, không biết ranh giới quảng cáo hoặc không có điểm kích hoạt đúng mục tiêu: `AMBIGUOUS`, không click đoán. Card YouTube có thể chứa preview/nút Sản phẩm; executor không mặc định tap tâm card.

| Biến | Mặc định | Phạm vi |
| --- | --- | --- |
| `ANDROID_EXPLORATION_MAX_SCROLLS` | 24 | 0..30, gồm kiểm tra đầu danh sách |
| `ANDROID_EXPLORATION_TIMEOUT_MS` | 120000 | 100..180000ms; CLICK ordinal dùng chung budget cho khám phá và verification; WAIT_FOR video_list dùng ngân sách này thay vì timeout ngắn của AI |
| `ANDROID_EXPLORATION_SCROLL_PERCENT` | 0.35 | 0.1..0.5; mục tiêu khác và bước kiểm tra đầu danh sách |
| `ANDROID_EXPLORATION_EMPTY_VIDEO_SCROLL_PERCENT` | 0.9 | 0.1..0.9; cuộn 90% khi chưa thấy video nào |
| `ANDROID_EXPLORATION_VIDEO_SCROLL_PERCENT` | 0.6 | 0.1..0.6; giảm xuống 60% sau khi đã ghi nhận video đầu tiên |
| `ANDROID_EXPLORATION_SCROLL_SPEED` | 700 | 200..1500px/s, tránh tốc độ fling mặc định |
| `ANDROID_EXPLORATION_MAX_UNCHANGED` | 2 | 1..3 lần quan sát lại, không swipe mù khi UI không đổi |
| `ANDROID_EXPLORATION_SETTLE_TIMEOUT_MS` | 4000 | 100..10000ms chờ điều kiện nội dung thay đổi; vùng chưa thấy video được polling tới deadline còn lại nếu Appium báo vẫn cuộn được |
| `ANDROID_EXPLORATION_MAX_ELEMENTS` | 150 | 5..500 mục trong bộ nhớ goal hiện tại |
| `ANDROID_OBSERVER_IDLE_TIMEOUT_MS` | 1000 | 500..10000ms; setting UiAutomator2 theo Session, không đổi cài đặt Android lâu dài |

Thêm các biến vào `.env.local`, khởi động lại server để đổi cấu hình. Script Node độc lập cần biến môi trường process. Bật giới hạn lớn hơn không sửa được selector/metadata thiếu; xem `docs/ui-exploration-report.md` trước khi coi một goal đã đạt.

Riêng Appium `WAIT_FOR video_list` là tìm video thường qua quảng cáo/thẻ kênh, nên dùng ngân sách khám phá mặc định 120 giây. Các `WAIT_FOR` khác và backend ADB vẫn giữ `timeoutMs` của Action Plan. Tác vụ tổng có giới hạn 300 giây và có thể hủy bằng Dừng. Muốn tăng có giới hạn, đặt `ANDROID_EXPLORATION_TIMEOUT_MS=180000` và `ANDROID_EXPLORATION_MAX_SCROLLS=30`. Mức 90% chỉ áp dụng khi chưa quan sát được video; khi đã ghi nhận video đầu tiên, giảm về 60%. Mục tiêu khác và bước kiểm tra đầu danh sách vẫn dùng mức cơ bản 35%. Quãng cuộn lớn không bảo đảm nhanh hơn hoặc không bỏ sót video ngắn; mất overlap vẫn phải dừng với AMBIGUOUS.

API đã có trong mã, không cần tải/chạy mỗi endpoint riêng. API dự án cần Next.js; API phân tích AI còn cần Ollama.

| Dịch vụ | Phương thức và endpoint | Chức năng |
| --- | --- | --- |
| Ollama, cổng 11434 | `GET /api/tags` | Liệt kê model |
| Ollama, cổng 11434 | `POST /api/chat` | API AI backend gọi |
| Next.js, cổng 3000 | `GET /api/devices` | Thiết bị ADB và thông tin |
| Next.js, cổng 3000 | `GET /api/devices/{serial}/screenshot` | Ảnh PNG màn hình |
| Next.js, cổng 3000 | `POST /api/commands/interpret` | Chuyển lệnh thành kế hoạch |
| Next.js, cổng 3000 | `POST /api/executions` | Thực thi, trả luồng JSON từng dòng |

Mở **PowerShell thứ hai**, giữ terminal Next.js chạy. Sửa `$webUrl` nếu dùng cổng khác:

```powershell
$webUrl = "http://localhost:3000"
Invoke-RestMethod -Uri "$webUrl/api/devices" | ConvertTo-Json -Depth 6
```

`success: true`, `devices: []` nghĩa là API chạy nhưng chưa thấy máy. Lấy serial từ API hoặc `adb devices -l` khi đã kết nối.

Thử phân tích AI; yêu cầu này **chỉ tạo kế hoạch, chưa thao tác điện thoại**:

```powershell
$webUrl = "http://localhost:3000"
$body = @{ prompt = "Mở YouTube" } | ConvertTo-Json
$plan = Invoke-RestMethod -Uri "$webUrl/api/commands/interpret" -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
$plan | ConvertTo-Json -Depth 10
```

Mong đợi `success: true` và `actionPlan.actions` có `OPEN_APP`. Dùng nút **Thực thi** trong web để chọn máy và xem tiến trình; endpoint thực thi sẽ thao tác thật.

Để thử ảnh, mở `http://localhost:3000/api/devices/EXAMPLE_SERIAL/screenshot` trong trình duyệt, thay serial/cổng đúng. Đây là ảnh chụp theo yêu cầu, không phải server stream video riêng.

## 9. Tắt và khởi động lại

### 9.1. Next.js

Nhấn **Ctrl + C** trong terminal chạy `npm.cmd run dev` hoặc `npm.cmd run start`. Đóng tab trình duyệt không dừng server.

Nếu chạy nền, tìm PID; thay cổng nếu khác 3000:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  Select-Object -ExpandProperty OwningProcess -Unique
```

Đối chiếu PID với thông báo Next.js hoặc xem command line:

```powershell
Get-CimInstance Win32_Process -Filter "ProcessId = 3844" |
  Select-Object ProcessId, CommandLine
```

`3844` chỉ là ví dụ. Sau khi xác nhận server cần tắt, dùng **PID thực tế**:

```powershell
taskkill /PID 3844 /F
```

Chạy lại tại thư mục gốc bằng `npm.cmd run dev`.

### 9.2. Ollama và ADB

- Với `ollama serve` trong terminal: nhấn **Ctrl + C** ở terminal đó.
- Với ứng dụng Ollama Windows chạy nền: thoát tại khay hệ thống.
- `ollama stop phone-commander` giải phóng model đang nạp, không tắt dịch vụ.
- Khi không còn công cụ khác cần ADB, dùng `adb kill-server`. Lệnh dừng server ADB dùng chung, ngắt kết nối ADB của công cụ khác.

Nút **Dừng** trên web hủy request và các bước tiếp theo, sau đó backend đóng Session và nhả khóa. Lệnh ADB đã gửi có thể hoàn tất trước khi dừng; tạo Session đang chạy được chờ để lấy ID và cleanup an toàn. Execution giới hạn 5 phút, cleanup có timeout riêng. Ctrl+C ở terminal Appium khi không còn execution để tắt dịch vụ Appium; không tắt Appium giữa tác vụ đang chạy.

## 10. Xử lý lỗi

| Lỗi/hiện tượng | Cách xử lý |
| --- | --- |
| Không nhận diện `node`, `npm`, `adb`, `ollama` | Kiểm tra cài đặt/PATH, mở terminal mới. Thử `npm.cmd` trong PowerShell để tránh lỗi chạy `npm.ps1`. |
| `adb devices -l` trống | Mở khóa máy, bật USB debugging, đổi cáp/cổng; kiểm tra driver USB của hãng. |
| `unauthorized` | Xác nhận quyền trên điện thoại. Nếu không có hộp thoại, rút/cắm lại hoặc thu hồi quyền gỡ lỗi trong Tùy chọn nhà phát triển rồi cấp lại. |
| `offline`, lỗi daemon ADB | Khi không có tác vụ chạy, thử `adb kill-server`, `adb start-server`, cắm lại cáp. |
| `Vietnamese/Unicode input requires ... ADB Keyboard` | Làm mục 4 trên đúng serial; xem `adb -s $serial shell ime list -s`. |
| `INPUT_TEXT requires a focused editable field` | Cần `CLICK` vào ô nhập trước `INPUT_TEXT`; kiểm tra app/hộp thoại cản màn hình. |
| Không kết nối được AI | Kiểm tra API `/api/tags`, mở Ollama, đối chiếu `OLLAMA_BASE_URL`. |
| Model không tồn tại/lỗi phân tích Ollama | Kiểm tra `ollama list`, tạo lại model, đối chiếu `OLLAMA_MODEL`, khởi động lại Next.js. |
| AI xử lý quá thời gian | Thử `ollama run`, chờ lần nạp đầu hoặc tăng `OLLAMA_TIMEOUT_MS`, khởi động lại Next.js. |
| `Timed out ... waiting for video_list` | Kiểm tra kết quả YouTube, mạng, hộp thoại. Phân tích lại để dùng 20 giây. Nếu kết quả đã có, cần đối chiếu XML UIAutomator và selector theo phiên bản app. |
| `Unsupported target`, `Semantic targets require OPEN_APP youtube first` | Phân tích lại; target ngữ nghĩa dành cho YouTube, cần mở app trước. App khác cần selector cụ thể. |
| `App is not installed` | Cài app trên đúng máy; kiểm tra package trong Action Plan. |
| `Cannot verify ... driver/server version` | Kiểm tra `APPIUM_HOME`, driver UiAutomator2 cục bộ và phiên bản APK đã được phê duyệt. Backend không tự sửa/cài APK. |
| `Device is locked`, `Session cleanup failed` | Kiểm tra process trong owner.json và Session Appium; giữ khóa khi chưa chắc đã cleanup. Xem mục 7.3. |
| Chrome có kết quả nhưng observer không tìm thấy | UiAutomator2 có thể không cung cấp WebView trong native hierarchy. Không suy ra kết quả từ URL hoặc ảnh; cần kiểm thử accessibility/WebView riêng. Không click đoán tọa độ. |
| `Another next dev server is already running`, `You can access the existing server ...` | Dùng server có sẵn hoặc tắt đúng PID theo mục 9. Đổi cổng không giải quyết hai dev server cùng thư mục. |
| `[ELIFECYCLE] Command failed with exit code 1` | Đọc lỗi phía trên để tìm nguyên nhân; đây chỉ là thông báo lệnh kết thúc lỗi. |
| `Access is denied` trong môi trường hạn chế | Thử terminal Windows có quyền truy cập dự án; kiểm tra quyền/phần mềm bảo vệ. Công cụ chạy trong sandbox có thể cần quyền ngoài sandbox. |
| Sửa `.env.local` không đổi cấu hình | Khởi động lại, kiểm tra vị trí cùng cấp `package.json` và không có đuôi `.txt`. |

## 11. Kiểm thử và bản build

Tại thư mục gốc sau khi cài dependency:

```powershell
node.exe --test tests/android-executor.test.cjs tests/state-observer.test.cjs tests/ui-exploration.test.cjs tests/milestone25-resolution.test.cjs tests/visual-grounding.test.cjs
npx.cmd tsc --noEmit --incremental false
npm.cmd run lint
```

Unit test dùng mock ADB/Appium/Observer, không cần điện thoại hay Internet. Không coi kết quả mock là bằng chứng thiết bị thật.

Bài thử thật là opt-in, thao tác trên serial bạn chọn. Chỉ chạy tuần tự, giữ điện thoại mở khóa; Chrome/YouTube cần mạng. Không đăng nhập, đăng ký kênh hoặc bật/tắt Wi-Fi:

```powershell
$env:ADB_PATH = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
node tests/android-observer.integration.cjs --serial EXAMPLE_SERIAL --app youtube
node tests/android-observer.integration.cjs --serial EXAMPLE_SERIAL --app chrome
node tests/android-observer.integration.cjs --serial EXAMPLE_SERIAL --app settings
# Cần Next.js và Appium đã chạy cho bài thử streaming/cancellation:
node tests/android-observer-api.integration.cjs --serial EXAMPLE_SERIAL
# Bài thử Milestone 2.5, chạy từng app riêng, tuần tự:
node tests/android-exploration.integration.cjs --serial EXAMPLE_SERIAL --app youtube
node tests/android-exploration.integration.cjs --serial EXAMPLE_SERIAL --app settings
node tests/android-exploration.integration.cjs --serial EXAMPLE_SERIAL --app chrome
# Resolver + Native/Web mới, chỉ chạy một lệnh mỗi lần:
node.exe tests/milestone25.integration.cjs EXAMPLE_SERIAL youtube
node.exe tests/milestone25.integration.cjs EXAMPLE_SERIAL chrome
node.exe tests/milestone25.integration.cjs EXAMPLE_SERIAL settings
# Milestone 2.6: thu bằng chứng khi resolver bị chặn, không tự tap:
node.exe tests/visual-grounding.integration.cjs EXAMPLE_SERIAL
# Giữ Session gốc tối đa 120 giây cho workbench xác nhận local:
node.exe tests/visual-grounding.integration.cjs EXAMPLE_SERIAL --review
```

Report JSON được ghi vào TEMP; không lưu toàn bộ XML hay nội dung trang. Exit code `0` = bài thử đạt, `1` = lỗi, `2` = thiếu tham số hoặc goal bị BLOCKED. Đọc report để phân biệt bước PASS với mục tiêu tổng thể chưa xác minh.

Các script Node cũ không tự tải `.env.local`; nếu dùng URL/backend khác mặc định, đặt `$env:APPIUM_URL` và `$env:ANDROID_EXECUTOR_BACKEND` trong terminal kiểm thử. Riêng `milestone25.integration.cjs` tải `.env.local` bằng `@next/env`. Bài thử API dùng `$env:PHONE_COMMANDER_TEST_URL` khi Next.js không ở cổng 3000. Bài thử snapshot ba app yêu cầu backend Appium. Script resolver mới trả exit code `1` cả khi goal BLOCKED; đọc `outcome`, `error` và `cleanup` trong JSON để phân biệt với lỗi kỹ thuật. JSON bài thử này chứa nhãn UI và URL trang công khai, cần kiểm tra trước khi chia sẻ.

Chạy bản build local thay cho dev: dừng dev server, rồi chạy:

```powershell
npm.cmd run build
npm.cmd run start
```

`start` cần build thành công. Ollama và ADB vẫn phải hoạt động trên máy backend. Build có thể tải font Google từ `next/font`, cần mạng tới dịch vụ font. Host web từ xa không tự thấy điện thoại USB cắm vào máy người dùng.

## 12. Cấu trúc và giới hạn

```text
app/page.tsx                         Dashboard đang chạy
app/api/commands/interpret/route.ts   API phân tích lệnh qua Ollama
app/api/devices/route.ts              API thiết bị
app/api/devices/[serial]/screenshot/  API ảnh màn hình
app/api/executions/route.ts           API thực thi và tiến trình
components/                          Thành phần giao diện
hooks/useDashboardDemo.ts            Kết nối UI/API, có dữ liệu demo
lib/android/adb.ts                   Gọi ADB, đọc thông tin máy
lib/android/executor.ts              Kiểm tra và thực thi action
lib/android/condition-executor.ts    Executor mới, pre/postcondition và backend selection
lib/android/appium/client.ts         HTTP W3C client phía server
lib/android/appium/session-manager.ts Session, khóa serial, kiểm chứng APK và cleanup
lib/android/state-observer.ts        Đọc hierarchy và polling theo điều kiện
lib/android/snapshot.ts              Zod schema snapshot riêng, không đổi Action Plan
lib/android/screen-state.ts          Phân loại UI và kiểm tra viewport
lib/android/ui-understanding.ts      Matching động, từ chối ambiguity/stale selection
lib/android/action-verifier.ts       Postcondition dựa trên bằng chứng UI
lib/android/errors.ts                Phân loại lỗi/cancellation
lib/android/targets.ts               Đọc XML, tìm phần tử giao diện
lib/android/capabilities.ts          Khả năng executor, quy tắc AI
lib/validators/action-plan.schema.ts Schema Action Plan
ollama/Modelfile                     Model phone-commander
tests/android-executor.test.cjs      Kiểm thử executor
tests/state-observer.test.cjs        Unit test observer/session/matching/verifier
tests/android-observer.integration.cjs Bài thử thật 3 ứng dụng, opt-in
tests/android-observer-api.integration.cjs API streaming/lock/cancellation thật, opt-in
types/                              Kiểu dữ liệu TypeScript
apps/web/src/                       Mã bổ sung, không có script chạy riêng ở gốc
```

| Phạm vi | Trạng thái |
| --- | --- |
| Thực thi thật | Android USB, một máy được chọn cho mỗi yêu cầu UI |
| iOS/Wi-Fi để thực thi | Chưa có executor tương ứng trong luồng này |
| Action hỗ trợ | `OPEN_APP`, `CLOSE_APP`, `WAIT_FOR`, `CLICK`, `INPUT_TEXT`, `PRESS_KEY`, `SWIPE` |
| Alias app | `youtube`, `chrome`, `settings`; executor cũng nhận package name hợp lệ |
| Target YouTube | `search_button`, `video_list`, `video_card_1..5`, `subscribe_button`, `like_button`, `comment_button`, `play_button`, `back_button` |
| Selector cụ thể | `id:package:id/name`, `text:Label`, `accessibility_id:Label` |
| Ảnh màn hình | Endpoint riêng; action `SCREENSHOT` trong kế hoạch bị từ chối |
| Hàng đợi, một số log/dashboard | Có dữ liệu demo; chưa có cơ sở dữ liệu lưu lịch sử lâu dài |

`video_list` chỉ để chờ; chọn video bằng `video_card_N`. Selector phụ thuộc giao diện/ngôn ngữ; JSON hợp lệ không bảo đảm thao tác thành công trên mọi phiên bản app. `first_result` chỉ nhận card có URL/title thật trong WebView; từ chối nhóm quảng cáo không xác định được ranh giới.

**Kết quả lịch sử Milestone 2.5, không phải trạng thái nghiệm thu Milestone 3.** Matching/execution có thể dùng UI nhiều app, nhưng System Prompt/Ollama/Action Plan schema không thay đổi và luồng phân tích lệnh cũ vẫn thiên về YouTube. Không tự gỡ cờ `isSensitive=true` khi model gắn nhầm. Chrome/Settings ở giai đoạn 2.5 được kiểm thử bằng plan xác định sẵn, không chứng minh AI đã tự lập kế hoạch tổng quát. Goal Planner đã được bổ sung trong Milestone 3 bên dưới; Recovery đầy đủ và điều phối nhiều device chưa triển khai. Kết quả trước 2.5 ở `docs/state-observer-report.md`; kết quả 2.5 ở `docs/ui-exploration-report.md`.

### Cập nhật Interaction Resolver và Native/Web

Báo cáo hiện hành: [Milestone 2.5: Resolution + Hybrid Observation](docs/milestone-2.5-resolution-report.md). Hai báo cáo observer/exploration phía trên là kết quả lịch sử, không phải bằng chứng chạy lại source hiện tại.

- Resolver kiểm tra nhãn, clickable ancestor, clipping/che khuất có thể quan sát và native element mới trước click. Không chọn tâm card có vùng Sản phẩm/preview khi không có điểm kích hoạt riêng đủ bằng chứng.
- Chrome ưu tiên DOM thật khi có Web Context tương thích. Observer chuyển context trong cùng Appium Session, khóa thao tác dùng chung và khôi phục `NATIVE_APP`. Native fallback có lý do rõ ràng; không gắn nhãn DOM cho XML.
- Policy độc lập trả `ALLOW`, `CONFIRM` hoặc `BLOCK`, kiểm tra cả control thật lúc chạy. AI gắn `isSensitive=true` cho điều hướng vẫn yêu cầu xác nhận; chưa có luồng UI xác nhận an toàn để tự tiếp tục. Không sửa cờ AI, model, prompt hay schema.

ChromeDriver là cấu hình tùy chọn, không được backend tự tải hoặc thay thế. Xác minh phiên bản Chrome đang hoạt động trên điện thoại; chỉ tải driver tương thích từ [Chrome for Testing chính thức](https://googlechromelabs.github.io/chrome-for-testing/). Giải nén bản Windows phù hợp rồi đặt đường dẫn tuyệt đối trong `.env.local`:

```dotenv
APPIUM_CHROMEDRIVER_EXECUTABLE="C:/path/to/chromedriver.exe"
```

Khởi động lại Next.js sau khi đổi cấu hình, chạy bài thử Chrome riêng và kiểm tra `DOM_AVAILABLE`, context và `cleanup` trong report. File không tồn tại bị từ chối trước khi tạo Session. Driver của máy kiểm thử đã ghim theo Chrome `155.0.8059.39`; không dùng số phiên bản này cho điện thoại khác khi chưa đối chiếu. Không cần cài/gỡ APK để đổi ChromeDriver. Nếu chưa cấu hình hoặc không tương thích, native observation vẫn được hỗ trợ nhưng nội dung web có thể thiếu và goal có thể BLOCKED.

### Milestone 2.6: Visual Grounding

[Báo cáo Visual Grounding](docs/milestone-2.6-visual-grounding-report.md) mô tả phần đối chiếu hình học đã triển khai; **chưa có AI Vision**. Không tải model mới hoặc dùng Qwen text-only để phân tích ảnh.

Khi target đã được xác định nhưng thiếu activation evidence, backend mới chụp ảnh theo cặp, kiểm tra hierarchy/foreground/orientation/inset/scale và trả `visual` trong step bị chặn. Ảnh chỉ lưu/gửi vùng target; không lưu XML nguyên bản. Ảnh thay đổi, ảnh trống, bounds sai, target cạnh tranh hoặc trạng thái mới không chứng minh ordinal cũ đều không được cấp quyền tap. Screenshot giới hạn 6 lần/execution, mỗi lần collect hoặc revalidation tối đa 20 giây.

`--review` in `REVIEW_URL` cho một workbench riêng trên `127.0.0.1`, cổng ngẫu nhiên. Mở URL đó trong trình duyệt khi terminal còn chạy, chọn điểm trên ảnh mục tiêu rồi xác nhận hoặc Hủy. Backend giữ đúng Session đang có, kiểm tra lại pixels/hierarchy và policy trước nhấn; token chỉ dùng một lần và hết hạn sau 120 giây. Giữ điện thoại mở khóa, không cuộn/đổi app khi xác nhận. Không chạy bài thử khác cùng lúc. Ctrl+C hủy và cleanup. Dữ liệu ảnh giữ local, không gửi tới Ollama/dịch vụ Vision.

Không có `--review`: report và `target.png`, `evidence.json`, `review.html` được ghi vào thư mục TEMP `phone-commander-m26-*`, sau đó đóng Session. `review.html` lưu offline chỉ để xem ảnh/vùng candidate; **không thể dùng ảnh đó nhấn lại sau khi Session đã đóng**. Workbench chưa tích hợp như một luồng resume trong Dashboard; execution API hiện vẫn đóng Session khi step thất bại. Không gửi tọa độ cũ vào execution mới.

Script Visual Grounding trả exit code `1` cho FAIL/cleanup failure, `2` cho BLOCKED/SENT/chưa kiểm thử và `0` cho goal PASS hoặc người dùng Hủy/QA kết thúc. Exit code `0` do Hủy hoặc QA không phải bằng chứng video đã mở; luôn đọc `mode`, `outcome` và `cleanup` trong report.

Hiện grounded tap được kiểm thử tự động với mock; luồng chọn/xác nhận/hủy được kiểm tra trên browser ở chế độ QA không tác động điện thoại. Mục tiêu YouTube mở đúng video thứ hai chưa được nghiệm thu bằng tap thật có xác nhận. Chrome và Settings đã PASS hồi quy thật. Không coi nền tảng hình học này là agent hiểu nội dung ảnh tự động.

### Milestone 3: Goal Agent

Chọn tab **Goal Agent** trong bảng điều khiển lệnh, chọn một điện thoại USB rồi nhập mục tiêu. Ví dụ:

- `Mở Chrome, tìm công thức nấu phở và mở kết quả đầu tiên.`
- `Mở Settings và tìm mục Thông tin điện thoại.`
- `Mở YouTube, tìm podcast tiếng Anh và phát video thứ hai.`

Nhấn **Chạy Agent**. Backend lập các điều kiện cần xác minh, đọc trạng thái thật và chọn từng thao tác qua Executor hiện có; không tạo chuỗi action cố định. Bảng hiển thị mục tiêu con, trạng thái, lý do ngắn và bộ đếm. **Hủy** gửi cancellation về backend; không có nút Pause/Resume giả lập. Hàng đợi demo cũ chưa phải lịch sử Goal Agent.

Agent yêu cầu `ANDROID_EXECUTOR_BACKEND=appium` và tái sử dụng một Session cho toàn bộ goal. Giữ nguyên `OLLAMA_BASE_URL`, `OLLAMA_MODEL` hiện có; không tải hoặc đổi model. Rules TypeScript xử lý tình huống rõ ràng, nhánh chưa rõ mới gọi `/api/chat` với prompt/schema nội bộ riêng. Luồng Action Plan và prompt phân tích cũ giữ nguyên.

Giới hạn mặc định cho mỗi goal: 240 giây, 18 bước, 120 lần đọc snapshot native/DOM, 24 lần cuộn, 4 reasoning (gồm planning), 2 retry, 2 replan, 40 vòng. Không nhận lệnh shell/ADB/JavaScript từ model. Sensitive, ambiguous và activation không đủ bằng chứng vẫn bị chặn.

API riêng: `POST /api/agent`, body `{"deviceId":"EXAMPLE_SERIAL","goal":"Mở Settings"}`. Response NDJSON gồm các event `progress` và một event cuối `complete`; chỉ `COMPLETED` sau kiểm chứng mới là thành công. Payload thêm trường không được hỗ trợ bị từ chối. Mỗi thiết bị chỉ cho một execution; chồng lấn trả 409.

```powershell
node.exe --test tests/android-executor.test.cjs tests/state-observer.test.cjs tests/ui-exploration.test.cjs tests/milestone25-resolution.test.cjs tests/visual-grounding.test.cjs tests/agent.test.cjs
# Các bài thử thiết bị thật phải chạy tuần tự, không đồng thời với Dashboard:
node.exe tests/agent.integration.cjs EXAMPLE_SERIAL chrome
node.exe tests/agent.integration.cjs EXAMPLE_SERIAL settings --fresh
node.exe tests/agent.integration.cjs EXAMPLE_SERIAL youtube --fresh
node.exe tests/agent-api.integration.cjs EXAMPLE_SERIAL
```

`--fresh` là opt-in đóng app trước bài thử để trở về trạng thái ban đầu, không xóa dữ liệu; thao tác chuẩn bị này không phải quyết định Agent. Báo cáo JSON của các bài thử được ghi vào thư mục TEMP.

Kết quả lịch sử lượt Milestone 3 ngày 14/10/2026: 168/168 unit tests, 4/4 API Agent và 7/7 API hồi quy PASS. Chrome và Settings COMPLETED trên máy thật; YouTube BLOCKED ở vùng kích hoạt video thứ hai. Ollama không phản hồi trong đợt M3; xem cập nhật M3.1 bên dưới cho kết quả sau khôi phục. Chưa có Vision Model; human assistance hiện là hợp đồng an toàn **không resumable**, đóng Session và không cấp quyền tap. Xem [báo cáo Milestone 3](docs/milestone-3-agent-report.md) để biết bằng chứng giai đoạn đó.

### Milestone 3.1: Ollama Thật (Kết Quả Lịch Sử)

Ollama đã hoạt động lại tại host/model hiện có. Agent bổ sung telemetry cho load, token, inference, timeout/JSON/HTTP failure và schema reasoning theo target có bằng chứng. Context reasoner được rút gọn, không gửi ảnh hoặc giá trị ô nhập/tab riêng tư; native tab overview không tự attach DOM. Goal tìm kiếm độc lập `Mở Chrome, tìm công thức nấu phở.` được hỗ trợ; không tự bỏ yêu cầu mở kết quả của goal khác.

**Chưa nghiệm thu M3.1 end-to-end.** Qwen thật đã nhận snapshot Android và trả JSON hợp lệ, nhưng model vẫn chọn hỗ trợ hoặc đề xuất bị policy chặn. Chưa có goal COMPLETED với action do model chọn rồi được verifier xác minh. Settings hồi quy rules-only COMPLETED; Chrome mở kết quả chưa tái nghiệm thu, không coi tìm kiếm xong là hoàn thành toàn bộ goal. Xem [báo cáo M3.1](docs/milestone-3.1-real-reasoning-report.md).

Probe chỉ có trong `next dev`, không nhận prompt/model/URL do client đưa vào:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/agent/diagnostics -ContentType application/json -Body '{"chat":true}'
node.exe tests/agent-reasoning.integration.cjs --probe
# Bài thật opt-in, chạy riêng một Session, không đồng thời với Dashboard:
node.exe tests/agent-reasoning.integration.cjs EXAMPLE_SERIAL --overview --run --search-only
# Thêm tests/agent-reasoning.test.cjs vào lệnh unit ở trên.
```

`--overview` mở nút chọn tab có evidence native hoặc giữ overview nếu đã có; không tạo/đóng/chọn tab. Setup không phải action model. `--search-only` khai báo ngay từ đầu goal chỉ tìm kiếm, không biến goal mở kết quả thất bại thành PASS. Script trả nonzero nếu chưa COMPLETED với reasoning thật; đọc report thay vì chỉ nhìn việc UI đã mở.

### Milestone 3.1.1: Grounded AI Decision

Kết quả mới thay cho trạng thái nghiệm thu M3.1 phía trên: **Qwen thật đã chọn candidate BACK từ Chrome tab overview, Executor thực hiện, Verifier xác minh và goal tìm công thức phở rồi mở kết quả đầu tiên COMPLETED 3/3 trên Android thật.** Xem [báo cáo M3.1.1](docs/milestone-3.1.1-grounded-decision-report.md) cho manifest, decision, token, timing và artifact.

Model chỉ chọn candidate ID gắn snapshot/subgoal hoặc OBSERVE_AGAIN/ABSTAIN; backend tạo action từ UI thật, kiểm tra policy, đọc lại state và xác minh hậu điều kiện. Không gửi full XML/ảnh tới Qwen, không đổi model, public Action Plan schema hay prompt phân tích cũ. Dùng tab **Goal Agent** cho goal-based execution; tab Action Plan giữ luồng cũ.

Chrome verifier đã phân loại nguồn đọc snapshot và xác minh redirect bằng Navigation Timing/canonical/hreflang thật, không tăng budget 120. OpenAI đã COMPLETED trên bản cuối với 31 snapshot, DOM_VERIFY giảm 94 xuống 1; một lượt recheck khác BLOCKED do title/content chưa khớp và được giữ trong báo cáo. Không coi mọi lượt hồi quy Chrome đều PASS. YouTube vẫn chưa giải quyết activation evidence; chưa có Vision, Dashboard resume hoặc Milestone 4.

```powershell
# Dịch vụ/cấu hình như các mục cài đặt ở trên. Chạy tuần tự trên một máy mở khóa:
node.exe tests/agent-reasoning.integration.cjs --probe
# Goal đầy đủ; harness yêu cầu model thật chọn action VERIFIED và goal COMPLETED:
node.exe tests/agent-reasoning.integration.cjs EXAMPLE_SERIAL --overview --run
# Chỉ hồi quy goal, không phải bằng chứng model-action:
node.exe tests/agent-reasoning.integration.cjs EXAMPLE_SERIAL --run --rules-regression --goal 'Mở Chrome, tìm OpenAI và mở kết quả đầu tiên.'
# Unit không tác động thiết bị:
node.exe --test tests/android-executor.test.cjs tests/state-observer.test.cjs tests/ui-exploration.test.cjs tests/milestone25-resolution.test.cjs tests/visual-grounding.test.cjs tests/agent.test.cjs tests/agent-reasoning.test.cjs tests/action-candidates.test.cjs
```

Không chạy harness cùng Dashboard execution. Report JSON lưu ở TEMP; đọc `mode`, `status`, action `verification`, reasoning metadata và cleanup, không chỉ nhìn exit code. `--dom-trace` tùy chọn ghi URL/title/H1 local để chẩn đoán trang công khai; không gửi tới model và cần kiểm tra dữ liệu trước chia sẻ. Bản mới có 191/191 unit và 11/11 API PASS; phạm vi nghiệm thu/hạn chế được tách rõ trong báo cáo.

### Milestone 3.2: Multi-Candidate Reasoning

**Đã nghiệm thu lựa chọn nhiều candidate bằng Qwen thật trong Settings:** chọn Search thay vì cuộn, rồi chọn mục Bộ nhớ thay vì cuộn tiếp; hai click VERIFIED và goal COMPLETED 2/2. Bài này đọc màn hình **RAM 4 GB**, không phải chứng minh dung lượng lưu trữ flash. Manifest có preconditions, safety, verification và goalRelation; model chỉ chọn ID, không tự viết selector/action. Backend kiểm tra policy và state trước dispatch.

Trong tab **Goal Agent**, dùng `Mở Cài đặt và tìm nơi xem dung lượng bộ nhớ.`. Giữ điện thoại mở khóa và không thao tác đồng thời. Profile Settings/Search/Device Care giới hạn trong navigation/read goal; không dọn RAM, reset hoặc đổi cài đặt. Các topic mới chưa có verifier không tự COMPLETE khi chỉ thấy label.

Chrome tìm hướng dẫn Python trên Windows và mở kết quả đầu tiên đã COMPLETED 3/3; verifier xử lý hậu tố hostname trong title khi URL/canonical/navigation/title/H1 có đủ bằng chứng. OpenAI và Settings cũ hồi quy PASS. YouTube vẫn BLOCKED do mất overlap/ordinal continuity trước khi xác minh activation video thứ hai. Không coi multi-candidate Chrome/YouTube đã được kiểm thử chỉ vì rules-only hoặc unit mock PASS.

```powershell
# Chạy tuần tự, thay EXAMPLE_SERIAL bằng serial thật:
node.exe tests/agent-candidates.integration.cjs EXAMPLE_SERIAL settings --run --require-multi
node.exe tests/agent-candidates.integration.cjs EXAMPLE_SERIAL chrome --run
node.exe tests/agent-candidates.integration.cjs EXAMPLE_SERIAL youtube --run
# Thêm tests/multi-candidates.test.cjs và tests/browser-title-evidence.test.cjs vào lệnh unit ở trên.
```

Kết quả: 205/205 unit, 11/11 API, TypeScript và lint phần sửa PASS. [Báo cáo Milestone 3.2](docs/milestone-3.2-multi-candidate-report.md) có candidate ID/snapshot/decision thật, thời gian/token, các lượt BLOCKED và giới hạn. `--require-multi` chỉ PASS khi có lựa chọn thật giữa các role khác nhau, action VERIFIED và goal COMPLETED; không có scene đủ evidence thì NOT TESTED/BLOCKED. Report ở TEMP cần kiểm tra trước chia sẻ. Không triển khai Milestone 4, không đổi model hoặc public Action Plan schema/prompt cũ.

### Autonomous Task Completion V1

Trong Dashboard, chọn **Goal Agent**, chọn một Android USB đã cấp quyền, nhập mục tiêu rồi nhấn **Chạy Agent**. Không có điện thoại vẫn mở được Dashboard và chạy unit tests, nhưng không thể thực thi hoặc nghiệm thu Android. Không chạy harness đồng thời với Dashboard.

Các câu mục tiêu được hỗ trợ:

- `Tìm hướng dẫn cài đặt Python trên Windows và mở bài hướng dẫn đầu tiên phù hợp.`
- `Mở Cài đặt và xem dung lượng lưu trữ còn trống của điện thoại.`
- `Tìm podcast tiếng Anh và phát video thông thường thứ hai.`

Chrome và lưu trữ có lượt Dashboard thật thành công trước đó. Lưu trữ khác RAM: nếu UI chỉ có tổng/đã dùng, kết quả còn trống được ghi rõ là phép tính xấp xỉ. **YouTube vẫn chưa nghiệm thu video thứ hai**, không coi tìm kiếm xong là đã phát.

Khi có ảnh hỗ trợ hợp lệ, chọn vùng phát trên ảnh rồi nhấn **Xác nhận vùng phát**. Backend chỉ tiếp tục cùng Session sau khi kiểm tra lại màn hình và policy; xác nhận hết hạn tối đa sau 120 giây hoặc khi hết ngân sách goal. Nút **Hủy** hủy tác vụ đang chạy/chờ và backend đóng Session. Không dùng xác nhận vùng phát để chấp thuận đăng nhập, thanh toán hay thao tác nhạy cảm. Nếu chưa chứng minh được thứ tự video hoặc ảnh không ổn định, Agent vẫn dừng an toàn, không click đoán.

Cập nhật offline 15/10/2026: 215/215 regression tests PASS; các sửa đổi sau khi mất kết nối chưa được kiểm thử lại trên điện thoại. Luồng hỗ trợ đã được kiểm tra bằng mock/API unit, chưa phải bằng chứng resume thật trên Android. Xem [báo cáo sản phẩm và giới hạn](docs/autonomous-task-completion-report.md) để phân biệt kết quả thật, mô phỏng và những phần chưa đạt.

### Milestone 5: Multi-Device Agent

Dashboard hiện theo dõi Agent qua worker Node cục bộ, độc lập với HTTP stream và Next.js hot reload. Cài đủ dependencies (kể cả TypeScript), giữ Appium/Ollama chạy như phần cài đặt ở trên, rồi chạy `npm run dev`. Worker tự khởi động khi Dashboard đọc runtime; không dùng `--session-override` cho Appium. Không đổi model cho từng điện thoại.

Trong **Goal Agent**:

- Chọn thiết bị trong dropdown, nhập mục tiêu và bấm **Chạy Agent** để giao riêng.
- Đánh dấu nhiều thiết bị USB trong lưới rồi bấm **Chạy nhóm** để gửi cùng mục tiêu. Mỗi máy có execution riêng.
- Đổi thiết bị đang xem để nhập mục tiêu khác; máy đang chạy không khóa các máy còn lại.
- Theo dõi trạng thái, recovery và verification trên từng thẻ/lịch sử. **Hủy** chỉ hủy execution đó; **Hủy nhóm** hủy các execution thuộc cùng batch.
- Human Assistance hiển thị serial và chỉ xác nhận cho execution đang xem. Ảnh được tải theo yêu cầu, không nhúng lại vào mọi lần polling.
- Reload hoặc đóng tab không hủy task. Muốn dừng phải dùng nút hủy; không tự resume thao tác sau khi worker bị restart.

Worker có thể chạy thủ công để xem lỗi:

```powershell
npm run agent:worker
# Terminal khác:
npm run dev
```

Khi dừng dự án hoặc nạp lại code worker: dừng Next.js trước bằng `Ctrl+C`, sau đó chạy `npm run agent:worker:stop`. Lệnh stop yêu cầu worker hủy các task còn hoạt động và cleanup Session. Dừng Next.js đơn lẻ không dừng worker. Không kill Appium/Ollama để hủy một thiết bị.

Worker lưu địa chỉ/token và journal trong thư mục TEMP riêng theo dự án; không chia sẻ token. Journal không lưu ảnh/XML hoặc token Human Assistance. Sau hard crash, task cũ thành BLOCKED; kiểm tra Session/ADB forward/device lock trước khi chạy mới, không tự xóa lock đang có chủ sở hữu chưa rõ.

Giới hạn hiện tại: Android USB đã cấp quyền; tối đa 4 execution chủ động, mục tiêu kiểm thử 2 máy. Qwen xử lý 1 request tại một thời điểm, queue tối đa 16 request chờ. Preview máy chọn cập nhật khoảng 4 giây, máy không chọn khoảng 20 giây; trang ẩn tạm dừng preview. Đây là ảnh ADB nén, không phải video stream.

Chi tiết kết quả thật/mô phỏng và file thay đổi: [báo cáo Milestone 5](docs/milestone-5-multi-device-report.md). Một Samsung thật đã kiểm tra reload và hủy riêng; không coi đây là nghiệm thu hai điện thoại thật chạy song song.

### Mở Rộng Nhiều Ứng Dụng Native

Dùng tab **Goal Agent**, chọn Android thật rồi nhập `Mở <ứng dụng>` hoặc `Mở <package> và tìm <nhãn>`. Agent phân giải launcher bằng Package Manager của đúng điện thoại, không đoán package của hãng khác. Camera, Calendar, Calculator và Gallery thử dùng intent/category Android chuẩn; nếu máy không công bố mặc định hoặc có nhiều lựa chọn, dùng package chính xác. Tên khác chỉ được khớp theo token package duy nhất trong danh sách launcher, không phải nhận diện đầy đủ tên hiển thị ứng dụng.

Ví dụ đã kiểm tra trên Samsung hiện tại: `Mở com.sec.android.app.popupcalculator`. Có thể dùng `Mở <package> và mở trang <nhãn>` cho trang/tab đọc được nhận diện từ UI thật, như Albums/Library/History/About/Giờ quốc tế. Nút phải có ngữ nghĩa điều hướng đọc, target duy nhất và bằng chứng mới; backend kiểm tra lại trước click rồi xác minh heading đích. Tên tab hiện trên màn hình chưa đủ để báo đã mở trang. Khi chưa thấy target, Agent chỉ cuộn trong vùng native đã xác định, có giới hạn ngân sách.

Đây là mở rộng **mở app, tìm phần tử và điều hướng đọc native**, chưa phải điều khiển mọi chức năng của mọi ứng dụng. Gửi tin, chụp/lưu ảnh, tạo báo thức, đăng nhập, thanh toán, xóa dữ liệu hoặc cấp quyền chưa được tự động cho phép. Không có Vision adapter mới; UI chỉ có hình/canvas/WebView không được click đoán. Action Plan cũ giữ nguyên schema/phạm vi; dùng Goal Agent cho luồng mở rộng này.

Xem [báo cáo multi-app và giới hạn kiểm chứng](docs/multi-application-report.md). Code worker thay đổi cần nạp lại lúc không có execution đang chạy; không cần đổi/tải model.

Kiểm chứng bổ sung trên Samsung đã mở khóa: `Mở com.sec.android.app.clockpackage và mở trang Giờ quốc tế` đã COMPLETED 2/2 trong 19,685 giây, một click có grounding, xác minh trang đích và không tạo/thay đổi báo thức. Lượt này không cần gọi Qwen; không coi đây là nghiệm thu reasoning AI trên mọi ứng dụng hoặc nhiều hãng Android.
