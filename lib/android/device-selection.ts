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
    const groups = new Map<string, AndroidAdbDevice[]>();
    for (const device of devices) {
        const key = device.physicalId ?? device.serial;
        groups.set(key, [...(groups.get(key) ?? []), device]);
    }
    const transports = [...groups.values()].map(group => group.find(d => d.serial === previousSelectedSerial && d.status === 'device') ??
        group.find(d => d.status === 'device' && d.connectionType === 'USB') ?? group.find(d => d.status === 'device') ?? group[0]);
    const liveDevices: Device[] = transports.map((device) => ({
        physicalId: device.physicalId,
        id: device.serial,
        serial: device.serial,
        name: device.model,
        platform: 'android',
        osVersion: device.osVersion || 'Không có dữ liệu',
        status: device.status === 'device' && device.connectionType === 'Wi-Fi' && !device.identityVerified ? 'ERROR' : device.status === 'device'
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
        device.status === 'READY'
    );
    const nextSerial = retained?.serial ?? liveDevices.find((device) =>
        device.status === 'READY'
    )?.serial ?? '';

    return {
        devices: liveDevices,
        selectedAndroidSerial: nextSerial,
        selectedDeviceIds: previousSelectedIds === undefined ? (nextSerial ? [nextSerial] : []) :
            [...new Set(previousSelectedIds.map(id => {
                const old = devices.find(device => device.serial === id);
                return liveDevices.find(device => device.status === 'READY' && (device.id === id || old?.physicalId && old.physicalId === device.physicalId))?.id;
            }).filter((id): id is string => Boolean(id)))],
    };
}
