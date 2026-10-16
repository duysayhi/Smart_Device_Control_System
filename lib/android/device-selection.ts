import type { AndroidAdbDevice, Device } from '../../types/device';

export function resolveLiveDeviceSelection(
    devices: AndroidAdbDevice[],
    previousSelectedSerial: string,
    previousSelectedIds?: string[],
): {
    devices: Device[];
    selectedAndroidSerial: string;
    selectedDeviceIds: string[];
} {
    const liveDevices: Device[] = devices.map((device) => ({
        id: device.serial,
        serial: device.serial,
        name: device.model,
        platform: 'android',
        osVersion: device.osVersion || 'Không có dữ liệu',
        status: device.status === 'device'
            ? 'READY'
            : device.status === 'offline'
                ? 'OFFLINE'
                : device.status === 'unauthorized'
                    ? 'UNAUTHORIZED'
                    : 'ERROR',
        batteryLevel: device.batteryLevel,
        connectionType: device.connectionType,
        resolution: device.resolution || 'Không có dữ liệu',
        screenPreview: 'home',
        ipAddress: device.ipAddress,
        screenshotUrl: device.screenshotUrl,
        isLive: true,
        lastActive: 'Đang kết nối ADB',
    }));

    const retained = liveDevices.find((device) =>
        device.serial === previousSelectedSerial &&
        device.status === 'READY' &&
        device.connectionType === 'USB'
    );
    const nextSerial = retained?.serial ?? liveDevices.find((device) =>
        device.status === 'READY' && device.connectionType === 'USB'
    )?.serial ?? '';

    return {
        devices: liveDevices,
        selectedAndroidSerial: nextSerial,
        selectedDeviceIds: previousSelectedIds === undefined ? (nextSerial ? [nextSerial] : []) :
            previousSelectedIds.filter(id => liveDevices.some(device => device.id === id && device.status === 'READY' && device.connectionType === 'USB')),
    };
}
