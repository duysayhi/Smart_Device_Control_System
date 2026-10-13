import { z } from "zod";
import {
  ActionPlanBaseSchema,
  ActionPlanSchema,
} from "@/lib/validators/action-plan.schema";

export const runtime = "nodejs";

const RequestSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
});

const OllamaResponseSchema = z.object({
  message: z.object({
    content: z.string(),
  }),
});

export async function POST(request: Request) {
  // 1. Nhận và kiểm tra câu lệnh
  const body = await request.json().catch(() => null);

  const input = RequestSchema.safeParse(body);

  if (!input.success) {
    return Response.json(
      { success: false, error: "Câu lệnh không hợp lệ" },
      { status: 400 }
    );
  }

  try {
    // 2. Gọi Ollama
    const response = await fetch(
      `${process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"}/api/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(60000),
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
Bạn là AI Command Interpreter của Phone Commander.

Hãy chuyển câu lệnh tiếng Việt thành Action Plan JSON.

Quy tắc:
- Một yêu cầu có thể chứa nhiều action.
- Các action phải đúng thứ tự thực hiện.
- Chỉ dùng các loại action được định nghĩa trong JSON Schema.
- OPEN_APP và CLOSE_APP cần app.
- CLICK và WAIT_FOR cần target.
- INPUT_TEXT cần text.
- PRESS_KEY cần key.
- SWIPE cần direction.
- WAIT_FOR cần timeoutMs.
- Chỉ trả JSON, không giải thích.
- Không tự tạo lệnh shell hoặc ADB.
- Thao tác thay đổi tài khoản, như đăng ký kênh,
  phải có isSensitive = true.
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

    // 6. Trả về frontend
    return Response.json({
      success: true,
      actionPlan: result.data,
    });
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
