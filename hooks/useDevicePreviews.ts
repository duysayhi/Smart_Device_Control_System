'use client';
import { useEffect, useState } from 'react';
import type { Device } from '@/types/device';

// One timer for all previews. Detail/selected screens get priority; hidden pages pause.
export function useDevicePreviews(devices: Device[], selectedIds: string[], detailId?: string): Device[] {
  const [version, setVersion] = useState(0);
  useEffect(() => { const timer = setInterval(() => { if (!document.hidden) setVersion(Date.now()); }, 2000); return () => clearInterval(timer); }, []);
  return devices.map(device => {
    if (!device.isLive || !device.screenshotUrl || device.status === 'OFFLINE' || device.status === 'UNAUTHORIZED') return device;
    const detailed = device.id === detailId, selected = selectedIds.includes(device.id);
    const interval = device.connectionType === 'Wi-Fi' ? detailed || selected ? 6000 : 30000 : detailed || selected ? 4000 : 20000;
    const width = detailed ? 720 : selected ? 360 : 180;
    return { ...device, screenshotUrl: `/api/devices/${encodeURIComponent(device.serial)}/screenshot?width=${width}&frame=${Math.floor(version / interval)}` };
  });
}
