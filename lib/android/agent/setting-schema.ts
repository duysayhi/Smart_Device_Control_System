import { z } from 'zod';
export const SettingName = z.enum(['wifi', 'bluetooth', 'dnd', 'rotation', 'brightness', 'media_volume', 'ring_volume', 'flashlight', 'airplane']);
export type SettingName = z.infer<typeof SettingName>;
export const SettingMutation = z.object({ state: SettingName, value: z.number().int().nonnegative().max(255) }).strict().refine(v =>
  v.state === 'brightness' ? v.value >= 1 : v.state === 'dnd' ? v.value <= 3 : /volume/.test(v.state) ? v.value <= 15 : v.value <= 1, 'Setting value outside its closed domain.');
export type SettingMutation = z.infer<typeof SettingMutation>;
