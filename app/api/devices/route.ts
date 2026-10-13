import { listAndroidDevices, readAndroidDeviceDetails } from '@/lib/android/adb';

export async function GET() {
  try {
    const detectedDevices = await listAndroidDevices();
    const devices = await Promise.all(detectedDevices.map(async (device) => ({
      ...await readAndroidDeviceDetails(device),
      ...(device.status === 'device'
        ? { screenshotUrl: `/api/devices/${encodeURIComponent(device.serial)}/screenshot?refresh=${Date.now()}` }
        : {}),
    })));
    return Response.json({ success: true, devices });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Không thể chạy ADB.',
      },
      { status: 503 }
    );
  }
}