import { z } from 'zod';

export const UiElementSchema = z.object({
  elementId: z.string().min(1), text: z.string(), resourceId: z.string(), contentDescription: z.string(),
  className: z.string(), packageName: z.string(),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  clickable: z.boolean().optional(), enabled: z.boolean().optional(),
  focusable: z.boolean().optional(), focused: z.boolean().optional(),
  scrollable: z.boolean().optional(), selected: z.boolean().optional(), visible: z.boolean().optional(),
  parentElementId: z.string().optional(),
});
export const ScreenSnapshotSchema = z.object({
  deviceSerial: z.string().min(1), snapshotId: z.string().uuid(), timestamp: z.number().int(),
  foregroundPackage: z.string(), activity: z.string().optional(),
  evidenceSource: z.enum(['APPIUM', 'ADB']), observationStatus: z.enum(['OBSERVED', 'UNKNOWN', 'DEVICE_ERROR', 'SESSION_ERROR']),
  elements: z.array(UiElementSchema),
});
export type ScreenSnapshot = z.infer<typeof ScreenSnapshotSchema>;
export type UiElement = z.infer<typeof UiElementSchema>;
