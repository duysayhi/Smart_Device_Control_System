import { z } from "zod";
import { queuedOllamaFetch } from '@/lib/android/agent/worker-client';
import { androidCapabilityPrompt, validateAndroidPlan, planChromeCommand } from '@/lib/android/capabilities';
import { planWifiOff, planWifiOn, planWifiNavigation, planWifiConnection } from '@/lib/android/wifi-plan';
import { isLocalMutation } from '@/lib/android/agent/request-origin';
import { assertSafeSource } from '@/lib/android/safety-envelope';
import { issuePlanAuthorization } from '@/lib/android/action-plan-authorization';
import { listAndroidDevices } from '@/lib/android/adb';
import {
  ActionPlanBaseSchema,
  ActionPlanSchema,
} from "@/lib/validators/action-plan.schema";


export const LegacyInterpretRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  deviceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/).optional(),
}).strict();

const OllamaResponseSchema = z.object({
  message: z.object({
    content: z.string(),
  }),
});

export async function handleLegacyInterpret(request: Request) {
  if (!isLocalMutation(request)) return Response.json({ success: false, error: 'Same-origin JSON request required.' }, { status: 403 });
  // 1. Nhận và kiểm tra câu lệnh
  const body = await request.json().catch(() => null);

  const input = LegacyInterpretRequestSchema.safeParse(body);

  if (!input.success) {
    return Response.json(
      { success: false, error: "Câu lệnh không hợp lệ" },
      { status: 400 }
    );
  }

  try {
    assertSafeSource(input.data.prompt);
    const identity = input.data.deviceId ? (await listAndroidDevices()).find(d => d.serial === input.data.deviceId && d.status === 'device' && d.identityVerified && d.physicalId) : undefined;
    if (input.data.deviceId && !identity?.physicalId) return Response.json({ success: false, error: 'Selected device identity is unavailable; no execution authorization issued.' }, { status: 409 });
    const respondPlan = (actionPlan: z.infer<typeof ActionPlanSchema>) => Response.json({ success: true, actionPlan,
      ...(identity?.physicalId ? { authorizationToken: issuePlanAuthorization(identity.serial, identity.physicalId, input.data.prompt, actionPlan) } : {}) });
    const backend = process.env.ANDROID_EXECUTOR_BACKEND ?? 'appium';
    if (backend !== 'adb' && backend !== 'appium') {
      return Response.json({ success: false, error: 'ANDROID_EXECUTOR_BACKEND must be appium or adb.' }, { status: 500 });
    }
    const dynamicUi = backend === 'appium';
    const wifiPlan = planWifiOff(input.data.prompt) ?? planWifiOn(input.data.prompt) ?? planWifiNavigation(input.data.prompt) ?? planWifiConnection(input.data.prompt);
    if (wifiPlan) {
      if (!dynamicUi) return Response.json({ success: false, error: 'Wi-Fi control requires Appium.' }, { status: 422 });
      return respondPlan(wifiPlan);
    }
    try {
      const chromePlan = planChromeCommand(input.data.prompt);
      if (chromePlan) {
        if (!dynamicUi) return Response.json({ success: false, error: 'Chrome search/result navigation requires Appium.' }, { status: 422 });
        validateAndroidPlan(chromePlan.actions, true);
        return respondPlan(chromePlan);
      }
    } catch (error) {
      return Response.json({ success: false, error: error instanceof Error ? error.message : 'Invalid browser request.' }, { status: 422 });
    }
    const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 180000);

    // 2. Gọi Ollama
    const response = await queuedOllamaFetch(
      `${process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"}/api/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]),
        body: JSON.stringify({
          model: process.env.OLLAMA_MODEL ?? "phone-commander",
          stream: false,
          format: z.toJSONSchema(ActionPlanBaseSchema),
          options: {
            temperature: 0,
          },
          messages: [
            {
              role: "system",
              content: `
Bạn là AI Command Interpreter của hệ thống Phone Commander.

NHIỆM VỤ
Chuyển câu lệnh tiếng Việt của người dùng thành Action Plan JSON để điều khiển điện thoại.
Kế hoạch phải đầy đủ, đúng thứ tự và không có thao tác dư.

1. QUY TẮC CHUNG
- Một câu lệnh có thể có nhiều hành động; phải làm đủ, không bỏ hành động cuối.
- Chỉ dùng các action trong JSON Schema. Không tự tạo action mới (PLAY_VIDEO, SEARCH...).
- Không tạo lệnh shell, ADB hay mã thực thi.
- Không thêm thao tác ngoài yêu cầu của người dùng.
- Người dùng có thể gõ sai chính tả; hiểu theo nghĩa đúng (ví dụ "podcasr" = "podcast").
- Chỉ trả về MỘT JSON object hợp lệ, không giải thích, không Markdown.

2. CẤU TRÚC
{"intent":"snake_case_tieng_anh","isSensitive":false,"actions":[...]}
- intent: mục đích tổng thể, ngắn gọn.
- isSensitive: xem mục 6.

3. QUY TẮC TỪNG ACTION
- OPEN_APP / CLOSE_APP: bắt buộc app.
- CLICK: bắt buộc target, lấy từ danh mục mục 5.
- INPUT_TEXT: bắt buộc text; giữ đúng nội dung cần nhập (đã sửa chính tả).
- PRESS_KEY: key chỉ là HOME, BACK, ENTER, VOLUME_UP, VOLUME_DOWN.
- SWIPE: direction chỉ là up, down, left, right.
- WAIT_FOR: bắt buộc cả target và timeoutMs (số nguyên 1..30000). Không bao giờ thiếu target.
  WAIT_FOR chỉ chờ, không thay thế CLICK.
- SCREENSHOT: không tạo action này; ảnh chụp dùng endpoint riêng.

4. QUY TẮC TRÌNH TỰ (BẮT BUỘC)
a) Coi cả câu lệnh là một quy trình liên tục. Sau OPEN_APP, app vẫn mở cho đến hết kế hoạch;
   tìm kiếm, mở video, chuyển trang KHÔNG làm app đóng.
   Mỗi app chỉ OPEN_APP tối đa một lần, ở đầu kế hoạch.
   Chỉ OPEN_APP lại khi người dùng yêu cầu chuyển sang app khác.
b) Không có hai action liên tiếp giống hệt nhau.
c) Muốn nhập chữ: YouTube CLICK search_button; Chrome CLICK address_bar trước INPUT_TEXT.
d) Sau INPUT_TEXT tìm kiếm: PRESS_KEY ENTER. YouTube dùng WAIT_FOR video_list;
   Chrome xác minh kết quả sau ENTER và dùng first_result hoặc result_N khi được yêu cầu. Không dùng video_list cho Chrome.
e) WAIT_FOR chỉ đặt ngay trước CLICK đầu tiên trên một màn hình mới
   (sau mở app, sau ENTER tìm kiếm, sau khi chọn video).
   WAIT_FOR đúng phần tử sắp được CLICK. Không đặt WAIT_FOR sau mọi bước.
f) Muốn tương tác với video (đăng ký, thích, bình luận): phải mở video trước.

5. DANH MỤC ĐƯỢC PHÉP
app: youtube, chrome, settings
target:
- search_button, video_list
- video_card_N (video thứ N trong danh sách; giới hạn theo danh mục executor bên dưới)
- subscribe_button, like_button, comment_button
- play_button, back_button
- Chrome Appium: address_bar, first_result, result_1..99 (bài viết/kết quả thứ N).
Không tự bịa app hoặc target. Phần yêu cầu nằm ngoài danh mục thì bỏ qua,
chỉ tạo các bước nằm trong danh mục.

6. QUY TẮC AN TOÀN
isSensitive = true nếu kế hoạch có BẤT KỲ thao tác nào thay đổi tài khoản hoặc dữ liệu:
đăng ký kênh, thích, bình luận, gửi tin nhắn, đăng bài, mua hàng, thanh toán, xóa, đổi cài đặt.
Chỉ mở app / tìm kiếm / xem video thì isSensitive = false.
Không giả định thao tác đã thực thi thành công trên thiết bị.

7. VÍ DỤ
Người dùng: "Mở YouTube, tìm podcast tiếng Anh, chọn video thứ 2 và đăng ký kênh"
{"intent":"search_podcast_and_subscribe","isSensitive":true,"actions":[
{"type":"OPEN_APP","app":"youtube"},
{"type":"WAIT_FOR","target":"search_button","timeoutMs":20000},
{"type":"CLICK","target":"search_button"},
{"type":"INPUT_TEXT","text":"podcast tiếng Anh"},
{"type":"PRESS_KEY","key":"ENTER"},
{"type":"WAIT_FOR","target":"video_list","timeoutMs":20000},
{"type":"CLICK","target":"video_card_2"},
{"type":"WAIT_FOR","target":"subscribe_button","timeoutMs":20000},
{"type":"CLICK","target":"subscribe_button"}]}

Người dùng: "Mở YouTube và xem video đầu tiên"
{"intent":"play_first_youtube_video","isSensitive":false,"actions":[
{"type":"OPEN_APP","app":"youtube"},
{"type":"WAIT_FOR","target":"video_list","timeoutMs":20000},
{"type":"CLICK","target":"video_card_1"}]}

Người dùng: "Mở YouTube, tìm nhạc lofi rồi mở video thứ 3"
{"intent":"search_lofi_and_play_third","isSensitive":false,"actions":[
{"type":"OPEN_APP","app":"youtube"},
{"type":"WAIT_FOR","target":"search_button","timeoutMs":20000},
{"type":"CLICK","target":"search_button"},
{"type":"INPUT_TEXT","text":"nhạc lofi"},
{"type":"PRESS_KEY","key":"ENTER"},
{"type":"WAIT_FOR","target":"video_list","timeoutMs":20000},
{"type":"CLICK","target":"video_card_3"}]}
${androidCapabilityPrompt(dynamicUi)}
Danh mục executor ở trên có ưu tiên cao nhất nếu các quy tắc trước mâu thuẫn.
`,
            },
            {
              role: "user",
              content: input.data.prompt,
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      return Response.json(
        {
          success: false,
          error: "Không thể phân tích câu lệnh bằng Ollama",
        },
        { status: 502 }
      );
    }

    // 3. Đọc phản hồi từ AI
    const rawResponse: unknown = await response.json();
    const ollama = OllamaResponseSchema.safeParse(rawResponse);

    if (!ollama.success) {
      return Response.json(
        { success: false, error: "Phản hồi Ollama không hợp lệ" },
        { status: 502 }
      );
    }

    // 4. Chuyển chuỗi JSON thành object
    let generated: unknown;

    try {
      generated = JSON.parse(ollama.data.message.content);
    } catch {
      return Response.json(
        { success: false, error: "AI không trả về JSON hợp lệ" },
        { status: 422 }
      );
    }

    // 5. Validate Action Plan
    const result = ActionPlanSchema.safeParse(generated);

    if (!result.success) {
      return Response.json(
        {
          success: false,
          error: "Action Plan không đúng cấu trúc",
          details: result.error.issues,
        },
        { status: 422 }
      );
    }

    try {
      validateAndroidPlan(result.data.actions, dynamicUi);
    } catch (error) {
      return Response.json({ success: false, error: error instanceof Error ? error.message : 'Kế hoạch vượt quá khả năng executor.' }, { status: 422 });
    }

    // 6. Trả về frontend
    return respondPlan(result.data);
  } catch (error) {
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" ||
        error.name === "AbortError");

    return Response.json(
      {
        success: false,
        error: isTimeout
          ? "AI xử lý quá thời gian cho phép"
          : "Không thể kết nối đến Ollama",
      },
      { status: isTimeout ? 504 : 503 }
    );
  }
}
