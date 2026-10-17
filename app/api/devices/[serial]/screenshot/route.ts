import { isValidAndroidSerial, listAndroidDevices, runAdb } from '@/lib/android/adb';
import { androidPreview } from '@/lib/android/screen-previews';
import { readTransportIdentity } from '@/lib/android/transport-identity';
import { wirelessIdentityAllowed } from '@/lib/android/wireless-store';

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

    const wirelessIdentity = device.connectionType === 'Wi-Fi' ? await readTransportIdentity(runAdb, serial, true) : undefined;
    if (device.connectionType === 'Wi-Fi' && (!wirelessIdentity || !await wirelessIdentityAllowed(serial, wirelessIdentity.physicalId))) {
      return Response.json({ error: 'Wireless identity is unverified or changed. Screenshot refused.' }, { status: 409 });
    }
    const screenshot = await androidPreview(serial, width);
    if (wirelessIdentity && (await readTransportIdentity(runAdb, serial, true))?.physicalId !== wirelessIdentity.physicalId) {
      return Response.json({ error: 'Physical identity changed while capturing preview. Image discarded.' }, { status: 409 });
    }
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
