import type { AndroidAdbDevice, Device } from '../../types/device';

export function resolveLiveDeviceSelection(
    devices: AndroidAdbDevice[],
    previousSelectedSerial: string,
    previousSelectedIds?: string[],
    previousKnownLiveSerials: ReadonlyMap<string, AndroidAdbDevice> = new Map(),
): {
    devices: Device[];
    selectedAndroidSerial: string;
    selectedDeviceIds: string[];
    androidDevices: AndroidAdbDevice[];
    knownLiveSerials: ReadonlyMap<string, AndroidAdbDevice>;
} {
    const knownLiveSerials = new Map(previousKnownLiveSerials);
    for (const device of devices) {
        if (device.status === 'device' && device.identityVerified && device.physicalId) knownLiveSerials.set(device.serial, device);
    }
    const previous = knownLiveSerials.get(previousSelectedSerial);
    const androidDevices = devices.map(device => {
        const known = knownLiveSerials.get(device.serial);
        return device.status !== 'device' && known ? { ...device, physicalId: known.physicalId } : device;
    });
    if (previous && !androidDevices.some(device => device.serial === previousSelectedSerial)) {
        androidDevices.push({ ...previous, status: 'offline', identityVerified: false, screenshotUrl: undefined,
            busy: false, currentSessionId: undefined, currentExecutionId: undefined });
    }
    const present = androidDevices.find(device => device.serial === previousSelectedSerial);
    const alias = previous && androidDevices.find(device => device.status === 'device' && device.identityVerified && device.physicalId === previous.physicalId);
    const retainedSerial = present && (present.status === 'device' || previous) ?
        (present.status === 'device' ? present.serial : alias?.serial ?? present.serial) : undefined;
    const groups = new Map<string, AndroidAdbDevice[]>();
    for (const device of androidDevices) {
        const key = device.physicalId ?? device.serial;
        groups.set(key, [...(groups.get(key) ?? []), device]);
    }
    const transports = [...groups.values()].map(group => group.find(d => d.serial === retainedSerial) ??
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

    const readyDevices = liveDevices.filter(device => device.status === 'READY');
    // Only verified history permits retaining a missing serial or following its physical alias.
    const nextSerial = retainedSerial ?? (readyDevices.length === 1 ? readyDevices[0].serial : '');

    return {
        devices: liveDevices,
        androidDevices,
        knownLiveSerials,
        selectedAndroidSerial: nextSerial,
        selectedDeviceIds: previousSelectedIds === undefined ? (nextSerial ? [nextSerial] : []) :
            [...new Set(previousSelectedIds.map(id => {
                const old = devices.find(device => device.serial === id);
                return liveDevices.find(device => device.status === 'READY' && (device.id === id || old?.physicalId && old.physicalId === device.physicalId))?.id;
            }).filter((id): id is string => Boolean(id)))],
    };
}
