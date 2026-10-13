# Phone Commander - Hệ thống điều khiển điện thoại

Ứng dụng web chuyển câu lệnh tiếng Việt thành kế hoạch thao tác, rồi thực thi trên Android qua ADB. AI chạy bằng Ollama trên máy tính; giao diện và các API dự án chạy cùng một server Next.js.

Tài liệu dành cho **Windows, dùng PowerShell**. Với CMD, dùng `cd /d "ĐƯỜNG_DẪN_DỰ_ÁN"` thay cho `Set-Location`. Các đoạn có `$serial`, `$body`, `Invoke-RestMethod` cần PowerShell.

## Mục lục

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

Dự án dùng Next.js `16.4.0`, React `19.3.0`, TypeScript và Tailwind CSS. Package Next.js yêu cầu Node.js tối thiểu `20.9.0`; cài mới nên chọn bản LTS còn được hỗ trợ trên trang tải chính thức. Dependency còn lại được npm cài từ lockfile.

Cần điện thoại Android, cáp USB truyền dữ liệu và Internet để tải công cụ/model. Điện thoại cần mạng để dùng YouTube. Tốc độ AI phụ thuộc máy tính; lần tải và phân tích đầu tiên có thể lâu hơn các lần sau.

Với cấu hình local này, không cần OpenAI API key, Google API key, Appium hoặc cơ sở dữ liệu riêng.

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

Công cụ này được **cài trên điện thoại**, không phải package npm. Cần khi nhập Unicode, tiếng Việt có dấu, xuống dòng hoặc chuỗi nguyên văn `%s`. ASCII thông thường dùng `adb shell input text`.

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
```

| Biến | Ý nghĩa | Mặc định trong mã |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | Địa chỉ gốc Ollama, không thêm `/api/chat` | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Model phân tích lệnh | `phone-commander` |
| `OLLAMA_TIMEOUT_MS` | Thời gian tối đa chờ AI, mili giây | `180000` = 3 phút |

Máy chậm có thể tăng timeout, ví dụ `300000`. Đây là timeout AI, khác `timeoutMs` của `WAIT_FOR` trên điện thoại. Sửa môi trường xong cần khởi động lại Next.js. `.env.local` đã được `.gitignore` loại khỏi Git.

## 7. Chạy và sử dụng dự án

### 7.1. Thứ tự khởi động mỗi lần dùng

| Thành phần | Lệnh/thao tác | Giữ terminal mở? |
| --- | --- | --- |
| ADB | Cắm điện thoại, `adb start-server`, `adb devices -l` | Không; server chạy nền |
| Ollama | Mở ứng dụng hoặc chạy `ollama serve` | Có nếu dùng `ollama serve` |
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

`INPUT_TEXT` cần ô nhập được focus, thêm chữ vào nội dung hiện có; ô che mật khẩu không thể xác minh theo cách hiện tại. `video_card_N` đánh số video đang hiển thị, không phải toàn bộ kết quả qua nhiều lần cuộn. AI được hướng dẫn dùng `WAIT_FOR` 20 giây, tối đa hợp lệ 30 giây.

## 8. Kiểm tra từng API

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

Nút **Dừng** trên web hủy luồng phía giao diện, không tắt Next.js/Ollama. Lệnh ADB đang chạy có thể hoàn tất trước khi executor ngừng các bước tiếp theo.

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
| `Another next dev server is already running`, `You can access the existing server ...` | Dùng server có sẵn hoặc tắt đúng PID theo mục 9. Đổi cổng không giải quyết hai dev server cùng thư mục. |
| `[ELIFECYCLE] Command failed with exit code 1` | Đọc lỗi phía trên để tìm nguyên nhân; đây chỉ là thông báo lệnh kết thúc lỗi. |
| `Access is denied` trong môi trường hạn chế | Thử terminal Windows có quyền truy cập dự án; kiểm tra quyền/phần mềm bảo vệ. Công cụ chạy trong sandbox có thể cần quyền ngoài sandbox. |
| Sửa `.env.local` không đổi cấu hình | Khởi động lại, kiểm tra vị trí cùng cấp `package.json` và không có đuôi `.txt`. |

## 11. Kiểm thử và bản build

Tại thư mục gốc sau khi cài dependency:

```powershell
node --test tests/android-executor.test.cjs
npx.cmd tsc --noEmit --incremental false
npm.cmd run lint
```

Kiểm thử executor dùng ADB giả lập, không cần điện thoại và không thao tác thiết bị thật. Selector thực tế cần kiểm tra trên phiên bản YouTube của máy.

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
lib/android/targets.ts               Đọc XML, tìm phần tử giao diện
lib/android/capabilities.ts          Khả năng executor, quy tắc AI
lib/validators/action-plan.schema.ts Schema Action Plan
ollama/Modelfile                     Model phone-commander
tests/android-executor.test.cjs      Kiểm thử executor
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

`video_list` chỉ để chờ; chọn video bằng `video_card_N`. Một tiến trình server giữ khóa tránh hai kế hoạch đồng thời trên cùng máy. Selector phụ thuộc giao diện/ngôn ngữ; JSON hợp lệ không bảo đảm thao tác thành công trên mọi phiên bản app.
