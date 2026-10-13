import { captureAndroidScreenshot, isValidAndroidSerial, listAndroidDevices } from '@/lib/android/adb';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serial: string }> }
) {
  const { serial } = await params;
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

    const screenshot = await captureAndroidScreenshot(serial);
    return new Response(new Uint8Array(screenshot), {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Type': 'image/png',
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