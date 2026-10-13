import { z } from "zod";

// 1. Định nghĩa cấu trúc riêng cho từng hành động
export const ActionSchema = z.discriminatedUnion("type", [

  // Mở ứng dụng
  z.object({
    type: z.literal("OPEN_APP"),
    app: z.string().min(1),
  }),

  // Đóng ứng dụng
  z.object({
    type: z.literal("CLOSE_APP"),
    app: z.string().min(1),
  }),

  // Nhấn phần tử giao diện
  z.object({
    type: z.literal("CLICK"),
    target: z.string().min(1),
  }),

  // Nhập văn bản
  z.object({
    type: z.literal("INPUT_TEXT"),
    text: z.string().min(1),
  }),

  // Nhấn phím
  z.object({
    type: z.literal("PRESS_KEY"),
    key: z.enum([
      "HOME",
      "BACK",
      "ENTER",
      "VOLUME_UP",
      "VOLUME_DOWN",
    ]),
  }),

  // Vuốt màn hình
  z.object({
    type: z.literal("SWIPE"),
    direction: z.enum([
      "up",
      "down",
      "left",
      "right",
    ]),
  }),

  // Chờ phần tử giao diện xuất hiện
  z.object({
    type: z.literal("WAIT_FOR"),
    target: z.string().min(1),
    timeoutMs: z.number().int().min(1).max(30000),
  }),

  // Chụp ảnh màn hình
  z.object({
    type: z.literal("SCREENSHOT"),
    reason: z.string().optional(),
  }),

]);

// 2. Schema tổng thể của Action Plan
export const ActionPlanBaseSchema = z.object({
  intent: z.string().min(1),

  isSensitive: z.boolean(),

  actions: z.array(ActionSchema).min(1).max(20),
});

// 3. Schema dùng để kiểm tra kết quả AI
export const ActionPlanSchema = ActionPlanBaseSchema;

// 4. TypeScript Types
export type Action = z.infer<typeof ActionSchema>;

export type ActionPlan = z.infer<typeof ActionPlanSchema>;