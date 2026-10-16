import { isValidAndroidSerial, listAndroidDevices } from '@/lib/android/adb';
import { androidPreview } from '@/lib/android/screen-previews';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ serial: string }> }
) {
  const { serial } = await params;
  const rawWidth = new URL(request.url).searchParams.get('width');
  const width = rawWidth === null ? undefined : Number(rawWidth);
  if (width !== undefined && (!Number.isInteger(width) || width < 160 || width > 720)) return Response.json({ error: 'Invalid preview width.' }, { status: 400 });
  if (!isValidAndroidSerial(serial)) {
    return Response.json({ success: false, error: 'Serial thiết bị không hợp lệ.' }, { status: 400 });
  }

  try {
    const device = (await listAndroidDevices()).find((item) => item.serial === serial);
    if (!device || device.status !== 'device') {
      return Response.json(
        { success: false, error: 'Thiết bị chưa kết nối hoặc chưa được cấp quyền ADB.' },
        { status: 404 }
      );
    }

    const screenshot = await androidPreview(serial, width);
    return new Response(new Uint8Array(screenshot), {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Type': width ? 'image/jpeg' : 'image/png',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : 'Không thể chụp màn hình thiết bị.' },
      { status: 503 }
    );
  }
}
