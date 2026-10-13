import { z } from "zod";

const ActionSchema = z.object({
  type: z.enum([
    "OPEN_APP",
    "CLOSE_APP",
    "CLICK",
    "INPUT_TEXT",
    "PRESS_KEY",
    "SWIPE",
    "WAIT_FOR",
    "SCREENSHOT",
  ]),
  app: z.string().optional(),
  target: z.string().optional(),
  text: z.string().optional(),
  key: z.enum([
    "HOME",
    "BACK",
    "ENTER",
    "VOLUME_UP",
    "VOLUME_DOWN",
  ]).optional(),
  direction: z.enum([
    "up", "down", "left", "right",
  ]).optional(),
  timeoutMs: z.number().int().min(1).max(30000).optional(),
});

export const ActionPlanBaseSchema = z.object({
  intent: z.string().min(1),
  isSensitive: z.boolean(),
  actions: z.array(ActionSchema).min(1).max(20),
});

export const ActionPlanSchema =
  ActionPlanBaseSchema.superRefine((plan, ctx) => {
    plan.actions.forEach((action, index) => {
      let missing: string | null = null;

      switch (action.type) {
        case "OPEN_APP":
        case "CLOSE_APP":
          if (!action.app) missing = "app";
          break;

        case "CLICK":
          if (!action.target) missing = "target";
          break;

        case "INPUT_TEXT":
          if (!action.text) missing = "text";
          break;

        case "PRESS_KEY":
          if (!action.key) missing = "key";
          break;

        case "SWIPE":
          if (!action.direction) missing = "direction";
          break;

        case "WAIT_FOR":
          if (!action.target) missing = "target";
          else if (!action.timeoutMs) missing = "timeoutMs";
          break;
      }

      if (missing) {
        ctx.addIssue({
          code: "custom",
          path: ["actions", index, missing],
          message: `Thiếu tham số ${missing} cho ${action.type}`,
        });
      }
    });
  });

export type ActionPlan = z.infer<typeof ActionPlanSchema>;
