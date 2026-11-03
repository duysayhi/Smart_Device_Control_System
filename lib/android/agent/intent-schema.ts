import { z } from 'zod';
import { SettingMutation } from './setting-schema';

export const IntentRequestSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('OPEN_APP'), args: z.object({ packageName: z.string().regex(/^[A-Za-z][\w]*(?:\.[\w]+)+$/) }).strict() }).strict(),
  z.object({ name: z.literal('OPEN_URL'), args: z.object({ url: z.string().max(1000).refine(value => {
    try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !/[\s'"`$;|<>\\\u0000-\u001f]/.test(value); } catch { return false; }
  }, 'Only bounded HTTP(S) URLs without credentials or shell syntax.') }).strict() }).strict(),
  z.object({ name: z.literal('OPEN_DIALER'), args: z.object({ number: z.string().regex(/^\+?\d{5,15}$/) }).strict() }).strict(),
  z.object({ name: z.literal('OPEN_SETTINGS'), args: z.object({ action: z.enum(['android.settings.SETTINGS', 'android.settings.WIFI_SETTINGS', 'android.settings.DISPLAY_SETTINGS', 'android.settings.SOUND_SETTINGS', 'android.settings.BATTERY_SAVER_SETTINGS']) }).strict() }).strict(),
  z.object({ name: z.literal('READ_STATE'), args: z.object({ state: z.enum(['wifi', 'battery', 'media_volume', 'ring_volume', 'brightness', 'bluetooth', 'dnd', 'rotation', 'flashlight', 'airplane']) }).strict() }).strict(),
  z.object({ name: z.literal('COMPOSE_SMS'), args: z.object({ number: z.string().regex(/^\+?\d{5,15}$/), body: z.string().min(1).max(160) }).strict() }).strict(),
  z.object({ name: z.literal('SET_DEVICE_STATE'), args: SettingMutation }).strict(),
]);
export type IntentRequest = z.infer<typeof IntentRequestSchema>;
export const IntentBindingSchema = z.object({ request: IntentRequestSchema, slots: z.record(z.string(), z.number().int().positive()) }).strict();
export type IntentBinding = z.infer<typeof IntentBindingSchema>;
