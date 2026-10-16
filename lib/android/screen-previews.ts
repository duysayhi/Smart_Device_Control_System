import sharp from 'sharp';
import { captureAndroidScreenshot } from './adb';
const store = globalThis as typeof globalThis & { phonePreviewCache?: Map<string, { at: number; raw?: Buffer; pending?: Promise<Buffer> }> };
const cache = store.phonePreviewCache ??= new Map();
export async function androidPreview(serial: string, width?: number): Promise<Buffer> {
  let entry = cache.get(serial);
  if (!entry) {
    if (cache.size >= 8) {
      const oldest = [...cache].find(([, value]) => !value.pending);
      if (!oldest) throw new Error('Preview capture capacity reached.');
      cache.delete(oldest[0]);
    }
    entry = { at: 0 }; cache.set(serial, entry);
  }
  const current = entry;
  if (!current.raw || Date.now() - current.at > 2000) {
    current.pending ??= captureAndroidScreenshot(serial).then(raw => { current.raw = raw; current.at = Date.now(); return raw; }).finally(() => { current.pending = undefined; });
    await current.pending;
  }
  return width ? sharp(current.raw!).resize({ width, withoutEnlargement: true }).jpeg({ quality: 65 }).toBuffer() : current.raw!;
}
